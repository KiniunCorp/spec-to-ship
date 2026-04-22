import { accessSync, constants, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { scaffoldAppRepository } from '../src/runtime/app-scaffold.js';
import { bootstrapWorkspace, loadRuntimeConfig, saveRuntimeConfig } from '../src/runtime/config.js';
import { commandExists, runShell } from '../src/runtime/shell.js';
import type { LLMProviderConfig, RuntimeConfig } from '../src/types/index.js';

type UIChoice = 'codex' | 'claude' | 'opencode';
type ProviderChoice = 'anthropic' | 'openai';
type LLMAccessMode = 'api' | 'cli' | 'openai_compatible';
type UITarget = 'codex_cli' | 'codex_desktop' | 'claude_cli' | 'claude_desktop' | 'opencode_cli';
const SUPPORTED_UI_COMMANDS: UIChoice[] = ['codex', 'claude', 'opencode'];
const SUPPORTED_UI_TARGETS: UITarget[] = ['codex_cli', 'codex_desktop', 'claude_cli', 'claude_desktop', 'opencode_cli'];
const CODEX_DESKTOP_CANDIDATE_PATHS = [
  '/Applications/Codex.app/Contents/Resources/codex',
  path.resolve(process.env.HOME || '', 'Applications', 'Codex.app', 'Contents', 'Resources', 'codex'),
];
const CLAUDE_DESKTOP_APP_CANDIDATE_PATHS = [
  '/Applications/Claude.app',
  path.resolve(process.env.HOME || '', 'Applications', 'Claude.app'),
];

interface UITargetOption {
  id: UITarget;
  label: string;
  ui: UIChoice;
  available: boolean;
  cliCommand?: string;
  notes: string;
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

function normalizeName(value: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'my-app';
}

function isYes(value: string, defaultYes = true): boolean {
  const v = String(value || '').trim().toLowerCase();
  if (!v) return defaultYes;
  return ['y', 'yes', 'true', '1', 'si', 's'].includes(v);
}

async function askWithDefault(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultValue: string,
): Promise<string> {
  const answer = await rl.question(`${label} [${defaultValue}]: `);
  return String(answer || defaultValue).trim();
}

async function askYesNo(
  rl: ReturnType<typeof createInterface>,
  label: string,
  defaultYes = true,
): Promise<boolean> {
  const suffix = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await rl.question(`${label} ${suffix}: `);
  return isYes(answer, defaultYes);
}

function defaultModel(provider: ProviderChoice): string {
  if (provider === 'openai') return 'gpt-5.4';
  return 'claude-sonnet-4-5-20250929';
}

function defaultApiKeyEnvVar(provider: ProviderChoice): string {
  if (provider === 'openai') return 'OPENAI_API_KEY';
  return 'ANTHROPIC_API_KEY';
}

function defaultCLIArgs(ui: UIChoice): string[] {
  if (ui === 'claude') return ['code', '--print', '--prompt', '${PROMPT}'];
  if (ui === 'opencode') return ['run', '--prompt', '${PROMPT}'];
  return ['exec', '--skip-git-repo-check', '${PROMPT}'];
}

function templateFromUI(ui: UIChoice): string {
  if (ui === 'claude') return 'claude_strict';
  if (ui === 'opencode') return 'opencode_strict';
  return 'codex_strict';
}

function mergeAllowedCommands(commands: string[], ui: UIChoice): string[] {
  const base = ['codex', 'claude', 'opencode', 'just', 'pnpm', 'npm', 'node', 'git', 'bash'];
  const merged = new Set<string>([...commands, ...base, ui]);
  return Array.from(merged);
}

function isCommandAvailable(command: string): boolean {
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

function detectUIFromCommand(command: string): UIChoice | undefined {
  if ((SUPPORTED_UI_COMMANDS as string[]).includes(command)) return command as UIChoice;
  const base = path.basename(command);
  if ((SUPPORTED_UI_COMMANDS as string[]).includes(base)) return base as UIChoice;
  return undefined;
}

function detectCodexDesktopBinary(): string | undefined {
  return CODEX_DESKTOP_CANDIDATE_PATHS.find((candidate) => isCommandAvailable(candidate));
}

function detectUITargetOptions(): UITargetOption[] {
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

function uiTargetNumber(target: UITarget): number {
  return SUPPORTED_UI_TARGETS.indexOf(target) + 1;
}

function parseUITargetSelection(value: string, defaultTarget: UITarget): UITarget {
  const trimmed = String(value || '').trim();
  if (!trimmed) return defaultTarget;
  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= SUPPORTED_UI_TARGETS.length) {
    return SUPPORTED_UI_TARGETS[numeric - 1];
  }
  if (SUPPORTED_UI_TARGETS.includes(trimmed as UITarget)) return trimmed as UITarget;
  throw new Error(
    `Invalid UI selection: "${trimmed}". Use a number between 1 and ${SUPPORTED_UI_TARGETS.length}.`,
  );
}

function printUITargetOptionsFriendly(options: UITargetOption[]): void {
  console.log('\nAvailable UI options:');
  options.forEach((option) => {
    const status = option.available ? '✓' : 'x';
    console.log(`${uiTargetNumber(option.id)}) ${status} ${option.label} — ${option.notes}`);
  });
}

function pickDefaultUITarget(options: UITargetOption[], uiArg?: string): UITarget {
  const inferredHint = uiArg || detectUIHintFromEnvironment();

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

function detectUIHintFromEnvironment(): UIChoice | undefined {
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

function checkCoreTools(): { requiredMissing: string[]; optionalMissing: string[] } {
  const required = ['node', 'npm', 'git', 'just'];
  const optional = ['gh'];
  const requiredMissing = required.filter((tool) => !commandExists(tool));
  const optionalMissing = optional.filter((tool) => !commandExists(tool));
  return { requiredMissing, optionalMissing };
}

function writeLLMConfig(config: LLMProviderConfig): string {
  const configPath = path.resolve(process.cwd(), 'config', 'llm.json');
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return configPath;
}

async function main(): Promise<void> {
  const cwd = path.resolve(process.cwd());
  const cwdName = path.basename(cwd);
  const parent = path.dirname(cwd);
  const rl = createInterface({ input, output });

  try {
    console.log('\nSpecToShip Init');
    console.log('This interactive initializer sets up runtime config, workspace paths, and app scaffold.\n');

    const installNow = readArg('install')
      ? isYes(readArg('install'), true)
      : await askYesNo(rl, 'Install project dependencies now (npm install)?', true);
    if (installNow) {
      console.log('\nRunning npm install...');
      runShell('npm', ['install'], process.cwd());
    }

    const uiArg = readArg('ui');
    const uiTargetArg = readArg('ui-target');
    const uiOptionArg = readArg('ui-option');
    const uiTargetOptions = detectUITargetOptions();
    printUITargetOptionsFriendly(uiTargetOptions);
    const defaultUITarget = pickDefaultUITarget(uiTargetOptions, uiArg);
    const defaultUIOption = String(uiTargetNumber(defaultUITarget));
    const defaultUILabel =
      uiTargetOptions.find((option) => option.id === defaultUITarget)?.label || defaultUITarget;
    const uiSelectionInput =
      uiTargetArg ||
      uiOptionArg ||
      String((await rl.question(`Choose UI (${defaultUIOption}. ${defaultUILabel}): `)) || defaultUIOption).trim();
    const uiTarget = parseUITargetSelection(uiSelectionInput, defaultUITarget);
    const selectedUITarget = uiTargetOptions.find((option) => option.id === uiTarget) || uiTargetOptions[0];
    const ui = selectedUITarget.ui;

    if (!selectedUITarget.available) {
      throw new Error(`Selected UI "${selectedUITarget.label}" is unavailable: ${selectedUITarget.notes}`);
    }

    const tools = checkCoreTools();
    if (tools.requiredMissing.length > 0) {
      console.log('\nMissing required tools:');
      tools.requiredMissing.forEach((tool) => console.log(`- ${tool}`));
      console.log('\nInstall missing tools and run `s2s` again.');
      process.exit(1);
    }
    if (tools.optionalMissing.length > 0) {
      console.log('\nOptional tools not found:');
      tools.optionalMissing.forEach((tool) => console.log(`- ${tool}`));
      console.log('You can continue. GitHub PR automation may be limited until optional tools are installed.');
    }

    const selectedCliCommand = selectedUITarget.cliCommand;
    const selectedCliReady = Boolean(selectedCliCommand && isCommandAvailable(selectedCliCommand));
    const llmModeArg = readArg('llm-mode');
    const llmAutoArg = readArg('llm-auto');
    const llmAutoEnabled = llmAutoArg ? isYes(llmAutoArg, true) : true;
    const autoConfigureCLI = !llmModeArg && llmAutoEnabled && selectedCliReady;

    if (!selectedCliReady) {
      console.log(`\nSelected UI is not CLI-ready: ${selectedUITarget.notes}`);
    }

    const defaultAccessMode: LLMAccessMode = selectedCliReady ? 'cli' : 'api';
    const accessModeInput = autoConfigureCLI
      ? 'cli'
      : llmModeArg ||
        (await askWithDefault(rl, 'LLM access mode (api|cli|openai_compatible)', defaultAccessMode));
    const accessMode = (['api', 'cli', 'openai_compatible'].includes(accessModeInput)
      ? accessModeInput
      : defaultAccessMode) as LLMAccessMode;

    if (autoConfigureCLI) {
      console.log(`\nAuto-configuring LLM in CLI mode for: ${selectedUITarget.label}`);
    }

    let llmConfig: LLMProviderConfig;
    let executionUI: UIChoice = ui;
    let apiKeyEnvVar = '';
    let apiKeyValue = '';
    let llmSetupMode: 'automatic' | 'manual' = autoConfigureCLI ? 'automatic' : 'manual';

    if (accessMode === 'cli') {
      const cliCommandArg = readArg('llm-cli-command');
      let cliCommand = cliCommandArg || selectedUITarget.cliCommand;
      if (!cliCommand) {
        throw new Error(
          `Selected UI "${selectedUITarget.label}" is not CLI-ready: ${selectedUITarget.notes}. Choose another UI option or use --llm-mode=api.`,
        );
      }
      if (!isCommandAvailable(cliCommand)) {
        throw new Error(
          `Selected CLI command is not available: ${cliCommand}. Re-run init and choose another UI target, or pass --llm-cli-command=<path>.`,
        );
      }
      const cliUI = detectUIFromCommand(cliCommand) || ui;
      executionUI = cliUI;
      const cliArgsRaw = readArg('llm-cli-args')
        || (autoConfigureCLI
          ? defaultCLIArgs(cliUI).join(' ')
          : await askWithDefault(
              rl,
              'CLI args (use ${PROMPT} token; separate args with spaces)',
              defaultCLIArgs(cliUI).join(' '),
            ));
      const cliArgs = cliArgsRaw
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean);
      const model = readArg('model')
        || (autoConfigureCLI ? `cli-${cliUI}` : await askWithDefault(rl, 'LLM model (metadata only for CLI mode)', 'cli-default'));
      const cliTimeoutRaw = readArg('llm-cli-timeout-ms')
        || (autoConfigureCLI ? '120000' : await askWithDefault(rl, 'CLI timeout in ms', '120000'));
      const cliTimeoutMs = Number.isFinite(Number(cliTimeoutRaw)) && Number(cliTimeoutRaw) > 0 ? Number(cliTimeoutRaw) : 120000;
      llmConfig = {
        mode: 'cli',
        model,
        cli: {
          command: cliCommand,
          args: cliArgs,
          timeoutMs: cliTimeoutMs,
        },
      };
    } else if (accessMode === 'openai_compatible') {
      const model = readArg('model') || (await askWithDefault(rl, 'LLM model', 'gpt-5.4'));
      const baseURL = readArg('base-url') || (await askWithDefault(rl, 'OpenAI-compatible base URL', 'https://api.openai.com/v1'));
      apiKeyEnvVar =
        readArg('api-key-env') || (await askWithDefault(rl, 'API key env var', 'OPENAI_API_KEY'));
      apiKeyValue = readArg('api-key') || (await askWithDefault(rl, `API key value for ${apiKeyEnvVar} (optional)`, ''));
      llmConfig = {
        mode: 'openai_compatible',
        provider: 'openai',
        model,
        baseURL,
        apiKeyEnvVar,
      };
    } else {
      const providerInput =
        readArg('provider') || (await askWithDefault(rl, 'LLM provider (anthropic|openai)', 'anthropic'));
      const provider = (providerInput === 'openai' ? 'openai' : 'anthropic') as ProviderChoice;
      const model = readArg('model') || (await askWithDefault(rl, 'LLM model', defaultModel(provider)));
      apiKeyEnvVar =
        readArg('api-key-env') || (await askWithDefault(rl, 'API key env var', defaultApiKeyEnvVar(provider)));
      apiKeyValue = readArg('api-key') || (await askWithDefault(rl, `API key value for ${apiKeyEnvVar} (optional)`, ''));
      llmConfig = {
        mode: 'api',
        provider,
        model,
        apiKeyEnvVar,
      };
    }

    const llmConfigPath = writeLLMConfig(llmConfig);

    const runtime = loadRuntimeConfig();
    const enableCostControl = readArg('cost-enabled')
      ? isYes(readArg('cost-enabled'), false)
      : await askYesNo(rl, 'Enable LLM budget control?', false);
    const budgetUsd = enableCostControl
      ? Number(readArg('budget-usd') || (await askWithDefault(rl, 'Budget USD', '50')))
      : 0;
    const warnThresholdPct = enableCostControl
      ? Number(readArg('budget-warn-pct') || (await askWithDefault(rl, 'Budget warning threshold %', '80')))
      : 80;
    const hardStopThresholdPct = enableCostControl
      ? Number(readArg('budget-hard-stop-pct') || (await askWithDefault(rl, 'Budget hard-stop threshold %', '100')))
      : 100;

    const nextRuntime: RuntimeConfig = {
      ...runtime,
      execution: {
        ...runtime.execution,
        templateId: templateFromUI(executionUI),
        allowedCommands: mergeAllowedCommands(runtime.execution.allowedCommands || [], executionUI),
        allowUnsafeRawCommand: false,
      },
      costControl: {
        enabled: enableCostControl && Number.isFinite(budgetUsd) && budgetUsd > 0,
        budgetUsd: Number.isFinite(budgetUsd) && budgetUsd > 0 ? budgetUsd : 0,
        warnThresholdPct: Number.isFinite(warnThresholdPct) ? warnThresholdPct : 80,
        hardStopThresholdPct: Number.isFinite(hardStopThresholdPct) ? hardStopThresholdPct : 100,
      },
    };
    saveRuntimeConfig(nextRuntime);

    const appNameInput = readArg('app-name') || (await askWithDefault(rl, 'App name', 'my-app'));
    const appName = normalizeName(appNameInput);

    const recommendedWorkdir = path.resolve(parent, `${appName}-workdir`);
    const recommendedAppPath = path.resolve(recommendedWorkdir, appName);
    const recommendedWorktreesPath = path.resolve(recommendedWorkdir, `${appName}-worktrees`);
    const recommendedOrchestratorPath = path.resolve(recommendedWorkdir, 'spec-to-ship');

    console.log('\nRecommended structure:');
    console.log(`${recommendedWorkdir}/`);
    console.log(`|_ ${path.basename(recommendedAppPath)}`);
    console.log(`|_ ${path.basename(recommendedWorktreesPath)}`);
    console.log('|_ spec-to-ship');

    const useRecommended = readArg('use-recommended')
      ? isYes(readArg('use-recommended'), true)
      : await askYesNo(rl, 'Use recommended paths?', true);

    let appRepoPath = recommendedAppPath;
    let worktreesRootPath = recommendedWorktreesPath;
    if (!useRecommended) {
      appRepoPath = path.resolve(
        readArg('app-path') || (await askWithDefault(rl, 'App repo path', recommendedAppPath)),
      );
      worktreesRootPath = path.resolve(
        readArg('worktrees-path') || (await askWithDefault(rl, 'Worktrees root path', recommendedWorktreesPath)),
      );
    }

    const relocateDefault = useRecommended && cwdName === 'spec-to-ship' && cwd !== recommendedOrchestratorPath;
    const relocate = readArg('relocate-spec-to-ship')
      ? isYes(readArg('relocate-spec-to-ship'), relocateDefault)
      : relocateDefault
        ? await askYesNo(rl, `Move current spec-to-ship repo to ${recommendedOrchestratorPath}?`, true)
        : false;

    if (relocate) {
      mkdirSync(recommendedWorkdir, { recursive: true });
      if (existsSync(recommendedOrchestratorPath)) {
        throw new Error(`Cannot relocate: target path already exists: ${recommendedOrchestratorPath}`);
      }
      process.chdir(parent);
      renameSync(cwd, recommendedOrchestratorPath);
      process.chdir(recommendedOrchestratorPath);
      console.log(`\nRelocated spec-to-ship to: ${recommendedOrchestratorPath}`);
    }

    const workspace = bootstrapWorkspace({
      appName,
      appRepoPath,
      worktreesRootPath,
      createIfMissing: true,
    });
    const guardrailsCreatedOrUpdated = workspace.guardrails.filter(
      (item) => item.status === 'created' || item.status === 'updated',
    ).length;
    const guardrailsUnchanged = workspace.guardrails.filter((item) => item.status === 'unchanged').length;
    const guardrailsSkipped = workspace.guardrails.filter((item) => item.status === 'skipped').length;

    const scaffoldNow = readArg('scaffold')
      ? isYes(readArg('scaffold'), true)
      : await askYesNo(rl, 'Initialize app scaffold now?', true);

    let scaffoldSummary = 'Skipped app scaffold.';
    if (scaffoldNow) {
      const recommendedStack = readArg('stack')
        ? readArg('stack') !== 'custom'
        : await askYesNo(rl, 'Use recommended app stack (Next.js + TypeScript + Supabase-ready)?', true);
      const customStackNotes =
        !recommendedStack
          ? readArg('custom-stack-notes') || (await askWithDefault(rl, 'Custom stack notes (optional)', ''))
          : undefined;
      const scaffold = scaffoldAppRepository({
        appName,
        appRepoPath: workspace.appRepoPath,
        worktreesRootPath: workspace.worktreesRootPath,
        mode: recommendedStack ? 'recommended' : 'custom',
        customStackNotes,
      });
      scaffoldSummary = `Scaffold mode: ${scaffold.mode}. Created files: ${scaffold.createdFiles.length}.`;
    }

    if (apiKeyValue && apiKeyEnvVar) {
      process.env[apiKeyEnvVar] = apiKeyValue;
    }

    console.log('\nInit completed.\n');
    console.log('Summary:');
    console.log(`- Conversational UI: ${selectedUITarget.label}`);
    console.log(`- UI template: ${templateFromUI(executionUI)}`);
    console.log(`- LLM access mode: ${accessMode}`);
    console.log(`- LLM setup: ${llmSetupMode}`);
    if (llmConfig.mode === 'cli') {
      console.log(`- CLI command: ${llmConfig.cli.command}`);
    }
    console.log(`- LLM config: ${llmConfigPath}`);
    console.log(`- Workspace app path: ${workspace.appRepoPath}`);
    console.log(`- Workspace worktrees path: ${workspace.worktreesRootPath}`);
    console.log(
      `- Workspace guidance notes: ${guardrailsCreatedOrUpdated} created/updated, ${guardrailsUnchanged} unchanged, ${guardrailsSkipped} skipped`,
    );
    workspace.guardrails
      .filter((item) => item.status === 'created' || item.status === 'updated')
      .forEach((item) => console.log(`  - ${item.filePath} (${item.status})`));
    console.log(`- ${scaffoldSummary}`);
    console.log(
      `- Cost control: ${nextRuntime.costControl.enabled ? `enabled (${nextRuntime.costControl.budgetUsd} USD)` : 'disabled'}`,
    );
    if (apiKeyEnvVar) {
      console.log(`- API key env var: ${apiKeyEnvVar}${apiKeyValue ? ' (loaded in current process)' : ' (set it in your shell)'}`);
    } else {
      console.log('- API key env var: not required for CLI mode');
    }
    console.log('\nNext:');
    if (apiKeyEnvVar) {
      console.log(`1) Export API key in your shell: export ${apiKeyEnvVar}=\"<your-key>\"`);
      console.log('2) Open your conversational UI and start with your product idea.');
    } else {
      console.log('1) Ensure your selected CLI is already authenticated locally.');
      console.log('2) Open your conversational UI and start with your product idea.');
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exit(1);
});
