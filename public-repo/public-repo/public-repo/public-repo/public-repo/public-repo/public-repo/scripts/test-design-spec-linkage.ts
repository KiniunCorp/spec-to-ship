import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-design-spec-linkage-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const { advanceStageOwnership, recordOrchestrationDecision, PRIMARY_DESIGN_DEFINITION_LABEL } = await import('../src/index.js');
    const { writeArtifact } = await import('../src/artifacts/store.js');

    recordOrchestrationDecision(
      'alpha',
      'Define the product scope, validate the user risks, and produce the design handoff.',
      {
        intent: 'new_feature',
        rationale: 'This request still needs PM, research, and design artifacts.',
        nextStage: 'pm',
        recommendedStages: ['pm', 'research', 'design', 'engineering'],
        requiresHumanApproval: false,
        createChange: true,
        createSpec: true,
        directToExecution: false,
        stageDecisions: [
          { stage: 'pm', action: 'invoke', reason: 'PM must define the initial scope.' },
          { stage: 'research', action: 'invoke', reason: 'Research should validate the riskiest assumptions.' },
          { stage: 'design', action: 'invoke', reason: 'Design should produce the interaction artifacts.' },
          { stage: 'engineering', action: 'invoke', reason: 'Engineering should translate the design into a technical plan.' },
          { stage: 'engineering_exec', action: 'skip', reason: 'Execution depends on engineering planning.' },
        ],
        skippedStages: ['engineering_exec'],
      },
      '2026-04-04T12:00:00.000Z',
    );

    writeArtifact('alpha', 'PRD.md', '# PRD\n\nInitial scope.');
    advanceStageOwnership('alpha', 'pm', 'PM completed the initial PRD.', '2026-04-04T12:05:00.000Z');

    writeArtifact('alpha', 'Research.md', '# Research\n\nValidated assumptions.');
    advanceStageOwnership('alpha', 'research', 'Research validated the main workflow assumptions.', '2026-04-04T12:10:00.000Z');

    writeArtifact('alpha', 'FigmaLink.json', '{\n  "pageName": "Alpha Prototype",\n  "frames": []\n}');
    writeArtifact('alpha', 'PrototypeSpec.md', '# Prototype Spec\n\nDesign handoff.');
    const designResult = advanceStageOwnership(
      'alpha',
      'design',
      'Design finished the prototype specification and frame manifest.',
      '2026-04-04T12:15:00.000Z',
    );

    assert.equal(designResult.spec.designDefinition?.label, PRIMARY_DESIGN_DEFINITION_LABEL);
    assert.equal(designResult.spec.designDefinition?.stage, 'design');
    assert.match(designResult.spec.designDefinition?.path || '', /PrototypeSpec\.md$/);
    assert.equal(designResult.designContext?.summary, 'Design finished the prototype specification and frame manifest.');
    assert.equal(designResult.spec.designContext?.summary, 'Design finished the prototype specification and frame manifest.');
    assert.equal(designResult.spec.designContext?.designDefinition?.label, PRIMARY_DESIGN_DEFINITION_LABEL);
    assert.equal(designResult.spec.designContext?.supportingArtifacts.length, 1);
    assert.equal(designResult.spec.designContext?.supportingArtifacts[0]?.label, 'FigmaLink.json');

    writeArtifact('alpha', 'TechSpec.md', '# Tech Spec\n\nExecution handoff.');
    const engineeringResult = advanceStageOwnership(
      'alpha',
      'engineering',
      'Engineering translated the approved design into a technical plan.',
      '2026-04-04T12:20:00.000Z',
    );

    assert.equal(engineeringResult.spec.designDefinition?.label, PRIMARY_DESIGN_DEFINITION_LABEL);
    assert.match(engineeringResult.spec.designDefinition?.path || '', /PrototypeSpec\.md$/);
    assert.equal(
      engineeringResult.spec.designContext?.summary,
      'Design finished the prototype specification and frame manifest.',
    );
    assert.equal(engineeringResult.spec.designContext?.designDefinition?.label, PRIMARY_DESIGN_DEFINITION_LABEL);
    assert.equal(engineeringResult.spec.designContext?.supportingArtifacts.length, 1);
    assert.equal(engineeringResult.spec.designContext?.supportingArtifacts[0]?.label, 'FigmaLink.json');

    console.log('Design-to-spec linkage contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
