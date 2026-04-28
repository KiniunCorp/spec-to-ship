import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkChange, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-change-init-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      createChange,
      createSpec,
      getLedger,
      initializeChange,
      initializeChangeFromDecision,
      listChanges,
      refreshLedger,
    } = await import('../src/index.js');
    const { writeArtifact } = await import('../src/artifacts/store.js');

    const prompt = 'Add a release dashboard with approval states and loading feedback.';
    const created = initializeChange('alpha', prompt, '2026-04-03T11:00:00.000Z');

    assert.equal(created.created, true);
    assert.equal(created.projectId, 'alpha');
    assert.equal(created.decision.request, prompt);
    assert.equal(created.change.projectId, 'alpha');
    assert.equal(created.change.intent, created.decision.decision.intent);
    assert.equal(created.change.currentStage, 'pm');
    assert.equal(created.change.status, 'draft');
    assert.equal(created.change.stageStatus.pm, 'ready');
    assert.equal(created.change.request.summary, prompt);
    assert.equal(created.change.request.rawInput, prompt);
    assert.deepEqual(created.change.scope, {
      inScope: [],
      outOfScope: [],
      acceptanceCriteria: [],
    });
    assert.match(created.change.id, /^change-add-a-release-dashboard-with-approval-states/);
    assert.equal(listChanges('alpha').length, 1);
    assert.equal(getLedger('alpha')?.activeChangeId, created.change.id);
    assert.equal(getLedger('alpha')?.lastDecision?.decidedAt, '2026-04-03T11:00:00.000Z');

    const replayed = initializeChangeFromDecision('alpha');
    assert.equal(replayed.created, false);
    assert.equal(replayed.change.id, created.change.id);
    assert.equal(listChanges('alpha').length, 1);

    const existingChange: WorkChange = {
      id: 'change-resume-me',
      projectId: 'beta',
      title: 'Resume implementation',
      summary: 'Continue the active implementation lane.',
      intent: 'implementation_only',
      status: 'active',
      request: {
        summary: 'Continue the active implementation lane.',
        source: 'user',
      },
      scope: {
        inScope: ['src/orchestration'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['resume existing work'],
      },
      currentStage: 'engineering',
      stageStatus: {
        engineering: 'in_progress',
      },
      blockerIds: [],
      createdAt: '2026-04-03T10:00:00.000Z',
      updatedAt: '2026-04-03T10:30:00.000Z',
    };

    createChange(existingChange);
    refreshLedger('beta', {
      updatedAt: '2026-04-03T10:30:00.000Z',
    });

    const resumed = initializeChange(
      'beta',
      'Resume the current change and continue implementation without restarting planning.',
      '2026-04-03T12:00:00.000Z',
    );

    assert.equal(resumed.created, false);
    assert.equal(resumed.change.id, 'change-resume-me');
    assert.equal(listChanges('beta').length, 1);
    assert.equal(getLedger('beta')?.lastDecision?.decision.resumeChangeId, 'change-resume-me');
    assert.equal(getLedger('beta')?.activeChangeId, 'change-resume-me');

    const expansionChange: WorkChange = {
      id: 'change-expand-me',
      projectId: 'gamma',
      title: 'Engineering-first change',
      summary: 'An implementation-only lane is in progress.',
      intent: 'implementation_only',
      status: 'active',
      request: {
        summary: 'An implementation-only lane is in progress.',
        source: 'user',
      },
      scope: {
        inScope: ['src/orchestration'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['expansion reuses the active change'],
      },
      currentStage: 'engineering',
      activeSpecId: 'spec-expand-me',
      stageStatus: {
        engineering: 'in_progress',
      },
      blockerIds: [],
      createdAt: '2026-04-05T10:00:00.000Z',
      updatedAt: '2026-04-05T10:30:00.000Z',
    };
    const expansionSpec: WorkSpec = {
      id: 'spec-expand-me',
      projectId: 'gamma',
      changeId: 'change-expand-me',
      version: 1,
      title: 'Engineering-first spec',
      summary: 'Current implementation scope exists, but design needs refinement.',
      status: 'active',
      goals: ['keep the current change while widening the flow'],
      constraints: [],
      acceptanceCriteria: ['active spec is reused during expansion'],
      sourceArtifacts: [],
      createdAt: '2026-04-05T10:05:00.000Z',
      updatedAt: '2026-04-05T10:30:00.000Z',
    };

    createChange(expansionChange);
    createSpec(expansionSpec);
    refreshLedger('gamma', {
      activeChangeId: 'change-expand-me',
      activeSpecId: 'spec-expand-me',
      updatedAt: '2026-04-05T10:30:00.000Z',
    });

    const expanded = initializeChange(
      'gamma',
      'Refine the dashboard UI with better loading states, clearer empty states, and improved microcopy.',
      '2026-04-05T12:00:00.000Z',
    );

    assert.equal(expanded.created, false);
    assert.equal(expanded.change.id, 'change-expand-me');
    assert.equal(expanded.decision.decision.resumeChangeId, 'change-expand-me');
    assert.deepEqual(expanded.decision.decision.expansion?.addedStages, ['design']);
    assert.equal(expanded.change.currentStage, 'design');
    assert.equal(expanded.change.stageStatus.design, 'ready');
    assert.equal(expanded.change.stageStatus.engineering, 'ready');

    await writeArtifact('delta', 'PrototypeSpec.md', '# Prototype Spec\n');
    const backwardChange: WorkChange = {
      id: 'change-backward-design',
      projectId: 'delta',
      title: 'Design-reviewed change',
      summary: 'Implementation is waiting on updated design feedback.',
      intent: 'feature_refinement',
      status: 'in_review',
      request: {
        summary: 'Continue the current change with new design feedback.',
        source: 'user',
      },
      scope: {
        inScope: ['src/orchestration'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['reopen design on the active change'],
      },
      currentStage: 'engineering',
      activeSpecId: 'spec-backward-design',
      stageStatus: {
        design: 'done',
        engineering: 'review',
      },
      blockerIds: [],
      createdAt: '2026-04-06T09:00:00.000Z',
      updatedAt: '2026-04-06T09:10:00.000Z',
    };
    const backwardSpec: WorkSpec = {
      id: 'spec-backward-design',
      projectId: 'delta',
      changeId: 'change-backward-design',
      version: 1,
      title: 'Design-reviewed spec',
      summary: 'The current spec already links a prior design definition.',
      status: 'approved',
      goals: ['allow design to be revisited when new feedback arrives'],
      constraints: [],
      acceptanceCriteria: ['reuse the active change while design reopens'],
      sourceArtifacts: [
        { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
      ],
      designDefinition: { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
      approvedAt: '2026-04-06T09:05:00.000Z',
      createdAt: '2026-04-06T09:02:00.000Z',
      updatedAt: '2026-04-06T09:05:00.000Z',
    };

    createChange(backwardChange);
    createSpec(backwardSpec);
    refreshLedger('delta', {
      activeChangeId: 'change-backward-design',
      activeSpecId: 'spec-backward-design',
      updatedAt: '2026-04-06T09:10:00.000Z',
    });

    const rerouted = initializeChange(
      'delta',
      'Refine the dashboard UI after feedback with clearer empty states, stronger microcopy, and better loading states.',
      '2026-04-06T10:00:00.000Z',
    );

    assert.equal(rerouted.created, false);
    assert.equal(rerouted.change.id, 'change-backward-design');
    assert.equal(rerouted.decision.decision.resumeChangeId, 'change-backward-design');
    assert.deepEqual(rerouted.decision.decision.expansion?.reopenedStages, ['design']);
    assert.equal(rerouted.change.status, 'active');
    assert.equal(rerouted.change.currentStage, 'design');
    assert.equal(rerouted.change.stageStatus.design, 'ready');
    assert.equal(rerouted.change.stageStatus.engineering, 'ready');

    console.log('Change initialization contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
