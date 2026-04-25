import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WorktreeProvider, WorktreeProviderConfig, WorktreeSessionRequest } from '../src/types/index.js';

async function main(): Promise<void> {
  const {
    buildWorktreeSessionId,
    createWorktreeProvider,
    deriveWorktreePathSegment,
    deriveWorktreeSessionPurpose,
    expandHomePath,
    normalizeWorktreeProviderConfig,
    providerSupportsCapability,
    resolveLocalS2SControlRoot,
    resolveLocalS2SRepoWorktreesRoot,
    resolveLocalS2SRuntimeRoot,
    resolveLocalS2SWorktreesRoot,
    resolveWorktreeProviderStateRoot,
    resolveWorktreeRuntimePaths,
    resolveWorktreeSessionPath,
  } = await import('../src/index.js');

  const sandboxHome = mkdtempSync(path.join(os.tmpdir(), 's2s-worktree-paths-home-'));
  const previousHome = process.env.HOME;

  try {
    process.env.HOME = sandboxHome;

    assert.equal(expandHomePath('~/runtime'), path.join(sandboxHome, 'runtime'));
    assert.equal(resolveLocalS2SControlRoot(), path.join(sandboxHome, '.s2s'));
    assert.equal(resolveLocalS2SRuntimeRoot(), path.join(sandboxHome, '.s2s', 'runtime'));
    assert.equal(resolveLocalS2SWorktreesRoot(), path.join(sandboxHome, '.s2s', 'worktrees'));
    assert.equal(
      resolveLocalS2SRepoWorktreesRoot({ repoRoot: './tmp/app-repo' }),
      path.join(sandboxHome, '.s2s', 'worktrees', 'app-repo'),
    );
    assert.equal(
      resolveWorktreeProviderStateRoot({
        kind: 'worktrunk',
        repoSlug: 'app-repo',
      }),
      path.join(sandboxHome, '.s2s', 'runtime', 'worktree-provider', 'worktrunk', 'app-repo'),
    );

    const config: WorktreeProviderConfig = {
      kind: 'worktrunk',
      repoRoot: './tmp/app-repo',
      defaultBranch: 'main',
      capabilities: ['centralized_paths', 'session_validation', 'pull_request_workspace'],
    };

    const normalized = normalizeWorktreeProviderConfig(config);
    assert.equal(path.isAbsolute(normalized.repoRoot), true);
    assert.equal(normalized.controlRoot, path.join(sandboxHome, '.s2s'));
    assert.equal(normalized.worktreesRoot, path.join(sandboxHome, '.s2s', 'worktrees'));
    assert.equal(normalized.repoSlug, 'app-repo');

    const paths = resolveWorktreeRuntimePaths(config);
    assert.equal(paths.repoSlug, 'app-repo');
    assert.equal(paths.runtimeRoot, path.join(paths.controlRoot, 'runtime'));
    assert.equal(paths.repoWorktreesRoot, path.join(paths.worktreesRoot, 'app-repo'));
    assert.equal(paths.providerStateRoot, path.join(paths.runtimeRoot, 'worktree-provider', 'worktrunk', 'app-repo'));

    const tildeConfig = normalizeWorktreeProviderConfig({
      ...config,
      controlRoot: '~/.spec-to-ship',
      worktreesRoot: '~/managed-worktrees',
    });
    assert.equal(tildeConfig.controlRoot, path.join(sandboxHome, '.spec-to-ship'));
    assert.equal(tildeConfig.worktreesRoot, path.join(sandboxHome, 'managed-worktrees'));

    const sessionRequest: WorktreeSessionRequest = {
      repoRoot: normalized.repoRoot,
      branch: 's2s-codex/change-123',
      changeId: 'change-123',
      sliceId: 'slice-123',
    };

    assert.equal(deriveWorktreeSessionPurpose(sessionRequest), 'change');
    assert.equal(deriveWorktreePathSegment(sessionRequest), 'slice-123');
    assert.equal(resolveWorktreeSessionPath(config, sessionRequest), path.join(paths.repoWorktreesRoot, 'slice-123'));
    assert.equal(
      buildWorktreeSessionId(config.kind, normalized, sessionRequest),
      'worktrunk:app-repo:slice-123:s2s-codex-change-123',
    );

    const provider = createWorktreeProvider(config, {
      worktrunk: (resolvedConfig): WorktreeProvider => ({
        kind: resolvedConfig.kind,
        config: resolvedConfig,
        getCapabilities: () => resolvedConfig.capabilities || [],
        checkAvailability: async () => ({ available: true, version: '1.0.0' }),
        resolveRuntimePaths: () => resolveWorktreeRuntimePaths(resolvedConfig),
        resolveSessionPath: (request) => resolveWorktreeSessionPath(resolvedConfig, request),
        ensureSession: async (request) => ({
          id: buildWorktreeSessionId(resolvedConfig.kind, resolvedConfig, request),
          provider: resolvedConfig.kind,
          repoRoot: resolvedConfig.repoRoot,
          baseBranch: request.baseBranch || resolvedConfig.defaultBranch,
          branch: request.branch,
          worktreePath: resolveWorktreeSessionPath(resolvedConfig, request),
          pathSegment: deriveWorktreePathSegment(request),
          state: 'active',
          isResumable: true,
          purpose: deriveWorktreeSessionPurpose(request),
          changeId: request.changeId,
          sliceId: request.sliceId,
          runId: request.runId,
          createdAt: '2026-04-02T00:00:00.000Z',
          updatedAt: '2026-04-02T00:00:00.000Z',
        }),
        switchToSession: async () => undefined,
        listSessions: async () => [],
        removeSession: async () => undefined,
        validateSession: async (session) => ({
          sessionId: session.id,
          state: session.state,
          isResumable: session.isResumable,
          checkedAt: '2026-04-02T00:00:00.000Z',
          requiredAction: 'resume',
        }),
        openPullRequestWorkspace: async (request) => ({
          id: `pr:${request.prNumber}`,
          provider: resolvedConfig.kind,
          repoRoot: resolvedConfig.repoRoot,
          baseBranch: request.baseBranch || resolvedConfig.defaultBranch,
          branch: request.branch,
          worktreePath: resolveWorktreeSessionPath(resolvedConfig, {
            repoRoot: request.repoRoot,
            branch: request.branch,
            preferredPathSegment: `pr-${request.prNumber}`,
            purpose: 'pull_request',
            changeId: request.changeId,
            sliceId: request.sliceId,
            runId: request.runId,
          }),
          pathSegment: `pr-${request.prNumber}`,
          state: 'active',
          isResumable: true,
          purpose: 'pull_request',
          changeId: request.changeId,
          sliceId: request.sliceId,
          runId: request.runId,
          pullRequest: {
            number: request.prNumber,
            url: request.url,
            state: 'open',
          },
          createdAt: '2026-04-02T00:00:00.000Z',
          updatedAt: '2026-04-02T00:00:00.000Z',
        }),
      }),
    });

    assert.equal(providerSupportsCapability(provider, 'pull_request_workspace'), true);
    assert.equal(provider.resolveSessionPath(sessionRequest), path.join(paths.repoWorktreesRoot, 'slice-123'));

    const ensured = await provider.ensureSession({
      ...sessionRequest,
      baseBranch: 'main',
    });
    assert.equal(ensured.state, 'active');
    assert.equal(ensured.pathSegment, 'slice-123');

    const validation = await provider.validateSession(ensured);
    assert.equal(validation.requiredAction, 'resume');

    const prWorkspace = await provider.openPullRequestWorkspace?.({
      repoRoot: normalized.repoRoot,
      prNumber: 42,
      branch: 's2s-codex/change-123',
      changeId: 'change-123',
      sliceId: 'slice-123',
      url: 'https://example.com/pr/42',
    });
    assert.equal(prWorkspace?.purpose, 'pull_request');
    assert.equal(prWorkspace?.pullRequest?.number, 42);

    assert.throws(
      () => createWorktreeProvider({ ...config, kind: 'native' }, { worktrunk: () => provider }),
      /Worktree provider 'native' is not registered/,
    );
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(sandboxHome, { recursive: true, force: true });
  }

  console.log('Worktree provider contract check passed.');
}

await main();
