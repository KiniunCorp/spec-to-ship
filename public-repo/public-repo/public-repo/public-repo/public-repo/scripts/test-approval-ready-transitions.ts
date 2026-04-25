import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-approval-ready-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const { advanceStageOwnership, getLedger, recordOrchestrationDecision } = await import('../src/index.js');

    recordOrchestrationDecision(
      'alpha',
      'Define the scope, validate the riskiest assumptions, and then proceed once I approve each handoff.',
      {
        intent: 'new_feature',
        rationale: 'This request needs PM and research with explicit human review between stages.',
        nextStage: 'pm',
        recommendedStages: ['pm', 'research', 'design'],
        requiresHumanApproval: true,
        createChange: true,
        createSpec: true,
        directToExecution: false,
        stageDecisions: [
          { stage: 'pm', action: 'invoke', reason: 'PM should define the product scope first.' },
          { stage: 'research', action: 'invoke', reason: 'Research should validate the riskiest assumptions.' },
          { stage: 'design', action: 'invoke', reason: 'Design should translate the approved scope into interface artifacts.' },
          { stage: 'engineering', action: 'skip', reason: 'Engineering must wait for approved planning artifacts.' },
          { stage: 'engineering_exec', action: 'skip', reason: 'Execution is not ready yet.' },
        ],
        skippedStages: ['engineering', 'engineering_exec'],
      },
      '2026-04-04T10:00:00.000Z',
    );

    const approvalHeld = advanceStageOwnership(
      'alpha',
      'pm',
      'PM narrowed the MVP and captured the first acceptance criteria for review.',
      '2026-04-04T10:15:00.000Z',
    );

    assert.equal(approvalHeld.change.status, 'in_review');
    assert.equal(approvalHeld.spec.status, 'review_ready');
    assert.equal(approvalHeld.change.currentStage, 'pm');
    assert.equal(approvalHeld.completedStage, 'pm');
    assert.equal(approvalHeld.nextStage, 'research');
    assert.equal(approvalHeld.change.stageStatus.pm, 'done');
    assert.equal(approvalHeld.change.stageStatus.research, undefined);
    assert.equal(approvalHeld.approvalReady, true);
    assert.equal(getLedger('alpha')?.activeChangeId, approvalHeld.change.id);
    assert.equal(getLedger('alpha')?.activeSpecId, approvalHeld.spec.id);

    recordOrchestrationDecision(
      'beta',
      'Resume the existing implementation lane and prepare the execution handoff.',
      {
        intent: 'resume_existing_change',
        rationale: 'This route can proceed without a human gate between engineering and execution.',
        nextStage: 'engineering',
        recommendedStages: ['engineering', 'engineering_exec'],
        requiresHumanApproval: false,
        createChange: true,
        createSpec: true,
        directToExecution: false,
        stageDecisions: [
          { stage: 'pm', action: 'skip', reason: 'PM already exists.' },
          { stage: 'research', action: 'skip', reason: 'Research already exists.' },
          { stage: 'design', action: 'skip', reason: 'Design already exists.' },
          { stage: 'engineering', action: 'invoke', reason: 'Engineering should define the execution handoff.' },
          { stage: 'engineering_exec', action: 'invoke', reason: 'Execution should follow immediately.' },
        ],
        skippedStages: ['pm', 'research', 'design'],
      },
      '2026-04-04T11:00:00.000Z',
    );

    const autoAdvanced = advanceStageOwnership(
      'beta',
      'engineering',
      'Engineering finalized the execution handoff without a human gate.',
      '2026-04-04T11:20:00.000Z',
    );

    assert.equal(autoAdvanced.change.status, 'active');
    assert.equal(autoAdvanced.spec.status, 'active');
    assert.equal(autoAdvanced.change.currentStage, 'engineering_exec');
    assert.equal(autoAdvanced.completedStage, 'engineering');
    assert.equal(autoAdvanced.nextStage, 'engineering_exec');
    assert.equal(autoAdvanced.change.stageStatus.engineering, 'done');
    assert.equal(autoAdvanced.change.stageStatus.engineering_exec, 'ready');
    assert.equal(autoAdvanced.approvalReady, false);
    assert.equal(getLedger('beta')?.activeChangeId, autoAdvanced.change.id);
    assert.equal(getLedger('beta')?.activeSpecId, autoAdvanced.spec.id);

    // implementation_only must also create an approval gate before engineering_exec.
    // Historically this route had requiresHumanApproval=false, allowing the AI to
    // proceed to code execution without any human gate. That was a governance bug.
    recordOrchestrationDecision(
      'gamma',
      'Build the scaffold and run execution — but gate before code runs.',
      {
        intent: 'implementation_only',
        rationale: 'Fast-track route still requires human sign-off before code execution.',
        nextStage: 'engineering',
        recommendedStages: ['engineering', 'engineering_exec'],
        requiresHumanApproval: true,
        createChange: true,
        createSpec: true,
        directToExecution: false,
        stageDecisions: [
          { stage: 'pm', action: 'skip', reason: 'Spec already defined by the user.' },
          { stage: 'research', action: 'skip', reason: 'Not needed.' },
          { stage: 'design', action: 'skip', reason: 'Not needed.' },
          { stage: 'engineering', action: 'invoke', reason: 'Engineering should produce TechSpec + Backlog.' },
          { stage: 'engineering_exec', action: 'invoke', reason: 'Execution follows after human approval.' },
        ],
        skippedStages: ['pm', 'research', 'design'],
      },
      '2026-04-04T12:00:00.000Z',
    );

    const implOnlyGate = advanceStageOwnership(
      'gamma',
      'engineering',
      'Engineering produced TechSpec + Backlog. Awaiting human approval before code runs.',
      '2026-04-04T12:20:00.000Z',
    );

    assert.equal(implOnlyGate.change.status, 'in_review');
    assert.equal(implOnlyGate.spec.status, 'review_ready');
    assert.equal(implOnlyGate.approvalReady, true, 'implementation_only must gate before engineering_exec');

    console.log('Approval-ready lifecycle transition contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
