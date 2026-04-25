/**
 * End-to-end test: orchestrated stage flow using convenience functions.
 *
 * Validates the same path the CLI now uses:
 *   initializeSpec() -> advanceStageOwnership() -> deriveAndPersistSlices()
 *
 * This proves that the full workflow works without explicit decision records,
 * matching the real `handleStageCommand()` integration.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-orchestrated-flow-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      initializeSpec,
      advanceStageOwnership,
      deriveAndPersistSlices,
      parseSliceDerivationInput,
      getLedger,
      getChange,
      listSlices,
      listChanges,
      listSpecs,
      resolveExecutableSliceSelection,
      createWorkGate,
      listGates,
      approveGate,
    } = await import('../src/index.js');
    const { readArtifact, writeArtifact } = await import('../src/artifacts/store.js');

    const projectId = 'flow-test';

    // ── Step 1: initializeSpec (same as CLI before runStage) ──
    const pmInit = initializeSpec(projectId, 'Run pm stage for project flow-test', '2026-04-07T12:00:00.000Z');
    assert.equal(pmInit.changeCreated, true, 'First call should create a change');
    assert.equal(pmInit.specCreated, true, 'First call should create a spec');
    assert.equal(pmInit.change.currentStage, 'pm');
    assert.equal(pmInit.change.status, 'draft');
    assert.equal(pmInit.spec.status, 'draft');
    assert.equal(getLedger(projectId)?.activeChangeId, pmInit.change.id);

    const decision = pmInit.decision.decision;

    // ── Step 2: Simulate PM agent output + advance ──
    writeArtifact(projectId, 'PRD.md', '# PRD\n\n- Build a release dashboard.\n');
    const pmAdvance = advanceStageOwnership(projectId, 'pm', 'PM defined scope.', '2026-04-07T12:05:00.000Z');
    assert.equal(pmAdvance.change.stageStatus.pm, 'done');
    assert.ok(pmAdvance.spec.stageSummaries?.pm);

    // When approval is required, currentStage holds at the completed stage.
    // The nextStage field tells us where to go after approval.
    if (decision.requiresHumanApproval) {
      assert.equal(pmAdvance.approvalReady, true);
    }

    // ── Step 3: Walk through remaining stages ──
    // Each stage: initializeSpec (idempotent) -> write artifacts -> advanceStageOwnership
    const stages: Array<{ stage: string; artifact: string; content: string; summary: string }> = [];
    for (const recommended of decision.recommendedStages) {
      if (recommended === 'pm') continue; // already done
      if (recommended === 'engineering_exec') continue; // handled separately
      if (recommended === 'research') {
        stages.push({
          stage: 'research',
          artifact: 'Research.md',
          content: '# Research\n\n## Investigation Goal\n- Validate dashboard architecture.\n',
          summary: 'Research confirmed architecture is sound.',
        });
      }
      if (recommended === 'design') {
        stages.push({
          stage: 'design',
          artifact: 'PrototypeSpec.md',
          content: '# Prototype Spec\n\n- Dashboard layout with gates.\n',
          summary: 'Design defined the dashboard layout.',
        });
      }
      if (recommended === 'engineering') {
        stages.push({
          stage: 'engineering',
          artifact: 'TechSpec.md',
          content: `# Technical Specification

## Architecture Overview
A release dashboard with approval gate integration.

## Data Model
Change, Spec, Slice, Run, Gate entities.

## API / Integration points
None for MVP.

## Risk & Security Notes
Validate approval state transitions.

## Implementation Plan
1. Build the dashboard component.
2. Wire approval gates.

## Test Plan
Verify dashboard renders and gates work.
`,
          summary: 'Engineering derived the execution plan.',
        });
      }
    }

    let lastAdvance = pmAdvance;
    for (const { stage, artifact, content, summary } of stages) {
      // Subsequent stages skip initializeSpec — the active change and decision already exist
      // advanceStageOwnership reads the last decision from the ledger
      writeArtifact(projectId, artifact, content);
      if (stage === 'engineering') {
        writeArtifact(
          projectId,
          'Backlog.md',
          `| ID | Priority | Task | Description | Estimate | Dependencies | Acceptance Criteria | Allowed Paths | Out of Scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ENG-001 | high | Build dashboard | Implement the release dashboard. | 1d | none | Dashboard renders | src/components/ | src/api/ |
`,
        );
      }
      lastAdvance = advanceStageOwnership(projectId, stage as any, summary);
      assert.equal(lastAdvance.change.stageStatus[stage as keyof typeof lastAdvance.change.stageStatus], 'done',
        `${stage} should be marked done`);
    }

    // ── Step 4: Derive slices after engineering ──
    const techSpecContent = readArtifact(projectId, 'TechSpec.md');
    const backlogContent = readArtifact(projectId, 'Backlog.md');
    assert.ok(techSpecContent, 'TechSpec.md should exist after engineering');
    assert.ok(backlogContent, 'Backlog.md should exist after engineering');

    const sliceResult = deriveAndPersistSlices(
      parseSliceDerivationInput({
        projectId,
        change: lastAdvance.change,
        spec: lastAdvance.spec,
        techSpecContent: String(techSpecContent),
        backlogContent: String(backlogContent),
      }),
    );

    assert.ok(sliceResult.slices.length >= 1, 'Should derive at least 1 slice');
    assert.equal(sliceResult.slices[0]?.status, 'ready');

    // ── Step 5: Verify slice selection works ──
    const selection = resolveExecutableSliceSelection(projectId);
    assert.ok(selection.selectedSlice, 'Should find an executable slice');

    // ── Step 6: Verify gate lifecycle works ──
    const gateResult = createWorkGate(projectId, {
      changeId: lastAdvance.change.id,
      type: 'spec_review',
      title: 'Review engineering completion',
      reason: 'Engineering completed, requires approval.',
      specId: lastAdvance.spec.id,
    });
    assert.equal(gateResult.gate.status, 'pending');
    const approved = approveGate(projectId, gateResult.gate.id);
    assert.equal(approved.gate.status, 'approved');

    // ── Step 7: Verify refinement via initializeSpec with refine prompt ──
    const specCountBefore = listSpecs(projectId).length;
    const refineResult = initializeSpec(projectId, 'Refine the active change through engineering stage');
    assert.equal(refineResult.change.id, pmInit.change.id, 'Refinement should reuse existing change');
    // The orchestrator may create a refinement spec version or reuse the existing one
    assert.ok(listSpecs(projectId).length >= specCountBefore, 'Refinement should not lose specs');

    // ── Step 8: Verify final state consistency ──
    assert.equal(listChanges(projectId).length, 1, 'Should have exactly 1 change');
    assert.ok(listSpecs(projectId).length >= 1, 'Should have at least 1 spec');
    assert.ok(listSlices(projectId).length >= 1, 'Should have at least 1 slice');
    assert.equal(listGates(projectId).length, 1, 'Should have exactly 1 gate');

    const finalLedger = getLedger(projectId);
    assert.ok(finalLedger);
    assert.equal(finalLedger.activeChangeId, pmInit.change.id);

    const finalChange = getChange(projectId, pmInit.change.id);
    assert.ok(finalChange);
    assert.equal(finalChange.stageStatus.pm, 'done');
    assert.equal(finalChange.stageStatus.engineering, 'done');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }

  console.log('Orchestrated stage flow check passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
