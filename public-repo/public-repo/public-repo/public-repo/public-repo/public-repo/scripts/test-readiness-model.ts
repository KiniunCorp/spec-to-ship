import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LLMProviderConfig, RuntimeConfig } from '../src/types/index.js';

function defaultWorktreesRootPath(repoRoot: string): string {
  const home = path.resolve(process.env.HOME || tmpdir());
  return path.join(home, '.s2s', 'worktrees', path.basename(repoRoot));
}

function createRuntimeConfig(repoRoot: string, projectRepoPath?: string, worktreesRootPath?: string): RuntimeConfig {
  return {
    productName: 'spec-to-ship',
    defaultBranch: 'main',
    guardrailPolicy: 'strict',
    workspace: {
      basePath: '.',
      orchestratorDirName: '.',
      projectDirName: 'demo-app',
      worktreesDirName: path.basename(worktreesRootPath || defaultWorktreesRootPath(repoRoot)),
      projectRepoPath,
      worktreesRootPath: worktreesRootPath || defaultWorktreesRootPath(repoRoot),
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
      allowedCommands: ['codex', 'claude', 'opencode', 'just', 'pnpm', 'node', 'git'],
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
  const { assessRuntimeReadiness, summarizeReadinessChecks } = await import('../src/index.js');
  const sandboxHome = mkdtempSync(path.join(tmpdir(), 's2s-readiness-home-'));
  const sandboxRepo = mkdtempSync(path.join(tmpdir(), 's2s-readiness-user-project-'));
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = sandboxHome;

    const alwaysAvailable = (command: string): boolean => ['node', 'npm', 'git', 'just', 'codex', 'wt'].includes(command);
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
    const codexUnavailable = [
      {
        id: 'codex_cli',
        label: 'Codex CLI',
        ui: 'codex',
        available: false,
        cliCommand: 'codex',
        notes: 'Not detected in terminal PATH.',
      },
    ];

    const sourceRepoReport = assessRuntimeReadiness({
      repoRoot: process.cwd(),
      runtimeConfig: createRuntimeConfig(process.cwd()),
      llmConfig: {
        mode: 'cli',
        model: 'cli-codex',
        cli: {
          command: 'codex',
          args: ['exec', '${PROMPT}'],
        },
      },
      uiOptions: codexAvailable,
      enabledFeatures: ['ui_target', 'llm_access'],
      commandExistsFn: alwaysAvailable,
    });

    assert.equal(sourceRepoReport.repository.status, 'blocked');
    assert.equal(sourceRepoReport.status, 'blocked');
    assert.ok(
      sourceRepoReport.checks.some(
        (check) => check.id === 'repository.supported_context' && check.status === 'blocked',
      ),
    );

    writeFileSync(path.join(sandboxRepo, 'package.json'), `${JSON.stringify({ name: 'demo-app' }, null, 2)}\n`, 'utf8');

    const actionRequiredReport = assessRuntimeReadiness({
      repoRoot: sandboxRepo,
      runtimeConfig: createRuntimeConfig(sandboxRepo),
      runtimeConfigPath: path.join(sandboxRepo, 'config', 'runtime.json'),
      llmConfigPath: path.join(sandboxRepo, 'config', 'llm.json'),
      uiOptions: codexUnavailable,
      enabledFeatures: ['ui_target', 'llm_access', 'workspace_bootstrap', 'worktree_worktrunk'],
      commandExistsFn: (command) => ['node', 'npm', 'git', 'just'].includes(command),
    });

    assert.equal(actionRequiredReport.machine.status, 'ready');
    assert.equal(actionRequiredReport.repository.status, 'action_required');
    assert.equal(actionRequiredReport.status, 'action_required');
    assert.equal(
      actionRequiredReport.features.find((feature) => feature.feature === 'workspace_bootstrap')?.status,
      'action_required',
    );
    assert.equal(
      actionRequiredReport.features.find((feature) => feature.feature === 'ui_target')?.status,
      'action_required',
    );
    assert.equal(
      actionRequiredReport.features.find((feature) => feature.feature === 'worktree_worktrunk')?.status,
      'action_required',
    );

    const appRepoPath = path.join(sandboxRepo, 'demo-app');
    const worktreesRootPath = defaultWorktreesRootPath(sandboxRepo);
    mkdirSync(path.join(sandboxRepo, 'config'), { recursive: true });
    mkdirSync(appRepoPath, { recursive: true });
    mkdirSync(worktreesRootPath, { recursive: true });

    const readyRuntimeConfig = createRuntimeConfig(sandboxRepo, appRepoPath, worktreesRootPath);
    const llmConfig: LLMProviderConfig = {
      mode: 'cli',
      model: 'cli-codex',
      cli: {
        command: 'codex',
        args: ['exec', '${PROMPT}'],
      },
    };

    writeFileSync(
      path.join(sandboxRepo, 'config', 'runtime.json'),
      `${JSON.stringify(readyRuntimeConfig, null, 2)}\n`,
      'utf8',
    );
    writeFileSync(path.join(sandboxRepo, 'config', 'llm.json'), `${JSON.stringify(llmConfig, null, 2)}\n`, 'utf8');

    const readyReport = assessRuntimeReadiness({
      repoRoot: sandboxRepo,
      runtimeConfig: readyRuntimeConfig,
      runtimeConfigPath: path.join(sandboxRepo, 'config', 'runtime.json'),
      llmConfig,
      llmConfigPath: path.join(sandboxRepo, 'config', 'llm.json'),
      uiTarget: 'codex_cli',
      uiOptions: codexAvailable,
      enabledFeatures: ['ui_target', 'llm_access', 'workspace_bootstrap', 'worktree_worktrunk'],
      commandExistsFn: alwaysAvailable,
    });

    assert.equal(readyReport.ready, true);
    assert.equal(readyReport.status, 'ready');
    assert.equal(readyReport.repository.status, 'ready');
    assert.equal(readyReport.machine.status, 'ready');
    assert.equal(
      readyReport.features.find((feature) => feature.feature === 'workspace_bootstrap')?.status,
      'ready',
    );
    assert.equal(
      readyReport.features.find((feature) => feature.feature === 'worktree_worktrunk')?.status,
      'ready',
    );

    const featureSummary = summarizeReadinessChecks(
      readyReport.checks.filter((check) => check.scope === 'feature' && check.status !== 'not_applicable'),
    );
    assert.equal(featureSummary.status, 'ready');
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(sandboxHome, { recursive: true, force: true });
    rmSync(sandboxRepo, { recursive: true, force: true });
  }

  console.log('Readiness model checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
