import type {
  OrchestrationDecisionRecord,
  PipelineStage,
  WorkChange,
  WorkChangeStatus,
  WorkGate,
  WorkIntent,
  WorkLedger,
  WorkRun,
  WorkRunStatus,
  WorkSlice,
  WorkSliceStatus,
  WorkSpec,
} from '../types/index.js';
import { listChanges } from './change-store.js';
import { listGates } from './gate-store.js';
import { createLedger, getLedger, ledgerExists, updateLedger } from './ledger-store.js';
import { listRuns } from './run-store.js';
import { listSlices } from './slice-store.js';
import { listSpecs } from './spec-store.js';

export interface LedgerAggregationOptions {
  lastIntent?: WorkIntent;
  lastDecision?: OrchestrationDecisionRecord;
  effectiveRoute?: PipelineStage[];
  effectiveApprovalRequired?: boolean;
  updatedAt?: string;
}

type LedgerEntities = {
  changes: WorkChange[];
  specs: WorkSpec[];
  slices: WorkSlice[];
  runs: WorkRun[];
  gates: WorkGate[];
};

const activeChangeStatusWeight: Record<WorkChangeStatus, number> = {
  draft: 1,
  active: 2,
  blocked: 2,
  in_review: 2,
  done: 0,
  archived: 0,
};

function compareIsoAsc(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function compareChangeOrder(left: WorkChange, right: WorkChange): number {
  return (
    compareIsoAsc(left.createdAt, right.createdAt) ||
    compareIsoAsc(left.updatedAt, right.updatedAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareSpecOrder(left: WorkSpec, right: WorkSpec): number {
  return right.version - left.version || compareIsoDesc(left.updatedAt, right.updatedAt) || left.id.localeCompare(right.id);
}

function compareSliceOrder(left: WorkSlice, right: WorkSlice): number {
  return left.sequence - right.sequence || compareIsoAsc(left.createdAt, right.createdAt) || left.id.localeCompare(right.id);
}

function compareRunOrder(left: WorkRun, right: WorkRun): number {
  return compareIsoAsc(left.createdAt, right.createdAt) || compareIsoAsc(left.updatedAt, right.updatedAt) || left.id.localeCompare(right.id);
}

function compareGateOrder(left: WorkGate, right: WorkGate): number {
  return compareIsoAsc(left.createdAt, right.createdAt) || compareIsoAsc(left.updatedAt, right.updatedAt) || left.id.localeCompare(right.id);
}

function loadLedgerEntities(projectId: string): LedgerEntities {
  return {
    changes: [...listChanges(projectId)].sort(compareChangeOrder),
    specs: [...listSpecs(projectId)].sort(compareSpecOrder),
    slices: [...listSlices(projectId)].sort(compareSliceOrder),
    runs: [...listRuns(projectId)].sort(compareRunOrder),
    gates: [...listGates(projectId)].sort(compareGateOrder),
  };
}

function isOpenChange(change: WorkChange): boolean {
  return activeChangeStatusWeight[change.status] > 0;
}

function isOpenSpec(spec: WorkSpec): boolean {
  return spec.status !== 'superseded' && spec.status !== 'archived';
}

function resolveOptionValue<K extends keyof LedgerAggregationOptions>(
  options: LedgerAggregationOptions,
  existing: WorkLedger | null,
  key: K,
): LedgerAggregationOptions[K] | undefined {
  if (Object.prototype.hasOwnProperty.call(options, key)) {
    return options[key];
  }

  return existing?.[key as keyof WorkLedger] as LedgerAggregationOptions[K] | undefined;
}

function uniqueInOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }

  return result;
}

function buildStatusIndex<T extends { id: string; status: string }>(records: readonly T[]): Partial<Record<T['status'], string[]>> {
  const index: Partial<Record<T['status'], string[]>> = {};

  for (const record of records) {
    const status = record.status as T['status'];
    const ids = index[status] || [];
    ids.push(record.id);
    index[status] = ids;
  }

  return index;
}

function resolveLedgerUpdatedAt(
  entities: LedgerEntities,
  existing: WorkLedger | null,
  explicitUpdatedAt?: string,
): string {
  if (explicitUpdatedAt) {
    return explicitUpdatedAt;
  }

  const timestamps = [
    existing?.updatedAt,
    ...entities.changes.map((change) => change.updatedAt),
    ...entities.specs.map((spec) => spec.updatedAt),
    ...entities.slices.map((slice) => slice.updatedAt),
    ...entities.runs.map((run) => run.updatedAt),
    ...entities.gates.map((gate) => gate.updatedAt),
  ].filter(Boolean) as string[];

  if (timestamps.length === 0) {
    return new Date().toISOString();
  }

  return timestamps.sort(compareIsoDesc)[0];
}

function resolveActiveChangeRecord(changes: readonly WorkChange[]): WorkChange | undefined {
  return [...changes]
    .filter(isOpenChange)
    .sort(
      (left, right) =>
        activeChangeStatusWeight[right.status] - activeChangeStatusWeight[left.status] ||
        compareIsoDesc(left.updatedAt, right.updatedAt) ||
        left.id.localeCompare(right.id),
    )[0];
}

function resolveActiveSpecRecord(specs: readonly WorkSpec[], activeChange?: WorkChange): WorkSpec | undefined {
  const openSpecs = specs.filter(isOpenSpec);

  if (activeChange?.activeSpecId) {
    const linkedSpec = openSpecs.find((spec) => spec.id === activeChange.activeSpecId && spec.changeId === activeChange.id);
    if (linkedSpec) {
      return linkedSpec;
    }
  }

  const scopedSpecs = activeChange ? openSpecs.filter((spec) => spec.changeId === activeChange.id) : openSpecs;
  const candidates = scopedSpecs.length > 0 ? scopedSpecs : openSpecs;

  return [...candidates].sort(compareSpecOrder)[0];
}

function buildBlockers(entities: LedgerEntities): string[] {
  return uniqueInOrder([
    ...entities.changes.filter((change) => change.status === 'blocked').map((change) => `change:${change.id}`),
    ...entities.changes.flatMap((change) => change.blockerIds),
    ...entities.slices.filter((slice) => slice.status === 'blocked').map((slice) => `slice:${slice.id}`),
    ...entities.slices.flatMap((slice) => slice.blockers),
    ...entities.runs.filter((run) => run.status === 'blocked').map((run) => `run:${run.id}`),
    ...entities.gates.filter((gate) => gate.status === 'pending').map((gate) => `gate:${gate.id}`),
  ]);
}

function buildLedger(projectId: string, entities: LedgerEntities, existing: WorkLedger | null, options: LedgerAggregationOptions): WorkLedger {
  const activeChange = resolveActiveChangeRecord(entities.changes);
  const activeSpec = resolveActiveSpecRecord(entities.specs, activeChange);
  const lastIntent = resolveOptionValue(options, existing, 'lastIntent');
  const lastDecision = resolveOptionValue(options, existing, 'lastDecision');
  const effectiveRoute = resolveOptionValue(options, existing, 'effectiveRoute');
  const effectiveApprovalRequired = resolveOptionValue(options, existing, 'effectiveApprovalRequired');

  const ledger: WorkLedger = {
    projectId,
    changeIds: entities.changes.map((change) => change.id),
    specIds: entities.specs.map((spec) => spec.id),
    sliceIds: entities.slices.map((slice) => slice.id),
    runIds: entities.runs.map((run) => run.id),
    gateIds: entities.gates.map((gate) => gate.id),
    pendingGateIds: entities.gates.filter((gate) => gate.status === 'pending').map((gate) => gate.id),
    blockedChangeIds: entities.changes.filter((change) => change.status === 'blocked').map((change) => change.id),
    blockers: buildBlockers(entities),
    sliceIdsByStatus: buildStatusIndex<WorkSlice>(entities.slices),
    runIdsByStatus: buildStatusIndex<WorkRun>(entities.runs),
    updatedAt: resolveLedgerUpdatedAt(entities, existing, options.updatedAt),
  };

  if (activeChange) {
    ledger.activeChangeId = activeChange.id;
  }

  if (activeSpec) {
    ledger.activeSpecId = activeSpec.id;
  }

  if (lastIntent !== undefined) {
    ledger.lastIntent = lastIntent;
  }

  if (lastDecision !== undefined) {
    ledger.lastDecision = lastDecision;
  }

  if (effectiveRoute !== undefined) {
    ledger.effectiveRoute = effectiveRoute;
  }

  if (effectiveApprovalRequired !== undefined) {
    ledger.effectiveApprovalRequired = effectiveApprovalRequired;
  }

  return ledger;
}

export function deriveLedger(projectId: string, options: LedgerAggregationOptions = {}): WorkLedger {
  const existing = getLedger(projectId);
  const entities = loadLedgerEntities(projectId);
  return buildLedger(projectId, entities, existing, options);
}

export function refreshLedger(projectId: string, options: LedgerAggregationOptions = {}): WorkLedger {
  const ledger = deriveLedger(projectId, {
    ...options,
    updatedAt: options.updatedAt ?? new Date().toISOString(),
  });

  if (ledgerExists(projectId)) {
    return updateLedger(ledger);
  }

  return createLedger(ledger);
}

export function getActiveChangeId(projectId: string): string | undefined {
  return deriveLedger(projectId).activeChangeId;
}

export function getActiveSpecId(projectId: string): string | undefined {
  return deriveLedger(projectId).activeSpecId;
}

export function listPendingGateIds(projectId: string): string[] {
  return deriveLedger(projectId).pendingGateIds;
}

export function listBlockedChangeIds(projectId: string): string[] {
  return deriveLedger(projectId).blockedChangeIds;
}

export function listSliceIdsByStatus(projectId: string, status: WorkSliceStatus): string[] {
  return [...(deriveLedger(projectId).sliceIdsByStatus[status] || [])];
}

export function listRunIdsByStatus(projectId: string, status: WorkRunStatus): string[] {
  return [...(deriveLedger(projectId).runIdsByStatus[status] || [])];
}
