import { homedir } from 'node:os';
import path from 'node:path';
import type {
  WorktreeProvider,
  WorktreeProviderCapability,
  WorktreeProviderConfig,
  WorktreeProviderKind,
  WorktreeRuntimePaths,
  WorktreeSessionState,
  WorktreeSession,
  WorktreeSessionPurpose,
  WorktreeSessionRequest,
  WorktreeValidationAction,
} from '../types/index.js';
import { runShell } from './shell.js';

export type WorktreeProviderFactory = (config: WorktreeProviderConfig) => WorktreeProvider;
export type WorktreeProviderRegistry = Partial<Record<WorktreeProviderKind, WorktreeProviderFactory>>;

export function normalizeWorktreeProviderConfig(config: WorktreeProviderConfig): WorktreeProviderConfig {
  const repoRoot = resolvePathWithHome(config.repoRoot);
  const controlRoot = resolveLocalS2SControlRoot(config.controlRoot);
  const worktreesRoot = resolveLocalS2SWorktreesRoot({
    controlRoot,
    worktreesRoot: config.worktreesRoot,
  });

  return {
    ...config,
    repoRoot,
    controlRoot,
    worktreesRoot,
    repoSlug: normalizeSegment(config.repoSlug || path.basename(repoRoot)),
    defaultBranch: normalizeBranch(config.defaultBranch || 'main'),
    capabilities: Array.from(
      new Set(
        (config.capabilities || []).map((capability) => String(capability || '').trim()).filter(Boolean),
      ),
    ) as WorktreeProviderCapability[],
  };
}

export function resolveWorktreeRuntimePaths(config: WorktreeProviderConfig): WorktreeRuntimePaths {
  const normalized = normalizeWorktreeProviderConfig(config);
  const repoSlug = normalized.repoSlug || normalizeSegment(path.basename(normalized.repoRoot));
  const controlRoot = normalized.controlRoot || resolveLocalS2SControlRoot();
  const worktreesRoot = normalized.worktreesRoot || resolveLocalS2SWorktreesRoot({ controlRoot });
  const runtimeRoot = resolveLocalS2SRuntimeRoot(controlRoot);

  return {
    repoRoot: normalized.repoRoot,
    repoSlug,
    controlRoot,
    runtimeRoot,
    worktreesRoot,
    repoWorktreesRoot: resolveLocalS2SRepoWorktreesRoot({
      controlRoot,
      worktreesRoot,
      repoRoot: normalized.repoRoot,
      repoSlug,
    }),
    providerStateRoot: resolveWorktreeProviderStateRoot({
      kind: normalized.kind,
      controlRoot,
      repoSlug,
    }),
  };
}

export function deriveWorktreeSessionPurpose(request: WorktreeSessionRequest): WorktreeSessionPurpose {
  const normalized = String(request.purpose || '').trim().toLowerCase();
  if (normalized === 'pull_request') return 'pull_request';
  return 'change';
}

export function deriveWorktreePathSegment(request: WorktreeSessionRequest): string {
  if (request.preferredPathSegment) {
    return normalizeSegment(request.preferredPathSegment);
  }
  if (request.sliceId) {
    return normalizeSegment(request.sliceId);
  }
  if (request.changeId) {
    return normalizeSegment(request.changeId);
  }
  return normalizeSegment(request.branch || 'worktree');
}

export function resolveWorktreeSessionPath(config: WorktreeProviderConfig, request: WorktreeSessionRequest): string {
  const paths = resolveWorktreeRuntimePaths(config);
  return path.join(paths.repoWorktreesRoot, deriveWorktreePathSegment(request));
}

export function buildWorktreeSessionId(
  providerKind: WorktreeProviderKind,
  config: Pick<WorktreeProviderConfig, 'repoRoot' | 'repoSlug'>,
  request: Pick<WorktreeSessionRequest, 'branch' | 'preferredPathSegment' | 'sliceId' | 'changeId' | 'purpose'>,
): string {
  const repoSlug = normalizeSegment(config.repoSlug || path.basename(config.repoRoot));
  const pathSegment = deriveWorktreePathSegment({
    repoRoot: config.repoRoot,
    branch: request.branch,
    preferredPathSegment: request.preferredPathSegment,
    sliceId: request.sliceId,
    changeId: request.changeId,
    purpose: request.purpose,
  });
  const branch = normalizeSegment(request.branch || 'branch');

  return [providerKind, repoSlug, pathSegment, branch].map(normalizeSegment).join(':');
}

export function providerSupportsCapability(
  provider: Pick<WorktreeProvider, 'config' | 'getCapabilities'> | Pick<WorktreeProviderConfig, 'capabilities'>,
  capability: WorktreeProviderCapability,
): boolean {
  const declared =
    'getCapabilities' in provider ? provider.getCapabilities() : Array.isArray(provider.capabilities) ? provider.capabilities : [];
  return declared.includes(capability);
}

export function createWorktreeProvider(
  config: WorktreeProviderConfig,
  registry: WorktreeProviderRegistry,
): WorktreeProvider {
  const normalized = normalizeWorktreeProviderConfig(config);
  const factory = registry[normalized.kind];
  if (!factory) {
    throw new Error(`Worktree provider '${normalized.kind}' is not registered.`);
  }
  return factory(normalized);
}

export function expandHomePath(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed[0] !== '~') return trimmed;
  if (trimmed === '~') return resolveUserHomePath();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(resolveUserHomePath(), trimmed.slice(2));
  }
  return trimmed;
}

export function resolveLocalS2SControlRoot(controlRoot?: string): string {
  const raw = String(controlRoot || '').trim();
  return resolvePathWithHome(raw || path.join('~', '.s2s'));
}

export function resolveLocalS2SRuntimeRoot(controlRoot?: string): string {
  return path.join(resolveLocalS2SControlRoot(controlRoot), 'runtime');
}

export function resolveLocalS2SWorktreesRoot(input: {
  controlRoot?: string;
  worktreesRoot?: string;
} = {}): string {
  const raw = String(input.worktreesRoot || '').trim();
  if (raw) return resolvePathWithHome(raw);
  return path.join(resolveLocalS2SControlRoot(input.controlRoot), 'worktrees');
}

export function resolveLocalS2SRepoWorktreesRoot(input: {
  repoRoot: string;
  repoSlug?: string;
  controlRoot?: string;
  worktreesRoot?: string;
}): string {
  const repoSlug = normalizeSegment(input.repoSlug || path.basename(resolvePathWithHome(input.repoRoot)));
  return path.join(
    resolveLocalS2SWorktreesRoot({
      controlRoot: input.controlRoot,
      worktreesRoot: input.worktreesRoot,
    }),
    repoSlug,
  );
}

export function resolveWorktreeProviderStateRoot(input: {
  kind: WorktreeProviderKind;
  controlRoot?: string;
  repoSlug: string;
}): string {
  return path.join(resolveLocalS2SRuntimeRoot(input.controlRoot), 'worktree-provider', input.kind, normalizeSegment(input.repoSlug));
}

export function cloneWorktreeSession(
  session: WorktreeSession,
  overrides: Partial<WorktreeSession> = {},
): WorktreeSession {
  const next = { ...session, ...overrides };
  return {
    ...next,
    repoRoot: path.resolve(next.repoRoot),
    worktreePath: path.resolve(next.worktreePath),
    baseBranch: normalizeBranch(next.baseBranch),
    branch: normalizeBranch(next.branch),
    pathSegment: normalizeSegment(next.pathSegment),
    purpose: next.purpose === 'pull_request' ? 'pull_request' : 'change',
    isResumable: Boolean(next.isResumable),
  };
}

export interface ResolvedWorktreeResumableState {
  state: WorktreeSessionState;
  isResumable: boolean;
  requiredAction: WorktreeValidationAction;
  reason: string;
}

export function resolveTrackedBranchResumableState(
  config: Pick<WorktreeProviderConfig, 'repoRoot' | 'defaultBranch'>,
  session: Pick<WorktreeSession, 'branch' | 'baseBranch' | 'pullRequest'>,
): ResolvedWorktreeResumableState | null {
  const branch = normalizeBranchRef(session.branch);
  const baseBranch = normalizeBranchRef(session.baseBranch || config.defaultBranch) || normalizeBranch(config.defaultBranch);
  const pullRequestState = session.pullRequest?.state;

  if (!branch) {
    return {
      state: 'invalid',
      isResumable: false,
      requiredAction: 'manual_review',
      reason: 'Worktree branch cannot be resolved.',
    };
  }

  if (pullRequestState === 'closed' || pullRequestState === 'merged') {
    return {
      state: 'integrated',
      isResumable: false,
      requiredAction: 'create_fresh_branch',
      reason: `Pull request for branch '${branch}' is already ${pullRequestState}.`,
    };
  }

  if (branch === baseBranch) {
    return null;
  }

  if (!gitRefExists(config.repoRoot, branch)) {
    return {
      state: 'invalid',
      isResumable: false,
      requiredAction: 'create_fresh_session',
      reason: `Branch '${branch}' no longer exists in the repository.`,
    };
  }

  if (!gitRefExists(config.repoRoot, baseBranch)) {
    return {
      state: 'invalid',
      isResumable: false,
      requiredAction: 'manual_review',
      reason: `Base branch '${baseBranch}' cannot be resolved.`,
    };
  }

  const relation = runShell('git', ['rev-list', '--left-right', '--count', `${baseBranch}...${branch}`], config.repoRoot, true);
  if (relation.status !== 0) {
    return {
      state: 'invalid',
      isResumable: false,
      requiredAction: 'manual_review',
      reason: `Failed to compare branch '${branch}' against '${baseBranch}'.`,
    };
  }

  const [behindRaw, aheadRaw] = relation.stdout.trim().split(/\s+/);
  const behind = Number.parseInt(behindRaw || '0', 10);
  const ahead = Number.parseInt(aheadRaw || '0', 10);
  if (!Number.isFinite(behind) || !Number.isFinite(ahead)) {
    return {
      state: 'invalid',
      isResumable: false,
      requiredAction: 'manual_review',
      reason: `Could not parse branch relation for '${branch}' against '${baseBranch}'.`,
    };
  }

  if (ahead === 0 && behind === 0) {
    if (branchHasRecordedProgress(config.repoRoot, branch)) {
      return {
        state: 'integrated',
        isResumable: false,
        requiredAction: 'cleanup',
        reason: `Branch '${branch}' now matches '${baseBranch}'.`,
      };
    }
    return null;
  }

  if (ahead === 0) {
    return {
      state: 'integrated',
      isResumable: false,
      requiredAction: 'cleanup',
      reason: `Branch '${branch}' no longer adds changes beyond '${baseBranch}'.`,
    };
  }

  if (behind > 0) {
    return {
      state: 'stale',
      isResumable: false,
      requiredAction: 'create_fresh_session',
      reason: `Branch '${branch}' has diverged from '${baseBranch}' (${ahead} ahead, ${behind} behind).`,
    };
  }

  return null;
}

function normalizeBranch(value: string): string {
  return normalizeBranchRef(value) || 'main';
}

function normalizeBranchRef(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^\/+|\/+$/g, '');
}

function gitRefExists(repoRoot: string, branch: string): boolean {
  return runShell('git', ['rev-parse', '--verify', branch], repoRoot, true).status === 0;
}

function branchHasRecordedProgress(repoRoot: string, branch: string): boolean {
  const reflog = runShell('git', ['reflog', 'show', '--format=%H', branch], repoRoot, true);
  if (reflog.status !== 0) return false;

  const unique = new Set(
    reflog.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
  );

  return unique.size > 1;
}

function normalizeSegment(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || 'worktree';
}

function resolveUserHomePath(): string {
  return path.resolve(process.env.HOME || homedir());
}

function resolvePathWithHome(value: string): string {
  return path.resolve(expandHomePath(value));
}
