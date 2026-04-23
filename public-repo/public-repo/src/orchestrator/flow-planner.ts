import { collectDesignRequestSignals, hasPersistedDesignDefinition } from '../agents/design.js';
import { resolveContext } from './context-resolver.js';
import { classifyIntent } from './intent-classifier.js';
import type {
  ContextResolution,
  FlowDecision,
  FlowExpansionDecision,
  IntentClassification,
  PipelineStage,
  WorkChange,
} from '../types/index.js';

type PlannerSignalRule = {
  pattern: RegExp;
  label: string;
};

type PlannerFacts = {
  intent: IntentClassification['intent'];
  confidence: number;
  resumeChangeId?: string;
  hasProductDefinition: boolean;
  hasResearchDefinition: boolean;
  hasDesignDefinition: boolean;
  needsResearch: boolean;
  needsDesign: boolean;
  revisitResearch: boolean;
  revisitDesign: boolean;
  researchSignals: string[];
  designSignals: string[];
  revisitSignals: string[];
  stageReuseSignals: string[];
  recommendedStages: PipelineStage[];
};

const researchSignalRules: PlannerSignalRule[] = [
  { pattern: /\binvestigat(?:e|ion)\b/, label: 'investigate' },
  { pattern: /\broot cause\b/, label: 'root cause' },
  { pattern: /\bdiagnos(?:e|is)\b/, label: 'diagnose' },
  { pattern: /\bintermittent\b/, label: 'intermittent' },
  { pattern: /\bfeasibilit(?:y|ies)\b/, label: 'feasibility' },
  { pattern: /\buncertain(?:ty)?\b/, label: 'uncertainty' },
  { pattern: /\bunknown\b/, label: 'unknown' },
  { pattern: /\bspike\b/, label: 'spike' },
  { pattern: /\bevaluate\b/, label: 'evaluate' },
  { pattern: /\bexplore\b/, label: 'explore' },
  { pattern: /\bintegration\b/, label: 'integration' },
];

const revisitSignalRules: PlannerSignalRule[] = [
  { pattern: /\bafter feedback\b/, label: 'after feedback' },
  { pattern: /\breview feedback\b/, label: 'review feedback' },
  { pattern: /\bnew findings?\b/, label: 'new findings' },
  { pattern: /\brevisit\b/, label: 'revisit' },
  { pattern: /\brework\b/, label: 'rework' },
  { pattern: /\bredesign\b/, label: 'redesign' },
  { pattern: /\bgo back\b/, label: 'go back' },
  { pattern: /\breturn to\b/, label: 'return to' },
];

function normalizeRequest(request: string): string {
  return String(request || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function collectSignals(request: string, rules: PlannerSignalRule[]): string[] {
  return rules
    .filter((rule) => rule.pattern.test(request))
    .map((rule) => rule.label);
}

function uniqueStages(stages: Array<PipelineStage | undefined>): PipelineStage[] {
  const deduped: PipelineStage[] = [];

  for (const stage of stages) {
    if (!stage || deduped.includes(stage)) {
      continue;
    }

    deduped.push(stage);
  }

  return deduped;
}

function uniqueValues(values: Array<string | undefined>): string[] {
  const deduped: string[] = [];

  for (const value of values) {
    if (!value || deduped.includes(value)) {
      continue;
    }

    deduped.push(value);
  }

  return deduped;
}

function hasStageArtifact(context: ContextResolution, stage: PipelineStage): boolean {
  return context.artifacts.some((artifact) => artifact.stage === stage);
}

function listCurrentSpecs(context: ContextResolution) {
  const specs = context.activeSpec ? [context.activeSpec] : [];

  for (const spec of context.openSpecs) {
    if (specs.some((candidate) => candidate.id === spec.id)) {
      continue;
    }

    specs.push(spec);
  }

  return specs;
}

function resolveExistingChangeId(context: ContextResolution): string | undefined {
  return (
    context.activeChange?.id ||
    context.openChanges[0]?.id ||
    context.activeSpec?.changeId ||
    context.openSpecs[0]?.changeId ||
    context.openSlices[0]?.changeId ||
    context.openRuns[0]?.changeId ||
    context.pendingGates[0]?.changeId ||
    context.blockedChanges[0]?.id
  );
}

function resolveReuseChangeId(
  intent: IntentClassification['intent'],
  context: ContextResolution,
): string | undefined {
  if (intent === 'resume_existing_change') {
    return resolveExistingChangeId(context);
  }

  if (intent === 'spec_revision' || intent === 'feature_refinement') {
    return context.activeChange?.id || context.activeSpec?.changeId;
  }

  return undefined;
}

const STAGE_ORDER: PipelineStage[] = ['pm', 'research', 'design', 'engineering', 'engineering_exec', 'iterate'];

function compareStageOrder(left: PipelineStage, right: PipelineStage): number {
  return STAGE_ORDER.indexOf(left) - STAGE_ORDER.indexOf(right);
}

function isLaterStage(currentStage: PipelineStage | undefined, stage: PipelineStage): boolean {
  return Boolean(currentStage) && compareStageOrder(stage, currentStage!) < 0;
}

function listReusableChanges(context: ContextResolution): WorkChange[] {
  const candidates: WorkChange[] = [];

  if (context.activeChange) {
    candidates.push(context.activeChange);
  }

  for (const change of context.openChanges) {
    if (!candidates.some((candidate) => candidate.id === change.id)) {
      candidates.push(change);
    }
  }

  return candidates;
}

function canReuseExistingChange(intent: IntentClassification['intent']): boolean {
  return (
    intent === 'feature_refinement' ||
    intent === 'bug_fix' ||
    intent === 'technical_refactor' ||
    intent === 'implementation_only' ||
    intent === 'spec_revision' ||
    intent === 'resume_existing_change'
  );
}

function resolveExpansionCandidate(
  facts: Omit<PlannerFacts, 'recommendedStages'>,
  context: ContextResolution,
): WorkChange | undefined {
  const candidates = listReusableChanges(context);

  if (facts.resumeChangeId) {
    return candidates.find((candidate) => candidate.id === facts.resumeChangeId);
  }

  return candidates.length === 1 ? candidates[0] : undefined;
}

function resolveFlowExpansion(
  facts: Omit<PlannerFacts, 'recommendedStages'>,
  recommendedStages: readonly PipelineStage[],
  context: ContextResolution,
): FlowExpansionDecision | undefined {
  if (!canReuseExistingChange(facts.intent)) {
    return undefined;
  }

  const candidate = resolveExpansionCandidate(facts, context);
  if (!candidate) {
    return undefined;
  }

  if (!candidate.currentStage) {
    return undefined;
  }

  if (STAGE_ORDER.indexOf(candidate.currentStage) < 0) {
    return undefined;
  }

  const addedStages = recommendedStages
    .filter((stage) => compareStageOrder(stage, candidate.currentStage!) < 0)
    .filter((stage) => candidate.stageStatus[stage] !== 'done');
  const reopenedStages = recommendedStages
    .filter((stage) => compareStageOrder(stage, candidate.currentStage!) < 0)
    .filter((stage) => candidate.stageStatus[stage] === 'done');

  if (addedStages.length === 0 && reopenedStages.length === 0) {
    return undefined;
  }

  const rerouteParts: string[] = [];
  if (addedStages.length > 0) {
    rerouteParts.push(`add ${addedStages.join(' -> ')}`);
  }
  if (reopenedStages.length > 0) {
    rerouteParts.push(`reopen ${reopenedStages.join(' -> ')}`);
  }

  return {
    changeId: candidate.id,
    addedStages,
    reopenedStages,
    rationale: `Expand change ${candidate.id} from ${candidate.currentStage} to ${rerouteParts.join(' and ')} before implementation continues.`,
  };
}

function inferResumeStage(facts: Omit<PlannerFacts, 'recommendedStages'>, context: ContextResolution): PipelineStage {
  const currentStage = context.activeChange?.currentStage || context.openChanges.find((change) => change.currentStage)?.currentStage;
  if (isLaterStage(currentStage, 'research') && facts.revisitResearch) {
    return 'research';
  }

  if (isLaterStage(currentStage, 'design') && facts.revisitDesign) {
    return 'design';
  }

  if (currentStage) {
    return currentStage;
  }

  if (!facts.resumeChangeId) {
    return facts.needsResearch ? 'research' : facts.needsDesign ? 'design' : 'pm';
  }

  if (!facts.hasResearchDefinition && facts.needsResearch && !context.flags.hasOpenRun && !context.flags.hasOpenSlice) {
    return 'research';
  }

  if (!facts.hasDesignDefinition && facts.needsDesign && !context.flags.hasOpenRun && !context.flags.hasOpenSlice) {
    return 'design';
  }

  if (context.flags.hasOpenRun || context.flags.hasOpenSlice || context.flags.hasOpenSpec) {
    return 'engineering';
  }

  if (facts.hasProductDefinition || facts.hasResearchDefinition || facts.hasDesignDefinition) {
    return 'engineering';
  }

  return 'pm';
}

function planStages(
  facts: Omit<PlannerFacts, 'recommendedStages'>,
  context: ContextResolution,
): PipelineStage[] {
  switch (facts.intent) {
    case 'new_feature':
      return uniqueStages([
        facts.hasProductDefinition ? undefined : 'pm',
        facts.needsResearch && (!facts.hasResearchDefinition || facts.revisitResearch) ? 'research' : undefined,
        facts.needsDesign && (!facts.hasDesignDefinition || facts.revisitDesign) ? 'design' : undefined,
        'engineering',
      ]);
    case 'feature_refinement':
      return uniqueStages([
        facts.hasProductDefinition ? undefined : 'pm',
        facts.needsResearch && (!facts.hasResearchDefinition || facts.revisitResearch) ? 'research' : undefined,
        facts.needsDesign && (!facts.hasDesignDefinition || facts.revisitDesign) ? 'design' : undefined,
        'engineering',
      ]);
    case 'bug_fix':
      return uniqueStages([
        facts.needsResearch && (!facts.hasResearchDefinition || facts.revisitResearch) ? 'research' : undefined,
        facts.needsDesign && (!facts.hasDesignDefinition || facts.revisitDesign) ? 'design' : undefined,
        'engineering',
      ]);
    case 'incident_investigation':
      return ['research'];
    case 'technical_refactor':
      return uniqueStages([
        facts.needsResearch && (!facts.hasResearchDefinition || facts.revisitResearch) ? 'research' : undefined,
        'engineering',
      ]);
    case 'implementation_only':
      return uniqueStages([
        facts.needsDesign && (!facts.hasDesignDefinition || facts.revisitDesign) ? 'design' : undefined,
        'engineering',
        'engineering_exec',
      ]);
    case 'spec_revision':
      return uniqueStages([
        'pm',
        facts.needsResearch && (!facts.hasResearchDefinition || facts.revisitResearch) ? 'research' : undefined,
        facts.needsDesign && (!facts.hasDesignDefinition || facts.revisitDesign) ? 'design' : undefined,
        'engineering',
      ]);
    case 'resume_existing_change': {
      const resumeStage = inferResumeStage(facts, context);
      return uniqueStages([
        resumeStage,
        resumeStage === 'pm' && facts.needsResearch && (!facts.hasResearchDefinition || facts.revisitResearch)
          ? 'research'
          : undefined,
        (resumeStage === 'pm' || resumeStage === 'research') &&
        facts.needsDesign &&
        (!facts.hasDesignDefinition || facts.revisitDesign)
          ? 'design'
          : undefined,
        resumeStage === 'pm' || resumeStage === 'research' || resumeStage === 'design' ? 'engineering' : undefined,
        resumeStage === 'engineering' && (context.flags.hasOpenRun || context.flags.hasOpenSlice) ? 'engineering_exec' : undefined,
      ]);
    }
    case 'hotfix':
      return ['engineering', 'engineering_exec'];
  }
}

function describeReuseSignals(
  context: ContextResolution,
  hasProductDefinition: boolean,
  hasResearchDefinition: boolean,
  hasDesignDefinition: boolean,
): string[] {
  return uniqueValues([
    hasProductDefinition ? 'reuse:product_definition' : undefined,
    hasResearchDefinition ? 'reuse:research_definition' : undefined,
    hasDesignDefinition ? 'reuse:design_definition' : undefined,
    context.flags.hasOpenRun ? 'reuse:open_run' : undefined,
    context.flags.hasOpenSlice ? 'reuse:open_slice' : undefined,
  ]);
}

function buildPlannerFacts(
  request: string,
  classification: IntentClassification,
  context: ContextResolution,
): PlannerFacts {
  const normalizedRequest = normalizeRequest(request);
  const researchSignals = collectSignals(normalizedRequest, researchSignalRules);
  const designSignals = collectDesignRequestSignals(normalizedRequest);
  const revisitSignals = collectSignals(normalizedRequest, revisitSignalRules);
  const hasProductDefinition = Boolean(context.activeSpec) || context.openSpecs.length > 0 || hasStageArtifact(context, 'pm');
  const hasResearchDefinition = hasStageArtifact(context, 'research');
  const hasDesignDefinition = listCurrentSpecs(context).some((spec) => hasPersistedDesignDefinition(spec));
  const needsResearch = classification.intent === 'incident_investigation' || researchSignals.length > 0;
  const needsDesign = classification.intent !== 'incident_investigation' && designSignals.length > 0;
  const reusableChange = (() => {
    const resumeChangeId = resolveReuseChangeId(classification.intent, context);
    if (resumeChangeId) {
      return listReusableChanges(context).find((change) => change.id === resumeChangeId);
    }

    const candidates = listReusableChanges(context);
    return candidates.length === 1 ? candidates[0] : undefined;
  })();
  const revisitResearch =
    needsResearch &&
    hasResearchDefinition &&
    isLaterStage(reusableChange?.currentStage, 'research') &&
    (researchSignals.length > 0 || revisitSignals.length > 0);
  const revisitDesign =
    needsDesign &&
    hasDesignDefinition &&
    isLaterStage(reusableChange?.currentStage, 'design') &&
    revisitSignals.length > 0;
  const stageReuseSignals = describeReuseSignals(context, hasProductDefinition, hasResearchDefinition, hasDesignDefinition);
  const baseFacts = {
    intent: classification.intent,
    confidence: classification.confidence,
    resumeChangeId: resolveReuseChangeId(classification.intent, context),
    hasProductDefinition,
    hasResearchDefinition,
    hasDesignDefinition,
    needsResearch,
    needsDesign,
    revisitResearch,
    revisitDesign,
    researchSignals,
    designSignals,
    revisitSignals,
    stageReuseSignals,
  } satisfies Omit<PlannerFacts, 'recommendedStages'>;

  return {
    ...baseFacts,
    recommendedStages: planStages(baseFacts, context),
  };
}

function shouldCreateChange(facts: PlannerFacts): boolean {
  return !facts.resumeChangeId;
}

function shouldCreateSpec(facts: PlannerFacts, context: ContextResolution): boolean {
  if (context.flags.hasOpenSpec) {
    return false;
  }

  if (facts.intent === 'incident_investigation') {
    return false;
  }

  if (facts.intent === 'resume_existing_change' && facts.resumeChangeId) {
    return false;
  }

  if (facts.intent === 'spec_revision' && context.activeSpec) {
    return false;
  }

  if (facts.intent === 'hotfix' && facts.recommendedStages[0] === 'engineering') {
    return false;
  }

  return true;
}

function requiresHumanApproval(facts: PlannerFacts): boolean {
  if (facts.intent === 'hotfix' || facts.intent === 'resume_existing_change') {
    return false;
  }

  // Require approval whenever the route reaches code execution, not only when
  // earlier planning stages (pm/research/design) are included. This ensures
  // implementation_only and similar fast-track intents still gate on human
  // review before engineering_exec runs.
  return (
    facts.recommendedStages.includes('pm') ||
    facts.recommendedStages.includes('research') ||
    facts.recommendedStages.includes('design') ||
    facts.recommendedStages.includes('engineering_exec')
  );
}

function buildRationale(
  facts: PlannerFacts,
  context: ContextResolution,
  createChange: boolean,
  createSpec: boolean,
  flowExpansion?: FlowExpansionDecision,
): string {
  const reasons: string[] = [
    `minimum route ${facts.recommendedStages.join(' -> ')}`,
    `intent ${facts.intent}`,
  ];

  if (facts.resumeChangeId) {
    reasons.push(`reusing change ${facts.resumeChangeId}`);
  } else if (createChange) {
    reasons.push('no resumable change matched the request');
  }

  if (flowExpansion) {
    reasons.push(flowExpansion.rationale);
  }

  if (facts.needsResearch) {
    if (facts.revisitResearch) {
      reasons.push('new findings require revisiting earlier research work');
    } else if (facts.hasResearchDefinition) {
      reasons.push('existing research context already covers technical investigation');
    } else if (facts.researchSignals.length > 0) {
      reasons.push(`research signals: ${facts.researchSignals.join(', ')}`);
    } else {
      reasons.push('technical investigation intent requires research');
    }
  }

  if (facts.needsDesign) {
    if (facts.revisitDesign) {
      reasons.push('new findings require revisiting earlier design work');
    } else if (facts.hasDesignDefinition) {
      reasons.push('existing linked design definition already covers visual scope');
    } else {
      reasons.push(`design signals: ${facts.designSignals.join(', ')}`);
    }
  }

  if (!facts.recommendedStages.includes('pm') && facts.hasProductDefinition) {
    reasons.push('existing product/spec definition lets the planner skip pm');
  }

  if (!facts.recommendedStages.includes('research') && facts.hasResearchDefinition && context.artifacts.length > 0) {
    reasons.push('existing research artifacts let the planner skip research');
  }

  if (!facts.recommendedStages.includes('design') && facts.hasDesignDefinition) {
    reasons.push('existing linked design definition lets the planner skip design');
  }

  reasons.push(createSpec ? 'planner expects spec creation or update work' : 'planner can work from existing spec state');

  return reasons.join('; ') + '.';
}

export function buildFlowDecision(
  request: string,
  classification: IntentClassification,
  context: ContextResolution,
): FlowDecision {
  const baseFacts = buildPlannerFacts(request, classification, context);
  const flowExpansion = resolveFlowExpansion(baseFacts, baseFacts.recommendedStages, context);
  const facts = {
    ...baseFacts,
    resumeChangeId: baseFacts.resumeChangeId || flowExpansion?.changeId,
  };
  const createChange = shouldCreateChange(facts);
  const createSpec = shouldCreateSpec(facts, context);
  const matchedSignals = uniqueValues([
    ...classification.matchedSignals,
    ...context.matchedSignals,
    ...facts.researchSignals.map((signal) => `research:${signal}`),
    ...facts.designSignals.map((signal) => `design:${signal}`),
    ...facts.revisitSignals.map((signal) => `replan:${signal}`),
    ...facts.stageReuseSignals,
    facts.resumeChangeId ? `resume_change:${facts.resumeChangeId}` : undefined,
    flowExpansion ? `flow_expansion:${flowExpansion.changeId}` : undefined,
    ...((flowExpansion?.addedStages || []).map((stage) => `flow_expansion_stage:${stage}`)),
    ...((flowExpansion?.reopenedStages || []).map((stage) => `flow_expansion_reopened_stage:${stage}`)),
  ]);

  return {
    intent: classification.intent,
    confidence: classification.confidence,
    matchedSignals,
    rationale: buildRationale(facts, context, createChange, createSpec, flowExpansion),
    nextStage: facts.recommendedStages[0] || 'engineering',
    recommendedStages: facts.recommendedStages,
    requiresHumanApproval: requiresHumanApproval(facts),
    createChange,
    createSpec,
    directToExecution:
      !facts.recommendedStages.includes('pm') &&
      !facts.recommendedStages.includes('research') &&
      !facts.recommendedStages.includes('design'),
    resumeChangeId: facts.resumeChangeId,
    expansion: flowExpansion,
  };
}

export function planFlow(projectId: string, request: string): FlowDecision {
  const classification = classifyIntent(request);
  const context = resolveContext(projectId, classification.intent);
  return buildFlowDecision(request, classification, context);
}
