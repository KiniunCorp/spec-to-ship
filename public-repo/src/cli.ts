#!/usr/bin/env node
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { buildStageContext, getProjectStatus, getStageOutputFiles, initProject, recordStageCompletion, runStage } from './conductor/pipeline.js';
import { startEngineeringExecChatNativeRun } from './runtime/engineering-exec.js';
import { deriveAndPersistSlices, parseSliceDerivationInput } from './ledger/derive-slices.js';
import { createWorkGate } from './ledger/gate-lifecycle.js';
import { advanceStageOwnership, initializeSpec } from './orchestration/router.js';
import { listArtifactFiles, readArtifact } from './artifacts/store.js';
import {
  expandHomePath,
  userHomePath,
  resolvePotentialPath,
  resolveAppPath,
  normalizeComparablePath,
  globalS2SHomePath,
  globalRuntimeHomePath,
  globalWorktreesHomePath,
  defaultManagedWorktreesRootPath,
  managedLLMWorkspaceDir,
  ensureManagedLLMWorkspace,
  projectBackupKey,
  isPathEqualOrInside,
  findNearestProjectRoot,
  findGitTopLevel,
} from './cli/utils/paths.js';
import { compareSemver, parseSemver, formatFriendlyTimestamp } from './cli/utils/versioning.js';
import {
  readJsonFile,
  writeJsonFile,
  writeFileIfChanged,
  fileHasMarker,
  fileHasText,
  normalizeAlias,
} from './cli/utils/file-io.js';
import { createDefaultCLISharedFlags, getActiveCLIFlags, setActiveCLIFlags } from './cli/io/state.js';
import {
  SCRIPTED_PROMPT_INPUT_EXHAUSTED,
  askEnumeratedOption, askPrompt, askWithDefault,
  canPromptForMissingInput, confirmHumanApprovalCommand, confirmStateChangingCommand, consumeScriptedPromptAnswer,
  ensureScriptedPromptAnswersLoaded, failMissingPromptInput, hasInteractivePromptTerminal,
  parseBooleanInput, parsePositiveIntInput, promptYesNoInteractive, promptYesNoSync,
  readLineFromStdinSync, resolveEnumeratedAnswer,
} from './cli/io/prompts.js';
import { commandMeta, failCLI, printJson, printVerboseContext, setOutputCLIVersion, warnOrchestrator } from './cli/io/output.js';
import {
  SUPPORTED_STAGES,
  PIPELINE_PROGRESS_STAGES,
  PUBLIC_HELP_TOPICS,
  HIDDEN_HELP_TOPICS,
  HELP_TOPICS,
  SHOW_SUBJECTS,
  COMPLETION_SHELLS,
  ROOT_GUARDRAIL_START,
  ROOT_GUARDRAIL_END,
  ROOT_CODEX_ADAPTER_START,
  ROOT_CODEX_ADAPTER_END,
  ROOT_CLAUDE_ADAPTER_START,
  ROOT_CLAUDE_ADAPTER_END,
  ROOT_ADAPTER_FILES,
  DEFAULT_WRAPPER_PREFIX_TEMPLATE,
  type SupportedStage,
  type HelpTopic,
  type CompletionShell,
  type GuardrailPolicy,
  type GlobalRegistryProject,
  type GlobalRegistry,
  type ProjectMeta,
  type ProjectLocalState,
  type PendingProjectUpdateState,
  type ProjectUpdateRequirement,
  type EnsureProjectSetupOptions,
  type ResolvedProjectContext,
  type ManagedProjectSnapshot,
  type GlobalProjectBackupManifest,
  type ChatObservabilitySettings,
  type CLIInvocation,
  type ChatPermissionsState,
} from './cli/types.js';
import { writeLiveState, readLiveState } from './cli/live-state.js';
import { handleCompletionCommand } from './cli/handlers/completion.js';
import {
  dedupeAlias,
  loadRegistry,
  registryPath,
  removeProjectFromRegistryByPath,
  saveRegistry,
  setRegistryTemplateVersion,
  updateRegistryForProject,
} from './cli/project/registry.js';
import {
  defaultAllowedExecutionCommands,
  isSupportedStage,
  normalizePendingProjectUpdate, normalizeReleaseUpdateClass,
} from './cli/utils/client-provider.js';
import {
  defaultExecutionTemplates, defaultRuntimeConfig,
  readLocalState, writeLocalState,
} from './cli/project/config.js';
import {
  enforceGuardrailPolicyForExecution, getGovernanceConflictView,
  normalizeGuardrailPolicy, printGuardrailConflictSummary,
} from './cli/project/guardrails.js';
import {
  backupRootAdaptersBeforeMutation, buildManagedStateSignature, createGlobalProjectBackup,
  createProjectBackup, globalProjectBackupsDir, globalProjectBackupsRoot,
  hasManagedSnapshotDifference, isDuplicateOfLatestRootAdapterBackup,
  latestGlobalProjectBackupInfo, listFilesRecursively, maybeCreateStartupBackup,
  resolveProjectSnapshotId, resolveStartupBackupIntervalHours, setBackupCLIVersion,
  touchProjectLastUsed,
} from './cli/project/backups.js';
import { detectGuardrailConflicts, hasBlockingGuardrailConflict } from './runtime/guardrail-conflicts.js';
import { assessInitPrerequisites } from './runtime/init-prerequisites.js';
import { assessLightweightPrerequisites } from './runtime/readiness.js';
import { resolveOnboardingRoot } from './onboarding/root-resolver.js';
import { classifyOnboardingState } from './onboarding/state-machine.js';
import { renderUserProjectGovernance } from './governance/user-project/renderers.js';
import { generateProtocolContent } from './governance/protocol-generator.js';
import {
  resolveLocalS2SControlRoot,
  resolveLocalS2SRepoWorktreesRoot,
  resolveLocalS2SRuntimeRoot,
  resolveLocalS2SWorktreesRoot,
} from './runtime/worktree-provider.js';
import {
  addGovernanceException,
  ensureGovernanceExceptionsFile,
  readGovernanceExceptions,
  splitConflictsByExceptions,
} from './onboarding/governance-exceptions.js';
import {
  applyBackupRetention,
  ensureBackupPolicyFile,
  readBackupPolicy,
  shouldCreateBackupForEffectiveChange,
} from './onboarding/backup-policy.js';
import { writeOnboardingArtifacts, writeStageExecutionArtifact } from './onboarding/artifacts.js';
import { assertUserProjectTarget } from './runtime/repository-role.js';
import { commandExists } from './runtime/shell.js';
import { detectUIHintFromEnvironment, detectUITargetOptions, templateFromUI } from './runtime/ui-targets.js';
import {
  approveGate,
  deriveLedger,
  getChange,
  getGate,
  getRun,
  getSlice,
  getSpec,
  listChanges,
  listGates,
  listOpenRuns,
  listRuns,
  listSlices,
  listSpecs,
  rejectGate,
  resolveExecutableSliceSelection,
} from './ledger/index.js';
import {
  buildArtifactTreeFromLabels,
  buildArtifactTreeFromPaths,
  renderArtifactTree,
  renderBlocks,
  renderDoctorCheckMatrix,
  renderNextActionsBlock,
  renderPhaseProgressBlock,
  renderStatusBlock,
  renderSummaryBlock,
  renderWarningsBlock,
} from './output/renderers.js';
import type {
  CLISharedFlags,
  GuardrailConflict,
  InitPrerequisiteReport,
  LLMProviderConfig,
  OutputRendererPhaseStep,
  OutputRendererState,
  OutputRendererStatusItem,
  PipelineStage,
  ProjectStatus,
  ReadinessCheck,
  RuntimeConfig,
  WorkChange,
  WorkGate,
  WorkLedger,
  WorkRun,
  WorkSlice,
  WorkSpec,
} from './types/index.js';

const CLI_VERSION = '0.2.56';
const PROJECT_SCHEMA_VERSION = 1;
const TEMPLATE_VERSION = '0.2.56';
const DEFAULT_MIN_CLI_VERSION = '0.2.56';
const RELEASE_UPDATE_CLASS = normalizeReleaseUpdateClass(process.env.S2S_PROJECT_UPDATE_CLASS);

// Constants, types, and interfaces extracted to ./cli/types.ts


// CLI state (createDefaultCLISharedFlags, getActiveCLIFlags, setActiveCLIFlags) extracted to ./cli/io/state.ts

function parseCLIInvocation(args: string[]): CLIInvocation {
  const flags = createDefaultCLISharedFlags();
  const commandArgs: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const raw = String(args[index] || '').trim();
    if (!raw) continue;
    if (raw === '--json') {
      flags.json = true;
      continue;
    }
    if (raw === '--verbose') {
      flags.verbose = true;
      continue;
    }
    if (raw === '--debug') {
      flags.debug = true;
      flags.verbose = true;
      continue;
    }
    if (raw === '--yes' || raw === '-y') {
      flags.yes = true;
      continue;
    }
    if (raw === '--dry-run') {
      flags.dryRun = true;
      continue;
    }
    if (raw === '--no-input') {
      flags.noInput = true;
      continue;
    }
    if (raw === '--refine' || raw.startsWith('--refine=')) {
      flags.refine = true;
      if (raw.startsWith('--refine=')) {
        const value = raw.slice('--refine='.length).trim();
        if (value) flags.refinePrompt = value;
      } else {
        const next = String(args[index + 1] || '').trim();
        if (next && !next.startsWith('-')) {
          flags.refinePrompt = next;
          index += 1;
        }
      }
      continue;
    }
    if (raw === '--context') {
      flags.contextOnly = true;
      continue;
    }
    if (raw === '--submit') {
      flags.submit = true;
      continue;
    }
    if (raw === '--repo' || raw.startsWith('--repo=')) {
      if (flags.repoPath) {
        throw new Error('Global flag --repo may only be provided once.');
      }
      const value = raw === '--repo' ? String(args[index + 1] || '').trim() : raw.slice('--repo='.length).trim();
      if (!value) {
        throw new Error('Global flag --repo requires a path value.');
      }
      flags.repoPath = path.resolve(expandHomePath(value));
      if (raw === '--repo') index += 1;
      continue;
    }
    if (raw === '--config' || raw.startsWith('--config=')) {
      if (flags.configPath) {
        throw new Error('Global flag --config may only be provided once.');
      }
      const value = raw === '--config' ? String(args[index + 1] || '').trim() : raw.slice('--config='.length).trim();
      if (!value) {
        throw new Error('Global flag --config requires a path value.');
      }
      flags.configPath = path.resolve(expandHomePath(value));
      if (raw === '--config') index += 1;
      continue;
    }
    commandArgs.push(raw);
  }

  return {
    command: commandArgs[0] ? String(commandArgs[0]).trim().toLowerCase() : undefined,
    commandArgs: commandArgs.slice(1),
    flags,
  };
}

// Output helpers (commandMeta, printJson, printVerboseContext, failCLI, warnOrchestrator) extracted to ./cli/io/output.ts

function resolveRepoScopedArgument(explicitValue: string | undefined, usage: string): string | undefined {
  const repoPath = getActiveCLIFlags().repoPath;
  if (explicitValue && repoPath) {
    failCLI(`Cannot combine an explicit project/path argument with --repo.\n${usage}`, { usage });
  }
  return explicitValue || repoPath;
}

function readProjectTemplateVersion(repoPath?: string): string | undefined {
  const root = findNearestProjectRoot(resolveAppPath(repoPath || '.'));
  if (!root) return undefined;
  const meta = readJsonFile<Partial<ProjectMeta>>(path.join(root, '.s2s', 'project.json'));
  return meta?.templateVersion ?? undefined;
}

async function main(): Promise<void> {
  setOutputCLIVersion(CLI_VERSION);
  setRegistryTemplateVersion(TEMPLATE_VERSION);
  setBackupCLIVersion(CLI_VERSION);
  const rawArgs = process.argv.slice(2);
  const invokedCommand = buildInvokedCommand(rawArgs);
  let invocation: CLIInvocation;
  try {
    invocation = parseCLIInvocation(rawArgs);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
  setActiveCLIFlags(invocation.flags);
  const cmd = invocation.command;
  const args = invocation.commandArgs;

  if (!cmd) {
    await handleDefaultChatCommand(invokedCommand);
    return;
  }
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    const topic = args[0] ? String(args[0]).trim().toLowerCase() : undefined;
    const projectVersion = topic ? undefined : readProjectTemplateVersion(getActiveCLIFlags().repoPath);
    printHelp(topic, projectVersion);
    return;
  }
  if (cmd === 'version' || cmd === '--version' || cmd === '-v') {
    const projectVersion = readProjectTemplateVersion(getActiveCLIFlags().repoPath);
    if (projectVersion) {
      console.log(`binary   ${CLI_VERSION}`);
      console.log(`project  ${projectVersion}`);
    } else {
      console.log(CLI_VERSION);
    }
    return;
  }
  if (isCommandHelpRequest(args) && isHelpTopic(cmd)) {
    printHelp(cmd);
    return;
  }

  if (cmd === 'list') {
    if (args.length > 0) {
      console.error('Usage: s2s list\nHelp: s2s help list');
      process.exit(1);
    }
    handleListCommand();
    return;
  }
  if (cmd === 'update') {
    await handleUpdateCommand(args);
    return;
  }
  if (cmd === 'init') {
    await handleInitCommand(args);
    return;
  }
  if (cmd === 'config') {
    await handleConfigCommand(args);
    return;
  }
  if (cmd === 'stage') {
    await handleStageCommand(args, invokedCommand);
    return;
  }
  if (cmd === 'request') {
    await handleRequestCommand(args);
    return;
  }
  if (cmd === 'status') {
    await handleStatusCommand(args);
    return;
  }
  if (cmd === 'show') {
    await handleShowCommand(args);
    return;
  }
  if (cmd === 'execute') {
    handleExecuteCommand(args);
    return;
  }
  if (cmd === 'resume') {
    handleResumeCommand(args);
    return;
  }
  if (cmd === 'approve') {
    await handleApproveCommand(args);
    return;
  }
  if (cmd === 'reject') {
    await handleRejectCommand(args);
    return;
  }
  if (cmd === 'worktrees') {
    await handleWorktreesCommand(args);
    return;
  }
  if (cmd === 'completion') {
    handleCompletionCommand(args);
    return;
  }
  if (cmd === 'doctor') {
    await handleDoctorCommand(args);
    return;
  }
  if (cmd === 'backup') {
    await handleBackupCommand(args);
    return;
  }
  if (cmd === 'restore') {
    await handleRestoreCommand(args);
    return;
  }
  if (cmd === 'remove') {
    await handleRemoveCommand(args);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

function printHelp(topic?: string, projectVersion?: string): void {
  if (topic) {
    printHelpTopic(topic);
    return;
  }

  console.log([
    'Spec-To-Ship (s2s)',
    'Chat-first SDLC orchestration from your current project path.',
    '',
    'USAGE',
    '  s2s',
    '  s2s [command] [path]',
    '',
    'COMMANDS',
    '  help [topic]         Show command help',
    '  version              Print s2s version',
    '  list                 List configured projects',
    '  update [project]     Refresh project-managed files to current CLI version',
    '  init [path]          Validate prerequisites and initialize a repository explicitly',
    '  config [project]     Show effective config for a project',
    '  config edit [project] Edit project config interactively',
    '  stage <stage> [project] Run a stage pipeline',
    '  status [project]     Show managed project status and next actions',
    '  show <subject>       Inspect stored change/spec/slice/run state',
    '  approve <gateId>     Record an approval decision for a pending gate',
    '  reject <gateId>      Record a rejection decision for a pending gate',
    '  worktrees list       Inspect the configured managed worktrees root',
    '  completion [shell]   Print shell completion script (bash|zsh|fish)',
    '  doctor [project]     Validate .s2s governance, observability, and chat readiness',
    '  backup [project]     Backup .s2s + root compatibility shims to ~/.s2s',
    '  restore [project] [--snapshot=<id>] Restore .s2s + root compatibility shims from ~/.s2s',
    '  remove [project]     Remove s2s artifacts from project + global registry',
    '',
    'STAGES',
    '  pm              Product requirements definition',
    '  research        Technical investigation and architecture validation',
    '  design          UX/system design and prototype spec',
    '  engineering     Technical specification and backlog',
    '  engineering_exec Execute implementation and verification workflow',
    '',
    'EXAMPLES',
    '  s2s',
    '  s2s --json',
    '  s2s init',
    '  s2s status --repo /path/to/app --json',
    '  s2s init --check',
    '  s2s update --yes --dry-run',
    '  s2s status --help',
    '  s2s show slices',
    '  s2s show --help',
    '  s2s approve gate-spec-review-main --yes',
    '  s2s worktrees list',
    '  s2s stage pm',
    '  s2s config edit my-project',
    '  eval "$(s2s completion bash)"',
    '  s2s completion zsh > ~/.zfunc/_s2s',
    '',
    'GLOBAL FLAGS',
    '  --json             Emit machine-readable output when supported',
    '  --dry-run          Preview intended actions without side effects',
    '  --yes, -y          Skip confirmation prompts for supported commands',
    '  --no-input         Disable prompts and fail if required input is missing',
    '  --verbose          Show additional operational context',
    '  --debug            Include diagnostic context (implies verbose)',
    '  --repo <path>      Resolve command context from an explicit repository path',
    '  --config <path>    Record an explicit runtime-config override path for diagnostics',
    '',
    'HELP TOPICS',
    `  ${PUBLIC_HELP_TOPICS.join(', ')}`,
    '',
    'LEARN MORE',
    '  s2s help <topic>',
    '  s2s <command> --help',
    '',
    `VERSION`,
    `  binary   ${CLI_VERSION}`,
    ...(projectVersion ? [`  project  ${projectVersion}`] : []),
  ].join('\n'));
}

function printHelpTopic(topic: string): void {
  switch (topic) {
    case 'start': {
      console.log([
        's2s start',
        '',
        'USAGE',
        '  s2s',
        '  s2s [command] [path]',
        '',
        'BEHAVIOR',
        '  - `s2s` inspects current path context and prints a lightweight status/help surface.',
        '  - `s2s` does not initialize or repair repositories automatically.',
        '  - Run `s2s init` to initialize or repair managed `.s2s` state explicitly.',
        '  - Open a supported AI client (codex, claude, opencode) in the project directory to begin.',
        '',
        'EXAMPLES',
        '  s2s',
        '  s2s --json',
        '  s2s init',
      ].join('\n'));
      return;
    }
    case 'version': {
      console.log([
        's2s version',
        '',
        'USAGE',
        '  s2s version',
        '  s2s -v',
        '  s2s --version',
        '',
        'OUTPUT',
        '  Prints CLI semantic version.',
        '',
        'EXAMPLES',
        '  s2s version',
        '  s2s -v',
      ].join('\n'));
      return;
    }
    case 'list': {
      console.log([
        's2s list',
        '',
        'USAGE',
        '  s2s list [--json]',
        '',
        'OUTPUT',
        '  Lists configured local projects from ~/.s2s/projects.json.',
        '  Use `--json` for machine-readable project registry output.',
        '',
        'EXAMPLES',
        '  s2s list',
        '  s2s list --json',
      ].join('\n'));
      return;
    }
    case 'update': {
      console.log([
        's2s update',
        '',
        'USAGE',
        '  s2s update [project] [--yes] [--json] [--dry-run] [--repo <path>]',
        '',
        'BEHAVIOR',
        '  - Without [project], uses local .s2s context.',
        '  - With [project], resolves by alias/path from registry.',
        '  - Explicitly refreshes project-managed files to the current CLI template version.',
        '  - Applies pending soft/hard project updates immediately.',
        '  - `--dry-run` previews the update decision without writing files.',
        '',
        'EXAMPLES',
        '  s2s update',
        '  s2s update my-project --yes',
        '  s2s update --repo /path/to/app --dry-run',
      ].join('\n'));
      return;
    }
    case 'init': {
      console.log([
        's2s init',
        '',
        'USAGE',
        '  s2s init [path-user-app]',
        '  s2s init [path-user-app] --check',
        '  s2s init [path-user-app] --dry-run',
        '',
        'BEHAVIOR',
        '  - Runs the full init prerequisite assessment for the target repository.',
        '  - `--check` reports blockers, setup actions, and optional warnings without writing files.',
        '  - `--dry-run` follows the same non-mutating contract as `--check`.',
        '  - Without `--check`, eligible repositories run guided first-time init or repair existing/partial `.s2s` state in place.',
        '  - Missing guided answers are collected only when an interactive terminal or scripted stdin answer stream is available.',
        '  - Otherwise `s2s init` fails fast and asks for explicit answers instead of silently accepting defaults.',
        '  - Re-running `s2s init` is the canonical way to regenerate missing managed `.s2s` files and root compatibility shims.',
        '  - Successful init/repair ends with a readiness checklist and likely next actions.',
        '',
        'EXAMPLES',
        '  s2s init',
        '  s2s init --check',
        '  s2s init /path/to/app --dry-run',
      ].join('\n'));
      return;
    }
    case 'config': {
      console.log([
        's2s config',
        '',
        'USAGE',
        '  s2s config [project]',
        '  s2s config edit [project]',
        '',
        'BEHAVIOR',
        '  - Without [project], uses local .s2s context.',
        '  - With [project], resolves by alias/path from registry.',
        '  - Surfaces resolved runtime workspace/worktree paths and managed ~/.s2s tool locations.',
        '  - Use `s2s config edit` to update launch/runtime settings.',
        '  - `s2s config edit` requires an interactive terminal or scripted stdin answers; otherwise it fails fast.',
        '',
        'EXAMPLES',
        '  s2s config',
        '  s2s config my-project',
        '  s2s config edit my-project',
      ].join('\n'));
      return;
    }
    case 'stage': {
      console.log([
        's2s stage',
        '',
        'USAGE',
        '  s2s stage <stage> [project]',
        '',
        'VALID STAGES',
        '  pm              Product requirements definition',
        '  research        Technical investigation and architecture validation',
        '  design          UX/system design and prototype spec',
        '  engineering     Technical specification and backlog',
        '  engineering_exec Execute implementation and verification workflow',
        '',
        'EXAMPLES',
        '  s2s stage pm',
        '  s2s stage engineering my-project',
      ].join('\n'));
      return;
    }
    case 'request': {
      console.log([
        's2s request',
        '',
        'USAGE',
        '  s2s request "<prompt>" [project]',
        '',
        'DESCRIPTION',
        '  Submit a freeform work request to the Flow Orchestrator.',
        '  S2S classifies intent, resolves project context, plans the minimum sufficient',
        '  stage route, and creates or reuses Change and Spec entities.',
        '',
        '  Use this when you want the orchestrator to decide which stages are needed',
        '  instead of invoking stages manually with `s2s stage`.',
        '',
        'EXAMPLES',
        '  s2s request "add a release dashboard with approval states"',
        '  s2s request "fix the login timeout bug" my-project',
        '  s2s request "refine the dashboard UI after feedback"',
        '  s2s request "investigate the intermittent API timeout" --json',
        '',
        'FLAGS',
        '  --json    Emit machine-readable decision output',
        '',
        'AFTER REQUEST',
        '  The orchestrator prints the route decision and recommended next stage.',
        '  Run `s2s stage <stage>` to execute the next stage in the route.',
      ].join('\n'));
      return;
    }
    case 'status': {
      console.log([
        's2s status',
        '',
        'USAGE',
        '  s2s status [project] [--json] [--repo <path>]',
        '',
        'OUTPUT',
        '  Prints a human-readable managed-project summary, phase progress, artifact tree, and likely next actions.',
        '  Initialized repositories stay truthful even before the first stage artifact exists.',
        '  Use `--json` for the raw status payload.',
        '',
        'EXAMPLES',
        '  s2s status',
        '  s2s status --json',
        '  s2s status --repo /path/to/app',
      ].join('\n'));
      return;
    }
    case 'show': {
      console.log([
        's2s show',
        '',
        'USAGE',
        '  s2s show change <id>',
        '  s2s show spec <id>',
        '  s2s show slice <id>',
        '  s2s show slices',
        '  s2s show run <id>',
        '  s2s show runs',
        '  s2s show blockers <changeId>',
        '  s2s show dependencies <sliceId>',
        '',
        'OUTPUT',
        '  Inspects persisted operational records under `.s2s/artifacts/<projectId>/`.',
        '  `change`, `spec`, `slice`, and `run` show one record.',
        '  `slices` and `runs` show the stored project-wide queues.',
        '  `blockers` shows the current blocker set for one change, and `dependencies` shows one slice dependency set.',
        '  Use `--json` for machine-readable inspection output.',
        '',
        'EXAMPLES',
        '  s2s show change chg_123',
        '  s2s show slice slice_123',
        '  s2s show run run_123',
        '  s2s show slices',
      ].join('\n'));
      return;
    }
    case 'execute': {
      console.log([
        's2s execute',
        '',
        'USAGE',
        '  s2s execute --slice <sliceId>',
        '  s2s execute --slice=<sliceId>',
        '  s2s execute --ready',
        '',
        'STATUS',
        '  This command is intentionally not part of the current release surface.',
        '  The supported execution path is already slice-first through `s2s stage engineering_exec`.',
        '  The dedicated `execute` command remains hidden until that surface is restored.',
        '',
        'CURRENT ALTERNATIVES',
        '  s2s show slice <id>',
        '  s2s show runs',
        '  s2s stage engineering_exec',
        '  s2s status [project]',
      ].join('\n'));
      return;
    }
    case 'resume': {
      console.log([
        's2s resume',
        '',
        'USAGE',
        '  s2s resume <changeId|sliceId>',
        '',
        'STATUS',
        '  This command is intentionally not part of the current release surface.',
        '  Resume guidance is available through the stored operational state surface.',
        '  The dedicated `resume` command remains hidden until targeted resume flows are restored.',
        '',
        'CURRENT ALTERNATIVES',
        '  s2s show change <id>',
        '  s2s show slice <id>',
        '  s2s status [project]',
      ].join('\n'));
      return;
    }
    case 'approve': {
      console.log([
        's2s approve',
        '',
        'USAGE',
        '  s2s approve <gateId> [--yes] [--json] [--dry-run] [--repo <path>]',
        '',
        'OUTPUT',
        '  Resolves one pending gate as approved and refreshes the stored change/spec/ledger state.',
        '  In non-interactive mode, use `--yes` unless you are running `--dry-run`.',
        '',
        'EXAMPLES',
        '  s2s approve gate_123 --yes',
      ].join('\n'));
      return;
    }
    case 'reject': {
      console.log([
        's2s reject',
        '',
        'USAGE',
        '  s2s reject <gateId> [--yes] [--json] [--dry-run] [--repo <path>]',
        '',
        'OUTPUT',
        '  Resolves one pending gate as rejected and refreshes the stored change/spec/ledger state.',
        '  In non-interactive mode, use `--yes` unless you are running `--dry-run`.',
        '',
        'EXAMPLES',
        '  s2s reject gate_123 --yes',
      ].join('\n'));
      return;
    }
    case 'worktrees': {
      console.log([
        's2s worktrees',
        '',
        'USAGE',
        '  s2s worktrees list [--json] [--repo <path>]',
        '',
        'OUTPUT',
        '  Prints the configured managed worktrees root plus the directories currently present there.',
        '',
        'EXAMPLES',
        '  s2s worktrees list',
      ].join('\n'));
      return;
    }
    case 'completion': {
      console.log([
        's2s completion',
        '',
        'USAGE',
        '  s2s completion',
        '  s2s completion <bash|zsh|fish>',
        '',
        'BEHAVIOR',
        '  - Without a shell argument, attempts to infer the active shell from `$SHELL`.',
        '  - Prints the raw completion script to stdout so you can `eval` it or write it to your shell completion directory.',
        '  - Supports `bash`, `zsh`, and `fish`.',
        '',
        'EXAMPLES',
        '  eval "$(s2s completion bash)"',
        '  eval "$(s2s completion)"',
        '  mkdir -p ~/.zfunc && s2s completion zsh > ~/.zfunc/_s2s',
        '  s2s completion fish > ~/.config/fish/completions/s2s.fish',
      ].join('\n'));
      return;
    }
    case 'doctor': {
      console.log([
        's2s doctor',
        '',
        'USAGE',
        '  s2s doctor [project] [--json] [--repo <path>]',
        '',
        'OUTPUT',
        '  Validates .s2s files, root guardrails, observability settings, and chat client readiness.',
        '  Also prints resolved runtime workspace/worktree settings and managed ~/.s2s tool paths.',
        '  Use `--json` for machine-readable doctor checks.',
        '',
        'EXAMPLES',
        '  s2s doctor',
        '  s2s doctor --json',
        '  s2s doctor --repo /path/to/app',
      ].join('\n'));
      return;
    }
    case 'backup': {
      console.log([
        's2s backup',
        '',
        'USAGE',
        '  s2s backup [project] [--json] [--dry-run] [--repo <path>]',
        '',
        'OUTPUT',
        '  Creates a project-isolated backup under ~/.s2s/backups/projects/<project-hash>/<snapshot-id>/',
        '  Includes: .s2s workspace and root compatibility shims (AGENTS.md, CODEX.md, CLAUDE.md).',
        '  `--dry-run` previews the next snapshot location without writing files.',
        '',
        'EXAMPLES',
        '  s2s backup',
        '  s2s backup --dry-run',
        '  s2s backup my-project --json',
      ].join('\n'));
      return;
    }
    case 'restore': {
      console.log([
        's2s restore',
        '',
        'USAGE',
        '  s2s restore [project] [--snapshot=<id>] [--yes] [--json] [--dry-run] [--repo <path>]',
        '  s2s restore [project] --latest',
        '',
        'BEHAVIOR',
        '  - Restores .s2s and root compatibility shims from global backup storage (~/.s2s).',
        '  - Creates an automatic pre-restore backup before writing files.',
        '  - If no snapshot is provided, restores latest snapshot for the project.',
        '  - `--dry-run` previews the restore target and safety-backup behavior.',
        '',
        'EXAMPLES',
        '  s2s restore',
        '  s2s restore --latest --yes',
        '  s2s restore my-project --snapshot=2026-04-04T12-00-00-000Z',
      ].join('\n'));
      return;
    }
    case 'remove': {
      console.log([
        's2s remove',
        '',
        'USAGE',
        '  s2s remove [project] [--yes] [--keep-backups] [--json] [--dry-run] [--repo <path>]',
        '',
        'BEHAVIOR',
        '  - Removes project-local s2s workspace (`.s2s/`).',
        '  - Removes s2s-managed root blocks from AGENTS.md, CODEX.md, and CLAUDE.md.',
        '  - Removes project from ~/.s2s/projects.json registry.',
        '  - By default, also deletes global backups under ~/.s2s/backups/projects/<project-hash>/.',
        '  - Use --keep-backups to preserve global backup snapshots.',
        '  - `--dry-run` previews the cleanup plan without deleting files.',
        '  - In non-interactive mode, --yes is required.',
        '',
        'EXAMPLES',
        '  s2s remove my-project --yes',
        '  s2s remove --repo /path/to/app --dry-run',
        '  s2s remove my-project --yes --keep-backups',
      ].join('\n'));
      return;
    }
    case 'project-resolution': {
      console.log([
        's2s project resolution',
        '',
        'RULES',
        '  1. If .s2s exists in cwd/ancestors, local context is used.',
        '  2. Without local .s2s, [project] is required for project commands.',
        '  3. Explicit [project] overrides local context.',
        '',
        'EXAMPLES',
        '  s2s status',
        '  s2s status my-project',
        '  s2s status --repo /path/to/app',
        '',
        'TIP',
        '  Run `s2s list` to inspect registered aliases and paths.',
      ].join('\n'));
      return;
    }
    default: {
      console.error(`Unknown help topic: ${topic}`);
      console.error(`Available topics: ${PUBLIC_HELP_TOPICS.join(', ')}`);
      process.exit(1);
    }
  }
}

async function handleDefaultChatCommand(invokedCommand: string): Promise<void> {
  const requestedPath = resolveAppPath(getActiveCLIFlags().repoPath || '.');
  const nearest = findNearestProjectRoot(requestedPath);
  const resolution = resolveOnboardingRoot(requestedPath);
  const repoRoot = nearest || resolution.recommendedRoot;
  const runtimeConfigPath = getActiveCLIFlags().configPath;
  const report = assessLightweightPrerequisites({
    repoRoot,
    runtimeConfigPath,
    runtimeConfig: runtimeConfigPath ? readJsonFile<RuntimeConfig>(runtimeConfigPath) || undefined : undefined,
  });
  const projectMeta = report.localStatePresent
    ? readJsonFile<Partial<ProjectMeta>>(path.join(report.s2sDir, 'project.json')) || undefined
    : undefined;
  const localState = report.localStatePresent
    ? readJsonFile<Partial<ProjectLocalState>>(path.join(report.s2sDir, 'project.local.json')) || undefined
    : undefined;

  printRootCommandSurface({
    invokedCommand,
    requestedPath,
    resolution,
    report,
    projectMeta,
    localState,
  });
}

function handleListCommand(): void {
  const registry = loadRegistry();
  if (registry.projects.length === 0) {
    if (getActiveCLIFlags().json) {
      printJson({
        ok: true,
        ...commandMeta('list'),
        projects: [],
        summary: 'No projects configured yet. Run: s2s init',
      });
      return;
    }
    console.log('No projects configured yet. Run: s2s init');
    return;
  }
  const projects = registry.projects
    .map((project) => ({
      project,
      meta: readJsonFile<Partial<ProjectMeta>>(path.join(project.s2sPath, 'project.json')),
      latestBackup: latestGlobalProjectBackupInfo(project.appPath),
    }))
    .sort((a, b) => {
      const aTime = Date.parse(a.project.lastUsedAt) || 0;
      const bTime = Date.parse(b.project.lastUsedAt) || 0;
      if (aTime !== bTime) return bTime - aTime;
      return a.project.alias.localeCompare(b.project.alias);
    });

  const projectSummaries = projects.map((item) => ({
    alias: item.project.alias,
    appPath: item.project.appPath,
    projectVersion: resolveListedProjectVersion(item.project, item.meta),
    updateNotice: resolveListedProjectUpdateNotice(item.meta),
    lastUsedAt: item.project.lastUsedAt,
    latestBackupAt: item.latestBackup ? new Date(item.latestBackup.createdAtMs).toISOString() : null,
  }));

  if (getActiveCLIFlags().json) {
    printJson({
      ok: true,
      ...commandMeta('list'),
      registryPath: registryPath(),
      projects: projectSummaries,
    });
    return;
  }

  console.log('Configured projects:\n');

  for (const item of projects) {
    const installedVersion = resolveListedProjectVersion(item.project, item.meta);
    const updateNotice = resolveListedProjectUpdateNotice(item.meta);
    const lastUsed = formatFriendlyTimestamp(item.project.lastUsedAt);
    const lastBackup = item.latestBackup ? formatFriendlyTimestamp(item.latestBackup.createdAtMs) : 'never';

    console.log(item.project.alias);
    console.log(`  project version: ${installedVersion}${updateNotice}`);
    console.log(`  app path: ${item.project.appPath}`);
    console.log(`  last used: ${lastUsed}`);
    console.log(`  last backup: ${lastBackup}`);
    console.log('');
  }
}

async function handleInitCommand(args: string[]): Promise<void> {
  const { targetPath, checkOnly } = parseInitCommandArgs(args);
  const requestedPath = resolveAppPath(
    resolveRepoScopedArgument(targetPath, 'Usage: s2s init [path-user-app] [--check]\nHelp: s2s help init') || '.',
  );
  const existingRoot = findNearestProjectRoot(requestedPath);
  const resolution = resolveOnboardingRoot(requestedPath);
  const repoRoot = existingRoot || resolution.recommendedRoot;
  const report = assessInitPrerequisites({ repoRoot });
  const shouldRepairInPlace = report.localStatePresent;
  const effectiveCheckOnly = checkOnly || getActiveCLIFlags().dryRun;
  const preflightOptions = {
    requestedPath,
    resolution,
    checkOnly: effectiveCheckOnly,
  };
  if (!getActiveCLIFlags().json) {
    printInitBanner(repoRoot);
  }
  if (!getActiveCLIFlags().json || effectiveCheckOnly) {
    printInitPrerequisiteReport(report, preflightOptions);
  }

  if (!report.canInitialize) {
    process.exit(1);
  }
  if (effectiveCheckOnly) {
    if (getActiveCLIFlags().json) {
      printInitPrerequisiteReport(report, preflightOptions);
    }
    return;
  }
  const context = shouldRepairInPlace
    ? repairInitializedProjectAtPath(repoRoot)
    : await initializeProjectAtPath(repoRoot, 'init');
  const postInitReport = assessInitPrerequisites({ repoRoot: context.appRoot });
  const runtime = readJsonFile<RuntimeConfig>(path.join(context.configDir, 'runtime.json')) || defaultRuntimeConfig(context.projectMeta);
  const toolConfig = buildToolConfigSurfacing(context, runtime);

  if (getActiveCLIFlags().json) {
    printJson({
      ok: true,
      ...commandMeta('init', { repoRoot: context.appRoot }),
      mode: shouldRepairInPlace ? 'repair' : 'init',
      preflight: report,
      postInit: postInitReport,
      toolConfig,
    });
    return;
  }

  console.log('');
  console.log(renderPostInitReport(
    postInitReport,
    toolConfig,
    shouldRepairInPlace ? 'Post-Repair Summary' : 'Post-Init Summary',
    shouldRepairInPlace ? 'repair' : 'init',
  ));
}

async function handleUpdateCommand(args: string[]): Promise<void> {
  if (args.length > 1) {
    failCLI('Usage: s2s update [project]\nHelp: s2s help update', { usage: 's2s update [project]' });
  }

  const projectArg = resolveRepoScopedArgument(args[0] ? String(args[0]).trim() : undefined, 'Usage: s2s update [project]\nHelp: s2s help update');
  const appRoot = resolveProjectRootForUpdate(projectArg);
  const projectMetaPath = path.join(appRoot, '.s2s', 'project.json');
  const beforeMeta = readJsonFile<Partial<ProjectMeta>>(projectMetaPath) || {};
  const beforeRequirement = detectProjectUpdateRequirement(beforeMeta);
  const previousVersion = resolveDisplayedProjectVersion(beforeMeta);

  if (getActiveCLIFlags().dryRun) {
    const dryRunResult = {
      ok: true,
      ...commandMeta('update', { appRoot }),
      dryRun: true,
      project: normalizeAlias(String(beforeMeta.alias || path.basename(appRoot))),
      previousVersion,
      targetVersion: TEMPLATE_VERSION,
      pendingRequirement: beforeRequirement,
      summary: beforeRequirement.mode === 'none'
        ? 'Managed files are already on the current CLI template version.'
        : `Would apply project update: ${beforeRequirement.reason}`,
    };
    if (getActiveCLIFlags().json) {
      printJson(dryRunResult);
      return;
    }
    const lines = [
      `s2s update dry-run for project: ${dryRunResult.project}`,
      `- Project root: ${appRoot}`,
      `- Previous version: ${previousVersion}`,
      `- Target version: ${TEMPLATE_VERSION}`,
      `- Pending requirement: ${beforeRequirement.mode === 'none' ? 'none' : beforeRequirement.reason}`,
    ];
    printVerboseContext(lines, { appRoot, beforeRequirement });
    console.log(lines.join('\n'));
    return;
  }

  await confirmStateChangingCommand({
    action: `Refresh project-managed files for ${path.basename(appRoot)} now?`,
    noInputMessage: 's2s update requires confirmation in non-interactive mode.\nRe-run with --yes to apply the update.',
    canceledMessage: 'Update canceled.',
  });
  const previousFlags = getActiveCLIFlags();
  setActiveCLIFlags({ ...previousFlags, yes: true });
  const context = ensureProjectSetup(appRoot, { forceProjectUpdate: true });
  setActiveCLIFlags(previousFlags);

  updateRegistryForProject(context.projectMeta.alias, context.appRoot, context.s2sDir);
  touchProjectLastUsed(context);

  // Ensure live.md exists — create with idle state if missing (e.g. project pre-dates Phase 2)
  if (!existsSync(path.join(context.s2sDir, 'live.md'))) {
    writeLiveState(context.s2sDir, { updatedAt: new Date().toISOString(), status: 'none' });
  }

  // Migrate artifacts/ from project root to .s2s/artifacts/ (introduced in 0.2.47)
  migrateArtifactsDir(context.appRoot, context.s2sDir);
  ensureChatPermissionsOnUpdate(context.projectMetaPath, context.appRoot);

  const currentRequirement = detectProjectUpdateRequirement(context.projectMeta);
  const versionChanged = previousVersion !== context.projectMeta.templateVersion;
  const updateApplied = beforeRequirement.mode !== 'none' && currentRequirement.mode === 'none';

  const result = {
    ok: true,
    ...commandMeta('update', { appRoot: context.appRoot }),
    project: context.projectMeta.alias,
    projectRoot: context.appRoot,
    projectVersion: versionChanged
      ? `${previousVersion} -> ${context.projectMeta.templateVersion}`
      : context.projectMeta.templateVersion,
    appliedUpdate: updateApplied
      ? beforeRequirement.reason
      : beforeRequirement.mode === 'none'
        ? 'none required (managed files refreshed)'
        : `no version change (${beforeRequirement.reason})`,
  };
  if (getActiveCLIFlags().json) {
    printJson(result);
    return;
  }

  console.log(`s2s update completed for project: ${context.projectMeta.alias}`);
  console.log(`- Project root: ${context.appRoot}`);
  console.log(`- Project version: ${result.projectVersion}`);
  console.log(`- Applied project update: ${result.appliedUpdate}`);
}

async function handleConfigCommand(args: string[]): Promise<void> {
  const sub = String(args[0] || '').trim().toLowerCase();
  if (sub === 'edit') {
    if (args.length === 2 && isHelpFlag(String(args[1] || '').trim())) {
      printHelp('config');
      return;
    }
    if (args.length > 2) {
      failCLI('Usage: s2s config edit [project]\nHelp: s2s help config', { usage: 's2s config edit [project]' });
    }
    if (getActiveCLIFlags().noInput) {
      failCLI('s2s config edit cannot run with --no-input because it requires interactive answers.');
    }
    const projectArg = resolveRepoScopedArgument(args[1] ? String(args[1]).trim() : undefined, 'Usage: s2s config edit [project]\nHelp: s2s help config');
    const context = await ensureProjectContextWithAutomaticOnboarding(projectArg, {
      commandName: 'config edit',
    });
    await editProjectConfig(context);
    return;
  }

  if (sub === 'chat-permissions') {
    if (getActiveCLIFlags().noInput) {
      failCLI('s2s config chat-permissions cannot run with --no-input because it requires interactive answers.');
    }
    const projectArg = resolveRepoScopedArgument(args[1] ? String(args[1]).trim() : undefined, 'Usage: s2s config chat-permissions [project]');
    const context = await ensureProjectContextWithAutomaticOnboarding(projectArg, {
      commandName: 'config chat-permissions',
    });
    await configureChatPermissionsInteractively(context.projectMetaPath, context.appRoot);
    return;
  }

  if (args.length > 1) {
    failCLI('Usage: s2s config [project]\nOr: s2s config edit [project]\nHelp: s2s help config', { usage: 's2s config [project]' });
  }
  const projectArg = resolveRepoScopedArgument(args[0] ? String(args[0]).trim() : undefined, 'Usage: s2s config [project]\nOr: s2s config edit [project]\nHelp: s2s help config');
  const context = await ensureProjectContextWithAutomaticOnboarding(projectArg, {
    commandName: 'config',
  });
  const runtime = readJsonFile<RuntimeConfig>(path.join(context.configDir, 'runtime.json')) || defaultRuntimeConfig(context.projectMeta);
  const llm = readJsonFile<LLMProviderConfig>(path.join(context.configDir, 'llm.json'));
  const toolConfig = buildToolConfigSurfacing(context, runtime);
  const out = {
    project: context.projectMeta,
    toolConfig,
    runtime,
    llm,
  };
  if (getActiveCLIFlags().json) {
    printJson({
      ok: true,
      ...commandMeta('config', { appRoot: context.appRoot }),
      ...out,
    });
    return;
  }
  console.log(renderBlocks([
    renderSummaryBlock('Project Configuration', 'Runtime and tool configuration surfaces for this managed project.', [
      { label: 'Project', value: context.projectMeta.alias },
      { label: 'Project root', value: context.appRoot },
      { label: 'Runtime config path', value: toolConfig.configPaths.runtimeConfigPath },
      { label: 'LLM config path', value: toolConfig.configPaths.llmConfigPath },
    ]),
    renderStatusBlock('Runtime Workspace', [
      { label: 'Workspace repo path', value: toolConfig.runtimeWorkspace.projectRepoPath, state: 'info' },
      { label: 'Worktrees root path', value: toolConfig.runtimeWorkspace.worktreesRootPath, state: 'info' },
      { label: 'Worktrees directory name', value: toolConfig.runtimeWorkspace.worktreesDirName, state: 'info' },
      { label: 'Execution template', value: toolConfig.execution.templateId, state: 'info' },
    ]),
    renderStatusBlock('Managed Local Paths', [
      { label: 'Global control home', value: toolConfig.globalPaths.controlHome, state: 'info' },
      { label: 'Global runtime home', value: toolConfig.globalPaths.runtimeHome, state: 'info' },
      { label: 'Global worktrees home', value: toolConfig.globalPaths.worktreesHome, state: 'info' },
      { label: 'Project backup root', value: toolConfig.globalPaths.projectBackupRoot, state: 'info' },
      { label: 'Managed LLM workspace', value: toolConfig.globalPaths.llmWorkspaceRoot, state: 'info' },
    ]),
    renderNextActionsBlock('Update Paths', [
      'Run `s2s config edit [project]` to update runtime, observability, and launch preferences.',
      `Edit ${toolConfig.configPaths.runtimeConfigPath} or ${toolConfig.configPaths.llmConfigPath} directly for advanced changes.`,
      'Run `s2s doctor [project]` after updates to verify configuration health.',
    ]),
  ]));
}

function parseInitCommandArgs(args: string[]): { targetPath?: string; checkOnly: boolean } {
  let targetPath: string | undefined;
  let checkOnly = false;

  for (const arg of args) {
    const normalized = String(arg || '').trim();
    if (!normalized) continue;
    if (normalized === '--check') {
      checkOnly = true;
      continue;
    }
    if (normalized.startsWith('--') || targetPath) {
      console.error('Usage: s2s init [path-user-app] [--check]\nHelp: s2s help init');
      process.exit(1);
    }
    targetPath = normalized;
  }

  return { targetPath, checkOnly };
}

function printInitPrerequisiteReport(
  report: InitPrerequisiteReport,
  options: {
    requestedPath: string;
    resolution: ReturnType<typeof resolveOnboardingRoot>;
    checkOnly: boolean;
  },
): void {
  if (getActiveCLIFlags().json) {
    printJson({
      ok: true,
      ...commandMeta('init', {
        repoRoot: report.repoRoot,
        requestedPath: options.requestedPath,
        checkOnly: options.checkOnly,
      }),
      report,
      resolution: {
        requestedPath: options.resolution.requestedPath,
        recommendedRoot: options.resolution.recommendedRoot,
        isGitRepository: options.resolution.isGitRepository,
        isGitSubdirectory: options.resolution.isGitSubdirectory,
      },
    });
    return;
  }
  // check-only mode: show full diagnostic report
  if (options.checkOnly) {
    const initNotes: string[] = [];
    if (report.localStatePresent && report.repositoryInitialized) {
      initNotes.push('Existing .s2s state detected in this repository.');
    } else if (report.localStatePresent) {
      initNotes.push('Partial or damaged .s2s state detected in this repository; `s2s init` can repair it.');
    } else if (options.resolution.isGitSubdirectory) {
      initNotes.push(`Using Git repository root for init: ${options.resolution.recommendedRoot}`);
    }
    console.log(renderBlocks([
      renderSummaryBlock('Init Prerequisite Report', report.summary, [
        { label: 'Report', value: `s2s init prerequisite report for: ${report.repoRoot}` },
        ...(normalizeComparablePath(options.requestedPath) !== normalizeComparablePath(report.repoRoot)
          ? [{ label: 'Requested path', value: options.requestedPath }]
          : []),
        { label: 'Repository root', value: report.repoRoot },
        { label: 'Mode', value: 'check-only' },
        { label: 'Can initialize', value: report.canInitialize ? 'yes' : 'no' },
        { label: 'Repo-local state valid', value: report.repositoryInitialized ? 'yes' : 'no' },
        { label: '.s2s config dir', value: report.configDir },
        { label: 'Global control home', value: report.readiness.controlRoot },
        { label: 'Global worktrees home', value: report.readiness.worktreesRoot },
        { label: 'Repo worktrees root', value: defaultManagedWorktreesRootPath(report.repoRoot) },
      ]),
      renderStatusBlock('Readiness Status', [
        { label: 'Ready now', value: report.ready ? 'yes' : 'no', state: report.ready ? 'ok' : 'warn' },
        { label: 'Can initialize', value: report.canInitialize ? 'yes' : 'no', state: report.canInitialize ? 'ok' : 'fail' },
        { label: 'Repo-local state valid', value: report.repositoryInitialized ? 'yes' : 'no', state: report.repositoryInitialized ? 'ok' : 'warn' },
      ]),
      renderStatusBlock(
        'Readiness Checklist',
        report.readinessChecklist.map((item) => ({
          label: item.label,
          value: item.detail,
          state: item.ready ? 'ok' : 'warn',
        })),
        'No readiness checklist items.',
      ),
      initNotes.length > 0 ? renderWarningsBlock('Init Notes', initNotes) : undefined,
      renderNextActionsBlock('Likely Next Actions', report.suggestedNextActions, 'No follow-up actions suggested.'),
      report.blockingChecks.length > 0
        ? renderDoctorCheckMatrix('Blocking Prerequisites', mapReadinessChecksToOutputItems(report.blockingChecks, 'fail'))
        : undefined,
      report.setupChecks.length > 0
        ? renderDoctorCheckMatrix('Setup Actions', mapReadinessChecksToOutputItems(report.setupChecks, 'warn'))
        : undefined,
      report.warningChecks.length > 0
        ? renderDoctorCheckMatrix('Optional Warnings', mapReadinessChecksToOutputItems(report.warningChecks, 'warn'))
        : undefined,
    ]));
    return;
  }

  // normal init/repair mode: show only what the user needs to know
  if (!report.canInitialize) {
    const reasons = report.blockingChecks.map((c) => `  · ${c.summary}`).join('\n');
    console.log(`\nThis repository cannot be initialized for S2S.\n${reasons}\n`);
    return;
  }

  if (report.localStatePresent && report.repositoryInitialized) {
    console.log('  Note: Existing .s2s state detected — will repair in place.\n');
  } else if (report.localStatePresent) {
    console.log('  Note: Partial .s2s state detected — will repair.\n');
  } else if (options.resolution.isGitSubdirectory) {
    console.log(`  Note: Using Git root: ${options.resolution.recommendedRoot}\n`);
  }
}

function printRootCommandSurface(options: {
  invokedCommand: string;
  requestedPath: string;
  resolution: ReturnType<typeof resolveOnboardingRoot>;
  report: ReturnType<typeof assessLightweightPrerequisites>;
  projectMeta?: Partial<ProjectMeta>;
  localState?: Partial<ProjectLocalState>;
}): void {
  const { report, resolution } = options;
  const contextLabel = describeRootCommandContext(report, resolution);
  const s2sStateLabel = report.localStatePresent
    ? report.repositoryInitialized
      ? 'present and healthy'
      : 'present but needs repair'
    : 'missing';
  const projectLabel = options.projectMeta?.alias ? String(options.projectMeta.alias) : '(not initialized)';
  const projectVersion = options.projectMeta?.templateVersion ?? null;
  const lastDetectedClient = options.localState?.lastDetectedClient;
  const recommendedCommand = report.recommendedCommand || 's2s help';
  if (getActiveCLIFlags().json) {
    printJson({
      ok: true,
      ...commandMeta('start', {
        invokedCommand: options.invokedCommand,
        requestedPath: options.requestedPath,
        repoRoot: report.repoRoot,
      }),
      context: {
        repositoryContext: contextLabel,
        isGitRepository: resolution.isGitRepository,
        projectAlias: projectLabel,
        s2sState: s2sStateLabel,
        lastDetectedClient: lastDetectedClient || null,
        binaryVersion: CLI_VERSION,
        projectVersion,
      },
      status: {
        ready: report.ready,
        summary: report.summary,
        recommendedCommand,
        pendingActions: report.pendingActions,
        warnings: report.warnings,
      },
      report,
    });
    return;
  }
  const BANNER_W = 58; // total width including both │
  const INNER = BANNER_W - 2; // 56 chars between │ and │
  const bCenter = (s: string): string => {
    const pad = Math.max(0, INNER - s.length);
    const l = Math.floor(pad / 2);
    return `│${' '.repeat(l)}${s}${' '.repeat(pad - l)}│`;
  };
  const bLine = (s: string): string => `│ ${s.padEnd(INNER - 1)}│`;
  const bBlank = (): string => `│${' '.repeat(INNER)}│`;
  const top    = `┌${'─'.repeat(INNER)}┐`;
  const sep    = `├${'─'.repeat(INNER)}┤`;
  const bottom = `└${'─'.repeat(INNER)}┘`;

  const output: string[] = [];
  output.push(top);
  output.push(bCenter(`Spec-To-Ship (s2s) v${CLI_VERSION}`));
  output.push(bCenter('Governed AI-assisted software delivery'));
  output.push(sep);
  output.push(bBlank());

  if (report.ready) {
    const versionTag = projectVersion ? `  v${projectVersion}` : '';
    const clientTag = lastDetectedClient ? `  [${lastDetectedClient}]` : '';
    output.push(bLine(`✓ Ready  ·  ${projectLabel}${versionTag}${clientTag}`));
    output.push(bBlank());
    output.push(bLine('s2s request "<idea>"  ·  s2s status  ·  s2s help'));
  } else if (report.localStatePresent && !report.repositoryInitialized) {
    output.push(bLine(`⚠ Needs repair  ·  ${projectLabel}`));
    output.push(bLine('  Run: s2s init  ·  s2s doctor for details'));
  } else {
    output.push(bLine('✗ Not initialized'));
    output.push(bLine('  Run: s2s init'));
  }

  if (report.warnings.length > 0) {
    output.push(bBlank());
    for (const warning of report.warnings) {
      output.push(bLine(`⚠ ${warning}`));
    }
  }

  output.push(bBlank());
  output.push(bottom);
  console.log(output.join('\n'));
}

function describeRootCommandContext(
  report: ReturnType<typeof assessLightweightPrerequisites>,
  resolution: ReturnType<typeof resolveOnboardingRoot>,
): string {
  if (report.blockingChecks.some((check) => check.id === 'repository.supported_context')) {
    return 'unsupported spec-to-ship source repository';
  }
  if (report.localStatePresent && report.repositoryInitialized) {
    return 'managed S2S user project';
  }
  if (report.localStatePresent) {
    return 'managed S2S user project with repairable local state';
  }
  if (resolution.isGitRepository) {
    return 'candidate user project (git repository)';
  }
  return 'candidate user project (directory)';
}

function renderPostInitReport(
  report: InitPrerequisiteReport,
  toolConfig: ReturnType<typeof buildToolConfigSurfacing>,
  title: string,
  mode: 'init' | 'repair',
): string {
  const nextActions = report.ready
    ? [
        'Open your AI client in this directory to get started.',
        'Run `s2s doctor` any time to re-check project health.',
      ]
    : report.suggestedNextActions;
  return renderBlocks([
    renderSummaryBlock(title, report.summary, [
      { label: 'Repository root', value: report.repoRoot },
      { label: 'Mode', value: mode },
      { label: 'Ready now', value: report.ready ? 'yes' : 'no' },
    ]),
    renderStatusBlock(
      'Readiness Checklist',
      report.readinessChecklist.map((item) => ({
        label: item.label,
        value: item.detail,
        state: item.ready ? 'ok' : 'warn',
      })),
      'No readiness checklist items.',
    ),
    renderNextActionsBlock('Next', nextActions, 'No follow-up actions suggested.'),
  ]);
}

function mapReadinessChecksToOutputItems(
  checks: ReadinessCheck[],
  fallbackState: Exclude<OutputRendererState, 'info'>,
): OutputRendererStatusItem[] {
  return checks.map((check) => ({
    label: check.label,
    value: check.summary,
    state: check.status === 'ready' ? 'ok' : fallbackState,
    detail: `why: ${check.reason}`,
    remediation: check.remediation,
  }));
}

function renderProjectStatusReport(projectAlias: string, status: ProjectStatus): string {
  return renderBlocks([
    renderSummaryBlock('Project Status', summarizeProjectStatus(status), [
      { label: 'Project', value: projectAlias },
      { label: 'Project ID', value: status.projectId },
      { label: 'Exists', value: status.exists ? 'yes' : 'no' },
    ]),
    renderStatusBlock('Execution Status', [
      { label: 'Current stage', value: status.state.currentStage, state: 'info' },
      { label: 'Completed stages', value: status.state.completedStages.join(', ') || '(none)' },
      { label: 'Autonomy', value: status.state.autonomy },
      { label: 'Artifacts', value: String(status.artifacts.length), state: status.artifacts.length > 0 ? 'ok' : 'info' },
      { label: 'Updated at', value: status.state.updatedAt },
    ]),
    renderPhaseProgressBlock('Phase Progress', buildProjectPhaseProgress(status)),
    renderArtifactTree('Artifact Tree', buildArtifactTreeFromPaths(status.artifacts), {
      rootLabel: projectAlias,
    }),
    renderNextActionsBlock('Next Actions', deriveProjectStatusNextActions(status)),
  ]);
}

function renderManagedProjectStatusReport(
  projectAlias: string,
  snapshot: ManagedProjectSnapshot,
  repositoryInitialized: boolean,
  projectVersion?: string,
): string {
  const workflowSource = deriveManagedWorkflowSource(snapshot, repositoryInitialized);
  const currentStage = deriveManagedCurrentStage(snapshot, repositoryInitialized);
  const completedStages = deriveManagedCompletedStages(snapshot, repositoryInitialized);

  return renderBlocks([
    renderSummaryBlock('Project Status', summarizeManagedProjectStatus(snapshot, repositoryInitialized), [
      { label: 'Project', value: projectAlias },
      { label: 'Project ID', value: snapshot.projectId },
      { label: 'Managed state', value: repositoryInitialized ? 'initialized' : 'repair required' },
      { label: 'Workflow source', value: workflowSource.replace(/_/g, ' ') },
      { label: 'Binary version', value: CLI_VERSION },
      ...(projectVersion ? [{ label: 'Project version', value: projectVersion }] : []),
    ]),
    renderStatusBlock('Workflow Status', [
      { label: 'Current stage', value: currentStage || '(not set)', state: 'info' },
      { label: 'Completed stages', value: completedStages.join(', ') || '(none)' },
      { label: 'Active change', value: snapshot.activeChange?.id || '(none)', state: snapshot.activeChange ? mapChangeState(snapshot.activeChange.status) : 'info' },
      { label: 'Active spec', value: snapshot.activeSpec?.id || '(none)', state: snapshot.activeSpec ? mapSpecState(snapshot.activeSpec.status) : 'info' },
      { label: 'Active run', value: snapshot.activeRun?.id || '(none)', state: snapshot.activeRun ? mapRunState(snapshot.activeRun.status) : 'info' },
      { label: 'Next executable slice', value: snapshot.executableSlice?.id || '(none)', state: snapshot.executableSlice ? mapSliceState(snapshot.executableSlice.status) : 'info' },
      { label: 'Changes', value: String(snapshot.changes.length), state: snapshot.changes.length > 0 ? 'ok' : 'info' },
      { label: 'Specs', value: String(snapshot.specs.length), state: snapshot.specs.length > 0 ? 'ok' : 'info' },
      { label: 'Slices', value: String(snapshot.slices.length), state: snapshot.slices.length > 0 ? 'ok' : 'info' },
      { label: 'Runs', value: String(snapshot.runs.length), state: snapshot.runs.length > 0 ? 'ok' : 'info' },
      { label: 'Pending gates', value: String(snapshot.ledger.pendingGateIds.length), state: snapshot.ledger.pendingGateIds.length > 0 ? 'warn' : 'ok' },
      { label: 'Blockers', value: String(snapshot.ledger.blockers.length), state: snapshot.ledger.blockers.length > 0 ? 'warn' : 'ok' },
      { label: 'Legacy pipeline record', value: snapshot.legacyPipelineStatus.exists ? 'materialized' : 'not materialized', state: snapshot.legacyPipelineStatus.exists ? 'info' : 'ok' },
      { label: 'Updated at', value: snapshot.lastUpdatedAt || '(not recorded yet)' },
    ]),
    renderPhaseProgressBlock('Phase Progress', buildManagedPhaseProgress(snapshot, repositoryInitialized)),
    renderArtifactTree('Artifact Tree', buildArtifactTreeFromPaths(snapshot.artifactFiles), {
      rootLabel: projectAlias,
    }),
    renderNextActionsBlock('Next Actions', deriveManagedProjectNextActions(snapshot, repositoryInitialized)),
  ]);
}

function summarizeManagedProjectStatus(snapshot: ManagedProjectSnapshot, repositoryInitialized: boolean): string {
  if (!repositoryInitialized) {
    return 'Managed repository state needs repair before workflow status is trustworthy.';
  }

  if (snapshot.activeRun) {
    return `${snapshot.projectId} is executing run '${snapshot.activeRun.id}' for slice '${snapshot.activeRun.sliceId}'.`;
  }

  if (snapshot.ledger.pendingGateIds.length > 0) {
    return `${snapshot.projectId} is waiting on ${snapshot.ledger.pendingGateIds.length} gate decision(s) before the active workflow can proceed.`;
  }

  if (snapshot.executableSlice) {
    return `${snapshot.projectId} has executable slice '${snapshot.executableSlice.id}' ready for slice-first execution.`;
  }

  if (snapshot.activeChange) {
    const stage = snapshot.activeChange.currentStage || 'pm';
    return `${snapshot.projectId} has active change '${snapshot.activeChange.id}' in stage '${stage}'.`;
  }

  if (!hasOperationalWorkflowState(snapshot) && !snapshot.legacyPipelineStatus.exists) {
    return `${snapshot.projectId} is initialized and ready to start the managed workflow.`;
  }

  if (hasOperationalWorkflowState(snapshot)) {
    return `${snapshot.projectId} has stored operational workflow state but no active change is currently selected.`;
  }

  return summarizeProjectStatus(snapshot.legacyPipelineStatus);
}

function deriveManagedProjectNextActions(snapshot: ManagedProjectSnapshot, repositoryInitialized: boolean): string[] {
  if (!repositoryInitialized) {
    return ['Run `s2s init` to repair the managed `.s2s` state.'];
  }

  if (snapshot.ledger.pendingGateIds.length > 0) {
    const firstGateId = snapshot.ledger.pendingGateIds[0];
    const activeChangeId = snapshot.activeChange?.id || snapshot.gates.find((gate) => gate.id === firstGateId)?.changeId;
    return [
      activeChangeId ? `Run \`s2s show change ${activeChangeId}\` to inspect the blocked scope.` : 'Run `s2s show slices` to inspect the current stored scope.',
      `Use \`s2s approve ${firstGateId}\` or \`s2s reject ${firstGateId}\` to record the gate decision.`,
    ];
  }

  if (snapshot.activeRun) {
    return [
      `Run \`s2s show run ${snapshot.activeRun.id}\` to inspect the active execution record.`,
      `Run \`s2s show slice ${snapshot.activeRun.sliceId}\` to inspect the executing slice context.`,
    ];
  }

  if (snapshot.executableSlice) {
    return [
      `Run \`s2s show slice ${snapshot.executableSlice.id}\` to inspect the next executable slice.`,
      'Use `s2s stage engineering_exec` to execute the next ready slice.',
    ];
  }

  if (!hasOperationalWorkflowState(snapshot) && !snapshot.legacyPipelineStatus.exists) {
    return [
      'Run `s2s stage pm` to start the managed workflow.',
      'Run `s2s doctor` if you want to re-check governance and client readiness first.',
    ];
  }

  if (snapshot.activeChange?.currentStage && snapshot.activeChange.currentStage !== 'engineering_exec') {
    return [
      `Run \`s2s show change ${snapshot.activeChange.id}\` to inspect the active stored scope.`,
      `Run \`s2s stage ${snapshot.activeChange.currentStage}\` to continue the active change.`,
    ];
  }

  if (snapshot.activeChange) {
    return [
      `Run \`s2s show blockers ${snapshot.activeChange.id}\` to inspect why no slice is currently executable.`,
      'Run `s2s show runs` to inspect the stored execution history for this change.',
    ];
  }

  if (!hasOperationalWorkflowState(snapshot) && snapshot.legacyPipelineStatus.exists) {
    return deriveProjectStatusNextActions(snapshot.legacyPipelineStatus);
  }

  return [
    'Run `s2s show runs` to inspect the stored execution history.',
    'Run `s2s show slices` to inspect the current stored workflow slices.',
    'Run `s2s doctor` if you need a governance or client readiness check first.',
  ];
}

function summarizeProjectStatus(status: ProjectStatus): string {
  const artifactCount = status.artifacts.length;
  const completedCount = status.state.completedStages.length;
  const totalStages = PIPELINE_PROGRESS_STAGES.length;
  const pipelineComplete = PIPELINE_PROGRESS_STAGES.every((stage) => status.state.completedStages.includes(stage));
  if (pipelineComplete) {
    return `${status.projectId} has completed the current pipeline with ${artifactCount} artifact(s).`;
  }
  return `${status.projectId} is currently in ${status.state.currentStage} with ${completedCount}/${totalStages} stages complete and ${artifactCount} artifact(s).`;
}

function buildProjectPhaseProgress(status: ProjectStatus): OutputRendererPhaseStep[] {
  return PIPELINE_PROGRESS_STAGES.map((stage) => {
    const done = status.state.completedStages.includes(stage);
    const current = status.state.currentStage === stage && !done;
    return {
      label: stage,
      state: done ? 'done' : current ? 'current' : 'pending',
    };
  });
}

function deriveProjectStatusNextActions(status: ProjectStatus): string[] {
  if (!status.exists) {
    return ['Run `s2s stage pm` to initialize the managed workflow.'];
  }

  const allStagesComplete = PIPELINE_PROGRESS_STAGES.every((stage) => status.state.completedStages.includes(stage));
  if (allStagesComplete) {
    return [
      'Run `s2s doctor` to verify governance and client readiness before the next change.',
      'Run `s2s backup` to snapshot the current managed state.',
    ];
  }

  return [
    `Run \`s2s stage ${status.state.currentStage}\` to continue the pipeline.`,
    'Run `s2s doctor` if you need a governance or client readiness check first.',
  ];
}

async function handleStageCommand(args: string[], invokedCommand: string): Promise<void> {
  if (args.length === 2 && isHelpFlag(String(args[1] || '').trim())) {
    printHelp('stage');
    return;
  }
  if (args.length < 1 || args.length > 2) {
    console.error(
      'Usage: s2s stage <stage> [project]\nSupported stages: pm, research, design, engineering, engineering_exec\nHelp: s2s help stage',
    );
    process.exit(1);
  }
  const stage = String(args[0] || '').trim().toLowerCase();
  if (!isSupportedStage(stage)) {
    console.error(
      'Usage: s2s stage <stage> [project]\nSupported stages: pm, research, design, engineering, engineering_exec\nHelp: s2s help stage',
    );
    process.exit(1);
  }
  const projectArg = args[1] ? String(args[1]).trim() : undefined;
  const context = await ensureProjectContextWithAutomaticOnboarding(projectArg, {
    commandName: 'stage',
  });
  enforceGuardrailPolicyForExecution(context, stage);
  const localState = readLocalState(context);
  const selectedClient = localState.lastDetectedClient ?? detectUIHintFromEnvironment() ?? 'codex';
  if (!getActiveCLIFlags().json) {
    printSessionBanner({
      invokedCommand,
      s2sStatus: 'ACTIVE',
      projectAlias: context.projectMeta.alias,
      appRoot: context.appRoot,
      client: selectedClient,
      stage,
      wrapperPrefixLabel: 'N/A (stage command)',
    });
  }

  process.env.S2S_DISABLE_COSTS = '1';
  const stageStartedAt = new Date().toISOString();
  await withCwd(context.s2sDir, async () => {
    const previousStageAppRoot = process.env.S2S_STAGE_APP_ROOT;
    const previousStageClient = process.env.S2S_STAGE_CLIENT;
    const previousStageName = process.env.S2S_STAGE_NAME;
    const projectId = context.projectMeta.projectId;
    const status = getProjectStatus(projectId);
    if (!status.exists) {
      await initProject(`Initial project setup for ${context.projectMeta.alias}`, projectId);
    }
    process.env.S2S_STAGE_APP_ROOT = context.appRoot;
    process.env.S2S_STAGE_CLIENT = selectedClient;
    process.env.S2S_STAGE_NAME = stage;
    try {
      // engineering_exec is a slice-execution operation, not an orchestration-pipeline stage.
      // It bypasses synthetic-change creation and route checks entirely, then exits early.
      if (stage === 'engineering_exec') {
        const runtime = readJsonFile<RuntimeConfig>(path.join(context.configDir, 'runtime.json')) || defaultRuntimeConfig(context.projectMeta);
        const showVerbose = runtime.verbose !== false && !getActiveCLIFlags().json;
        const ledger = deriveLedger(projectId);
        const route = ledger.effectiveRoute ?? ledger.lastDecision?.decision.recommendedStages ?? [];
        const routeStr = route.length > 0 ? route.join(' → ') : '(none)';
        const intent = ledger.lastDecision?.decision.intent ?? '(unknown)';

        if (getActiveCLIFlags().submit) {
          try {
            const submitResult = await recordStageCompletion(projectId, stage as PipelineStage, runtime.quality);
            const scoreStr = (submitResult.overallScore * 100).toFixed(0);
            if (showVerbose) {
              if (submitResult.nextAction) {
                console.log(`[s2s] ${stage} submitted · quality ${scoreStr}% ✓`);
                console.log(`[s2s] ${submitResult.nextAction}`);
              } else {
                console.log(`[s2s] ${stage} submitted · quality ${scoreStr}% ✓`);
              }
            }
            writeLiveState(context.s2sDir, {
              updatedAt: new Date().toISOString(),
              project: context.projectMeta.alias,
              feature: ledger.lastDecision?.request,
              intent: ledger.lastDecision?.decision.intent,
              route,
              stage,
              status: submitResult.passed ? 'submitted' : 'context_delivered',
              nextAction: submitResult.nextAction,
            });
            if (showVerbose) console.log(`[s2s] Live state updated → .s2s/live.md`);
          } catch (error) {
            failCLI(error instanceof Error ? error.message : String(error));
          }
          return;
        }

        if (showVerbose) {
          console.log(`[s2s] stage · engineering_exec · route: ${routeStr} · intent: ${intent}`);
          console.log(`[s2s] Project: ${context.projectMeta.alias} · ${context.appRoot}`);
        }

        const { contextOnly } = getActiveCLIFlags();
        const execRun = startEngineeringExecChatNativeRun(projectId, context.appRoot);
        console.log(execRun.contextPackage);
        const execFootnote = resolveChatPermissionsFootnote(context.projectMetaPath);
        if (execFootnote) console.log(execFootnote);
        if (!contextOnly) {
          writeLiveState(context.s2sDir, {
            updatedAt: new Date().toISOString(),
            project: context.projectMeta.alias,
            feature: ledger.lastDecision?.request,
            intent: ledger.lastDecision?.decision.intent,
            route,
            stage,
            status: 'context_delivered',
            nextAction: `implement slice ${execRun.sliceId} on branch ${execRun.branchName}, then run: s2s stage engineering_exec --submit`,
          });
          if (showVerbose) {
            console.log(`[s2s] Run ${execRun.runId} started for slice ${execRun.sliceId} · live state updated → .s2s/live.md`);
          }
        }
        return;
      }

      const currentLedger = deriveLedger(projectId);
      const { refine: refineRequested, refinePrompt } = getActiveCLIFlags();
      if (!currentLedger.activeChangeId || !currentLedger.lastDecision || refineRequested) {
        const syntheticPrompt = refineRequested && currentLedger.activeChangeId
          ? (refinePrompt ?? `Refine the active change through ${stage} stage`)
          : `Run ${stage} stage for project ${context.projectMeta.alias}`;
        try {
          initializeSpec(projectId, syntheticPrompt, stageStartedAt);
        } catch (error) {
          warnOrchestrator('initializeSpec', error, context.s2sDir);
        }
      }
      const routeLedger = deriveLedger(projectId);
      if (routeLedger.lastDecision && !getActiveCLIFlags().json) {
        const decision = routeLedger.lastDecision.decision;
        const route = decision.recommendedStages || [];
        const stageInRoute = route.includes(stage as PipelineStage);
        const routeLabel = route.length > 0 ? route.join(' → ') : '(none)';
        console.log(`[orchestrator] intent=${decision.intent} route=${routeLabel}`);
        if (!stageInRoute && route.length > 0) {
          const skipDecision = (decision.stageDecisions || []).find(
            (d) => d.stage === stage && d.action === 'skip',
          );
          const reason = skipDecision?.reason || `'${stage}' is not in the recommended route for this request.`;
          console.warn(`[orchestrator] warning: ${reason}`);
          const flags = getActiveCLIFlags();
          if (flags.yes) {
            console.warn(`[orchestrator] proceeding (--yes).`);
          } else if (!hasInteractivePromptTerminal()) {
            console.warn(`[orchestrator] proceeding (non-interactive).`);
          } else {
            const confirmed = await promptYesNoInteractive(`Run '${stage}' anyway?`, false);
            if (!confirmed) {
              const nextInRoute = route[0];
              console.log(`[orchestrator] stage '${stage}' skipped.`);
              if (nextInRoute) {
                console.log(`[orchestrator] suggested next: s2s stage ${nextInRoute}`);
              }
              return;
            }
          }
        }
      }
      const runtime = readJsonFile<RuntimeConfig>(path.join(context.configDir, 'runtime.json')) || defaultRuntimeConfig(context.projectMeta);

      // --submit: record artifact completion, run quality checks, advance ledger.
      if (getActiveCLIFlags().submit) {
        const ledger = deriveLedger(projectId);
        const showVerbose = runtime.verbose !== false && !getActiveCLIFlags().json;
        try {
          const submitResult = await recordStageCompletion(projectId, stage as PipelineStage, runtime.quality);
          const scoreStr = (submitResult.overallScore * 100).toFixed(0);
          const threshold = ((runtime.quality?.minAutoApproveScore ?? 0.85) * 100).toFixed(0);
          if (!submitResult.passed) {
            if (showVerbose) {
              console.log(`[s2s] ${stage} submitted · quality ${scoreStr}% ✗ · threshold ${threshold}%`);
              for (const issue of submitResult.issues) {
                console.log(`  · ${issue}`);
              }
            }
            if (runtime.quality?.blockOnFailure) process.exit(1);
          } else if (submitResult.gateCreated) {
            if (showVerbose) {
              console.log(`[s2s] ${stage} submitted · quality ${scoreStr}% ✓ · gate created (${submitResult.gateId})`);
              const reviewBlock = renderArtifactReviewBlock(stage, projectId, context.s2sDir);
              if (reviewBlock) console.log(reviewBlock);
              console.log(renderGateActionPrompt(submitResult.gateId ?? '', stage));
            }
          } else {
            if (showVerbose) {
              const next = submitResult.nextStage ? `next: s2s stage ${submitResult.nextStage}` : 'all stages complete';
              console.log(`[s2s] ${stage} submitted · quality ${scoreStr}% ✓ · ${next}`);
            }
          }
          const liveStatus = submitResult.gateCreated ? 'gate_pending' : (submitResult.passed ? 'submitted' : 'context_delivered');
          writeLiveState(context.s2sDir, {
            updatedAt: new Date().toISOString(),
            project: context.projectMeta.alias,
            feature: ledger.lastDecision?.request,
            intent: ledger.lastDecision?.decision.intent,
            route: ledger.effectiveRoute ?? ledger.lastDecision?.decision.recommendedStages ?? [],
            stage,
            status: liveStatus,
            nextAction: submitResult.nextAction,
          });
          if (showVerbose) console.log(`[s2s] Live state updated → .s2s/live.md`);
          if (submitResult.warnings && submitResult.warnings.length > 0) {
            for (const warning of submitResult.warnings) {
              console.log(`[s2s] WARNING: ${warning}`);
            }
          }
        } catch (error) {
          failCLI(error instanceof Error ? error.message : String(error));
        }
        return;
      }

      // Chat-native mode: output a structured context package for the chat AI to act on.
      if ((runtime.pipelineMode ?? 'chat-native') !== 'standalone') {
        const { contextOnly } = getActiveCLIFlags();
        const ledger = deriveLedger(projectId);
        const route = ledger.effectiveRoute ?? ledger.lastDecision?.decision.recommendedStages ?? [];
        const stagePosition = route.indexOf(stage as PipelineStage);
        const positionStr = stagePosition >= 0 ? `${stagePosition + 1}/${route.length}` : '?';
        const routeStr = route.length > 0 ? route.join(' → ') : '(none)';
        const intent = ledger.lastDecision?.decision.intent ?? '(unknown)';
        const showVerbose = runtime.verbose !== false && !getActiveCLIFlags().json;

        if (showVerbose) {
          console.log(`[s2s] stage ${positionStr} · ${stage} · route: ${routeStr} · intent: ${intent}`);
          console.log(`[s2s] Project: ${context.projectMeta.alias} · ${context.appRoot}`);
        }

        const contextPackage = buildStageContext(projectId, stage as PipelineStage, context.appRoot);
        console.log(contextPackage);
        const stageFootnote = resolveChatPermissionsFootnote(context.projectMetaPath);
        if (stageFootnote) console.log(stageFootnote);

        if (!contextOnly) {
          writeLiveState(context.s2sDir, {
            updatedAt: new Date().toISOString(),
            project: context.projectMeta.alias,
            feature: ledger.lastDecision?.request,
            intent: ledger.lastDecision?.decision.intent,
            route,
            stage,
            status: 'context_delivered',
            nextAction: `generate artifact(s) for '${stage}' stage, write to .s2s/artifacts/${projectId}/, then run: s2s stage ${stage} --submit`,
          });
          if (showVerbose) {
            console.log(`[s2s] Live state updated → .s2s/live.md`);
          }
        }
        return;
      }

      const result = await runStage(projectId, stage);
      const conflicts = getGovernanceConflictView(context).active;
      const completedAt = new Date().toISOString();
      const stageSummary = String(result.summary || '').trim() || 'Stage finished without summary output.';
      writeStageExecutionArtifact(context.s2sDir, {
        stage,
        status: 'success',
        projectAlias: context.projectMeta.alias,
        appRoot: context.appRoot,
        guardrailPolicy: normalizeGuardrailPolicy(runtime.guardrailPolicy),
        activeConflictCount: conflicts.length,
        startedAt: stageStartedAt,
        completedAt,
        summary: stageSummary,
      });
      let orchestratorNextStage: PipelineStage | undefined;
      try {
        const ownershipResult = advanceStageOwnership(projectId, stage as PipelineStage, stageSummary, completedAt);
        orchestratorNextStage = ownershipResult.nextStage;
        if (ownershipResult.approvalReady) {
          try {
            const gateType = 'spec_review';
            createWorkGate(projectId, {
              changeId: ownershipResult.change.id,
              type: gateType,
              title: `Review ${stage} stage completion`,
              reason: `Stage ${stage} completed and requires approval before advancing.`,
              specId: ownershipResult.spec.id,
              createdAt: completedAt,
            });
          } catch (error) {
            warnOrchestrator('createWorkGate', error, context.s2sDir);
          }
        }
        if (stage === 'engineering') {
          try {
            const techSpecContent = readArtifact(projectId, 'TechSpec.md');
            const backlogContent = readArtifact(projectId, 'Backlog.md');
            if (techSpecContent && backlogContent) {
              deriveAndPersistSlices(
                parseSliceDerivationInput({
                  projectId,
                  change: ownershipResult.change,
                  spec: ownershipResult.spec,
                  techSpecContent,
                  backlogContent,
                }),
                { persistedAt: completedAt },
              );
            }
          } catch (error) {
            warnOrchestrator('deriveAndPersistSlices', error, context.s2sDir);
          }
        }
      } catch (error) {
        warnOrchestrator('advanceStageOwnership', error, context.s2sDir);
      }
      writeLocalState(context, { lastStage: stage, lastUsedAt: completedAt });
      {
        const ledger = deriveLedger(projectId);
        const route = ledger.effectiveRoute ?? ledger.lastDecision?.decision.recommendedStages ?? [];
        writeLiveState(context.s2sDir, {
          updatedAt: completedAt,
          project: context.projectMeta.alias,
          feature: ledger.lastDecision?.request,
          intent: ledger.lastDecision?.decision.intent,
          route,
          stage,
          status: result.qualityReport.passed ? 'approved' : 'submitted',
          nextAction: result.qualityReport.passed
            ? (orchestratorNextStage ? `run s2s stage ${orchestratorNextStage}` : 'stage complete — run s2s status for next actions')
            : `quality check failed (score: ${result.qualityReport.score}) — review and re-run s2s stage ${stage}`,
        });
      }
      const updatedSnapshot = loadManagedProjectSnapshot(projectId);
      console.log(renderBlocks([
        renderSummaryBlock('Execution Summary', stageSummary || `Stage completed: ${stage}.`, [
          { label: 'Project', value: context.projectMeta.alias },
          { label: 'Stage', value: stage },
          { label: 'Outcome', value: 'completed' },
        ]),
        renderStatusBlock('Result', [
          { label: 'Stage completed', value: stage, state: 'ok' },
          { label: 'Quality passed', value: result.qualityReport.passed ? 'yes' : 'no', state: result.qualityReport.passed ? 'ok' : 'warn' },
          { label: 'Quality score', value: String(result.qualityReport.score) },
        ]),
        renderArtifactTree('Artifact Tree', buildArtifactTreeFromLabels(Object.keys(result.artifacts)), {
          rootLabel: context.projectMeta.alias,
        }),
        renderNextActionsBlock('Next Actions', [
          ...(orchestratorNextStage ? [`Run \`s2s stage ${orchestratorNextStage}\` to continue the orchestrated route.`] : []),
          ...deriveManagedProjectNextActions(updatedSnapshot, true),
        ]),
      ]));
    } catch (error) {
      const runtime = readJsonFile<RuntimeConfig>(path.join(context.configDir, 'runtime.json')) || defaultRuntimeConfig(context.projectMeta);
      const conflicts = getGovernanceConflictView(context).active;
      const completedAt = new Date().toISOString();
      writeStageExecutionArtifact(context.s2sDir, {
        stage,
        status: 'failed',
        projectAlias: context.projectMeta.alias,
        appRoot: context.appRoot,
        guardrailPolicy: normalizeGuardrailPolicy(runtime.guardrailPolicy),
        activeConflictCount: conflicts.length,
        startedAt: stageStartedAt,
        completedAt,
        summary: String((error as Error)?.message || error || 'Unknown stage execution error.'),
      });
      throw error;
    } finally {
      restoreStageExecutionEnv('S2S_STAGE_APP_ROOT', previousStageAppRoot);
      restoreStageExecutionEnv('S2S_STAGE_CLIENT', previousStageClient);
      restoreStageExecutionEnv('S2S_STAGE_NAME', previousStageName);
    }
  });
}

async function handleRequestCommand(args: string[]): Promise<void> {
  if (args.length >= 1 && isHelpFlag(String(args[0] || '').trim())) {
    printHelp('request');
    return;
  }
  if (args.length < 1) {
    failCLI('Usage: s2s request "<prompt>" [project]\nHelp: s2s help request', { usage: 's2s request "<prompt>" [project]' });
  }
  const prompt = String(args[0] || '').trim();
  if (!prompt) {
    failCLI('Usage: s2s request "<prompt>" [project]\nA non-empty prompt is required.\nHelp: s2s help request');
  }
  const projectArg = args[1] ? String(args[1]).trim() : undefined;
  const context = await ensureProjectContextWithAutomaticOnboarding(projectArg, { commandName: 'request' });
  if (!getActiveCLIFlags().json) {
    printRequestBanner(context.projectMeta.alias);
  }
  const projectId = context.projectMeta.projectId;
  const decidedAt = new Date().toISOString();

  await withCwd(context.s2sDir, async () => {
    const status = getProjectStatus(projectId);
    if (!status.exists) {
      await initProject(`Initial project setup for ${context.projectMeta.alias}`, projectId);
    }
    try {
      const result = initializeSpec(projectId, prompt, decidedAt);
      const decision = result.decision.decision;
      if (getActiveCLIFlags().json) {
        printJson({
          ok: true,
          ...commandMeta('request', { projectId, prompt }),
          intent: decision.intent,
          confidence: decision.confidence,
          nextStage: decision.nextStage,
          recommendedStages: decision.recommendedStages,
          skippedStages: decision.skippedStages,
          requiresHumanApproval: decision.requiresHumanApproval,
          createChange: decision.createChange,
          createSpec: decision.createSpec,
          resumeChangeId: decision.resumeChangeId || null,
          changeId: result.change.id,
          specId: result.spec.id,
          changeCreated: result.changeCreated,
          specCreated: result.specCreated,
          rationale: decision.rationale,
        });
        return;
      }
      const stageList = decision.recommendedStages.length > 0
        ? decision.recommendedStages.join(' → ')
        : '(none)';
      console.log(renderBlocks([
        renderSummaryBlock('Request Decision', decision.rationale, [
          { label: 'Prompt', value: prompt },
          { label: 'Intent', value: `${decision.intent} (${((decision.confidence ?? 0) * 100).toFixed(0)}% confidence)` },
          { label: 'Route', value: stageList },
          { label: 'Next stage', value: decision.nextStage || '(none)' },
          { label: 'Approval required', value: decision.requiresHumanApproval ? 'yes' : 'no' },
        ]),
        renderStatusBlock('Work Entities', [
          { label: 'Change', value: result.change.id, state: result.changeCreated ? 'ok' : 'info' },
          { label: 'Spec', value: result.spec.id, state: result.specCreated ? 'ok' : 'info' },
          { label: result.changeCreated ? 'Created new change' : 'Reusing active change', value: result.change.title, state: 'info' },
        ]),
        renderNextActionsBlock('Next Actions', [
          decision.nextStage ? `s2s stage ${decision.nextStage}` : null,
          's2s status',
          's2s show change',
        ].filter(Boolean) as string[]),
      ]));
      writeLiveState(context.s2sDir, {
        updatedAt: decidedAt,
        project: context.projectMeta.alias,
        feature: prompt,
        intent: decision.intent,
        route: decision.recommendedStages,
        status: 'none',
        nextAction: decision.nextStage ? `run: s2s stage ${decision.nextStage}` : 'no stage route — check s2s status',
      });
      console.log(`[s2s] Live state updated → .s2s/live.md`);
    } catch (error) {
      warnOrchestrator('request', error, context.s2sDir);
      failCLI(`Request orchestration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

async function handleStatusCommand(args: string[]): Promise<void> {
  if (args.length > 1) {
    failCLI('Usage: s2s status [project]\nHelp: s2s help status', { usage: 's2s status [project]' });
  }
  const projectArg = resolveRepoScopedArgument(args[0] ? String(args[0]).trim() : undefined, 'Usage: s2s status [project]\nHelp: s2s help status');
  const context = await ensureProjectContextWithAutomaticOnboarding(projectArg, {
    commandName: 'status',
  });

  await withCwd(context.s2sDir, async () => {
    const projectId = context.projectMeta.projectId;
    const projectVersion = context.projectMeta.templateVersion;
    const snapshot = loadManagedProjectSnapshot(projectId);
    const repositoryInitialized = true;
    if (getActiveCLIFlags().json) {
      printJson({
        ok: true,
        ...commandMeta('status', { appRoot: context.appRoot }),
        project: context.projectMeta.alias,
        versions: {
          binary: CLI_VERSION,
          project: projectVersion,
        },
        status: {
          projectId,
          exists: repositoryInitialized,
          repositoryInitialized,
          workflowSource: deriveManagedWorkflowSource(snapshot, repositoryInitialized),
          currentStage: deriveManagedCurrentStage(snapshot, repositoryInitialized) || null,
          completedStages: deriveManagedCompletedStages(snapshot, repositoryInitialized),
          pipelineMaterialized: snapshot.legacyPipelineStatus.exists,
          activeChangeId: snapshot.ledger.activeChangeId || null,
          activeSpecId: snapshot.ledger.activeSpecId || null,
          activeRunId: snapshot.activeRun?.id || null,
          executableSliceId: snapshot.executableSlice?.id || null,
          pendingGateIds: snapshot.ledger.pendingGateIds,
          blockerIds: snapshot.ledger.blockers,
          counts: {
            changes: snapshot.changes.length,
            specs: snapshot.specs.length,
            slices: snapshot.slices.length,
            runs: snapshot.runs.length,
            gates: snapshot.gates.length,
            artifacts: snapshot.artifactFiles.length,
          },
          pipeline: snapshot.legacyPipelineStatus,
          nextActions: deriveManagedProjectNextActions(snapshot, repositoryInitialized),
          updatedAt: snapshot.lastUpdatedAt || null,
        },
      });
      return;
    }
    console.log(renderManagedProjectStatusReport(context.projectMeta.alias, snapshot, repositoryInitialized, projectVersion));
  });
}

async function handleShowCommand(args: string[]): Promise<void> {
  const usage = [
    'Usage: s2s show change <id>',
    '   or: s2s show spec <id>',
    '   or: s2s show slice <id>',
    '   or: s2s show slices',
    '   or: s2s show run <id>',
    '   or: s2s show runs',
    '   or: s2s show blockers <changeId>',
    '   or: s2s show dependencies <sliceId>',
    'Help: s2s help show',
  ].join('\n');
  const subject = String(args[0] || '').trim().toLowerCase();
  const target = String(args[1] || '').trim();

  if (
    !(
      ((subject === 'change' || subject === 'spec' || subject === 'slice' || subject === 'run' || subject === 'blockers' || subject === 'dependencies') && target && args.length === 2)
      || ((subject === 'slices' || subject === 'runs') && args.length === 1)
    )
  ) {
    failCLI(usage, { usage: 's2s show <subject>' });
  }

  const context = await ensureProjectContextWithAutomaticOnboarding(undefined, {
    commandName: 'show',
  });

  await withCwd(context.s2sDir, async () => {
    const projectId = context.projectMeta.projectId;
    const snapshot = loadManagedProjectSnapshot(projectId);

    if (subject === 'change') {
      const change = getChange(projectId, target);
      if (!change) {
        failCLI(`Change '${target}' was not found in project '${projectId}'.`);
      }
      const relatedSpecs = snapshot.specs.filter((spec) => spec.changeId === change.id);
      const relatedSlices = snapshot.slices.filter((slice) => slice.changeId === change.id);
      const relatedRuns = snapshot.runs.filter((run) => run.changeId === change.id);
      const relatedGates = snapshot.gates.filter((gate) => gate.changeId === change.id);
      if (getActiveCLIFlags().json) {
        printJson({
          ok: true,
          ...commandMeta('show', { appRoot: context.appRoot, subject }),
          project: context.projectMeta.alias,
          subject,
          change,
          related: {
            specIds: relatedSpecs.map((spec) => spec.id),
            sliceIds: relatedSlices.map((slice) => slice.id),
            runIds: relatedRuns.map((run) => run.id),
            gateIds: relatedGates.map((gate) => gate.id),
          },
        });
        return;
      }
      console.log(renderBlocks([
        renderSummaryBlock('Change Inspection', change.summary || change.title, [
          { label: 'Change ID', value: change.id },
          { label: 'Title', value: change.title },
          { label: 'Intent', value: change.intent },
        ]),
        renderStatusBlock('Change Status', [
          { label: 'Status', value: change.status, state: mapChangeState(change.status) },
          { label: 'Current stage', value: change.currentStage || '(not set)' },
          { label: 'Active spec', value: change.activeSpecId || '(none)' },
          { label: 'Specs', value: String(relatedSpecs.length), state: relatedSpecs.length > 0 ? 'ok' : 'info' },
          { label: 'Slices', value: String(relatedSlices.length), state: relatedSlices.length > 0 ? 'ok' : 'info' },
          { label: 'Runs', value: String(relatedRuns.length), state: relatedRuns.length > 0 ? 'ok' : 'info' },
          { label: 'Gates', value: String(relatedGates.length), state: relatedGates.some((gate) => gate.status === 'pending') ? 'warn' : relatedGates.length > 0 ? 'ok' : 'info' },
          { label: 'Blockers', value: String(change.blockerIds.length), state: change.blockerIds.length > 0 ? 'warn' : 'ok' },
          { label: 'Updated at', value: change.updatedAt },
        ]),
        renderNextActionsBlock('Next Actions', [
          change.activeSpecId ? `Run \`s2s show spec ${change.activeSpecId}\` to inspect the active spec.` : 'Run `s2s show slices` to inspect the stored slice list.',
          `Run \`s2s show blockers ${change.id}\` to inspect the current blocker set.`,
        ]),
      ]));
      return;
    }

    if (subject === 'spec') {
      const spec = getSpec(projectId, target);
      if (!spec) {
        failCLI(`Spec '${target}' was not found in project '${projectId}'.`);
      }
      const relatedSlices = snapshot.slices.filter((slice) => slice.specId === spec.id);
      const relatedRuns = snapshot.runs.filter((run) => run.specId === spec.id);
      const relatedGates = snapshot.gates.filter((gate) => gate.specId === spec.id);
      if (getActiveCLIFlags().json) {
        printJson({
          ok: true,
          ...commandMeta('show', { appRoot: context.appRoot, subject }),
          project: context.projectMeta.alias,
          subject,
          spec,
          related: {
            sliceIds: relatedSlices.map((slice) => slice.id),
            runIds: relatedRuns.map((run) => run.id),
            gateIds: relatedGates.map((gate) => gate.id),
          },
        });
        return;
      }
      console.log(renderBlocks([
        renderSummaryBlock('Spec Inspection', spec.summary || spec.title, [
          { label: 'Spec ID', value: spec.id },
          { label: 'Title', value: spec.title },
          { label: 'Change ID', value: spec.changeId },
          { label: 'Version', value: String(spec.version) },
        ]),
        renderStatusBlock('Spec Status', [
          { label: 'Status', value: spec.status, state: mapSpecState(spec.status) },
          { label: 'Goals', value: String(spec.goals.length), state: spec.goals.length > 0 ? 'ok' : 'info' },
          { label: 'Constraints', value: String(spec.constraints.length), state: spec.constraints.length > 0 ? 'ok' : 'info' },
          { label: 'Acceptance criteria', value: String(spec.acceptanceCriteria.length), state: spec.acceptanceCriteria.length > 0 ? 'ok' : 'info' },
          { label: 'Source artifacts', value: String(spec.sourceArtifacts.length), state: spec.sourceArtifacts.length > 0 ? 'ok' : 'info' },
          { label: 'Slices', value: String(relatedSlices.length), state: relatedSlices.length > 0 ? 'ok' : 'info' },
          { label: 'Runs', value: String(relatedRuns.length), state: relatedRuns.length > 0 ? 'ok' : 'info' },
          { label: 'Gates', value: String(relatedGates.length), state: relatedGates.some((gate) => gate.status === 'pending') ? 'warn' : relatedGates.length > 0 ? 'ok' : 'info' },
          { label: 'Updated at', value: spec.updatedAt },
        ]),
        renderNextActionsBlock('Next Actions', [
          relatedSlices[0] ? `Run \`s2s show slice ${relatedSlices[0].id}\` to inspect the next stored slice for this spec.` : 'Run `s2s show slices` to inspect the stored slice list for this project.',
          `Run \`s2s show change ${spec.changeId}\` to inspect the owning change.`,
        ]),
      ]));
      return;
    }

    if (subject === 'slice') {
      const slice = getSlice(projectId, target);
      if (!slice) {
        failCLI(`Slice '${target}' was not found in project '${projectId}'.`);
      }
      const dependencies = slice.dependencyIds
        .map((dependencyId) => getSlice(projectId, dependencyId))
        .filter((dependency): dependency is WorkSlice => Boolean(dependency));
      const relatedRuns = snapshot.runs.filter((run) => run.sliceId === slice.id);
      if (getActiveCLIFlags().json) {
        printJson({
          ok: true,
          ...commandMeta('show', { appRoot: context.appRoot, subject }),
          project: context.projectMeta.alias,
          subject,
          slice,
          related: {
            runIds: relatedRuns.map((run) => run.id),
          },
          dependencies,
          blockers: slice.blockers,
        });
        return;
      }
      console.log(renderBlocks([
        renderSummaryBlock('Slice Inspection', slice.summary || slice.title, [
          { label: 'Slice ID', value: slice.id },
          { label: 'Spec ID', value: slice.specId },
          { label: 'Change ID', value: slice.changeId },
          { label: 'Sequence', value: String(slice.sequence) },
        ]),
        renderStatusBlock('Slice Status', [
          { label: 'Status', value: slice.status, state: mapSliceState(slice.status) },
          { label: 'Priority', value: slice.priority, state: 'info' },
          { label: 'Size', value: slice.size, state: 'info' },
          { label: 'Dependencies', value: String(dependencies.length), state: dependencies.length > 0 ? 'info' : 'ok' },
          { label: 'Runs', value: String(relatedRuns.length), state: relatedRuns.length > 0 ? 'ok' : 'info' },
          { label: 'Acceptance checks', value: String(slice.acceptanceChecks.length), state: slice.acceptanceChecks.length > 0 ? 'ok' : 'info' },
          { label: 'Blockers', value: String(slice.blockers.length), state: slice.blockers.length > 0 ? 'warn' : 'ok' },
          { label: 'Updated at', value: slice.updatedAt },
        ]),
        renderStatusBlock(
          'Resolved Dependencies',
          dependencies.map((dependency) => ({
            label: dependency.id,
            value: `${dependency.status} • seq ${dependency.sequence} • ${dependency.title}`,
            state: mapSliceState(dependency.status),
          })),
          'No stored dependencies.',
        ),
        slice.blockers.length > 0 ? renderWarningsBlock('Blockers', slice.blockers) : undefined,
        renderNextActionsBlock('Next Actions', [
          relatedRuns[0] ? `Run \`s2s show run ${relatedRuns[0].id}\` to inspect the latest run for this slice.` : `Run \`s2s show dependencies ${slice.id}\` to inspect dependency details for this slice.`,
          `Run \`s2s show change ${slice.changeId}\` to inspect the owning change.`,
        ]),
      ]));
      return;
    }

    if (subject === 'slices') {
      if (getActiveCLIFlags().json) {
        printJson({
          ok: true,
          ...commandMeta('show', { appRoot: context.appRoot, subject }),
          project: context.projectMeta.alias,
          subject,
          activeChangeId: snapshot.ledger.activeChangeId || null,
          activeSpecId: snapshot.ledger.activeSpecId || null,
          slices: snapshot.slices,
        });
        return;
      }
      console.log(renderBlocks([
        renderSummaryBlock(
          'Slice Inspection',
          snapshot.slices.length > 0
            ? `${snapshot.slices.length} stored slice(s) found for ${projectId}.`
            : `No stored slices found for ${projectId}.`,
          [
            { label: 'Active change', value: snapshot.activeChange?.id || '(none)' },
            { label: 'Active spec', value: snapshot.activeSpec?.id || '(none)' },
          ],
        ),
        renderStatusBlock(
          'Stored Slices',
          snapshot.slices.map((slice) => ({
            label: slice.id,
            value: `${slice.status} • seq ${slice.sequence} • ${slice.title}`,
            state: mapSliceState(slice.status),
            detail: `dependencies=${slice.dependencyIds.length}, blockers=${slice.blockers.length}`,
          })),
          'No stored slices recorded yet.',
        ),
        renderNextActionsBlock('Next Actions', [
          snapshot.executableSlice ? `Run \`s2s show slice ${snapshot.executableSlice.id}\` to inspect the next executable slice.` : snapshot.activeChange ? `Run \`s2s show change ${snapshot.activeChange.id}\` to inspect the active owning change.` : 'Run `s2s status` to inspect the overall managed workflow state.',
          snapshot.executableSlice ? 'Use `s2s stage engineering_exec` to execute the next ready slice.' : 'Run `s2s show runs` to inspect existing execution attempts and blockers.',
        ]),
      ]));
      return;
    }

    if (subject === 'runs') {
      if (getActiveCLIFlags().json) {
        printJson({
          ok: true,
          ...commandMeta('show', { appRoot: context.appRoot, subject }),
          project: context.projectMeta.alias,
          subject,
          activeRunId: snapshot.activeRun?.id || null,
          runs: snapshot.runs,
        });
        return;
      }
      console.log(renderBlocks([
        renderSummaryBlock(
          'Run Inspection',
          snapshot.runs.length > 0
            ? `${snapshot.runs.length} stored run(s) found for ${projectId}.`
            : `No stored runs found for ${projectId}.`,
          [
            { label: 'Active run', value: snapshot.activeRun?.id || '(none)' },
            { label: 'Next executable slice', value: snapshot.executableSlice?.id || '(none)' },
          ],
        ),
        renderStatusBlock(
          'Stored Runs',
          snapshot.runs.map((run) => ({
            label: run.id,
            value: `${run.status} • slice ${run.sliceId} • ${run.resultSummary || run.branchName || run.provider}`,
            state: mapRunState(run.status),
            detail: `branch=${run.branchName || '(none)'}, pr=${run.pullRequestNumber || '(none)'}`,
          })),
          'No stored runs recorded yet.',
        ),
        renderNextActionsBlock('Next Actions', [
          snapshot.activeRun ? `Run \`s2s show run ${snapshot.activeRun.id}\` to inspect the active execution record.` : snapshot.executableSlice ? `Run \`s2s show slice ${snapshot.executableSlice.id}\` to inspect the next executable slice.` : 'Run `s2s show slices` to inspect the stored slice queue.',
          snapshot.executableSlice ? 'Use `s2s stage engineering_exec` to execute the next ready slice.' : 'Run `s2s status` to inspect the broader workflow state.',
        ]),
      ]));
      return;
    }

    if (subject === 'run') {
      const run = getRun(projectId, target);
      if (!run) {
        failCLI(`Run '${target}' was not found in project '${projectId}'.`);
      }
      const relatedSlice = getSlice(projectId, run.sliceId);
      const relatedChange = getChange(projectId, run.changeId);
      const relatedSpec = getSpec(projectId, run.specId);
      if (getActiveCLIFlags().json) {
        printJson({
          ok: true,
          ...commandMeta('show', { appRoot: context.appRoot, subject }),
          project: context.projectMeta.alias,
          subject,
          run,
          related: {
            changeId: relatedChange?.id || null,
            specId: relatedSpec?.id || null,
            sliceId: relatedSlice?.id || null,
          },
        });
        return;
      }
      console.log(renderBlocks([
        renderSummaryBlock('Run Inspection', run.resultSummary || `Inspect execution run ${run.id}.`, [
          { label: 'Run ID', value: run.id },
          { label: 'Change ID', value: run.changeId },
          { label: 'Slice ID', value: run.sliceId },
        ]),
        renderStatusBlock('Run Status', [
          { label: 'Status', value: run.status, state: mapRunState(run.status) },
          { label: 'Provider', value: run.provider, state: 'info' },
          { label: 'Branch', value: run.branchName || '(none)' },
          { label: 'Worktree', value: run.worktreePath || '(none)' },
          { label: 'Verification passed', value: run.verificationPassed === undefined ? '(not recorded)' : run.verificationPassed ? 'yes' : 'no', state: run.verificationPassed === undefined ? 'info' : run.verificationPassed ? 'ok' : 'warn' },
          { label: 'Pull request', value: run.pullRequestUrl || (run.pullRequestNumber ? `#${run.pullRequestNumber}` : '(none)') },
          { label: 'Evidence', value: String(run.evidence.length), state: run.evidence.length > 0 ? 'ok' : 'info' },
          { label: 'Updated at', value: run.updatedAt },
        ]),
        renderStatusBlock('Linked Records', [
          { label: 'Change', value: relatedChange?.id || run.changeId, state: relatedChange ? mapChangeState(relatedChange.status) : 'info' },
          { label: 'Spec', value: relatedSpec?.id || run.specId, state: relatedSpec ? mapSpecState(relatedSpec.status) : 'info' },
          { label: 'Slice', value: relatedSlice?.id || run.sliceId, state: relatedSlice ? mapSliceState(relatedSlice.status) : 'info' },
        ]),
        run.evidence.length > 0
          ? renderStatusBlock(
            'Evidence',
            run.evidence.map((evidence, index) => ({
              label: evidence.kind,
              value: evidence.path || evidence.url || `(evidence ${index + 1})`,
              state: 'info',
              detail: evidence.summary,
            })),
          )
          : undefined,
        renderNextActionsBlock('Next Actions', [
          `Run \`s2s show slice ${run.sliceId}\` to inspect the slice tied to this run.`,
          `Run \`s2s show change ${run.changeId}\` to inspect the owning change.`,
        ]),
      ]));
      return;
    }

    if (subject === 'blockers') {
      const change = getChange(projectId, target);
      if (!change) {
        failCLI(`Change '${target}' was not found in project '${projectId}'.`);
      }
      const blockedSlices = snapshot.slices
        .filter((slice) => slice.changeId === change.id && (slice.status === 'blocked' || slice.blockers.length > 0))
        .map((slice) => ({ id: slice.id, blockers: slice.blockers }));
      const pendingGates = snapshot.gates.filter((gate) => gate.changeId === change.id && gate.status === 'pending');
      const blockers = [
        ...change.blockerIds.map((blockerId) => ({ type: 'change', id: blockerId })),
        ...blockedSlices.map((slice) => ({ type: 'slice', id: slice.id })),
        ...pendingGates.map((gate) => ({ type: 'gate', id: gate.id })),
      ];
      if (getActiveCLIFlags().json) {
        printJson({
          ok: true,
          ...commandMeta('show', { appRoot: context.appRoot, subject }),
          project: context.projectMeta.alias,
          subject,
          changeId: change.id,
          blockers,
          pendingGates,
          blockedSlices,
        });
        return;
      }
      console.log(renderBlocks([
        renderSummaryBlock(
          'Blocker Inspection',
          blockers.length > 0
            ? `${change.id} currently has ${blockers.length} stored blocker signal(s).`
            : `${change.id} has no stored blockers right now.`,
          [
            { label: 'Change ID', value: change.id },
            { label: 'Status', value: change.status },
          ],
        ),
        renderStatusBlock(
          'Blocker Set',
          blockers.map((blocker) => ({
            label: blocker.type,
            value: blocker.id,
            state: blocker.type === 'gate' ? 'warn' : blocker.type === 'slice' ? 'warn' : 'info',
          })),
          'No blockers recorded.',
        ),
        renderNextActionsBlock('Next Actions', [
          `Run \`s2s show change ${change.id}\` to inspect the full owning change.`,
          pendingGates[0] ? `Use \`s2s approve ${pendingGates[0].id}\` or \`s2s reject ${pendingGates[0].id}\` if a pending gate is waiting on a decision.` : 'Use `s2s stage engineering_exec` once an executable slice is available again.',
        ]),
      ]));
      return;
    }

    const slice = getSlice(projectId, target);
    if (!slice) {
      failCLI(`Slice '${target}' was not found in project '${projectId}'.`);
    }
    const dependencies = slice.dependencyIds
      .map((dependencyId) => getSlice(projectId, dependencyId))
      .filter((dependency): dependency is WorkSlice => Boolean(dependency));
    if (getActiveCLIFlags().json) {
      printJson({
        ok: true,
        ...commandMeta('show', { appRoot: context.appRoot, subject }),
        project: context.projectMeta.alias,
        subject,
        slice,
        dependencies,
        blockers: slice.blockers,
      });
      return;
    }
    console.log(renderBlocks([
      renderSummaryBlock('Dependency Inspection', slice.summary || slice.title, [
        { label: 'Slice ID', value: slice.id },
        { label: 'Spec ID', value: slice.specId },
        { label: 'Change ID', value: slice.changeId },
      ]),
      renderStatusBlock('Dependency Status', [
        { label: 'Slice status', value: slice.status, state: mapSliceState(slice.status) },
        { label: 'Dependencies', value: String(dependencies.length), state: dependencies.length > 0 ? 'info' : 'ok' },
        { label: 'Blockers', value: String(slice.blockers.length), state: slice.blockers.length > 0 ? 'warn' : 'ok' },
        { label: 'Updated at', value: slice.updatedAt },
      ]),
      renderStatusBlock(
        'Resolved Dependencies',
        dependencies.map((dependency) => ({
          label: dependency.id,
          value: `${dependency.status} • seq ${dependency.sequence} • ${dependency.title}`,
          state: mapSliceState(dependency.status),
        })),
        'No stored dependencies.',
      ),
      slice.blockers.length > 0
        ? renderWarningsBlock('Blockers', slice.blockers)
        : undefined,
      renderNextActionsBlock('Next Actions', [
        `Run \`s2s show change ${slice.changeId}\` to inspect the owning change.`,
        'Use `s2s show slices` to inspect the broader stored slice queue.',
      ]),
    ]));
  });
}

function handleExecuteCommand(args: string[]): void {
  if (
    args.length === 1
    && (isHelpFlag(String(args[0] || '').trim()) || String(args[0]).trim() === '--ready' || String(args[0]).trim().startsWith('--slice='))
  ) {
    if (isHelpFlag(String(args[0] || '').trim())) {
      printHelp('execute');
      return;
    }
  }
  if (args.length === 2 && String(args[0]).trim() === '--slice' && String(args[1]).trim()) {
    failUnavailableCommand('execute', [
      'The supported execution path already uses explicit slice selection.',
      `Use \`s2s show slice ${String(args[1]).trim()}\` to inspect the requested slice.`,
      'Use `s2s stage engineering_exec` for the supported slice-first execution path.',
    ]);
  }
  failUnavailableCommand('execute', [
    'The supported execution path already uses explicit slice selection.',
    'Use `s2s show slices` or `s2s show runs` to inspect current execution state.',
    'Use `s2s stage engineering_exec` for the supported slice-first execution path.',
  ]);
}

function handleResumeCommand(args: string[]): void {
  if (args.length === 1 && isHelpFlag(String(args[0] || '').trim())) {
    printHelp('resume');
    return;
  }
  failUnavailableCommand('resume', [
    'Targeted resume flows are not yet part of the current release surface.',
    'Use `s2s show change <id>` or `s2s show slice <id>` to inspect the stored owning scope.',
    'Use `s2s status` to see the next supported operational action.',
  ]);
}

async function handleApproveCommand(args: string[]): Promise<void> {
  if (args.length !== 1 || !String(args[0] || '').trim()) {
    failCLI('Usage: s2s approve <gateId>\nHelp: s2s help approve', { usage: 's2s approve <gateId>' });
  }
  const gateId = String(args[0]).trim();
  const context = await ensureProjectContextWithAutomaticOnboarding(undefined, {
    commandName: 'approve',
  });

  await withCwd(context.s2sDir, async () => {
    const projectId = context.projectMeta.projectId;
    const gate = getGate(projectId, gateId);
    if (!gate) {
      failCLI(`Gate '${gateId}' was not found in project '${projectId}'.`);
    }
    if (gate.status !== 'pending') {
      failCLI(`Gate '${gateId}' is already ${gate.status}.`);
    }
    const preview = {
      gateId: gate.id,
      currentStatus: gate.status,
      targetStatus: 'approved',
      changeId: gate.changeId,
      specId: gate.specId || null,
      sliceId: gate.sliceId || null,
      runId: gate.runId || null,
    };
    if (getActiveCLIFlags().dryRun) {
      if (getActiveCLIFlags().json) {
        printJson({
          ok: true,
          ...commandMeta('approve', { appRoot: context.appRoot, dryRun: true }),
          project: context.projectMeta.alias,
          preview,
        });
        return;
      }
      console.log(renderBlocks([
        renderSummaryBlock('Gate Approval Preview', `Gate ${gate.id} would be approved.`, [
          { label: 'Change ID', value: gate.changeId },
          { label: 'Gate type', value: gate.type },
        ]),
        renderStatusBlock('Preview', [
          { label: 'Current status', value: gate.status, state: 'warn' },
          { label: 'Target status', value: 'approved', state: 'ok' },
        ]),
      ]));
      return;
    }
    await confirmHumanApprovalCommand({
      action: `Approve gate '${gate.id}' for project '${context.projectMeta.alias}'?`,
      canceledMessage: `Canceled gate approval for '${gate.id}'.`,
    });
    const result = approveGate(projectId, gate.id, {
      actor: 's2s approve',
    });
    if (getActiveCLIFlags().json) {
      printJson({
        ok: true,
        ...commandMeta('approve', { appRoot: context.appRoot }),
        project: context.projectMeta.alias,
        result,
      });
      return;
    }
    console.log(renderBlocks([
      renderSummaryBlock('Gate Approval Result', `Approved gate ${result.gate.id}.`, [
        { label: 'Project', value: context.projectMeta.alias },
        { label: 'Gate type', value: result.gate.type },
      ]),
      renderStatusBlock('Resolved Gate', [
        { label: 'Gate ID', value: result.gate.id, state: 'ok' },
        { label: 'Status', value: result.gate.status, state: 'ok' },
        { label: 'Change', value: result.change.id, state: mapChangeState(result.change.status) },
        { label: 'Spec', value: result.spec?.id || '(none)', state: result.spec ? mapSpecState(result.spec.status) : 'info' },
        { label: 'Resolved at', value: result.gate.resolvedAt || result.gate.updatedAt },
      ]),
      renderNextActionsBlock('Next Actions', [
        `Run \`s2s status --repo ${context.appRoot}\` to inspect the refreshed managed state.`,
        `Run \`s2s show change ${result.change.id}\` to inspect the owning change.`,
      ]),
    ]));
    writeLiveState(context.s2sDir, {
      updatedAt: new Date().toISOString(),
      project: context.projectMeta.alias,
      status: 'approved',
      nextAction: `gate approved — run: s2s status to see next stage`,
    });
    console.log(`[s2s] Live state updated → .s2s/live.md`);
  });
}

async function handleRejectCommand(args: string[]): Promise<void> {
  if (args.length !== 1 || !String(args[0] || '').trim()) {
    failCLI('Usage: s2s reject <gateId>\nHelp: s2s help reject', { usage: 's2s reject <gateId>' });
  }
  const gateId = String(args[0]).trim();
  const context = await ensureProjectContextWithAutomaticOnboarding(undefined, {
    commandName: 'reject',
  });

  await withCwd(context.s2sDir, async () => {
    const projectId = context.projectMeta.projectId;
    const gate = getGate(projectId, gateId);
    if (!gate) {
      failCLI(`Gate '${gateId}' was not found in project '${projectId}'.`);
    }
    if (gate.status !== 'pending') {
      failCLI(`Gate '${gateId}' is already ${gate.status}.`);
    }
    const preview = {
      gateId: gate.id,
      currentStatus: gate.status,
      targetStatus: 'rejected',
      changeId: gate.changeId,
      specId: gate.specId || null,
      sliceId: gate.sliceId || null,
      runId: gate.runId || null,
    };
    if (getActiveCLIFlags().dryRun) {
      if (getActiveCLIFlags().json) {
        printJson({
          ok: true,
          ...commandMeta('reject', { appRoot: context.appRoot, dryRun: true }),
          project: context.projectMeta.alias,
          preview,
        });
        return;
      }
      console.log(renderBlocks([
        renderSummaryBlock('Gate Rejection Preview', `Gate ${gate.id} would be rejected.`, [
          { label: 'Change ID', value: gate.changeId },
          { label: 'Gate type', value: gate.type },
        ]),
        renderStatusBlock('Preview', [
          { label: 'Current status', value: gate.status, state: 'warn' },
          { label: 'Target status', value: 'rejected', state: 'fail' },
        ]),
      ]));
      return;
    }
    await confirmHumanApprovalCommand({
      action: `Reject gate '${gate.id}' for project '${context.projectMeta.alias}'?`,
      canceledMessage: `Canceled gate rejection for '${gate.id}'.`,
    });
    const result = rejectGate(projectId, gate.id, {
      actor: 's2s reject',
    });
    if (getActiveCLIFlags().json) {
      printJson({
        ok: true,
        ...commandMeta('reject', { appRoot: context.appRoot }),
        project: context.projectMeta.alias,
        result,
      });
      return;
    }
    console.log(renderBlocks([
      renderSummaryBlock('Gate Rejection Result', `Rejected gate ${result.gate.id}.`, [
        { label: 'Project', value: context.projectMeta.alias },
        { label: 'Gate type', value: result.gate.type },
      ]),
      renderStatusBlock('Resolved Gate', [
        { label: 'Gate ID', value: result.gate.id, state: 'warn' },
        { label: 'Status', value: result.gate.status, state: 'fail' },
        { label: 'Change', value: result.change.id, state: mapChangeState(result.change.status) },
        { label: 'Spec', value: result.spec?.id || '(none)', state: result.spec ? mapSpecState(result.spec.status) : 'info' },
        { label: 'Resolved at', value: result.gate.resolvedAt || result.gate.updatedAt },
      ]),
      renderNextActionsBlock('Next Actions', [
        `Run \`s2s show change ${result.change.id}\` to inspect the blocked owning change.`,
        `Run \`s2s status --repo ${context.appRoot}\` to inspect the refreshed managed state.`,
      ]),
    ]));
    writeLiveState(context.s2sDir, {
      updatedAt: new Date().toISOString(),
      project: context.projectMeta.alias,
      status: 'rejected',
      nextAction: `gate rejected — run: s2s status to inspect the blocked change`,
    });
    console.log(`[s2s] Live state updated → .s2s/live.md`);
  });
}

async function handleWorktreesCommand(args: string[]): Promise<void> {
  if (args.length === 2 && String(args[0]).trim().toLowerCase() === 'list' && isHelpFlag(String(args[1] || '').trim())) {
    printHelp('worktrees');
    return;
  }
  if (!(args.length === 1 && String(args[0]).trim().toLowerCase() === 'list')) {
    failCLI('Usage: s2s worktrees list\nHelp: s2s help worktrees', { usage: 's2s worktrees list' });
  }

  const context = await ensureProjectContextWithAutomaticOnboarding(undefined, {
    commandName: 'worktrees',
  });

  const runtime = readJsonFile<RuntimeConfig>(path.join(context.configDir, 'runtime.json')) || defaultRuntimeConfig(context.projectMeta);
  const toolConfig = buildToolConfigSurfacing(context, runtime);
  const worktreesRootPath = toolConfig.runtimeWorkspace.worktreesRootPath;
  const entries = existsSync(worktreesRootPath)
    ? readdirSync(worktreesRootPath)
      .map((name) => {
        const fullPath = path.join(worktreesRootPath, name);
        if (!statSync(fullPath).isDirectory()) return null;
        const stats = statSync(fullPath);
        return {
          name,
          path: fullPath,
          updatedAt: new Date(stats.mtimeMs).toISOString(),
        };
      })
      .filter((entry): entry is { name: string; path: string; updatedAt: string } => Boolean(entry))
      .sort((left, right) => left.name.localeCompare(right.name))
    : [];

  if (getActiveCLIFlags().json) {
    printJson({
      ok: true,
      ...commandMeta('worktrees', { appRoot: context.appRoot }),
      project: context.projectMeta.alias,
      worktrees: {
        rootPath: worktreesRootPath,
        exists: existsSync(worktreesRootPath),
        directoryName: toolConfig.runtimeWorkspace.worktreesDirName,
        entries,
      },
    });
    return;
  }

  console.log(renderBlocks([
    renderSummaryBlock(
      'Managed Worktrees',
      entries.length > 0
        ? `${entries.length} worktree director${entries.length === 1 ? 'y' : 'ies'} found under the configured managed root.`
        : 'No managed worktree directories exist under the configured root yet.',
      [
        { label: 'Project', value: context.projectMeta.alias },
        { label: 'Root path', value: worktreesRootPath },
      ],
    ),
    renderStatusBlock('Worktrees Root', [
      { label: 'Directory name', value: toolConfig.runtimeWorkspace.worktreesDirName },
      { label: 'Exists', value: existsSync(worktreesRootPath) ? 'yes' : 'no', state: existsSync(worktreesRootPath) ? 'ok' : 'info' },
      { label: 'Entries', value: String(entries.length), state: entries.length > 0 ? 'ok' : 'info' },
    ]),
    renderStatusBlock(
      'Managed Worktrees',
      entries.map((entry) => ({
        label: entry.name,
        value: entry.path,
        state: 'info',
        detail: `updatedAt=${entry.updatedAt}`,
      })),
      'No managed worktrees recorded yet.',
    ),
    renderNextActionsBlock('Next Actions', [
      'Run `s2s config` to inspect the resolved runtime workspace configuration.',
      'Managed worktrees will appear here as execution flows create them.',
    ]),
  ]));
}

// handleCompletionCommand extracted to ./cli/handlers/completion.ts

async function handleDoctorCommand(args: string[]): Promise<void> {
  if (args.length > 1) {
    failCLI('Usage: s2s doctor [project]\nHelp: s2s help doctor', { usage: 's2s doctor [project]' });
  }
  const projectArg = resolveRepoScopedArgument(args[0] ? String(args[0]).trim() : undefined, 'Usage: s2s doctor [project]\nHelp: s2s help doctor');
  const context = await ensureProjectContextWithAutomaticOnboarding(projectArg, {
    commandName: 'doctor',
  });
  const localState = readLocalState(context);

  const checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail'; detail: string; remediation?: string }> = [];
  const runtimeForDoctor = readJsonFile<RuntimeConfig>(path.join(context.configDir, 'runtime.json')) || defaultRuntimeConfig(context.projectMeta);
  const isStandaloneMode = runtimeForDoctor.pipelineMode === 'standalone';
  const requiredFiles = [
    path.join(context.s2sDir, 'project.json'),
    path.join(context.s2sDir, 'project.local.json'),
    path.join(context.configDir, 'runtime.json'),
    path.join(context.configDir, 'backup.policy.json'),
    path.join(context.configDir, 'governance.exceptions.json'),
    path.join(context.s2sDir, 'guardrails', 'AGENTS.md'),
    path.join(context.s2sDir, 'guardrails', 'CODEX.md'),
    path.join(context.s2sDir, 'guardrails', 'CLAUDE.md'),
  ];
  for (const filePath of requiredFiles) {
    const rel = path.relative(context.appRoot, filePath);
    const present = existsSync(filePath);
    checks.push({
      name: `File exists: ${rel}`,
      status: present ? 'ok' : 'fail',
      detail: filePath,
      remediation: present ? undefined : `Run s2s in project root to regenerate missing governance/config files.`,
    });
  }
  // llm.json is only required in standalone mode; chat-native mode does not use an LLM provider
  const llmJsonPath = path.join(context.configDir, 'llm.json');
  const llmJsonPresent = existsSync(llmJsonPath);
  if (isStandaloneMode) {
    checks.push({
      name: `File exists: .s2s/config/llm.json`,
      status: llmJsonPresent ? 'ok' : 'fail',
      detail: llmJsonPath,
      remediation: 'Run `s2s config edit` to configure standalone LLM provider settings.',
    });
    if (llmJsonPresent) {
      const llmConfig = readJsonFile<{ apiKeyEnvVar?: string }>(llmJsonPath);
      const apiKeyVar = llmConfig?.apiKeyEnvVar;
      if (apiKeyVar) {
        const apiKeySet = Boolean(process.env[apiKeyVar]);
        checks.push({
          name: `Standalone: ${apiKeyVar} is set`,
          status: apiKeySet ? 'ok' : 'warn',
          detail: `env var ${apiKeyVar} ${apiKeySet ? 'is present' : 'is not set'}`,
          remediation: apiKeySet ? undefined : `Set the ${apiKeyVar} environment variable before running s2s stage in standalone mode.`,
        });
      }
    }
  } else {
    checks.push({
      name: `Pipeline mode: ${runtimeForDoctor.pipelineMode ?? 'chat-native'} (llm.json not required)`,
      status: 'ok',
      detail: 'Chat-native mode: the chat AI handles all LLM calls. No llm.json needed.',
    });
  }

  checks.push({
    name: 'Root AGENTS.md has managed block',
    status: fileHasMarker(path.join(context.appRoot, 'AGENTS.md'), ROOT_GUARDRAIL_START) ? 'ok' : 'fail',
    detail: path.join(context.appRoot, 'AGENTS.md'),
    remediation: 'Re-run s2s from project root to re-install managed governance blocks.',
  });
  checks.push({
    name: 'Root CODEX.md has managed block',
    status: fileHasMarker(path.join(context.appRoot, 'CODEX.md'), ROOT_CODEX_ADAPTER_START) ? 'ok' : 'warn',
    detail: path.join(context.appRoot, 'CODEX.md'),
    remediation: 'Run s2s in an interactive terminal in this directory.',
  });
  checks.push({
    name: 'Root CLAUDE.md has managed block',
    status: fileHasMarker(path.join(context.appRoot, 'CLAUDE.md'), ROOT_CLAUDE_ADAPTER_START) ? 'ok' : 'warn',
    detail: path.join(context.appRoot, 'CLAUDE.md'),
    remediation: 'Run s2s in an interactive terminal in this directory.',
  });
  checks.push({
    name: 'Project Claude guardrail has bootstrap protocol',
    status: fileHasText(path.join(context.s2sDir, 'guardrails', 'CLAUDE.md'), 'Session bootstrap (required on first response):')
      ? 'ok'
      : 'warn',
    detail: path.join(context.s2sDir, 'guardrails', 'CLAUDE.md'),
    remediation: 'Run s2s from project root to refresh .s2s/guardrails/CLAUDE.md.',
  });
  checks.push({
    name: 'Root CLAUDE.md is a compatibility shim',
    status: fileHasText(path.join(context.appRoot, 'CLAUDE.md'), 'This root block is a compatibility shim for Claude.')
      ? 'ok'
      : 'warn',
    detail: path.join(context.appRoot, 'CLAUDE.md'),
    remediation: 'Run s2s in an interactive terminal in this directory.',
  });

  const runtime = readJsonFile<RuntimeConfig>(path.join(context.configDir, 'runtime.json')) || defaultRuntimeConfig(context.projectMeta);
  const toolConfig = buildToolConfigSurfacing(context, runtime);
  const guardrailPolicy = normalizeGuardrailPolicy(runtime?.guardrailPolicy);
  const conflictView = getGovernanceConflictView(context);
  const conflicts = conflictView.active;
  const blockingConflict = hasBlockingGuardrailConflict(conflicts);
  checks.push({
    name: 'Guardrail conflict policy',
    status: guardrailPolicy === 'strict' ? 'ok' : 'warn',
    detail: `runtime.guardrailPolicy=${guardrailPolicy}`,
    remediation: guardrailPolicy === 'strict'
      ? undefined
      : 'Set runtime.guardrailPolicy=strict for production-safe behavior.',
  });
  if (conflicts.length === 0) {
    checks.push({
      name: 'Root guardrail discrepancies',
      status: 'ok',
      detail: conflictView.excepted.length > 0
        ? `No active discrepancies. ${conflictView.excepted.length} discrepancy(ies) covered by governance exceptions.`
        : 'No guardrail discrepancies detected outside managed S2S blocks.',
    });
  } else {
    const status: 'warn' | 'fail' = guardrailPolicy === 'strict' && blockingConflict ? 'fail' : 'warn';
    checks.push({
      name: 'Root guardrail discrepancies',
      status,
      detail: `${conflicts.length} discrepancy(s) detected in root adapter files.`,
      remediation: status === 'fail'
        ? 'Resolve conflicts or set guardrailPolicy=warn temporarily via s2s config edit.'
        : 'Review discrepancies and resolve toward strict policy.',
    });
    for (const conflict of conflicts.slice(0, 5)) {
      checks.push({
        name: `Discrepancy: ${conflict.fileName} [${conflict.ruleId}]`,
        status: conflict.severity === 'fail' && guardrailPolicy === 'strict' ? 'fail' : 'warn',
        detail: conflict.snippet,
        remediation: `${conflict.description} (${conflict.filePath})`,
      });
    }
  }
  if (conflictView.excepted.length > 0) {
    checks.push({
      name: 'Governance exceptions active',
      status: 'warn',
      detail: `${conflictView.excepted.length} discrepancy(ies) are marked as approved exceptions.`,
      remediation: 'Review .s2s/config/governance.exceptions.json periodically and resolve exceptions when possible.',
    });
  }
  const observability = normalizeChatObservability(runtime?.chatObservability);
  checks.push({
    name: 'Session banner observability is enabled',
    status: observability.sessionBannerEnabled ? 'ok' : 'warn',
    detail: `runtime.chatObservability.sessionBannerEnabled=${observability.sessionBannerEnabled}`,
    remediation: observability.sessionBannerEnabled ? undefined : 'Set runtime.chatObservability.sessionBannerEnabled=true.',
  });
  checks.push({
    name: 'Wrapper prefix mode configured',
    status: observability.wrapperPrefixEnabled ? 'warn' : 'ok',
    detail: `runtime.chatObservability.wrapperPrefixEnabled=${observability.wrapperPrefixEnabled}`,
    remediation: observability.wrapperPrefixEnabled
      ? 'Wrapper prefix is enabled. In interactive terminals, fallback behavior may apply depending on client support.'
      : 'Set runtime.chatObservability.wrapperPrefixEnabled=true to enable turn-level prefix mode.',
  });

  const activeClient = localState.lastDetectedClient;
  checks.push({
    name: 'Detected chat UI',
    status: activeClient ? 'ok' : 'warn',
    detail: String(activeClient || 'not detected'),
    remediation: activeClient ? undefined : 'Open a supported chat UI (codex, claude, opencode) in this directory.',
  });

  const projectUpdate = detectProjectUpdateRequirement(context.projectMeta);
  if (projectUpdate.mode === 'none') {
    checks.push({
      name: 'Project managed files are up to date',
      status: 'ok',
      detail: `templateVersion=${context.projectMeta.templateVersion}, schemaVersion=${context.projectMeta.schemaVersion}`,
    });
  } else if (projectUpdate.mode === 'hard') {
    checks.push({
      name: 'Mandatory project update',
      status: 'fail',
      detail: projectUpdate.reason,
      remediation: 'Run s2s in an interactive terminal and confirm mandatory project update before continuing.',
    });
  } else {
    const pending = localState.pendingProjectUpdate;
    checks.push({
      name: 'Soft project update pending',
      status: 'warn',
      detail: pending
        ? `${pending.reason}; deferredAt=${pending.deferredAt || pending.detectedAt}`
        : projectUpdate.reason,
      remediation: 'Run s2s in interactive mode and accept project update when prompted.',
    });
  }

  {
    const cliCommand = activeClient || 'codex';
    const hasCommand = commandExists(cliCommand);
    checks.push({
      name: `CLI command available (${cliCommand})`,
      status: hasCommand ? 'ok' : 'warn',
      detail: hasCommand
        ? `${cliCommand} detected in PATH`
        : `${cliCommand} not found in PATH`,
      remediation: hasCommand
        ? undefined
        : `Install/authenticate ${cliCommand}, then rerun s2s doctor.`,
    });
  }

  {
    const protocolPath = path.join(context.s2sDir, 'protocol.md');
    const protocolPresent = existsSync(protocolPath);
    checks.push({
      name: 'File exists: .s2s/protocol.md',
      status: protocolPresent ? 'ok' : 'warn',
      detail: protocolPath,
      remediation: protocolPresent ? undefined : 'Run `s2s update` to regenerate protocol.md.',
    });
    if (protocolPresent) {
      const protocolContent = readFileSync(protocolPath, 'utf8');
      const versionMatch = protocolContent.includes(`Version: ${TEMPLATE_VERSION}`);
      checks.push({
        name: 'protocol.md version matches CLI',
        status: versionMatch ? 'ok' : 'warn',
        detail: versionMatch
          ? `Version ${TEMPLATE_VERSION}`
          : `Version mismatch — expected ${TEMPLATE_VERSION}`,
        remediation: versionMatch ? undefined : 'Run `s2s update` to regenerate protocol.md.',
      });
    }
  }

  {
    const liveMdPath = path.join(context.s2sDir, 'live.md');
    const liveMdPresent = existsSync(liveMdPath);
    checks.push({
      name: 'File exists: .s2s/live.md',
      status: liveMdPresent ? 'ok' : 'warn',
      detail: liveMdPath,
      remediation: liveMdPresent ? undefined : 'Run `s2s update` to regenerate live.md.',
    });
  }

  {
    const agentsGuardrailPath = path.join(context.s2sDir, 'guardrails', 'AGENTS.md');
    if (existsSync(agentsGuardrailPath)) {
      const agentsContent = readFileSync(agentsGuardrailPath, 'utf8');
      const hasLiveMdPointer = agentsContent.includes('live.md');
      const hasRequestInstruction = agentsContent.includes('s2s request');
      const isOldPattern = hasRequestInstruction && !hasLiveMdPointer;
      checks.push({
        name: 'Governance templates use current pattern',
        status: isOldPattern ? 'warn' : 'ok',
        detail: isOldPattern
          ? 'AGENTS.md uses old governance pattern — missing live.md pointer'
          : 'Governance templates are up to date',
        remediation: isOldPattern ? 'Run `s2s update` to refresh governance templates.' : undefined,
      });
    }
  }

  const hasFailures = checks.some((item) => item.status === 'fail');
  if (getActiveCLIFlags().json) {
    printJson({
      ok: !hasFailures,
      ...commandMeta('doctor', { appRoot: context.appRoot }),
      project: context.projectMeta.alias,
      projectRoot: context.appRoot,
      s2sPath: context.s2sDir,
      toolConfig,
      checks,
    });
    if (hasFailures) {
      process.exit(1);
    }
    return;
  }
  console.log(renderBlocks([
    renderSummaryBlock('Doctor Report', hasFailures ? 'Doctor checks found blocking issues.' : 'Doctor checks passed without blocking issues.', [
      { label: 'Project', value: context.projectMeta.alias },
      { label: 'Project root', value: context.appRoot },
      { label: '.s2s path', value: context.s2sDir },
    ]),
    renderStatusBlock('Resolved Runtime Paths', [
      { label: 'Global control home', value: toolConfig.globalPaths.controlHome, state: 'info' },
      { label: 'Global runtime home', value: toolConfig.globalPaths.runtimeHome, state: 'info' },
      { label: 'Global worktrees home', value: toolConfig.globalPaths.worktreesHome, state: 'info' },
      { label: 'Project backup root', value: toolConfig.globalPaths.projectBackupRoot, state: 'info' },
      { label: 'Managed LLM workspace', value: toolConfig.globalPaths.llmWorkspaceRoot, state: 'info' },
      { label: 'Workspace repo path', value: toolConfig.runtimeWorkspace.projectRepoPath, state: 'info' },
      { label: 'Worktrees root path', value: toolConfig.runtimeWorkspace.worktreesRootPath, state: 'info' },
      { label: 'Execution template', value: toolConfig.execution.templateId, state: 'info' },
    ]),
    renderDoctorCheckMatrix('Doctor Check Matrix', checks.map((check) => ({
      label: check.name,
      value: check.detail,
      state: check.status,
      remediation: check.status === 'ok' ? undefined : check.remediation,
    }))),
  ]));

  if (hasFailures) {
    process.exit(1);
  }
}

async function handleBackupCommand(args: string[]): Promise<void> {
  if (args.length > 1) {
    failCLI('Usage: s2s backup [project]\nHelp: s2s help backup', { usage: 's2s backup [project]' });
  }
  const projectArg = resolveRepoScopedArgument(args[0] ? String(args[0]).trim() : undefined, 'Usage: s2s backup [project]\nHelp: s2s help backup');
  const context = await ensureProjectContextWithAutomaticOnboarding(projectArg, {
    commandName: 'backup',
  });
  if (getActiveCLIFlags().dryRun) {
    const backupId = new Date().toISOString().replace(/[:.]/g, '-');
    const projectBackupsDir = globalProjectBackupsDir(context.appRoot);
    const snapshotDir = path.join(projectBackupsDir, backupId);
    const result = {
      ok: true,
      ...commandMeta('backup', { appRoot: context.appRoot }),
      dryRun: true,
      project: context.projectMeta.alias,
      projectBackupsDir,
      snapshotId: backupId,
      snapshotDir,
    };
    if (getActiveCLIFlags().json) {
      printJson(result);
      return;
    }
    const lines = [
      `s2s backup dry-run for project: ${context.projectMeta.alias}`,
      `- Project backup dir: ${projectBackupsDir}`,
      `- Next snapshot id: ${backupId}`,
      `- Next snapshot dir: ${snapshotDir}`,
    ];
    printVerboseContext(lines, { appRoot: context.appRoot, snapshotId: backupId });
    console.log(lines.join('\n'));
    return;
  }
  const snapshot = createGlobalProjectBackup(context, 'manual');

  if (getActiveCLIFlags().json) {
    printJson({
      ok: true,
      ...commandMeta('backup', { appRoot: context.appRoot }),
      project: context.projectMeta.alias,
      snapshotId: snapshot.backupId,
      projectBackupsDir: snapshot.projectBackupsDir,
      snapshotDir: snapshot.snapshotDir,
    });
    return;
  }
  console.log(`Backup created for project: ${context.projectMeta.alias}`);
  console.log(`- Snapshot id: ${snapshot.backupId}`);
  console.log(`- Project backup dir: ${snapshot.projectBackupsDir}`);
  console.log(`- Snapshot dir: ${snapshot.snapshotDir}`);
}

async function handleRestoreCommand(args: string[]): Promise<void> {
  if (args.length > 2) {
    failCLI('Usage: s2s restore [project] [--snapshot=<id>]\nHelp: s2s help restore', { usage: 's2s restore [project] [--snapshot=<id>]' });
  }

  let projectArg: string | undefined;
  let snapshotId: string | undefined;
  for (const arg of args) {
    const value = String(arg || '').trim();
    if (!value) continue;
    if (value === '--latest') {
      continue;
    }
    if (value.startsWith('--snapshot=')) {
      snapshotId = value.slice('--snapshot='.length).trim();
      continue;
    }
    if (!projectArg) {
      projectArg = value;
      continue;
    }
    failCLI('Usage: s2s restore [project] [--snapshot=<id>]\nHelp: s2s help restore', { usage: 's2s restore [project] [--snapshot=<id>]' });
  }

  projectArg = resolveRepoScopedArgument(projectArg, 'Usage: s2s restore [project] [--snapshot=<id>]\nHelp: s2s help restore');
  const context = resolveProjectContext(projectArg);
  const resolvedSnapshotId = resolveProjectSnapshotId(context.appRoot, snapshotId);
  if (!resolvedSnapshotId) {
    failCLI(`No backups found for project at ${context.appRoot}.\nCreate one with: s2s backup`);
  }
  const restoredSnapshotDir = path.join(globalProjectBackupsDir(context.appRoot), resolvedSnapshotId);
  if (getActiveCLIFlags().dryRun) {
    const result = {
      ok: true,
      ...commandMeta('restore', { appRoot: context.appRoot }),
      dryRun: true,
      project: context.projectMeta.alias,
      restoredSnapshotId: resolvedSnapshotId,
      restoredSnapshotDir,
      wouldCreatePreRestoreBackup: true,
    };
    if (getActiveCLIFlags().json) {
      printJson(result);
      return;
    }
    const lines = [
      `s2s restore dry-run for project: ${context.projectMeta.alias}`,
      `- Snapshot id: ${resolvedSnapshotId}`,
      `- Snapshot dir: ${restoredSnapshotDir}`,
      '- Pre-restore safety backup: would be created automatically',
    ];
    printVerboseContext(lines, { appRoot: context.appRoot, snapshotId: resolvedSnapshotId });
    console.log(lines.join('\n'));
    return;
  }
  await confirmStateChangingCommand({
    action: `Restore snapshot '${resolvedSnapshotId}' for project '${context.projectMeta.alias}'?`,
    noInputMessage: 's2s restore requires confirmation in non-interactive mode.\nRe-run with --yes to confirm the restore.',
    canceledMessage: 'Restore canceled.',
  });
  const result = restoreGlobalProjectBackup(context, snapshotId);

  if (getActiveCLIFlags().json) {
    printJson({
      ok: true,
      ...commandMeta('restore', { appRoot: context.appRoot }),
      ...result,
    });
    return;
  }
  console.log(`Restore completed for project: ${result.projectAlias}`);
  console.log(`- Restored snapshot: ${result.restoredSnapshotId}`);
  console.log(`- Restored from: ${result.restoredSnapshotDir}`);
  console.log(`- Pre-restore safety backup: ${result.preRestoreSnapshotId}`);
  console.log(`- Pre-restore backup path: ${result.preRestoreSnapshotDir}`);
}

async function handleRemoveCommand(args: string[]): Promise<void> {
  if (args.length > 3) {
    failCLI('Usage: s2s remove [project] [--yes] [--keep-backups]\nHelp: s2s help remove', { usage: 's2s remove [project] [--yes] [--keep-backups]' });
  }

  let projectArg: string | undefined;
  let keepBackups = false;
  for (const rawArg of args) {
    const arg = String(rawArg || '').trim();
    if (!arg) continue;
    if (arg === '--keep-backups') {
      keepBackups = true;
      continue;
    }
    if (arg.startsWith('--')) {
      failCLI(`Unknown flag: ${arg}\nUsage: s2s remove [project] [--yes] [--keep-backups]\nHelp: s2s help remove`);
    }
    if (!projectArg) {
      projectArg = arg;
      continue;
    }
    failCLI('Usage: s2s remove [project] [--yes] [--keep-backups]\nHelp: s2s help remove', { usage: 's2s remove [project] [--yes] [--keep-backups]' });
  }

  projectArg = resolveRepoScopedArgument(projectArg, 'Usage: s2s remove [project] [--yes] [--keep-backups]\nHelp: s2s help remove');
  const appRoot = resolveProjectRootForRemoval(projectArg);
  const s2sDir = path.join(appRoot, '.s2s');
  const projectMetaPath = path.join(s2sDir, 'project.json');
  const backupDir = globalProjectBackupsDir(appRoot);
  const registry = loadRegistry();
  const registryMatch = registry.projects.find((entry) => path.resolve(entry.appPath) === path.resolve(appRoot));
  const projectMeta = readJsonFile<Partial<ProjectMeta>>(projectMetaPath);
  const alias = normalizeAlias(String(projectMeta?.alias || registryMatch?.alias || path.basename(appRoot)));
  const hasS2S = existsSync(s2sDir);
  const hasBackups = existsSync(backupDir);
  const previewRootFiles = ROOT_ADAPTER_FILES.filter((fileName) => {
    const filePath = path.join(appRoot, fileName);
    if (!existsSync(filePath)) return false;
    const content = readFileSync(filePath, 'utf8');
    return content.includes('S2S_');
  });

  if (getActiveCLIFlags().dryRun) {
    const result = {
      ok: true,
      ...commandMeta('remove', { appRoot }),
      dryRun: true,
      project: alias,
      projectRoot: appRoot,
      hasS2S,
      keepBackups,
      hasBackups,
      wouldCleanRootFiles: previewRootFiles,
      wouldRemoveRegistryEntries: registry.projects.filter((entry) => path.resolve(entry.appPath) === path.resolve(appRoot)).length,
    };
    if (getActiveCLIFlags().json) {
      printJson(result);
      return;
    }
    const lines = [
      `s2s remove dry-run for project: ${alias}`,
      `- Project root: ${appRoot}`,
      `- Would remove .s2s directory: ${hasS2S ? 'yes' : 'no (not found)'}`,
      `- Would remove registry entries: ${result.wouldRemoveRegistryEntries}`,
      `- Would clean managed root blocks: ${previewRootFiles.length > 0 ? previewRootFiles.join(', ') : 'none found'}`,
      keepBackups
        ? `- Global backups: preserved (${backupDir})`
        : `- Would remove global backups: ${hasBackups ? 'yes' : 'no (not found)'}`,
    ];
    printVerboseContext(lines, { appRoot, previewRootFiles });
    console.log(lines.join('\n'));
    return;
  }
  await confirmStateChangingCommand({
    action: `Remove s2s artifacts for project '${alias}' at ${appRoot}?`,
    noInputMessage: 's2s remove requires confirmation in non-interactive mode.\nRe-run with --yes to confirm removal.',
    canceledMessage: 'Remove canceled.',
  });

  const cleanedRootFiles = removeManagedRootBlocks(appRoot);
  let removedS2SDir = false;
  if (hasS2S) {
    rmSync(s2sDir, { recursive: true, force: true });
    removedS2SDir = true;
  }
  const removedRegistryEntries = removeProjectFromRegistryByPath(appRoot);

  let removedBackups = false;
  if (hasBackups && !keepBackups) {
    rmSync(backupDir, { recursive: true, force: true });
    removedBackups = true;
  }

  if (getActiveCLIFlags().json) {
    printJson({
      ok: true,
      ...commandMeta('remove', { appRoot }),
      project: alias,
      projectRoot: appRoot,
      removedS2SDir,
      removedRegistryEntries,
      cleanedRootFiles,
      keepBackups,
      removedBackups,
      backupDir,
    });
    return;
  }
  console.log(`s2s removal completed for project: ${alias}`);
  console.log(`- Project root: ${appRoot}`);
  console.log(`- Removed .s2s directory: ${removedS2SDir ? 'yes' : 'no (not found)'}`);
  console.log(`- Removed registry entries: ${removedRegistryEntries}`);
  if (cleanedRootFiles.length > 0) {
    console.log(`- Cleaned managed root blocks: ${cleanedRootFiles.join(', ')}`);
  } else {
    console.log('- Cleaned managed root blocks: none found');
  }
  if (keepBackups) {
    console.log(`- Global backups: preserved (${backupDir})`);
  } else {
    console.log(`- Global backups removed: ${removedBackups ? 'yes' : 'no (not found)'}`);
  }
}

async function ensureProjectContextWithAutomaticOnboarding(
  projectArg: string | undefined,
  options: {
    commandName: string;
  },
): Promise<ResolvedProjectContext> {
  if (projectArg) {
    const maybePath = resolvePotentialPath(projectArg);
    if (maybePath && existsSync(maybePath)) {
      const nearestFromPath = findNearestProjectRoot(maybePath);
      if (nearestFromPath) {
        const context = ensureProjectSetup(nearestFromPath);
        maybeWarnAutomaticOnboardingState(context, options.commandName);
        maybeCreateStartupBackup(context, options.commandName);
        return context;
      }
      const initialized = await initializeProjectAtPath(maybePath, options.commandName);
      maybeWarnAutomaticOnboardingState(initialized, options.commandName);
      maybeCreateStartupBackup(initialized, options.commandName);
      return initialized;
    }
    const context = resolveProjectContext(projectArg);
    maybeWarnAutomaticOnboardingState(context, options.commandName);
    maybeCreateStartupBackup(context, options.commandName);
    const detectedUI = detectUIHintFromEnvironment();
    if (detectedUI) {
      writeLocalState(context, { lastDetectedClient: detectedUI });
    }
    return context;
  }

  const nearest = findNearestProjectRoot(process.cwd());
  if (nearest) {
    const context = ensureProjectSetup(nearest);
    maybeWarnAutomaticOnboardingState(context, options.commandName);
    maybeCreateStartupBackup(context, options.commandName);
    const detectedUI = detectUIHintFromEnvironment();
    if (detectedUI) {
      writeLocalState(context, { lastDetectedClient: detectedUI });
    }
    return context;
  }

  const initialized = await initializeProjectAtPath(process.cwd(), options.commandName);
  maybeWarnAutomaticOnboardingState(initialized, options.commandName);
  maybeCreateStartupBackup(initialized, options.commandName);
  const detectedUI = detectUIHintFromEnvironment();
  if (detectedUI) {
    writeLocalState(initialized, { lastDetectedClient: detectedUI });
  }
  return initialized;
}

function exitIfManagedProjectActionTargetsSourceRepo(appRoot: string, action: string): void {
  try {
    assertUserProjectTarget(appRoot, action);
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
    process.exit(1);
  }
}

function maybeWarnAutomaticOnboardingState(context: ResolvedProjectContext, commandName: string): void {
  const gitRoot = findGitTopLevel(context.appRoot);
  const hasGitRepository = Boolean(gitRoot);
  const isGitSubdirectory = Boolean(gitRoot && path.resolve(gitRoot) !== path.resolve(context.appRoot));
  const conflictView = getGovernanceConflictView(context);
  const hasConflicts = conflictView.active.length > 0;
  const updateMode = detectProjectUpdateRequirement(context.projectMeta).mode;
  const state = classifyOnboardingState({
    initialized: true,
    hasGitRepository,
    isGitSubdirectory,
    hasConflicts,
    updateMode,
  });

  if (state === 'INITIALIZED_HEALTHY') return;
  if (state === 'INITIALIZED_WITH_CONFLICTS') {
    if (!getActiveCLIFlags().json) {
      console.warn(renderOnboardingStateNotice(commandName, state));
    }
    return;
  }
  if (state === 'INITIALIZED_UPDATE_PENDING_SOFT' || state === 'INITIALIZED_UPDATE_PENDING_HARD') {
    if (!getActiveCLIFlags().json) {
      console.warn(renderOnboardingStateNotice(commandName, state));
    }
  }
}

function renderOnboardingStateNotice(commandName: string, state: string): string {
  const isInit = commandName === 'init';
  switch (state) {
    case 'UNINITIALIZED_NO_GIT':
      return isInit
        ? `[onboarding] This folder isn't set up with Spec-to-Ship yet. Confirm the project root to begin.`
        : `[onboarding] ${commandName}: this folder isn't set up with Spec-to-Ship yet. Run \`s2s init\` to get started.`;
    case 'UNINITIALIZED_GIT_ROOT':
      return isInit
        ? `[onboarding] This repository isn't set up with Spec-to-Ship yet. Starting guided initialization.`
        : `[onboarding] ${commandName}: this repository isn't set up with Spec-to-Ship yet. Run \`s2s init\` to get started.`;
    case 'UNINITIALIZED_GIT_SUBDIR':
      return isInit
        ? `[onboarding] This repository isn't set up with Spec-to-Ship yet. We recommend using the repository root for setup.`
        : `[onboarding] ${commandName}: this repository isn't set up with Spec-to-Ship yet. Run \`s2s init\` from the repository root.`;
    case 'INITIALIZED_WITH_CONFLICTS':
      return `[onboarding] ${commandName}: governance discrepancies need review. Review with \`s2s doctor\` and reconcile via \`s2s config edit\`.`;
    case 'INITIALIZED_UPDATE_PENDING_SOFT':
      return `[onboarding] ${commandName}: a project update is pending but can be deferred. Apply it in interactive mode before normal execution when possible.`;
    case 'INITIALIZED_UPDATE_PENDING_HARD':
      return `[onboarding] ${commandName}: a mandatory project update is pending. Apply it before normal execution.`;
    default:
      return `[onboarding] ${commandName}: state=${state}.`;
  }
}

function resolveProjectContext(projectArg?: string): ResolvedProjectContext {
  if (projectArg) {
    const fromExplicit = resolveProjectByExplicitArg(projectArg);
    return ensureProjectSetup(fromExplicit);
  }

  const nearest = findNearestProjectRoot(process.cwd());
  if (!nearest) {
    throwWithUsageContext();
  }
  return ensureProjectSetup(nearest);
}

function resolveProjectRootForUpdate(projectArg?: string): string {
  if (projectArg) {
    return resolveProjectByExplicitArg(projectArg);
  }

  const nearest = findNearestProjectRoot(process.cwd());
  if (nearest) return nearest;

  throwWithUsageContext();
}

function resolveProjectRootForRemoval(projectArg?: string): string {
  if (projectArg) {
    const maybePath = resolvePotentialPath(projectArg);
    if (maybePath) {
      const nearest = findNearestProjectRoot(maybePath);
      if (nearest) return nearest;
      if (existsSync(maybePath)) {
        return path.resolve(maybePath);
      }
      console.error(`Path not found: ${projectArg}`);
      process.exit(1);
    }
    const registry = loadRegistry();
    const match = registry.projects.find((project) => project.alias === normalizeAlias(projectArg));
    if (match) return path.resolve(match.appPath);
    console.error(`Project not found: ${projectArg}\nTip: s2s list`);
    process.exit(1);
  }

  const nearest = findNearestProjectRoot(process.cwd());
  if (nearest) return nearest;
  throwWithUsageContext();
}

function throwWithUsageContext(): never {
  console.error('No local .s2s context found.\nPass a project alias/path or run command inside a configured project.\nTip: s2s list');
  process.exit(1);
}

function resolveProjectByExplicitArg(projectArg: string): string {
  const maybePath = resolvePotentialPath(projectArg);
  if (maybePath) {
    const fromPath = findNearestProjectRoot(maybePath);
    if (fromPath) {
      return fromPath;
    }
  }

  const registry = loadRegistry();
  const match = registry.projects.find((project) => project.alias === projectArg);
  if (match && existsSync(path.join(match.appPath, '.s2s'))) {
    return match.appPath;
  }

  console.error(`Project not found: ${projectArg}\nTip: s2s list`);
  process.exit(1);
}

function resolveDisplayedProjectVersion(meta?: Partial<ProjectMeta> | null): string {
  const templateVersion = meta?.templateVersion ? String(meta.templateVersion).trim() : '';
  if (templateVersion) return templateVersion;
  const migratedVersion = meta?.lastMigratedByCliVersion ? String(meta.lastMigratedByCliVersion).trim() : '';
  if (migratedVersion) return migratedVersion;
  return TEMPLATE_VERSION;
}

// Path utilities extracted to ./cli/utils/paths.ts

function ensureProjectSetup(
  appRoot: string,
  options: EnsureProjectSetupOptions = {},
): ResolvedProjectContext {
  const normalizedAppRoot = path.resolve(appRoot);
  exitIfManagedProjectActionTargetsSourceRepo(normalizedAppRoot, 'initialize or refresh managed project governance');
  const s2sDir = path.join(normalizedAppRoot, '.s2s');
  const configDir = path.join(s2sDir, 'config');
  const projectMetaPath = path.join(s2sDir, 'project.json');
  const projectLocalPath = path.join(s2sDir, 'project.local.json');

  const existed = existsSync(s2sDir);
  mkdirSync(s2sDir, { recursive: true });
  for (const sub of ['config', 'guardrails', 'scripts', 'usage', 'logs', 'backups']) {
    mkdirSync(path.join(s2sDir, sub), { recursive: true });
  }

  const nowIso = new Date().toISOString();
  const defaultAlias = normalizeAlias(path.basename(normalizedAppRoot));
  const current = readJsonFile<Partial<ProjectMeta>>(projectMetaPath) || {};
  const currentSchemaVersion = Number(current.schemaVersion || PROJECT_SCHEMA_VERSION);
  const currentTemplateVersion = String(current.templateVersion || TEMPLATE_VERSION);
  const currentMinCliVersion = normalizeProjectMinCliVersion(current.minCliVersion);
  const targetSchemaVersion = Math.max(currentSchemaVersion, PROJECT_SCHEMA_VERSION);
  const targetTemplateVersion = compareSemver(currentTemplateVersion, TEMPLATE_VERSION) > 0
    ? currentTemplateVersion
    : TEMPLATE_VERSION;
  const targetMinCliVersion = compareSemver(currentMinCliVersion, DEFAULT_MIN_CLI_VERSION) > 0
    ? currentMinCliVersion
    : DEFAULT_MIN_CLI_VERSION;
  const merged: ProjectMeta = {
    schemaVersion: targetSchemaVersion,
    templateVersion: targetTemplateVersion,
    minCliVersion: targetMinCliVersion,
    lastMigratedByCliVersion: CLI_VERSION,
    alias: normalizeAlias(current.alias || defaultAlias),
    projectId: normalizeAlias(current.projectId || defaultAlias),
    appPath: path.resolve(current.appPath || normalizedAppRoot),
    createdAt: String(current.createdAt || nowIso),
    updatedAt: nowIso,
  };
  const changed = !current.appPath
    || JSON.stringify(normalizeProjectMetaForComparison(current)) !== JSON.stringify(normalizeProjectMetaForComparison(merged));
  if (!changed) {
    merged.updatedAt = String(current.updatedAt || nowIso);
    merged.lastMigratedByCliVersion = String(current.lastMigratedByCliVersion || CLI_VERSION);
  }

  if (compareSemver(CLI_VERSION, merged.minCliVersion) < 0) {
    console.error(
      `This project requires s2s >= ${merged.minCliVersion}. Current: ${CLI_VERSION}. Upgrade via Homebrew.`,
    );
    process.exit(1);
  }

  const updateRequirement = detectProjectUpdateRequirement(current);
  const pending = normalizePendingProjectUpdate(
    (readJsonFile<Partial<ProjectLocalState>>(projectLocalPath) || {}).pendingProjectUpdate,
  );
  if (existed && updateRequirement.mode !== 'none') {
    const shouldApply = options.forceProjectUpdate
      ? true
      : resolveProjectUpdateAction(updateRequirement, pending, normalizedAppRoot);
    if (!shouldApply) {
      if (updateRequirement.mode === 'hard') {
        console.error(`Project update canceled.\nReason: ${updateRequirement.reason}`);
        process.exit(1);
      }
      persistPendingProjectUpdate(projectLocalPath, merged, updateRequirement);
      if (!getActiveCLIFlags().json) {
        console.warn(
          `Project update deferred (${updateRequirement.reason}). ` +
          'Run s2s in interactive mode and accept update when ready.',
        );
      }
      const fallbackMeta = normalizeProjectMetaFromCurrent(current, normalizedAppRoot);
      return {
        appRoot: normalizedAppRoot,
        s2sDir,
        configDir,
        projectMetaPath,
        projectLocalPath,
        projectMeta: fallbackMeta,
      };
    }
  }

  if (existed && changed) {
    createProjectBackup(s2sDir);
  }

  writeJsonFile(projectMetaPath, merged);
  ensureProjectLocal(projectLocalPath, merged, { clearPendingUpdate: true });
  ensureConfigFiles(configDir, merged);
  ensureGuardrails(normalizedAppRoot, s2sDir);
  ensureScripts(s2sDir);
  ensureProjectGitIgnore(s2sDir);
  ensureLiveState(s2sDir, merged.projectId, nowIso);

  if (changed) {
    appendFileSync(
      path.join(s2sDir, 'logs', 'migrations.log'),
      `[${nowIso}] migrated by cli ${CLI_VERSION}\n`,
      'utf8',
    );
  }

  return {
    appRoot: normalizedAppRoot,
    s2sDir,
    configDir,
    projectMetaPath,
    projectLocalPath,
    projectMeta: merged,
  };
}

function normalizeProjectMetaFromCurrent(
  current: Partial<ProjectMeta>,
  appRoot: string,
): ProjectMeta {
  const nowIso = new Date().toISOString();
  const defaultAlias = normalizeAlias(path.basename(appRoot));
  return {
    schemaVersion: Number(current.schemaVersion || PROJECT_SCHEMA_VERSION),
    templateVersion: String(current.templateVersion || TEMPLATE_VERSION),
    minCliVersion: normalizeProjectMinCliVersion(current.minCliVersion),
    lastMigratedByCliVersion: String(current.lastMigratedByCliVersion || CLI_VERSION),
    alias: normalizeAlias(current.alias || defaultAlias),
    projectId: normalizeAlias(current.projectId || defaultAlias),
    appPath: path.resolve(current.appPath || appRoot),
    createdAt: String(current.createdAt || nowIso),
    updatedAt: String(current.updatedAt || nowIso),
  };
}

function normalizeProjectMetaForComparison(value: Partial<ProjectMeta>): Partial<ProjectMeta> {
  return {
    schemaVersion: Number(value.schemaVersion || PROJECT_SCHEMA_VERSION),
    templateVersion: String(value.templateVersion || TEMPLATE_VERSION),
    minCliVersion: normalizeProjectMinCliVersion(value.minCliVersion),
    alias: normalizeAlias(String(value.alias || '')),
    projectId: normalizeAlias(String(value.projectId || '')),
    appPath: value.appPath ? path.resolve(value.appPath) : '',
    createdAt: String(value.createdAt || ''),
  };
}

function detectProjectUpdateRequirement(current: Partial<ProjectMeta>): ProjectUpdateRequirement {
  const fromSchema = Number(current.schemaVersion || PROJECT_SCHEMA_VERSION);
  const fromTemplate = String(current.templateVersion || TEMPLATE_VERSION);
  const fromMinCli = normalizeProjectMinCliVersion(current.minCliVersion);

  const schemaBehind = fromSchema < PROJECT_SCHEMA_VERSION;
  const templateBehind = compareSemver(fromTemplate, TEMPLATE_VERSION) < 0;
  const minCliBehind = compareSemver(fromMinCli, DEFAULT_MIN_CLI_VERSION) < 0;
  if (!schemaBehind && !templateBehind && !minCliBehind) {
    return {
      mode: 'none',
      reason: '',
      fromTemplateVersion: fromTemplate,
      toTemplateVersion: TEMPLATE_VERSION,
      fromSchemaVersion: fromSchema,
      toSchemaVersion: PROJECT_SCHEMA_VERSION,
    };
  }

  const reasons: string[] = [];
  if (schemaBehind) reasons.push(`schema ${fromSchema} -> ${PROJECT_SCHEMA_VERSION}`);
  if (templateBehind) reasons.push(`template ${fromTemplate} -> ${TEMPLATE_VERSION}`);
  if (minCliBehind) reasons.push(`minCli ${fromMinCli} -> ${DEFAULT_MIN_CLI_VERSION}`);
  const mode: 'soft' | 'hard' = schemaBehind ? 'hard' : RELEASE_UPDATE_CLASS;
  return {
    mode,
    reason: reasons.join(', '),
    fromTemplateVersion: fromTemplate,
    toTemplateVersion: TEMPLATE_VERSION,
    fromSchemaVersion: fromSchema,
    toSchemaVersion: PROJECT_SCHEMA_VERSION,
  };
}

function resolveProjectUpdateAction(
  requirement: ProjectUpdateRequirement,
  pending: PendingProjectUpdateState | undefined,
  appRoot: string,
): boolean {
  if (requirement.mode === 'none') return true;
  const flags = getActiveCLIFlags();
  if (flags.yes) return true;

  const alreadyPending = Boolean(
    pending
      && pending.mode === 'soft'
      && pending.toTemplateVersion === requirement.toTemplateVersion
      && pending.toSchemaVersion === requirement.toSchemaVersion,
  );

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    if (requirement.mode === 'hard') {
      failCLI(
        `Mandatory project update required (${requirement.reason}). ` +
        'Run s2s in interactive mode and confirm update before continuing.',
      );
    }
    if (!alreadyPending) {
      if (!getActiveCLIFlags().json) {
        console.warn(
          `Soft project update available (${requirement.reason}). ` +
          'Continuing in non-interactive mode with update pending.',
        );
      }
    }
    return false;
  }

  if (alreadyPending && requirement.mode === 'soft') {
    if (!getActiveCLIFlags().json) {
      console.warn(
        `Soft project update still pending (${requirement.reason}) for ${appRoot}. ` +
        'Apply now to refresh project-managed files.',
      );
    }
  }

  const defaultYes = requirement.mode === 'hard';
  const question = requirement.mode === 'hard'
    ? `Mandatory project update required (${requirement.reason}). Apply now?`
    : `Project update available (${requirement.reason}). Apply now?`;
  const accepted = promptYesNoSync(question, defaultYes);
  return accepted;
}

function persistPendingProjectUpdate(
  projectLocalPath: string,
  mergedMeta: ProjectMeta,
  requirement: ProjectUpdateRequirement,
): void {
  const current = readJsonFile<Partial<ProjectLocalState>>(projectLocalPath) || {};
  const nowIso = new Date().toISOString();
  const next: ProjectLocalState = {
    lastUsedAt: String(current.lastUsedAt || nowIso),
    lastStage: current.lastStage ? String(current.lastStage) : undefined,
    lastDetectedClient: current.lastDetectedClient ? String(current.lastDetectedClient) : undefined,
    pendingProjectUpdate: {
      mode: requirement.mode === 'hard' ? 'hard' : 'soft',
      fromTemplateVersion: requirement.fromTemplateVersion,
      toTemplateVersion: requirement.toTemplateVersion,
      fromSchemaVersion: requirement.fromSchemaVersion,
      toSchemaVersion: requirement.toSchemaVersion,
      detectedAt: nowIso,
      deferredAt: nowIso,
      sourceCliVersion: CLI_VERSION,
      reason: requirement.reason,
    },
  };
  writeJsonFile(projectLocalPath, next);
}

function ensureProjectLocal(
  projectLocalPath: string,
  meta: ProjectMeta,
  options: { clearPendingUpdate?: boolean } = {},
): void {
  const nowIso = new Date().toISOString();
  const current = readJsonFile<Partial<ProjectLocalState>>(projectLocalPath) || {};
  const pending = options.clearPendingUpdate
    ? undefined
    : normalizePendingProjectUpdate(current.pendingProjectUpdate);
  const next: ProjectLocalState = {
    lastUsedAt: String(current.lastUsedAt || nowIso),
    lastStage: current.lastStage ? String(current.lastStage) : undefined,
    lastDetectedClient: current.lastDetectedClient ? String(current.lastDetectedClient) : undefined,
    pendingProjectUpdate: pending,
  };
  writeJsonFile(projectLocalPath, next);
}

function ensureConfigFiles(
  configDir: string,
  meta: ProjectMeta,
): void {
  const runtimePath = path.join(configDir, 'runtime.json');
  const llmPath = path.join(configDir, 'llm.json');
  const templatesPath = path.join(configDir, 'execution.templates.json');
  const detectedUI = detectUIHintFromEnvironment();

  const runtime = readJsonFile<RuntimeConfig>(runtimePath) || defaultRuntimeConfig(meta);
  runtime.workspace.basePath = meta.appPath;
  runtime.workspace.orchestratorDirName = '.s2s';
  runtime.workspace.projectDirName = path.basename(meta.appPath);
  runtime.workspace.projectRepoPath = meta.appPath;
  runtime.workspace.worktreesRootPath = defaultManagedWorktreesRootPath(meta.appPath);
  runtime.workspace.worktreesDirName = path.basename(runtime.workspace.worktreesRootPath);
  runtime.execution.allowedCommands = defaultAllowedExecutionCommands('codex-cli');
  runtime.execution.allowUnsafeRawCommand = false;
  if (!['codex_strict', 'codex_fast', 'claude_strict', 'claude_fast', 'opencode_strict', 'opencode_fast'].includes(runtime.execution.templateId)) {
    runtime.execution.templateId = templateFromUI(detectedUI ?? 'codex');
  }
  runtime.guardrailPolicy = normalizeGuardrailPolicy(runtime.guardrailPolicy);
  runtime.costControl = {
    enabled: false,
    budgetUsd: 0,
    warnThresholdPct: 80,
    hardStopThresholdPct: 100,
  };
  runtime.chatObservability = normalizeChatObservability(runtime.chatObservability);
  runtime.versioning = normalizeRuntimeVersioning(runtime.versioning);
  // Default to chat-native mode; standalone mode must be explicitly opted into via `s2s config edit`
  if (!runtime.pipelineMode) {
    runtime.pipelineMode = 'chat-native';
  }
  writeJsonFile(runtimePath, runtime);

  // llm.json is only written in standalone mode (explicit opt-in via `s2s config edit`).
  // In chat-native mode (default), the chat AI handles all LLM calls — s2s never calls one.
  const existingLlm = readJsonFile<LLMProviderConfig>(llmPath);
  if (existingLlm) {
    // Preserve an existing llm.json for standalone mode users
    writeJsonFile(llmPath, existingLlm);
  }

  // Merge execution templates: add any new default templates missing by ID,
  // leave existing entries untouched so user customizations are preserved.
  const existingTemplates: Array<{ id: string }> = readJsonFile(templatesPath) ?? [];
  const existingIds = new Set(existingTemplates.map((t) => t.id));
  const newDefaults = defaultExecutionTemplates().filter((t) => !existingIds.has(t.id));
  if (newDefaults.length > 0 || existingTemplates.length === 0) {
    writeJsonFile(templatesPath, [...existingTemplates, ...newDefaults]);
  }
  ensureBackupPolicyFile(configDir);
  ensureGovernanceExceptionsFile(configDir);
}

function ensureGuardrails(appRoot: string, s2sDir: string): void {
  const guardrailsDir = path.join(s2sDir, 'guardrails');
  mkdirSync(guardrailsDir, { recursive: true });
  const governance = renderUserProjectGovernance({ appRoot });
  const rootGuardrailBlock = governance.rootBlocks.agents;
  const rootCodexAdapterBlock = governance.rootBlocks.codex;
  const rootClaudeAdapterBlock = governance.rootBlocks.claude;
  const rootMutations = [
    {
      fileName: 'AGENTS.md',
      startMarker: ROOT_GUARDRAIL_START,
      endMarker: ROOT_GUARDRAIL_END,
      blockContent: rootGuardrailBlock,
    },
    {
      fileName: 'CODEX.md',
      startMarker: ROOT_CODEX_ADAPTER_START,
      endMarker: ROOT_CODEX_ADAPTER_END,
      blockContent: rootCodexAdapterBlock,
    },
    {
      fileName: 'CLAUDE.md',
      startMarker: ROOT_CLAUDE_ADAPTER_START,
      endMarker: ROOT_CLAUDE_ADAPTER_END,
      blockContent: rootClaudeAdapterBlock,
    },
  ].filter((target) =>
    wouldManagedRootBlockChange(
      path.join(appRoot, target.fileName),
      target.startMarker,
      target.endMarker,
      target.blockContent,
    ),
  );
  backupRootAdaptersBeforeMutation(appRoot, s2sDir, rootMutations.map((item) => item.fileName));
  writeFileIfChanged(
    path.join(guardrailsDir, 'AGENTS.md'),
    governance.guardrails.agents,
  );
  writeFileIfChanged(
    path.join(guardrailsDir, 'CODEX.md'),
    governance.guardrails.codex,
  );
  writeFileIfChanged(
    path.join(guardrailsDir, 'CLAUDE.md'),
    governance.guardrails.claude,
  );

  upsertManagedRootBlock(
    path.join(appRoot, 'AGENTS.md'),
    ROOT_GUARDRAIL_START,
    ROOT_GUARDRAIL_END,
    rootGuardrailBlock,
  );
  upsertManagedRootBlock(
    path.join(appRoot, 'CODEX.md'),
    ROOT_CODEX_ADAPTER_START,
    ROOT_CODEX_ADAPTER_END,
    rootCodexAdapterBlock,
  );
  upsertManagedRootBlock(
    path.join(appRoot, 'CLAUDE.md'),
    ROOT_CLAUDE_ADAPTER_START,
    ROOT_CLAUDE_ADAPTER_END,
    rootClaudeAdapterBlock,
  );

  writeFileIfChanged(
    path.join(s2sDir, 'protocol.md'),
    generateProtocolContent(TEMPLATE_VERSION),
  );
}

function ensureScripts(s2sDir: string): void {
  const scriptsDir = path.join(s2sDir, 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  writeFileIfChanged(
    path.join(scriptsDir, 'README.md'),
    [
      '# .s2s Scripts',
      '',
      'This directory is managed by s2s CLI.',
      'Project-specific helper scripts can be added here.',
      '',
    ].join('\n'),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat tool permission configuration
// ─────────────────────────────────────────────────────────────────────────────

interface ChatToolEntry {
  id: string;
  displayName: string;
  isPresent: (appRoot: string) => boolean;
  isAlreadyConfigured: (appRoot: string) => boolean;
  writePermission: (appRoot: string) => void;
}

const CHAT_TOOLS: ChatToolEntry[] = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    isPresent: (appRoot) => existsSync(path.join(appRoot, '.claude')),
    isAlreadyConfigured: (appRoot) => {
      const p = path.join(appRoot, '.claude', 'settings.json');
      if (!existsSync(p)) return false;
      try {
        const s = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
        const allow = ((s.permissions as Record<string, unknown>)?.allow ?? []) as unknown[];
        return Array.isArray(allow) && allow.includes('Bash(s2s*)');
      } catch { return false; }
    },
    writePermission: (appRoot) => {
      const dir = path.join(appRoot, '.claude');
      const p = path.join(dir, 'settings.json');
      let s: Record<string, unknown> = {};
      if (existsSync(p)) {
        try { s = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { /* start fresh */ }
      }
      const perms = (s.permissions ?? {}) as Record<string, unknown>;
      const allow = Array.isArray(perms.allow) ? (perms.allow as string[]) : [];
      mkdirSync(dir, { recursive: true });
      writeJsonFile(p, { ...s, permissions: { ...perms, allow: [...allow, 'Bash(s2s*)'] } });
    },
  },
  {
    id: 'codex',
    displayName: 'Codex',
    isPresent: (appRoot) => existsSync(path.join(appRoot, '.codex')),
    isAlreadyConfigured: (appRoot) => existsSync(path.join(appRoot, '.codex', 'rules', 's2s.rules')),
    writePermission: (appRoot) => {
      const dir = path.join(appRoot, '.codex', 'rules');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, 's2s.rules'),
        [
          '# Auto-approved s2s commands (written by s2s init)',
          'prefix_rule(',
          '    pattern = ["s2s", "*"],',
          '    decision = "allow",',
          '    justification = "Pre-approved by s2s init"',
          ')',
          '',
        ].join('\n'),
        'utf8',
      );
    },
  },
  {
    id: 'opencode',
    displayName: 'OpenCode',
    isPresent: (appRoot) => existsSync(path.join(appRoot, 'opencode.json')),
    isAlreadyConfigured: (appRoot) => {
      const p = path.join(appRoot, 'opencode.json');
      if (!existsSync(p)) return false;
      try {
        const c = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
        const bash = ((c.permission as Record<string, unknown>)?.bash ?? {}) as Record<string, unknown>;
        return bash['s2s*'] === 'allow';
      } catch { return false; }
    },
    writePermission: (appRoot) => {
      const p = path.join(appRoot, 'opencode.json');
      let c: Record<string, unknown> = {};
      if (existsSync(p)) {
        try { c = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>; } catch { /* start fresh */ }
      }
      const permission = (c.permission ?? {}) as Record<string, unknown>;
      const bash = (permission.bash ?? {}) as Record<string, unknown>;
      bash['s2s*'] = 'allow';
      permission.bash = bash;
      c.permission = permission;
      writeJsonFile(p, c);
    },
  },
];

/**
 * Called during `s2s init` — detects present chat tools, prompts consent for each,
 * writes configs, and persists the result in project.json.
 */
async function configureChatPermissionsInteractively(
  projectMetaPath: string,
  appRoot: string,
): Promise<void> {
  const meta = readJsonFile<Partial<ProjectMeta>>(projectMetaPath) || {};
  const presentTools = CHAT_TOOLS.filter((t) => t.isPresent(appRoot));

  if (presentTools.length === 0) {
    writeJsonFile(projectMetaPath, {
      ...meta,
      chatPermissions: { status: 'pending' } satisfies ChatPermissionsState,
    });
    console.log('[s2s] No chat tools detected. Run `s2s config chat-permissions` anytime to configure.');
    return;
  }

  const existing = Array.isArray(meta.chatPermissions?.configuredTools)
    ? (meta.chatPermissions.configuredTools as string[])
    : [];
  const configuredTools = [...existing];

  for (const tool of presentTools) {
    if (tool.isAlreadyConfigured(appRoot)) {
      if (!configuredTools.includes(tool.id)) configuredTools.push(tool.id);
      continue;
    }
    const confirmed = await promptYesNoInteractive(
      `Configure auto-approval of s2s commands for ${tool.displayName}?`,
      true,
    );
    if (!confirmed) continue;
    tool.writePermission(appRoot);
    if (!configuredTools.includes(tool.id)) configuredTools.push(tool.id);
    console.log(`[s2s] ${tool.displayName}: s2s commands pre-approved.`);
  }

  const status: ChatPermissionsState['status'] = configuredTools.length > 0 ? 'configured' : 'skipped';
  writeJsonFile(projectMetaPath, {
    ...meta,
    chatPermissions: {
      status,
      ...(configuredTools.length > 0 ? { configuredTools } : {}),
    } satisfies ChatPermissionsState,
  });
}

/**
 * Called during `s2s update` — silently re-applies or discovers new chat tool configs.
 * Respects 'skipped' status from init; does not re-prompt.
 */
function ensureChatPermissionsOnUpdate(projectMetaPath: string, appRoot: string): void {
  const meta = readJsonFile<Partial<ProjectMeta>>(projectMetaPath) || {};
  if (meta.chatPermissions?.status === 'skipped') return;

  const existing = Array.isArray(meta.chatPermissions?.configuredTools)
    ? (meta.chatPermissions.configuredTools as string[])
    : [];
  const configuredTools = [...existing];

  for (const tool of CHAT_TOOLS.filter((t) => t.isPresent(appRoot))) {
    if (tool.isAlreadyConfigured(appRoot)) {
      if (!configuredTools.includes(tool.id)) configuredTools.push(tool.id);
      continue;
    }
    tool.writePermission(appRoot);
    if (!configuredTools.includes(tool.id)) configuredTools.push(tool.id);
  }

  if (configuredTools.length > 0) {
    writeJsonFile(projectMetaPath, {
      ...meta,
      chatPermissions: {
        status: 'configured',
        configuredTools,
        footnoteShownAt: meta.chatPermissions?.footnoteShownAt,
      } satisfies ChatPermissionsState,
    });
  }
}

/**
 * If chat permissions are `pending` and the footnote has not yet been shown,
 * marks it as shown and returns the footnote string.
 * Returns null when the footnote should not appear (already shown, or not pending).
 */
function resolveChatPermissionsFootnote(projectMetaPath: string): string | null {
  const meta = readJsonFile<Partial<ProjectMeta>>(projectMetaPath);
  if (!meta) return null;
  if (meta.chatPermissions?.status !== 'pending') return null;
  if (meta.chatPermissions.footnoteShownAt) return null;

  writeJsonFile(projectMetaPath, {
    ...meta,
    chatPermissions: {
      ...meta.chatPermissions,
      footnoteShownAt: new Date().toISOString(),
    },
  });
  return '\n---\ns2s tip: run `s2s config chat-permissions` to pre-approve s2s commands in your chat tool and skip approval prompts.';
}

// ─────────────────────────────────────────────────────────────────────────────
// Artifact review output
// ─────────────────────────────────────────────────────────────────────────────

const ARTIFACT_DISPLAY_NAMES: Record<string, string> = {
  'PRD.md': 'Product Requirements Document',
  'Research.md': 'Technical Research Brief',
  'TechSpec.md': 'Technical Specification',
  'PrototypeSpec.md': 'Prototype Specification',
  'FigmaLink.json': 'Design File Links',
  'Backlog.md': 'Engineering Backlog',
};

/**
 * Builds a "Review before approving" block showing each artifact's human-readable
 * name, its absolute path (auto-detected as clickable by Warp, VS Code, iTerm2,
 * and most modern terminals), and a bullet list of top-level sections (H2 headings)
 * for markdown files.
 * Returns an empty string when no artifacts are present on disk.
 */
function renderArtifactReviewBlock(stage: string, projectId: string, s2sDir: string): string {
  const files = getStageOutputFiles(stage as PipelineStage);
  if (files.length === 0) return '';

  const lines: string[] = ['[s2s] Review before approving:'];

  for (const file of files) {
    const fullPath = path.resolve(path.join(s2sDir, 'artifacts', projectId, file));
    if (!existsSync(fullPath)) continue;

    const displayName = ARTIFACT_DISPLAY_NAMES[file] ?? file;
    lines.push(`[s2s]   ${displayName}`);
    lines.push(`[s2s]   ${fullPath}`);

    if (file.endsWith('.md')) {
      try {
        const sections = readFileSync(fullPath, 'utf8')
          .split('\n')
          .filter((l) => l.startsWith('## '))
          .map((l) => l.replace(/^##\s+/, '').trim());
        for (const section of sections.slice(0, 7)) {
          lines.push(`[s2s]     · ${section}`);
        }
        if (sections.length > 7) {
          lines.push(`[s2s]     · … +${sections.length - 7} more sections`);
        }
      } catch { /* skip if unreadable */ }
    }
  }

  // If no artifacts were found on disk, suppress the header too
  return lines.length > 1 ? lines.join('\n') : '';
}

/**
 * Renders the human-friendly approve/reject prompt shown after a gate is created.
 * Replaces the technical "run: s2s approve ..." string with clear action guidance.
 */
function renderGateActionPrompt(gateId: string, stage: string): string {
  const nextStageHint = stage === 'pm' ? 'research'
    : stage === 'research' ? 'design'
    : stage === 'design' ? 'engineering'
    : null;
  const forwardHint = nextStageHint
    ? ` and move on to ${nextStageHint}`
    : ' and continue the pipeline';
  return [
    `[s2s] Happy with the above? Approve to accept it${forwardHint}:`,
    `[s2s]   s2s approve ${gateId}`,
    `[s2s] Need changes? Reject to send it back for revision:`,
    `[s2s]   s2s reject ${gateId}`,
  ].join('\n');
}

function migrateArtifactsDir(appRoot: string, s2sDir: string): void {
  const oldDir = path.join(appRoot, 'artifacts');
  const newDir = path.join(s2sDir, 'artifacts');
  if (!existsSync(oldDir)) return;
  if (existsSync(newDir)) return; // already migrated or independently created
  try {
    renameSync(oldDir, newDir);
    console.log(`[s2s] Migrated artifacts/ → .s2s/artifacts/`);
  } catch {
    // Non-fatal: if rename fails (e.g. cross-device), leave old location in place
    console.log(`[s2s] Could not migrate artifacts/ to .s2s/artifacts/ automatically — move it manually.`);
  }
}

function ensureProjectGitIgnore(s2sDir: string): void {
  const ignorePath = path.join(s2sDir, '.gitignore');
  const content = [
    '# Runtime-only state',
    'project.local.json',
    'artifacts/',
    'usage/',
    'logs/',
    'backups/',
    '',
  ].join('\n');
  writeFileIfChanged(ignorePath, content);
}

function resolveListedProjectVersion(
  project: GlobalRegistryProject,
  meta: Partial<ProjectMeta> | null,
): string {
  const installed = String(
    meta?.templateVersion
    || meta?.lastMigratedByCliVersion
    || project.templateVersion
    || 'unknown',
  ).trim();
  return installed || 'unknown';
}

function resolveListedProjectUpdateNotice(meta: Partial<ProjectMeta> | null): string {
  if (!meta) return ' (project metadata unavailable)';
  const requirement = detectProjectUpdateRequirement(meta);
  if (requirement.mode === 'none') return '';
  const urgency = requirement.mode === 'hard' ? 'mandatory update' : 'update available';
  return ` (${urgency}: ${TEMPLATE_VERSION})`;
}

// formatFriendlyTimestamp extracted to ./cli/utils/versioning.ts

function restoreGlobalProjectBackup(
  context: ResolvedProjectContext,
  requestedSnapshotId?: string,
): {
  projectAlias: string;
  restoredSnapshotId: string;
  restoredSnapshotDir: string;
  preRestoreSnapshotId: string;
  preRestoreSnapshotDir: string;
} {
  const snapshotId = resolveProjectSnapshotId(context.appRoot, requestedSnapshotId);
  if (!snapshotId) {
    console.error(
      `No backups found for project at ${context.appRoot}.\nCreate one with: s2s backup`,
    );
    process.exit(1);
  }

  const restoredSnapshotDir = path.join(globalProjectBackupsDir(context.appRoot), snapshotId);
  if (!existsSync(restoredSnapshotDir)) {
    console.error(`Snapshot not found: ${snapshotId}\nProject backups dir: ${globalProjectBackupsDir(context.appRoot)}`);
    process.exit(1);
  }

  const preRestore = createGlobalProjectBackup(context, 'pre-restore');

  const snapshotS2SDir = path.join(restoredSnapshotDir, 's2s');
  if (!existsSync(snapshotS2SDir)) {
    console.error(`Invalid snapshot: missing s2s directory at ${snapshotS2SDir}`);
    process.exit(1);
  }
  rmSync(context.s2sDir, { recursive: true, force: true });
  cpSync(snapshotS2SDir, context.s2sDir, { recursive: true });

  const snapshotRootDir = path.join(restoredSnapshotDir, 'root');
  for (const fileName of ROOT_ADAPTER_FILES) {
    const source = path.join(snapshotRootDir, fileName);
    if (!existsSync(source)) continue;
    cpSync(source, path.join(context.appRoot, fileName));
  }

  const refreshed = ensureProjectSetup(context.appRoot);
  updateRegistryForProject(refreshed.projectMeta.alias, refreshed.appRoot, refreshed.s2sDir);
  touchProjectLastUsed(refreshed);

  return {
    projectAlias: refreshed.projectMeta.alias,
    restoredSnapshotId: snapshotId,
    restoredSnapshotDir,
    preRestoreSnapshotId: preRestore.backupId,
    preRestoreSnapshotDir: preRestore.snapshotDir,
  };
}

async function initializeProjectInCurrentPath(): Promise<ResolvedProjectContext> {
  return initializeProjectAtPath(process.cwd());
}

async function initializeProjectAtPath(
  requestedPath: string,
  sourceLabel = 'initialization',
): Promise<ResolvedProjectContext> {
  const resolution = resolveOnboardingRoot(requestedPath);
  exitIfManagedProjectActionTargetsSourceRepo(resolution.recommendedRoot, `run ${sourceLabel}`);

  const uninitializedState = classifyOnboardingState({
    initialized: false,
    hasGitRepository: resolution.isGitRepository,
    isGitSubdirectory: resolution.isGitSubdirectory,
    hasConflicts: false,
    updateMode: 'none',
  });
  // Suppress redundant state notices for the explicit init command — the init
  // banner already showed the target path. Keep them for auto-onboarding paths.
  if (sourceLabel !== 'initialization' && !getActiveCLIFlags().json) {
    console.log(renderOnboardingStateNotice(sourceLabel, uninitializedState));
  }

  if (resolution.isGitSubdirectory) {
    console.log(
      `[onboarding] Detected Git repository root: ${resolution.recommendedRoot}`,
    );
    console.log('[onboarding] Recommendation: configure the repository root as project root.');
  } else if (!resolution.isGitRepository) {
    console.log('[onboarding] Git repository not detected. Root confirmation is required.');
  }

  const rl = createInterface({ input, output });
  try {
    if (!getActiveCLIFlags().yes) {
      const proceedRaw = await askPrompt(rl, 'Initialize Spec-To-Ship in this project now? [Y/n]: ');
      const proceed = String(proceedRaw || '').trim().toLowerCase();
      if (proceed === 'n' || proceed === 'no') {
        console.error('Initialization canceled.');
        process.exit(1);
      }
    }

    const selectedRootInput = await askWithDefault(rl, 'Project root path', resolution.recommendedRoot);
    const appRoot = path.resolve(expandHomePath(selectedRootInput || resolution.recommendedRoot));
    mkdirSync(appRoot, { recursive: true });
    if (appRoot !== resolution.recommendedRoot) {
      console.log(`[onboarding] Using user-selected project root: ${appRoot}`);
    }

    const detectedUI = detectUIHintFromEnvironment();
    const templateId = templateFromUI(detectedUI ?? 'codex');
    const aliasInput = await askWithDefault(rl, 'Project alias', normalizeAlias(path.basename(appRoot)));
    const alias = normalizeAlias(aliasInput);

    const context = ensureProjectSetup(appRoot);
    const runtimePath = path.join(context.configDir, 'runtime.json');
    const runtime = readJsonFile<RuntimeConfig>(runtimePath) || defaultRuntimeConfig(context.projectMeta);
    runtime.execution.templateId = templateId;
    const resolvedPolicy = await resolveGuardrailPolicyFromDiscrepancies(
      context,
      rl,
      normalizeGuardrailPolicy(runtime.guardrailPolicy),
      { alwaysPromptOnConflicts: true, source: 'initialization' },
    );
    if (!resolvedPolicy) {
      console.error('Initialization canceled due to unresolved guardrail discrepancies.');
      process.exit(1);
    }
    runtime.guardrailPolicy = resolvedPolicy;
    writeJsonFile(runtimePath, runtime);
    const configuredBackupPolicy = await configureBackupPolicyInteractively(
      context.configDir,
      rl,
      { source: 'initialization' },
    );
    writeJsonFile(path.join(context.configDir, 'backup.policy.json'), configuredBackupPolicy);

    context.projectMeta.alias = alias;
    context.projectMeta.projectId = alias;
    context.projectMeta.updatedAt = new Date().toISOString();
    writeJsonFile(context.projectMetaPath, context.projectMeta);
    ensureConfigFiles(context.configDir, context.projectMeta);
    updateRegistryForProject(context.projectMeta.alias, context.appRoot, context.s2sDir);
    touchProjectLastUsed(context);
    writeLocalState(context, {
      lastDetectedClient: detectedUI ?? undefined,
      lastUsedAt: new Date().toISOString(),
    });
    const postConflictView = getGovernanceConflictView(context);
    writeOnboardingArtifacts(context.s2sDir, {
      state: uninitializedState,
      requestedPath: resolution.requestedPath,
      recommendedRoot: resolution.recommendedRoot,
      selectedRoot: appRoot,
      projectAlias: context.projectMeta.alias,
      preferredClient: detectedUI ?? 'codex',
      guardrailPolicy: runtime.guardrailPolicy,
      conflictCount: postConflictView.active.length,
      exceptionCount: postConflictView.excepted.length,
      decisions: [
        `root-selected=${appRoot}`,
        `client-detected=${detectedUI ?? 'none'}`,
        `template-id=${templateId}`,
        `guardrail-policy=${runtime.guardrailPolicy}`,
        `backup-periodicity=${configuredBackupPolicy.periodicity}`,
        `backup-interval-hours=${configuredBackupPolicy.minIntervalHours}`,
        `backup-retention-count=${configuredBackupPolicy.retain.maxSnapshots}`,
        `backup-retention-age-days=${configuredBackupPolicy.retain.maxAgeDays}`,
      ],
    });
    await configureChatPermissionsInteractively(context.projectMetaPath, context.appRoot);
    return context;
  } finally {
    rl.close();
  }
}

function repairInitializedProjectAtPath(
  appRoot: string,
): ResolvedProjectContext {
  const context = ensureProjectSetup(appRoot, { forceProjectUpdate: true });
  updateRegistryForProject(context.projectMeta.alias, context.appRoot, context.s2sDir);
  touchProjectLastUsed(context);
  return context;
}

function upsertManagedRootBlock(
  filePath: string,
  startMarker: string,
  endMarker: string,
  blockContent: string,
): void {
  const previous = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const next = renderUpsertManagedRootBlock(previous, startMarker, endMarker, blockContent);
  if (next !== previous) {
    writeFileSync(filePath, next, 'utf8');
  }
}

function wouldManagedRootBlockChange(
  filePath: string,
  startMarker: string,
  endMarker: string,
  blockContent: string,
): boolean {
  const previous = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const next = renderUpsertManagedRootBlock(previous, startMarker, endMarker, blockContent);
  return next !== previous;
}

function renderUpsertManagedRootBlock(
  previous: string,
  startMarker: string,
  endMarker: string,
  blockContent: string,
): string {
  const block = `${startMarker}\n${blockContent.trim()}\n${endMarker}\n`;
  if (!previous.trim()) {
    return block;
  }

  const start = previous.indexOf(startMarker);
  const end = previous.indexOf(endMarker);
  if (start >= 0 && end > start) {
    const after = end + endMarker.length;
    const prefix = previous.slice(0, start);
    const suffix = previous.slice(after);
    if (!prefix.trim() && !suffix.trim()) {
      return block;
    }
    return `${prefix}${block}${suffix}`.replace(/\n{3,}/g, '\n\n');
  }
  return `${previous}${previous.endsWith('\n') ? '\n' : '\n\n'}${block}`;
}

function removeManagedRootBlocks(appRoot: string): string[] {
  const targets: Array<{ fileName: string; startMarker: string; endMarker: string }> = [
    { fileName: 'AGENTS.md', startMarker: ROOT_GUARDRAIL_START, endMarker: ROOT_GUARDRAIL_END },
    { fileName: 'CODEX.md', startMarker: ROOT_CODEX_ADAPTER_START, endMarker: ROOT_CODEX_ADAPTER_END },
    { fileName: 'CLAUDE.md', startMarker: ROOT_CLAUDE_ADAPTER_START, endMarker: ROOT_CLAUDE_ADAPTER_END },
  ];
  const touched: string[] = [];
  for (const target of targets) {
    const result = removeManagedRootBlockFromFile(
      path.join(appRoot, target.fileName),
      target.startMarker,
      target.endMarker,
    );
    if (result !== 'none') touched.push(target.fileName);
  }
  return touched;
}

function removeManagedRootBlockFromFile(
  filePath: string,
  startMarker: string,
  endMarker: string,
): 'none' | 'updated' | 'deleted' {
  if (!existsSync(filePath)) return 'none';
  const previous = readFileSync(filePath, 'utf8');
  let next = previous;
  let changed = false;

  while (true) {
    const start = next.indexOf(startMarker);
    if (start < 0) break;
    const end = next.indexOf(endMarker, start + startMarker.length);
    if (end < 0) break;
    const after = end + endMarker.length;
    next = `${next.slice(0, start)}${next.slice(after)}`;
    changed = true;
  }

  if (!changed) return 'none';
  const cleaned = next.replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) {
    rmSync(filePath, { force: true });
    return 'deleted';
  }
  const output = `${cleaned}\n`;
  if (output !== previous) {
    writeFileSync(filePath, output, 'utf8');
  }
  return 'updated';
}

async function editProjectConfig(context: ResolvedProjectContext): Promise<void> {
  const runtimePath = path.join(context.configDir, 'runtime.json');
  const llmPath = path.join(context.configDir, 'llm.json');
  const backupPolicyPath = path.join(context.configDir, 'backup.policy.json');
  const runtime = readJsonFile<RuntimeConfig>(runtimePath) || defaultRuntimeConfig(context.projectMeta);
  const llm = readJsonFile<LLMProviderConfig>(llmPath) || { mode: 'api' as const, provider: 'anthropic' as const, model: 'claude-sonnet-4-5-20250929', apiKeyEnvVar: 'ANTHROPIC_API_KEY' };

  const rl = createInterface({ input, output });
  try {
    const currentObservability = normalizeChatObservability(runtime.chatObservability);
    const currentGuardrailPolicy = normalizeGuardrailPolicy(runtime.guardrailPolicy);
    const alias = await askWithDefault(rl, 'Project alias', context.projectMeta.alias);
    const minCliVersion = await askWithDefault(rl, 'Min CLI version (semver)', context.projectMeta.minCliVersion);
    const worktreesRoot = await askWithDefault(
      rl,
      'Worktrees root path',
      runtime.workspace.worktreesRootPath || defaultManagedWorktreesRootPath(context.appRoot),
    );
    const sessionBannerInput = await askWithDefault(
      rl,
      'Session banner enabled (true|false)',
      String(currentObservability.sessionBannerEnabled),
    );
    const wrapperPrefixInput = await askWithDefault(
      rl,
      'Wrapper prefix enabled (true|false)',
      String(currentObservability.wrapperPrefixEnabled),
    );
    const wrapperPrefixTemplateInput = await askWithDefault(
      rl,
      'Wrapper prefix template',
      currentObservability.wrapperPrefixTemplate,
    );
    const guardrailPolicyInput = await askWithDefault(
      rl,
      'Guardrail policy (strict|warn|prompt)',
      currentGuardrailPolicy,
    );

    const currentQuality = runtime.quality ?? { enabled: true, minAutoApproveScore: 0.85, blockOnFailure: false };
    const qualityThresholdInput = await askWithDefault(
      rl,
      'Quality auto-approve threshold (0.0–1.0)',
      String(currentQuality.minAutoApproveScore),
    );
    const qualityBlockInput = await askWithDefault(
      rl,
      'Block on quality failure? (true|false)',
      String(currentQuality.blockOnFailure),
    );

    const pipelineModeInput = await askWithDefault(
      rl,
      'Pipeline mode (chat-native|standalone)',
      runtime.pipelineMode ?? 'chat-native',
    );
    const isStandaloneModeEdit = pipelineModeInput.trim() === 'standalone';
    runtime.pipelineMode = isStandaloneModeEdit ? 'standalone' : 'chat-native';

    let writeLlmJson = false;
    if (isStandaloneModeEdit) {
      const llmModeInput = await askWithDefault(rl, 'LLM mode (api|openai_compatible)', llm.mode || 'api');
      const llmMode = normalizeLLMMode(llmModeInput);
      const provider = await askWithDefault(
        rl,
        'Provider (anthropic|openai)',
        String(llm.provider || 'anthropic'),
      );
      const model = await askWithDefault(rl, 'Model', String(llm.model || ''));
      const envVar = await askWithDefault(
        rl,
        'API key env var',
        String(llm.apiKeyEnvVar || (provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY')),
      );
      llm.mode = llmMode;
      llm.provider = provider === 'openai' ? 'openai' : 'anthropic';
      llm.model = model || (llm.provider === 'openai' ? 'gpt-5.4' : 'claude-sonnet-4-5-20250929');
      llm.apiKeyEnvVar = envVar;
      if (llmMode === 'openai_compatible') {
        const baseURL = await askWithDefault(rl, 'OpenAI-compatible baseURL', String(llm.baseURL || ''));
        llm.baseURL = baseURL;
      }
      delete llm.cli;
      writeLlmJson = true;
    }

    context.projectMeta.alias = normalizeAlias(alias || context.projectMeta.alias);
    context.projectMeta.minCliVersion = minCliVersion || context.projectMeta.minCliVersion;
    context.projectMeta.updatedAt = new Date().toISOString();
    writeJsonFile(context.projectMetaPath, context.projectMeta);

    runtime.workspace.worktreesRootPath = path.resolve(
      expandHomePath(worktreesRoot || defaultManagedWorktreesRootPath(context.appRoot)),
    );
    runtime.workspace.worktreesDirName = path.basename(runtime.workspace.worktreesRootPath);
    runtime.guardrailPolicy = normalizeGuardrailPolicy(guardrailPolicyInput);
    runtime.quality = {
      enabled: true,
      minAutoApproveScore: Math.max(0, Math.min(1, Number(qualityThresholdInput) || 0.85)),
      blockOnFailure: parseBooleanInput(qualityBlockInput, false),
    };
    runtime.execution.allowedCommands = defaultAllowedExecutionCommands('codex-cli');
    runtime.execution.allowUnsafeRawCommand = false;
    runtime.costControl = {
      enabled: false,
      budgetUsd: 0,
      warnThresholdPct: 80,
      hardStopThresholdPct: 100,
    };
    runtime.chatObservability = normalizeChatObservability({
      sessionBannerEnabled: parseBooleanInput(sessionBannerInput, currentObservability.sessionBannerEnabled),
      wrapperPrefixEnabled: parseBooleanInput(wrapperPrefixInput, currentObservability.wrapperPrefixEnabled),
      wrapperPrefixTemplate: wrapperPrefixTemplateInput,
    });
    const resolvedPolicy = await resolveGuardrailPolicyFromDiscrepancies(
      context,
      rl,
      runtime.guardrailPolicy,
      { source: 'config edit' },
    );
    if (!resolvedPolicy) {
      console.error('Configuration canceled due to unresolved guardrail discrepancies.');
      process.exit(1);
    }
    runtime.guardrailPolicy = resolvedPolicy;
    writeJsonFile(runtimePath, runtime);
    if (writeLlmJson) {
      writeJsonFile(llmPath, llm);
    }
    writeJsonFile(path.join(context.configDir, 'execution.templates.json'), defaultExecutionTemplates());
    const configuredBackupPolicy = await configureBackupPolicyInteractively(
      context.configDir,
      rl,
      { source: 'config edit' },
    );
    writeJsonFile(backupPolicyPath, configuredBackupPolicy);

    updateRegistryForProject(context.projectMeta.alias, context.appRoot, context.s2sDir);
    writeLocalState(context, {
      lastDetectedClient: detectUIHintFromEnvironment() ?? undefined,
      lastUsedAt: new Date().toISOString(),
    });
    console.log('Configuration updated.');
  } finally {
    rl.close();
  }
}

// GuardrailPolicy type extracted to ./cli/types.ts


async function resolveGuardrailPolicyFromDiscrepancies(
  context: ResolvedProjectContext,
  rl: ReturnType<typeof createInterface>,
  requestedPolicy: GuardrailPolicy,
  options?: {
    source?: string;
    alwaysPromptOnConflicts?: boolean;
  },
): Promise<GuardrailPolicy | null> {
  const source = options?.source || 'configuration';
  const normalizedRequested = normalizeGuardrailPolicy(requestedPolicy);
  let conflictView = getGovernanceConflictView(context);
  if (conflictView.all.length === 0) {
    return normalizedRequested;
  }

  console.log('');
  console.log(`[guardrails] ${conflictView.active.length} active discrepancy(s) detected during ${source}.`);
  printGuardrailConflictSummary(conflictView.active);
  if (conflictView.excepted.length > 0) {
    console.log(`[guardrails] ${conflictView.excepted.length} discrepancy(s) currently covered by governance exceptions.`);
  }

  const unresolvedAfterExceptions = await reconcileConflictExceptionsInteractively(
    context,
    rl,
    conflictView.active,
  );
  conflictView = getGovernanceConflictView(context);
  const unresolved = unresolvedAfterExceptions.filter((conflict) =>
    conflictView.active.some((current) => current.fileName === conflict.fileName && current.ruleId === conflict.ruleId),
  );
  if (unresolved.length === 0) {
    console.log('[guardrails] All detected discrepancies are now covered by explicit exceptions.');
    return normalizedRequested;
  }

  const shouldPrompt = options?.alwaysPromptOnConflicts || normalizedRequested === 'prompt';
  if (!shouldPrompt) {
    console.log(`[guardrails] policy=${normalizedRequested}; keeping current policy.`);
    return normalizedRequested;
  }

  const choice = await askEnumeratedOption(
    rl,
    'Resolve guardrail discrepancies',
    ['strict', 'warn', 'abort'],
    normalizedRequested === 'warn' ? 'warn' : 'strict',
  );
  if (choice === 'abort') {
    return null;
  }

  const nextPolicy = normalizeGuardrailPolicy(choice);
  const backup = createGlobalProjectBackup(context, 'pre-policy-change');
  console.log(`[guardrails] pre-change backup snapshot: ${backup.backupId}`);
  if (nextPolicy === 'strict' && hasBlockingGuardrailConflict(unresolved)) {
    console.log('[guardrails] strict policy selected; blocking discrepancies must be fixed before stage execution.');
  }
  return nextPolicy;
}

async function reconcileConflictExceptionsInteractively(
  context: ResolvedProjectContext,
  rl: ReturnType<typeof createInterface>,
  conflicts: GuardrailConflict[],
): Promise<GuardrailConflict[]> {
  if (conflicts.length === 0) return [];
  const unresolved: GuardrailConflict[] = [];
  for (const conflict of conflicts) {
    const question =
      `Mark discrepancy as approved exception? ` +
      `[${conflict.fileName} :: ${conflict.ruleId}] [y/N]: `;
    const answer = await askPrompt(rl, question);
    const normalized = String(answer || '').trim().toLowerCase();
    const accepted = normalized === 'y' || normalized === 'yes';
    if (!accepted) {
      unresolved.push(conflict);
      continue;
    }
    addGovernanceException(
      context.configDir,
      conflict,
      'approved during onboarding interactive reconciliation',
    );
    console.log(`[guardrails] exception recorded: ${conflict.fileName} :: ${conflict.ruleId}`);
  }
  return unresolved;
}

function normalizeLLMMode(value: string): 'api' | 'openai_compatible' {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'openai_compatible') return v;
  return 'api';
}

async function configureBackupPolicyInteractively(
  configDir: string,
  rl: ReturnType<typeof createInterface>,
  options: { source: string },
): Promise<ReturnType<typeof readBackupPolicy>> {
  const current = readBackupPolicy(configDir);
  console.log('');
  console.log(`[backup] Configure backup policy (${options.source})`);
  console.log(`  periodicity:                 ${current.periodicity}`);
  console.log(`  minIntervalHours:            ${current.minIntervalHours}`);
  console.log(`  maxSnapshots:                ${current.retain.maxSnapshots}`);
  console.log(`  maxAgeDays:                  ${current.retain.maxAgeDays}`);
  console.log(`  createOnlyOnEffectiveChange: ${current.createOnlyOnEffectiveChange}`);

  const acceptDefaults = await promptYesNoInteractive('Accept defaults?', true);
  if (acceptDefaults) {
    return { ...current };
  }

  const periodicityInput = await askEnumeratedOption(
    rl,
    'Backup periodicity',
    ['none', 'daily', 'weekly'],
    current.periodicity,
  );
  const periodicity = normalizeBackupPeriodicity(periodicityInput, current.periodicity);
  const minIntervalHoursInput = await askWithDefault(
    rl,
    'Minimum interval hours between periodic backups',
    String(current.minIntervalHours),
  );
  const maxSnapshotsInput = await askWithDefault(
    rl,
    'Retention max snapshots',
    String(current.retain.maxSnapshots),
  );
  const maxAgeDaysInput = await askWithDefault(
    rl,
    'Retention max age days',
    String(current.retain.maxAgeDays),
  );
  const createOnlyOnChangeInput = await askWithDefault(
    rl,
    'Create backups only on effective changes (true|false)',
    String(current.createOnlyOnEffectiveChange),
  );

  return {
    version: 1,
    periodicity,
    minIntervalHours: normalizePolicyIntervalHours(periodicity, minIntervalHoursInput, current.minIntervalHours),
    retain: {
      maxSnapshots: parsePositiveIntInput(maxSnapshotsInput, current.retain.maxSnapshots),
      maxAgeDays: parsePositiveIntInput(maxAgeDaysInput, current.retain.maxAgeDays),
    },
    createOnlyOnEffectiveChange: parseBooleanInput(createOnlyOnChangeInput, current.createOnlyOnEffectiveChange),
  };
}

function normalizeBackupPeriodicity(
  value: string,
  fallback: ReturnType<typeof readBackupPolicy>['periodicity'],
): ReturnType<typeof readBackupPolicy>['periodicity'] {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'none' || normalized === 'daily' || normalized === 'weekly') {
    return normalized;
  }
  return fallback;
}

function normalizePolicyIntervalHours(
  periodicity: ReturnType<typeof readBackupPolicy>['periodicity'],
  value: string,
  fallback: number,
): number {
  const parsed = parsePositiveIntInput(value, fallback);
  if (periodicity === 'daily') return Math.max(1, Math.min(24, parsed));
  if (periodicity === 'weekly') return Math.max(1, Math.min(168, parsed));
  return Math.max(1, Math.min(168, parsed));
}

function normalizeChatObservability(
  value: Partial<RuntimeConfig['chatObservability']> | undefined,
): ChatObservabilitySettings {
  return {
    sessionBannerEnabled: value?.sessionBannerEnabled !== false,
    wrapperPrefixEnabled: Boolean(value?.wrapperPrefixEnabled),
    wrapperPrefixTemplate: String(value?.wrapperPrefixTemplate || DEFAULT_WRAPPER_PREFIX_TEMPLATE).trim()
      || DEFAULT_WRAPPER_PREFIX_TEMPLATE,
  };
}

function normalizeRuntimeVersioning(
  value: RuntimeConfig['versioning'] | undefined,
): NonNullable<RuntimeConfig['versioning']> {
  return {
    enforceSemverBumpOnDelivery: value?.enforceSemverBumpOnDelivery !== false,
    requireChangelogUpdate: value?.requireChangelogUpdate !== false,
    manifestFile: String(value?.manifestFile || 'package.json').trim() || 'package.json',
    changelogFile: String(value?.changelogFile || 'CHANGELOG.md').trim() || 'CHANGELOG.md',
  };
}

function normalizeStageLabel(value?: string): string {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return 'pm';
  return isSupportedStage(v) ? v : v;
}

function printInitBanner(targetPath: string): void {
  const lines = [
    `┌─ Spec-To-Ship (s2s) v${CLI_VERSION} ──────────────────────────`,
    '│ Governed AI-assisted software delivery',
    `│ Target: ${targetPath}`,
    '└──────────────────────────────────────────────────────',
  ];
  console.log(lines.join('\n'));
  console.log('');
}

function printSessionBanner(metadata: {
  invokedCommand: string;
  s2sStatus: 'ACTIVE' | 'INACTIVE';
  projectAlias: string;
  appRoot: string;
  client: string;
  stage?: string;
  wrapperPrefixLabel: string;
}): void {
  const lines = [
    `┌─ Spec-To-Ship (s2s) v${CLI_VERSION} ─────────────────────────────`,
    `│ Command: ${metadata.invokedCommand}`,
    `│ S2S Governance: ${metadata.s2sStatus}`,
    `│ Project: ${metadata.projectAlias}`,
    `│ Root: ${metadata.appRoot}`,
    `│ Client: ${metadata.client}`,
    `│ Wrapper Prefix: ${metadata.wrapperPrefixLabel}`,
  ];
  if (metadata.stage) {
    lines.push(`│ Stage: ${metadata.stage}`);
  }
  lines.push('└───────────────────────────────────────────────────');
  console.log(lines.join('\n'));
}

function printRequestBanner(projectAlias: string): void {
  const lines = [
    `┌─ Spec-To-Ship (s2s) v${CLI_VERSION} · request ─────────────────────────`,
    `│ Project: ${projectAlias}`,
    '└──────────────────────────────────────────────────────────────',
  ];
  console.log(lines.join('\n'));
  console.log('');
}

function buildInvokedCommand(args: string[]): string {
  if (!args.length) return 's2s';
  return `s2s ${args.join(' ')}`.trim();
}

function isHelpFlag(value: string): boolean {
  return value === '--help' || value === '-h';
}

function isCommandHelpRequest(args: string[]): boolean {
  return args.length === 1 && isHelpFlag(String(args[0] || '').trim());
}

function isHelpTopic(value: string): value is HelpTopic {
  return HELP_TOPICS.includes(value as HelpTopic);
}

function failUnavailableCommand(command: 'execute' | 'resume', guidance: string[]): never {
  failCLI([
    `Command '${command}' is not part of the current release surface.`,
    ...guidance,
  ].join('\n'), {
    command,
    available: false,
  });
}

/**
 * Preserve existing live.md during update — user runtime state is never wiped.
 * Only creates the file if it doesn't exist, or recovers it if corrupted.
 */
function ensureLiveState(s2sDir: string, projectId: string, nowIso: string): void {
  const existing = readLiveState(s2sDir);
  if (existing) {
    return; // Valid live.md present — leave it untouched
  }
  // File missing or unparseable — rebuild from ledger state
  syncLiveStateFromSnapshot(s2sDir, loadManagedProjectSnapshot(projectId), nowIso);
}

/**
 * Rebuild live.md from the current ledger state so that session-start context
 * survives operations like `s2s update` that previously blanked the file.
 */
function syncLiveStateFromSnapshot(
  s2sDir: string,
  snapshot: ManagedProjectSnapshot,
  nowIso: string,
): void {
  const { ledger, activeChange, activeRun } = snapshot;
  const feature = activeChange?.summary || activeChange?.title;

  if (ledger.pendingGateIds.length > 0) {
    writeLiveState(s2sDir, {
      updatedAt: nowIso,
      status: 'gate_pending',
      project: snapshot.projectId,
      feature,
      stage: activeChange?.currentStage,
      nextAction: `approve or reject: s2s approve ${ledger.pendingGateIds[0]}`,
      blockers: ledger.pendingGateIds,
    });
    return;
  }

  if (activeRun) {
    writeLiveState(s2sDir, {
      updatedAt: nowIso,
      status: 'submitted',
      project: snapshot.projectId,
      feature,
      stage: 'engineering_exec',
      nextAction: 'engineering execution is in progress',
    });
    return;
  }

  writeLiveState(s2sDir, {
    updatedAt: nowIso,
    status: 'none',
    project: snapshot.projectId || undefined,
    feature,
  });
}

function loadManagedProjectSnapshot(projectId: string): ManagedProjectSnapshot {
  const legacyPipelineStatus = getProjectStatus(projectId);
  const changes = listChanges(projectId);
  const specs = listSpecs(projectId);
  const slices = listSlices(projectId);
  const runs = listRuns(projectId);
  const gates = listGates(projectId);
  const ledger = deriveLedger(projectId);
  const activeChange = ledger.activeChangeId ? getChange(projectId, ledger.activeChangeId) : null;
  const activeSpec = ledger.activeSpecId ? getSpec(projectId, ledger.activeSpecId) : null;
  const activeRun = listOpenRuns(projectId)[0] || null;
  const executableSlice = resolveExecutableSliceSelection(projectId).selectedSlice;
  const artifactFiles = listArtifactFiles(projectId);
  const timestamps = [
    legacyPipelineStatus.exists ? legacyPipelineStatus.state.updatedAt : undefined,
    ...changes.map((change) => change.updatedAt),
    ...specs.map((spec) => spec.updatedAt),
    ...slices.map((slice) => slice.updatedAt),
    ...runs.map((run) => run.updatedAt),
    ...gates.map((gate) => gate.updatedAt),
  ].filter(Boolean) as string[];

  return {
    projectId,
    legacyPipelineStatus,
    ledger,
    activeChange,
    activeSpec,
    activeRun,
    executableSlice,
    changes,
    specs,
    slices,
    runs,
    gates,
    artifactFiles,
    lastUpdatedAt: timestamps.sort((left, right) => right.localeCompare(left))[0],
  };
}

function hasOperationalWorkflowState(snapshot: ManagedProjectSnapshot): boolean {
  return snapshot.changes.length > 0 || snapshot.specs.length > 0 || snapshot.slices.length > 0 || snapshot.runs.length > 0 || snapshot.gates.length > 0;
}

function deriveManagedWorkflowSource(
  snapshot: ManagedProjectSnapshot,
  repositoryInitialized: boolean,
): 'operational' | 'legacy_pipeline' | 'initialized_idle' | 'repair_required' {
  if (!repositoryInitialized) {
    return 'repair_required';
  }

  if (hasOperationalWorkflowState(snapshot)) {
    return 'operational';
  }

  if (snapshot.legacyPipelineStatus.exists) {
    return 'legacy_pipeline';
  }

  return 'initialized_idle';
}

function deriveManagedCurrentStage(snapshot: ManagedProjectSnapshot, repositoryInitialized: boolean): PipelineStage | undefined {
  if (snapshot.activeRun) {
    return 'engineering_exec';
  }

  if (snapshot.activeChange?.currentStage) {
    return snapshot.activeChange.currentStage;
  }

  if (!hasOperationalWorkflowState(snapshot) && snapshot.legacyPipelineStatus.exists) {
    return snapshot.legacyPipelineStatus.state.currentStage;
  }

  return repositoryInitialized ? 'pm' : undefined;
}

function deriveManagedCompletedStages(snapshot: ManagedProjectSnapshot, repositoryInitialized: boolean): PipelineStage[] {
  if (snapshot.activeChange) {
    const completed = PIPELINE_PROGRESS_STAGES.filter((stage) => {
      if (stage === 'intake') {
        return repositoryInitialized;
      }

      return snapshot.activeChange?.stageStatus?.[stage] === 'done';
    });

    return completed.length > 0 ? completed : repositoryInitialized ? ['intake'] : [];
  }

  if (!hasOperationalWorkflowState(snapshot) && snapshot.legacyPipelineStatus.exists) {
    return snapshot.legacyPipelineStatus.state.completedStages;
  }

  return repositoryInitialized ? ['intake'] : [];
}

function buildManagedPhaseProgress(snapshot: ManagedProjectSnapshot, repositoryInitialized: boolean): OutputRendererPhaseStep[] {
  const currentStage = deriveManagedCurrentStage(snapshot, repositoryInitialized);
  const completedStages = new Set(deriveManagedCompletedStages(snapshot, repositoryInitialized));

  return PIPELINE_PROGRESS_STAGES.map((stage) => ({
    label: stage,
    state: completedStages.has(stage) ? 'done' : currentStage === stage ? 'current' : 'pending',
  }));
}

function mapChangeState(status: WorkChange['status']): OutputRendererState {
  switch (status) {
    case 'done':
      return 'ok';
    case 'blocked':
      return 'warn';
    case 'active':
    case 'in_review':
    case 'draft':
    case 'archived':
    default:
      return 'info';
  }
}

function mapSpecState(status: WorkSpec['status']): OutputRendererState {
  switch (status) {
    case 'approved':
      return 'ok';
    case 'review_ready':
      return 'warn';
    case 'superseded':
    case 'archived':
      return 'warn';
    case 'draft':
    case 'active':
    default:
      return 'info';
  }
}

function mapSliceState(status: WorkSlice['status']): OutputRendererState {
  switch (status) {
    case 'done':
      return 'ok';
    case 'ready':
      return 'ok';
    case 'blocked':
    case 'cancelled':
      return 'warn';
    case 'queued':
    case 'in_progress':
    case 'draft':
    default:
      return 'info';
  }
}

function mapRunState(status: WorkRun['status']): OutputRendererState {
  switch (status) {
    case 'succeeded':
      return 'ok';
    case 'failed':
      return 'fail';
    case 'blocked':
    case 'cancelled':
      return 'warn';
    case 'created':
    case 'running':
    case 'verifying':
    default:
      return 'info';
  }
}

// Completion utilities extracted to ./cli/handlers/completion.ts

function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  process.chdir(cwd);
  return fn().finally(() => {
    process.chdir(previous);
  });
}

function restoreStageExecutionEnv(key: 'S2S_STAGE_APP_ROOT' | 'S2S_STAGE_CLIENT' | 'S2S_STAGE_NAME', value: string | undefined): void {
  if (typeof value === 'string') {
    process.env[key] = value;
    return;
  }
  delete process.env[key];
}

// File I/O utilities extracted to ./cli/utils/file-io.ts

function buildToolConfigSurfacing(context: ResolvedProjectContext, runtime: RuntimeConfig): {
  configPaths: { runtimeConfigPath: string; llmConfigPath: string };
  runtimeWorkspace: { projectRepoPath: string; worktreesRootPath: string; worktreesDirName: string };
  execution: { mode: RuntimeConfig['execution']['mode']; templateId: string };
  globalPaths: { controlHome: string; runtimeHome: string; worktreesHome: string; projectBackupRoot: string; llmWorkspaceRoot: string };
} {
  const projectRepoPath = path.resolve(runtime.workspace.projectRepoPath || context.appRoot);
  const worktreesRootPath = path.resolve(runtime.workspace.worktreesRootPath || defaultManagedWorktreesRootPath(context.appRoot));
  return {
    configPaths: { runtimeConfigPath: path.join(context.configDir, 'runtime.json'), llmConfigPath: path.join(context.configDir, 'llm.json') },
    runtimeWorkspace: { projectRepoPath, worktreesRootPath, worktreesDirName: runtime.workspace.worktreesDirName || path.basename(worktreesRootPath) },
    execution: { mode: runtime.execution.mode, templateId: runtime.execution.templateId },
    globalPaths: {
      controlHome: globalS2SHomePath(),
      runtimeHome: globalRuntimeHomePath(),
      worktreesHome: globalWorktreesHomePath(),
      projectBackupRoot: globalProjectBackupsDir(context.appRoot),
      llmWorkspaceRoot: managedLLMWorkspaceDir(context.appRoot),
    },
  };
}

function normalizeProjectMinCliVersion(value: unknown): string {
  const requested = String(value || DEFAULT_MIN_CLI_VERSION).trim() || DEFAULT_MIN_CLI_VERSION;
  const currentMajor = parseSemver(CLI_VERSION).core[0];
  // v0 rollback compatibility: allow existing projects created during v1 trial track.
  if (currentMajor === 0 && requested === '1.0.0') {
    return DEFAULT_MIN_CLI_VERSION;
  }
  return requested;
}

// compareSemver, parseSemver extracted to ./cli/utils/versioning.ts

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
