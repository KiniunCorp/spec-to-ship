import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { scaffoldAppRepository } from './app-scaffold.js';
import { bootstrapWorkspace, loadRuntimeConfig, saveRuntimeConfig } from './config.js';
import { buildSourceRepoManagedProjectError, detectRepositoryRole } from './repository-role.js';
import { commandExists } from './shell.js';
import {
  detectUITargetOptions,
  isCommandAvailable,
  mergeAllowedCommands,
  pickDefaultUITarget,
  templateFromUI,
  type UITarget,
  type UITargetOption,
  type UIChoice,
} from './ui-targets.js';
import {
  resolveLocalS2SControlRoot,
  resolveLocalS2SRepoWorktreesRoot,
  resolveLocalS2SRuntimeRoot,
  resolveLocalS2SWorktreesRoot,
} from './worktree-provider.js';
import type {
  AppScaffoldResult,
  LightweightPrerequisiteCheckOptions,
  LightweightPrerequisiteReport,
  LLMProviderConfig,
  ReadinessCheck,
  ReadinessFeature,
  ReadinessFeatureSummary,
  ReadinessStatus,
  ReadinessSummaryBucket,
  RuntimeConfig,
  RuntimeReadinessReport,
} from '../types/index.js';

const DEFAULT_ENABLED_FEATURES: ReadinessFeature[] = ['ui_target', 'llm_access', 'workspace_bootstrap'];
const LIGHTWEIGHT_ENABLED_FEATURES: ReadinessFeature[] = ['workspace_bootstrap'];
const FEATURE_LABELS: Record<ReadinessFeature, string> = {
  ui_target: 'Preferred UI bridge',
  llm_access: 'LLM access',
  workspace_bootstrap: 'Workspace bootstrap',
  worktree_native: 'Native worktree runtime',
  worktree_worktrunk: 'Worktrunk runtime',
};

export interface EnsureRuntimeReadyOptions {
  appName?: string;
  idea?: string;
  uiTarget?: UITarget;
  preferCli?: boolean;
  scaffoldMode?: 'none' | 'recommended' | 'custom';
  customStackNotes?: string;
}

export interface EnsureRuntimeReadyResult {
  ready: boolean;
  readiness: RuntimeReadinessReport;
  appName: string;
  selectedUI?: UITargetOption;
  llmConfigPath: string;
  llmMode: 'api' | 'cli' | 'openai_compatible' | 'unknown';
  llmStatus: 'configured' | 'unchanged' | 'manual_required';
  workspaceStatus: 'configured' | 'unchanged';
  workspaceAppPath: string;
  workspaceWorktreesPath: string;
  guardrailsCreatedOrUpdated: number;
  guardrailsUnchanged: number;
  guardrailsSkipped: number;
  missingRequiredTools: string[];
  missingOptionalTools: string[];
  warnings: string[];
  pendingActions: string[];
  scaffold?: AppScaffoldResult;
}

interface CoreToolCheck {
  requiredMissing: string[];
  optionalMissing: string[];
}

interface RuntimeReadinessAssessmentOptions {
  repoRoot?: string;
  runtimeConfig?: RuntimeConfig;
  runtimeConfigPath?: string;
  llmConfig?: LLMProviderConfig;
  llmConfigPath?: string;
  uiTarget?: UITarget;
  uiOptions?: UITargetOption[];
  preferCli?: boolean;
  enabledFeatures?: ReadinessFeature[];
  commandExistsFn?: (command: string) => boolean;
}

interface JsonConfigProbe {
  exists: boolean;
  valid: boolean;
  writable: boolean;
  error?: string;
}

export function createExpectedProjectRuntimeConfig(repoRoot: string): RuntimeConfig {
  const projectRepoPath = path.resolve(repoRoot);
  return {
    productName: 's2s',
    defaultBranch: 'main',
    guardrailPolicy: 'strict',
    workspace: {
      basePath: projectRepoPath,
      orchestratorDirName: '.s2s',
      projectDirName: path.basename(projectRepoPath),
      worktreesDirName: path.basename(resolveLocalS2SRepoWorktreesRoot({ repoRoot: projectRepoPath })),
      projectRepoPath,
      worktreesRootPath: resolveLocalS2SRepoWorktreesRoot({ repoRoot: projectRepoPath }),
    },
    github: {
      remoteName: 'origin',
      autoPush: true,
      autoPR: true,
      autoMerge: false,
    },
    execution: {
      mode: 'shell',
      templateId: 'codex_strict',
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
      wrapperPrefixTemplate: '▶ S2S ACTIVE · project: ${PROJECT_ALIAS} · stage: ${STAGE}',
    },
    versioning: {
      enforceSemverBumpOnDelivery: true,
      requireChangelogUpdate: true,
      manifestFile: 'package.json',
      changelogFile: 'CHANGELOG.md',
    },
  };
}

export function ensureRuntimeReady(options: EnsureRuntimeReadyOptions = {}): EnsureRuntimeReadyResult {
  const runtime = loadRuntimeConfig();
  const coreTools = checkCoreTools();
  const repoRoot = path.resolve(process.cwd());
  const llmConfigPath = path.resolve(repoRoot, 'config', 'llm.json');
  const existingLLM = readLLMConfig(llmConfigPath);
  const uiOptions = detectUITargetOptions();
  const selectedUI = resolveSelectedUI(uiOptions, options.uiTarget);
  const preferCli = options.preferCli !== false;

  const appName = deriveAppName(options.appName, options.idea, runtime.workspace.projectDirName);
  const workspacePaths = resolveExpectedWorkspacePaths(runtime, appName);
  const initialReadiness = assessRuntimeReadiness({
    repoRoot,
    runtimeConfig: runtime,
    llmConfig: existingLLM,
    llmConfigPath,
    uiTarget: options.uiTarget,
    uiOptions,
    preferCli,
    enabledFeatures: DEFAULT_ENABLED_FEATURES,
  });

  let llmStatus: EnsureRuntimeReadyResult['llmStatus'] = isUsableLLMConfig(existingLLM) ? 'unchanged' : 'manual_required';
  let llmMode: EnsureRuntimeReadyResult['llmMode'] = existingLLM?.mode || 'unknown';

  if (initialReadiness.repository.status === 'blocked') {
    const initialMessages = deriveReadinessMessages(initialReadiness);
    return {
      ready: false,
      readiness: initialReadiness,
      appName,
      selectedUI,
      llmConfigPath,
      llmMode,
      llmStatus,
      workspaceStatus: 'unchanged',
      workspaceAppPath: workspacePaths.projectRepoPath,
      workspaceWorktreesPath: workspacePaths.worktreesRootPath,
      guardrailsCreatedOrUpdated: 0,
      guardrailsUnchanged: 0,
      guardrailsSkipped: 0,
      missingRequiredTools: coreTools.requiredMissing,
      missingOptionalTools: coreTools.optionalMissing,
      warnings: initialMessages.warnings,
      pendingActions: initialMessages.pendingActions,
    };
  }

  const selectedCliCommand = selectedUI?.cliCommand;
  const selectedCliReady = Boolean(selectedUI?.available && selectedCliCommand && isCommandAvailable(selectedCliCommand));

  const nextLLM = existingLLM;
  if (!isUsableLLMConfig(existingLLM)) {
    llmStatus = 'manual_required';
    llmMode = existingLLM?.mode || 'unknown';
  }

  let executionUI: UIChoice | undefined;
  if (selectedUI) {
    executionUI = selectedUI.ui;
  }

  if (executionUI) {
    const nextRuntime: RuntimeConfig = {
      ...runtime,
      execution: {
        ...runtime.execution,
        templateId: templateFromUI(executionUI),
        allowedCommands: mergeAllowedCommands(runtime.execution.allowedCommands || [], executionUI),
        allowUnsafeRawCommand: false,
      },
    };
    saveRuntimeConfig(nextRuntime);
  }

  const previousAppPath = runtime.workspace.projectRepoPath ? path.resolve(runtime.workspace.projectRepoPath) : '';
  const previousWorktreesPath = runtime.workspace.worktreesRootPath
    ? path.resolve(runtime.workspace.worktreesRootPath)
    : '';

  const workspace = bootstrapWorkspace({
    appName,
    appRepoPath: workspacePaths.projectRepoPath,
    worktreesRootPath: workspacePaths.worktreesRootPath,
    createIfMissing: true,
  });

  const createdOrUpdated = workspace.guardrails.filter(
    (item) => item.status === 'created' || item.status === 'updated',
  ).length;
  const unchanged = workspace.guardrails.filter((item) => item.status === 'unchanged').length;
  const skipped = workspace.guardrails.filter((item) => item.status === 'skipped').length;

  const workspaceChanged =
    workspace.createdDirectories.length > 0 ||
    createdOrUpdated > 0 ||
    previousAppPath !== path.resolve(workspace.appRepoPath) ||
    previousWorktreesPath !== path.resolve(workspace.worktreesRootPath);
  const workspaceStatus: EnsureRuntimeReadyResult['workspaceStatus'] = workspaceChanged ? 'configured' : 'unchanged';

  let scaffold: AppScaffoldResult | undefined;
  if (options.scaffoldMode && options.scaffoldMode !== 'none') {
    scaffold = scaffoldAppRepository({
      appName,
      appRepoPath: workspace.appRepoPath,
      worktreesRootPath: workspace.worktreesRootPath,
      mode: options.scaffoldMode,
      customStackNotes: options.customStackNotes,
    });
  }

  const finalReadiness = assessRuntimeReadiness({
    repoRoot,
    runtimeConfig: loadRuntimeConfig(),
    llmConfig: nextLLM,
    llmConfigPath,
    uiTarget: options.uiTarget,
    uiOptions,
    preferCli,
    enabledFeatures: DEFAULT_ENABLED_FEATURES,
  });
  const readinessMessages = deriveReadinessMessages(finalReadiness);
  const warnings = [...readinessMessages.warnings];

  return {
    ready: finalReadiness.ready,
    readiness: finalReadiness,
    appName,
    selectedUI,
    llmConfigPath,
    llmMode,
    llmStatus,
    workspaceStatus,
    workspaceAppPath: workspace.appRepoPath,
    workspaceWorktreesPath: workspace.worktreesRootPath,
    guardrailsCreatedOrUpdated: createdOrUpdated,
    guardrailsUnchanged: unchanged,
    guardrailsSkipped: skipped,
    missingRequiredTools: coreTools.requiredMissing,
    missingOptionalTools: coreTools.optionalMissing,
    warnings: dedupeStrings(warnings),
    pendingActions: readinessMessages.pendingActions,
    scaffold,
  };
}

export function assessRuntimeReadiness(
  options: RuntimeReadinessAssessmentOptions = {},
): RuntimeReadinessReport {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const runtime = options.runtimeConfig || loadRuntimeConfig();
  const runtimeConfigPath = path.resolve(options.runtimeConfigPath || path.join(repoRoot, 'config', 'runtime.json'));
  const llmConfigPath = path.resolve(options.llmConfigPath || path.join(repoRoot, 'config', 'llm.json'));
  const llmConfig = options.llmConfig ?? readLLMConfig(llmConfigPath);
  const uiOptions = options.uiOptions || detectUITargetOptions();
  const selectedUI = resolveSelectedUI(uiOptions, options.uiTarget);
  const enabledFeatures = resolveEnabledReadinessFeatures(options.enabledFeatures);
  const commandExistsFn = options.commandExistsFn || commandExists;
  const preferCli = options.preferCli !== false;

  const controlRoot = resolveLocalS2SControlRoot();
  const runtimeRoot = resolveLocalS2SRuntimeRoot(controlRoot);
  const worktreesRoot = resolveLocalS2SWorktreesRoot({ controlRoot });
  const runtimeConfigProbe = probeJsonConfig(runtimeConfigPath);
  const llmConfigProbe = probeJsonConfig(llmConfigPath);
  const runtimeWorkspaceConfigured =
    Boolean(runtime.workspace.projectRepoPath && runtime.workspace.worktreesRootPath);
  const selectedCliReady = Boolean(
    selectedUI?.available && selectedUI.cliCommand && isCommandAvailableWithResolver(selectedUI.cliCommand, commandExistsFn),
  );

  const checks: ReadinessCheck[] = [
    ...buildCoreToolChecks(commandExistsFn),
    {
      id: 'machine.local_runtime_roots',
      scope: 'machine',
      requirement: 'required',
      status: canWritePathTarget(controlRoot) && canWritePathTarget(runtimeRoot) && canWritePathTarget(worktreesRoot)
        ? 'ready'
        : 'blocked',
      label: 'Local runtime roots',
      summary:
        canWritePathTarget(controlRoot) && canWritePathTarget(runtimeRoot) && canWritePathTarget(worktreesRoot)
          ? 'Local `~/.s2s` runtime roots can be created or updated.'
          : 'Local `~/.s2s` runtime roots are not writable.',
      reason:
        canWritePathTarget(controlRoot) && canWritePathTarget(runtimeRoot) && canWritePathTarget(worktreesRoot)
          ? `Control root ${controlRoot} and related runtime paths are writable.`
          : `S2S needs write access to ${controlRoot} to manage local runtime state.`,
      remediation:
        canWritePathTarget(controlRoot) && canWritePathTarget(runtimeRoot) && canWritePathTarget(worktreesRoot)
          ? undefined
          : `Restore write access to ${controlRoot} or choose a writable local environment before running s2s init.`,
    },
    {
      id: 'repository.supported_context',
      scope: 'repository',
      requirement: 'required',
      status: detectRepositoryRole(repoRoot) === 'user-project' ? 'ready' : 'blocked',
      label: 'Supported repository context',
      summary:
        detectRepositoryRole(repoRoot) === 'user-project'
          ? 'Current repository can be managed as an S2S user project.'
          : 'Current repository is the spec-to-ship source repo and cannot be initialized as a user project.',
      reason:
        detectRepositoryRole(repoRoot) === 'user-project'
          ? `Repository root ${repoRoot} is eligible for user-project initialization.`
          : buildSourceRepoManagedProjectError(repoRoot, 'bootstrap readiness'),
      remediation:
        detectRepositoryRole(repoRoot) === 'user-project'
          ? undefined
          : 'Run readiness/init flows in an external app or test repository instead of the spec-to-ship source repo.',
    },
    {
      id: 'repository.runtime_config',
      scope: 'repository',
      requirement: 'required',
      status: resolveConfigStatus(runtimeConfigProbe),
      label: 'Runtime config health',
      summary: describeConfigSummary('Runtime config', runtimeConfigProbe, 'created by init as needed'),
      reason: describeConfigReason(runtimeConfigPath, runtimeConfigProbe),
      remediation: describeConfigRemediation(runtimeConfigPath, runtimeConfigProbe),
    },
    {
      id: 'feature.workspace_bootstrap',
      scope: 'feature',
      feature: 'workspace_bootstrap',
      requirement: 'enabled_feature',
      status: !enabledFeatures.includes('workspace_bootstrap')
        ? 'not_applicable'
        : resolveWorkspaceBootstrapStatus(runtime, repoRoot),
      label: FEATURE_LABELS.workspace_bootstrap,
      summary: describeWorkspaceBootstrapSummary(runtime, repoRoot, enabledFeatures.includes('workspace_bootstrap')),
      reason: describeWorkspaceBootstrapReason(runtime, repoRoot),
      remediation: describeWorkspaceBootstrapRemediation(runtime, enabledFeatures.includes('workspace_bootstrap')),
    },
    {
      id: 'feature.ui_target',
      scope: 'feature',
      feature: 'ui_target',
      requirement: 'enabled_feature',
      status: !enabledFeatures.includes('ui_target')
        ? 'not_applicable'
        : selectedUI?.available
          ? 'ready'
          : 'action_required',
      label: FEATURE_LABELS.ui_target,
      summary: !enabledFeatures.includes('ui_target')
        ? 'Preferred UI readiness is not part of this assessment.'
        : selectedUI?.available
          ? `Preferred UI target '${selectedUI.label}' is available.`
          : 'No supported conversational UI target is ready yet.',
      reason: !enabledFeatures.includes('ui_target')
        ? 'This assessment did not request UI-target validation.'
        : selectedUI
          ? selectedUI.notes
          : 'No supported Codex, Claude, or OpenCode target was detected.',
      remediation: !enabledFeatures.includes('ui_target')
        ? undefined
        : 'Install or expose a supported Codex, Claude, or OpenCode CLI/Desktop bridge before expecting client-specific readiness.',
    },
    {
      id: 'feature.llm_access',
      scope: 'feature',
      feature: 'llm_access',
      requirement: 'enabled_feature',
      status: !enabledFeatures.includes('llm_access')
        ? 'not_applicable'
        : llmConfigProbe.exists && !llmConfigProbe.valid
          ? 'blocked'
          : isUsableLLMConfig(llmConfig, commandExistsFn)
            ? 'ready'
            : 'action_required',
      label: FEATURE_LABELS.llm_access,
      summary: describeLLMSummary({
        enabled: enabledFeatures.includes('llm_access'),
        llmConfigProbe,
        llmConfig,
        preferCli,
        selectedUI,
        selectedCliReady,
      }),
      reason: describeLLMReason({
        llmConfigPath,
        llmConfigProbe,
        llmConfig,
        preferCli,
        selectedUI,
        selectedCliReady,
      }),
      remediation: describeLLMRemediation({
        enabled: enabledFeatures.includes('llm_access'),
        llmConfigPath,
        llmConfigProbe,
        preferCli,
        selectedUI,
        selectedCliReady,
      }),
    },
    {
      id: 'feature.worktree_native',
      scope: 'feature',
      feature: 'worktree_native',
      requirement: 'enabled_feature',
      status: !enabledFeatures.includes('worktree_native')
        ? 'not_applicable'
        : commandExistsFn('git') && canWritePathTarget(worktreesRoot)
          ? 'ready'
          : 'blocked',
      label: FEATURE_LABELS.worktree_native,
      summary: !enabledFeatures.includes('worktree_native')
        ? 'Native worktree readiness is not part of this assessment.'
        : commandExistsFn('git') && canWritePathTarget(worktreesRoot)
          ? 'Native git worktree support is available.'
          : 'Native git worktree support cannot be used yet.',
      reason: !enabledFeatures.includes('worktree_native')
        ? 'This assessment did not request native worktree validation.'
        : commandExistsFn('git')
          ? `Git is available and ${worktreesRoot} is writable for native worktree sessions.`
          : 'Git is required to manage native worktrees.',
      remediation: !enabledFeatures.includes('worktree_native')
        ? undefined
        : commandExistsFn('git')
          ? `Restore write access to ${worktreesRoot}.`
          : 'Install Git before enabling native worktree execution.',
    },
    {
      id: 'feature.worktree_worktrunk',
      scope: 'feature',
      feature: 'worktree_worktrunk',
      requirement: 'enabled_feature',
      status: !enabledFeatures.includes('worktree_worktrunk')
        ? 'not_applicable'
        : commandExistsFn('wt')
          ? 'ready'
          : 'action_required',
      label: FEATURE_LABELS.worktree_worktrunk,
      summary: !enabledFeatures.includes('worktree_worktrunk')
        ? 'Worktrunk readiness is not part of this assessment.'
        : commandExistsFn('wt')
          ? 'Worktrunk is available for managed worktree sessions.'
          : 'Worktrunk is not installed yet.',
      reason: !enabledFeatures.includes('worktree_worktrunk')
        ? 'This assessment did not request Worktrunk validation.'
        : commandExistsFn('wt')
          ? 'The `wt` command is available in PATH.'
          : 'The `wt` command is required when the Worktrunk provider is enabled.',
      remediation: !enabledFeatures.includes('worktree_worktrunk')
        ? undefined
        : 'Install Worktrunk or switch to the native worktree provider before enabling Worktrunk-backed sessions.',
    },
  ];

  const machine = summarizeReadinessChecks(checks.filter((check) => check.scope === 'machine'));
  const repository = summarizeReadinessChecks(checks.filter((check) => check.scope === 'repository'));
  const features = enabledFeatures.map((feature) =>
    summarizeFeatureReadiness(feature, checks.filter((check) => check.feature === feature)),
  );
  const overall = summarizeReadinessChecks([
    ...checks.filter((check) => check.scope === 'machine' || check.scope === 'repository'),
    ...checks.filter((check) => check.scope === 'feature' && enabledFeatures.includes(check.feature as ReadinessFeature)),
  ]);

  return {
    ready: overall.ready,
    status: overall.status,
    repoRoot,
    controlRoot,
    runtimeRoot,
    worktreesRoot,
    enabledFeatures,
    checks,
    machine,
    repository,
    features,
  };
}

export function assessLightweightPrerequisites(
  options: LightweightPrerequisiteCheckOptions = {},
): LightweightPrerequisiteReport {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const s2sDir = path.join(repoRoot, '.s2s');
  const configDir = path.join(s2sDir, 'config');
  const runtimeConfigPath = path.resolve(options.runtimeConfigPath || path.join(configDir, 'runtime.json'));
  const runtimeConfig = options.runtimeConfig || readJsonConfig<RuntimeConfig>(runtimeConfigPath) || createExpectedProjectRuntimeConfig(repoRoot);
  const localStatePresent = existsSync(s2sDir);
  const readiness = assessRuntimeReadiness({
    repoRoot,
    runtimeConfig,
    runtimeConfigPath,
    enabledFeatures: LIGHTWEIGHT_ENABLED_FEATURES,
    commandExistsFn: options.commandExistsFn,
  });
  const messages = deriveReadinessMessages(readiness);
  const blockingChecks = collectReadinessChecksByStatus(readiness, 'blocked');
  const actionRequiredChecks = collectReadinessChecksByStatus(readiness, 'action_required');
  const repositoryInitialized = localStatePresent && isRepositoryInitialized(readiness);

  return {
    ready: readiness.ready,
    repoRoot,
    s2sDir,
    configDir,
    localStatePresent,
    repositoryInitialized,
    status: readiness.status,
    summary: summarizeLightweightPrerequisites(readiness, localStatePresent, repositoryInitialized, messages.warnings.length > 0),
    recommendedCommand: resolveLightweightRecommendedCommand(
      readiness,
      localStatePresent,
      repositoryInitialized,
      messages.warnings.length > 0,
    ),
    readiness,
    blockingChecks,
    actionRequiredChecks,
    warnings: messages.warnings,
    pendingActions: messages.pendingActions,
  };
}

export function resolveEnabledReadinessFeatures(features?: ReadinessFeature[]): ReadinessFeature[] {
  const source = Array.isArray(features) && features.length > 0 ? features : DEFAULT_ENABLED_FEATURES;
  const enabled = new Set<ReadinessFeature>();

  for (const feature of source) {
    if (feature in FEATURE_LABELS) {
      enabled.add(feature);
    }
  }

  return Array.from(enabled);
}

export function summarizeReadinessChecks(checks: ReadinessCheck[]): ReadinessSummaryBucket {
  const applicable = checks.filter((check) => check.status !== 'not_applicable');
  const checkIds = applicable.map((check) => check.id);
  const blockingCheckIds = applicable
    .filter((check) => check.requirement !== 'optional' && check.status === 'blocked')
    .map((check) => check.id);
  const actionRequiredCheckIds = applicable
    .filter((check) => check.requirement !== 'optional' && check.status === 'action_required')
    .map((check) => check.id);
  const warningCheckIds = applicable
    .filter((check) => check.requirement === 'optional' && check.status !== 'ready')
    .map((check) => check.id);

  let status: ReadinessStatus = 'not_applicable';
  if (blockingCheckIds.length > 0) {
    status = 'blocked';
  } else if (actionRequiredCheckIds.length > 0) {
    status = 'action_required';
  } else if (applicable.length > 0) {
    status = 'ready';
  }

  return {
    status,
    ready: status === 'ready' || status === 'not_applicable',
    checkIds,
    blockingCheckIds,
    actionRequiredCheckIds,
    warningCheckIds,
  };
}

export function checkCoreTools(commandExistsFn: (command: string) => boolean = commandExists): CoreToolCheck {
  const required = ['node', 'npm', 'git', 'just'];
  const optional = ['gh'];
  const requiredMissing = required.filter((tool) => !commandExistsFn(tool));
  const optionalMissing = optional.filter((tool) => !commandExistsFn(tool));
  return { requiredMissing, optionalMissing };
}

function summarizeFeatureReadiness(
  feature: ReadinessFeature,
  checks: ReadinessCheck[],
): ReadinessFeatureSummary {
  const summary = summarizeReadinessChecks(checks);
  return {
    feature,
    label: FEATURE_LABELS[feature],
    ...summary,
  };
}

function buildCoreToolChecks(commandExistsFn: (command: string) => boolean): ReadinessCheck[] {
  return [
    buildToolReadinessCheck('node', true, commandExistsFn),
    buildToolReadinessCheck('npm', true, commandExistsFn),
    buildToolReadinessCheck('git', true, commandExistsFn),
    buildToolReadinessCheck('just', true, commandExistsFn),
    buildToolReadinessCheck('gh', false, commandExistsFn),
  ];
}

function buildToolReadinessCheck(
  tool: string,
  required: boolean,
  commandExistsFn: (command: string) => boolean,
): ReadinessCheck {
  const available = commandExistsFn(tool);
  return {
    id: `machine.tool.${tool}`,
    scope: 'machine',
    requirement: required ? 'required' : 'optional',
    status: available ? 'ready' : required ? 'blocked' : 'action_required',
    label: `${tool} availability`,
    summary: available
      ? `${tool} is installed.`
      : required
        ? `${tool} is required but missing.`
        : `${tool} is optional and not installed.`,
    reason: available
      ? `The \`${tool}\` command is available in PATH.`
      : required
        ? `The \`${tool}\` command is required for core S2S flows.`
        : `The \`${tool}\` command enables optional GitHub-related workflows.`,
    remediation: available ? undefined : `Install ${tool} and ensure it is available in PATH.`,
  };
}

function collectReadinessChecksByStatus(
  report: RuntimeReadinessReport,
  status: Exclude<ReadinessStatus, 'ready' | 'not_applicable'>,
): ReadinessCheck[] {
  return report.checks.filter((check) => check.requirement !== 'optional' && check.status === status);
}

function resolveExpectedWorkspacePaths(
  runtime: RuntimeConfig,
  appName: string,
): { projectRepoPath: string; worktreesRootPath: string } {
  const fallbackWorkdir = path.dirname(process.cwd());
  const projectRepoPath = path.resolve(runtime.workspace.projectRepoPath || path.resolve(fallbackWorkdir, appName));
  return {
    projectRepoPath,
    worktreesRootPath: path.resolve(
      runtime.workspace.worktreesRootPath || resolveLocalS2SRepoWorktreesRoot({ repoRoot: projectRepoPath }),
    ),
  };
}

function deriveReadinessMessages(report: RuntimeReadinessReport): { warnings: string[]; pendingActions: string[] } {
  const warnings: string[] = [];
  const pendingActions: string[] = [];

  for (const check of report.checks) {
    if (check.status === 'ready' || check.status === 'not_applicable') continue;
    const message = `${check.label}: ${check.remediation || check.reason}`;
    if (check.requirement === 'optional') {
      warnings.push(message);
    } else {
      pendingActions.push(message);
    }
  }

  return {
    warnings: dedupeStrings(warnings),
    pendingActions: dedupeStrings(pendingActions),
  };
}

function isRepositoryInitialized(report: RuntimeReadinessReport): boolean {
  const runtimeConfigReady = hasCheckStatus(report, 'repository.runtime_config', 'ready');
  const workspaceReady =
    !report.enabledFeatures.includes('workspace_bootstrap')
    || hasCheckStatus(report, 'feature.workspace_bootstrap', 'ready');
  return runtimeConfigReady && workspaceReady;
}

function summarizeLightweightPrerequisites(
  report: RuntimeReadinessReport,
  localStatePresent: boolean,
  repositoryInitialized: boolean,
  hasWarnings: boolean,
): string {
  if (hasCheckStatus(report, 'repository.supported_context', 'blocked')) {
    return 'Current repository is not eligible for S2S initialization.';
  }

  if (report.checks.some((check) => check.scope === 'machine' && check.requirement !== 'optional' && check.status === 'blocked')) {
    return 'Local environment is missing required prerequisites for S2S.';
  }

  if (!localStatePresent) {
    return 'Repository is not initialized for S2S yet.';
  }

  if (!repositoryInitialized || hasCheckIssue(report, 'repository.runtime_config') || hasCheckIssue(report, 'feature.workspace_bootstrap')) {
    return 'Repository has S2S initialization issues that need repair.';
  }

  if (hasWarnings) {
    return 'Repository passed lightweight prerequisite checks with optional warnings.';
  }

  return 'Repository passed lightweight prerequisite checks.';
}

function resolveLightweightRecommendedCommand(
  report: RuntimeReadinessReport,
  localStatePresent: boolean,
  repositoryInitialized: boolean,
  hasWarnings: boolean,
): LightweightPrerequisiteReport['recommendedCommand'] {
  if (hasCheckStatus(report, 'repository.supported_context', 'blocked')) {
    return undefined;
  }

  if (report.checks.some((check) => check.scope === 'machine' && check.requirement !== 'optional' && check.status === 'blocked')) {
    return undefined;
  }

  if (!localStatePresent || !repositoryInitialized || hasCheckIssue(report, 'repository.runtime_config') || hasCheckIssue(report, 'feature.workspace_bootstrap')) {
    return 's2s init';
  }

  if (hasWarnings) {
    return 's2s doctor';
  }

  return 's2s stage pm';
}

function readJsonConfig<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function hasCheckIssue(report: RuntimeReadinessReport, checkId: string): boolean {
  return report.checks.some((check) => check.id === checkId && (check.status === 'blocked' || check.status === 'action_required'));
}

function hasCheckStatus(report: RuntimeReadinessReport, checkId: string, status: ReadinessStatus): boolean {
  return report.checks.some((check) => check.id === checkId && check.status === status);
}

function readLLMConfig(configPath: string): LLMProviderConfig | undefined {
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as LLMProviderConfig;
  } catch {
    return undefined;
  }
}

function writeLLMConfig(configPath: string, config: LLMProviderConfig): void {
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function isUsableLLMConfig(
  config?: LLMProviderConfig,
  _commandExistsFn: (command: string) => boolean = commandExists,
): boolean {
  if (!config) return false;
  const mode = config.mode || 'api';
  const provider = config.provider || 'anthropic';
  const apiKeyEnvVar =
    config.apiKeyEnvVar ||
    (provider === 'openai' || mode === 'openai_compatible' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY');
  return Boolean(process.env[apiKeyEnvVar]);
}

function deriveAppName(appName?: string, idea?: string, runtimeProjectName?: string): string {
  const fromArg = normalizeName(appName || '');
  if (fromArg !== 'my-app') return fromArg;

  const fromRuntime = normalizeName(runtimeProjectName || '');
  if (fromRuntime !== 'my-app') return fromRuntime;

  const fromIdea = normalizeName(idea || '');
  if (fromIdea !== 'my-app') return fromIdea;

  return 'my-app';
}

function normalizeName(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return normalized || 'my-app';
}

function resolveSelectedUI(options: UITargetOption[], preferredTarget?: UITarget): UITargetOption | undefined {
  const defaultTarget = pickDefaultUITarget(options);
  return (
    options.find((option) => option.id === preferredTarget) ||
    options.find((option) => option.id === defaultTarget)
  );
}

function probeJsonConfig(configPath: string): JsonConfigProbe {
  const exists = existsSync(configPath);
  const writable = canWritePathTarget(configPath);

  if (!exists) {
    return {
      exists: false,
      valid: false,
      writable,
    };
  }

  try {
    JSON.parse(readFileSync(configPath, 'utf8'));
    return {
      exists: true,
      valid: true,
      writable,
    };
  } catch (error) {
    return {
      exists: true,
      valid: false,
      writable,
      error: String(error instanceof Error ? error.message : error),
    };
  }
}

function canWritePathTarget(targetPath: string): boolean {
  let current = path.resolve(targetPath);

  if (!existsSync(current)) {
    current = path.dirname(current);
  }

  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }

  try {
    accessSync(current, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveConfigStatus(probe: JsonConfigProbe): ReadinessStatus {
  if (probe.exists && probe.valid) return 'ready';
  if (probe.exists && !probe.valid) return 'blocked';
  return probe.writable ? 'action_required' : 'blocked';
}

function describeConfigSummary(label: string, probe: JsonConfigProbe, missingSummary: string): string {
  if (probe.exists && probe.valid) return `${label} is valid.`;
  if (probe.exists && !probe.valid) return `${label} exists but is invalid JSON.`;
  return `${label} is missing and must be ${missingSummary}.`;
}

function describeConfigReason(configPath: string, probe: JsonConfigProbe): string {
  if (probe.exists && probe.valid) return `${configPath} parsed successfully.`;
  if (probe.exists && !probe.valid) return `${configPath} could not be parsed: ${probe.error || 'invalid JSON'}.`;
  if (probe.writable) return `${configPath} does not exist yet, but the repository can create it.`;
  return `${configPath} is missing and its parent path is not writable.`;
}

function describeConfigRemediation(configPath: string, probe: JsonConfigProbe): string {
  if (probe.exists && probe.valid) return '';
  if (probe.exists && !probe.valid) {
    return `Repair ${configPath} so it contains valid JSON before continuing.`;
  }
  if (probe.writable) {
    return `Run s2s init to create ${configPath}.`;
  }
  return `Restore write access so ${configPath} can be created during initialization.`;
}

function resolveWorkspaceBootstrapStatus(runtime: RuntimeConfig, repoRoot: string): ReadinessStatus {
  if (!runtime.workspace.projectRepoPath || !runtime.workspace.worktreesRootPath) {
    return 'action_required';
  }

  const projectRepoPath = path.resolve(runtime.workspace.projectRepoPath);
  if (detectRepositoryRole(projectRepoPath) !== 'user-project') {
    return 'blocked';
  }

  const worktreesRootPath = path.resolve(runtime.workspace.worktreesRootPath);
  if (!canWritePathTarget(worktreesRootPath)) {
    return 'blocked';
  }

  return repoRoot && projectRepoPath ? 'ready' : 'action_required';
}

function describeWorkspaceBootstrapSummary(
  runtime: RuntimeConfig,
  repoRoot: string,
  enabled: boolean,
): string {
  if (!enabled) return 'Workspace bootstrap readiness is not part of this assessment.';
  if (!runtime.workspace.projectRepoPath || !runtime.workspace.worktreesRootPath) {
    return 'Workspace repo/worktree paths are not configured yet.';
  }

  const projectRepoPath = path.resolve(runtime.workspace.projectRepoPath);
  if (detectRepositoryRole(projectRepoPath) !== 'user-project') {
    return 'Workspace configuration points at an unsupported repository target.';
  }

  if (!canWritePathTarget(runtime.workspace.worktreesRootPath)) {
    return 'Configured worktree root is not writable.';
  }

  return repoRoot ? 'Workspace repo/worktree paths are configured.' : 'Workspace repo/worktree paths are configured.';
}

function describeWorkspaceBootstrapReason(runtime: RuntimeConfig, repoRoot: string): string {
  if (!runtime.workspace.projectRepoPath || !runtime.workspace.worktreesRootPath) {
    return 'Runtime config does not yet pin the managed app repository path and worktrees root.';
  }

  const projectRepoPath = path.resolve(runtime.workspace.projectRepoPath);
  const worktreesRootPath = path.resolve(runtime.workspace.worktreesRootPath);
  if (detectRepositoryRole(projectRepoPath) !== 'user-project') {
    return buildSourceRepoManagedProjectError(projectRepoPath, 'target the configured workspace repository');
  }
  if (!canWritePathTarget(worktreesRootPath)) {
    return `Configured worktrees root ${worktreesRootPath} is not writable.`;
  }
  return `Workspace config points from orchestrator root ${repoRoot} to app repo ${projectRepoPath} and worktrees root ${worktreesRootPath}.`;
}

function describeWorkspaceBootstrapRemediation(runtime: RuntimeConfig, enabled: boolean): string | undefined {
  if (!enabled) return undefined;
  if (!runtime.workspace.projectRepoPath || !runtime.workspace.worktreesRootPath) {
    return 'Run s2s init to choose the managed app repository path and worktrees root.';
  }
  const projectRepoPath = path.resolve(runtime.workspace.projectRepoPath);
  if (detectRepositoryRole(projectRepoPath) !== 'user-project') {
    return 'Point workspace.projectRepoPath at an external user project instead of the spec-to-ship source repo.';
  }
  if (!canWritePathTarget(runtime.workspace.worktreesRootPath)) {
    return `Restore write access to ${path.resolve(runtime.workspace.worktreesRootPath)}.`;
  }
  return undefined;
}

function describeLLMSummary(input: {
  enabled: boolean;
  llmConfigProbe: JsonConfigProbe;
  llmConfig?: LLMProviderConfig;
  preferCli: boolean;
  selectedUI?: UITargetOption;
  selectedCliReady: boolean;
}): string {
  if (!input.enabled) return 'LLM access readiness is not part of this assessment.';
  if (input.llmConfigProbe.exists && !input.llmConfigProbe.valid) {
    return 'LLM config exists but is invalid JSON.';
  }
  if (isUsableLLMConfig(input.llmConfig)) {
    return 'LLM access is configured and usable.';
  }
  if (input.preferCli && input.selectedCliReady) {
    return 'A supported CLI bridge is available, but LLM access is not configured yet.';
  }
  return 'LLM access is not configured yet.';
}

function describeLLMReason(input: {
  llmConfigPath: string;
  llmConfigProbe: JsonConfigProbe;
  llmConfig?: LLMProviderConfig;
  preferCli: boolean;
  selectedUI?: UITargetOption;
  selectedCliReady: boolean;
}): string {
  if (input.llmConfigProbe.exists && !input.llmConfigProbe.valid) {
    return `${input.llmConfigPath} could not be parsed: ${input.llmConfigProbe.error || 'invalid JSON'}.`;
  }
  if (isUsableLLMConfig(input.llmConfig)) {
    return 'Configured API credentials are available in the environment.';
  }
  if (input.preferCli && input.selectedUI && input.selectedCliReady) {
    return `${input.selectedUI.label} is available, so s2s init can configure CLI-backed access automatically.`;
  }
  if (input.selectedUI && !input.selectedUI.available) {
    return `${input.selectedUI.label} is not ready yet, so no preferred client bridge is available for LLM setup.`;
  }
  return `${input.llmConfigPath} is missing or incomplete, and no usable LLM configuration is active yet.`;
}

function describeLLMRemediation(input: {
  enabled: boolean;
  llmConfigPath: string;
  llmConfigProbe: JsonConfigProbe;
  preferCli: boolean;
  selectedUI?: UITargetOption;
  selectedCliReady: boolean;
}): string | undefined {
  if (!input.enabled) return undefined;
  if (input.llmConfigProbe.exists && !input.llmConfigProbe.valid) {
    return `Repair ${input.llmConfigPath} so it contains valid JSON before continuing.`;
  }
  if (input.preferCli && input.selectedUI && input.selectedCliReady) {
    return `Run s2s init or ensure-ready so ${input.selectedUI.label} can be written into ${input.llmConfigPath}.`;
  }
  return 'Run `s2s config edit` in a project context to configure API, CLI, or OpenAI-compatible access.';
}

function isCommandAvailableWithResolver(
  command: string,
  commandExistsFn: (command: string) => boolean,
): boolean {
  if (command.includes('/') || command.startsWith('.')) {
    return isCommandAvailable(command);
  }
  return commandExistsFn(command);
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}
