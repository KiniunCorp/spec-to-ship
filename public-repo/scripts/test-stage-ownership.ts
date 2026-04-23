import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { OrchestrationDecisionRecord, WorkChange, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-stage-ownership-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      advanceStageOwnership,
      advanceStageOwnershipFromDecision,
      createChange,
      createSpec,
      getLedger,
      listChanges,
      listSpecs,
      recordOrchestrationDecision,
      refreshLedger,
    } = await import('../src/index.js');

    const alphaDecision = recordOrchestrationDecision(
      'alpha',
      'Define scope, validate the riskiest assumptions, and then hand off to design.',
      {
        intent: 'new_feature',
        rationale: 'Product framing still needs PM and research before design starts.',
        nextStage: 'pm',
        recommendedStages: ['pm', 'research', 'design'],
        requiresHumanApproval: false,
        createChange: true,
        createSpec: true,
        directToExecution: false,
        stageDecisions: [
          { stage: 'pm', action: 'invoke', reason: 'PM should frame the request.' },
          { stage: 'research', action: 'invoke', reason: 'Research should validate assumptions.' },
          { stage: 'design', action: 'invoke', reason: 'Design should define the interface.' },
          { stage: 'engineering', action: 'skip', reason: 'Engineering is not next yet.' },
          { stage: 'engineering_exec', action: 'skip', reason: 'Execution is not ready.' },
        ],
        skippedStages: ['engineering', 'engineering_exec'],
      },
      '2026-04-03T16:00:00.000Z',
    );

    const pmSummary = 'PM tightened the MVP scope and clarified the first acceptance criteria.';
    const created = advanceStageOwnership('alpha', 'pm', pmSummary, '2026-04-03T16:15:00.000Z');

    assert.equal(created.projectId, 'alpha');
    assert.equal(created.changeCreated, true);
    assert.equal(created.specCreated, true);
    assert.equal(created.change.currentStage, 'research');
    assert.equal(created.change.status, 'active');
    assert.equal(created.change.stageStatus.pm, 'done');
    assert.equal(created.change.stageStatus.research, 'ready');
    assert.equal(created.spec.status, 'active');
    assert.equal(created.spec.stageSummaries?.pm, pmSummary);
    assert.equal(created.approvalReady, false);
    assert.deepEqual(created.linkedSourceArtifacts, []);
    assert.equal(getLedger('alpha')?.activeChangeId, created.change.id);
    assert.equal(getLedger('alpha')?.activeSpecId, created.spec.id);
    assert.equal(listChanges('alpha').length, 1);
    assert.equal(listSpecs('alpha').length, 1);

    const replayed = advanceStageOwnershipFromDecision('alpha', 'pm', pmSummary, alphaDecision, '2026-04-03T16:20:00.000Z');
    assert.equal(replayed.changeCreated, false);
    assert.equal(replayed.specCreated, false);
    assert.equal(replayed.change.id, created.change.id);
    assert.equal(replayed.spec.id, created.spec.id);
    assert.equal(replayed.change.currentStage, 'research');
    assert.equal(replayed.change.status, 'active');
    assert.equal(replayed.spec.status, 'active');
    assert.equal(replayed.approvalReady, false);
    assert.deepEqual(replayed.linkedSourceArtifacts, []);
    assert.equal(listChanges('alpha').length, 1);
    assert.equal(listSpecs('alpha').length, 1);

    const targetChange: WorkChange = {
      id: 'change-target',
      projectId: 'beta',
      title: 'Target change',
      summary: 'Resume the intended implementation change.',
      intent: 'resume_existing_change',
      status: 'active',
      request: {
        summary: 'Resume the intended implementation change.',
        source: 'user',
      },
      scope: {
        inScope: ['Resume the correct engineering lane'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['Ownership updates stay on the resumed change'],
      },
      currentStage: 'engineering',
      stageStatus: {
        engineering: 'in_progress',
      },
      blockerIds: [],
      createdAt: '2026-04-03T14:00:00.000Z',
      updatedAt: '2026-04-03T14:30:00.000Z',
    };
    const distractingChange: WorkChange = {
      id: 'change-distractor',
      projectId: 'beta',
      title: 'Distracting active change',
      summary: 'This should not own the engineering output.',
      intent: 'implementation_only',
      status: 'active',
      request: {
        summary: 'This should not own the engineering output.',
        source: 'user',
      },
      scope: {
        inScope: ['Different work lane'],
        outOfScope: [],
        acceptanceCriteria: [],
      },
      currentStage: 'engineering',
      stageStatus: {
        engineering: 'in_progress',
      },
      blockerIds: [],
      createdAt: '2026-04-03T15:00:00.000Z',
      updatedAt: '2026-04-03T15:30:00.000Z',
    };
    const targetSpec: WorkSpec = {
      id: 'spec-change-target-v1',
      projectId: 'beta',
      changeId: 'change-target',
      version: 1,
      title: 'Target spec',
      summary: 'Existing spec should stay attached to the resumed change.',
      status: 'active',
      goals: ['Stay on the intended change'],
      constraints: [],
      acceptanceCriteria: ['Ownership does not drift'],
      sourceArtifacts: [],
      createdAt: '2026-04-03T14:10:00.000Z',
      updatedAt: '2026-04-03T14:30:00.000Z',
    };
    const distractingSpec: WorkSpec = {
      id: 'spec-change-distractor-v1',
      projectId: 'beta',
      changeId: 'change-distractor',
      version: 1,
      title: 'Distracting spec',
      summary: 'This spec should not be updated.',
      status: 'active',
      goals: ['Stay out of the target change'],
      constraints: [],
      acceptanceCriteria: [],
      sourceArtifacts: [],
      createdAt: '2026-04-03T15:10:00.000Z',
      updatedAt: '2026-04-03T15:30:00.000Z',
    };

    createChange(targetChange);
    createSpec(targetSpec);
    createChange(distractingChange);
    createSpec(distractingSpec);
    refreshLedger('beta', {
      updatedAt: '2026-04-03T15:30:00.000Z',
    });

    const resumeDecision: OrchestrationDecisionRecord = {
      schemaVersion: 1,
      projectId: 'beta',
      request: 'Resume change-target and keep the engineering lane moving toward execution.',
      decidedAt: '2026-04-03T16:30:00.000Z',
      decision: {
        intent: 'resume_existing_change',
        rationale: 'The existing engineering change should continue toward execution.',
        nextStage: 'engineering',
        recommendedStages: ['engineering', 'engineering_exec'],
        requiresHumanApproval: false,
        createChange: false,
        createSpec: false,
        directToExecution: false,
        resumeChangeId: 'change-target',
        stageDecisions: [
          { stage: 'pm', action: 'skip', reason: 'PM is already complete.' },
          { stage: 'research', action: 'skip', reason: 'Research is already complete.' },
          { stage: 'design', action: 'skip', reason: 'Design is already complete.' },
          { stage: 'engineering', action: 'invoke', reason: 'Engineering should continue the resumed change.' },
          { stage: 'engineering_exec', action: 'invoke', reason: 'Execution follows engineering completion.' },
        ],
        skippedStages: ['pm', 'research', 'design'],
      },
    };

    const engineeringSummary = 'Engineering finalized the implementation plan and prepared execution handoff.';
    const resumed = advanceStageOwnershipFromDecision(
      'beta',
      'engineering',
      engineeringSummary,
      resumeDecision,
      '2026-04-03T16:45:00.000Z',
    );

    assert.equal(resumed.changeCreated, false);
    assert.equal(resumed.specCreated, false);
    assert.equal(resumed.change.id, 'change-target');
    assert.equal(resumed.spec.id, 'spec-change-target-v1');
    assert.equal(resumed.spec.changeId, 'change-target');
    assert.equal(resumed.change.currentStage, 'engineering_exec');
    assert.equal(resumed.change.status, 'active');
    assert.equal(resumed.change.stageStatus.engineering, 'done');
    assert.equal(resumed.change.stageStatus.engineering_exec, 'ready');
    assert.equal(resumed.spec.status, 'active');
    assert.equal(resumed.spec.stageSummaries?.engineering, engineeringSummary);
    assert.equal(resumed.approvalReady, false);
    assert.deepEqual(resumed.linkedSourceArtifacts, []);
    assert.equal(getLedger('beta')?.activeChangeId, 'change-target');
    assert.equal(getLedger('beta')?.activeSpecId, 'spec-change-target-v1');

    console.log('Stage ownership update contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
