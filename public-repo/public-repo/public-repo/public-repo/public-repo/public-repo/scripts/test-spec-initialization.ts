import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { OrchestrationDecisionRecord, WorkChange, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-spec-init-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      createChange,
      createSlice,
      createSpec,
      getLedger,
      initializeSpec,
      initializeSpecFromDecision,
      listChanges,
      listSpecs,
      refreshLedger,
    } = await import('../src/index.js');

    const prompt = 'Define the approval dashboard scope and the initial acceptance criteria.';
    const created = initializeSpec('alpha', prompt, '2026-04-03T13:00:00.000Z');

    assert.equal(created.projectId, 'alpha');
    assert.equal(created.changeCreated, true);
    assert.equal(created.specCreated, true);
    assert.equal(created.decision.request, prompt);
    assert.equal(created.change.activeSpecId, created.spec.id);
    assert.equal(created.spec.projectId, 'alpha');
    assert.equal(created.spec.changeId, created.change.id);
    assert.equal(created.spec.version, 1);
    assert.equal(created.spec.status, 'draft');
    assert.deepEqual(created.spec.goals, [prompt]);
    assert.deepEqual(created.spec.acceptanceCriteria, []);
    assert.equal(listChanges('alpha').length, 1);
    assert.equal(listSpecs('alpha').length, 1);
    assert.equal(getLedger('alpha')?.activeChangeId, created.change.id);
    assert.equal(getLedger('alpha')?.activeSpecId, created.spec.id);

    const replayed = initializeSpecFromDecision('alpha');
    assert.equal(replayed.changeCreated, false);
    assert.equal(replayed.specCreated, false);
    assert.equal(replayed.change.id, created.change.id);
    assert.equal(replayed.spec.id, created.spec.id);
    assert.equal(listSpecs('alpha').length, 1);

    const resumedChange: WorkChange = {
      id: 'change-resume-me',
      projectId: 'beta',
      title: 'Resume specless change',
      summary: 'Continue the in-flight implementation change.',
      intent: 'resume_existing_change',
      status: 'active',
      request: {
        summary: 'Continue the in-flight implementation change.',
        source: 'user',
      },
      scope: {
        inScope: ['Preserve the current implementation scope'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['Resume without creating a duplicate change'],
      },
      currentStage: 'engineering',
      stageStatus: {
        engineering: 'in_progress',
      },
      blockerIds: [],
      createdAt: '2026-04-03T12:00:00.000Z',
      updatedAt: '2026-04-03T12:30:00.000Z',
    };

    createChange(resumedChange);
    refreshLedger('beta', {
      updatedAt: '2026-04-03T12:30:00.000Z',
    });

    const resumed = initializeSpec(
      'beta',
      'Resume change-resume-me and keep the current execution lane moving.',
      '2026-04-03T14:00:00.000Z',
    );

    assert.equal(resumed.changeCreated, false);
    assert.equal(resumed.specCreated, true);
    assert.equal(resumed.change.id, 'change-resume-me');
    assert.equal(resumed.change.activeSpecId, resumed.spec.id);
    assert.equal(resumed.spec.changeId, 'change-resume-me');
    assert.equal(resumed.spec.version, 1);
    assert.deepEqual(resumed.spec.goals, ['Preserve the current implementation scope']);
    assert.deepEqual(resumed.spec.acceptanceCriteria, ['Resume without creating a duplicate change']);
    assert.equal(resumed.decision.decision.createSpec, false);
    assert.equal(getLedger('beta')?.activeSpecId, resumed.spec.id);

    const existingSpec: WorkSpec = {
      id: 'spec-change-gamma-v1',
      projectId: 'gamma',
      changeId: 'change-gamma',
      version: 1,
      title: 'Existing gamma spec',
      summary: 'Persisted spec should be reused.',
      status: 'active',
      goals: ['Reuse the existing draft'],
      constraints: [],
      acceptanceCriteria: ['No duplicate specs'],
      sourceArtifacts: [],
      createdAt: '2026-04-03T08:00:00.000Z',
      updatedAt: '2026-04-03T09:00:00.000Z',
    };
    const existingChange: WorkChange = {
      id: 'change-gamma',
      projectId: 'gamma',
      title: 'Gamma change',
      summary: 'Existing change with spec.',
      intent: 'feature_refinement',
      status: 'active',
      request: {
        summary: 'Existing change with spec.',
        source: 'user',
      },
      scope: {
        inScope: ['Keep the spec linked'],
        outOfScope: [],
        acceptanceCriteria: ['Reuse existing spec'],
      },
      currentStage: 'engineering',
      stageStatus: {
        engineering: 'ready',
      },
      blockerIds: [],
      createdAt: '2026-04-03T07:30:00.000Z',
      updatedAt: '2026-04-03T09:00:00.000Z',
    };

    createChange(existingChange);
    createSpec(existingSpec);
    refreshLedger('gamma', {
      updatedAt: '2026-04-03T09:00:00.000Z',
    });

    const reuseDecision: OrchestrationDecisionRecord = {
      schemaVersion: 1,
      projectId: 'gamma',
      request: 'Resume change-gamma without replacing the persisted spec.',
      decidedAt: '2026-04-03T15:00:00.000Z',
      decision: {
        intent: 'resume_existing_change',
        rationale: 'Existing active change and spec should be reused.',
        nextStage: 'engineering',
        recommendedStages: ['engineering'],
        requiresHumanApproval: false,
        createChange: false,
        createSpec: false,
        directToExecution: false,
        resumeChangeId: 'change-gamma',
        stageDecisions: [],
        skippedStages: ['pm', 'research', 'design', 'engineering_exec'],
      },
    };

    const reused = initializeSpecFromDecision('gamma', reuseDecision);
    assert.equal(reused.changeCreated, false);
    assert.equal(reused.specCreated, false);
    assert.equal(reused.spec.id, existingSpec.id);
    assert.equal(reused.change.activeSpecId, existingSpec.id);
    assert.equal(listSpecs('gamma').length, 1);

    const additiveChange: WorkChange = {
      id: 'change-delta',
      projectId: 'delta',
      title: 'Delta change',
      summary: 'Existing shipped work now needs explicit refinement.',
      intent: 'feature_refinement',
      status: 'active',
      request: {
        summary: 'Existing shipped work now needs explicit refinement.',
        source: 'user',
      },
      scope: {
        inScope: ['Keep refinement history additive'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['new spec version is created instead of mutating prior history'],
      },
      currentStage: 'engineering',
      activeSpecId: 'spec-change-delta-v1',
      stageStatus: {
        engineering: 'done',
      },
      blockerIds: [],
      createdAt: '2026-04-07T08:00:00.000Z',
      updatedAt: '2026-04-07T08:20:00.000Z',
    };
    const additiveSpec: WorkSpec = {
      id: 'spec-change-delta-v1',
      projectId: 'delta',
      changeId: 'change-delta',
      version: 1,
      title: 'Delta spec v1',
      summary: 'Original approved scope.',
      status: 'approved',
      goals: ['ship the original slice'],
      constraints: [],
      acceptanceCriteria: ['original behavior stays explicit'],
      sourceArtifacts: [{ path: 'TechSpec.md', kind: 'markdown', label: 'TechSpec.md', stage: 'engineering' }],
      stageSummaries: {
        engineering: 'Original engineering plan completed.',
      },
      approvedAt: '2026-04-07T08:10:00.000Z',
      createdAt: '2026-04-07T08:00:00.000Z',
      updatedAt: '2026-04-07T08:10:00.000Z',
    };

    createChange(additiveChange);
    createSpec(additiveSpec);
    createSlice({
      id: 'slice-spec-change-delta-v1-core',
      projectId: 'delta',
      changeId: additiveChange.id,
      specId: additiveSpec.id,
      title: 'Original slice',
      summary: 'Previously persisted work.',
      status: 'done',
      sequence: 1,
      priority: 'high',
      size: 's',
      dependencyIds: [],
      blockers: [],
      taskRefs: ['P11-T4'],
      acceptanceChecks: ['history stays additive'],
      allowedPaths: ['src/ledger', 'src/orchestration'],
      outOfScopePaths: ['src/cli.ts'],
      relatedArtifacts: [],
      createdAt: '2026-04-07T08:11:00.000Z',
      updatedAt: '2026-04-07T08:15:00.000Z',
      completedAt: '2026-04-07T08:15:00.000Z',
    });
    refreshLedger('delta', {
      activeChangeId: additiveChange.id,
      activeSpecId: additiveSpec.id,
      updatedAt: '2026-04-07T08:20:00.000Z',
    });

    const refinementDecision: OrchestrationDecisionRecord = {
      schemaVersion: 1,
      projectId: 'delta',
      request: 'Update the spec to capture review feedback and create follow-up work without overwriting the prior slice history.',
      decidedAt: '2026-04-07T09:00:00.000Z',
      decision: {
        intent: 'spec_revision',
        rationale: 'Existing approved work needs explicit follow-up planning.',
        nextStage: 'pm',
        recommendedStages: ['pm', 'engineering'],
        requiresHumanApproval: true,
        createChange: false,
        createSpec: false,
        directToExecution: false,
        resumeChangeId: additiveChange.id,
        stageDecisions: [],
        skippedStages: ['research', 'design', 'engineering_exec'],
      },
    };

    const refined = initializeSpecFromDecision('delta', refinementDecision);
    assert.equal(refined.changeCreated, false);
    assert.equal(refined.specCreated, true);
    assert.equal(refined.change.id, additiveChange.id);
    assert.equal(refined.change.activeSpecId, 'spec-change-delta-v2');
    assert.equal(refined.spec.id, 'spec-change-delta-v2');
    assert.equal(refined.spec.version, 2);
    assert.equal(refined.spec.status, 'draft');
    assert.equal(refined.spec.refinedFromSpecId, additiveSpec.id);
    assert.match(refined.spec.refinementReason || '', /update the spec to capture review feedback/i);
    assert.equal(refined.spec.summary, refinementDecision.request);
    assert.equal(listSpecs('delta').length, 2);
    assert.equal(listSpecs('delta').find((spec) => spec.id === additiveSpec.id)?.status, 'superseded');
    assert.equal(listSpecs('delta').find((spec) => spec.id === additiveSpec.id)?.supersededBySpecId, refined.spec.id);

    const replayedRefinement = initializeSpecFromDecision('delta', refinementDecision);
    assert.equal(replayedRefinement.specCreated, false);
    assert.equal(replayedRefinement.spec.id, refined.spec.id);
    assert.equal(listSpecs('delta').length, 2);

    console.log('Spec initialization contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
