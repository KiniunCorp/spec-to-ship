import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkChange, WorkSlice, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-gate-lifecycle-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      approveGate,
      cancelGate,
      createChange,
      createExecutionRun,
      createSlice,
      createSpec,
      createWorkGate,
      getChange,
      getGate,
      getSpec,
      listPendingGateIds,
      rejectGate,
      startExecutionRun,
    } = await import('../src/index.js');

    const projectId = 'alpha';
    const change: WorkChange = {
      id: 'change-alpha',
      projectId,
      title: 'Gate lifecycle',
      summary: 'Keep minimal review gates explicit and persisted.',
      intent: 'feature_refinement',
      status: 'active',
      request: { summary: 'Add minimal gate lifecycle support.', source: 'user' },
      scope: {
        inScope: ['src/ledger', 'src/types'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['gates can be created and resolved'],
      },
      currentStage: 'engineering',
      activeSpecId: 'spec-alpha-1',
      stageStatus: {
        engineering: 'done',
      },
      blockerIds: [],
      createdAt: '2026-04-06T14:00:00.000Z',
      updatedAt: '2026-04-06T14:00:00.000Z',
    };

    const spec: WorkSpec = {
      id: 'spec-alpha-1',
      projectId,
      changeId: change.id,
      version: 1,
      title: 'Gate lifecycle spec',
      summary: 'Support minimal review gates in the ledger.',
      status: 'active',
      goals: ['gate lifecycle is persisted'],
      constraints: ['do not add CLI flows yet'],
      acceptanceCriteria: ['all gate types can be resolved'],
      sourceArtifacts: [],
      createdAt: '2026-04-06T14:01:00.000Z',
      updatedAt: '2026-04-06T14:01:00.000Z',
    };

    const slice: WorkSlice = {
      id: 'slice-alpha-1',
      projectId,
      changeId: change.id,
      specId: spec.id,
      title: 'Minimal gate implementation',
      summary: 'Persist minimal review gates.',
      status: 'ready',
      sequence: 1,
      priority: 'high',
      size: 's',
      dependencyIds: [],
      blockers: [],
      taskRefs: ['P11-T3'],
      acceptanceChecks: ['gate lifecycle test passes'],
      allowedPaths: ['src/ledger', 'src/types'],
      outOfScopePaths: ['src/cli.ts'],
      relatedArtifacts: [],
      createdAt: '2026-04-06T14:02:00.000Z',
      updatedAt: '2026-04-06T14:02:00.000Z',
    };

    createChange(change);
    createSpec(spec);
    createSlice(slice);

    const specReview = createWorkGate(projectId, {
      changeId: change.id,
      type: 'spec_review',
      title: 'Approve updated spec',
      reason: 'PM review is required before engineering continues.',
      specId: spec.id,
      createdAt: '2026-04-06T14:05:00.000Z',
    });
    assert.equal(specReview.change.status, 'in_review');
    assert.equal(specReview.spec?.status, 'review_ready');
    assert.equal(specReview.gate.status, 'pending');
    assert.deepEqual(listPendingGateIds(projectId), [specReview.gate.id]);
    assert.throws(
      () =>
        createWorkGate(projectId, {
          changeId: change.id,
          type: 'spec_review',
          title: 'Approve updated spec',
          reason: 'Duplicate gate should fail.',
          specId: spec.id,
        }),
      /already exists/,
    );

    const specApproved = approveGate(projectId, specReview.gate.id, {
      actor: 'pm',
      note: 'Scope is approved.',
      decidedAt: '2026-04-06T14:06:00.000Z',
    });
    assert.equal(specApproved.change.status, 'active');
    assert.equal(specApproved.spec?.status, 'approved');
    assert.equal(specApproved.spec?.approvedAt, '2026-04-06T14:06:00.000Z');
    assert.equal(specApproved.gate.status, 'approved');
    assert.equal(specApproved.gate.decision?.actor, 'pm');
    assert.deepEqual(listPendingGateIds(projectId), []);

    const executionReview = createWorkGate(projectId, {
      changeId: change.id,
      type: 'execution_review',
      title: 'Approve execution handoff',
      reason: 'Execution should wait for explicit approval.',
      sliceId: slice.id,
      createdAt: '2026-04-06T14:07:00.000Z',
    });
    assert.equal(executionReview.change.status, 'in_review');
    assert.equal(executionReview.slice?.id, slice.id);

    const executionCancelled = cancelGate(projectId, executionReview.gate.id, {
      decidedAt: '2026-04-06T14:08:00.000Z',
      note: 'Approval was no longer required.',
    });
    assert.equal(executionCancelled.change.status, 'active');
    assert.equal(executionCancelled.gate.status, 'cancelled');

    const runCreated = createExecutionRun(projectId, slice.id, {
      provider: 'codex',
      createdAt: '2026-04-06T14:09:00.000Z',
    });
    const runStarted = startExecutionRun(projectId, runCreated.run.id, {
      updatedAt: '2026-04-06T14:10:00.000Z',
    });
    assert.equal(runStarted.run.status, 'running');

    const deliveryReview = createWorkGate(projectId, {
      changeId: change.id,
      type: 'delivery_review',
      title: 'Review delivery outcome',
      reason: 'Delivery needs a human decision.',
      runId: runCreated.run.id,
      createdAt: '2026-04-06T14:11:00.000Z',
    });
    assert.equal(deliveryReview.gate.runId, runCreated.run.id);
    assert.equal(deliveryReview.change.status, 'in_review');

    const deliveryRejected = rejectGate(projectId, deliveryReview.gate.id, {
      actor: 'qa',
      note: 'Ship blockers remain.',
      decidedAt: '2026-04-06T14:12:00.000Z',
    });
    assert.equal(deliveryRejected.change.status, 'blocked');
    assert.deepEqual(deliveryRejected.change.blockerIds, [`gate:${deliveryReview.gate.id}`]);
    assert.equal(deliveryRejected.gate.status, 'rejected');

    const finalReview = createWorkGate(projectId, {
      changeId: change.id,
      type: 'final_review',
      title: 'Final delivery review',
      reason: 'Confirm the change can be completed.',
      createdAt: '2026-04-06T14:13:00.000Z',
    });
    assert.equal(finalReview.change.status, 'in_review');

    const finalApproved = approveGate(projectId, finalReview.gate.id, {
      actor: 'lead',
      decidedAt: '2026-04-06T14:14:00.000Z',
    });
    assert.equal(finalApproved.change.status, 'done');
    assert.equal(finalApproved.change.completedAt, '2026-04-06T14:14:00.000Z');
    assert.deepEqual(finalApproved.change.blockerIds, []);
    assert.equal(finalApproved.gate.status, 'approved');
    assert.equal(getGate(projectId, finalReview.gate.id)?.resolvedAt, '2026-04-06T14:14:00.000Z');
    assert.equal(getChange(projectId, change.id)?.status, 'done');
    assert.equal(getSpec(projectId, spec.id)?.status, 'approved');

    // ── Spec review supersession ─────────────────────────────────────────────
    // When a spec is refined (new version), creating a gate for the new spec
    // must automatically cancel any pending spec_review gates from prior versions
    // on the same change. Only one pending spec_review gate should exist at a time.
    {
      const supProjectId = 'supersession';
      const supChange: WorkChange = {
        ...change,
        id: 'change-sup',
        projectId: supProjectId,
        activeSpecId: 'spec-sup-v1',
      };
      const supSpecV1: WorkSpec = {
        ...spec,
        id: 'spec-sup-v1',
        projectId: supProjectId,
        changeId: supChange.id,
        version: 1,
      };
      const supSpecV2: WorkSpec = {
        ...spec,
        id: 'spec-sup-v2',
        projectId: supProjectId,
        changeId: supChange.id,
        version: 2,
      };
      createChange(supChange);
      createSpec(supSpecV1);
      createSpec(supSpecV2);

      const gateV1 = createWorkGate(supProjectId, {
        changeId: supChange.id,
        type: 'spec_review',
        title: 'Review spec v1',
        reason: 'First pass.',
        specId: supSpecV1.id,
        createdAt: '2026-04-06T15:00:00.000Z',
      });
      assert.equal(gateV1.gate.status, 'pending');
      assert.deepEqual(listPendingGateIds(supProjectId), [gateV1.gate.id]);

      // Creating a gate for spec v2 must supersede the pending v1 gate silently.
      const gateV2 = createWorkGate(supProjectId, {
        changeId: supChange.id,
        type: 'spec_review',
        title: 'Review spec v2',
        reason: 'Spec was refined.',
        specId: supSpecV2.id,
        createdAt: '2026-04-06T15:01:00.000Z',
      });
      assert.equal(gateV2.gate.status, 'pending');
      assert.equal(getGate(supProjectId, gateV1.gate.id)?.status, 'cancelled');
      assert.deepEqual(listPendingGateIds(supProjectId), [gateV2.gate.id]);

      // Duplicate of same-version gate must still throw.
      assert.throws(
        () =>
          createWorkGate(supProjectId, {
            changeId: supChange.id,
            type: 'spec_review',
            title: 'Duplicate v2 gate',
            reason: 'Should fail.',
            specId: supSpecV2.id,
          }),
        /already exists/,
      );
    }

    console.log('Gate lifecycle contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
