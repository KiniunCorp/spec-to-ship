import path from 'node:path';
import type { GuardrailConflict, RuntimeConfig } from '../../types/index.js';
import { detectGuardrailConflicts, hasBlockingGuardrailConflict } from '../../runtime/guardrail-conflicts.js';
import { readGovernanceExceptions, splitConflictsByExceptions } from '../../onboarding/governance-exceptions.js';
import { readJsonFile } from '../utils/file-io.js';
import { defaultRuntimeConfig } from './config.js';
import type { GuardrailPolicy, ResolvedProjectContext, SupportedStage } from '../types.js';

export function normalizeGuardrailPolicy(value: unknown): GuardrailPolicy {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'warn' || normalized === 'prompt') return normalized;
  return 'strict';
}

export function getGovernanceConflictView(context: ResolvedProjectContext): {
  all: GuardrailConflict[];
  active: GuardrailConflict[];
  excepted: GuardrailConflict[];
} {
  const all = detectGuardrailConflicts(context.appRoot);
  const exceptions = readGovernanceExceptions(context.configDir);
  const split = splitConflictsByExceptions(all, exceptions);
  return {
    all,
    active: split.active,
    excepted: split.excepted,
  };
}

export function enforceGuardrailPolicyForExecution(context: ResolvedProjectContext, stage: SupportedStage): void {
  const runtime = readJsonFile<RuntimeConfig>(path.join(context.configDir, 'runtime.json')) || defaultRuntimeConfig(context.projectMeta);
  const policy = normalizeGuardrailPolicy(runtime.guardrailPolicy);
  const conflicts = getGovernanceConflictView(context).active;
  if (conflicts.length === 0) return;

  if (policy === 'strict' && hasBlockingGuardrailConflict(conflicts)) {
    console.error(`[guardrails] stage '${stage}' blocked by strict guardrail policy.`);
    printGuardrailConflictSummary(conflicts);
    console.error('Resolve conflicting root instructions or switch guardrail policy via `s2s config edit`.');
    process.exit(1);
  }

  console.warn(`[guardrails] ${conflicts.length} discrepancy(s) detected; proceeding with policy=${policy}.`);
}

export function printGuardrailConflictSummary(conflicts: GuardrailConflict[]): void {
  for (const conflict of conflicts.slice(0, 8)) {
    console.log(`- [${conflict.severity.toUpperCase()}] ${conflict.fileName} :: ${conflict.ruleId}`);
    console.log(`  ${conflict.description}`);
    console.log(`  ${conflict.snippet}`);
  }
  if (conflicts.length > 8) {
    console.log(`- ... ${conflicts.length - 8} more discrepancy(ies) omitted`);
  }
}
