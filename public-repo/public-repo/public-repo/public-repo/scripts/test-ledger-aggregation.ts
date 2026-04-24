import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { OrchestrationDecisionRecord, WorkChange, WorkGate, WorkLedger, WorkRun, WorkSlice, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-ledger-aggregation-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      createChange,
      createGate,
      createRun,
      createSlice,
      createSpec,
      deriveLedger,
      getActiveChange,
      getActiveChangeId,
      getActiveSpec,
      getActiveSpecId,
      getLedger,
      ledgerExists,
      listBlockedChangeIds,
      listBlockedChanges,
      listPendingGateIds,
      listPendingGates,
      listRunIdsByStatus,
      listRunsByStatus,
      listSliceIdsByStatus,
      listSlicesByStatus,
      refreshLedger,
      requireActiveChange,
      requireActiveSpec,
      saveLedger,
    } = await import('../src/index.js');

    const baseDecision: OrchestrationDecisionRecord = {
      schemaVersion: 1,
      projectId: 'alpha',
      request: 'Preserve a single project ledger index.',
      decidedAt: '2026-04-02T05:30:00.000Z',
      decision: {
        intent: 'technical_refactor',
        rationale: 'Preserve a single project ledger index.',
        nextStage: 'engineering',
        recommendedStages: ['engineering'],
        requiresHumanApproval: false,
        createChange: true,
        createSpec: true,
        directToExecution: false,
        stageDecisions: [],
        skippedStages: ['pm', 'research', 'design', 'engineering_exec'],
      },
    };

    const changes: WorkChange[] = [
      {
        id: 'change-done',
        projectId: 'alpha',
        title: 'Closed change',
        summary: 'Historical work.',
        intent: 'technical_refactor',
        status: 'done',
        request: { summary: 'Completed work.', source: 'user' },
        scope: { inScope: ['docs'], outOfScope: [], acceptanceCriteria: ['history remains'] },
        stageStatus: {},
        blockerIds: [],
        createdAt: '2026-04-02T00:00:00.000Z',
        updatedAt: '2026-04-02T00:30:00.000Z',
        completedAt: '2026-04-02T00:30:00.000Z',
      },
      {
        id: 'change-blocked',
        projectId: 'alpha',
        title: 'Blocked change',
        summary: 'Currently blocked execution path.',
        intent: 'technical_refactor',
        status: 'blocked',
        request: { summary: 'Blocked work.', source: 'user' },
        scope: { inScope: ['src/ledger'], outOfScope: ['src/cli.ts'], acceptanceCriteria: ['unblock selection'] },
        currentStage: 'engineering',
        activeSpecId: 'spec-blocked-archived',
        stageStatus: { engineering: 'blocked' },
        blockerIds: ['external-approval'],
        createdAt: '2026-04-02T01:00:00.000Z',
        updatedAt: '2026-04-02T04:00:00.000Z',
      },
      {
        id: 'change-active',
        projectId: 'alpha',
        title: 'Active change',
        summary: 'A still-open but older change.',
        intent: 'implementation_only',
        status: 'active',
        request: { summary: 'Older open work.', source: 'user' },
        scope: { inScope: ['src/index.ts'], outOfScope: ['src/cli.ts'], acceptanceCriteria: ['keep exports stable'] },
        currentStage: 'engineering',
        activeSpecId: 'spec-active-1',
        stageStatus: { engineering: 'in_progress' },
        blockerIds: [],
        createdAt: '2026-04-02T02:00:00.000Z',
        updatedAt: '2026-04-02T03:00:00.000Z',
      },
      {
        id: 'change-draft',
        projectId: 'alpha',
        title: 'Draft change',
        summary: 'Newer draft that should not outrank open work.',
        intent: 'spec_revision',
        status: 'draft',
        request: { summary: 'Fresh draft.', source: 'user' },
        scope: { inScope: ['docs'], outOfScope: [], acceptanceCriteria: ['ready later'] },
        stageStatus: {},
        blockerIds: [],
        createdAt: '2026-04-02T03:00:00.000Z',
        updatedAt: '2026-04-02T05:00:00.000Z',
      },
    ];

    const specs: WorkSpec[] = [
      {
        id: 'spec-active-1',
        projectId: 'alpha',
        changeId: 'change-active',
        version: 1,
        title: 'Active spec',
        summary: 'Still open but not the current change.',
        status: 'approved',
        goals: ['keep active spec available'],
        constraints: [],
        acceptanceCriteria: ['selection prefers the active change'],
        sourceArtifacts: [],
        approvedAt: '2026-04-02T03:10:00.000Z',
        createdAt: '2026-04-02T02:10:00.000Z',
        updatedAt: '2026-04-02T03:10:00.000Z',
      },
      {
        id: 'spec-blocked-archived',
        projectId: 'alpha',
        changeId: 'change-blocked',
        version: 1,
        title: 'Archived spec',
        summary: 'Should be skipped even if linked from the change.',
        status: 'archived',
        goals: ['old version'],
        constraints: [],
        acceptanceCriteria: ['archived specs are ignored'],
        sourceArtifacts: [],
        createdAt: '2026-04-02T01:10:00.000Z',
        updatedAt: '2026-04-02T01:20:00.000Z',
      },
      {
        id: 'spec-blocked-2',
        projectId: 'alpha',
        changeId: 'change-blocked',
        version: 2,
        title: 'Current blocked spec',
        summary: 'Most recent open spec for the active change.',
        status: 'draft',
        goals: ['replace archived link'],
        constraints: ['stay compatible'],
        acceptanceCriteria: ['become the active spec'],
        sourceArtifacts: [],
        createdAt: '2026-04-02T01:30:00.000Z',
        updatedAt: '2026-04-02T04:10:00.000Z',
      },
    ];

    const slices: WorkSlice[] = [
      {
        id: 'slice-in-progress',
        projectId: 'alpha',
        changeId: 'change-blocked',
        specId: 'spec-blocked-2',
        title: 'Current execution',
        summary: 'Currently executing slice.',
        status: 'in_progress',
        sequence: 1,
        priority: 'high',
        size: 's',
        dependencyIds: [],
        blockers: [],
        taskRefs: ['P1-T5'],
        acceptanceChecks: ['typecheck'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-02T01:40:00.000Z',
        updatedAt: '2026-04-02T04:20:00.000Z',
      },
      {
        id: 'slice-ready',
        projectId: 'alpha',
        changeId: 'change-blocked',
        specId: 'spec-blocked-2',
        title: 'Queued follow-up',
        summary: 'Ready for later.',
        status: 'ready',
        sequence: 2,
        priority: 'medium',
        size: 's',
        dependencyIds: ['slice-in-progress'],
        blockers: [],
        taskRefs: ['P1-T5'],
        acceptanceChecks: ['ledger sync'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-02T01:50:00.000Z',
        updatedAt: '2026-04-02T04:30:00.000Z',
      },
      {
        id: 'slice-blocked',
        projectId: 'alpha',
        changeId: 'change-blocked',
        specId: 'spec-blocked-2',
        title: 'Blocked follow-up',
        summary: 'Waiting on review.',
        status: 'blocked',
        sequence: 3,
        priority: 'critical',
        size: 'm',
        dependencyIds: ['slice-ready'],
        blockers: ['qa-signoff'],
        taskRefs: ['P1-T5'],
        acceptanceChecks: ['human review'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-02T02:00:00.000Z',
        updatedAt: '2026-04-02T04:40:00.000Z',
      },
    ];

    const runs: WorkRun[] = [
      {
        id: 'run-created',
        projectId: 'alpha',
        changeId: 'change-blocked',
        specId: 'spec-blocked-2',
        sliceId: 'slice-ready',
        status: 'created',
        provider: 'codex',
        evidence: [],
        createdAt: '2026-04-02T02:05:00.000Z',
        updatedAt: '2026-04-02T04:45:00.000Z',
      },
      {
        id: 'run-blocked',
        projectId: 'alpha',
        changeId: 'change-blocked',
        specId: 'spec-blocked-2',
        sliceId: 'slice-blocked',
        status: 'blocked',
        provider: 'codex',
        resultSummary: 'Waiting on approval.',
        evidence: [],
        createdAt: '2026-04-02T02:10:00.000Z',
        updatedAt: '2026-04-02T04:50:00.000Z',
      },
      {
        id: 'run-succeeded',
        projectId: 'alpha',
        changeId: 'change-blocked',
        specId: 'spec-blocked-2',
        sliceId: 'slice-in-progress',
        status: 'succeeded',
        provider: 'codex',
        verificationPassed: true,
        evidence: [],
        createdAt: '2026-04-02T02:15:00.000Z',
        updatedAt: '2026-04-02T04:55:00.000Z',
        finishedAt: '2026-04-02T04:55:00.000Z',
      },
    ];

    const gates: WorkGate[] = [
      {
        id: 'gate-approved',
        projectId: 'alpha',
        changeId: 'change-active',
        type: 'spec_review',
        status: 'approved',
        title: 'Past approval',
        reason: 'Historical gate.',
        specId: 'spec-active-1',
        createdAt: '2026-04-02T02:20:00.000Z',
        updatedAt: '2026-04-02T03:15:00.000Z',
        resolvedAt: '2026-04-02T03:15:00.000Z',
      },
      {
        id: 'gate-pending-1',
        projectId: 'alpha',
        changeId: 'change-blocked',
        type: 'execution_review',
        status: 'pending',
        title: 'Execution review',
        reason: 'Need human approval before continuing.',
        specId: 'spec-blocked-2',
        sliceId: 'slice-blocked',
        createdAt: '2026-04-02T02:25:00.000Z',
        updatedAt: '2026-04-02T05:10:00.000Z',
      },
      {
        id: 'gate-pending-2',
        projectId: 'alpha',
        changeId: 'change-blocked',
        type: 'delivery_review',
        status: 'pending',
        title: 'Delivery review',
        reason: 'Second pending gate.',
        specId: 'spec-blocked-2',
        runId: 'run-blocked',
        createdAt: '2026-04-02T02:30:00.000Z',
        updatedAt: '2026-04-02T05:20:00.000Z',
      },
    ];

    for (const change of changes) createChange(change);
    for (const spec of specs) createSpec(spec);
    for (const slice of slices) createSlice(slice);
    for (const run of runs) createRun(run);
    for (const gate of gates) createGate(gate);

    saveLedger({
      projectId: 'alpha',
      changeIds: [],
      specIds: [],
      sliceIds: [],
      runIds: [],
      gateIds: [],
      pendingGateIds: [],
      blockedChangeIds: [],
      blockers: [],
      lastIntent: 'technical_refactor',
      lastDecision: baseDecision,
      sliceIdsByStatus: {},
      runIdsByStatus: {},
      updatedAt: '2026-04-02T05:30:00.000Z',
    });

    const derived = deriveLedger('alpha');

    assert.equal(derived.activeChangeId, 'change-blocked');
    assert.equal(derived.activeSpecId, 'spec-blocked-2');
    assert.deepEqual(derived.pendingGateIds, ['gate-pending-1', 'gate-pending-2']);
    assert.deepEqual(derived.blockedChangeIds, ['change-blocked']);
    assert.deepEqual(derived.sliceIdsByStatus.ready, ['slice-ready']);
    assert.deepEqual(derived.sliceIdsByStatus.in_progress, ['slice-in-progress']);
    assert.deepEqual(derived.sliceIdsByStatus.blocked, ['slice-blocked']);
    assert.deepEqual(derived.runIdsByStatus.created, ['run-created']);
    assert.deepEqual(derived.runIdsByStatus.blocked, ['run-blocked']);
    assert.deepEqual(derived.runIdsByStatus.succeeded, ['run-succeeded']);
    assert.deepEqual(derived.blockers, [
      'change:change-blocked',
      'external-approval',
      'slice:slice-blocked',
      'qa-signoff',
      'run:run-blocked',
      'gate:gate-pending-1',
      'gate:gate-pending-2',
    ]);
    assert.equal(derived.lastIntent, 'technical_refactor');
    assert.deepEqual(derived.lastDecision, baseDecision);
    assert.equal(derived.updatedAt, '2026-04-02T05:30:00.000Z');

    assert.equal(getActiveChangeId('alpha'), 'change-blocked');
    assert.equal(getActiveSpecId('alpha'), 'spec-blocked-2');
    assert.deepEqual(listPendingGateIds('alpha'), ['gate-pending-1', 'gate-pending-2']);
    assert.deepEqual(listBlockedChangeIds('alpha'), ['change-blocked']);
    assert.deepEqual(listSliceIdsByStatus('alpha', 'blocked'), ['slice-blocked']);
    assert.deepEqual(listRunIdsByStatus('alpha', 'blocked'), ['run-blocked']);

    assert.equal(getActiveChange('alpha')?.id, 'change-blocked');
    assert.equal(requireActiveChange('alpha').id, 'change-blocked');
    assert.equal(getActiveSpec('alpha')?.id, 'spec-blocked-2');
    assert.equal(requireActiveSpec('alpha').id, 'spec-blocked-2');
    assert.deepEqual(listPendingGates('alpha').map((gate) => gate.id), ['gate-pending-1', 'gate-pending-2']);
    assert.deepEqual(listBlockedChanges('alpha').map((change) => change.id), ['change-blocked']);
    assert.deepEqual(listSlicesByStatus('alpha', 'ready').map((slice) => slice.id), ['slice-ready']);
    assert.deepEqual(listRunsByStatus('alpha', 'succeeded').map((run) => run.id), ['run-succeeded']);

    const refreshed = refreshLedger('alpha', {
      updatedAt: '2026-04-02T06:00:00.000Z',
    });

    assert.equal(refreshed.updatedAt, '2026-04-02T06:00:00.000Z');
    assert.equal(refreshed.activeChangeId, 'change-blocked');
    assert.equal(refreshed.activeSpecId, 'spec-blocked-2');
    assert.deepEqual(refreshed.lastDecision, baseDecision);
    assert.deepEqual(getLedger('alpha'), refreshed);

    assert.equal(ledgerExists('beta'), false);
    const betaChange: WorkChange = {
      id: 'beta-change',
      projectId: 'beta',
      title: 'Only change',
      summary: 'Beta project.',
      intent: 'bug_fix',
      status: 'draft',
      request: { summary: 'Fix beta issue.', source: 'user' },
      scope: { inScope: ['src/ledger'], outOfScope: [], acceptanceCriteria: ['exists'] },
      stageStatus: {},
      blockerIds: [],
      createdAt: '2026-04-02T06:10:00.000Z',
      updatedAt: '2026-04-02T06:10:00.000Z',
    };
    const betaSpec: WorkSpec = {
      id: 'beta-spec',
      projectId: 'beta',
      changeId: 'beta-change',
      version: 1,
      title: 'Beta spec',
      summary: 'Beta project spec.',
      status: 'draft',
      goals: ['derive ledger'],
      constraints: [],
      acceptanceCriteria: ['ledger can be created'],
      sourceArtifacts: [],
      createdAt: '2026-04-02T06:15:00.000Z',
      updatedAt: '2026-04-02T06:15:00.000Z',
    };
    createChange(betaChange);
    createSpec(betaSpec);

    const betaLedger = refreshLedger('beta', {
      lastIntent: 'bug_fix',
      updatedAt: '2026-04-02T06:20:00.000Z',
    });

    assert.equal(betaLedger.activeChangeId, 'beta-change');
    assert.equal(betaLedger.activeSpecId, 'beta-spec');
    assert.equal(betaLedger.lastIntent, 'bug_fix');
    assert.equal(betaLedger.updatedAt, '2026-04-02T06:20:00.000Z');
    assert.equal(ledgerExists('beta'), true);

    let missingChangeError = '';
    try {
      requireActiveChange('gamma');
    } catch (error) {
      missingChangeError = String((error as Error)?.message || error || '');
    }
    assert.match(missingChangeError, /No active change exists/);

    let missingSpecError = '';
    try {
      requireActiveSpec('gamma');
    } catch (error) {
      missingSpecError = String((error as Error)?.message || error || '');
    }
    assert.match(missingSpecError, /No active spec exists/);

    console.log('Ledger aggregation helpers check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
