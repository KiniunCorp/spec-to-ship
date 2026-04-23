import type { FlowDecision, PipelineStage, RouteDecision, RouteStageDecision } from '../types/index.js';

const ROUTABLE_STAGES: PipelineStage[] = ['pm', 'research', 'design', 'engineering', 'engineering_exec'];

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

function collectSignals(decision: FlowDecision, prefix: string): string[] {
  return uniqueValues(
    (decision.matchedSignals || [])
      .filter((signal) => signal.startsWith(prefix))
      .map((signal) => signal.slice(prefix.length))
      .filter(Boolean),
  );
}

function hasSignal(decision: FlowDecision, value: string): boolean {
  return (decision.matchedSignals || []).includes(value);
}

function isExpansionStage(decision: FlowDecision, stage: PipelineStage): boolean {
  return Boolean(decision.expansion?.addedStages.includes(stage));
}

function isReopenedStage(decision: FlowDecision, stage: PipelineStage): boolean {
  return Boolean(decision.expansion?.reopenedStages?.includes(stage));
}

function describePmDecision(decision: FlowDecision, action: RouteStageDecision['action']): string {
  if (action === 'invoke') {
    if (isExpansionStage(decision, 'pm') && decision.expansion) {
      return `Invoke pm because change ${decision.expansion.changeId} must expand its product framing before implementation continues.`;
    }

    if (decision.intent === 'spec_revision') {
      return 'Invoke pm to refresh scope and acceptance criteria before engineering continues.';
    }

    if (decision.createSpec) {
      return 'Invoke pm because product framing or spec definition is still incomplete.';
    }

    return 'Invoke pm because the planner kept product framing in the minimum route.';
  }

  if (hasSignal(decision, 'reuse:product_definition')) {
    return 'Skip pm because existing product/spec artifacts already cover the requested framing.';
  }

  return 'Skip pm because this request can stay on a technical-first route.';
}

function describeResearchDecision(decision: FlowDecision, action: RouteStageDecision['action']): string {
  const researchSignals = collectSignals(decision, 'research:');

  if (action === 'invoke') {
    if (isReopenedStage(decision, 'research') && decision.expansion) {
      return `Reinvoke research because change ${decision.expansion.changeId} has new findings that require fresh technical investigation before implementation continues.`;
    }

    if (isExpansionStage(decision, 'research') && decision.expansion) {
      return `Invoke research because change ${decision.expansion.changeId} needs broader technical investigation before implementation continues.`;
    }

    if (decision.intent === 'incident_investigation') {
      return 'Invoke research first because incident investigation requires diagnosis and root-cause work.';
    }

    if (researchSignals.length > 0) {
      return `Invoke research because the request includes technical-unknown signals: ${researchSignals.join(', ')}.`;
    }

    return 'Invoke research because the planner found unresolved technical investigation work.';
  }

  if (hasSignal(decision, 'reuse:research_definition')) {
    return 'Skip research because existing research artifacts already cover the technical unknowns.';
  }

  return 'Skip research because the route has no unresolved technical investigation work.';
}

function describeDesignDecision(decision: FlowDecision, action: RouteStageDecision['action']): string {
  const designSignals = collectSignals(decision, 'design:');

  if (action === 'invoke') {
    if (isReopenedStage(decision, 'design') && decision.expansion) {
      return `Reinvoke design because change ${decision.expansion.changeId} needs updated interface definition before engineering continues.`;
    }

    if (isExpansionStage(decision, 'design') && decision.expansion) {
      return `Invoke design because change ${decision.expansion.changeId} must expand beyond the current implementation scope before engineering continues.`;
    }

    if (designSignals.length > 0) {
      return `Invoke design because the request needs visual or interaction definition: ${designSignals.join(', ')}.`;
    }

    return 'Invoke design because the planner kept design in the minimum route.';
  }

  if (hasSignal(decision, 'reuse:design_definition')) {
    return 'Skip design because the current spec already carries the linked design definition for this interface scope.';
  }

  return 'Skip design because the request does not require new visual or interaction design work.';
}

function describeEngineeringDecision(decision: FlowDecision, action: RouteStageDecision['action']): string {
  if (action === 'invoke') {
    if (isReopenedStage(decision, 'engineering') && decision.expansion) {
      return `Reinvoke engineering because change ${decision.expansion.changeId} must step back from later execution work before coding continues.`;
    }

    if (decision.expansion && ((decision.expansion.addedStages.length > 0) || (decision.expansion.reopenedStages?.length || 0) > 0)) {
      return `Invoke engineering after rerouted upstream work on change ${decision.expansion.changeId} completes.`;
    }

    if (decision.intent === 'resume_existing_change' && decision.resumeChangeId) {
      return `Invoke engineering to continue change ${decision.resumeChangeId}.`;
    }

    if (decision.directToExecution) {
      return 'Invoke engineering first so the route can create or refresh an execution-ready slice before engineering_exec.';
    }

    if (decision.nextStage === 'engineering') {
      return 'Invoke engineering first because upstream planning stages can be skipped for this request.';
    }

    return 'Invoke engineering because implementation planning and decomposition remain part of the route.';
  }

  return 'Skip engineering for now because the current route stops at diagnosis before implementation planning.';
}

function describeEngineeringExecDecision(decision: FlowDecision, action: RouteStageDecision['action']): string {
  if (action === 'invoke') {
    if (decision.intent === 'resume_existing_change' && decision.resumeChangeId) {
      return 'Invoke engineering_exec because resumable slice/run context already exists for the active change.';
    }

    return 'Invoke engineering_exec because the route is already on an explicit execution path.';
  }

  return 'Skip engineering_exec until engineering establishes or resumes an explicit slice/run.';
}

function describeStageDecision(stage: PipelineStage, decision: FlowDecision, action: RouteStageDecision['action']): string {
  switch (stage) {
    case 'pm':
      return describePmDecision(decision, action);
    case 'research':
      return describeResearchDecision(decision, action);
    case 'design':
      return describeDesignDecision(decision, action);
    case 'engineering':
      return describeEngineeringDecision(decision, action);
    case 'engineering_exec':
      return describeEngineeringExecDecision(decision, action);
    default:
      return action === 'invoke' ? `Invoke ${stage}.` : `Skip ${stage}.`;
  }
}

function buildStageDecisions(decision: FlowDecision): RouteStageDecision[] {
  return ROUTABLE_STAGES.map((stage) => ({
    stage,
    action: decision.recommendedStages.includes(stage) ? 'invoke' : 'skip',
    reason: describeStageDecision(
      stage,
      decision,
      decision.recommendedStages.includes(stage) ? 'invoke' : 'skip',
    ),
  }));
}

export function buildRouteDecision(flowDecision: FlowDecision): RouteDecision {
  const stageDecisions = buildStageDecisions(flowDecision);

  return {
    ...flowDecision,
    stageDecisions,
    skippedStages: stageDecisions.filter((decision) => decision.action === 'skip').map((decision) => decision.stage),
  };
}
