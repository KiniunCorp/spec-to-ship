import type {
  ExecutableSliceCandidate,
  ExecutableSliceSelection,
  ExecutableSliceSelectionOptions,
  WorkChange,
  WorkChangeStatus,
  WorkGate,
  WorkPriority,
  WorkRun,
  WorkRunStatus,
  WorkSlice,
  WorkSliceStatus,
  WorkSpec,
} from '../types/index.js';
import { getChange } from './change-store.js';
import { getGate } from './gate-store.js';
import {
  deriveLedger,
  listBlockedChangeIds,
  listPendingGateIds,
  listRunIdsByStatus,
  listSliceIdsByStatus,
} from './status.js';
import { listChanges } from './change-store.js';
import { getRun } from './run-store.js';
import { getSlice, listSlices } from './slice-store.js';
import { getSpec, listSpecs } from './spec-store.js';
import { listRuns } from './run-store.js';

function requireSelection<T>(record: T | null, message: string): T {
  if (!record) {
    throw new Error(message);
  }
  return record;
}

function listRecordsById<T>(ids: readonly string[], resolver: (id: string) => T | null): T[] {
  const records: T[] = [];

  for (const id of ids) {
    const record = resolver(id);
    if (record) {
      records.push(record);
    }
  }

  return records;
}

function compareIsoAsc(left: string, right: string): number {
  return left.localeCompare(right);
}

function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

const openChangeStatusWeight: Record<WorkChangeStatus, number> = {
  draft: 1,
  active: 2,
  blocked: 2,
  in_review: 2,
  done: 0,
  archived: 0,
};

const openSliceStatusWeight: Record<WorkSliceStatus, number> = {
  in_progress: 5,
  ready: 4,
  blocked: 3,
  queued: 2,
  draft: 1,
  done: 0,
  cancelled: 0,
};

const openRunStatusWeight: Record<WorkRunStatus, number> = {
  running: 4,
  verifying: 3,
  blocked: 2,
  created: 1,
  succeeded: 0,
  failed: 0,
  cancelled: 0,
};

const executableSliceStatusWeight: Record<WorkPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const executableSliceSizeWeight: Record<WorkSlice['size'], number> = {
  xs: 0,
  s: 1,
  m: 2,
  l: 3,
};

const executableSliceStatuses = new Set<WorkSliceStatus>(['ready', 'queued']);

function isOpenChange(change: WorkChange): boolean {
  return openChangeStatusWeight[change.status] > 0;
}

function isOpenSpec(spec: WorkSpec): boolean {
  return spec.status !== 'superseded' && spec.status !== 'archived';
}

function isOpenSlice(slice: WorkSlice): boolean {
  return openSliceStatusWeight[slice.status] > 0;
}

function isOpenRun(run: WorkRun): boolean {
  return openRunStatusWeight[run.status] > 0;
}

function compareOpenChangeOrder(left: WorkChange, right: WorkChange): number {
  return (
    openChangeStatusWeight[right.status] - openChangeStatusWeight[left.status] ||
    compareIsoDesc(left.updatedAt, right.updatedAt) ||
    compareIsoDesc(left.createdAt, right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareOpenSpecOrder(left: WorkSpec, right: WorkSpec): number {
  return right.version - left.version || compareIsoDesc(left.updatedAt, right.updatedAt) || left.id.localeCompare(right.id);
}

function compareOpenSliceOrder(left: WorkSlice, right: WorkSlice): number {
  return (
    openSliceStatusWeight[right.status] - openSliceStatusWeight[left.status] ||
    left.sequence - right.sequence ||
    compareIsoAsc(left.createdAt, right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareOpenRunOrder(left: WorkRun, right: WorkRun): number {
  return (
    openRunStatusWeight[right.status] - openRunStatusWeight[left.status] ||
    compareIsoDesc(left.updatedAt, right.updatedAt) ||
    compareIsoDesc(left.createdAt, right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function compareExecutableSliceOrder(left: WorkSlice, right: WorkSlice): number {
  return (
    left.sequence - right.sequence ||
    executableSliceStatusWeight[left.priority] - executableSliceStatusWeight[right.priority] ||
    executableSliceSizeWeight[left.size] - executableSliceSizeWeight[right.size] ||
    compareIsoAsc(left.createdAt, right.createdAt) ||
    left.id.localeCompare(right.id)
  );
}

function resolveExecutableSliceScope(
  projectId: string,
  options: ExecutableSliceSelectionOptions,
): { change: WorkChange | null; spec: WorkSpec | null } {
  const explicitChangeId = String(options.changeId || '').trim();
  const explicitSpecId = String(options.specId || '').trim();

  let change = explicitChangeId ? getChange(projectId, explicitChangeId) : null;
  let spec = explicitSpecId ? getSpec(projectId, explicitSpecId) : null;

  if (explicitChangeId && !change) {
    return { change: null, spec: null };
  }

  if (explicitSpecId && !spec) {
    return { change: null, spec: null };
  }

  if (!change && !spec && !explicitChangeId && !explicitSpecId && !options.projectWide) {
    change = getActiveChange(projectId);
    spec = getActiveSpec(projectId);
  }

  if (!change && spec) {
    change = getChange(projectId, spec.changeId);
  }

  if (!spec && change?.activeSpecId) {
    const linkedSpec = getSpec(projectId, change.activeSpecId);
    if (linkedSpec && linkedSpec.changeId === change.id && isOpenSpec(linkedSpec)) {
      spec = linkedSpec;
    }
  }

  if (!spec) {
    spec = listOpenSpecs(projectId, change ? { changeId: change.id } : {})[0] || null;
  }

  if (!change && spec) {
    change = getChange(projectId, spec.changeId);
  }

  if (change && spec && spec.changeId !== change.id) {
    return { change: null, spec: null };
  }

  return { change, spec };
}

function buildExecutableSliceCandidate(projectId: string, slice: WorkSlice): ExecutableSliceCandidate {
  const blockers = [...slice.blockers].filter(Boolean);
  const incompleteDependencyIds = slice.dependencyIds.filter((dependencyId) => {
    const dependency = getSlice(projectId, dependencyId);
    return dependency?.status !== 'done';
  });
  const eligibleStatus = executableSliceStatuses.has(slice.status);

  return {
    slice,
    eligibleStatus,
    incompleteDependencyIds,
    blockers,
    executable: eligibleStatus && incompleteDependencyIds.length === 0 && blockers.length === 0,
  };
}

export function getActiveChange(projectId: string): WorkChange | null {
  const activeChangeId = deriveLedger(projectId).activeChangeId;
  return activeChangeId ? getChange(projectId, activeChangeId) : null;
}

export function requireActiveChange(projectId: string): WorkChange {
  return requireSelection(getActiveChange(projectId), `No active change exists for project '${projectId}'.`);
}

export function getActiveSpec(projectId: string): WorkSpec | null {
  const activeSpecId = deriveLedger(projectId).activeSpecId;
  return activeSpecId ? getSpec(projectId, activeSpecId) : null;
}

export function requireActiveSpec(projectId: string): WorkSpec {
  return requireSelection(getActiveSpec(projectId), `No active spec exists for project '${projectId}'.`);
}

export function listOpenChanges(projectId: string): WorkChange[] {
  return [...listChanges(projectId)].filter(isOpenChange).sort(compareOpenChangeOrder);
}

export function listOpenSpecs(projectId: string, options: { changeId?: string } = {}): WorkSpec[] {
  const { changeId } = options;
  return [...listSpecs(projectId)]
    .filter(isOpenSpec)
    .filter((spec) => !changeId || spec.changeId === changeId)
    .sort(compareOpenSpecOrder);
}

export function listOpenSlices(projectId: string, options: { changeId?: string; specId?: string } = {}): WorkSlice[] {
  const { changeId, specId } = options;
  return [...listSlices(projectId)]
    .filter(isOpenSlice)
    .filter((slice) => !changeId || slice.changeId === changeId)
    .filter((slice) => !specId || slice.specId === specId)
    .sort(compareOpenSliceOrder);
}

export function listOpenRuns(
  projectId: string,
  options: { changeId?: string; specId?: string; sliceId?: string } = {},
): WorkRun[] {
  const { changeId, specId, sliceId } = options;
  return [...listRuns(projectId)]
    .filter(isOpenRun)
    .filter((run) => !changeId || run.changeId === changeId)
    .filter((run) => !specId || run.specId === specId)
    .filter((run) => !sliceId || run.sliceId === sliceId)
    .sort(compareOpenRunOrder);
}

export function listPendingGates(projectId: string): WorkGate[] {
  return listRecordsById(listPendingGateIds(projectId), (gateId) => getGate(projectId, gateId));
}

export function listBlockedChanges(projectId: string): WorkChange[] {
  return listRecordsById(listBlockedChangeIds(projectId), (changeId) => getChange(projectId, changeId));
}

export function listSlicesByStatus(projectId: string, status: WorkSliceStatus): WorkSlice[] {
  return listRecordsById(listSliceIdsByStatus(projectId, status), (sliceId) => getSlice(projectId, sliceId));
}

export function listRunsByStatus(projectId: string, status: WorkRunStatus): WorkRun[] {
  return listRecordsById(listRunIdsByStatus(projectId, status), (runId) => getRun(projectId, runId));
}

export function resolveExecutableSliceSelection(
  projectId: string,
  options: ExecutableSliceSelectionOptions = {},
): ExecutableSliceSelection {
  const scope = resolveExecutableSliceScope(projectId, options);
  const openSlices =
    scope.change || scope.spec
      ? listOpenSlices(projectId, {
          ...(scope.change ? { changeId: scope.change.id } : {}),
          ...(scope.spec ? { specId: scope.spec.id } : {}),
        })
      : options.projectWide
        ? listOpenSlices(projectId)
        : [];
  const candidates = openSlices.map((slice) => buildExecutableSliceCandidate(projectId, slice));
  const executableSlices = candidates
    .filter((candidate) => candidate.executable)
    .map((candidate) => candidate.slice)
    .sort(compareExecutableSliceOrder);

  return {
    projectId,
    change: scope.change,
    spec: scope.spec,
    candidates,
    executableSlices,
    selectedSlice: executableSlices[0] || null,
  };
}

export function listExecutableSlices(projectId: string, options: ExecutableSliceSelectionOptions = {}): WorkSlice[] {
  return resolveExecutableSliceSelection(projectId, options).executableSlices;
}

export function selectNextExecutableSlice(projectId: string, options: ExecutableSliceSelectionOptions = {}): WorkSlice | null {
  return resolveExecutableSliceSelection(projectId, options).selectedSlice;
}

export function requireNextExecutableSlice(projectId: string, options: ExecutableSliceSelectionOptions = {}): WorkSlice {
  const selection = resolveExecutableSliceSelection(projectId, options);
  if (selection.selectedSlice) {
    return selection.selectedSlice;
  }

  const scopeSummary = [
    `project '${projectId}'`,
    selection.change ? `change '${selection.change.id}'` : '',
    selection.spec ? `spec '${selection.spec.id}'` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const candidateCount = selection.candidates.length;
  const detail =
    candidateCount === 0
      ? 'No open slices are available in the current scope.'
      : 'Candidates exist, but none satisfy the executable policy (status ready/queued, dependencies done, blockers absent).';

  throw new Error(`No executable slice is available for ${scopeSummary}. ${detail}`);
}
