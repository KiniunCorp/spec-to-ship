import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { WorktreeProviderConfig, WorktreeSessionRequest } from '../src/types/index.js';
import { createNativeWorktreeProvider, providerSupportsCapability } from '../src/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-native-worktree-'));
  try {
    const repoRoot = path.join(sandbox, 'repo');
    const controlRoot = path.join(sandbox, '.s2s');
    const worktreesRoot = path.join(controlRoot, 'worktrees');
    mkdirSync(repoRoot, { recursive: true });

    initRepo(repoRoot);

    const config: WorktreeProviderConfig = {
      kind: 'native',
      repoRoot,
      controlRoot,
      defaultBranch: 'main',
    };

    const provider = createNativeWorktreeProvider(config);
    const runtimePaths = provider.resolveRuntimePaths();
    const availability = await provider.checkAvailability();
    assert.equal(availability.available, true);
    assert.equal(Boolean(availability.version), true);
    assert.equal(providerSupportsCapability(provider, 'list_sessions'), true);
    assert.equal(providerSupportsCapability(provider, 'session_validation'), true);
    assert.equal(providerSupportsCapability(provider, 'pull_request_workspace'), false);
    assert.equal(runtimePaths.controlRoot, controlRoot);
    assert.equal(runtimePaths.worktreesRoot, worktreesRoot);
    assert.equal(runtimePaths.runtimeRoot, path.join(controlRoot, 'runtime'));

    const missingBinaryProvider = createNativeWorktreeProvider({
      ...config,
      binaryPath: path.join(sandbox, 'missing-git'),
    });
    const missingBinaryAvailability = await missingBinaryProvider.checkAvailability();
    assert.equal(missingBinaryAvailability.available, false);

    const request: WorktreeSessionRequest = {
      repoRoot,
      branch: 's2s-native/change-123',
      baseBranch: 'main',
      changeId: 'change-123',
      sliceId: 'slice-123',
      runId: 'run-123',
    };

    const session = await provider.ensureSession(request);
    assert.equal(session.provider, 'native');
    assert.equal(session.state, 'active');
    assert.equal(session.isResumable, true);
    assert.equal(session.pathSegment, 'slice-123');
    assert.equal(
      realpathSync(session.worktreePath),
      realpathSync(path.join(runtimePaths.worktreesRoot, path.basename(repoRoot), 'slice-123')),
    );
    assert.equal(
      readFileSync(path.join(runtimePaths.providerStateRoot, 'slice-123.json'), 'utf8')
        .includes('"changeId": "change-123"'),
      true,
    );

    const reused = await provider.ensureSession(request);
    assert.equal(reused.id, session.id);
    assert.equal(reused.worktreePath, session.worktreePath);

    const listed = await provider.listSessions({ branch: request.branch });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.changeId, 'change-123');
    assert.equal(listed[0]?.sliceId, 'slice-123');

    await provider.switchToSession(session);
    const validation = await provider.validateSession(session);
    assert.equal(validation.state, 'active');
    assert.equal(validation.requiredAction, 'resume');

    const mergedPrValidation = await provider.validateSession({
      ...session,
      pullRequest: {
        number: 7,
        state: 'merged',
      },
    });
    assert.equal(mergedPrValidation.state, 'integrated');
    assert.equal(mergedPrValidation.requiredAction, 'create_fresh_branch');

    const staleSession = await provider.ensureSession({
      repoRoot,
      branch: 's2s-native/stale-123',
      baseBranch: 'main',
      changeId: 'stale-123',
      sliceId: 'slice-stale',
    });
    writeFileSync(path.join(staleSession.worktreePath, 'stale.txt'), 'stale\n', 'utf8');
    mustRun('git', ['add', 'stale.txt'], staleSession.worktreePath);
    mustRun('git', ['commit', '-m', 'feat: stale branch'], staleSession.worktreePath);
    writeFileSync(path.join(repoRoot, 'README.md'), '# sandbox\nmain changed\n', 'utf8');
    mustRun('git', ['add', 'README.md'], repoRoot);
    mustRun('git', ['commit', '-m', 'chore: main changed'], repoRoot);

    const staleValidation = await provider.validateSession(staleSession);
    assert.equal(staleValidation.state, 'stale');
    assert.equal(staleValidation.requiredAction, 'create_fresh_session');

    const staleListed = await provider.listSessions({ state: 'stale' });
    assert.equal(staleListed.some((candidate) => candidate.id === staleSession.id), true);

    const integratedSession = await provider.ensureSession({
      repoRoot,
      branch: 's2s-native/integrated-123',
      baseBranch: 'main',
      changeId: 'integrated-123',
      sliceId: 'slice-integrated',
    });
    writeFileSync(path.join(integratedSession.worktreePath, 'integrated.txt'), 'integrated\n', 'utf8');
    mustRun('git', ['add', 'integrated.txt'], integratedSession.worktreePath);
    mustRun('git', ['commit', '-m', 'feat: integrated branch'], integratedSession.worktreePath);
    mustRun('git', ['merge', '--ff-only', integratedSession.branch], repoRoot);

    const integratedValidation = await provider.validateSession(integratedSession);
    assert.equal(integratedValidation.state, 'integrated');
    assert.equal(integratedValidation.requiredAction, 'cleanup');

    const integratedListed = await provider.listSessions({ state: 'integrated' });
    assert.equal(integratedListed.some((candidate) => candidate.id === integratedSession.id), true);

    const manualBranch = 's2s-native/manual-conflict';
    const manualPath = path.join(sandbox, 'manual-conflict');
    mustRun('git', ['branch', manualBranch, 'main'], repoRoot);
    mustRun('git', ['worktree', 'add', manualPath, manualBranch], repoRoot);
    await assert.rejects(
      provider.ensureSession({
        repoRoot,
        branch: manualBranch,
        changeId: 'manual-conflict',
      }),
      /already checked out/,
    );

    await provider.removeSession(staleSession, { force: true, removeBranch: true });
    assert.equal(existsSync(staleSession.worktreePath), false);

    await provider.removeSession(integratedSession, { force: true, removeBranch: true });
    assert.equal(existsSync(integratedSession.worktreePath), false);

    await provider.removeSession(session, { force: true, removeBranch: true });
    assert.equal(existsSync(session.worktreePath), false);
    const missingValidation = await provider.validateSession(session);
    assert.equal(missingValidation.state, 'missing');
    assert.equal(missingValidation.requiredAction, 'create_session');

    mustRun('git', ['worktree', 'remove', '--force', manualPath], repoRoot);

    console.log('Native worktree provider check passed.');
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function initRepo(repoRoot: string): void {
  mustRun('git', ['init', '-b', 'main'], repoRoot);
  mustRun('git', ['config', 'user.name', 'S2S Test'], repoRoot);
  mustRun('git', ['config', 'user.email', 's2s-test@example.com'], repoRoot);
  writeFileSync(path.join(repoRoot, 'README.md'), '# sandbox\n', 'utf8');
  mustRun('git', ['add', '.'], repoRoot);
  mustRun('git', ['commit', '-m', 'chore: init sandbox'], repoRoot);
}

function mustRun(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')} (${String(result.stderr || result.stdout || '').trim()})`);
  }
}

await main();
