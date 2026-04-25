import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  WorkChange,
  WorkGate,
  WorkLedger,
  WorkRun,
  WorkSlice,
  WorkSpec,
} from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-entity-stores-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      changeExists,
      createChange,
      createGate,
      createLedger,
      createRun,
      createSlice,
      createSpec,
      deleteChange,
      deleteGate,
      deleteLedger,
      deleteRun,
      deleteSlice,
      deleteSpec,
      getChange,
      getGate,
      getLedger,
      getRun,
      getSlice,
      getSpec,
      gateExists,
      ledgerExists,
      listChanges,
      listGates,
      listRuns,
      listSlices,
      listSpecs,
      requireChange,
      requireGate,
      requireLedger,
      requireRun,
      requireSlice,
      requireSpec,
      runExists,
      saveChange,
      saveGate,
      saveLedger,
      saveRun,
      saveSlice,
      saveSpec,
      sliceExists,
      specExists,
      updateChange,
      updateGate,
      updateLedger,
      updateRun,
      updateSlice,
      updateSpec,
    } = await import('../src/index.js');

    const change: WorkChange = {
      id: 'change-1',
      projectId: 'alpha',
      title: 'Entity stores',
      summary: 'Persist CRUD store modules for operational records.',
      intent: 'technical_refactor',
      status: 'active',
      request: {
        summary: 'Add change/spec/slice/run/gate/ledger stores.',
        source: 'user',
      },
      scope: {
        inScope: ['src/ledger'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['CRUD store modules exist'],
      },
      currentStage: 'engineering',
      activeSpecId: 'spec-1',
      stageStatus: {
        engineering: 'in_progress',
      },
      blockerIds: [],
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
    };

    const spec: WorkSpec = {
      id: 'spec-1',
      projectId: 'alpha',
      changeId: 'change-1',
      version: 1,
      title: 'Entity store contract',
      summary: 'Typed CRUD access over artifact JSON helpers.',
      status: 'active',
      goals: ['simple typed CRUD'],
      constraints: ['lifecycle transitions must stay valid'],
      acceptanceCriteria: ['store helpers export create/get/list/update/delete'],
      sourceArtifacts: [],
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
    };

    const slice: WorkSlice = {
      id: 'slice-1',
      projectId: 'alpha',
      changeId: 'change-1',
      specId: 'spec-1',
      title: 'Implement stores',
      summary: 'Add typed store modules under src/ledger.',
      status: 'ready',
      sequence: 1,
      priority: 'high',
      size: 's',
      dependencyIds: [],
      blockers: [],
      taskRefs: ['P1-T3'],
      acceptanceChecks: ['typecheck passes'],
      allowedPaths: ['src/ledger'],
      outOfScopePaths: ['src/cli.ts'],
      relatedArtifacts: [],
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
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
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
    };

    const gate: WorkGate = {
      id: 'gate-1',
      projectId: 'alpha',
      changeId: 'change-1',
      type: 'spec_review',
      status: 'pending',
      title: 'Review spec',
      reason: 'Spec approval is still required.',
      specId: 'spec-1',
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
    };

    const ledger: WorkLedger = {
      projectId: 'alpha',
      activeChangeId: 'change-1',
      activeSpecId: 'spec-1',
      changeIds: ['change-1'],
      specIds: ['spec-1'],
      sliceIds: ['slice-1'],
      runIds: ['run-1'],
      gateIds: ['gate-1'],
      pendingGateIds: ['gate-1'],
      blockedChangeIds: [],
      blockers: [],
      lastIntent: 'technical_refactor',
      lastDecision: {
        schemaVersion: 1,
        projectId: 'alpha',
        request: 'Persist the foundational stores first.',
        decidedAt: '2026-04-02T00:00:00.000Z',
        decision: {
          intent: 'technical_refactor',
          rationale: 'Persist the foundational stores first.',
          nextStage: 'engineering',
          recommendedStages: ['engineering'],
          requiresHumanApproval: false,
          createChange: true,
          createSpec: true,
          directToExecution: false,
          stageDecisions: [],
          skippedStages: ['pm', 'research', 'design', 'engineering_exec'],
        },
      },
      sliceIdsByStatus: {
        ready: ['slice-1'],
      },
      runIdsByStatus: {
        created: ['run-1'],
      },
      updatedAt: '2026-04-02T00:00:00.000Z',
    };

    assert.equal(changeExists('alpha', change.id), false);
    assert.deepEqual(createChange(change), change);
    assert.equal(changeExists('alpha', change.id), true);
    assert.deepEqual(getChange('alpha', change.id), change);
    assert.deepEqual(requireChange('alpha', change.id), change);
    assert.deepEqual(listChanges('alpha'), [change]);

    let duplicateChangeError = '';
    try {
      createChange(change);
    } catch (error) {
      duplicateChangeError = String((error as Error)?.message || error || '');
    }
    assert.match(duplicateChangeError, /already exists/);

    const changedChange: WorkChange = {
      ...change,
      summary: 'Persist CRUD store modules for operational entities.',
      updatedAt: '2026-04-02T01:00:00.000Z',
    };
    assert.deepEqual(updateChange(changedChange), changedChange);
    assert.deepEqual(saveChange({ ...changedChange, status: 'blocked' }), { ...changedChange, status: 'blocked' });

    assert.equal(specExists('alpha', spec.id), false);
    assert.deepEqual(createSpec(spec), spec);
    assert.deepEqual(getSpec('alpha', spec.id), spec);
    assert.deepEqual(requireSpec('alpha', spec.id), spec);
    assert.deepEqual(listSpecs('alpha'), [spec]);
    assert.deepEqual(updateSpec({ ...spec, status: 'review_ready' }), { ...spec, status: 'review_ready' });
    assert.deepEqual(saveSpec({ ...spec, version: 2, updatedAt: '2026-04-02T01:30:00.000Z' }), {
      ...spec,
      version: 2,
      updatedAt: '2026-04-02T01:30:00.000Z',
    });

    assert.equal(sliceExists('alpha', slice.id), false);
    assert.deepEqual(createSlice(slice), slice);
    assert.deepEqual(getSlice('alpha', slice.id), slice);
    assert.deepEqual(requireSlice('alpha', slice.id), slice);
    assert.deepEqual(listSlices('alpha'), [slice]);
    assert.deepEqual(updateSlice({ ...slice, status: 'in_progress' }), { ...slice, status: 'in_progress' });
    assert.deepEqual(saveSlice({ ...slice, status: 'in_progress', size: 'm', updatedAt: '2026-04-02T02:00:00.000Z' }), {
      ...slice,
      status: 'in_progress',
      size: 'm',
      updatedAt: '2026-04-02T02:00:00.000Z',
    });

    assert.equal(runExists('alpha', run.id), false);
    assert.deepEqual(createRun(run), run);
    assert.deepEqual(getRun('alpha', run.id), run);
    assert.deepEqual(requireRun('alpha', run.id), run);
    assert.deepEqual(listRuns('alpha'), [run]);
    assert.deepEqual(updateRun({ ...run, status: 'running', startedAt: '2026-04-02T02:30:00.000Z' }), {
      ...run,
      status: 'running',
      startedAt: '2026-04-02T02:30:00.000Z',
    });
    assert.deepEqual(saveRun({ ...run, status: 'succeeded', finishedAt: '2026-04-02T03:00:00.000Z' }), {
      ...run,
      status: 'succeeded',
      finishedAt: '2026-04-02T03:00:00.000Z',
    });

    assert.equal(gateExists('alpha', gate.id), false);
    assert.deepEqual(createGate(gate), gate);
    assert.deepEqual(getGate('alpha', gate.id), gate);
    assert.deepEqual(requireGate('alpha', gate.id), gate);
    assert.deepEqual(listGates('alpha'), [gate]);
    assert.deepEqual(updateGate({ ...gate, status: 'approved' }), { ...gate, status: 'approved' });
    assert.deepEqual(saveGate({ ...gate, status: 'approved', updatedAt: '2026-04-02T03:30:00.000Z' }), {
      ...gate,
      status: 'approved',
      updatedAt: '2026-04-02T03:30:00.000Z',
    });

    assert.equal(ledgerExists('alpha'), false);
    assert.deepEqual(createLedger(ledger), ledger);
    assert.equal(ledgerExists('alpha'), true);
    assert.deepEqual(getLedger('alpha'), ledger);
    assert.deepEqual(requireLedger('alpha'), ledger);
    assert.deepEqual(updateLedger({ ...ledger, pendingGateIds: [] }), { ...ledger, pendingGateIds: [] });
    assert.deepEqual(saveLedger({ ...ledger, blockedChangeIds: ['change-1'], updatedAt: '2026-04-02T04:00:00.000Z' }), {
      ...ledger,
      blockedChangeIds: ['change-1'],
      updatedAt: '2026-04-02T04:00:00.000Z',
    });

    assert.equal(deleteGate('alpha', gate.id), true);
    assert.equal(deleteRun('alpha', run.id), true);
    assert.equal(deleteSlice('alpha', slice.id), true);
    assert.equal(deleteSpec('alpha', spec.id), true);
    assert.equal(deleteChange('alpha', change.id), true);
    assert.equal(deleteLedger('alpha'), true);
    assert.equal(deleteGate('alpha', gate.id), false);
    assert.equal(deleteLedger('alpha'), false);

    let missingSpecError = '';
    try {
      requireSpec('alpha', spec.id);
    } catch (error) {
      missingSpecError = String((error as Error)?.message || error || '');
    }
    assert.match(missingSpecError, /No spec record exists/);

    let missingLedgerError = '';
    try {
      updateLedger(ledger);
    } catch (error) {
      missingLedgerError = String((error as Error)?.message || error || '');
    }
    assert.match(missingLedgerError, /No ledger record exists/);

    console.log('Entity store CRUD contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
