import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { PipelineStage, RouteDecision, WorkChange, WorkRun, WorkSlice, WorkSpec } from '../src/types/index.js';

function getStageDecision(route: RouteDecision, stage: PipelineStage) {
  const decision = route.stageDecisions.find((entry) => entry.stage === stage);
  assert.ok(decision, `expected stage decision for ${stage}`);
  return decision;
}

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-stage-router-'));
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
      decideRoute,
      getLedger,
      resolveContext,
    } = await import('../src/index.js');
    const { writeArtifact } = await import('../src/artifacts/store.js');

    const greenfieldRoute = decideRoute('greenfield', 'Add audit logging for release approvals.');
    assert.equal(greenfieldRoute.intent, 'new_feature');
    assert.deepEqual(greenfieldRoute.recommendedStages, ['pm', 'engineering']);
    assert.equal(getStageDecision(greenfieldRoute, 'pm').action, 'invoke');
    assert.match(getStageDecision(greenfieldRoute, 'pm').reason, /product framing|spec definition/i);
    assert.equal(getStageDecision(greenfieldRoute, 'research').action, 'skip');
    assert.equal(getStageDecision(greenfieldRoute, 'design').action, 'skip');
    assert.equal(getStageDecision(greenfieldRoute, 'engineering').action, 'invoke');
    assert.equal(getStageDecision(greenfieldRoute, 'engineering_exec').action, 'skip');
    assert.deepEqual(greenfieldRoute.skippedStages, ['research', 'design', 'engineering_exec']);
    assert.equal(getLedger('greenfield')?.lastDecision?.decision.intent, 'new_feature');
    assert.equal(getLedger('greenfield')?.lastDecision?.request, 'Add audit logging for release approvals.');
    assert.equal(getLedger('greenfield')?.lastDecision?.decision.stageDecisions.length, 5);

    await writeArtifact('design-ready', 'PRD.md', '# PRD\n');
    await writeArtifact('design-ready', 'Research.md', '# Research\n');

    const designRoute = decideRoute(
      'design-ready',
      'Add a new dashboard UI with loading states, accessibility notes, and refined microcopy.',
    );
    assert.deepEqual(designRoute.recommendedStages, ['design', 'engineering']);
    assert.equal(getStageDecision(designRoute, 'pm').action, 'skip');
    assert.match(getStageDecision(designRoute, 'pm').reason, /existing product\/spec artifacts/i);
    assert.equal(getStageDecision(designRoute, 'research').action, 'skip');
    assert.match(getStageDecision(designRoute, 'research').reason, /existing research artifacts/i);
    assert.equal(getStageDecision(designRoute, 'design').action, 'invoke');
    assert.match(getStageDecision(designRoute, 'design').reason, /dashboard|loading states|accessibility|microcopy/i);

    const artifactOnlyProjectId = 'artifact-only-design';
    await writeArtifact(artifactOnlyProjectId, 'PRD.md', '# PRD\n');
    await writeArtifact(artifactOnlyProjectId, 'Research.md', '# Research\n');
    await writeArtifact(artifactOnlyProjectId, 'PrototypeSpec.md', '# Prototype Spec\n');
    await writeArtifact(artifactOnlyProjectId, 'FigmaLink.json', '{"pageName":"Artifact Only","frames":[]}');

    createChange({
      id: 'change-artifact-only',
      projectId: artifactOnlyProjectId,
      title: 'Artifact-only design context',
      summary: 'Raw design files exist without a spec-linked design definition.',
      intent: 'feature_refinement',
      status: 'active',
      request: { summary: 'Refine the interface.', source: 'user' },
      scope: { inScope: ['src/orchestrator'], outOfScope: [], acceptanceCriteria: ['router must still invoke design'] },
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
      summary: 'Spec without designDefinition.',
      status: 'active',
      goals: ['invoke design until the spec links the design definition'],
      constraints: [],
      acceptanceCriteria: ['raw design files alone are not enough to skip design'],
      sourceArtifacts: [
        { path: 'PRD.md', kind: 'markdown', label: 'PRD.md', stage: 'pm' },
        { path: 'Research.md', kind: 'markdown', label: 'Research.md', stage: 'research' },
      ],
      createdAt: '2026-04-04T09:01:00.000Z',
      updatedAt: '2026-04-04T09:01:00.000Z',
    });

    const artifactOnlyRoute = decideRoute(
      artifactOnlyProjectId,
      'Refine the onboarding flow and icon assets for the dashboard experience.',
    );
    assert.deepEqual(artifactOnlyRoute.recommendedStages, ['design', 'engineering']);
    assert.equal(getStageDecision(artifactOnlyRoute, 'design').action, 'invoke');
    assert.match(getStageDecision(artifactOnlyRoute, 'design').reason, /feature flow|asset requirements|dashboard/i);

    const linkedDesignProjectId = 'linked-design';
    await writeArtifact(linkedDesignProjectId, 'PRD.md', '# PRD\n');
    await writeArtifact(linkedDesignProjectId, 'Research.md', '# Research\n');
    await writeArtifact(linkedDesignProjectId, 'PrototypeSpec.md', '# Prototype Spec\n');

    createChange({
      id: 'change-linked-design',
      projectId: linkedDesignProjectId,
      title: 'Linked design context',
      summary: 'Current spec already links the design definition.',
      intent: 'feature_refinement',
      status: 'active',
      request: { summary: 'Refine the interface.', source: 'user' },
      scope: { inScope: ['src/orchestrator'], outOfScope: [], acceptanceCriteria: ['router may skip linked design'] },
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
      acceptanceCriteria: ['skip design from the current spec linkage'],
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

    const linkedDesignRoute = decideRoute(
      linkedDesignProjectId,
      'Refine the onboarding flow and icon assets for the dashboard experience.',
    );
    assert.deepEqual(linkedDesignRoute.recommendedStages, ['engineering']);
    assert.equal(getStageDecision(linkedDesignRoute, 'design').action, 'skip');
    assert.match(getStageDecision(linkedDesignRoute, 'design').reason, /current spec already carries the linked design definition/i);

    const hotfixRoute = decideRoute('ops', 'Ship an urgent hotfix for the production outage.');
    assert.equal(hotfixRoute.intent, 'hotfix');
    assert.deepEqual(hotfixRoute.recommendedStages, ['engineering', 'engineering_exec']);
    assert.equal(getStageDecision(hotfixRoute, 'pm').action, 'skip');
    assert.equal(getStageDecision(hotfixRoute, 'research').action, 'skip');
    assert.equal(getStageDecision(hotfixRoute, 'design').action, 'skip');
    assert.equal(getStageDecision(hotfixRoute, 'engineering_exec').action, 'invoke');
    assert.match(getStageDecision(hotfixRoute, 'engineering_exec').reason, /explicit execution path/i);

    const resumeProjectId = 'resume-project';
    const activeChange: WorkChange = {
      id: 'change-active',
      projectId: resumeProjectId,
      title: 'Resume active work',
      summary: 'Existing implementation work.',
      intent: 'implementation_only',
      status: 'active',
      request: { summary: 'Continue implementation.', source: 'user' },
      scope: { inScope: ['src/orchestrator'], outOfScope: ['src/cli.ts'], acceptanceCriteria: ['router resumes work'] },
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
      taskRefs: ['P2-T4'],
      acceptanceChecks: ['router reuses active work'],
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

    const resumeRoute = decideRoute(
      resumeProjectId,
      'Resume change-active and continue the current slice work without restarting planning.',
    );
    assert.equal(resumeRoute.resumeChangeId, 'change-active');
    assert.deepEqual(resumeRoute.recommendedStages, ['engineering', 'engineering_exec']);
    assert.match(getStageDecision(resumeRoute, 'engineering').reason, /continue change change-active/i);
    assert.match(getStageDecision(resumeRoute, 'engineering_exec').reason, /resumable slice\/run context/i);

    const investigationDecision = buildFlowDecision(
      'Investigate the production incident and write the root cause summary.',
      classifyIntent('Investigate the production incident and write the root cause summary.'),
      resolveContext('incident-project', 'incident_investigation'),
    );
    const investigationRoute = (await import('../src/index.js')).buildRouteDecision(investigationDecision);
    assert.deepEqual(investigationRoute.recommendedStages, ['research']);
    assert.equal(getStageDecision(investigationRoute, 'research').action, 'invoke');
    assert.match(getStageDecision(investigationRoute, 'research').reason, /root-cause/i);
    assert.equal(getStageDecision(investigationRoute, 'engineering').action, 'skip');

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
        acceptanceCriteria: ['router explains expanded flow reuse'],
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

    const expansionRoute = decideRoute(
      expansionProjectId,
      'Refine the dashboard UI with better loading states, clearer empty states, and improved microcopy.',
    );
    assert.equal(expansionRoute.resumeChangeId, 'change-expansion');
    assert.deepEqual(expansionRoute.expansion?.addedStages, ['design']);
    assert.equal(getStageDecision(expansionRoute, 'design').action, 'invoke');
    assert.match(getStageDecision(expansionRoute, 'design').reason, /expand beyond the current implementation scope/i);
    assert.equal(getStageDecision(expansionRoute, 'engineering').action, 'invoke');
    assert.match(getStageDecision(expansionRoute, 'engineering').reason, /after rerouted upstream work on change change-expansion/i);

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
        acceptanceCriteria: ['router explains reopened design work'],
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
      acceptanceCriteria: ['router reopens the design stage instead of skipping it'],
      sourceArtifacts: [
        { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
      ],
      designDefinition: { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
      approvedAt: '2026-04-06T08:10:00.000Z',
      createdAt: '2026-04-06T08:05:00.000Z',
      updatedAt: '2026-04-06T08:10:00.000Z',
    });

    const backwardDesignRoute = decideRoute(
      backwardDesignProjectId,
      'Refine the dashboard UI after feedback with clearer empty states, stronger microcopy, and better loading states.',
    );
    assert.equal(backwardDesignRoute.resumeChangeId, 'change-backward-design');
    assert.deepEqual(backwardDesignRoute.expansion?.reopenedStages, ['design']);
    assert.equal(getStageDecision(backwardDesignRoute, 'design').action, 'invoke');
    assert.match(getStageDecision(backwardDesignRoute, 'design').reason, /updated interface definition/i);
    assert.equal(getStageDecision(backwardDesignRoute, 'engineering').action, 'invoke');
    assert.match(getStageDecision(backwardDesignRoute, 'engineering').reason, /after rerouted upstream work on change change-backward-design/i);

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
        acceptanceCriteria: ['router explains reopened research work'],
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

    const backwardResearchRoute = decideRoute(
      backwardResearchProjectId,
      'Resume change-backward-research, diagnose the root cause first, and then continue implementation.',
    );
    assert.equal(backwardResearchRoute.resumeChangeId, 'change-backward-research');
    assert.deepEqual(backwardResearchRoute.expansion?.reopenedStages, ['research']);
    assert.equal(getStageDecision(backwardResearchRoute, 'research').action, 'invoke');
    assert.match(getStageDecision(backwardResearchRoute, 'research').reason, /fresh technical investigation/i);
    assert.equal(getStageDecision(backwardResearchRoute, 'engineering').action, 'invoke');
    assert.match(getStageDecision(backwardResearchRoute, 'engineering').reason, /after rerouted upstream work on change change-backward-research/i);
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
