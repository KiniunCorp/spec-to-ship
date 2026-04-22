import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkChange, WorkSlice, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-refinement-history-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      createChange,
      createRefinementSpecVersion,
      createSlice,
      createSpec,
      deriveAndPersistSlices,
      derivePersistedSliceId,
      hasMaterializedSpecHistory,
      listSlices,
      listSpecs,
    } = await import('../src/index.js');

    const projectId = 'alpha';
    const change: WorkChange = {
      id: 'change-alpha',
      projectId,
      title: 'Additive refinement',
      summary: 'Preserve prior execution history explicitly.',
      intent: 'feature_refinement',
      status: 'active',
      request: { summary: 'Preserve prior execution history explicitly.', source: 'user' },
      scope: {
        inScope: ['src/ledger', 'src/orchestration'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['follow-up work stays additive'],
      },
      currentStage: 'engineering',
      activeSpecId: 'spec-change-alpha-v1',
      stageStatus: {
        engineering: 'done',
      },
      blockerIds: [],
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:20:00.000Z',
    };
    const spec: WorkSpec = {
      id: 'spec-change-alpha-v1',
      projectId,
      changeId: change.id,
      version: 1,
      title: 'Original spec',
      summary: 'Original shipped scope.',
      status: 'approved',
      goals: ['ship the first slice'],
      constraints: ['preserve history'],
      acceptanceCriteria: ['first version is explicit'],
      sourceArtifacts: [{ path: 'TechSpec.md', kind: 'markdown', label: 'TechSpec.md', stage: 'engineering' }],
      stageSummaries: {
        engineering: 'Original engineering plan completed.',
      },
      approvedAt: '2026-04-07T10:10:00.000Z',
      createdAt: '2026-04-07T10:00:00.000Z',
      updatedAt: '2026-04-07T10:10:00.000Z',
    };
    const originalSlice: WorkSlice = {
      id: derivePersistedSliceId(spec.id, 'slice-eng-100'),
      projectId,
      changeId: change.id,
      specId: spec.id,
      sliceKey: 'slice-eng-100',
      title: 'Original slice',
      summary: 'Previously delivered work.',
      status: 'done',
      sequence: 1,
      priority: 'high',
      size: 's',
      dependencyIds: [],
      blockers: [],
      taskRefs: ['ENG-100'],
      sourceTaskIds: ['ENG-100'],
      acceptanceChecks: ['original work completed'],
      allowedPaths: ['src/ledger'],
      outOfScopePaths: ['src/cli.ts'],
      relatedArtifacts: [],
      implementationNotes: ['Original implementation notes.'],
      createdAt: '2026-04-07T10:11:00.000Z',
      updatedAt: '2026-04-07T10:15:00.000Z',
      completedAt: '2026-04-07T10:15:00.000Z',
    };

    createChange(change);
    createSpec(spec);
    createSlice(originalSlice);

    assert.equal(hasMaterializedSpecHistory(projectId, spec.id), true);

    const refinement = createRefinementSpecVersion(projectId, {
      changeId: change.id,
      baseSpecId: spec.id,
      reason: 'Review feedback requires a follow-up slice without overwriting the original execution record.',
      summary: 'Refined scope after review feedback.',
      createdAt: '2026-04-07T11:00:00.000Z',
      sourceSliceId: originalSlice.id,
    });

    assert.equal(refinement.previousSpec.id, spec.id);
    assert.equal(refinement.previousSpec.status, 'superseded');
    assert.equal(refinement.previousSpec.supersededBySpecId, refinement.spec.id);
    assert.equal(refinement.spec.id, 'spec-change-alpha-v2');
    assert.equal(refinement.spec.version, 2);
    assert.equal(refinement.spec.status, 'draft');
    assert.equal(refinement.spec.refinedFromSpecId, spec.id);
    assert.equal(refinement.spec.refinementSourceSliceId, originalSlice.id);
    assert.equal(refinement.spec.summary, 'Refined scope after review feedback.');
    assert.equal(refinement.change.activeSpecId, refinement.spec.id);

    const persistedFollowUp = deriveAndPersistSlices(
      {
        schemaVersion: 1,
        projectId,
        change,
        spec: refinement.spec,
        techSpecPath: 'TechSpec.md',
        backlogPath: 'Backlog.md',
        supportingArtifacts: [],
        techSpec: {
          architectureOverview: 'Follow-up refinement reuses the original architecture.',
          dataModel: 'No data model changes.',
          apiIntegrationPoints: 'No new integrations.',
          riskSecurityNotes: 'Preserve previous behavior while applying feedback.',
          implementationPlan: '1. Create a follow-up refinement slice.',
          testPlan: 'Verify both old and new slices remain visible.',
        },
        backlog: [
          {
            id: 'ENG-100',
            title: 'Follow-up refinement',
            description: 'Apply the review feedback without mutating prior slice history.',
            priority: 'high',
            estimate: '1d',
            dependencyIds: [],
            acceptanceCriteria: ['new slice persists under the new spec namespace'],
            allowedPaths: ['src/ledger', 'src/orchestration'],
            outOfScopePaths: ['src/cli.ts'],
          },
        ],
      },
      {
        persistedAt: '2026-04-07T11:10:00.000Z',
      },
    );

    const followUpSliceId = derivePersistedSliceId(refinement.spec.id, 'slice-eng-100');
    assert.deepEqual(persistedFollowUp.createdSliceIds, [followUpSliceId]);
    assert.notEqual(followUpSliceId, originalSlice.id);
    assert.equal(listSlices(projectId).find((slice) => slice.id === originalSlice.id)?.status, 'done');
    assert.equal(listSlices(projectId).find((slice) => slice.id === followUpSliceId)?.specId, refinement.spec.id);
    assert.equal(listSpecs(projectId).length, 2);

    console.log('Refinement history contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
