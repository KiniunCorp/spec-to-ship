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
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-artifact-store-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      artifactPath,
      listArtifactFiles,
      listArtifactJson,
      listArtifacts,
      listWorkEntityArtifacts,
      listWorkEntityIds,
      readArtifact,
      readArtifactJson,
      readWorkEntityArtifact,
      workEntityArtifactPath,
      writeArtifact,
      writeArtifactJson,
      writeWorkEntityArtifact,
    } = await import('../src/artifacts/store.js');

    writeArtifact('alpha', 'notes/engineering/summary.md', '# Summary\n');
    assert.equal(readArtifact('alpha', 'notes/engineering/summary.md'), '# Summary\n');
    assert.deepEqual(listArtifacts('alpha', 'notes'), ['engineering']);
    assert.deepEqual(listArtifactFiles('alpha'), ['notes/engineering/summary.md']);

    const rawChange = { id: 'raw-change', nested: { stage: 'pm' } };
    writeArtifactJson('alpha', 'changes/raw-change.json', rawChange);
    assert.deepEqual(readArtifactJson<typeof rawChange>('alpha', 'changes/raw-change.json'), rawChange);
    assert.deepEqual(listArtifactJson<typeof rawChange>('alpha', 'changes'), [{ path: 'raw-change.json', value: rawChange }]);

    const change: WorkChange = {
      id: 'change-1',
      projectId: 'alpha',
      title: 'Add artifact JSON helpers',
      summary: 'Persist operational entities as JSON artifacts.',
      intent: 'technical_refactor',
      status: 'active',
      request: {
        summary: 'Persist Change, Spec, Slice, Run, Gate, and Ledger records.',
        source: 'user',
      },
      scope: {
        inScope: ['artifact helpers'],
        outOfScope: ['CLI'],
        acceptanceCriteria: ['nested JSON helpers exist'],
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
      title: 'Artifact helper contract',
      summary: 'Define JSON storage helpers for operational artifacts.',
      status: 'active',
      goals: ['support nested JSON files'],
      constraints: ['preserve current markdown artifacts'],
      acceptanceCriteria: ['entity helpers exist'],
      sourceArtifacts: [],
      createdAt: '2026-04-02T00:00:00.000Z',
      updatedAt: '2026-04-02T00:00:00.000Z',
    };
    const slice: WorkSlice = {
      id: 'slice-1',
      projectId: 'alpha',
      changeId: 'change-1',
      specId: 'spec-1',
      title: 'Implement store helpers',
      summary: 'Extend artifacts/store.ts.',
      status: 'ready',
      sequence: 1,
      priority: 'high',
      size: 's',
      dependencyIds: [],
      blockers: [],
      taskRefs: ['P1-T2'],
      acceptanceChecks: ['typecheck passes'],
      allowedPaths: ['src/artifacts/store.ts'],
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
      title: 'Spec review',
      reason: 'Spec needs approval before delivery.',
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
        request: 'P1-T2 is next.',
        decidedAt: '2026-04-02T00:00:00.000Z',
        decision: {
          intent: 'technical_refactor',
          rationale: 'P1-T2 is next.',
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

    writeWorkEntityArtifact('alpha', 'change', change, change.id);
    writeWorkEntityArtifact('alpha', 'spec', spec, spec.id);
    writeWorkEntityArtifact('alpha', 'slice', slice, slice.id);
    writeWorkEntityArtifact('alpha', 'run', run, run.id);
    writeWorkEntityArtifact('alpha', 'gate', gate, gate.id);
    writeWorkEntityArtifact('alpha', 'ledger', ledger);

    assert.equal(workEntityArtifactPath('alpha', 'change', 'change-1'), artifactPath('alpha', 'changes/change-1.json'));
    assert.equal(workEntityArtifactPath('alpha', 'ledger'), artifactPath('alpha', 'ledger.json'));
    assert.deepEqual(readWorkEntityArtifact('alpha', 'change', 'change-1'), change);
    assert.deepEqual(readWorkEntityArtifact('alpha', 'ledger'), ledger);
    assert.deepEqual(listWorkEntityIds('alpha', 'change'), ['change-1', 'raw-change']);
    assert.deepEqual(listWorkEntityArtifacts('alpha', 'gate'), [gate]);

    let traversalError = '';
    try {
      writeArtifact('alpha', '../escape.txt', 'nope');
    } catch (error) {
      traversalError = String((error as Error)?.message || error || '');
    }
    assert.match(traversalError, /not allowed/);

    let ledgerIdError = '';
    try {
      writeWorkEntityArtifact('alpha', 'ledger', ledger, 'ledger-1');
    } catch (error) {
      ledgerIdError = String((error as Error)?.message || error || '');
    }
    assert.match(ledgerIdError, /do not support entity ids/);

    console.log('Artifact JSON helper contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
