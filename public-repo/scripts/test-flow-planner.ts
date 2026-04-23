import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkChange, WorkRun, WorkSlice, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-flow-planner-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      buildFlowDecision,
      classifyIntent,
      createChange,
      createRun,
      createSlice,
      createSpec,
      planFlow,
      resolveContext,
    } = await import('../src/index.js');
    const { writeArtifact } = await import('../src/artifacts/store.js');

    const greenfieldDecision = planFlow('greenfield', 'Add audit logging for release approvals.');
    assert.equal(greenfieldDecision.intent, 'new_feature');
    assert.equal(greenfieldDecision.nextStage, 'pm');
    assert.deepEqual(greenfieldDecision.recommendedStages, ['pm', 'engineering']);
    assert.equal(greenfieldDecision.createChange, true);
    assert.equal(greenfieldDecision.createSpec, true);
    assert.equal(greenfieldDecision.directToExecution, false);
    assert.equal(greenfieldDecision.requiresHumanApproval, true);

    await writeArtifact('design-ready', 'PRD.md', '# PRD\n');
    await writeArtifact('design-ready', 'Research.md', '# Research\n');

    const designDecision = planFlow(
      'design-ready',
      'Add a new dashboard UI with loading states, accessibility notes, and refined microcopy.',
    );
    assert.equal(designDecision.nextStage, 'design');
    assert.deepEqual(designDecision.recommendedStages, ['design', 'engineering']);
    assert.ok(designDecision.matchedSignals?.includes('reuse:product_definition'));
    assert.ok(designDecision.matchedSignals?.includes('reuse:research_definition'));
    assert.ok(designDecision.matchedSignals?.includes('design:dashboard'));

    const artifactOnlyProjectId = 'artifact-only-design';
    await writeArtifact(artifactOnlyProjectId, 'PRD.md', '# PRD\n');
    await writeArtifact(artifactOnlyProjectId, 'Research.md', '# Research\n');
    await writeArtifact(artifactOnlyProjectId, 'PrototypeSpec.md', '# Prototype Spec\n');
    await writeArtifact(artifactOnlyProjectId, 'FigmaLink.json', '{"pageName":"Artifact Only","frames":[]}');

    createChange({
      id: 'change-artifact-only',
      projectId: artifactOnlyProjectId,
      title: 'Artifact-only design context',
      summary: 'Raw design files exist, but no spec-linked design definition is persisted yet.',
      intent: 'feature_refinement',
      status: 'active',
      request: { summary: 'Refine the interface.', source: 'user' },
      scope: { inScope: ['src/orchestrator'], outOfScope: [], acceptanceCriteria: ['design still runs until spec linkage exists'] },
      currentStage: 'design',
      activeSpecId: 'spec-artifact-only',
      stageStatus: { design: 'ready' },
      blockerIds: [],
      createdAt: '2026-04-04T09:00:00.000Z',
      updatedAt: '2026-04-04T09:00:00.000Z',
    });
    createSpec({
      id: 'spec-artifact-only',
      projectId: artifactOnlyProjectId,
      changeId: 'change-artifact-only',
      version: 1,
      title: 'Artifact-only spec',
      summary: 'Spec without persisted design linkage.',
      status: 'active',
      goals: ['link design outputs before skipping design'],
      constraints: [],
      acceptanceCriteria: ['planner must not skip design from raw files alone'],
      sourceArtifacts: [
        { path: 'PRD.md', kind: 'markdown', label: 'PRD.md', stage: 'pm' },
        { path: 'Research.md', kind: 'markdown', label: 'Research.md', stage: 'research' },
      ],
      createdAt: '2026-04-04T09:01:00.000Z',
      updatedAt: '2026-04-04T09:01:00.000Z',
    });

    const artifactOnlyDesignDecision = planFlow(
      artifactOnlyProjectId,
      'Refine the onboarding flow and icon assets for the dashboard experience.',
    );
    assert.equal(artifactOnlyDesignDecision.nextStage, 'design');
    assert.deepEqual(artifactOnlyDesignDecision.recommendedStages, ['design', 'engineering']);
    assert.ok(artifactOnlyDesignDecision.matchedSignals?.includes('design:feature flow'));
    assert.ok(artifactOnlyDesignDecision.matchedSignals?.includes('design:asset requirements'));
    assert.ok(!artifactOnlyDesignDecision.matchedSignals?.includes('reuse:design_definition'));

    const linkedDesignProjectId = 'linked-design';
    await writeArtifact(linkedDesignProjectId, 'PRD.md', '# PRD\n');
    await writeArtifact(linkedDesignProjectId, 'Research.md', '# Research\n');
    await writeArtifact(linkedDesignProjectId, 'PrototypeSpec.md', '# Prototype Spec\n');

    createChange({
      id: 'change-linked-design',
      projectId: linkedDesignProjectId,
      title: 'Linked design context',
      summary: 'The current spec already links the design definition.',
      intent: 'feature_refinement',
      status: 'active',
      request: { summary: 'Refine the linked interface.', source: 'user' },
      scope: { inScope: ['src/orchestrator'], outOfScope: [], acceptanceCriteria: ['planner reuses linked design definitions'] },
      currentStage: 'engineering',
      activeSpecId: 'spec-linked-design',
      stageStatus: { engineering: 'ready' },
      blockerIds: [],
      createdAt: '2026-04-04T09:10:00.000Z',
      updatedAt: '2026-04-04T09:10:00.000Z',
    });
    createSpec({
      id: 'spec-linked-design',
      projectId: linkedDesignProjectId,
      changeId: 'change-linked-design',
      version: 1,
      title: 'Linked design spec',
      summary: 'Spec with persisted design linkage.',
      status: 'approved',
      goals: ['reuse linked design definition'],
      constraints: [],
      acceptanceCriteria: ['planner can skip design once linkage exists'],
      sourceArtifacts: [
        { path: 'PRD.md', kind: 'markdown', label: 'PRD.md', stage: 'pm' },
        { path: 'Research.md', kind: 'markdown', label: 'Research.md', stage: 'research' },
        { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
      ],
      designDefinition: { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
      approvedAt: '2026-04-04T09:11:00.000Z',
      createdAt: '2026-04-04T09:11:00.000Z',
      updatedAt: '2026-04-04T09:11:00.000Z',
    });

    const linkedDesignDecision = planFlow(
      linkedDesignProjectId,
      'Refine the onboarding flow and icon assets for the dashboard experience.',
    );
    assert.equal(linkedDesignDecision.nextStage, 'engineering');
    assert.deepEqual(linkedDesignDecision.recommendedStages, ['engineering']);
    assert.ok(linkedDesignDecision.matchedSignals?.includes('reuse:design_definition'));

    const hotfixDecision = planFlow('ops', 'Ship an urgent hotfix for the production outage.');
    assert.equal(hotfixDecision.intent, 'hotfix');
    assert.deepEqual(hotfixDecision.recommendedStages, ['engineering', 'engineering_exec']);
    assert.equal(hotfixDecision.createSpec, false);
    assert.equal(hotfixDecision.directToExecution, true);
    assert.equal(hotfixDecision.requiresHumanApproval, false);

    const resumeProjectId = 'resume-project';
    const activeChange: WorkChange = {
      id: 'change-active',
      projectId: resumeProjectId,
      title: 'Resume active work',
      summary: 'Existing implementation work.',
      intent: 'implementation_only',
      status: 'active',
      request: { summary: 'Continue implementation.', source: 'user' },
      scope: { inScope: ['src/orchestrator'], outOfScope: ['src/cli.ts'], acceptanceCriteria: ['planner resumes work'] },
      currentStage: 'engineering',
      activeSpecId: 'spec-active',
      stageStatus: { engineering: 'in_progress' },
      blockerIds: [],
      createdAt: '2026-04-03T00:00:00.000Z',
      updatedAt: '2026-04-03T01:00:00.000Z',
    };
    const activeSpec: WorkSpec = {
      id: 'spec-active',
      projectId: resumeProjectId,
      changeId: 'change-active',
      version: 1,
      title: 'Active spec',
      summary: 'Specification for the active change.',
      status: 'approved',
      goals: ['keep implementation aligned'],
      constraints: ['stay in scope'],
      acceptanceCriteria: ['resume the right change'],
      sourceArtifacts: [],
      approvedAt: '2026-04-03T00:40:00.000Z',
      createdAt: '2026-04-03T00:10:00.000Z',
      updatedAt: '2026-04-03T00:40:00.000Z',
    };
    const openSlice: WorkSlice = {
      id: 'slice-active',
      projectId: resumeProjectId,
      changeId: 'change-active',
      specId: 'spec-active',
      title: 'Current execution slice',
      summary: 'Resume the in-progress slice.',
      status: 'in_progress',
      sequence: 1,
      priority: 'high',
      size: 's',
      dependencyIds: [],
      blockers: [],
      taskRefs: ['P2-T3'],
      acceptanceChecks: ['planner reuses active work'],
      allowedPaths: ['src/orchestrator'],
      outOfScopePaths: ['src/cli.ts'],
      relatedArtifacts: [],
      createdAt: '2026-04-03T00:15:00.000Z',
      updatedAt: '2026-04-03T01:00:00.000Z',
    };
    const openRun: WorkRun = {
      id: 'run-active',
      projectId: resumeProjectId,
      changeId: 'change-active',
      specId: 'spec-active',
      sliceId: 'slice-active',
      status: 'running',
      provider: 'codex',
      evidence: [],
      createdAt: '2026-04-03T00:20:00.000Z',
      updatedAt: '2026-04-03T01:00:00.000Z',
    };

    createChange(activeChange);
    createSpec(activeSpec);
    createSlice(openSlice);
    createRun(openRun);

    const resumeDecision = planFlow(
      resumeProjectId,
      'Resume change-active and continue the current slice work without restarting planning.',
    );
    assert.equal(resumeDecision.intent, 'resume_existing_change');
    assert.equal(resumeDecision.resumeChangeId, 'change-active');
    assert.equal(resumeDecision.nextStage, 'engineering');
    assert.deepEqual(resumeDecision.recommendedStages, ['engineering', 'engineering_exec']);
    assert.equal(resumeDecision.createChange, false);
    assert.equal(resumeDecision.createSpec, false);
    assert.equal(resumeDecision.requiresHumanApproval, false);

    const researchContext = resolveContext('research-path', 'bug_fix');
    const researchFirstDecision = buildFlowDecision(
      'Fix the sync bug, but diagnose the root cause first because the failure is intermittent.',
      {
        intent: 'bug_fix',
        confidence: 0.82,
        rationale: 'Bug fix request with additional diagnosis language.',
        matchedSignals: ['bug', 'fix'],
      },
      researchContext,
    );
    assert.deepEqual(researchFirstDecision.recommendedStages, ['research', 'engineering']);
    assert.equal(researchFirstDecision.directToExecution, false);
    assert.ok(researchFirstDecision.matchedSignals?.includes('research:root cause'));
    assert.ok(researchFirstDecision.matchedSignals?.includes('research:intermittent'));

    const specRevisionProjectId = 'spec-revision';
    createChange({
      ...activeChange,
      id: 'change-spec',
      projectId: specRevisionProjectId,
      activeSpecId: 'spec-revision-active',
    });
    createSpec({
      ...activeSpec,
      id: 'spec-revision-active',
      projectId: specRevisionProjectId,
      changeId: 'change-spec',
    });

    const specRevisionDecision = planFlow(
      specRevisionProjectId,
      'Update the spec and acceptance criteria before we continue execution.',
    );
    assert.equal(specRevisionDecision.intent, 'spec_revision');
    assert.equal(specRevisionDecision.resumeChangeId, 'change-spec');
    assert.deepEqual(specRevisionDecision.recommendedStages, ['pm', 'engineering']);
    assert.equal(specRevisionDecision.createChange, false);
    assert.equal(specRevisionDecision.createSpec, false);

    const expansionProjectId = 'flow-expansion';
    createChange({
      id: 'change-expansion',
      projectId: expansionProjectId,
      title: 'Current implementation lane',
      summary: 'A narrow engineering change is already in progress.',
      intent: 'implementation_only',
      status: 'active',
      request: { summary: 'Current implementation lane.', source: 'user' },
      scope: {
        inScope: ['src/orchestration'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['flow can expand the current change'],
      },
      currentStage: 'engineering',
      activeSpecId: 'spec-expansion',
      stageStatus: {
        engineering: 'in_progress',
      },
      blockerIds: [],
      createdAt: '2026-04-05T08:00:00.000Z',
      updatedAt: '2026-04-05T08:30:00.000Z',
    });
    createSpec({
      id: 'spec-expansion',
      projectId: expansionProjectId,
      changeId: 'change-expansion',
      version: 1,
      title: 'Current implementation spec',
      summary: 'The current change has not linked a design definition yet.',
      status: 'active',
      goals: ['preserve the current change while widening the flow'],
      constraints: [],
      acceptanceCriteria: ['reuse the active change for refinement'],
      sourceArtifacts: [],
      createdAt: '2026-04-05T08:05:00.000Z',
      updatedAt: '2026-04-05T08:30:00.000Z',
    });

    const expansionDecision = planFlow(
      expansionProjectId,
      'Refine the dashboard UI with better loading states, clearer empty states, and improved microcopy.',
    );
    assert.equal(expansionDecision.resumeChangeId, 'change-expansion');
    assert.deepEqual(expansionDecision.recommendedStages, ['design', 'engineering']);
    assert.equal(expansionDecision.createChange, false);
    assert.equal(expansionDecision.createSpec, false);
    assert.deepEqual(expansionDecision.expansion?.addedStages, ['design']);
    assert.equal(expansionDecision.expansion?.changeId, 'change-expansion');
    assert.match(expansionDecision.expansion?.rationale || '', /expand change change-expansion/i);
    assert.ok(expansionDecision.matchedSignals?.includes('flow_expansion:change-expansion'));
    assert.ok(expansionDecision.matchedSignals?.includes('flow_expansion_stage:design'));

    const backwardDesignProjectId = 'flow-backward-design';
    createChange({
      id: 'change-backward-design',
      projectId: backwardDesignProjectId,
      title: 'Existing design-reviewed change',
      summary: 'Implementation is active, but the UI needs another design pass.',
      intent: 'feature_refinement',
      status: 'active',
      request: { summary: 'Continue the current change.', source: 'user' },
      scope: {
        inScope: ['src/orchestration'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['planner can reopen design on the same change'],
      },
      currentStage: 'engineering',
      activeSpecId: 'spec-backward-design',
      stageStatus: {
        design: 'done',
        engineering: 'in_progress',
      },
      blockerIds: [],
      createdAt: '2026-04-06T08:00:00.000Z',
      updatedAt: '2026-04-06T08:20:00.000Z',
    });
    createSpec({
      id: 'spec-backward-design',
      projectId: backwardDesignProjectId,
      changeId: 'change-backward-design',
      version: 1,
      title: 'Existing design-reviewed spec',
      summary: 'The current spec already links a prior design definition.',
      status: 'approved',
      goals: ['allow design to be revisited when new feedback arrives'],
      constraints: [],
      acceptanceCriteria: ['planner reopens the design stage instead of skipping it'],
      sourceArtifacts: [
        { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
      ],
      designDefinition: { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
      approvedAt: '2026-04-06T08:10:00.000Z',
      createdAt: '2026-04-06T08:05:00.000Z',
      updatedAt: '2026-04-06T08:10:00.000Z',
    });

    const backwardDesignDecision = planFlow(
      backwardDesignProjectId,
      'Refine the dashboard UI after feedback with clearer empty states, stronger microcopy, and better loading states.',
    );
    assert.equal(backwardDesignDecision.resumeChangeId, 'change-backward-design');
    assert.deepEqual(backwardDesignDecision.recommendedStages, ['design', 'engineering']);
    assert.equal(backwardDesignDecision.createChange, false);
    assert.equal(backwardDesignDecision.createSpec, false);
    assert.deepEqual(backwardDesignDecision.expansion?.addedStages, []);
    assert.deepEqual(backwardDesignDecision.expansion?.reopenedStages, ['design']);
    assert.ok(backwardDesignDecision.matchedSignals?.includes('flow_expansion_reopened_stage:design'));

    const backwardResearchProjectId = 'flow-backward-research';
    await writeArtifact(backwardResearchProjectId, 'Research.md', '# Research\n');
    createChange({
      id: 'change-backward-research',
      projectId: backwardResearchProjectId,
      title: 'Existing implementation lane',
      summary: 'Implementation is active, but a new defect needs more diagnosis.',
      intent: 'implementation_only',
      status: 'active',
      request: { summary: 'Continue the current change.', source: 'user' },
      scope: {
        inScope: ['src/orchestration'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['planner can return to research on resume'],
      },
      currentStage: 'engineering',
      stageStatus: {
        research: 'done',
        engineering: 'in_progress',
      },
      blockerIds: [],
      createdAt: '2026-04-06T08:30:00.000Z',
      updatedAt: '2026-04-06T08:45:00.000Z',
    });

    const backwardResearchDecision = planFlow(
      backwardResearchProjectId,
      'Resume change-backward-research, diagnose the root cause first, and then continue implementation.',
    );
    assert.equal(backwardResearchDecision.intent, 'resume_existing_change');
    assert.equal(backwardResearchDecision.resumeChangeId, 'change-backward-research');
    assert.deepEqual(backwardResearchDecision.recommendedStages, ['research', 'engineering']);
    assert.equal(backwardResearchDecision.createChange, false);
    assert.equal(backwardResearchDecision.createSpec, false);
    assert.deepEqual(backwardResearchDecision.expansion?.addedStages, []);
    assert.deepEqual(backwardResearchDecision.expansion?.reopenedStages, ['research']);
    assert.ok(backwardResearchDecision.matchedSignals?.includes('flow_expansion_reopened_stage:research'));

    const classification = classifyIntent('Add a new dashboard UI with loading states.');
    assert.equal(classification.intent, 'new_feature');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
