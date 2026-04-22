import type {
  CreateExecutionRunOptions,
  UpdateExecutionRunOptions,
  WorkRun,
  WorkRunEvidence,
  WorkRunLifecycleResult,
  WorkRunStatus,
  WorkSlice,
  WorkSliceStatus,
} from '../types/index.js';
import { createRun, listRuns, requireRun, updateRun } from './run-store.js';
import { refreshLedger } from './status.js';
import { requireSlice, updateSlice } from './slice-store.js';

const OPEN_RUN_STATUSES = new Set<WorkRunStatus>(['created', 'running', 'verifying', 'blocked']);
const TERMINAL_RUN_STATUSES = new Set<WorkRunStatus>(['succeeded', 'failed', 'cancelled']);
const CLOSING_RUN_STATUSES = new Set<WorkRunStatus>(['blocked', 'succeeded', 'failed', 'cancelled']);
const EXECUTABLE_SLICE_STATUSES = new Set<WorkSliceStatus>(['queued', 'ready', 'in_progress', 'blocked']);

export function derivePersistedRunId(sliceId: string, attempt: number): string {
  const normalizedSliceId = normalizeIdentifierSegment(sliceId);
  if (!normalizedSliceId) {
    throw new Error('Persisted run IDs require a non-empty slice ID.');
  }

  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error(`Persisted run IDs require an attempt number >= 1. Received '${attempt}'.`);
  }

  return `run-${normalizedSliceId}-${String(attempt).padStart(2, '0')}`;
}

export function createExecutionRun(
  projectId: string,
  sliceId: string,
  options: CreateExecutionRunOptions,
): WorkRunLifecycleResult {
  const slice = requireSlice(projectId, sliceId);
  ensureExecutableSlice(slice);

  const provider = normalizeText(options.provider);
  if (!provider) {
    throw new Error('Execution runs require a non-empty provider.');
  }

  const existingOpenRun = listRuns(projectId).find((run) => run.sliceId === slice.id && OPEN_RUN_STATUSES.has(run.status));
  if (existingOpenRun) {
    throw new Error(`Slice '${slice.id}' already has an open run '${existingOpenRun.id}'.`);
  }

  const createdAt = resolveTimestamp(options.createdAt);
  const runId = deriveNextRunId(projectId, slice.id);
  const run: WorkRun = {
    id: runId,
    projectId,
    changeId: slice.changeId,
    specId: slice.specId,
    sliceId: slice.id,
    status: 'created',
    provider,
    evidence: mergeEvidence([], options.evidence || []),
    createdAt,
    updatedAt: createdAt,
    ...(options.branchName ? { branchName: normalizeText(options.branchName) } : {}),
    ...(options.worktreePath ? { worktreePath: normalizeText(options.worktreePath) } : {}),
    ...(options.worktreeSessionId ? { worktreeSessionId: normalizeText(options.worktreeSessionId) } : {}),
    ...(options.resultSummary ? { resultSummary: normalizeText(options.resultSummary) } : {}),
  };

  const createdRun = createRun(run);
  const ledger = refreshLedger(projectId, { updatedAt: createdAt });

  return {
    projectId,
    slice,
    run: createdRun,
    ledger,
  };
}

export function startExecutionRun(projectId: string, runId: string, options: UpdateExecutionRunOptions = {}): WorkRunLifecycleResult {
  return updateExecutionRunState(projectId, runId, 'running', options);
}

export function markExecutionRunVerifying(
  projectId: string,
  runId: string,
  options: UpdateExecutionRunOptions = {},
): WorkRunLifecycleResult {
  return updateExecutionRunState(projectId, runId, 'verifying', options);
}

export function completeExecutionRun(
  projectId: string,
  runId: string,
  status: Extract<WorkRunStatus, 'blocked' | 'succeeded' | 'failed' | 'cancelled'>,
  options: UpdateExecutionRunOptions = {},
): WorkRunLifecycleResult {
  return updateExecutionRunState(projectId, runId, status, options);
}

function updateExecutionRunState(
  projectId: string,
  runId: string,
  nextStatus: Exclude<WorkRunStatus, 'created'>,
  options: UpdateExecutionRunOptions,
): WorkRunLifecycleResult {
  const currentRun = requireRun(projectId, runId);
  const updatedAt = resolveTimestamp(options.updatedAt);
  const nextRun: WorkRun = {
    ...currentRun,
    status: nextStatus,
    updatedAt,
    evidence: mergeEvidence(currentRun.evidence, options.evidence || []),
  };

  if (nextStatus === 'running') {
    nextRun.startedAt = normalizeText(options.startedAt) || currentRun.startedAt || updatedAt;
  }

  if (TERMINAL_RUN_STATUSES.has(nextStatus)) {
    nextRun.finishedAt = normalizeText(options.finishedAt) || currentRun.finishedAt || updatedAt;
  }

  if (options.branchName !== undefined) {
    nextRun.branchName = normalizeOptional(options.branchName);
  }
  if (options.worktreePath !== undefined) {
    nextRun.worktreePath = normalizeOptional(options.worktreePath);
  }
  if (options.worktreeSessionId !== undefined) {
    nextRun.worktreeSessionId = normalizeOptional(options.worktreeSessionId);
  }
  if (options.pullRequestNumber !== undefined) {
    nextRun.pullRequestNumber = options.pullRequestNumber;
  }
  if (options.pullRequestUrl !== undefined) {
    nextRun.pullRequestUrl = normalizeOptional(options.pullRequestUrl);
  }
  if (options.reusedPullRequest !== undefined) {
    nextRun.reusedPullRequest = options.reusedPullRequest;
  }
  if (options.requiredFreshBranch !== undefined) {
    nextRun.requiredFreshBranch = options.requiredFreshBranch;
  }
  if (options.resultSummary !== undefined) {
    nextRun.resultSummary = normalizeOptional(options.resultSummary);
  }
  if (options.verificationPassed !== undefined) {
    nextRun.verificationPassed = options.verificationPassed;
  } else if (nextStatus === 'succeeded' && nextRun.verificationPassed === undefined) {
    nextRun.verificationPassed = true;
  } else if (nextStatus === 'failed' && nextRun.verificationPassed === undefined) {
    nextRun.verificationPassed = false;
  }

  const run = updateRun(nextRun);
  const slice = reconcileSliceForRunStatus(requireSlice(projectId, run.sliceId), nextStatus, updatedAt);
  const ledger = refreshLedger(projectId, { updatedAt });

  return {
    projectId,
    slice,
    run,
    ledger,
  };
}

function reconcileSliceForRunStatus(slice: WorkSlice, status: Exclude<WorkRunStatus, 'created'>, updatedAt: string): WorkSlice {
  if (status === 'running' || status === 'verifying') {
    return ensureSliceInProgress(slice, updatedAt);
  }

  if (status === 'succeeded') {
    return ensureSliceDone(slice, updatedAt);
  }

  if (CLOSING_RUN_STATUSES.has(status)) {
    return ensureSliceBlocked(slice, updatedAt);
  }

  return slice;
}

function ensureSliceInProgress(slice: WorkSlice, updatedAt: string): WorkSlice {
  if (slice.status === 'in_progress') {
    return slice;
  }

  if (slice.status === 'blocked') {
    const reopened = updateSlice({
      ...slice,
      status: 'ready',
      updatedAt,
    });
    return updateSlice({
      ...reopened,
      status: 'in_progress',
      updatedAt,
    });
  }

  if (slice.status === 'ready' || slice.status === 'queued') {
    return updateSlice({
      ...slice,
      status: 'in_progress',
      updatedAt,
    });
  }

  throw new Error(`Slice '${slice.id}' cannot enter execution from status '${slice.status}'.`);
}

function ensureSliceDone(slice: WorkSlice, updatedAt: string): WorkSlice {
  if (slice.status === 'done') {
    return slice;
  }

  const inProgress = ensureSliceInProgress(slice, updatedAt);
  return updateSlice({
    ...inProgress,
    status: 'done',
    updatedAt,
    completedAt: inProgress.completedAt || updatedAt,
  });
}

function ensureSliceBlocked(slice: WorkSlice, updatedAt: string): WorkSlice {
  if (slice.status === 'blocked') {
    return slice;
  }

  if (slice.status === 'ready' || slice.status === 'queued' || slice.status === 'in_progress') {
    return updateSlice({
      ...slice,
      status: 'blocked',
      updatedAt,
    });
  }

  if (slice.status === 'done') {
    return slice;
  }

  throw new Error(`Slice '${slice.id}' cannot be marked blocked from status '${slice.status}'.`);
}

function ensureExecutableSlice(slice: WorkSlice): void {
  if (!EXECUTABLE_SLICE_STATUSES.has(slice.status)) {
    throw new Error(`Slice '${slice.id}' is not executable from status '${slice.status}'.`);
  }
}

function deriveNextRunId(projectId: string, sliceId: string): string {
  const relatedRuns = listRuns(projectId).filter((run) => run.sliceId === sliceId);
  const normalizedSliceId = normalizeIdentifierSegment(sliceId);
  const usedIds = new Set(relatedRuns.map((run) => run.id));
  const pattern = new RegExp(`^run-${escapeRegex(normalizedSliceId)}-(\\d+)$`);

  let attempt = 1;
  for (const run of relatedRuns) {
    const match = run.id.match(pattern);
    if (!match) {
      continue;
    }
    attempt = Math.max(attempt, Number(match[1]) + 1);
  }

  let candidate = derivePersistedRunId(sliceId, attempt);
  while (usedIds.has(candidate)) {
    attempt += 1;
    candidate = derivePersistedRunId(sliceId, attempt);
  }

  return candidate;
}

function mergeEvidence(existing: readonly WorkRunEvidence[], additions: readonly WorkRunEvidence[]): WorkRunEvidence[] {
  const merged = [...existing, ...additions].map(normalizeEvidence).filter((evidence) => evidence !== null);
  const seen = new Set<string>();
  const result: WorkRunEvidence[] = [];

  for (const evidence of merged) {
    const key = JSON.stringify(evidence);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(evidence);
  }

  return result;
}

function normalizeEvidence(evidence: WorkRunEvidence): WorkRunEvidence | null {
  const kind = normalizeText(evidence.kind);
  const path = normalizeOptional(evidence.path);
  const url = normalizeOptional(evidence.url);
  const summary = normalizeOptional(evidence.summary);

  if (!kind || (!path && !url && !summary)) {
    return null;
  }

  return {
    kind: kind as WorkRunEvidence['kind'],
    ...(path ? { path } : {}),
    ...(url ? { url } : {}),
    ...(summary ? { summary } : {}),
  };
}

function resolveTimestamp(value?: string): string {
  return normalizeText(value) || new Date().toISOString();
}

function normalizeOptional(value?: string): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function normalizeText(value?: string): string {
  return String(value || '').trim();
}

function normalizeIdentifierSegment(value: string): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
