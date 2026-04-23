import type { PipelineStage, RuntimePolicy } from '../types/index.js';

const STAGES_REQUIRING_APPROVAL: PipelineStage[] = ['pm', 'research', 'design', 'engineering', 'engineering_exec'];

export function resolveRuntimePolicy(autonomy: 'low' | 'medium'): RuntimePolicy {
  const stagePolicies = STAGES_REQUIRING_APPROVAL.map((stage) => ({
    stage,
    requiresHumanApproval: autonomy === 'low',
  }));

  return {
    autonomy,
    stagePolicies,
    prPolicy: {
      requiresHumanApproval: autonomy === 'low',
      allowAutoMerge: autonomy === 'medium',
    },
  };
}

export function requiresApprovalForStage(policy: RuntimePolicy, stage: PipelineStage): boolean {
  const stagePolicy = policy.stagePolicies.find((entry) => entry.stage === stage);
  return stagePolicy ? stagePolicy.requiresHumanApproval : true;
}
