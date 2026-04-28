import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GuardrailConflict } from '../types/index.js';

export interface GovernanceExceptionEntry {
  key: string;
  fileName: string;
  ruleId: string;
  decision: 'keep_project_policy';
  reason: string;
  approvedAt: string;
}

export interface GovernanceExceptionsFile {
  version: number;
  exceptions: GovernanceExceptionEntry[];
}

const DEFAULT_EXCEPTIONS: GovernanceExceptionsFile = {
  version: 1,
  exceptions: [],
};

export function ensureGovernanceExceptionsFile(configDir: string): GovernanceExceptionsFile {
  const filePath = governanceExceptionsPath(configDir);
  const current = readGovernanceExceptions(configDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  return current;
}

export function readGovernanceExceptions(configDir: string): GovernanceExceptionsFile {
  const filePath = governanceExceptionsPath(configDir);
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<GovernanceExceptionsFile>;
    return {
      version: 1,
      exceptions: Array.isArray(parsed.exceptions)
        ? parsed.exceptions
            .filter((entry): entry is GovernanceExceptionEntry => Boolean(entry && entry.key && entry.ruleId))
            .map((entry) => ({
              ...entry,
              decision: 'keep_project_policy',
              reason: String(entry.reason || 'approved during onboarding'),
              approvedAt: String(entry.approvedAt || new Date().toISOString()),
            }))
        : [],
    };
  } catch {
    return DEFAULT_EXCEPTIONS;
  }
}

export function conflictKey(conflict: Pick<GuardrailConflict, 'fileName' | 'ruleId'>): string {
  return `${String(conflict.fileName || '').toLowerCase()}::${String(conflict.ruleId || '').toLowerCase()}`;
}

export function splitConflictsByExceptions(
  conflicts: GuardrailConflict[],
  exceptionsFile: GovernanceExceptionsFile,
): {
  active: GuardrailConflict[];
  excepted: GuardrailConflict[];
} {
  const allowed = new Set(exceptionsFile.exceptions.map((entry) => String(entry.key || '').toLowerCase()));
  const active: GuardrailConflict[] = [];
  const excepted: GuardrailConflict[] = [];
  for (const conflict of conflicts) {
    const key = conflictKey(conflict);
    if (allowed.has(key)) {
      excepted.push(conflict);
    } else {
      active.push(conflict);
    }
  }
  return { active, excepted };
}

export function addGovernanceException(
  configDir: string,
  conflict: GuardrailConflict,
  reason: string,
): GovernanceExceptionsFile {
  const current = readGovernanceExceptions(configDir);
  const key = conflictKey(conflict);
  const existing = current.exceptions.find((entry) => entry.key === key);
  if (existing) return current;

  current.exceptions.push({
    key,
    fileName: conflict.fileName,
    ruleId: conflict.ruleId,
    decision: 'keep_project_policy',
    reason: String(reason || 'approved during onboarding').trim() || 'approved during onboarding',
    approvedAt: new Date().toISOString(),
  });
  const filePath = governanceExceptionsPath(configDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  return current;
}

function governanceExceptionsPath(configDir: string): string {
  return path.join(configDir, 'governance.exceptions.json');
}

