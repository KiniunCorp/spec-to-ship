import {
  PRIMARY_DESIGN_DEFINITION_LABEL,
  isDesignOutputArtifactLabel,
  resolveDesignContextHandoff,
} from '../agents/design.js';
import { planFlow } from '../orchestrator/flow-planner.js';
import { buildRouteDecision } from '../orchestrator/stage-router.js';
import { resolveContext } from '../orchestrator/context-resolver.js';
import {
  createChange,
  createRefinementSpecVersion,
  createSpec,
  getActiveChange,
  getLedger,
  getSpec,
  hasMaterializedSpecHistory,
  listChanges,
  listOpenSpecs,
  listSpecs,
  refreshLedger,
  requireChange,
  updateChange,
  updateSpec,
} from '../ledger/index.js';
import {
  ORCHESTRATION_DECISION_RECORD_VERSION,
  type ChangeInitializationResult,
  type OrchestrationDecisionRecord,
  type PipelineStage,
  type SpecInitializationResult,
  type StageOwnershipUpdateResult,
  type WorkChange,
  type WorkChangeStatus,
  type WorkEntityStatus,
  type WorkArtifactReference,
  type WorkSpec,
  type WorkSpecStatus,
  type RouteDecision,
} from '../types/index.js';

const DEFAULT_CHANGE_ID_FALLBACK = 'request';
const DEFAULT_CHANGE_TITLE = 'Untitled Change';
const DEFAULT_CHANGE_SUMMARY = 'Request captured from orchestration.';

// Canonical stage order used for route merging. intake and iterate are excluded — they are
// not executable CLI stages. This mirrors the STAGE_ORDER constant in flow-planner.ts but
// scoped to the stages advanceStageOwnership can act on.
const PIPELINE_STAGE_ORDER: PipelineStage[] = ['pm', 'research', 'design', 'engineering', 'engineering_exec'];
const STAGE_PROGRESS_WEIGHT: Record<WorkEntityStatus, number> = {
  not_started: 0,
  ready: 1,
  in_progress: 2,
  blocked: 3,
  review: 4,
  done: 5,
};

function normalizeRequest(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugifyChangeSegment(value: string, fallback = DEFAULT_CHANGE_ID_FALLBACK): string {
  const normalized = normalizeRequest(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');

  return normalized || fallback;
}

function compareIsoDesc(left: string, right: string): number {
  return right.localeCompare(left);
}

function resolveLatestTimestamp(...timestamps: Array<string | undefined>): string {
  return (
    [...timestamps]
      .filter((value): value is string => Boolean(value))
      .sort(compareIsoDesc)[0] || new Date().toISOString()
  );
}

function toTitleCaseWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function deriveChangeTitle(request: string): string {
  const words = normalizeRequest(request)
    .split(' ')
    .filter(Boolean)
    .slice(0, 6);

  if (words.length === 0) {
    return DEFAULT_CHANGE_TITLE;
  }

  return words.map(toTitleCaseWord).join(' ');
}

function deriveChangeSummary(request: string, decision: RouteDecision): string {
  const normalized = normalizeRequest(request);
  if (normalized) {
    return normalized;
  }

  return `${DEFAULT_CHANGE_SUMMARY} ${decision.rationale}`.trim();
}

function resolveInitialChangeStatus(decision: RouteDecision): WorkChangeStatus {
  if (decision.nextStage === 'engineering' || decision.nextStage === 'engineering_exec') {
    return 'active';
  }

  return 'draft';
}

function resolveChangeId(projectId: string, request: string): string {
  const baseId = `change-${slugifyChangeSegment(request)}`;
  const existingIds = new Set(listChanges(projectId).map((change) => change.id));

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) {
    index += 1;
  }

  return `${baseId}-${index}`;
}

function findChangeForDecision(projectId: string, decisionRecord: OrchestrationDecisionRecord): WorkChange | null {
  return (
    listChanges(projectId).find(
      (change) =>
        change.createdAt === decisionRecord.decidedAt &&
        change.intent === decisionRecord.decision.intent &&
        change.request.rawInput === decisionRecord.request,
    ) || null
  );
}

function resolveNextSpecVersion(projectId: string, changeId: string): number {
  const versions = listSpecs(projectId)
    .filter((spec) => spec.changeId === changeId)
    .map((spec) => spec.version);

  return versions.length > 0 ? Math.max(...versions) + 1 : 1;
}

function resolveSpecId(change: WorkChange, version: number): string {
  return `spec-${change.id}-v${version}`;
}

function deriveSpecGoals(change: WorkChange): string[] {
  if (change.scope.inScope.length > 0) {
    return [...change.scope.inScope];
  }

  return change.summary ? [change.summary] : [];
}

function buildInitialSpec(
  projectId: string,
  change: WorkChange,
  decisionRecord: OrchestrationDecisionRecord,
): WorkSpec {
  const version = resolveNextSpecVersion(projectId, change.id);

  return {
    id: resolveSpecId(change, version),
    projectId,
    changeId: change.id,
    version,
    title: change.title,
    summary: change.summary,
    status: 'draft',
    goals: deriveSpecGoals(change),
    constraints: [],
    acceptanceCriteria: [...change.scope.acceptanceCriteria],
    sourceArtifacts: [],
    createdAt: decisionRecord.decidedAt,
    updatedAt: decisionRecord.decidedAt,
  };
}

function findExistingSpecForChange(projectId: string, change: WorkChange): WorkSpec | null {
  const linkedSpec = change.activeSpecId ? getSpec(projectId, change.activeSpecId) : null;
  const validLinkedSpec = linkedSpec?.changeId === change.id ? linkedSpec : null;

  if (validLinkedSpec && validLinkedSpec.status !== 'superseded' && validLinkedSpec.status !== 'archived') {
    return validLinkedSpec;
  }

  return listOpenSpecs(projectId, { changeId: change.id })[0] || null;
}

function deriveRefinementReason(decisionRecord: OrchestrationDecisionRecord): string {
  return normalizeRequest(decisionRecord.request) || decisionRecord.decision.rationale;
}

function findRefinementSpecForDecision(
  projectId: string,
  changeId: string,
  decisionRecord: OrchestrationDecisionRecord,
): WorkSpec | null {
  const refinementReason = deriveRefinementReason(decisionRecord);

  return (
    listSpecs(projectId).find(
      (spec) =>
        spec.changeId === changeId &&
        spec.createdAt === decisionRecord.decidedAt &&
        spec.refinedFromSpecId &&
        spec.refinementReason === refinementReason,
    ) || null
  );
}

function shouldCreateAdditiveRefinementSpec(
  projectId: string,
  decisionRecord: OrchestrationDecisionRecord,
  spec: WorkSpec,
): boolean {
  if (!(decisionRecord.decision.intent === 'spec_revision' || decisionRecord.decision.intent === 'feature_refinement' || decisionRecord.decision.expansion)) {
    return false;
  }

  if (!hasMaterializedSpecHistory(projectId, spec.id)) {
    return false;
  }

  return !findRefinementSpecForDecision(projectId, spec.changeId, decisionRecord);
}

function ensureChangeSpecLink(change: WorkChange, spec: WorkSpec, linkedAt: string): WorkChange {
  if (change.activeSpecId === spec.id) {
    return change;
  }

  return updateChange({
    ...change,
    activeSpecId: spec.id,
    updatedAt: resolveLatestTimestamp(change.updatedAt, linkedAt),
  });
}

function resolveStageRoute(decision: RouteDecision): PipelineStage[] {
  return decision.recommendedStages.filter((stage) => stage !== 'intake' && stage !== 'iterate');
}

/**
 * Returns the union of two stage lists, in PIPELINE_STAGE_ORDER.
 * Used to accumulate routes across refinement decisions so that stages and
 * approval requirements from earlier decisions are never silently dropped.
 */
function mergeRoutes(existing: PipelineStage[] | undefined, incoming: PipelineStage[]): PipelineStage[] {
  const merged = new Set([...(existing ?? []), ...incoming]);
  return PIPELINE_STAGE_ORDER.filter((stage) => merged.has(stage));
}

function requireStageInRoute(stageRoute: readonly PipelineStage[], completedStage: PipelineStage): number {
  const stageIndex = stageRoute.indexOf(completedStage);
  if (stageIndex >= 0) {
    return stageIndex;
  }

  throw new Error(`Stage '${completedStage}' is not part of the recommended route for the persisted orchestration decision.`);
}

function preserveOrPromoteReady(status?: WorkEntityStatus): WorkEntityStatus {
  if (!status) {
    return 'ready';
  }

  return STAGE_PROGRESS_WEIGHT[status] >= STAGE_PROGRESS_WEIGHT.ready ? status : 'ready';
}

function reopenReroutedStage(status?: WorkEntityStatus): WorkEntityStatus {
  if (!status) {
    return 'ready';
  }

  if (status === 'blocked') {
    return status;
  }

  return 'ready';
}

const REVIEWABLE_STAGE_SET = new Set<PipelineStage>(['pm', 'research', 'design', 'engineering']);

function compareArtifactReferencePath(left: WorkArtifactReference, right: WorkArtifactReference): number {
  return left.path.localeCompare(right.path);
}

function listLinkedSourceArtifacts(projectId: string, completedStage: PipelineStage): WorkArtifactReference[] {
  return resolveContext(projectId).artifacts.filter((artifact) => artifact.stage === completedStage).sort(compareArtifactReferencePath);
}

function mergeSourceArtifactsForStage(
  existingArtifacts: readonly WorkArtifactReference[],
  completedStage: PipelineStage,
  linkedSourceArtifacts: readonly WorkArtifactReference[],
): WorkArtifactReference[] {
  const merged = new Map<string, WorkArtifactReference>();

  for (const artifact of existingArtifacts) {
    if (artifact.stage === completedStage) {
      if (
        completedStage === 'design' &&
        isDesignOutputArtifactLabel(artifact.label) &&
        !linkedSourceArtifacts.some((candidate) => candidate.label === artifact.label)
      ) {
        merged.set(artifact.path, artifact);
      }
      continue;
    }

    merged.set(artifact.path, artifact);
  }

  for (const artifact of linkedSourceArtifacts) {
    merged.set(artifact.path, artifact);
  }

  return [...merged.values()];
}

function resolveDesignDefinition(
  completedStage: PipelineStage,
  linkedSourceArtifacts: readonly WorkArtifactReference[],
  existingDefinition?: WorkArtifactReference,
): WorkArtifactReference | undefined {
  if (completedStage !== 'design') {
    return existingDefinition;
  }

  const explicitDefinition = linkedSourceArtifacts.find((artifact) => artifact.label === PRIMARY_DESIGN_DEFINITION_LABEL);
  if (explicitDefinition) {
    return explicitDefinition;
  }

  return linkedSourceArtifacts[0] || existingDefinition;
}

function buildStageStatusUpdate(
  change: WorkChange,
  completedStage: PipelineStage,
  nextStage?: PipelineStage,
  options: { holdForApproval?: boolean } = {},
): Partial<Record<PipelineStage, WorkEntityStatus>> {
  const { holdForApproval = false } = options;
  const stageStatus: Partial<Record<PipelineStage, WorkEntityStatus>> = {
    ...change.stageStatus,
    [completedStage]: 'done',
  };

  if (nextStage && !holdForApproval) {
    stageStatus[nextStage] = preserveOrPromoteReady(stageStatus[nextStage]);
  }

  return stageStatus;
}

function resolveCurrentStageAfterOwnershipAdvance(
  change: WorkChange,
  stageRoute: readonly PipelineStage[],
  completedStage: PipelineStage,
  nextStage?: PipelineStage,
  options: { holdForApproval?: boolean } = {},
): PipelineStage | undefined {
  const { holdForApproval = false } = options;
  const completedStageIndex = stageRoute.indexOf(completedStage);
  const currentStageIndex = change.currentStage ? stageRoute.indexOf(change.currentStage) : -1;

  if (holdForApproval) {
    return completedStage;
  }

  if (currentStageIndex > completedStageIndex && change.currentStage) {
    return change.currentStage;
  }

  return nextStage || completedStage;
}

function updateChangeStageOwnership(
  change: WorkChange,
  stageRoute: readonly PipelineStage[],
  completedStage: PipelineStage,
  updatedAt: string,
  options: { holdForApproval?: boolean } = {},
): { change: WorkChange; nextStage?: PipelineStage } {
  const completedStageIndex = requireStageInRoute(stageRoute, completedStage);
  const nextStage = stageRoute[completedStageIndex + 1];
  const currentStage = resolveCurrentStageAfterOwnershipAdvance(change, stageRoute, completedStage, nextStage, options);

  return {
    change: updateChange({
      ...change,
      currentStage,
      stageStatus: buildStageStatusUpdate(change, completedStage, nextStage, options),
      updatedAt: resolveLatestTimestamp(change.updatedAt, updatedAt),
    }),
    nextStage,
  };
}

function updateSpecStageArtifacts(
  spec: WorkSpec,
  completedStage: PipelineStage,
  summary: string,
  linkedSourceArtifacts: readonly WorkArtifactReference[],
  updatedAt: string,
): WorkSpec {
  const normalizedSummary = String(summary || '').trim();
  const nextSourceArtifacts = mergeSourceArtifactsForStage(spec.sourceArtifacts, completedStage, linkedSourceArtifacts);
  const nextDesignDefinition = resolveDesignDefinition(completedStage, linkedSourceArtifacts, spec.designDefinition);
  const nextStageSummaries = normalizedSummary
    ? {
        ...(spec.stageSummaries || {}),
        [completedStage]: normalizedSummary,
      }
    : spec.stageSummaries;

  return updateSpec({
    ...spec,
    designDefinition: nextDesignDefinition,
    designContext: resolveDesignContextHandoff({
      ...spec,
      designDefinition: nextDesignDefinition,
      sourceArtifacts: nextSourceArtifacts,
      stageSummaries: nextStageSummaries,
    }),
    stageSummaries: nextStageSummaries,
    sourceArtifacts: nextSourceArtifacts,
    updatedAt: resolveLatestTimestamp(spec.updatedAt, updatedAt),
  });
}

function transitionChangeStatus(change: WorkChange, targetStatus: WorkChangeStatus, updatedAt: string): WorkChange {
  const mutableStatuses: WorkChangeStatus[] = ['draft', 'active', 'blocked', 'in_review'];
  if (!mutableStatuses.includes(change.status) || change.status === targetStatus) {
    return change;
  }

  let next = change;
  const steps: WorkChangeStatus[] = [];

  if (targetStatus === 'active' && (change.status === 'draft' || change.status === 'blocked' || change.status === 'in_review')) {
    steps.push('active');
  }

  if (targetStatus === 'in_review') {
    if (change.status === 'draft' || change.status === 'blocked') {
      steps.push('active');
    }
    steps.push('in_review');
  }

  for (const status of steps) {
    if (next.status === status) {
      continue;
    }

    next = updateChange({
      ...next,
      status,
      updatedAt: resolveLatestTimestamp(next.updatedAt, updatedAt),
    });
  }

  return next;
}

function transitionSpecStatus(spec: WorkSpec, targetStatus: WorkSpecStatus, updatedAt: string): WorkSpec {
  const mutableStatuses: WorkSpecStatus[] = ['draft', 'active', 'review_ready'];
  if (!mutableStatuses.includes(spec.status) || spec.status === targetStatus) {
    return spec;
  }

  let next = spec;
  const steps: WorkSpecStatus[] = [];

  if (targetStatus === 'active' && (spec.status === 'draft' || spec.status === 'review_ready')) {
    steps.push('active');
  }

  if (targetStatus === 'review_ready') {
    if (spec.status === 'draft') {
      steps.push('active');
    }
    steps.push('review_ready');
  }

  for (const status of steps) {
    if (next.status === status) {
      continue;
    }

    next = updateSpec({
      ...next,
      status,
      updatedAt: resolveLatestTimestamp(next.updatedAt, updatedAt),
    });
  }

  return next;
}

function applyFlowExpansion(change: WorkChange, decision: RouteDecision, updatedAt: string): WorkChange {
  const expansion = decision.expansion;
  const reopenedStages = expansion?.reopenedStages || [];
  if (!expansion || expansion.changeId !== change.id || expansion.addedStages.length + reopenedStages.length === 0) {
    return change;
  }

  const stageStatus: Partial<Record<PipelineStage, WorkEntityStatus>> = {
    ...change.stageStatus,
  };
  const nextStage = decision.nextStage;
  const nextStageIndex = decision.recommendedStages.indexOf(nextStage);

  for (const stage of expansion.addedStages) {
    stageStatus[stage] = 'ready';
  }

  for (const stage of reopenedStages) {
    stageStatus[stage] = 'ready';
  }

  for (const stage of decision.recommendedStages.slice(Math.max(nextStageIndex + 1, 0))) {
    stageStatus[stage] = reopenReroutedStage(stageStatus[stage]);
  }

  return updateChange({
    ...change,
    status: change.status === 'blocked' || change.status === 'in_review' ? 'active' : change.status,
    currentStage: nextStage,
    stageStatus,
    updatedAt: resolveLatestTimestamp(change.updatedAt, updatedAt),
  });
}

function requireDecisionRecord(projectId: string, decisionRecord?: OrchestrationDecisionRecord): OrchestrationDecisionRecord {
  const resolved = decisionRecord || getLedger(projectId)?.lastDecision;
  if (!resolved) {
    throw new Error(`No persisted orchestration decision exists for project '${projectId}'.`);
  }

  if (resolved.projectId !== projectId) {
    throw new Error(
      `Orchestration decision project '${resolved.projectId}' does not match requested project '${projectId}'.`,
    );
  }

  return resolved;
}

function buildInitialChange(projectId: string, decisionRecord: OrchestrationDecisionRecord): WorkChange {
  const requestSummary = deriveChangeSummary(decisionRecord.request, decisionRecord.decision);
  const initialStage = decisionRecord.decision.nextStage;
  const changeStatus = resolveInitialChangeStatus(decisionRecord.decision);

  return {
    id: resolveChangeId(projectId, requestSummary),
    projectId,
    title: deriveChangeTitle(requestSummary),
    summary: requestSummary,
    intent: decisionRecord.decision.intent,
    status: changeStatus,
    request: {
      summary: requestSummary,
      rawInput: decisionRecord.request,
      source: 'user',
    },
    scope: {
      inScope: [],
      outOfScope: [],
      acceptanceCriteria: [],
    },
    currentStage: initialStage,
    stageStatus: {
      [initialStage]: 'ready',
    },
    blockerIds: [],
    createdAt: decisionRecord.decidedAt,
    updatedAt: decisionRecord.decidedAt,
  };
}

export function buildOrchestrationDecisionRecord(
  projectId: string,
  prompt: string,
  decision: RouteDecision,
  decidedAt = new Date().toISOString(),
): OrchestrationDecisionRecord {
  return {
    schemaVersion: ORCHESTRATION_DECISION_RECORD_VERSION,
    projectId,
    request: String(prompt || ''),
    decidedAt,
    decision,
  };
}

export function recordOrchestrationDecision(
  projectId: string,
  prompt: string,
  decision: RouteDecision,
  decidedAt = new Date().toISOString(),
): OrchestrationDecisionRecord {
  const record = buildOrchestrationDecisionRecord(projectId, prompt, decision, decidedAt);
  const existing = getLedger(projectId);
  const incomingRoute = resolveStageRoute(decision);

  // When a new change is created, start a fresh effective route and approval flag.
  // When reusing/refining an existing change, accumulate: union of stages, OR of approval.
  const effectiveRoute = decision.createChange
    ? incomingRoute
    : mergeRoutes(existing?.effectiveRoute, incomingRoute);
  const effectiveApprovalRequired = decision.createChange
    ? decision.requiresHumanApproval
    : (existing?.effectiveApprovalRequired ?? false) || decision.requiresHumanApproval;

  refreshLedger(projectId, {
    lastIntent: decision.intent,
    lastDecision: record,
    effectiveRoute,
    effectiveApprovalRequired,
    updatedAt: record.decidedAt,
  });

  return record;
}

export function decideOrchestration(projectId: string, prompt: string, decidedAt?: string): OrchestrationDecisionRecord {
  const decision = buildRouteDecision(planFlow(projectId, prompt));
  return recordOrchestrationDecision(projectId, prompt, decision, decidedAt);
}

export function initializeChangeFromDecision(
  projectId: string,
  decisionRecord?: OrchestrationDecisionRecord,
): ChangeInitializationResult {
  const resolvedDecision = requireDecisionRecord(projectId, decisionRecord);
  const existingForDecision = findChangeForDecision(projectId, resolvedDecision);
  if (existingForDecision) {
    return {
      projectId,
      change: existingForDecision,
      decision: resolvedDecision,
      created: false,
    };
  }

  if (resolvedDecision.decision.resumeChangeId) {
    const resumedChange = requireChange(projectId, resolvedDecision.decision.resumeChangeId);

    return {
      projectId,
      change: applyFlowExpansion(resumedChange, resolvedDecision.decision, resolvedDecision.decidedAt),
      decision: resolvedDecision,
      created: false,
    };
  }

  if (!resolvedDecision.decision.createChange) {
    const activeChange = getActiveChange(projectId);
    if (!activeChange) {
      throw new Error(
        `Orchestration decision for project '${projectId}' does not request a new change and no active change is available.`,
      );
    }

    return {
      projectId,
      change: activeChange,
      decision: resolvedDecision,
      created: false,
    };
  }

  const change = createChange(buildInitialChange(projectId, resolvedDecision));
  refreshLedger(projectId, {
    lastIntent: resolvedDecision.decision.intent,
    lastDecision: resolvedDecision,
    updatedAt: resolvedDecision.decidedAt,
  });

  return {
    projectId,
    change,
    decision: resolvedDecision,
    created: true,
  };
}

export function initializeChange(projectId: string, prompt: string, decidedAt?: string): ChangeInitializationResult {
  const decisionRecord = decideOrchestration(projectId, prompt, decidedAt);
  return initializeChangeFromDecision(projectId, decisionRecord);
}

export function initializeSpecFromDecision(
  projectId: string,
  decisionRecord?: OrchestrationDecisionRecord,
): SpecInitializationResult {
  const resolvedDecision = requireDecisionRecord(projectId, decisionRecord);
  const changeResult = initializeChangeFromDecision(projectId, resolvedDecision);

  const existingSpec = findExistingSpecForChange(projectId, changeResult.change);
  const replayedRefinementSpec = findRefinementSpecForDecision(projectId, changeResult.change.id, resolvedDecision);
  const createdRefinement =
    existingSpec && !replayedRefinementSpec && shouldCreateAdditiveRefinementSpec(projectId, resolvedDecision, existingSpec)
      ? createRefinementSpecVersion(projectId, {
          changeId: changeResult.change.id,
          baseSpecId: existingSpec.id,
          reason: deriveRefinementReason(resolvedDecision),
          summary: deriveChangeSummary(resolvedDecision.request, resolvedDecision.decision),
          createdAt: resolvedDecision.decidedAt,
        })
      : null;
  const spec =
    replayedRefinementSpec ||
    createdRefinement?.spec ||
    existingSpec ||
    createSpec(buildInitialSpec(projectId, changeResult.change, resolvedDecision));

  // Even if the planner can skip fresh spec work, lifecycle consumers still need a persisted spec anchor.
  const change = createdRefinement?.change || ensureChangeSpecLink(changeResult.change, spec, resolvedDecision.decidedAt);
  refreshLedger(projectId, {
    lastIntent: resolvedDecision.decision.intent,
    lastDecision: resolvedDecision,
    updatedAt: resolveLatestTimestamp(change.updatedAt, spec.updatedAt, resolvedDecision.decidedAt),
  });

  return {
    projectId,
    change,
    spec,
    decision: resolvedDecision,
    changeCreated: changeResult.created,
    specCreated: Boolean(createdRefinement) || (!existingSpec && !replayedRefinementSpec),
  };
}

export function initializeSpec(projectId: string, prompt: string, decidedAt?: string): SpecInitializationResult {
  const decisionRecord = decideOrchestration(projectId, prompt, decidedAt);
  return initializeSpecFromDecision(projectId, decisionRecord);
}

export function advanceStageOwnershipFromDecision(
  projectId: string,
  completedStage: PipelineStage,
  summary: string,
  decisionRecord?: OrchestrationDecisionRecord,
  updatedAt = new Date().toISOString(),
): StageOwnershipUpdateResult {
  const resolvedDecision = requireDecisionRecord(projectId, decisionRecord);
  const specResult = initializeSpecFromDecision(projectId, resolvedDecision);
  // Use the accumulated effective route from the ledger so that stages and approval
  // requirements from earlier decisions are preserved across refinements.
  const ledger = getLedger(projectId);
  const stageRoute = ledger?.effectiveRoute ?? resolveStageRoute(resolvedDecision.decision);
  const effectiveApprovalRequired = ledger?.effectiveApprovalRequired ?? resolvedDecision.decision.requiresHumanApproval;
  const approvalReady = effectiveApprovalRequired && REVIEWABLE_STAGE_SET.has(completedStage);
  const linkedSourceArtifacts = listLinkedSourceArtifacts(projectId, completedStage);
  const stageUpdate = updateChangeStageOwnership(specResult.change, stageRoute, completedStage, updatedAt, {
    holdForApproval: approvalReady,
  });
  const lifecycleChange = transitionChangeStatus(stageUpdate.change, approvalReady ? 'in_review' : 'active', updatedAt);
  const lifecycleSpec = transitionSpecStatus(specResult.spec, approvalReady ? 'review_ready' : 'active', updatedAt);
  const spec = updateSpecStageArtifacts(lifecycleSpec, completedStage, summary, linkedSourceArtifacts, updatedAt);
  const ledgerUpdatedAt = resolveLatestTimestamp(lifecycleChange.updatedAt, spec.updatedAt, updatedAt);

  refreshLedger(projectId, {
    lastIntent: resolvedDecision.decision.intent,
    lastDecision: resolvedDecision,
    updatedAt: ledgerUpdatedAt,
  });

  return {
    projectId,
    change: lifecycleChange,
    spec,
    designContext: spec.designContext,
    decision: resolvedDecision,
    completedStage,
    nextStage: stageUpdate.nextStage,
    approvalReady,
    linkedSourceArtifacts,
    changeCreated: specResult.changeCreated,
    specCreated: specResult.specCreated,
  };
}

export function advanceStageOwnership(
  projectId: string,
  completedStage: PipelineStage,
  summary: string,
  updatedAt?: string,
): StageOwnershipUpdateResult {
  return advanceStageOwnershipFromDecision(projectId, completedStage, summary, undefined, updatedAt);
}

export function decideRoute(projectId: string, prompt: string): RouteDecision {
  return decideOrchestration(projectId, prompt).decision;
}
