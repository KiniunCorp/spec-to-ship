import type {
  CreateRefinementSpecVersionOptions,
  RefinementSpecVersionResult,
  WorkChange,
  WorkSpec,
} from '../types/index.js';
import { requireChange, updateChange } from './change-store.js';
import { listGates } from './gate-store.js';
import { listRuns } from './run-store.js';
import { listSlices } from './slice-store.js';
import { createSpec, listSpecs, requireSpec, updateSpec } from './spec-store.js';
import { refreshLedger } from './status.js';

function normalizeText(value: string | undefined): string {
  return String(value || '').trim();
}

function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function resolveTimestamp(value?: string): string {
  return normalizeText(value) || new Date().toISOString();
}

function resolveLatestTimestamp(...values: Array<string | undefined>): string {
  return values
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .sort(compareIsoDesc)[0] || new Date().toISOString();
}

function resolveBaseSpec(projectId: string, change: WorkChange, options: CreateRefinementSpecVersionOptions): WorkSpec {
  const explicitBaseSpecId = normalizeText(options.baseSpecId);
  const baseSpec = explicitBaseSpecId
    ? requireSpec(projectId, explicitBaseSpecId)
    : change.activeSpecId
      ? requireSpec(projectId, change.activeSpecId)
      : listSpecs(projectId)
          .filter((spec) => spec.changeId === change.id && spec.status !== 'superseded' && spec.status !== 'archived')
          .sort((left, right) => right.version - left.version || compareIsoDesc(left.updatedAt, right.updatedAt) || left.id.localeCompare(right.id))[0];

  if (!baseSpec) {
    throw new Error(`No refinement base spec exists for change '${change.id}'.`);
  }

  if (baseSpec.changeId !== change.id) {
    throw new Error(`Spec '${baseSpec.id}' does not belong to change '${change.id}'.`);
  }

  if (baseSpec.status === 'superseded' || baseSpec.status === 'archived') {
    throw new Error(`Spec '${baseSpec.id}' cannot be refined from status '${baseSpec.status}'.`);
  }

  return baseSpec;
}

function resolveNextSpecVersion(projectId: string, changeId: string): number {
  const versions = listSpecs(projectId)
    .filter((spec) => spec.changeId === changeId)
    .map((spec) => spec.version);

  return versions.length > 0 ? Math.max(...versions) + 1 : 1;
}

function resolveNextSpecId(changeId: string, version: number): string {
  return `spec-${changeId}-v${version}`;
}

function requireNonEmptyReason(reason: string): string {
  const normalized = normalizeText(reason);
  if (!normalized) {
    throw new Error('Refinement spec versions require a non-empty reason.');
  }
  return normalized;
}

export function hasMaterializedSpecHistory(projectId: string, specId: string): boolean {
  const spec = requireSpec(projectId, specId);

  if (spec.status === 'review_ready' || spec.status === 'approved') {
    return true;
  }

  if (spec.sourceArtifacts.length > 0 || Boolean(spec.designDefinition) || Boolean(spec.designContext)) {
    return true;
  }

  if (Object.keys(spec.stageSummaries || {}).length > 0) {
    return true;
  }

  if (listSlices(projectId).some((slice) => slice.specId === specId)) {
    return true;
  }

  if (listRuns(projectId).some((run) => run.specId === specId)) {
    return true;
  }

  if (listGates(projectId).some((gate) => gate.specId === specId)) {
    return true;
  }

  return false;
}

export function createRefinementSpecVersion(
  projectId: string,
  options: CreateRefinementSpecVersionOptions,
): RefinementSpecVersionResult {
  const change = requireChange(projectId, options.changeId);
  const previousSpec = resolveBaseSpec(projectId, change, options);
  const createdAt = resolveTimestamp(options.createdAt);
  const reason = requireNonEmptyReason(options.reason);
  const nextVersion = resolveNextSpecVersion(projectId, change.id);
  const nextSpecId = resolveNextSpecId(change.id, nextVersion);

  if (previousSpec.status === 'draft') {
    throw new Error(`Spec '${previousSpec.id}' must not be versioned additively from draft status.`);
  }

  const supersededSpec = updateSpec({
    ...previousSpec,
    status: 'superseded',
    supersededBySpecId: nextSpecId,
    updatedAt: resolveLatestTimestamp(previousSpec.updatedAt, createdAt),
  });

  const spec = createSpec({
    ...previousSpec,
    id: nextSpecId,
    version: nextVersion,
    status: 'draft',
    summary: normalizeText(options.summary) || previousSpec.summary,
    refinedFromSpecId: previousSpec.id,
    refinementReason: reason,
    ...(options.sourceSliceId ? { refinementSourceSliceId: normalizeText(options.sourceSliceId) } : {}),
    ...(options.sourceRunId ? { refinementSourceRunId: normalizeText(options.sourceRunId) } : {}),
    ...(options.sourceGateId ? { refinementSourceGateId: normalizeText(options.sourceGateId) } : {}),
    supersededBySpecId: undefined,
    approvedAt: undefined,
    createdAt,
    updatedAt: createdAt,
  });

  const nextChange = updateChange({
    ...change,
    activeSpecId: spec.id,
    updatedAt: resolveLatestTimestamp(change.updatedAt, createdAt),
  });
  const ledger = refreshLedger(projectId, { updatedAt: createdAt });

  return {
    projectId,
    change: nextChange,
    previousSpec: supersededSpec,
    spec,
    ledger,
  };
}
