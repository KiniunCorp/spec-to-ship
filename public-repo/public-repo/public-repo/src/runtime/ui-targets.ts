import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';
import { commandExists } from './shell.js';

export type UIChoice = 'codex' | 'claude' | 'opencode';
export type UITarget = 'codex_cli' | 'codex_desktop' | 'claude_cli' | 'claude_desktop' | 'opencode_cli';

export interface UITargetOption {
  id: UITarget;
  label: string;
  ui: UIChoice;
  available: boolean;
  cliCommand?: string;
  notes: string;
}

const SUPPORTED_UI_COMMANDS: UIChoice[] = ['codex', 'claude', 'opencode'];
const CODEX_DESKTOP_CANDIDATE_PATHS = [
  path.resolve(process.env.HOME || '', 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
  '/Applications/Codex.app/Contents/Resources/codex',
];
const CLAUDE_DESKTOP_APP_CANDIDATE_PATHS = [
  path.resolve(process.env.HOME || '', 'Applications', 'Claude.app'),
  '/Applications/Claude.app',
];

export function defaultCLIArgs(ui: UIChoice): string[] {
  if (ui === 'claude') return ['code', '--print', '--prompt', '${PROMPT}'];
  if (ui === 'opencode') return ['run', '--prompt', '${PROMPT}'];
  return ['exec', '--skip-git-repo-check', '${PROMPT}'];
}

export function templateFromUI(ui: UIChoice): string {
  if (ui === 'claude') return 'claude_strict';
  if (ui === 'opencode') return 'opencode_strict';
  return 'codex_strict';
}

export function mergeAllowedCommands(commands: string[], ui: UIChoice): string[] {
  const base = ['codex', 'claude', 'opencode', 'just', 'pnpm', 'npm', 'node', 'git', 'bash'];
  const merged = new Set<string>([...commands, ...base, ui]);
  return Array.from(merged);
}

export function isCommandAvailable(command: string): boolean {
  if (command.includes('/') || command.startsWith('.')) {
    try {
      accessSync(command, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }
  return commandExists(command);
}

export function detectUIFromCommand(command: string): UIChoice | undefined {
  if ((SUPPORTED_UI_COMMANDS as string[]).includes(command)) return command as UIChoice;
  const base = path.basename(command);
  if ((SUPPORTED_UI_COMMANDS as string[]).includes(base)) return base as UIChoice;
  return undefined;
}

export function detectUITargetOptions(): UITargetOption[] {
  const codexCli = isCommandAvailable('codex') ? 'codex' : undefined;
  const codexDesktop = detectCodexDesktopBinary();
  const claudeCli = isCommandAvailable('claude') ? 'claude' : undefined;
  const claudeDesktopInstalled = CLAUDE_DESKTOP_APP_CANDIDATE_PATHS.some((candidate) => existsSync(candidate));
  const opencodeCli = isCommandAvailable('opencode') ? 'opencode' : undefined;

  return [
    {
      id: 'codex_cli',
      label: 'Codex CLI',
      ui: 'codex',
      available: Boolean(codexCli),
      cliCommand: codexCli,
      notes: codexCli ? 'Ready from terminal.' : 'Not detected in terminal PATH.',
    },
    {
      id: 'codex_desktop',
      label: 'Codex Desktop app',
      ui: 'codex',
      available: Boolean(codexDesktop),
      cliCommand: codexDesktop,
      notes: codexDesktop ? 'Desktop app detected and ready.' : 'Desktop app bridge not detected.',
    },
    {
      id: 'claude_cli',
      label: 'Claude CLI',
      ui: 'claude',
      available: Boolean(claudeCli),
      cliCommand: claudeCli,
      notes: claudeCli ? 'Ready from terminal.' : 'Not detected in terminal PATH.',
    },
    {
      id: 'claude_desktop',
      label: 'Claude Desktop app',
      ui: 'claude',
      available: claudeDesktopInstalled,
      cliCommand: claudeCli,
      notes: claudeDesktopInstalled
        ? claudeCli
          ? 'Desktop app detected (uses Claude CLI bridge).'
          : 'Desktop app detected, but CLI bridge is missing.'
        : 'Desktop app not detected.',
    },
    {
      id: 'opencode_cli',
      label: 'OpenCode CLI',
      ui: 'opencode',
      available: Boolean(opencodeCli),
      cliCommand: opencodeCli,
      notes: opencodeCli ? 'Ready from terminal.' : 'Not detected in terminal PATH.',
    },
  ];
}

export function pickDefaultUITarget(options: UITargetOption[], uiHint?: string): UITarget {
  const inferredHint = uiHint || detectUIHintFromEnvironment();

  if (inferredHint === 'codex') {
    if (options.find((option) => option.id === 'codex_cli')?.available) return 'codex_cli';
    if (options.find((option) => option.id === 'codex_desktop')?.available) return 'codex_desktop';
    return 'codex_cli';
  }
  if (inferredHint === 'claude') {
    if (options.find((option) => option.id === 'claude_cli')?.available) return 'claude_cli';
    if (options.find((option) => option.id === 'claude_desktop')?.available) return 'claude_desktop';
    return 'claude_cli';
  }
  if (inferredHint === 'opencode') return 'opencode_cli';

  const preferredOrder: UITarget[] = ['codex_cli', 'codex_desktop', 'claude_cli', 'opencode_cli', 'claude_desktop'];
  for (const target of preferredOrder) {
    if (options.find((option) => option.id === target && option.available)) return target;
  }
  return 'codex_cli';
}

export function detectUIHintFromEnvironment(): UIChoice | undefined {
  const bundleId = String(process.env.__CFBundleIdentifier || '').toLowerCase();
  const codexOriginator = String(process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE || '').toLowerCase();

  if (
    process.env.CODEX_CI
    || process.env.CODEX_SHELL
    || codexOriginator.includes('codex')
    || bundleId.includes('codex')
  ) {
    return 'codex';
  }
  if (process.env.CLAUDECODE || bundleId.includes('claude')) {
    return 'claude';
  }
  if (process.env.OPENCODE || bundleId.includes('opencode')) {
    return 'opencode';
  }
  return undefined;
}

function detectCodexDesktopBinary(): string | undefined {
  return CODEX_DESKTOP_CANDIDATE_PATHS.find((candidate) => isCommandAvailable(candidate));
}
