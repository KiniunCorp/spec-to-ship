import type {
  PipelineStage,
  ProjectStatus,
  WorkChange,
  WorkGate,
  WorkLedger,
  WorkRun,
  WorkSlice,
  WorkSpec,
  RuntimeConfig,
  CLISharedFlags,
} from '../types/index.js';

export const SUPPORTED_CLIENTS = ['codex-cli', 'claude-cli', 'codex-desktop', 'claude-desktop'] as const;
export const SUPPORTED_STAGES = ['pm', 'research', 'design', 'engineering', 'engineering_exec'] as const;
export const PIPELINE_PROGRESS_STAGES: readonly PipelineStage[] = ['intake', 'pm', 'research', 'design', 'engineering', 'engineering_exec'];
export const PUBLIC_HELP_TOPICS = [
  'start',
  'version',
  'list',
  'update',
  'init',
  'config',
  'stage',
  'request',
  'status',
  'show',
  'approve',
  'reject',
  'worktrees',
  'completion',
  'doctor',
  'backup',
  'restore',
  'remove',
  'project-resolution',
] as const;
export const HIDDEN_HELP_TOPICS = ['execute', 'resume'] as const;
export const HELP_TOPICS = [...PUBLIC_HELP_TOPICS, ...HIDDEN_HELP_TOPICS] as const;
export const SHOW_SUBJECTS = ['change', 'spec', 'slice', 'slices', 'run', 'runs', 'blockers', 'dependencies'] as const;
export const COMPLETION_SHELLS = ['bash', 'zsh', 'fish'] as const;

export const ROOT_GUARDRAIL_START = '<!-- S2S_PROJECT_GUARDRAIL_START -->';
export const ROOT_GUARDRAIL_END = '<!-- S2S_PROJECT_GUARDRAIL_END -->';
export const ROOT_CODEX_ADAPTER_START = '<!-- S2S_CODEX_ADAPTER_START -->';
export const ROOT_CODEX_ADAPTER_END = '<!-- S2S_CODEX_ADAPTER_END -->';
export const ROOT_CLAUDE_ADAPTER_START = '<!-- S2S_CLAUDE_ADAPTER_START -->';
export const ROOT_CLAUDE_ADAPTER_END = '<!-- S2S_CLAUDE_ADAPTER_END -->';
export const ROOT_ADAPTER_FILES = ['AGENTS.md', 'CODEX.md', 'CLAUDE.md'] as const;
export const DEFAULT_WRAPPER_PREFIX_TEMPLATE = '▶ S2S ACTIVE · project: ${PROJECT_ALIAS} · stage: ${STAGE}';

export type SupportedClient = (typeof SUPPORTED_CLIENTS)[number];
export type SupportedStage = (typeof SUPPORTED_STAGES)[number];
export type HelpTopic = (typeof HELP_TOPICS)[number];
export type CompletionShell = (typeof COMPLETION_SHELLS)[number];
export type GuardrailPolicy = RuntimeConfig['guardrailPolicy'];

export interface GlobalRegistryProject {
  alias: string;
  appPath: string;
  s2sPath: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string;
  templateVersion: string;
}

export interface GlobalRegistry {
  version: number;
  projects: GlobalRegistryProject[];
}

export type ChatPermissionsStatus = 'configured' | 'pending' | 'skipped';

export interface ChatPermissionsState {
  /** Overall configuration state across all chat tools. */
  status: ChatPermissionsStatus;
  /** Tool ids (e.g. 'claude-code', 'codex', 'opencode') that have been configured. */
  configuredTools?: string[];
  /** ISO timestamp set after the pending footnote is shown once — suppresses repeats. */
  footnoteShownAt?: string;
}

export interface ProjectMeta {
  schemaVersion: number;
  templateVersion: string;
  minCliVersion: string;
  lastMigratedByCliVersion: string;
  alias: string;
  projectId: string;
  appPath: string;
  createdAt: string;
  updatedAt: string;
  chatPermissions?: ChatPermissionsState;
}

export interface ProjectLocalState {
  lastUsedAt: string;
  lastStage?: string;
  lastDetectedClient?: string;
  pendingProjectUpdate?: PendingProjectUpdateState;
}

export interface PendingProjectUpdateState {
  mode: 'soft' | 'hard';
  fromTemplateVersion: string;
  toTemplateVersion: string;
  fromSchemaVersion: number;
  toSchemaVersion: number;
  detectedAt: string;
  deferredAt?: string;
  sourceCliVersion: string;
  reason: string;
}

export interface ProjectUpdateRequirement {
  mode: 'none' | 'soft' | 'hard';
  reason: string;
  fromTemplateVersion: string;
  toTemplateVersion: string;
  fromSchemaVersion: number;
  toSchemaVersion: number;
}

export interface EnsureProjectSetupOptions {
  forceProjectUpdate?: boolean;
}

export interface ResolvedProjectContext {
  appRoot: string;
  s2sDir: string;
  configDir: string;
  projectMetaPath: string;
  projectLocalPath: string;
  projectMeta: ProjectMeta;
}

export interface ManagedProjectSnapshot {
  projectId: string;
  legacyPipelineStatus: ProjectStatus;
  ledger: WorkLedger;
  activeChange: WorkChange | null;
  activeSpec: WorkSpec | null;
  activeRun: WorkRun | null;
  executableSlice: WorkSlice | null;
  changes: WorkChange[];
  specs: WorkSpec[];
  slices: WorkSlice[];
  runs: WorkRun[];
  gates: WorkGate[];
  artifactFiles: string[];
  lastUpdatedAt?: string;
}

export interface GlobalProjectBackupManifest {
  version: number;
  backupId: string;
  createdAt: string;
  reason: 'manual' | 'pre-restore' | 'pre-policy-change' | 'startup-change' | 'periodic-startup';
  cliVersion: string;
  appRoot: string;
  projectId: string;
  alias: string;
  includes: {
    s2s: boolean;
    rootAdapters: string[];
  };
}

export interface ChatObservabilitySettings {
  sessionBannerEnabled: boolean;
  wrapperPrefixEnabled: boolean;
  wrapperPrefixTemplate: string;
}

export interface CLIInvocation {
  command?: string;
  commandArgs: string[];
  flags: CLISharedFlags;
}
