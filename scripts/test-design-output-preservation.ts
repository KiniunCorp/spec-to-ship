import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-design-output-preservation-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const { artifactPath, ensureProjectDir, writeArtifact } = await import('../src/artifacts/store.js');
    const {
      DESIGN_OUTPUT_ARTIFACTS,
      advanceStageOwnership,
      isDesignOutputArtifactLabel,
      recordOrchestrationDecision,
    } = await import('../src/index.js');

    ensureProjectDir('alpha');

    recordOrchestrationDecision(
      'alpha',
      'Define scope and provide UX outputs.',
      {
        intent: 'new_feature',
        rationale: 'The request still needs PM, research, and design stages.',
        nextStage: 'pm',
        requiresHumanApproval: false,
        createChange: true,
        createSpec: true,
        recommendedStages: ['pm', 'research', 'design'],
        stageDecisions: [
          { stage: 'pm', action: 'invoke', reason: 'Need product framing first.' },
          { stage: 'research', action: 'invoke', reason: 'Need research validation before UX.' },
          { stage: 'design', action: 'invoke', reason: 'Need interaction and visual outputs.' },
          { stage: 'engineering', action: 'skip', reason: 'Out of scope for this task.' },
          { stage: 'engineering_exec', action: 'skip', reason: 'Out of scope for this task.' },
        ],
        skippedStages: ['engineering', 'engineering_exec'],
      },
      '2026-04-04T13:00:00.000Z',
    );

    advanceStageOwnership('alpha', 'pm', 'PM output complete.', '2026-04-04T13:05:00.000Z');
    advanceStageOwnership('alpha', 'research', 'Research output complete.', '2026-04-04T13:10:00.000Z');

    writeArtifact('alpha', 'PrototypeSpec.md', '# Prototype Spec\n\nInitial pass.');
    writeArtifact('alpha', 'FigmaLink.json', '{"pageName":"Alpha Prototype","frames":[]}');
    const firstDesign = advanceStageOwnership('alpha', 'design', 'Design output complete.', '2026-04-04T13:15:00.000Z');

    assert.deepEqual(DESIGN_OUTPUT_ARTIFACTS, ['PrototypeSpec.md']);
    assert.equal(isDesignOutputArtifactLabel('PrototypeSpec.md'), true);
    assert.equal(isDesignOutputArtifactLabel('.s2s/artifacts/alpha/FigmaLink.json'), true);
    assert.equal(isDesignOutputArtifactLabel('Research.md'), false);

    const initialDesignLabels = firstDesign.spec.sourceArtifacts
      .filter((artifact) => artifact.stage === 'design')
      .map((artifact) => artifact.label)
      .sort();
    assert.deepEqual(initialDesignLabels, ['FigmaLink.json', 'PrototypeSpec.md']);

    rmSync(artifactPath('alpha', 'FigmaLink.json'));
    writeArtifact('alpha', 'PrototypeSpec.md', '# Prototype Spec\n\nSecond pass.');
    const replayedDesign = advanceStageOwnership(
      'alpha',
      'design',
      'Design output replayed with only PrototypeSpec emitted.',
      '2026-04-04T13:20:00.000Z',
    );

    const replayedDesignLabels = replayedDesign.spec.sourceArtifacts
      .filter((artifact) => artifact.stage === 'design')
      .map((artifact) => artifact.label)
      .sort();
    assert.deepEqual(replayedDesignLabels, ['FigmaLink.json', 'PrototypeSpec.md']);
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
