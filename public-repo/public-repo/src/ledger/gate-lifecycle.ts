import type {
  CreateWorkGateOptions,
  ResolveWorkGateOptions,
  WorkChange,
  WorkChangeStatus,
  WorkGate,
  WorkGateDecision,
  WorkGateLifecycleResult,
  WorkGateStatus,
  WorkRun,
  WorkSpec,
  WorkSpecStatus,
  WorkSlice,
} from '../types/index.js';
import { requireChange, updateChange } from './change-store.js';
import { createGate, listGates, requireGate, updateGate } from './gate-store.js';
import { refreshLedger } from './status.js';
import { requireRun } from './run-store.js';
import { requireSlice } from './slice-store.js';
import { requireSpec, updateSpec } from './spec-store.js';

export function createWorkGate(projectId: string, options: CreateWorkGateOptions): WorkGateLifecycleResult {
  const change = requireChange(projectId, options.changeId);
  ensureGateableChange(change);

  const createdAt = resolveTimestamp(options.createdAt);
  const linked = resolveLinkedRecords(projectId, options);
  ensureValidGateScope(options, linked.spec, linked.slice, linked.run);
  // For spec_review: automatically cancel stale pending gates from prior spec versions
  // before the duplicate-gate check so the incoming version can take over cleanly.
  if (options.type === 'spec_review' && linked.spec) {
    cancelStaleSpecReviewGates(projectId, options.changeId, linked.spec.id, createdAt);
  }
  ensureNoPendingDuplicateGate(projectId, options, linked.spec, linked.slice, linked.run);

  const nextChange = transitionChangeStatus(change, nextChangeStatusForGateCreation(options.type), createdAt);
  const nextSpec = options.type === 'spec_review' && linked.spec
    ? transitionSpecStatus(linked.spec, 'review_ready', createdAt)
    : linked.spec;
  const gate = createGate({
    id: deriveNextGateId(projectId, options.type, linked.run?.id || linked.slice?.id || linked.spec?.id || change.id),
    projectId,
    changeId: change.id,
    type: options.type,
    status: 'pending',
    title: requireNonEmptyText(options.title, 'Gate title'),
    reason: requireNonEmptyText(options.reason, 'Gate reason'),
    ...(nextSpec?.id ? { specId: nextSpec.id } : {}),
    ...(linked.slice?.id ? { sliceId: linked.slice.id } : {}),
    ...(linked.run?.id ? { runId: linked.run.id } : {}),
    createdAt,
    updatedAt: createdAt,
  });
  const ledger = refreshLedger(projectId, { updatedAt: createdAt });

  return {
    projectId,
    change: nextChange,
    gate,
    ledger,
    ...(nextSpec ? { spec: nextSpec } : {}),
    ...(linked.slice ? { slice: linked.slice } : {}),
    ...(linked.run ? { run: linked.run } : {}),
  };
}

export function approveGate(projectId: string, gateId: string, options: ResolveWorkGateOptions = {}): WorkGateLifecycleResult {
  return resolveGate(projectId, gateId, 'approved', options);
}

export function rejectGate(projectId: string, gateId: string, options: ResolveWorkGateOptions = {}): WorkGateLifecycleResult {
  return resolveGate(projectId, gateId, 'rejected', options);
}

export function cancelGate(projectId: string, gateId: string, options: ResolveWorkGateOptions = {}): WorkGateLifecycleResult {
  return resolveGate(projectId, gateId, 'cancelled', options);
}

export function resolveGate(
  projectId: string,
  gateId: string,
  status: Extract<WorkGateStatus, 'approved' | 'rejected' | 'cancelled'>,
  options: ResolveWorkGateOptions = {},
): WorkGateLifecycleResult {
  const currentGate = requireGate(projectId, gateId);
  const change = requireChange(projectId, currentGate.changeId);
  const spec = currentGate.specId ? requireSpec(projectId, currentGate.specId) : undefined;
  const slice = currentGate.sliceId ? requireSlice(projectId, currentGate.sliceId) : undefined;
  const run = currentGate.runId ? requireRun(projectId, currentGate.runId) : undefined;
  const decidedAt = resolveTimestamp(options.decidedAt);
  const blockerId = `gate:${currentGate.id}`;
  const nextChange = resolveChangeForGate(change, currentGate, status, decidedAt, blockerId);
  const nextSpec = resolveSpecForGate(spec, currentGate, status, decidedAt);
  const gate = updateGate({
    ...currentGate,
    status,
    decision: buildDecision(options, decidedAt),
    updatedAt: decidedAt,
    resolvedAt: decidedAt,
  });
  const ledger = refreshLedger(projectId, { updatedAt: decidedAt });

  return {
    projectId,
    change: nextChange,
    gate,
    ledger,
    ...(nextSpec ? { spec: nextSpec } : {}),
    ...(slice ? { slice } : {}),
    ...(run ? { run } : {}),
  };
}

function resolveLinkedRecords(projectId: string, options: CreateWorkGateOptions): {
  spec?: WorkSpec;
  slice?: WorkSlice;
  run?: WorkRun;
} {
  const run = options.runId ? requireRun(projectId, options.runId) : undefined;
  const slice = options.sliceId ? requireSlice(projectId, options.sliceId) : run ? requireSlice(projectId, run.sliceId) : undefined;
  const spec = options.specId ? requireSpec(projectId, options.specId) : slice ? requireSpec(projectId, slice.specId) : run ? requireSpec(projectId, run.specId) : undefined;

  if (run && run.changeId !== options.changeId) {
    throw new Error(`Run '${run.id}' does not belong to change '${options.changeId}'.`);
  }
  if (slice && slice.changeId !== options.changeId) {
    throw new Error(`Slice '${slice.id}' does not belong to change '${options.changeId}'.`);
  }
  if (spec && spec.changeId !== options.changeId) {
    throw new Error(`Spec '${spec.id}' does not belong to change '${options.changeId}'.`);
  }
  if (run && slice && run.sliceId !== slice.id) {
    throw new Error(`Run '${run.id}' does not belong to slice '${slice.id}'.`);
  }
  if (run && spec && run.specId !== spec.id) {
    throw new Error(`Run '${run.id}' does not belong to spec '${spec.id}'.`);
  }
  if (slice && spec && slice.specId !== spec.id) {
    throw new Error(`Slice '${slice.id}' does not belong to spec '${spec.id}'.`);
  }

  return { spec, slice, run };
}

function ensureValidGateScope(
  options: CreateWorkGateOptions,
  spec?: WorkSpec,
  slice?: WorkSlice,
  run?: WorkRun,
): void {
  if (options.type === 'spec_review') {
    if (!spec) {
      throw new Error('Spec review gates require a linked spec.');
    }
    if (spec.status === 'approved' || spec.status === 'superseded' || spec.status === 'archived') {
      throw new Error(`Spec '${spec.id}' cannot enter review from status '${spec.status}'.`);
    }
  }

  if (options.type === 'execution_review' && !slice) {
    throw new Error('Execution review gates require a linked slice.');
  }

  if (options.type === 'delivery_review' && !run) {
    throw new Error('Delivery review gates require a linked run.');
  }
}

function ensureGateableChange(change: WorkChange): void {
  if (change.status === 'done' || change.status === 'archived') {
    throw new Error(`Change '${change.id}' cannot open a gate from status '${change.status}'.`);
  }
}

function cancelStaleSpecReviewGates(
  projectId: string,
  changeId: string,
  incomingSpecId: string,
  decidedAt: string,
): void {
  const stale = listGates(projectId).filter(
    (gate) =>
      gate.status === 'pending' &&
      gate.changeId === changeId &&
      gate.type === 'spec_review' &&
      gate.specId !== incomingSpecId,
  );
  for (const gate of stale) {
    // Use the full cancelGate path so spec and change statuses are also unwound.
    cancelGate(projectId, gate.id, { decidedAt });
  }
}

function ensureNoPendingDuplicateGate(
  projectId: string,
  options: CreateWorkGateOptions,
  spec?: WorkSpec,
  slice?: WorkSlice,
  run?: WorkRun,
): void {
  const duplicate = listGates(projectId).find(
    (gate) =>
      gate.status === 'pending' &&
      gate.changeId === options.changeId &&
      gate.type === options.type &&
      (gate.specId || '') === (spec?.id || '') &&
      (gate.sliceId || '') === (slice?.id || '') &&
      (gate.runId || '') === (run?.id || ''),
  );

  if (duplicate) {
    throw new Error(
      `A pending ${options.type} gate already exists for change '${options.changeId}' as gate '${duplicate.id}'.`,
    );
  }
}

function resolveChangeForGate(
  change: WorkChange,
  gate: WorkGate,
  status: Extract<WorkGateStatus, 'approved' | 'rejected' | 'cancelled'>,
  updatedAt: string,
  blockerId: string,
): WorkChange {
  const targetStatus = gate.type === 'final_review' && status === 'approved'
    ? 'done'
    : status === 'rejected'
      ? 'blocked'
      : 'active';

  return transitionChangeStatus(change, targetStatus, updatedAt, blockerId, status === 'rejected');
}

function resolveSpecForGate(
  spec: WorkSpec | undefined,
  gate: WorkGate,
  status: Extract<WorkGateStatus, 'approved' | 'rejected' | 'cancelled'>,
  updatedAt: string,
): WorkSpec | undefined {
  if (!spec || gate.type !== 'spec_review') {
    return spec;
  }

  if (status === 'approved') {
    return transitionSpecStatus(spec, 'approved', updatedAt);
  }

  return transitionSpecStatus(spec, 'active', updatedAt);
}

function nextChangeStatusForGateCreation(type: WorkGate['type']): WorkChangeStatus {
  switch (type) {
    case 'spec_review':
    case 'execution_review':
    case 'delivery_review':
    case 'final_review':
      return 'in_review';
  }
}

function transitionChangeStatus(
  change: WorkChange,
  targetStatus: WorkChangeStatus,
  updatedAt: string,
  blockerId?: string,
  addBlocker = false,
): WorkChange {
  const mutableStatuses: WorkChangeStatus[] = ['draft', 'active', 'blocked', 'in_review'];
  if (!mutableStatuses.includes(change.status) && change.status !== targetStatus) {
    return change;
  }

  let next = change;
  const steps: WorkChangeStatus[] = [];
  if (
    (targetStatus === 'active' || targetStatus === 'blocked' || targetStatus === 'in_review' || targetStatus === 'done') &&
    (change.status === 'draft' || change.status === 'blocked' || change.status === 'in_review')
  ) {
    steps.push('active');
  }

  if (targetStatus === 'in_review') {
    steps.push('in_review');
  } else if (targetStatus === 'blocked') {
    steps.push('blocked');
  } else if (targetStatus === 'done') {
    if (steps.at(-1) !== 'in_review') {
      steps.push('in_review');
    }
    steps.push('done');
  }

  for (const status of steps) {
    if (next.status === status) {
      continue;
    }

    next = updateChange({
      ...next,
      status,
      blockerIds: reconcileBlockerIds(next.blockerIds, blockerId, status === 'blocked' && addBlocker),
      updatedAt: resolveLatestTimestamp(next.updatedAt, updatedAt),
      ...(status === 'done' ? { completedAt: updatedAt } : {}),
    });
  }

  const blockerIds = reconcileBlockerIds(next.blockerIds, blockerId, targetStatus === 'blocked' && addBlocker);
  if (blockerIds.join('\n') !== next.blockerIds.join('\n')) {
    next = updateChange({
      ...next,
      blockerIds,
      updatedAt: resolveLatestTimestamp(next.updatedAt, updatedAt),
    });
  }

  return next;
}

function transitionSpecStatus(spec: WorkSpec, targetStatus: WorkSpecStatus, updatedAt: string): WorkSpec {
  const mutableStatuses: WorkSpecStatus[] = ['draft', 'active', 'review_ready', 'approved'];
  if (!mutableStatuses.includes(spec.status) || spec.status === targetStatus) {
    return spec;
  }

  let next = spec;
  const steps: WorkSpecStatus[] = [];

  if (
    (targetStatus === 'active' || targetStatus === 'review_ready' || targetStatus === 'approved') &&
    (spec.status === 'draft' || spec.status === 'review_ready')
  ) {
    steps.push('active');
  }

  if (targetStatus === 'review_ready' || targetStatus === 'approved') {
    steps.push('review_ready');
  }

  if (targetStatus === 'approved') {
    steps.push('approved');
  }

  for (const status of steps) {
    if (next.status === status) {
      continue;
    }

    next = updateSpec({
      ...next,
      status,
      updatedAt: resolveLatestTimestamp(next.updatedAt, updatedAt),
      ...(status === 'approved' ? { approvedAt: updatedAt } : {}),
    });
  }

  return next;
}

function deriveNextGateId(projectId: string, type: WorkGate['type'], scopeId: string): string {
  const normalizedType = normalizeIdentifierSegment(type);
  const normalizedScope = normalizeIdentifierSegment(scopeId);
  const prefix = `gate-${normalizedType}-${normalizedScope}-`;
  const existingIds = new Set(listGates(projectId).map((gate) => gate.id));

  let attempt = 1;
  while (existingIds.has(`${prefix}${String(attempt).padStart(2, '0')}`)) {
    attempt += 1;
  }

  return `${prefix}${String(attempt).padStart(2, '0')}`;
}

function buildDecision(options: ResolveWorkGateOptions, decidedAt: string): WorkGateDecision {
  const actor = normalizeOptional(options.actor);
  const note = normalizeOptional(options.note);

  return {
    decidedAt,
    ...(actor ? { actor } : {}),
    ...(note ? { note } : {}),
  };
}

function reconcileBlockerIds(blockerIds: string[], blockerId?: string, includeBlocker = false): string[] {
  const next = blockerIds.filter((value) => !value.startsWith('gate:'));
  if (blockerId && includeBlocker) {
    next.push(blockerId);
  }
  return next;
}

function requireNonEmptyText(value: string, label: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${label} must be non-empty.`);
  }
  return normalized;
}

function normalizeIdentifierSegment(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeOptional(value: string | undefined): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function resolveTimestamp(value: string | undefined): string {
  const normalized = String(value || '').trim();
  return normalized || new Date().toISOString();
}

function resolveLatestTimestamp(...values: Array<string | undefined>): string {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort()
    .at(-1) || new Date().toISOString();
}
