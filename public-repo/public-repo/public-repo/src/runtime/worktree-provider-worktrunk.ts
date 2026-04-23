import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
import { runShell } from './shell.js';
import type {
  WorktreeProvider,
  WorktreeProviderAvailability,
  WorktreeProviderCapability,
  WorktreeProviderConfig,
  WorktreeSession,
  WorktreeSessionPullRequestRef,
  WorktreeSessionQuery,
  WorktreeSessionRemoval,
  WorktreeSessionRequest,
  WorktreeSessionState,
  WorktreeSessionValidation,
  WorktreeValidationAction,
  WorktreePullRequestWorkspaceRequest,
} from '../types/index.js';

interface WorktrunkListEntry {
  branch?: string;
  path?: string;
  kind?: 'worktree' | 'branch';
  main_state?: string;
  integration_reason?: string;
  is_main?: boolean;
  worktree?: {
    detached?: boolean;
  };
}

interface SessionStateInfo {
  state: WorktreeSessionState;
  isResumable: boolean;
  requiredAction?: WorktreeValidationAction;
  reason?: string;
}

const DEFAULT_BINARY = 'wt';
const DEFAULT_CAPABILITIES: WorktreeProviderCapability[] = [
  'centralized_paths',
  'switch_session',
  'list_sessions',
  'remove_sessions',
  'session_validation',
  'pull_request_workspace',
];

export function createWorktrunkWorktreeProvider(config: WorktreeProviderConfig): WorktreeProvider {
  const normalized = normalizeWorktreeProviderConfig({
    ...config,
    kind: 'worktrunk',
    capabilities: Array.from(new Set([...(config.capabilities || []), ...DEFAULT_CAPABILITIES])),
  });

  const provider: WorktreeProvider = {
    kind: normalized.kind,
    config: normalized,
    getCapabilities: () => [...(normalized.capabilities || DEFAULT_CAPABILITIES)],
    checkAvailability: async () => checkAvailability(normalized),
    resolveRuntimePaths: () => resolveWorktreeRuntimePaths(normalized),
    resolveSessionPath: (request) => resolveWorktreeSessionPath(normalized, request),
    ensureSession: async (request) => ensureSession(normalized, request),
    switchToSession: async (session) => {
      await ensureSession(normalized, {
        repoRoot: session.repoRoot,
        branch: session.branch,
        baseBranch: session.baseBranch,
        purpose: session.purpose,
        changeId: session.changeId,
        sliceId: session.sliceId,
        runId: session.runId,
        preferredPathSegment: session.pathSegment,
        reuseExisting: true,
      });
    },
    listSessions: async (query) => listSessions(normalized, query),
    removeSession: async (session, options) => removeSession(normalized, session, options),
    validateSession: async (session) => validateSession(normalized, session),
    openPullRequestWorkspace: async (request) => openPullRequestWorkspace(normalized, request),
  };

  return provider;
}

export function parseWorktrunkListOutput(output: string): WorktrunkListEntry[] {
  const parsed = JSON.parse(String(output || '[]')) as unknown;
  return Array.isArray(parsed) ? (parsed as WorktrunkListEntry[]) : [];
}

async function checkAvailability(config: WorktreeProviderConfig): Promise<WorktreeProviderAvailability> {
  const result = runShell(resolveBinary(config), ['--version'], config.repoRoot, true, config.env);
  if (result.status !== 0) {
    return {
      available: false,
      reason: `Worktrunk binary '${resolveBinary(config)}' is not available.`,
    };
  }

  return {
    available: true,
    version: parseVersion(result.stdout),
  };
}

async function ensureSession(
  config: WorktreeProviderConfig,
  request: WorktreeSessionRequest,
): Promise<WorktreeSession> {
  const normalizedRequest = normalizeRequest(config, request);
  const stored = findStoredSession(config, normalizedRequest);

  if (stored && normalizedRequest.reuseExisting !== false) {
    const validation = await validateSession(config, stored);
    if (validation.state === 'active' && validation.isResumable) {
      return readStoredSession(config, stored.id) || cloneWorktreeSession(stored, { lastValidatedAt: validation.checkedAt });
    }
    if (validation.state !== 'missing') {
      throw new Error(
        `Worktree session '${stored.branch}' is ${validation.state} and cannot be reused automatically${
          validation.reason ? ` (${validation.reason})` : ''
        }.`,
      );
    }
  }

  const desiredPath = resolveWorktreeSessionPath(config, normalizedRequest);
  const branchExists = gitBranchExists(config.repoRoot, normalizedRequest.branch);
  const args = ['--config', ensureSwitchConfig(config, desiredPath), 'switch', '--no-cd'];

  if (!branchExists) {
    args.push('--create');
  }
  if (normalizedRequest.baseBranch) {
    args.push('--base', normalizedRequest.baseBranch);
  }
  args.push(normalizedRequest.branch);

  const result = runShell(resolveBinary(config), args, config.repoRoot, true, config.env);
  if (result.status !== 0) {
    throw new Error(`Failed to ensure Worktrunk session '${normalizedRequest.branch}': ${compactOutput(result)}`);
  }

  const live = findLiveSessionByBranch(config, normalizedRequest.branch);
  const prior = stored || live;
  const session = cloneWorktreeSession(
    {
      id:
        prior?.id ||
        buildWorktreeSessionId(config.kind, config, {
          branch: normalizedRequest.branch,
          preferredPathSegment: normalizedRequest.preferredPathSegment,
          sliceId: normalizedRequest.sliceId,
          changeId: normalizedRequest.changeId,
          purpose: normalizedRequest.purpose,
        }),
      provider: config.kind,
      repoRoot: config.repoRoot,
      baseBranch: normalizedRequest.baseBranch || config.defaultBranch,
      branch: normalizedRequest.branch,
      worktreePath: live?.worktreePath || desiredPath,
      pathSegment:
        prior?.pathSegment ||
        deriveWorktreePathSegment({
          ...normalizedRequest,
          preferredPathSegment: normalizedRequest.preferredPathSegment || path.basename(live?.worktreePath || desiredPath),
        }),
      state: live?.state || 'active',
      isResumable: live?.isResumable ?? true,
      purpose: normalizedRequest.purpose || prior?.purpose || deriveWorktreeSessionPurpose(normalizedRequest),
      changeId: normalizedRequest.changeId || prior?.changeId,
      sliceId: normalizedRequest.sliceId || prior?.sliceId,
      runId: normalizedRequest.runId || prior?.runId,
      pullRequest: prior?.pullRequest,
      createdAt: prior?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastValidatedAt: prior?.lastValidatedAt,
    },
    {},
  );

  persistSession(config, session);
  return session;
}

async function listSessions(
  config: WorktreeProviderConfig,
  query?: WorktreeSessionQuery,
): Promise<WorktreeSession[]> {
  const liveEntries = listWorktrunkEntries(config, false);
  const storedSessions = loadStoredSessions(config);
  const merged = new Map<string, WorktreeSession>();

  for (const stored of storedSessions) {
    merged.set(stored.id, cloneWorktreeSession(stored));
  }

  for (const entry of liveEntries) {
    const branch = String(entry.branch || '').trim();
    if (!branch || entry.kind !== 'worktree') continue;

    const stored =
      storedSessions.find((session) => session.branch === branch && path.resolve(session.repoRoot) === path.resolve(config.repoRoot)) ||
      null;

    const live = buildSessionFromEntry(config, entry, stored);
    merged.set(live.id, live);
  }

  return [...merged.values()].filter((session) => matchesQuery(session, query));
}

async function removeSession(
  config: WorktreeProviderConfig,
  session: WorktreeSession,
  options?: WorktreeSessionRemoval,
): Promise<void> {
  const args = ['remove', '--yes', '--foreground'];

  if (options?.force) args.push('--force');
  if (options?.removeBranch === false) {
    args.push('--no-delete-branch');
  } else if (options?.removeBranch && options.force) {
    args.push('--force-delete');
  }

  args.push(session.branch);

  const result = runShell(resolveBinary(config), ['--config', ensureBaseConfig(config), ...args], config.repoRoot, true, config.env);
  if (result.status !== 0) {
    throw new Error(`Failed to remove Worktrunk session '${session.branch}': ${compactOutput(result)}`);
  }

  purgeStoredSessions(config, session.branch);
}

async function validateSession(
  config: WorktreeProviderConfig,
  session: WorktreeSession,
): Promise<WorktreeSessionValidation> {
  const entry = findBranchEntry(config, session.branch);
  const existsAtPath = existsSync(session.worktreePath);
  const info = resolveState(config, session.branch, entry, existsAtPath, session.worktreePath, session);
  const checkedAt = new Date().toISOString();

  const stored = readStoredSession(config, session.id);
  if (stored) {
    persistSession(
      config,
      cloneWorktreeSession(stored, {
        state: info.state,
        isResumable: info.isResumable,
        updatedAt: checkedAt,
        lastValidatedAt: checkedAt,
      }),
    );
  }

  return {
    sessionId: session.id,
    state: info.state,
    isResumable: info.isResumable,
    checkedAt,
    reason: info.reason,
    requiredAction: info.requiredAction,
  };
}

async function openPullRequestWorkspace(
  config: WorktreeProviderConfig,
  request: WorktreePullRequestWorkspaceRequest,
): Promise<WorktreeSession> {
  const ensured = await ensureSession(config, {
    repoRoot: request.repoRoot,
    branch: request.branch,
    baseBranch: request.baseBranch,
    changeId: request.changeId,
    sliceId: request.sliceId,
    runId: request.runId,
    purpose: 'pull_request',
    preferredPathSegment: `pr-${request.prNumber}`,
    reuseExisting: true,
  });

  const pullRequest: WorktreeSessionPullRequestRef = {
    number: request.prNumber,
    url: request.url,
    state: 'open',
  };

  const session = cloneWorktreeSession(ensured, {
    purpose: 'pull_request',
    pullRequest,
    updatedAt: new Date().toISOString(),
  });
  persistSession(config, session);
  return session;
}

function normalizeRequest(config: WorktreeProviderConfig, request: WorktreeSessionRequest): WorktreeSessionRequest {
  return {
    ...request,
    repoRoot: path.resolve(request.repoRoot || config.repoRoot),
    branch: String(request.branch || '').trim(),
    baseBranch: String(request.baseBranch || config.defaultBranch).trim() || config.defaultBranch,
    purpose: deriveWorktreeSessionPurpose(request),
    preferredPathSegment: request.preferredPathSegment
      ? deriveWorktreePathSegment(request)
      : request.sliceId
        ? deriveWorktreePathSegment(request)
        : request.changeId
          ? deriveWorktreePathSegment(request)
          : undefined,
  };
}

function buildSessionFromEntry(
  config: WorktreeProviderConfig,
  entry: WorktrunkListEntry,
  stored?: WorktreeSession | null,
): WorktreeSession {
  const branch = String(entry.branch || stored?.branch || '').trim();
  const worktreePath = path.resolve(entry.path || stored?.worktreePath || resolveFallbackPath(config, branch));
  const pathSegment = stored?.pathSegment || path.basename(worktreePath);
  const stateInfo = resolveState(config, branch, entry, existsSync(worktreePath), worktreePath, stored || undefined);

  return cloneWorktreeSession({
    id:
      stored?.id ||
      buildWorktreeSessionId(config.kind, config, {
        branch,
        preferredPathSegment: pathSegment,
        sliceId: stored?.sliceId,
        changeId: stored?.changeId,
        purpose: stored?.purpose,
      }),
    provider: config.kind,
    repoRoot: config.repoRoot,
    baseBranch: stored?.baseBranch || config.defaultBranch,
    branch,
    worktreePath,
    pathSegment,
    state: stateInfo.state,
    isResumable: stateInfo.isResumable,
    purpose: stored?.purpose || 'change',
    changeId: stored?.changeId,
    sliceId: stored?.sliceId,
    runId: stored?.runId,
    pullRequest: stored?.pullRequest,
    createdAt: stored?.createdAt || new Date(0).toISOString(),
    updatedAt: new Date().toISOString(),
    lastValidatedAt: stored?.lastValidatedAt,
  });
}

function resolveState(
  config: WorktreeProviderConfig,
  branch: string,
  entry: WorktrunkListEntry | null,
  existsAtPath: boolean,
  worktreePath: string,
  session?: Pick<WorktreeSession, 'baseBranch' | 'pullRequest'>,
): SessionStateInfo {
  if (!entry) {
    return {
      state: existsAtPath ? 'invalid' : 'missing',
      isResumable: false,
      requiredAction: existsAtPath ? 'manual_review' : 'create_session',
      reason: existsAtPath
        ? `No Worktrunk branch entry matches '${worktreePath}'.`
        : `No Worktrunk session exists at '${worktreePath}'.`,
    };
  }

  if (entry.kind !== 'worktree') {
    return {
      state: 'missing',
      isResumable: false,
      requiredAction: 'create_session',
      reason: `Branch '${entry.branch || ''}' exists without an attached worktree.`,
    };
  }

  if (!existsAtPath) {
    return {
      state: 'missing',
      isResumable: false,
      requiredAction: 'create_session',
      reason: `Worktree path '${worktreePath}' is missing on disk.`,
    };
  }

  const mainState = String(entry.main_state || '').trim();
  if (mainState === 'integrated' || mainState === 'same_commit' || mainState === 'trees_match') {
    return {
      state: 'integrated',
      isResumable: false,
      requiredAction: 'cleanup',
      reason: `Worktrunk marked '${entry.branch || ''}' as integrated${entry.integration_reason ? ` (${entry.integration_reason})` : ''}.`,
    };
  }
  if (mainState === 'diverged' || mainState === 'would_conflict') {
    return {
      state: 'stale',
      isResumable: false,
      requiredAction: 'create_fresh_session',
      reason: `Worktrunk marked '${entry.branch || ''}' as ${mainState}.`,
    };
  }
  if (entry.worktree?.detached) {
    return {
      state: 'invalid',
      isResumable: false,
      requiredAction: 'manual_review',
      reason: `Worktree '${worktreePath}' is detached.`,
    };
  }

  const trackedState = resolveTrackedBranchResumableState(config, {
    branch,
    baseBranch: session?.baseBranch || config.defaultBranch,
    pullRequest: session?.pullRequest,
  });
  if (trackedState) {
    return trackedState;
  }

  return {
    state: 'active',
    isResumable: true,
    requiredAction: 'resume',
  };
}

function matchesQuery(session: WorktreeSession, query?: WorktreeSessionQuery): boolean {
  if (!query) return true;
  if (query.repoRoot && path.resolve(query.repoRoot) !== path.resolve(session.repoRoot)) return false;
  if (query.branch && query.branch !== session.branch) return false;
  if (query.changeId && query.changeId !== session.changeId) return false;
  if (query.sliceId && query.sliceId !== session.sliceId) return false;
  if (query.runId && query.runId !== session.runId) return false;
  if (query.purpose && query.purpose !== session.purpose) return false;
  if (query.state && query.state !== 'any' && query.state !== session.state) return false;
  return true;
}

function findStoredSession(config: WorktreeProviderConfig, request: WorktreeSessionRequest): WorktreeSession | null {
  const exactId = buildWorktreeSessionId(config.kind, config, {
    branch: request.branch,
    preferredPathSegment: request.preferredPathSegment,
    sliceId: request.sliceId,
    changeId: request.changeId,
    purpose: request.purpose,
  });
  const exact = readStoredSession(config, exactId);
  if (exact) return exact;

  return (
    loadStoredSessions(config).find((session) => {
      if (session.branch !== request.branch) return false;
      if (request.changeId && session.changeId && request.changeId !== session.changeId) return false;
      if (request.sliceId && session.sliceId && request.sliceId !== session.sliceId) return false;
      if (request.runId && session.runId && request.runId !== session.runId) return false;
      if (request.purpose && session.purpose !== request.purpose) return false;
      return true;
    }) || null
  );
}

function findLiveSessionByBranch(config: WorktreeProviderConfig, branch: string): WorktreeSession | null {
  const entry = findBranchEntry(config, branch);
  if (!entry || entry.kind !== 'worktree') return null;
  const stored = loadStoredSessions(config).find((session) => session.branch === branch) || null;
  return buildSessionFromEntry(config, entry, stored);
}

function findBranchEntry(config: WorktreeProviderConfig, branch: string): WorktrunkListEntry | null {
  const entries = listWorktrunkEntries(config, true);
  return entries.find((entry) => String(entry.branch || '').trim() === branch) || null;
}

function listWorktrunkEntries(config: WorktreeProviderConfig, includeBranches: boolean): WorktrunkListEntry[] {
  const args = ['--config', ensureBaseConfig(config), 'list', '--format=json'];
  if (includeBranches) args.push('--branches');

  const result = runShell(resolveBinary(config), args, config.repoRoot, true, config.env);
  if (result.status !== 0) {
    throw new Error(`Failed to list Worktrunk sessions: ${compactOutput(result)}`);
  }
  return parseWorktrunkListOutput(result.stdout);
}

function gitBranchExists(repoRoot: string, branch: string): boolean {
  const local = runShell('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], repoRoot, true);
  if (local.status === 0) return true;

  const remote = runShell('git', ['ls-remote', '--exit-code', '--heads', 'origin', branch], repoRoot, true);
  return remote.status === 0;
}

function resolveBinary(config: WorktreeProviderConfig): string {
  return String(config.binaryPath || DEFAULT_BINARY).trim() || DEFAULT_BINARY;
}

function parseVersion(output: string): string | undefined {
  const match = String(output || '').match(/wt\s+([0-9]+\.[0-9]+\.[0-9]+)/);
  return match ? match[1] : undefined;
}

function compactOutput(result: { stdout: string; stderr: string }): string {
  return `${result.stderr || result.stdout}`.trim() || 'unknown worktrunk error';
}

function ensureBaseConfig(config: WorktreeProviderConfig): string {
  const paths = resolveWorktreeRuntimePaths(config);
  mkdirSync(paths.providerStateRoot, { recursive: true });
  const configPath = path.join(paths.providerStateRoot, 'worktrunk.config.toml');
  const content = [
    `worktree-path = ${tomlString(path.join(paths.repoWorktreesRoot, '{{ branch | sanitize }}'))}`,
    '',
    '[switch]',
    'no-cd = true',
    '',
  ].join('\n');
  writeIfChanged(configPath, content);
  return configPath;
}

function ensureSwitchConfig(config: WorktreeProviderConfig, worktreePath: string): string {
  const paths = resolveWorktreeRuntimePaths(config);
  mkdirSync(path.join(paths.providerStateRoot, 'switch-configs'), { recursive: true });
  const configPath = path.join(
    paths.providerStateRoot,
    'switch-configs',
    `${Buffer.from(path.resolve(worktreePath)).toString('base64url')}.toml`,
  );
  const content = [`worktree-path = ${tomlString(path.resolve(worktreePath))}`, '', '[switch]', 'no-cd = true', ''].join('\n');
  writeIfChanged(configPath, content);
  return configPath;
}

function writeIfChanged(filePath: string, content: string): void {
  const next = content.endsWith('\n') ? content : `${content}\n`;
  if (existsSync(filePath) && readFileSync(filePath, 'utf8') === next) return;
  writeFileSync(filePath, next, 'utf8');
}

function sessionRoot(config: WorktreeProviderConfig): string {
  const root = path.join(resolveWorktreeRuntimePaths(config).providerStateRoot, 'sessions');
  mkdirSync(root, { recursive: true });
  return root;
}

function sessionFilePath(config: WorktreeProviderConfig, sessionId: string): string {
  return path.join(sessionRoot(config), `${Buffer.from(sessionId).toString('base64url')}.json`);
}

function loadStoredSessions(config: WorktreeProviderConfig): WorktreeSession[] {
  const root = sessionRoot(config);
  return readdirSync(root)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => {
      try {
        const content = readFileSync(path.join(root, entry), 'utf8');
        return cloneWorktreeSession(JSON.parse(content) as WorktreeSession);
      } catch {
        return null;
      }
    })
    .filter((value): value is WorktreeSession => value !== null);
}

function readStoredSession(config: WorktreeProviderConfig, sessionId: string): WorktreeSession | null {
  const filePath = sessionFilePath(config, sessionId);
  if (!existsSync(filePath)) return null;
  try {
    return cloneWorktreeSession(JSON.parse(readFileSync(filePath, 'utf8')) as WorktreeSession);
  } catch {
    return null;
  }
}

function persistSession(config: WorktreeProviderConfig, session: WorktreeSession): void {
  writeFileSync(sessionFilePath(config, session.id), `${JSON.stringify(cloneWorktreeSession(session), null, 2)}\n`, 'utf8');
}

function purgeStoredSessions(config: WorktreeProviderConfig, branch: string): void {
  for (const session of loadStoredSessions(config)) {
    if (session.branch !== branch) continue;
    const filePath = sessionFilePath(config, session.id);
    if (existsSync(filePath)) {
      rmSync(filePath, { force: true });
    }
  }
}

function resolveFallbackPath(config: WorktreeProviderConfig, branch: string): string {
  return path.join(resolveWorktreeRuntimePaths(config).repoWorktreesRoot, sanitizeBranch(branch));
}

function sanitizeBranch(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/[\\/]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'worktree';
}

function tomlString(value: string): string {
  return `"${String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')}"`;
}
