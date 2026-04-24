import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkChange, WorkGate, WorkRun, WorkSlice, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-transition-validation-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      assertValidStatusTransition,
      createChange,
      createGate,
      createRun,
      createSlice,
      createSpec,
      isValidStatusTransition,
      listAllowedStatusTransitions,
      updateChange,
      updateGate,
      updateRun,
      updateSlice,
      updateSpec,
      workEntityStatusTransitions,
    } = await import('../src/index.js');

    assert.equal(isValidStatusTransition('change', 'draft', 'active'), true);
    assert.equal(isValidStatusTransition('spec', 'active', 'approved'), false);
    assert.deepEqual(listAllowedStatusTransitions('run', 'verifying'), ['blocked', 'succeeded', 'failed', 'cancelled']);
    assert.deepEqual(workEntityStatusTransitions.gate.pending, ['approved', 'rejected', 'cancelled']);

    const change: WorkChange = {
      id: 'change-1',
      projectId: 'alpha',
      title: 'Transition validation',
      summary: 'Enforce lifecycle transitions in the identified stores.',
      intent: 'technical_refactor',
      status: 'draft',
      request: {
        summary: 'Protect status changes with an explicit transition map.',
        source: 'user',
      },
      scope: {
        inScope: ['src/ledger'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['invalid transitions fail'],
      },
      stageStatus: {},
      blockerIds: [],
      createdAt: '2026-04-02T05:00:00.000Z',
      updatedAt: '2026-04-02T05:00:00.000Z',
    };

    const spec: WorkSpec = {
      id: 'spec-1',
      projectId: 'alpha',
      changeId: 'change-1',
      version: 1,
      title: 'Transition map',
      summary: 'Define deterministic lifecycle edges for operational entities.',
      status: 'draft',
      goals: ['keep lifecycle validation deterministic'],
      constraints: ['do not pre-implement later orchestration flows'],
      acceptanceCriteria: ['stores reject invalid status updates'],
      sourceArtifacts: [],
      createdAt: '2026-04-02T05:00:00.000Z',
      updatedAt: '2026-04-02T05:00:00.000Z',
    };

    const slice: WorkSlice = {
      id: 'slice-1',
      projectId: 'alpha',
      changeId: 'change-1',
      specId: 'spec-1',
      title: 'Guard transitions',
      summary: 'Add transition enforcement to the ledger store layer.',
      status: 'draft',
      sequence: 1,
      priority: 'high',
      size: 's',
      dependencyIds: [],
      blockers: [],
      taskRefs: ['P1-T4'],
      acceptanceChecks: ['transition tests pass'],
      allowedPaths: ['src/ledger'],
      outOfScopePaths: ['src/runtime/engineering-exec.ts'],
      relatedArtifacts: [],
      createdAt: '2026-04-02T05:00:00.000Z',
      updatedAt: '2026-04-02T05:00:00.000Z',
    };

    const run: WorkRun = {
      id: 'run-1',
      projectId: 'alpha',
      changeId: 'change-1',
      specId: 'spec-1',
      sliceId: 'slice-1',
      status: 'created',
      provider: 'codex',
      evidence: [],
      createdAt: '2026-04-02T05:00:00.000Z',
      updatedAt: '2026-04-02T05:00:00.000Z',
    };

    const gate: WorkGate = {
      id: 'gate-1',
      projectId: 'alpha',
      changeId: 'change-1',
      type: 'spec_review',
      status: 'pending',
      title: 'Spec approval',
      reason: 'Review the transition map before continuing.',
      specId: 'spec-1',
      createdAt: '2026-04-02T05:00:00.000Z',
      updatedAt: '2026-04-02T05:00:00.000Z',
    };

    createChange(change);
    createSpec(spec);
    createSlice(slice);
    createRun(run);
    createGate(gate);

    assert.equal(updateChange({ ...change, status: 'active' }).status, 'active');
    assert.equal(updateSpec({ ...spec, status: 'active' }).status, 'active');
    assert.equal(updateSlice({ ...slice, status: 'ready' }).status, 'ready');
    assert.equal(updateRun({ ...run, status: 'running' }).status, 'running');
    assert.equal(updateGate({ ...gate, status: 'approved' }).status, 'approved');

    assert.throws(() => assertValidStatusTransition('slice', 'done', 'in_progress'), /Invalid slice status transition/);
    assert.throws(
      () =>
        updateChange({
          ...change,
          status: 'draft',
        }),
      /Invalid change status transition/,
    );
    assert.throws(
      () =>
        updateSpec({
          ...spec,
          status: 'approved',
        }),
      /Invalid spec status transition/,
    );
    assert.throws(
      () =>
        updateSlice({
          ...slice,
          status: 'draft',
        }),
      /Invalid slice status transition/,
    );
    assert.throws(
      () =>
        updateRun({
          ...run,
          status: 'created',
        }),
      /Invalid run status transition/,
    );
    assert.throws(
      () =>
        updateGate({
          ...gate,
          status: 'pending',
        }),
      /Invalid gate status transition/,
    );

    console.log('Transition validation contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
