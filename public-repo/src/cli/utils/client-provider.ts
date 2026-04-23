import type { LLMProviderConfig } from '../../types/index.js';
import { detectUITargetOptions } from '../../runtime/ui-targets.js';
import { ensureManagedLLMWorkspace } from './paths.js';
import {
  SUPPORTED_CLIENTS,
  SUPPORTED_STAGES,
  type SupportedClient,
  type SupportedStage,
} from '../types.js';

export function providerForClient(client: SupportedClient): 'codex' | 'claude' {
  return client.startsWith('claude') ? 'claude' : 'codex';
}

export function isSupportedClient(value: string): value is SupportedClient {
  return SUPPORTED_CLIENTS.includes(value as SupportedClient);
}

export function isSupportedStage(value: string): value is SupportedStage {
  return SUPPORTED_STAGES.includes(value as SupportedStage);
}

function isDesktopClient(value: SupportedClient): boolean {
  return value.endsWith('-desktop');
}

export function normalizeClient(value: unknown, fallback?: SupportedClient): SupportedClient {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'codex') return 'codex-cli';
  if (v === 'claude') return 'claude-cli';
  if (v === 'codex-cli' || v === 'codex_cli' || v === 'codex cli') return 'codex-cli';
  if (v === 'claude-cli' || v === 'claude_cli' || v === 'claude cli') return 'claude-cli';
  if (v === 'codexdesktop' || v === 'codex desktop') return 'codex-desktop';
  if (v === 'claudedesktop' || v === 'claude desktop') return 'claude-desktop';
  if (v === 'codex-desktop' || v === 'codex_desktop') return 'codex-desktop';
  if (v === 'claude-desktop' || v === 'claude_desktop') return 'claude-desktop';
  if (isSupportedClient(v)) return v;
  const fb = String(fallback || '').trim().toLowerCase();
  if (isSupportedClient(fb)) return fb;
  return 'codex-cli';
}

function chatAppExecutable(client: SupportedClient): string {
  return client.startsWith('claude') ? 'claude' : 'codex';
}

export function resolveCLIClientForLLM(
  llm: LLMProviderConfig,
  fallbackClient: SupportedClient,
): SupportedClient {
  const provider = String(llm.provider || '').trim().toLowerCase();
  const command = String(llm.cli?.command || '').trim().toLowerCase();
  if (provider === 'openai' || command.includes('codex')) {
    return fallbackClient.startsWith('codex') ? fallbackClient : 'codex-cli';
  }
  if (provider === 'anthropic' || command.includes('claude')) {
    return fallbackClient.startsWith('claude') ? fallbackClient : 'claude-cli';
  }
  return fallbackClient;
}

export function defaultLLMArgs(client: SupportedClient, appRoot: string): string[] {
  if (client.startsWith('codex')) {
    const llmWorkspace = ensureManagedLLMWorkspace(appRoot);
    return ['exec', '--skip-git-repo-check', '--cd', llmWorkspace, '--add-dir', appRoot, '${PROMPT}'];
  }
  if (client.startsWith('claude')) {
    return ['--print', '-p', '${PROMPT}'];
  }
  return ['exec', '--skip-git-repo-check', '--cd', appRoot, '${PROMPT}'];
}

export function resolveCLICommandForClient(client: SupportedClient): string {
  if (!isDesktopClient(client)) {
    return chatAppExecutable(client);
  }

  const targetId = client === 'claude-desktop' ? 'claude_desktop' : 'codex_desktop';
  const resolved = detectUITargetOptions().find((option) => option.id === targetId)?.cliCommand;
  if (resolved) return resolved;
  return client === 'claude-desktop' ? 'claude' : 'codex';
}

export function resolveExecutionCommandForProvider(
  provider: 'codex' | 'claude' | 'opencode',
  preferredClient: SupportedClient,
): string {
  if (provider === 'opencode') return 'opencode';
  if (provider === 'claude') {
    return preferredClient === 'claude-desktop' ? resolveCLICommandForClient('claude-desktop') : 'claude';
  }
  return preferredClient === 'codex-desktop' ? resolveCLICommandForClient('codex-desktop') : 'codex';
}

export function defaultAllowedExecutionCommands(preferredClient: SupportedClient): string[] {
  const base = ['codex', 'claude', 'opencode', 'just', 'pnpm', 'npm', 'node', 'git', 'bash'];
  const resolved = [
    resolveExecutionCommandForProvider('codex', preferredClient),
    resolveExecutionCommandForProvider('claude', preferredClient),
    resolveExecutionCommandForProvider('opencode', preferredClient),
  ];
  return Array.from(new Set([...base, ...resolved]));
}

export function normalizeReleaseUpdateClass(value: unknown): 'soft' | 'hard' {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'hard' ? 'hard' : 'soft';
}

export function normalizePendingProjectUpdate(value: unknown): import('../types.js').PendingProjectUpdateState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<import('../types.js').PendingProjectUpdateState>;
  const mode = candidate.mode === 'hard' ? 'hard' : candidate.mode === 'soft' ? 'soft' : null;
  if (!mode) return undefined;
  const fromTemplateVersion = String(candidate.fromTemplateVersion || '').trim();
  const toTemplateVersion = String(candidate.toTemplateVersion || '').trim();
  const reason = String(candidate.reason || '').trim();
  const sourceCliVersion = String(candidate.sourceCliVersion || '').trim();
  if (!fromTemplateVersion || !toTemplateVersion || !reason || !sourceCliVersion) return undefined;
  return {
    mode,
    fromTemplateVersion,
    toTemplateVersion,
    fromSchemaVersion: Number(candidate.fromSchemaVersion || 0),
    toSchemaVersion: Number(candidate.toSchemaVersion || 0),
    detectedAt: String(candidate.detectedAt || new Date().toISOString()),
    deferredAt: candidate.deferredAt ? String(candidate.deferredAt) : undefined,
    sourceCliVersion,
    reason,
  };
}
