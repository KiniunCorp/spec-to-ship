import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimeConfig } from '../src/types/index.js';

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
  const { assessLightweightPrerequisites } = await import('../src/index.js');
  const sandboxHome = mkdtempSync(path.join(tmpdir(), 's2s-lightweight-prereqs-home-'));
  const sandboxRepo = mkdtempSync(path.join(tmpdir(), 's2s-lightweight-prereqs-user-project-'));
  const previousHome = process.env.HOME;
  const alwaysAvailable = (command: string): boolean => ['node', 'npm', 'git', 'just', 'gh'].includes(command);

  try {
    process.env.HOME = sandboxHome;

    const sourceRepoReport = assessLightweightPrerequisites({
      repoRoot: process.cwd(),
      commandExistsFn: alwaysAvailable,
    });

    assert.equal(sourceRepoReport.status, 'blocked');
    assert.equal(sourceRepoReport.localStatePresent, false);
    assert.equal(sourceRepoReport.repositoryInitialized, false);
    assert.equal(sourceRepoReport.recommendedCommand, undefined);
    assert.deepEqual(sourceRepoReport.readiness.enabledFeatures, ['workspace_bootstrap']);
    assert.match(sourceRepoReport.summary, /not eligible for s2s initialization/i);
    assert.ok(sourceRepoReport.blockingChecks.some((check) => check.id === 'repository.supported_context'));

    writeFileSync(path.join(sandboxRepo, 'package.json'), `${JSON.stringify({ name: 'demo-app' }, null, 2)}\n`, 'utf8');

    const initRequiredReport = assessLightweightPrerequisites({
      repoRoot: sandboxRepo,
      commandExistsFn: alwaysAvailable,
    });

    assert.equal(initRequiredReport.status, 'action_required');
    assert.equal(initRequiredReport.localStatePresent, false);
    assert.equal(initRequiredReport.repositoryInitialized, false);
    assert.equal(initRequiredReport.recommendedCommand, 's2s init');
    assert.deepEqual(initRequiredReport.readiness.enabledFeatures, ['workspace_bootstrap']);
    assert.equal(initRequiredReport.readiness.features.length, 1);
    assert.match(initRequiredReport.summary, /not initialized for s2s yet/i);
    assert.ok(initRequiredReport.actionRequiredChecks.some((check) => check.id === 'repository.runtime_config'));
    assert.ok(initRequiredReport.pendingActions.some((action) => action.includes('Run s2s init')));

    const appRepoPath = path.join(sandboxRepo, 'demo-app');
    const worktreesRootPath = defaultWorktreesRootPath(sandboxRepo);
    mkdirSync(path.join(sandboxRepo, '.s2s', 'config'), { recursive: true });
    mkdirSync(appRepoPath, { recursive: true });
    mkdirSync(worktreesRootPath, { recursive: true });

    const readyRuntimeConfig = createRuntimeConfig(sandboxRepo, appRepoPath, worktreesRootPath);
    writeFileSync(
      path.join(sandboxRepo, '.s2s', 'config', 'runtime.json'),
      `${JSON.stringify(readyRuntimeConfig, null, 2)}\n`,
      'utf8',
    );

    const readyReport = assessLightweightPrerequisites({
      repoRoot: sandboxRepo,
      commandExistsFn: alwaysAvailable,
    });

    assert.equal(readyReport.ready, true);
    assert.equal(readyReport.status, 'ready');
    assert.equal(readyReport.localStatePresent, true);
    assert.equal(readyReport.repositoryInitialized, true);
    assert.equal(readyReport.recommendedCommand, 's2s stage pm');
    assert.equal(readyReport.blockingChecks.length, 0);
    assert.equal(readyReport.actionRequiredChecks.length, 0);
    assert.match(readyReport.summary, /passed lightweight prerequisite checks/i);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(sandboxHome, { recursive: true, force: true });
    rmSync(sandboxRepo, { recursive: true, force: true });
  }

  console.log('Lightweight prerequisite checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
