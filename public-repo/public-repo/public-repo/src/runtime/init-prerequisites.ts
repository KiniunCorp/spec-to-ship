import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assessRuntimeReadiness,
  createExpectedProjectRuntimeConfig,
  resolveEnabledReadinessFeatures,
} from './readiness.js';
import {
  detectUITargetOptions,
  type UITarget,
  type UITargetOption,
} from './ui-targets.js';
import type {
  InitPrerequisiteReport,
  LLMProviderConfig,
  ReadinessCheck,
  ReadinessFeature,
  ReadinessStatus,
  RuntimeConfig,
} from '../types/index.js';

const DEFAULT_INIT_FEATURES: ReadinessFeature[] = [
  'ui_target',
  'llm_access',
  'workspace_bootstrap',
  'worktree_native',
  'worktree_worktrunk',
];

const REQUIRED_INIT_FEATURES = new Set<ReadinessFeature>([
  'ui_target',
  'llm_access',
  'workspace_bootstrap',
]);

export interface InitPrerequisiteAssessmentOptions {
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

export function assessInitPrerequisites(
  options: InitPrerequisiteAssessmentOptions = {},
): InitPrerequisiteReport {
  const repoRoot = path.resolve(options.repoRoot || process.cwd());
  const s2sDir = path.join(repoRoot, '.s2s');
  const configDir = path.join(s2sDir, 'config');
  const runtimeConfigPath = path.resolve(options.runtimeConfigPath || path.join(configDir, 'runtime.json'));
  const llmConfigPath = path.resolve(options.llmConfigPath || path.join(configDir, 'llm.json'));
  const enabledFeatures = resolveEnabledReadinessFeatures(options.enabledFeatures || DEFAULT_INIT_FEATURES);
  const uiOptions = options.uiOptions || detectUITargetOptions();
  const runtimeConfig =
    options.runtimeConfig
    || readJsonFile<RuntimeConfig>(runtimeConfigPath)
    || createExpectedProjectRuntimeConfig(repoRoot);
  const llmConfig = options.llmConfig ?? readJsonFile<LLMProviderConfig>(llmConfigPath);
  const readiness = assessRuntimeReadiness({
    repoRoot,
    runtimeConfig,
    runtimeConfigPath,
    llmConfig,
    llmConfigPath,
    uiTarget: options.uiTarget,
    uiOptions,
    preferCli: options.preferCli,
    enabledFeatures,
    commandExistsFn: options.commandExistsFn,
  });
  const repoLocalChecks = buildRepoLocalStateChecks(repoRoot, s2sDir, configDir);
  const allChecks = [...readiness.checks, ...repoLocalChecks];

  const blockingChecks = allChecks.filter((check) => classifyInitCheck(check) === 'blocking');
  const setupChecks = allChecks.filter((check) => classifyInitCheck(check) === 'setup');
  const warningChecks = allChecks.filter((check) => classifyInitCheck(check) === 'warning');
  const nextActions = dedupeStrings([
    ...blockingChecks.map((check) => check.remediation || check.reason),
    ...setupChecks.map((check) => check.remediation || check.reason),
  ]);
  const repositoryInitialized = repoLocalChecks.every((check) => check.status === 'ready' || check.status === 'not_applicable');
  const localStatePresent = existsSync(s2sDir);

  const status: ReadinessStatus =
    blockingChecks.length > 0 ? 'blocked' : setupChecks.length > 0 ? 'action_required' : 'ready';
  const summary = summarizeInitPrerequisites({
    canInitialize: blockingChecks.length === 0,
    localStatePresent,
    repositoryInitialized,
    setupChecks,
    warningChecks,
  });
  const readinessChecklist = buildInitReadinessChecklist(allChecks);
  const suggestedNextActions = buildSuggestedNextActions({
    canInitialize: blockingChecks.length === 0,
    localStatePresent,
    repositoryInitialized,
    blockingChecks,
    setupChecks,
    warningChecks,
  });

  return {
    ready: status === 'ready',
    canInitialize: blockingChecks.length === 0,
    status,
    summary,
    repoRoot,
    s2sDir,
    configDir,
    localStatePresent,
    repositoryInitialized,
    runtimeConfigPath,
    llmConfigPath,
    enabledFeatures,
    readiness,
    repoLocalChecks,
    blockingChecks,
    setupChecks,
    warningChecks,
    nextActions,
    readinessChecklist,
    suggestedNextActions,
  };
}

function classifyInitCheck(check: ReadinessCheck): 'ready' | 'blocking' | 'setup' | 'warning' {
  if (check.status === 'ready' || check.status === 'not_applicable') {
    return 'ready';
  }
  if (check.requirement === 'optional') {
    return 'warning';
  }
  if (check.feature && !REQUIRED_INIT_FEATURES.has(check.feature)) {
    return 'warning';
  }
  if (check.status === 'blocked') {
    return 'blocking';
  }
  return 'setup';
}

function buildRepoLocalStateChecks(repoRoot: string, s2sDir: string, configDir: string): ReadinessCheck[] {
  const supportConfigPaths = [
    path.join(configDir, 'execution.templates.json'),
    path.join(configDir, 'backup.policy.json'),
    path.join(configDir, 'governance.exceptions.json'),
  ];
  const guardrailPaths = [
    path.join(s2sDir, 'guardrails', 'AGENTS.md'),
    path.join(s2sDir, 'guardrails', 'CODEX.md'),
    path.join(s2sDir, 'guardrails', 'CLAUDE.md'),
  ];
  const stateDirs = [
    path.join(s2sDir, 'artifacts'),
    path.join(s2sDir, 'usage'),
    path.join(s2sDir, 'logs'),
    path.join(s2sDir, 'backups'),
  ];

  return [
    buildDirectoryCheck(
      'repository.s2s_directory',
      '.s2s local state directory',
      s2sDir,
      'Run s2s init to create the managed .s2s directory.',
    ),
    buildJsonBundleCheck(
      'repository.managed_project_state',
      'Managed project state files',
      [
        path.join(s2sDir, 'project.json'),
        path.join(s2sDir, 'project.local.json'),
      ],
      'Run s2s init to regenerate missing or invalid project state files.',
    ),
    buildJsonBundleCheck(
      'repository.supporting_configs',
      'Supporting init config files',
      supportConfigPaths,
      'Run s2s init to regenerate missing or invalid supporting config files.',
    ),
    buildFileBundleCheck(
      'repository.guardrails_bundle',
      'Managed guardrail bundle',
      guardrailPaths,
      'Run s2s init to regenerate the managed .s2s/guardrails bundle.',
    ),
    buildFileBundleCheck(
      'repository.scripts_bundle',
      'Managed helper scripts',
      [path.join(s2sDir, 'scripts', 'README.md')],
      'Run s2s init to restore the managed .s2s/scripts bundle.',
    ),
    buildDirectoryBundleCheck(
      'repository.runtime_state_directories',
      'Runtime state directories',
      stateDirs,
      'Run s2s init to recreate the managed runtime state directories under .s2s.',
    ),
    buildRootCompatibilityCheck(
      repoRoot,
      'AGENTS.md',
      '<!-- S2S_PROJECT_GUARDRAIL_START -->',
      'repository.root_agents_managed_block',
      'Root AGENTS compatibility block',
      'Run s2s init to reinstall the managed AGENTS.md compatibility block.',
    ),
    buildRootCompatibilityCheck(
      repoRoot,
      'CODEX.md',
      '<!-- S2S_CODEX_ADAPTER_START -->',
      'repository.root_codex_managed_block',
      'Root CODEX compatibility block',
      'Run s2s init to reinstall the managed CODEX.md compatibility block.',
    ),
    buildRootCompatibilityCheck(
      repoRoot,
      'CLAUDE.md',
      '<!-- S2S_CLAUDE_ADAPTER_START -->',
      'repository.root_claude_managed_block',
      'Root CLAUDE compatibility block',
      'Run s2s init to reinstall the managed CLAUDE.md compatibility block.',
    ),
  ];
}

function readJsonFile<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function buildDirectoryCheck(
  id: string,
  label: string,
  directoryPath: string,
  remediation: string,
): ReadinessCheck {
  if (existsSync(directoryPath)) {
    return {
      id,
      scope: 'repository',
      requirement: 'required',
      status: 'ready',
      label,
      summary: `${directoryPath} exists.`,
      reason: `${directoryPath} is present in the repository.`,
    };
  }

  return {
    id,
    scope: 'repository',
    requirement: 'required',
    status: canWritePathTarget(directoryPath) ? 'action_required' : 'blocked',
    label,
    summary: `${directoryPath} is missing.`,
    reason: canWritePathTarget(directoryPath)
      ? `${directoryPath} can be created during init repair.`
      : `${directoryPath} is missing and its parent path is not writable.`,
    remediation,
  };
}

function buildJsonBundleCheck(
  id: string,
  label: string,
  filePaths: string[],
  remediation: string,
): ReadinessCheck {
  const missing = filePaths.filter((filePath) => !existsSync(filePath));
  const invalid = filePaths.filter((filePath) => existsSync(filePath) && !isValidJsonFile(filePath));

  if (missing.length === 0 && invalid.length === 0) {
    return {
      id,
      scope: 'repository',
      requirement: 'required',
      status: 'ready',
      label,
      summary: `${label} are present and valid JSON.`,
      reason: filePaths.map((filePath) => path.basename(filePath)).join(', ') + ' parsed successfully.',
    };
  }

  const unwritable = [...missing, ...invalid].filter((filePath) => !canWritePathTarget(filePath));
  return {
    id,
    scope: 'repository',
    requirement: 'required',
    status: unwritable.length > 0 ? 'blocked' : 'action_required',
    label,
    summary: describeBundleSummary(missing, invalid),
    reason: describeBundleReason(missing, invalid, 'valid JSON'),
    remediation,
  };
}

function buildFileBundleCheck(
  id: string,
  label: string,
  filePaths: string[],
  remediation: string,
): ReadinessCheck {
  const missing = filePaths.filter((filePath) => !existsSync(filePath));
  if (missing.length === 0) {
    return {
      id,
      scope: 'repository',
      requirement: 'required',
      status: 'ready',
      label,
      summary: `${label} are present.`,
      reason: filePaths.map((filePath) => path.basename(filePath)).join(', ') + ' are present.',
    };
  }

  const unwritable = missing.filter((filePath) => !canWritePathTarget(filePath));
  return {
    id,
    scope: 'repository',
    requirement: 'required',
    status: unwritable.length > 0 ? 'blocked' : 'action_required',
    label,
    summary: describeBundleSummary(missing, [], 'missing files'),
    reason: describeBundleReason(missing, [], 'present'),
    remediation,
  };
}

function buildDirectoryBundleCheck(
  id: string,
  label: string,
  directoryPaths: string[],
  remediation: string,
): ReadinessCheck {
  const missing = directoryPaths.filter((directoryPath) => !existsSync(directoryPath));
  if (missing.length === 0) {
    return {
      id,
      scope: 'repository',
      requirement: 'required',
      status: 'ready',
      label,
      summary: `${label} are present.`,
      reason: directoryPaths.map((directoryPath) => path.basename(directoryPath)).join(', ') + ' are present.',
    };
  }

  const unwritable = missing.filter((directoryPath) => !canWritePathTarget(directoryPath));
  return {
    id,
    scope: 'repository',
    requirement: 'required',
    status: unwritable.length > 0 ? 'blocked' : 'action_required',
    label,
    summary: describeBundleSummary(missing, [], 'missing directories'),
    reason: describeBundleReason(missing, [], 'present'),
    remediation,
  };
}

function buildRootCompatibilityCheck(
  repoRoot: string,
  fileName: string,
  marker: string,
  id: string,
  label: string,
  remediation: string,
): ReadinessCheck {
  const filePath = path.join(repoRoot, fileName);
  const content = existsSync(filePath) ? safeReadFile(filePath) : '';
  const hasMarker = Boolean(content && content.includes(marker));
  if (hasMarker) {
    return {
      id,
      scope: 'repository',
      requirement: 'required',
      status: 'ready',
      label,
      summary: `${fileName} contains the managed compatibility block.`,
      reason: `${fileName} includes ${marker}.`,
    };
  }

  return {
    id,
    scope: 'repository',
    requirement: 'required',
    status: canWritePathTarget(filePath) ? 'action_required' : 'blocked',
    label,
    summary: `${fileName} is missing the managed compatibility block.`,
    reason: `${fileName} does not currently include ${marker}.`,
    remediation,
  };
}

function isValidJsonFile(filePath: string): boolean {
  try {
    JSON.parse(readFileSync(filePath, 'utf8'));
    return true;
  } catch {
    return false;
  }
}

function safeReadFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
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

function describeBundleSummary(
  missing: string[],
  invalid: string[],
  missingLabel = 'missing files',
): string {
  const details: string[] = [];
  if (missing.length > 0) {
    details.push(`${missingLabel}: ${missing.map((filePath) => path.basename(filePath)).join(', ')}`);
  }
  if (invalid.length > 0) {
    details.push(`invalid JSON: ${invalid.map((filePath) => path.basename(filePath)).join(', ')}`);
  }
  return details.join('; ');
}

function describeBundleReason(
  missing: string[],
  invalid: string[],
  healthyDescriptor: string,
): string {
  if (missing.length === 0 && invalid.length === 0) {
    return `All required files are ${healthyDescriptor}.`;
  }

  const details: string[] = [];
  if (missing.length > 0) {
    details.push(`missing: ${missing.join(', ')}`);
  }
  if (invalid.length > 0) {
    details.push(`invalid: ${invalid.join(', ')}`);
  }
  return details.join('; ');
}

function summarizeInitPrerequisites(options: {
  canInitialize: boolean;
  localStatePresent: boolean;
  repositoryInitialized: boolean;
  setupChecks: ReadinessCheck[];
  warningChecks: ReadinessCheck[];
}): string {
  if (!options.canInitialize) {
    return 'Required local prerequisites are blocking S2S initialization.';
  }
  if (!options.localStatePresent) {
    return 'Repository can be initialized for S2S.';
  }
  if (!options.repositoryInitialized) {
    return 'Repository has partial or damaged S2S state that can be repaired in place.';
  }
  if (options.setupChecks.length > 0) {
    return 'Repository is initialized, but readiness setup is still required before normal use.';
  }
  if (options.warningChecks.length > 0) {
    return 'Repository is initialized and ready for S2S with optional warnings.';
  }
  return 'Repository is initialized and ready for S2S.';
}

function buildInitReadinessChecklist(checks: ReadinessCheck[]) {
  const checksById = new Map(checks.map((check) => [check.id, check]));

  return [
    buildChecklistItem(
      'repository_initialized',
      'Repository initialized',
      ['repository.s2s_directory', 'repository.managed_project_state'],
      'Managed `.s2s` directory and project state files are present.',
      checksById,
    ),
    buildChecklistItem(
      'governance_configured',
      'Governance configured',
      [
        'repository.guardrails_bundle',
        'repository.root_agents_managed_block',
        'repository.root_codex_managed_block',
        'repository.root_claude_managed_block',
      ],
      'Managed guardrails and root compatibility shims are installed.',
      checksById,
    ),
    buildChecklistItem(
      'runtime_config_valid',
      'Runtime and config valid',
      ['repository.runtime_config', 'feature.workspace_bootstrap', 'feature.llm_access'],
      'Runtime config, workspace paths, and LLM access are configured.',
      checksById,
    ),
    buildChecklistItem(
      'artifacts_and_state_valid',
      'Artifacts and state directories valid',
      ['repository.supporting_configs', 'repository.scripts_bundle', 'repository.runtime_state_directories'],
      'Supporting configs, helper scripts, and runtime state directories are valid.',
      checksById,
    ),
    buildChecklistItem(
      'preferred_client_ready',
      'Repository ready for preferred AI client',
      ['feature.ui_target'],
      'A supported conversational UI target is available for this repository.',
      checksById,
    ),
  ];
}

function buildChecklistItem(
  id: string,
  label: string,
  checkIds: string[],
  successDetail: string,
  checksById: Map<string, ReadinessCheck>,
) {
  const relevantChecks = checkIds
    .map((checkId) => checksById.get(checkId))
    .filter((check): check is ReadinessCheck => Boolean(check));
  const failingChecks = relevantChecks.filter((check) => check.status !== 'ready' && check.status !== 'not_applicable');

  return {
    id,
    label,
    ready: failingChecks.length === 0,
    detail: failingChecks.length === 0
      ? successDetail
      : `Awaiting: ${dedupeStrings(failingChecks.map((check) => check.summary)).join(' ')}`,
  };
}

function buildSuggestedNextActions(options: {
  canInitialize: boolean;
  localStatePresent: boolean;
  repositoryInitialized: boolean;
  blockingChecks: ReadinessCheck[];
  setupChecks: ReadinessCheck[];
  warningChecks: ReadinessCheck[];
}): string[] {
  if (!options.canInitialize) {
    return dedupeStrings([
      ...options.blockingChecks.map((check) => check.remediation || check.reason),
      'Re-run `s2s init --check` after fixing the blocking prerequisites.',
    ]);
  }

  if (!options.localStatePresent) {
    return dedupeStrings([
      'Run `s2s init` to create the managed `.s2s` state for this repository.',
      ...options.setupChecks.map((check) => check.remediation || check.reason),
    ]);
  }

  if (!options.repositoryInitialized) {
    return dedupeStrings([
      'Run `s2s init` to repair the managed `.s2s` state in place.',
      ...options.setupChecks.map((check) => check.remediation || check.reason),
    ]);
  }

  if (options.setupChecks.length > 0) {
    return dedupeStrings([
      ...options.setupChecks.map((check) => check.remediation || check.reason),
      'Run `s2s init --check` after fixing the remaining readiness setup actions.',
    ]);
  }

  return dedupeStrings([
    'Run `s2s stage pm` to start the managed workflow for this repository.',
    options.warningChecks.length > 0
      ? 'Review the optional warnings below and run `s2s doctor` if you need those integrations.'
      : 'Run `s2s doctor` any time you want to re-check governance and readiness.',
  ]);
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}
