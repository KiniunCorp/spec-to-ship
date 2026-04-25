import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LLMProviderConfig, RuntimeConfig } from '../src/types/index.js';

function defaultWorktreesRootPath(repoRoot: string): string {
  const home = path.resolve(process.env.HOME || tmpdir());
  return path.join(home, '.s2s', 'worktrees', path.basename(repoRoot));
}

function createRuntimeConfig(repoRoot: string): RuntimeConfig {
  const worktreesRootPath = defaultWorktreesRootPath(repoRoot);
  return {
    productName: 's2s',
    defaultBranch: 'main',
    guardrailPolicy: 'strict',
    workspace: {
      basePath: repoRoot,
      orchestratorDirName: '.s2s',
      projectDirName: path.basename(repoRoot),
      worktreesDirName: path.basename(worktreesRootPath),
      projectRepoPath: repoRoot,
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

async function main(): Promise<void> {
  const { assessInitPrerequisites } = await import('../src/index.js');
  const sandboxHome = mkdtempSync(path.join(tmpdir(), 's2s-init-prereq-home-'));
  const sandboxRepo = mkdtempSync(path.join(tmpdir(), 's2s-init-prereq-repo-'));
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = sandboxHome;
    writeFileSync(path.join(sandboxRepo, 'package.json'), `${JSON.stringify({ name: 'demo-app' }, null, 2)}\n`, 'utf8');

    const codexAvailable = [
      {
        id: 'codex_cli',
        label: 'Codex CLI',
        ui: 'codex',
        available: true,
        cliCommand: 'codex',
        notes: 'Ready from terminal.',
      },
    ];

    const preflightReport = assessInitPrerequisites({
      repoRoot: sandboxRepo,
      uiTarget: 'codex_cli',
      uiOptions: codexAvailable,
      commandExistsFn: (command) => ['node', 'npm', 'git', 'just', 'codex'].includes(command),
    });

    assert.equal(preflightReport.canInitialize, true);
    assert.equal(preflightReport.ready, false);
    assert.equal(preflightReport.status, 'action_required');
    assert.equal(preflightReport.localStatePresent, false);
    assert.equal(preflightReport.repositoryInitialized, false);
    assert.equal(preflightReport.summary, 'Repository can be initialized for S2S.');
    assert.ok(preflightReport.setupChecks.some((check) => check.id === 'repository.runtime_config'));
    assert.ok(preflightReport.setupChecks.some((check) => check.id === 'feature.llm_access'));
    assert.ok(preflightReport.setupChecks.some((check) => check.id === 'repository.managed_project_state'));
    assert.ok(preflightReport.setupChecks.some((check) => check.id === 'repository.guardrails_bundle'));
    assert.ok(preflightReport.warningChecks.some((check) => check.id === 'machine.tool.gh'));
    assert.ok(preflightReport.warningChecks.some((check) => check.id === 'feature.worktree_worktrunk'));
    assert.equal(preflightReport.runtimeConfigPath, path.join(sandboxRepo, '.s2s', 'config', 'runtime.json'));
    assert.equal(preflightReport.readinessChecklist.find((item) => item.id === 'repository_initialized')?.ready, false);
    assert.equal(preflightReport.readinessChecklist.find((item) => item.id === 'preferred_client_ready')?.ready, true);
    assert.ok(preflightReport.suggestedNextActions.some((action) => action.includes('Run `s2s init`')));

    const sourceRepoReport = assessInitPrerequisites({
      repoRoot: process.cwd(),
      uiOptions: codexAvailable,
      commandExistsFn: (command) => ['node', 'npm', 'git', 'just', 'codex', 'wt'].includes(command),
    });

    assert.equal(sourceRepoReport.canInitialize, false);
    assert.equal(sourceRepoReport.status, 'blocked');
    assert.equal(sourceRepoReport.summary, 'Required local prerequisites are blocking S2S initialization.');
    assert.ok(sourceRepoReport.blockingChecks.some((check) => check.id === 'repository.supported_context'));

    const configDir = path.join(sandboxRepo, '.s2s', 'config');
    mkdirSync(defaultWorktreesRootPath(sandboxRepo), { recursive: true });
    mkdirSync(configDir, { recursive: true });

    const runtimeConfig = createRuntimeConfig(sandboxRepo);
    const llmConfig: LLMProviderConfig = {
      mode: 'cli',
      model: 'cli-codex',
      cli: {
        command: 'codex',
        args: ['exec', '--skip-git-repo-check', '${PROMPT}'],
        timeoutMs: 120000,
      },
    };

    writeFileSync(path.join(configDir, 'runtime.json'), `${JSON.stringify(runtimeConfig, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(configDir, 'llm.json'), `${JSON.stringify(llmConfig, null, 2)}\n`, 'utf8');

    const partialReport = assessInitPrerequisites({
      repoRoot: sandboxRepo,
      uiOptions: codexAvailable,
      commandExistsFn: (command) => ['node', 'npm', 'git', 'just', 'codex', 'wt'].includes(command),
    });

    assert.equal(partialReport.localStatePresent, true);
    assert.equal(partialReport.repositoryInitialized, false);
    assert.equal(partialReport.summary, 'Repository has partial or damaged S2S state that can be repaired in place.');
    assert.ok(partialReport.setupChecks.some((check) => check.id === 'repository.managed_project_state'));
    assert.ok(partialReport.setupChecks.some((check) => check.id === 'repository.supporting_configs'));
    assert.ok(partialReport.setupChecks.some((check) => check.id === 'repository.guardrails_bundle'));
    assert.ok(partialReport.suggestedNextActions.some((action) => action.includes('repair the managed `.s2s` state')));

    writeFileSync(
      path.join(sandboxRepo, '.s2s', 'project.json'),
      `${JSON.stringify({ alias: 'demo-app', projectId: 'demo-app' }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(sandboxRepo, '.s2s', 'project.local.json'),
      `${JSON.stringify({ lastUsedAt: '2026-04-03T00:00:00.000Z', lastClient: 'codex-cli' }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(path.join(configDir, 'execution.templates.json'), '[]\n', 'utf8');
    writeFileSync(
      path.join(configDir, 'backup.policy.json'),
      `${JSON.stringify({ enabled: true }, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(
      path.join(configDir, 'governance.exceptions.json'),
      `${JSON.stringify({ exceptions: [] }, null, 2)}\n`,
      'utf8',
    );
    mkdirSync(path.join(sandboxRepo, '.s2s', 'guardrails'), { recursive: true });
    writeFileSync(path.join(sandboxRepo, '.s2s', 'guardrails', 'AGENTS.md'), '# agents\n', 'utf8');
    writeFileSync(path.join(sandboxRepo, '.s2s', 'guardrails', 'CODEX.md'), '# codex\n', 'utf8');
    writeFileSync(path.join(sandboxRepo, '.s2s', 'guardrails', 'CLAUDE.md'), '# claude\n', 'utf8');
    mkdirSync(path.join(sandboxRepo, '.s2s', 'scripts'), { recursive: true });
    writeFileSync(path.join(sandboxRepo, '.s2s', 'scripts', 'README.md'), '# scripts\n', 'utf8');
    mkdirSync(path.join(sandboxRepo, '.s2s', 'artifacts'), { recursive: true });
    mkdirSync(path.join(sandboxRepo, '.s2s', 'usage'), { recursive: true });
    mkdirSync(path.join(sandboxRepo, '.s2s', 'logs'), { recursive: true });
    mkdirSync(path.join(sandboxRepo, '.s2s', 'backups'), { recursive: true });
    writeFileSync(
      path.join(sandboxRepo, 'AGENTS.md'),
      '<!-- S2S_PROJECT_GUARDRAIL_START -->\nmanaged\n<!-- S2S_PROJECT_GUARDRAIL_END -->\n',
      'utf8',
    );
    writeFileSync(
      path.join(sandboxRepo, 'CODEX.md'),
      '<!-- S2S_CODEX_ADAPTER_START -->\nmanaged\n<!-- S2S_CODEX_ADAPTER_END -->\n',
      'utf8',
    );
    writeFileSync(
      path.join(sandboxRepo, 'CLAUDE.md'),
      '<!-- S2S_CLAUDE_ADAPTER_START -->\nmanaged\n<!-- S2S_CLAUDE_ADAPTER_END -->\n',
      'utf8',
    );

    const readyReport = assessInitPrerequisites({
      repoRoot: sandboxRepo,
      uiTarget: 'codex_cli',
      uiOptions: codexAvailable,
      commandExistsFn: (command) => ['node', 'npm', 'git', 'just', 'codex', 'wt'].includes(command),
    });

    assert.equal(readyReport.canInitialize, true);
    assert.equal(readyReport.ready, true);
    assert.equal(readyReport.status, 'ready');
    assert.equal(readyReport.localStatePresent, true);
    assert.equal(readyReport.repositoryInitialized, true);
    assert.equal(readyReport.blockingChecks.length, 0);
    assert.equal(readyReport.setupChecks.length, 0);
    assert.equal(readyReport.summary, 'Repository is initialized and ready for S2S with optional warnings.');
    assert.equal(readyReport.readinessChecklist.every((item) => item.ready), true);
    assert.ok(readyReport.suggestedNextActions.some((action) => action.includes('s2s stage pm')));
    assert.ok(readyReport.suggestedNextActions.some((action) => action.includes('s2s doctor')));
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(sandboxHome, { recursive: true, force: true });
    rmSync(sandboxRepo, { recursive: true, force: true });
  }

  console.log('Init prerequisite checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
