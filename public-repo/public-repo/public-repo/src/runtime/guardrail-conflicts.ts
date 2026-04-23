import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { GuardrailConflict } from '../types/index.js';

const ROOT_FILES = ['AGENTS.md', 'CODEX.md', 'CLAUDE.md'] as const;
const CANONICAL_GUARDRAIL_FILES = ['AGENTS.md', 'CODEX.md', 'CLAUDE.md'] as const;

const MANAGED_BLOCK_MARKERS: Array<{ start: string; end: string }> = [
  { start: '<!-- S2S_PROJECT_GUARDRAIL_START -->', end: '<!-- S2S_PROJECT_GUARDRAIL_END -->' },
  { start: '<!-- S2S_CODEX_ADAPTER_START -->', end: '<!-- S2S_CODEX_ADAPTER_END -->' },
  { start: '<!-- S2S_CLAUDE_ADAPTER_START -->', end: '<!-- S2S_CLAUDE_ADAPTER_END -->' },
  { start: '<!-- SPECTOSHIP_GUARDRAIL_START -->', end: '<!-- SPECTOSHIP_GUARDRAIL_END -->' },
];

type ConflictRule = {
  id: string;
  severity: 'warn' | 'fail';
  description: string;
  regex: RegExp;
};

const CONFLICT_RULES: ConflictRule[] = [
  {
    id: 'bypass-s2s-workflow',
    severity: 'fail',
    description: 'Instruction can bypass s2s/.s2s workflow.',
    regex: /\b(?:bypass|skip|ignore|disable|avoid)\b[\s\S]{0,50}\b(?:s2s|\.s2s|spec-to-ship)\b/i,
  },
  {
    id: 'skip-stage-gating',
    severity: 'fail',
    description: 'Instruction can skip stage gating (pm->research->design->engineering->engineering_exec).',
    regex: /\b(?:skip|bypass|avoid)\b[\s\S]{0,60}\b(?:pm|research|design|engineering|engineering_exec|stage\s*gating|stages?)\b/i,
  },
  {
    id: 'direct-coding-without-approval',
    severity: 'fail',
    description: 'Instruction promotes direct coding without approval/stage flow.',
    regex: /\b(?:direct|immediate)\b[\s\S]{0,40}\b(?:coding|implementation)\b[\s\S]{0,80}\b(?:without|skip)\b[\s\S]{0,40}\b(?:approval|review|stage)\b/i,
  },
  {
    id: 'override-s2s-precedence',
    severity: 'fail',
    description: 'Instruction declares precedence over s2s guardrails/runtime.',
    regex: /\b(?:override|supersede|take\s+precedence)\b[\s\S]{0,80}\b(?:s2s|\.s2s|guardrails|runtime\.json)\b/i,
  },
  {
    id: 'ignore-governance-files',
    severity: 'warn',
    description: 'Instruction can ignore AGENTS/CODEX/CLAUDE governance files.',
    regex: /\bignore\b[\s\S]{0,80}\b(?:AGENTS\.md|CODEX\.md|CLAUDE\.md|guardrails)\b/i,
  },
];

/**
 * Returns true when the trigger word at matchIndex is preceded by a negation phrase
 * ("do not", "must not", "never", etc.) within 25 characters. Prohibitions such as
 * "Do NOT skip s2s request" are enforcement instructions, not conflicts.
 */
function isNegatedMatch(content: string, matchIndex: number): boolean {
  const preceding = content.slice(Math.max(0, matchIndex - 25), matchIndex);
  return /\b(?:not?|don['']?t|never|must\s+not|do\s+not|should\s+not)\s+$/i.test(preceding);
}

export function detectGuardrailConflicts(appRoot: string): GuardrailConflict[] {
  const conflicts: GuardrailConflict[] = [];

  const scanTargets = [
    ...CANONICAL_GUARDRAIL_FILES.map((fileName) => ({
      fileName: path.join('.s2s', 'guardrails', fileName),
      filePath: path.join(appRoot, '.s2s', 'guardrails', fileName),
      contentMode: 'canonical' as const,
    })),
    ...ROOT_FILES.map((fileName) => ({
      fileName,
      filePath: path.join(appRoot, fileName),
      contentMode: 'root-unmanaged' as const,
    })),
  ];

  for (const target of scanTargets) {
    const filePath = target.filePath;
    if (!existsSync(filePath)) continue;
    const content = readFileSync(filePath, 'utf8');
    const scannedContent = target.contentMode === 'canonical' ? content : stripManagedBlocks(content);
    if (!String(scannedContent || '').trim()) continue;

    for (const rule of CONFLICT_RULES) {
      const match = scannedContent.match(rule.regex);
      if (!match || match.index === undefined) continue;
      if (isNegatedMatch(scannedContent, match.index)) continue;
      conflicts.push({
        filePath,
        fileName: target.fileName,
        ruleId: rule.id,
        severity: rule.severity,
        description: rule.description,
        snippet: extractSnippet(scannedContent, match.index, match[0].length),
      });
    }
  }

  return conflicts.sort((a, b) => {
    const aWeight = a.severity === 'fail' ? 0 : 1;
    const bWeight = b.severity === 'fail' ? 0 : 1;
    if (aWeight !== bWeight) return aWeight - bWeight;
    if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
    return a.ruleId.localeCompare(b.ruleId);
  });
}

export function hasBlockingGuardrailConflict(conflicts: GuardrailConflict[]): boolean {
  return conflicts.some((item) => item.severity === 'fail');
}

function stripManagedBlocks(content: string): string {
  let cleaned = String(content || '');
  for (const marker of MANAGED_BLOCK_MARKERS) {
    const pattern = new RegExp(`${escapeRegExp(marker.start)}[\\s\\S]*?${escapeRegExp(marker.end)}\\n?`, 'g');
    cleaned = cleaned.replace(pattern, '\n');
  }
  return cleaned;
}

function extractSnippet(content: string, start: number, length: number): string {
  const from = Math.max(0, start - 40);
  const to = Math.min(content.length, start + length + 80);
  return content.slice(from, to).replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
