import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-source-artifact-linkage-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const { advanceStageOwnership, recordOrchestrationDecision } = await import('../src/index.js');
    const { writeArtifact } = await import('../src/artifacts/store.js');

    recordOrchestrationDecision(
      'alpha',
      'Define the product scope, validate the user risks, and produce the design handoff.',
      {
        intent: 'new_feature',
        rationale: 'This request still needs PM, research, and design artifacts.',
        nextStage: 'pm',
        recommendedStages: ['pm', 'research', 'design'],
        requiresHumanApproval: false,
        createChange: true,
        createSpec: true,
        directToExecution: false,
        stageDecisions: [
          { stage: 'pm', action: 'invoke', reason: 'PM must define the initial scope.' },
          { stage: 'research', action: 'invoke', reason: 'Research should validate the riskiest assumptions.' },
          { stage: 'design', action: 'invoke', reason: 'Design should produce the interaction artifacts.' },
          { stage: 'engineering', action: 'skip', reason: 'Engineering is not ready yet.' },
          { stage: 'engineering_exec', action: 'skip', reason: 'Execution depends on engineering planning.' },
        ],
        skippedStages: ['engineering', 'engineering_exec'],
      },
      '2026-04-03T17:00:00.000Z',
    );

    writeArtifact('alpha', 'PRD.md', '# PRD\n\nInitial scope.');
    const pmResult = advanceStageOwnership('alpha', 'pm', 'PM completed the initial PRD.', '2026-04-03T17:05:00.000Z');
    assert.equal(pmResult.change.status, 'active');
    assert.equal(pmResult.spec.status, 'active');
    assert.equal(pmResult.approvalReady, false);
    assert.deepEqual(pmResult.linkedSourceArtifacts.map((artifact) => artifact.label), ['PRD.md']);
    assert.deepEqual(pmResult.spec.sourceArtifacts.map((artifact) => artifact.label), ['PRD.md']);

    writeArtifact('alpha', 'Research.md', '# Research\n\nValidated assumptions.');
    const researchResult = advanceStageOwnership(
      'alpha',
      'research',
      'Research validated the main workflow assumptions.',
      '2026-04-03T17:10:00.000Z',
    );
    assert.equal(researchResult.change.status, 'active');
    assert.equal(researchResult.spec.status, 'active');
    assert.equal(researchResult.approvalReady, false);
    assert.deepEqual(researchResult.linkedSourceArtifacts.map((artifact) => artifact.label), ['Research.md']);
    assert.deepEqual(researchResult.spec.sourceArtifacts.map((artifact) => artifact.label), ['PRD.md', 'Research.md']);

    writeArtifact('alpha', 'PrototypeSpec.md', '# Prototype Spec\n\nDesign handoff.');
    writeArtifact('alpha', 'FigmaLink.json', '{\n  "pageName": "Alpha Prototype",\n  "frames": []\n}');
    const designResult = advanceStageOwnership(
      'alpha',
      'design',
      'Design finished the prototype specification and frame manifest.',
      '2026-04-03T17:15:00.000Z',
    );
    assert.equal(designResult.change.status, 'active');
    assert.equal(designResult.spec.status, 'active');
    assert.equal(designResult.approvalReady, false);
    assert.deepEqual(
      designResult.linkedSourceArtifacts.map((artifact) => artifact.label),
      ['FigmaLink.json', 'PrototypeSpec.md'],
    );
    assert.deepEqual(
      designResult.spec.sourceArtifacts.map((artifact) => artifact.label),
      ['PRD.md', 'Research.md', 'FigmaLink.json', 'PrototypeSpec.md'],
    );
    assert.equal(designResult.spec.designDefinition?.label, 'PrototypeSpec.md');
    assert.match(designResult.spec.designDefinition?.path || '', /PrototypeSpec\.md$/);

    writeArtifact('alpha', 'PrototypeSpec.md', '# Prototype Spec\n\nDesign handoff revised.');
    const replayedDesign = advanceStageOwnership(
      'alpha',
      'design',
      'Design refreshed the prototype specification.',
      '2026-04-03T17:20:00.000Z',
    );
    assert.equal(replayedDesign.change.status, 'active');
    assert.equal(replayedDesign.spec.status, 'active');
    assert.equal(replayedDesign.approvalReady, false);
    assert.deepEqual(
      replayedDesign.linkedSourceArtifacts.map((artifact) => artifact.label),
      ['FigmaLink.json', 'PrototypeSpec.md'],
    );
    assert.deepEqual(
      replayedDesign.spec.sourceArtifacts.map((artifact) => artifact.label),
      ['PRD.md', 'Research.md', 'FigmaLink.json', 'PrototypeSpec.md'],
    );
    assert.equal(replayedDesign.spec.designDefinition?.label, 'PrototypeSpec.md');
    assert.match(replayedDesign.spec.designDefinition?.path || '', /PrototypeSpec\.md$/);

    console.log('Source artifact linkage contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
