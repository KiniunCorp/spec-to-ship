import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  WorktreeProvider,
  WorktreeProviderAvailability,
  WorktreeProviderCapability,
  WorktreeProviderConfig,
  WorktreeRuntimePaths,
  WorktreeSession,
  WorktreeSessionPurpose,
  WorktreeSessionQuery,
  WorktreeSessionRemoval,
  WorktreeSessionRequest,
  WorktreeSessionValidation,
} from '../types/index.js';
import { runShell } from './shell.js';
import {
  buildWorktreeSessionId,
  cloneWorktreeSession,
  deriveWorktreePathSegment,
  deriveWorktreeSessionPurpose,
  normalizeWorktreeProviderConfig,
  resolveTrackedBranchResumableState,
  resolveWorktreeRuntimePaths,
  resolveWorktreeSessionPath,
} from './worktree-provider.js';

type GitWorktreeEntry = {
  worktreePath: string;
  branch?: string;
  detached?: boolean;
};

type NativeSessionMetadata = {
  id: string;
  branch: string;
  baseBranch: string;
  pathSegment: string;
  purpose: WorktreeSessionPurpose;
  changeId?: string;
  sliceId?: string;
  runId?: string;
  createdAt: string;
  updatedAt: string;
  lastValidatedAt?: string;
};

const SUPPORTED_NATIVE_CAPABILITIES: readonly WorktreeProviderCapability[] = [
  'centralized_paths',
  'switch_session',
  'list_sessions',
  'remove_sessions',
  'session_validation',
] as const;

export function createNativeWorktreeProvider(config: WorktreeProviderConfig): WorktreeProvider {
  const normalized = normalizeWorktreeProviderConfig({
    ...config,
    kind: 'native',
    capabilities: resolveNativeCapabilities(config.capabilities),
  });
  const runtimePaths = resolveWorktreeRuntimePaths(normalized);

  return {
    kind: normalized.kind,
    config: normalized,
    getCapabilities: () => [...(normalized.capabilities || [])],
    checkAvailability: async () => checkNativeAvailability(normalized),
    resolveRuntimePaths: () => runtimePaths,
    resolveSessionPath: (request) => resolveWorktreeSessionPath(normalized, request),
    ensureSession: async (request) => ensureNativeSession(normalized, runtimePaths, request),
    switchToSession: async (session) => switchToNativeSession(normalized, runtimePaths, session),
    listSessions: async (query) => listNativeSessions(normalized, runtimePaths, query),
    removeSession: async (session, options) => removeNativeSession(normalized, runtimePaths, session, options),
    validateSession: async (session) => validateNativeSession(normalized, runtimePaths, session),
  };
}

async function checkNativeAvailability(config: WorktreeProviderConfig): Promise<WorktreeProviderAvailability> {
  const gitBinary = resolveGitBinary(config);
  if (!gitBinary.available) {
    return {
      available: false,
      reason: gitBinary.reason,
    };
  }

  const versionProbe = runGit(config, ['--version'], config.repoRoot, true);
  if (versionProbe.status !== 0) {
    return {
      available: false,
      reason: versionProbe.stderr.trim() || versionProbe.stdout.trim() || 'git is not available.',
    };
  }

  const repoProbe = runGit(config, ['rev-parse', '--is-inside-work-tree'], config.repoRoot, true);
  if (repoProbe.status !== 0 || repoProbe.stdout.trim() !== 'true') {
    return {
      available: false,
      reason: `Path is not a git repository: ${config.repoRoot}`,
      version: parseGitVersion(versionProbe.stdout),
    };
  }

  return {
    available: true,
    version: parseGitVersion(versionProbe.stdout),
  };
}

async function ensureNativeSession(
  config: WorktreeProviderConfig,
  runtimePaths: WorktreeRuntimePaths,
  request: WorktreeSessionRequest,
): Promise<WorktreeSession> {
  const normalizedRequest = normalizeRequest(config, request);
  ensureRuntimeRoots(runtimePaths);

  const worktreePath = resolveWorktreeSessionPath(config, normalizedRequest);
  const allEntries = readGitWorktrees(config);
  const targetEntry = findGitWorktreeByPath(allEntries, worktreePath);
  if (targetEntry) {
    return upsertManagedSession(config, runtimePaths, targetEntry, normalizedRequest);
  }

  const existingBranchEntry = findGitWorktreeByBranch(allEntries, normalizedRequest.branch);
  if (existingBranchEntry) {
    if (isManagedWorktreePath(runtimePaths, existingBranchEntry.worktreePath)) {
      return upsertManagedSession(config, runtimePaths, existingBranchEntry, normalizedRequest);
    }
    throw new Error(
      `Branch '${normalizedRequest.branch}' is already checked out at ${existingBranchEntry.worktreePath}.`,
    );
  }

  if (localBranchExists(config, normalizedRequest.branch)) {
    runGit(config, ['worktree', 'add', worktreePath, normalizedRequest.branch], config.repoRoot);
  } else {
    runGit(
      config,
      ['worktree', 'add', '-b', normalizedRequest.branch, worktreePath, normalizedRequest.baseBranch || config.defaultBranch],
      config.repoRoot,
    );
  }

  const createdEntry = findGitWorktreeByPath(readGitWorktrees(config), worktreePath) || {
    worktreePath,
    branch: normalizedRequest.branch,
  };
  return upsertManagedSession(config, runtimePaths, createdEntry, normalizedRequest);
}

async function switchToNativeSession(
  config: WorktreeProviderConfig,
  runtimePaths: WorktreeRuntimePaths,
  session: WorktreeSession,
): Promise<void> {
  const validation = await validateNativeSession(config, runtimePaths, session);
  if (validation.state !== 'active' || !validation.isResumable) {
    throw new Error(validation.reason || `Worktree session '${session.id}' is not resumable.`);
  }
}

async function listNativeSessions(
  config: WorktreeProviderConfig,
  runtimePaths: WorktreeRuntimePaths,
  query?: WorktreeSessionQuery,
): Promise<WorktreeSession[]> {
  const sessions = readGitWorktrees(config)
    .filter((entry) => isManagedWorktreePath(runtimePaths, entry.worktreePath))
    .map((entry) => buildManagedSession(config, runtimePaths, entry));

  return sessions.filter((session) => matchesSessionQuery(session, query));
}

async function removeNativeSession(
  config: WorktreeProviderConfig,
  runtimePaths: WorktreeRuntimePaths,
  session: WorktreeSession,
  options: WorktreeSessionRemoval = {},
): Promise<void> {
  const metadata = readSessionMetadata(runtimePaths, session.pathSegment);

  if (existsSync(session.worktreePath)) {
    const args = ['worktree', 'remove'];
    if (options.force) args.push('--force');
    args.push(session.worktreePath);
    runGit(config, args, config.repoRoot);
  } else {
    runGit(config, ['worktree', 'prune'], config.repoRoot, true);
  }

  deleteSessionMetadata(runtimePaths, session.pathSegment);

  if (options.removeBranch && session.branch !== config.defaultBranch && session.branch !== session.baseBranch) {
    const branchRemoval = runGit(
      config,
      ['branch', options.force ? '-D' : '-d', session.branch],
      config.repoRoot,
      true,
    );
    if (branchRemoval.status !== 0) {
      const output = branchRemoval.stderr.trim() || branchRemoval.stdout.trim();
      if (!output.includes(`branch '${session.branch}' not found`)) {
        throw new Error(output || `Failed to delete branch '${session.branch}'.`);
      }
    }
  }

  if (metadata && metadata.branch !== session.branch && options.removeBranch) {
    runGit(config, ['branch', options.force ? '-D' : '-d', metadata.branch], config.repoRoot, true);
  }
}

async function validateNativeSession(
  config: WorktreeProviderConfig,
  runtimePaths: WorktreeRuntimePaths,
  session: WorktreeSession,
): Promise<WorktreeSessionValidation> {
  const checkedAt = new Date().toISOString();
  const expectedBranch = normalizeBranchName(session.branch);

  if (!existsSync(session.worktreePath)) {
    writeLastValidatedAt(runtimePaths, session.pathSegment, checkedAt);
    return {
      sessionId: session.id,
      state: 'missing',
      isResumable: false,
      checkedAt,
      reason: `Worktree path does not exist: ${session.worktreePath}`,
      requiredAction: 'create_session',
    };
  }

  const repoProbe = runGit(config, ['rev-parse', '--is-inside-work-tree'], session.worktreePath, true);
  if (repoProbe.status !== 0 || repoProbe.stdout.trim() !== 'true') {
    writeLastValidatedAt(runtimePaths, session.pathSegment, checkedAt);
    return {
      sessionId: session.id,
      state: 'invalid',
      isResumable: false,
      checkedAt,
      reason: `Path is not an active git worktree: ${session.worktreePath}`,
      requiredAction: 'create_fresh_session',
    };
  }

  const branchProbe = runGit(config, ['branch', '--show-current'], session.worktreePath, true);
  const currentBranch = normalizeBranchName(branchProbe.stdout);
  if (!currentBranch) {
    writeLastValidatedAt(runtimePaths, session.pathSegment, checkedAt);
    return {
      sessionId: session.id,
      state: 'invalid',
      isResumable: false,
      checkedAt,
      reason: `Worktree is detached or branch cannot be resolved: ${session.worktreePath}`,
      requiredAction: 'manual_review',
    };
  }

  if (currentBranch !== expectedBranch) {
    writeLastValidatedAt(runtimePaths, session.pathSegment, checkedAt);
    return {
      sessionId: session.id,
      state: 'invalid',
      isResumable: false,
      checkedAt,
      reason: `Worktree branch mismatch: expected '${expectedBranch}', found '${currentBranch}'.`,
      requiredAction: 'create_fresh_session',
    };
  }

  const trackedState = resolveTrackedBranchResumableState(config, {
    branch: expectedBranch,
    baseBranch: session.baseBranch,
    pullRequest: session.pullRequest,
  });
  if (trackedState) {
    writeLastValidatedAt(runtimePaths, session.pathSegment, checkedAt);
    return {
      sessionId: session.id,
      state: trackedState.state,
      isResumable: trackedState.isResumable,
      checkedAt,
      reason: trackedState.reason,
      requiredAction: trackedState.requiredAction,
    };
  }

  writeLastValidatedAt(runtimePaths, session.pathSegment, checkedAt);
  return {
    sessionId: session.id,
    state: 'active',
    isResumable: true,
    checkedAt,
    requiredAction: 'resume',
  };
}

function upsertManagedSession(
  config: WorktreeProviderConfig,
  runtimePaths: WorktreeRuntimePaths,
  entry: GitWorktreeEntry,
  request: NormalizedSessionRequest,
): WorktreeSession {
  const pathSegment = path.basename(entry.worktreePath);
  const existingMetadata = readSessionMetadata(runtimePaths, pathSegment);
  const branch = normalizeBranchName(entry.branch || existingMetadata?.branch || request.branch);
  if (branch && branch !== request.branch && normalizePath(entry.worktreePath) === normalizePath(resolveWorktreeSessionPath(config, request))) {
    throw new Error(`Managed worktree path '${entry.worktreePath}' is already attached to branch '${branch}'.`);
  }

  const now = new Date().toISOString();
  const metadata: NativeSessionMetadata = {
    id:
      existingMetadata?.id ||
      buildWorktreeSessionId(config.kind, config, {
        branch: request.branch,
        preferredPathSegment: pathSegment,
        changeId: request.changeId,
        sliceId: request.sliceId,
        purpose: request.purpose,
      }),
    branch: request.branch,
    baseBranch: request.baseBranch || config.defaultBranch,
    pathSegment,
    purpose: request.purpose,
    changeId: request.changeId || existingMetadata?.changeId,
    sliceId: request.sliceId || existingMetadata?.sliceId,
    runId: request.runId || existingMetadata?.runId,
    createdAt: existingMetadata?.createdAt || now,
    updatedAt: now,
    lastValidatedAt: existingMetadata?.lastValidatedAt,
  };

  writeSessionMetadata(runtimePaths, metadata);

  return buildManagedSession(config, runtimePaths, entry, metadata);
}

function buildManagedSession(
  config: WorktreeProviderConfig,
  runtimePaths: WorktreeRuntimePaths,
  entry: GitWorktreeEntry,
  metadata = readSessionMetadata(runtimePaths, path.basename(entry.worktreePath)),
): WorktreeSession {
  const now = new Date().toISOString();
  const pathSegment = metadata?.pathSegment || path.basename(entry.worktreePath);
  const branch = normalizeBranchName(entry.branch || metadata?.branch || '');
  const purpose = metadata?.purpose === 'pull_request' ? 'pull_request' : 'change';
  const trackedState =
    !entry.detached && branch
      ? resolveTrackedBranchResumableState(config, {
          branch,
          baseBranch: metadata?.baseBranch || config.defaultBranch,
          pullRequest: undefined,
        })
      : null;
  const state = entry.detached || !branch ? 'invalid' : trackedState?.state || 'active';
  const session = cloneWorktreeSession({
    id:
      metadata?.id ||
      buildWorktreeSessionId(config.kind, config, {
        branch: branch || config.defaultBranch,
        preferredPathSegment: pathSegment,
        changeId: metadata?.changeId,
        sliceId: metadata?.sliceId,
        purpose,
      }),
    provider: config.kind,
    repoRoot: config.repoRoot,
    baseBranch: metadata?.baseBranch || config.defaultBranch,
    branch: branch || config.defaultBranch,
    worktreePath: entry.worktreePath,
    pathSegment,
    state,
    isResumable: trackedState ? trackedState.isResumable : state === 'active',
    purpose,
    changeId: metadata?.changeId,
    sliceId: metadata?.sliceId,
    runId: metadata?.runId,
    createdAt: metadata?.createdAt || now,
    updatedAt: metadata?.updatedAt || metadata?.createdAt || now,
    lastValidatedAt: metadata?.lastValidatedAt,
  });

  return session;
}

function matchesSessionQuery(session: WorktreeSession, query?: WorktreeSessionQuery): boolean {
  if (!query) return true;
  if (query.repoRoot && normalizePath(query.repoRoot) !== normalizePath(session.repoRoot)) return false;
  if (query.branch && normalizeBranchName(query.branch) !== normalizeBranchName(session.branch)) return false;
  if (query.changeId && query.changeId !== session.changeId) return false;
  if (query.sliceId && query.sliceId !== session.sliceId) return false;
  if (query.runId && query.runId !== session.runId) return false;
  if (query.purpose && query.purpose !== session.purpose) return false;
  if (query.state && query.state !== 'any' && query.state !== session.state) return false;
  return true;
}

function normalizeRequest(config: WorktreeProviderConfig, request: WorktreeSessionRequest): NormalizedSessionRequest {
  const repoRoot = path.resolve(request.repoRoot);
  if (repoRoot !== config.repoRoot) {
    throw new Error(`Worktree session repo root '${repoRoot}' does not match provider repo root '${config.repoRoot}'.`);
  }

  return {
    ...request,
    repoRoot,
    branch: normalizeBranchName(request.branch),
    baseBranch: normalizeBranchName(request.baseBranch || config.defaultBranch),
    preferredPathSegment: request.preferredPathSegment ? deriveWorktreePathSegment(request) : undefined,
    purpose: deriveWorktreeSessionPurpose(request),
  };
}

function resolveNativeCapabilities(capabilities?: WorktreeProviderCapability[]): WorktreeProviderCapability[] {
  const requested = capabilities && capabilities.length > 0 ? capabilities : [...SUPPORTED_NATIVE_CAPABILITIES];
  return requested.filter((capability): capability is WorktreeProviderCapability =>
    SUPPORTED_NATIVE_CAPABILITIES.includes(capability),
  );
}

function ensureRuntimeRoots(runtimePaths: WorktreeRuntimePaths): void {
  mkdirSync(runtimePaths.repoWorktreesRoot, { recursive: true });
  mkdirSync(runtimePaths.providerStateRoot, { recursive: true });
}

function readGitWorktrees(config: WorktreeProviderConfig): GitWorktreeEntry[] {
  const result = runGit(config, ['worktree', 'list', '--porcelain'], config.repoRoot, true);
  if (result.status !== 0) return [];
  return parseGitWorktreeList(result.stdout);
}

function parseGitWorktreeList(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | null = null;

  const flush = (): void => {
    if (current?.worktreePath) {
      entries.push({
        ...current,
        worktreePath: path.resolve(current.worktreePath),
      });
    }
    current = null;
  };

  for (const rawLine of output.split('\n')) {
    const line = String(rawLine || '').trim();
    if (!line) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      current = { worktreePath: line.slice('worktree '.length) };
      continue;
    }
    if (!current) continue;
    if (line.startsWith('branch ')) {
      current.branch = normalizeBranchName(line.slice('branch '.length).replace(/^refs\/heads\//, ''));
      continue;
    }
    if (line === 'detached') {
      current.detached = true;
    }
  }

  flush();
  return entries;
}

function findGitWorktreeByPath(entries: GitWorktreeEntry[], worktreePath: string): GitWorktreeEntry | undefined {
  const normalized = normalizePath(worktreePath);
  return entries.find((entry) => normalizePath(entry.worktreePath) === normalized);
}

function findGitWorktreeByBranch(entries: GitWorktreeEntry[], branch: string): GitWorktreeEntry | undefined {
  const normalized = normalizeBranchName(branch);
  return entries.find((entry) => normalizeBranchName(entry.branch) === normalized);
}

function isManagedWorktreePath(runtimePaths: WorktreeRuntimePaths, worktreePath: string): boolean {
  const candidate = normalizePath(worktreePath);
  const root = normalizePath(runtimePaths.repoWorktreesRoot);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function readSessionMetadata(runtimePaths: WorktreeRuntimePaths, pathSegment: string): NativeSessionMetadata | undefined {
  const filePath = getSessionMetadataPath(runtimePaths, pathSegment);
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<NativeSessionMetadata>;
    if (!parsed || typeof parsed !== 'object') return undefined;
    return {
      id: String(parsed.id || ''),
      branch: normalizeBranchName(parsed.branch),
      baseBranch: normalizeBranchName(parsed.baseBranch),
      pathSegment: String(parsed.pathSegment || pathSegment),
      purpose: parsed.purpose === 'pull_request' ? 'pull_request' : 'change',
      changeId: parsed.changeId ? String(parsed.changeId) : undefined,
      sliceId: parsed.sliceId ? String(parsed.sliceId) : undefined,
      runId: parsed.runId ? String(parsed.runId) : undefined,
      createdAt: String(parsed.createdAt || ''),
      updatedAt: String(parsed.updatedAt || ''),
      lastValidatedAt: parsed.lastValidatedAt ? String(parsed.lastValidatedAt) : undefined,
    };
  } catch {
    return undefined;
  }
}

function writeSessionMetadata(runtimePaths: WorktreeRuntimePaths, metadata: NativeSessionMetadata): void {
  ensureRuntimeRoots(runtimePaths);
  writeFileSync(getSessionMetadataPath(runtimePaths, metadata.pathSegment), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
}

function deleteSessionMetadata(runtimePaths: WorktreeRuntimePaths, pathSegment: string): void {
  rmSync(getSessionMetadataPath(runtimePaths, pathSegment), { force: true });
}

function writeLastValidatedAt(runtimePaths: WorktreeRuntimePaths, pathSegment: string, checkedAt: string): void {
  const metadata = readSessionMetadata(runtimePaths, pathSegment);
  if (!metadata) return;
  writeSessionMetadata(runtimePaths, {
    ...metadata,
    lastValidatedAt: checkedAt,
    updatedAt: metadata.updatedAt || checkedAt,
  });
}

function getSessionMetadataPath(runtimePaths: WorktreeRuntimePaths, pathSegment: string): string {
  return path.join(runtimePaths.providerStateRoot, `${pathSegment}.json`);
}

function localBranchExists(config: WorktreeProviderConfig, branch: string): boolean {
  return runGit(config, ['show-ref', '--verify', '--quiet', `refs/heads/${normalizeBranchName(branch)}`], config.repoRoot, true)
    .status === 0;
}

function runGit(
  config: WorktreeProviderConfig,
  args: string[],
  cwd: string,
  allowFailure = false,
): ReturnType<typeof runShell> {
  const gitBinary = resolveGitBinary(config);
  if (!gitBinary.available || !gitBinary.command) {
    if (allowFailure) {
      return {
        status: 1,
        stdout: '',
        stderr: gitBinary.reason || 'git is not available.',
      };
    }
    throw new Error(gitBinary.reason || 'git is not available.');
  }

  return runShell(gitBinary.command, args, cwd, allowFailure, config.env || {});
}

function resolveGitBinary(config: WorktreeProviderConfig): {
  available: boolean;
  command?: string;
  reason?: string;
} {
  const configured = String(config.binaryPath || 'git').trim() || 'git';
  if (configured.includes(path.sep) && !existsSync(configured)) {
    return {
      available: false,
      reason: `Configured git binary does not exist: ${configured}`,
    };
  }
  return {
    available: true,
    command: configured,
  };
}

function parseGitVersion(output: string): string | undefined {
  const match = String(output || '').trim().match(/^git version\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : undefined;
}

function normalizeBranchName(value: string | undefined): string {
  return String(value || '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^\/+|\/+$/g, '');
}

function normalizePath(value: string): string {
  const resolved = path.resolve(String(value || '').trim());
  if (!resolved) return resolved;
  try {
    return existsSync(resolved) ? realpathSync(resolved) : resolved;
  } catch {
    return resolved;
  }
}

type NormalizedSessionRequest = WorktreeSessionRequest & {
  repoRoot: string;
  branch: string;
  baseBranch: string;
  purpose: WorktreeSessionPurpose;
};

void (createNativeWorktreeProvider satisfies (config: WorktreeProviderConfig) => WorktreeProvider);
