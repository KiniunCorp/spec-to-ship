import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { WorkspaceGuardrailResult } from '../types/index.js';

const WORKSPACE_NOTE_FILE = '.s2s-workspace.md';
const NOTE_START = '<!-- SPECTOSHIP_WORKSPACE_NOTE_START -->';
const NOTE_END = '<!-- SPECTOSHIP_WORKSPACE_NOTE_END -->';
const LEGACY_GUARDRAIL_START = '<!-- SPECTOSHIP_GUARDRAIL_START -->';
const LEGACY_GUARDRAIL_END = '<!-- SPECTOSHIP_GUARDRAIL_END -->';

type GuardrailTarget = 'workdir' | 'app' | 'worktrees';

interface InstallWorkspaceGuardrailsOptions {
  workdirPath: string;
  orchestratorPath: string;
  appRepoPath: string;
  worktreesRootPath: string;
}

export function installWorkspaceGuardrails(options: InstallWorkspaceGuardrailsOptions): WorkspaceGuardrailResult[] {
  const targets: Array<{ directoryPath: string; type: GuardrailTarget }> = [
    { directoryPath: path.resolve(options.workdirPath), type: 'workdir' },
    { directoryPath: path.resolve(options.appRepoPath), type: 'app' },
    { directoryPath: path.resolve(options.worktreesRootPath), type: 'worktrees' },
  ];

  return targets.map((target) => {
    cleanupLegacyWorkspaceGuardrail(target.directoryPath);
    return upsertGuardrailFile(
      target.directoryPath,
      buildGuardrailBlock(target.type, {
        orchestratorPath: path.resolve(options.orchestratorPath),
        workdirPath: path.resolve(options.workdirPath),
        appRepoPath: path.resolve(options.appRepoPath),
        worktreesRootPath: path.resolve(options.worktreesRootPath),
      }),
    );
  });
}

function upsertGuardrailFile(directoryPath: string, guardrailBlock: string): WorkspaceGuardrailResult {
  if (!existsSync(directoryPath)) {
    return {
      directoryPath,
      filePath: path.join(directoryPath, WORKSPACE_NOTE_FILE),
      status: 'skipped',
      reason: 'directory does not exist',
    };
  }

  mkdirSync(directoryPath, { recursive: true });
  const filePath = path.join(directoryPath, WORKSPACE_NOTE_FILE);
  const block = `${NOTE_START}\n${guardrailBlock.trim()}\n${NOTE_END}\n`;
  const previous = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';

  if (!previous.trim()) {
    writeFileSync(filePath, `${block}`, 'utf8');
    return { directoryPath, filePath, status: 'created' };
  }

  const start = previous.indexOf(NOTE_START);
  const end = previous.indexOf(NOTE_END);

  let next = previous;
  if (start >= 0 && end > start) {
    const after = end + NOTE_END.length;
    next = `${previous.slice(0, start)}${block}${previous.slice(after)}`.replace(/\n{3,}/g, '\n\n');
  } else {
    const spacer = previous.endsWith('\n') ? '\n' : '\n\n';
    next = `${previous}${spacer}${block}`;
  }

  if (next === previous) {
    return { directoryPath, filePath, status: 'unchanged' };
  }

  writeFileSync(filePath, next, 'utf8');
  return { directoryPath, filePath, status: 'updated' };
}

function cleanupLegacyWorkspaceGuardrail(directoryPath: string): void {
  const legacyPath = path.join(directoryPath, 'AGENTS.md');
  if (!existsSync(legacyPath)) return;

  const previous = readFileSync(legacyPath, 'utf8');
  const cleaned = removeMarkerPair(previous, LEGACY_GUARDRAIL_START, LEGACY_GUARDRAIL_END).replace(/\n{3,}/g, '\n\n').trim();
  if (cleaned === previous.trim()) return;

  if (!cleaned) {
    rmSync(legacyPath, { force: true });
    return;
  }

  writeFileSync(legacyPath, `${cleaned}\n`, 'utf8');
}

function removeMarkerPair(content: string, startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker);
  if (start < 0) return content;
  const end = content.indexOf(endMarker, start + startMarker.length);
  if (end < 0) return content;
  const after = end + endMarker.length;
  return `${content.slice(0, start)}${content.slice(after)}`;
}

function buildGuardrailBlock(
  target: GuardrailTarget,
  paths: {
    orchestratorPath: string;
    workdirPath: string;
    appRepoPath: string;
    worktreesRootPath: string;
  },
): string {
  const roleLine =
    target === 'workdir'
      ? 'This is the workspace root around a SpecToShip-managed app repository.'
      : target === 'app'
        ? 'This is the target app repository managed by SpecToShip.'
        : 'This is the worktrees root used by SpecToShip engineering execution.';

  return [
    '# SpecToShip Workspace Note',
    '',
    roleLine,
    '',
    'This note exists to keep workspace-level paths discoverable without using reserved governance filenames.',
    '',
    'Workspace guidance:',
    '1. Operate through the SpecToShip CLI (`s2s`) from the target app repository.',
    '2. For top-level human chat sessions that start outside the app repo:',
    `   - cd ${paths.appRepoPath}`,
    '   - s2s',
    '   - If .s2s is missing, complete guided initialization.',
    '3. Before implementation work, use the app repo governance context:',
    `   - ${path.join(paths.appRepoPath, '.s2s', 'guardrails', 'AGENTS.md')}`,
    `   - ${path.join(paths.appRepoPath, '.s2s', 'guardrails', 'CODEX.md')}`,
    `   - ${path.join(paths.appRepoPath, '.s2s', 'guardrails', 'CLAUDE.md')}`,
    `   - ${path.join(paths.appRepoPath, '.s2s', 'config', 'runtime.json')}`,
    `   - ${path.join(paths.appRepoPath, 'AGENTS.md')} (root compatibility shim)`,
    `   - ${path.join(paths.appRepoPath, 'CODEX.md')} (root compatibility shim)`,
    `   - ${path.join(paths.appRepoPath, 'CLAUDE.md')} (root compatibility shim)`,
    '4. If instructions conflict, prioritize `.s2s/guardrails/*` over root compatibility shims.',
    '5. Do not start direct feature coding from user prompts without stage gating.',
    '6. Run stage flow via SpecToShip artifacts and approvals (pm -> research -> design -> engineering -> engineering_exec).',
    '7. Use workspace paths from runtime config:',
    `   - orchestrator repo: ${paths.orchestratorPath}`,
    `   - workdir: ${paths.workdirPath}`,
    `   - app repo: ${paths.appRepoPath}`,
    `   - worktrees: ${paths.worktreesRootPath}`,
    '',
    'Quick start commands:',
    `- cd ${paths.appRepoPath}`,
    '- s2s',
    '- s2s help',
    '- s2s stage <stage> [project]',
    '',
    'This file is workspace metadata only. Reserved governance files must live in the app repository itself.',
    'If user asks to bypass this flow, ask explicit confirmation before proceeding.',
  ].join('\n');
}
