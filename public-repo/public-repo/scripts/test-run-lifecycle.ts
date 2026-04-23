import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkChange, WorkSlice, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-run-lifecycle-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      buildExecutionTraceabilityRecord,
      completeExecutionRun,
      createChange,
      createExecutionRun,
      createSlice,
      createSpec,
      derivePersistedRunId,
      getRun,
      getSlice,
      listRunsByStatus,
      listSliceIdsByStatus,
      markExecutionRunVerifying,
      startExecutionRun,
    } = await import('../src/index.js');

    const projectId = 'alpha';
    const change: WorkChange = {
      id: 'change-alpha',
      projectId,
      title: 'Run lifecycle',
      summary: 'Record execution runs against explicit persisted slices.',
      intent: 'implementation_only',
      status: 'active',
      request: { summary: 'Persist execution run state.', source: 'user' },
      scope: {
        inScope: ['src/runtime', 'src/ledger'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['run lifecycle updates are persisted'],
      },
      currentStage: 'engineering_exec',
      activeSpecId: 'spec-alpha-1',
      stageStatus: {
        engineering: 'done',
        engineering_exec: 'ready',
      },
      blockerIds: [],
      createdAt: '2026-04-04T20:00:00.000Z',
      updatedAt: '2026-04-04T20:00:00.000Z',
    };

    const spec: WorkSpec = {
      id: 'spec-alpha-1',
      projectId,
      changeId: change.id,
      version: 1,
      title: 'Slice execution lifecycle',
      summary: 'Keep run and slice state aligned.',
      status: 'approved',
      goals: ['bind runs to stored slice IDs'],
      constraints: ['do not reintroduce backlog-first selection'],
      acceptanceCriteria: ['run records and slice status stay aligned'],
      sourceArtifacts: [],
      approvedAt: '2026-04-04T20:05:00.000Z',
      createdAt: '2026-04-04T20:00:00.000Z',
      updatedAt: '2026-04-04T20:05:00.000Z',
    };

    const readySlice: WorkSlice = {
      id: 'slice-spec-alpha-1-ready-core',
      projectId,
      changeId: change.id,
      specId: spec.id,
      title: 'Ready slice',
      summary: 'A ready slice that should move to done.',
      status: 'ready',
      sequence: 1,
      priority: 'high',
      size: 's',
      dependencyIds: [],
      blockers: [],
      taskRefs: ['P6-T2'],
      acceptanceChecks: ['run state recorded'],
      allowedPaths: ['src/runtime', 'src/ledger'],
      outOfScopePaths: ['src/cli.ts'],
      relatedArtifacts: [],
      createdAt: '2026-04-04T20:10:00.000Z',
      updatedAt: '2026-04-04T20:10:00.000Z',
    };

    const blockedSlice: WorkSlice = {
      id: 'slice-spec-alpha-1-blocked-follow-up',
      projectId,
      changeId: change.id,
      specId: spec.id,
      title: 'Blocked slice',
      summary: 'A blocked slice that should re-enter execution and then fail.',
      status: 'blocked',
      sequence: 2,
      priority: 'medium',
      size: 's',
      dependencyIds: [readySlice.id],
      blockers: ['needs-runtime-fix'],
      taskRefs: ['P6-T2'],
      acceptanceChecks: ['blocked runs stay resumable'],
      allowedPaths: ['src/runtime', 'src/ledger'],
      outOfScopePaths: ['src/cli.ts'],
      relatedArtifacts: [],
      createdAt: '2026-04-04T20:11:00.000Z',
      updatedAt: '2026-04-04T20:11:00.000Z',
    };

    createChange(change);
    createSpec(spec);
    createSlice(readySlice);
    createSlice(blockedSlice);

    const created = createExecutionRun(projectId, readySlice.id, {
      provider: 'codex',
      createdAt: '2026-04-04T20:12:00.000Z',
      resultSummary: 'Created first execution run.',
    });
    assert.equal(created.run.id, derivePersistedRunId(readySlice.id, 1));
    assert.equal(created.run.status, 'created');
    assert.deepEqual(created.ledger.runIdsByStatus.created, [created.run.id]);

    assert.throws(
      () =>
        createExecutionRun(projectId, readySlice.id, {
          provider: 'codex',
        }),
      /already has an open run/,
    );

    const running = startExecutionRun(projectId, created.run.id, {
      updatedAt: '2026-04-04T20:13:00.000Z',
      branchName: 's2s-codex/change-alpha',
      worktreePath: '/tmp/s2s/worktrees/change-alpha',
    });
    assert.equal(running.run.status, 'running');
    assert.equal(running.slice.status, 'in_progress');
    assert.equal(getSlice(projectId, readySlice.id)?.status, 'in_progress');
    assert.equal(running.run.worktreePath, '/tmp/s2s/worktrees/change-alpha');

    const verifying = markExecutionRunVerifying(projectId, created.run.id, {
      updatedAt: '2026-04-04T20:14:00.000Z',
      evidence: [{ kind: 'markdown', path: '.s2s/artifacts/alpha/EngineeringVerifyOutput.md', summary: 'verify' }],
    });
    assert.equal(verifying.run.status, 'verifying');
    assert.equal(verifying.slice.status, 'in_progress');
    assert.equal(verifying.run.evidence.length, 1);

    const succeeded = completeExecutionRun(projectId, created.run.id, 'succeeded', {
      updatedAt: '2026-04-04T20:15:00.000Z',
      branchName: 's2s-codex/change-alpha',
      worktreePath: '/tmp/s2s/worktrees/change-alpha',
      pullRequestNumber: 66,
      pullRequestUrl: 'https://example.test/pr/66',
      reusedPullRequest: true,
      requiredFreshBranch: false,
      verificationPassed: true,
      resultSummary: 'Verification passed.',
    });
    assert.equal(succeeded.run.status, 'succeeded');
    assert.equal(succeeded.run.pullRequestNumber, 66);
    assert.equal(succeeded.run.pullRequestUrl, 'https://example.test/pr/66');
    assert.equal(succeeded.run.worktreePath, '/tmp/s2s/worktrees/change-alpha');
    assert.equal(succeeded.run.reusedPullRequest, true);
    assert.equal(succeeded.run.requiredFreshBranch, false);
    assert.equal(succeeded.run.verificationPassed, true);
    assert.equal(succeeded.slice.status, 'done');
    assert.equal(getSlice(projectId, readySlice.id)?.completedAt, '2026-04-04T20:15:00.000Z');
    assert.deepEqual(listRunsByStatus(projectId, 'succeeded').map((run) => run.id), [created.run.id]);
    assert.deepEqual(listSliceIdsByStatus(projectId, 'done'), [readySlice.id]);

    const traceability = buildExecutionTraceabilityRecord(projectId, created.run.id);
    assert.equal(traceability.request.summary, change.request.summary);
    assert.equal(traceability.change.id, change.id);
    assert.equal(traceability.spec.id, spec.id);
    assert.equal(traceability.slice.id, readySlice.id);
    assert.equal(traceability.run.id, created.run.id);
    assert.equal(traceability.run.worktreePath, '/tmp/s2s/worktrees/change-alpha');
    assert.match(traceability.chain[5] || '', /Worktree/);
    assert.match(traceability.chain[6] || '', /PR #66/);

    const blockedCreated = createExecutionRun(projectId, blockedSlice.id, {
      provider: 'codex',
      createdAt: '2026-04-04T20:16:00.000Z',
    });
    assert.equal(blockedCreated.run.id, derivePersistedRunId(blockedSlice.id, 1));

    const blockedRunning = startExecutionRun(projectId, blockedCreated.run.id, {
      updatedAt: '2026-04-04T20:17:00.000Z',
    });
    assert.equal(blockedRunning.slice.status, 'in_progress');

    const failed = completeExecutionRun(projectId, blockedCreated.run.id, 'failed', {
      updatedAt: '2026-04-04T20:18:00.000Z',
      worktreePath: '/tmp/s2s/worktrees/change-alpha-2',
      pullRequestNumber: 77,
      pullRequestUrl: 'https://example.test/pr/77',
      reusedPullRequest: false,
      requiredFreshBranch: true,
      verificationPassed: false,
      resultSummary: 'Verification failed.',
    });
    assert.equal(failed.run.status, 'failed');
    assert.equal(failed.run.pullRequestNumber, 77);
    assert.equal(failed.run.pullRequestUrl, 'https://example.test/pr/77');
    assert.equal(failed.run.worktreePath, '/tmp/s2s/worktrees/change-alpha-2');
    assert.equal(failed.run.reusedPullRequest, false);
    assert.equal(failed.run.requiredFreshBranch, true);
    assert.equal(failed.run.verificationPassed, false);
    assert.equal(failed.slice.status, 'blocked');
    assert.equal(getRun(projectId, blockedCreated.run.id)?.finishedAt, '2026-04-04T20:18:00.000Z');

    const retry = createExecutionRun(projectId, blockedSlice.id, {
      provider: 'codex',
      createdAt: '2026-04-04T20:19:00.000Z',
    });
    assert.equal(retry.run.id, derivePersistedRunId(blockedSlice.id, 2));
    assert.equal(retry.run.status, 'created');

    console.log('Run lifecycle contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
