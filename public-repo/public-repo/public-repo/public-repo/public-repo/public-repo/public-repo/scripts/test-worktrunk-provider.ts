import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorktrunkWorktreeProvider } from '../src/runtime/worktree-provider-worktrunk.js';
import { runShell } from '../src/runtime/shell.js';
import type { WorktreeProviderConfig } from '../src/types/index.js';

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 's2s-worktrunk-provider-'));
  const originalHome = process.env.HOME;

  try {
    const repoRoot = path.join(root, 'repo');
    mkdirSync(repoRoot, { recursive: true });

    runShell('git', ['init', '-b', 'main'], repoRoot);
    runShell('git', ['config', 'user.name', 'SpecToShip Test'], repoRoot);
    runShell('git', ['config', 'user.email', 'test@example.com'], repoRoot);

    writeFileSync(path.join(repoRoot, 'README.md'), '# Worktrunk provider fixture\n', 'utf8');
    runShell('git', ['add', 'README.md'], repoRoot);
    runShell('git', ['commit', '-m', 'init'], repoRoot);

    const managedHome = path.join(root, 'managed-home');
    mkdirSync(managedHome, { recursive: true });
    process.env.HOME = managedHome;

    const defaultProvider = createWorktrunkWorktreeProvider({
      kind: 'worktrunk',
      repoRoot,
      defaultBranch: 'main',
    });
    const defaultRuntimePaths = defaultProvider.resolveRuntimePaths();
    assert.equal(defaultRuntimePaths.controlRoot, path.join(managedHome, '.s2s'));
    assert.equal(defaultRuntimePaths.worktreesRoot, path.join(managedHome, '.s2s', 'worktrees'));
    assert.equal(defaultRuntimePaths.repoWorktreesRoot, path.join(managedHome, '.s2s', 'worktrees', 'repo'));
    assert.equal(defaultRuntimePaths.runtimeRoot, path.join(managedHome, '.s2s', 'runtime'));

    const config: WorktreeProviderConfig = {
      kind: 'worktrunk',
      repoRoot,
      controlRoot: path.join(root, '.s2s'),
      defaultBranch: 'main',
    };

    const provider = createWorktrunkWorktreeProvider(config);
    const runtimePaths = provider.resolveRuntimePaths();
    const availability = await provider.checkAvailability();
    assert.equal(availability.available, true);
    assert.equal(runtimePaths.controlRoot, path.join(root, '.s2s'));
    assert.equal(runtimePaths.worktreesRoot, path.join(root, '.s2s', 'worktrees'));
    assert.equal(runtimePaths.runtimeRoot, path.join(root, '.s2s', 'runtime'));

    const session = await provider.ensureSession({
      repoRoot,
      branch: 'codex/test-session',
      changeId: 'change-123',
      sliceId: 'slice-123',
    });

    assert.equal(session.pathSegment, 'slice-123');
    assert.equal(realpathSync(session.worktreePath), realpathSync(path.join(runtimePaths.worktreesRoot, 'repo', 'slice-123')));
    assert.equal(existsSync(session.worktreePath), true);
    assert.equal(
      existsSync(path.join(runtimePaths.providerStateRoot, 'worktrunk.config.toml')),
      true,
    );

    const listed = await provider.listSessions({ branch: session.branch });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.sliceId, 'slice-123');
    assert.equal(realpathSync(String(listed[0]?.worktreePath || '')), realpathSync(session.worktreePath));

    const activeValidation = await provider.validateSession(session);
    assert.equal(activeValidation.state, 'active');
    assert.equal(activeValidation.requiredAction, 'resume');

    const reused = await provider.ensureSession({
      repoRoot,
      branch: session.branch,
      changeId: 'change-123',
      sliceId: 'slice-123',
      reuseExisting: true,
    });
    assert.equal(reused.worktreePath, session.worktreePath);

    const prSession = await provider.openPullRequestWorkspace({
      repoRoot,
      prNumber: 42,
      branch: 'codex/pr-session',
      changeId: 'change-123',
      url: 'https://example.com/pr/42',
    });

    assert.equal(prSession.purpose, 'pull_request');
    assert.equal(prSession.pullRequest?.number, 42);
    assert.equal(realpathSync(prSession.worktreePath), realpathSync(path.join(runtimePaths.worktreesRoot, 'repo', 'pr-42')));
    assert.equal(existsSync(prSession.worktreePath), true);

    const mergedPrValidation = await provider.validateSession({
      ...prSession,
      pullRequest: {
        ...prSession.pullRequest,
        state: 'merged',
      },
    });
    assert.equal(mergedPrValidation.state, 'integrated');
    assert.equal(mergedPrValidation.requiredAction, 'create_fresh_branch');

    const staleSession = await provider.ensureSession({
      repoRoot,
      branch: 'codex/stale-session',
      changeId: 'change-456',
      sliceId: 'slice-456',
    });
    writeFileSync(path.join(staleSession.worktreePath, 'stale.txt'), 'stale\n', 'utf8');
    runShell('git', ['add', 'stale.txt'], staleSession.worktreePath);
    runShell('git', ['commit', '-m', 'stale feature'], staleSession.worktreePath);

    writeFileSync(path.join(repoRoot, 'README.md'), '# Worktrunk provider fixture\nmain changed\n', 'utf8');
    runShell('git', ['add', 'README.md'], repoRoot);
    runShell('git', ['commit', '-m', 'main changed'], repoRoot);

    const staleValidation = await provider.validateSession(staleSession);
    assert.equal(staleValidation.state, 'stale');
    assert.equal(staleValidation.requiredAction, 'create_fresh_session');

    const staleListed = await provider.listSessions({ branch: staleSession.branch });
    assert.equal(staleListed[0]?.state, 'stale');

    const integratedSession = await provider.ensureSession({
      repoRoot,
      branch: 'codex/integrated-session',
      changeId: 'change-789',
      sliceId: 'slice-789',
    });

    writeFileSync(path.join(integratedSession.worktreePath, 'feature.txt'), 'hello\n', 'utf8');
    runShell('git', ['add', 'feature.txt'], integratedSession.worktreePath);
    runShell('git', ['commit', '-m', 'feature'], integratedSession.worktreePath);
    runShell('git', ['merge', '--ff-only', integratedSession.branch], repoRoot);

    const integratedValidation = await provider.validateSession(integratedSession);
    assert.equal(integratedValidation.state, 'integrated');
    assert.equal(integratedValidation.requiredAction, 'cleanup');

    await provider.removeSession(prSession, { force: true, removeBranch: true });
    assert.equal(existsSync(prSession.worktreePath), false);

    await provider.removeSession(staleSession, { force: true, removeBranch: true });
    assert.equal(existsSync(staleSession.worktreePath), false);

    await provider.removeSession(integratedSession, { force: true });
    assert.equal(existsSync(integratedSession.worktreePath), false);

    await provider.removeSession(session, { force: true });
    assert.equal(existsSync(session.worktreePath), false);

    console.log('Worktrunk provider check passed.');
  } finally {
    process.env.HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
