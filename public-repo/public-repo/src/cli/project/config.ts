import path from 'node:path';
import type { LLMProviderConfig, RuntimeConfig } from '../../types/index.js';
import { readJsonFile, writeJsonFile } from '../utils/file-io.js';
import { defaultManagedWorktreesRootPath } from '../utils/paths.js';
import {
  defaultLLMArgs,
  normalizeClient,
  normalizePendingProjectUpdate,
  providerForClient,
  resolveCLICommandForClient,
  resolveExecutionCommandForProvider,
} from '../utils/client-provider.js';
import {
  DEFAULT_WRAPPER_PREFIX_TEMPLATE,
  type ProjectLocalState,
  type ProjectMeta,
  type ResolvedProjectContext,
  type SupportedClient,
} from '../types.js';
import { detectUIHintFromEnvironment, templateFromUI } from '../../runtime/ui-targets.js';

export function writeLocalState(context: ResolvedProjectContext, patch: Partial<ProjectLocalState>): void {
  const current = readLocalState(context);
  writeJsonFile(context.projectLocalPath, {
    ...current,
    ...patch,
  });
}

export function readLocalState(context: ResolvedProjectContext): ProjectLocalState {
  const current = readJsonFile<Partial<ProjectLocalState>>(context.projectLocalPath) || {};
  return {
    lastUsedAt: String(current.lastUsedAt || new Date().toISOString()),
    lastStage: current.lastStage ? String(current.lastStage) : undefined,
    lastDetectedClient: current.lastDetectedClient ? String(current.lastDetectedClient) : undefined,
    pendingProjectUpdate: normalizePendingProjectUpdate(current.pendingProjectUpdate),
  };
}

export function defaultRuntimeConfig(meta: ProjectMeta): RuntimeConfig {
  const worktreesRootPath = defaultManagedWorktreesRootPath(meta.appPath);
  return {
    productName: 's2s',
    defaultBranch: 'main',
    guardrailPolicy: 'strict',
    workspace: {
      basePath: meta.appPath,
      orchestratorDirName: '.s2s',
      projectDirName: path.basename(meta.appPath),
      worktreesDirName: path.basename(worktreesRootPath),
      projectRepoPath: meta.appPath,
      worktreesRootPath,
    },
    github: {
      remoteName: 'origin',
      autoPush: true,
      autoPR: true,
      autoMerge: false,
    },
    execution: {
      mode: 'shell',
      templateId: templateFromUI(detectUIHintFromEnvironment() ?? 'codex'),
      commandTemplate: '',
      maxTasksPerRun: 3,
      stopOnFailure: true,
      timeoutMs: 1200000,
      allowedCommands: ['codex', 'claude', 'opencode', 'just', 'pnpm', 'npm', 'node', 'git', 'bash'],
      allowUnsafeRawCommand: false,
    },
    costControl: {
      enabled: false,
      budgetUsd: 0,
      warnThresholdPct: 80,
      hardStopThresholdPct: 100,
    },
    chatObservability: {
      sessionBannerEnabled: true,
      wrapperPrefixEnabled: false,
      wrapperPrefixTemplate: DEFAULT_WRAPPER_PREFIX_TEMPLATE,
    },
    versioning: {
      enforceSemverBumpOnDelivery: true,
      requireChangelogUpdate: true,
      manifestFile: 'package.json',
      changelogFile: 'CHANGELOG.md',
    },
    pipelineMode: 'chat-native',
  };
}

export function defaultLLMConfig(_clientOrApp: SupportedClient, _appRoot: string): LLMProviderConfig {
  return {
    mode: 'api',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
  };
}

export function defaultExecutionTemplates(preferredClient: SupportedClient = 'codex-cli'): Array<{
  id: string;
  provider: 'codex' | 'claude' | 'opencode' | 'custom';
  description: string;
  command: string;
  args: string[];
  timeoutMs: number;
  allowedCommands: string[];
}> {
  const codexCommand = resolveExecutionCommandForProvider('codex', preferredClient);
  const claudeCommand = resolveExecutionCommandForProvider('claude', preferredClient);
  const opencodeCommand = resolveExecutionCommandForProvider('opencode', preferredClient);
  return [
    { id: 'codex_strict', provider: 'codex', description: 'Codex strict mode', command: codexCommand, args: ['exec', '--skip-git-repo-check', '--cd', '${AGP_WORKTREE_PATH}', '${AGP_PROMPT_STRICT}'], timeoutMs: 1800000, allowedCommands: [codexCommand] },
    { id: 'codex_fast', provider: 'codex', description: 'Codex fast mode', command: codexCommand, args: ['exec', '--skip-git-repo-check', '--cd', '${AGP_WORKTREE_PATH}', '${AGP_PROMPT_FAST}'], timeoutMs: 900000, allowedCommands: [codexCommand] },
    { id: 'claude_strict', provider: 'claude', description: 'Claude strict mode', command: claudeCommand, args: ['--dangerously-skip-permissions', '-p', '${AGP_PROMPT_STRICT}'], timeoutMs: 1800000, allowedCommands: [claudeCommand] },
    { id: 'claude_fast', provider: 'claude', description: 'Claude fast mode', command: claudeCommand, args: ['--dangerously-skip-permissions', '-p', '${AGP_PROMPT_FAST}'], timeoutMs: 900000, allowedCommands: [claudeCommand] },
    { id: 'opencode_strict', provider: 'opencode', description: 'OpenCode strict mode', command: opencodeCommand, args: ['run', '--cwd', '${AGP_WORKTREE_PATH}', '--prompt', '${AGP_PROMPT_STRICT}'], timeoutMs: 1800000, allowedCommands: [opencodeCommand] },
    { id: 'opencode_fast', provider: 'opencode', description: 'OpenCode fast mode', command: opencodeCommand, args: ['run', '--cwd', '${AGP_WORKTREE_PATH}', '--prompt', '${AGP_PROMPT_FAST}'], timeoutMs: 900000, allowedCommands: [opencodeCommand] },
  ];
}
