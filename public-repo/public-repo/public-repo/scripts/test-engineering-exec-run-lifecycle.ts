import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RuntimeConfig, WorkChange, WorkSlice, WorkSpec } from '../src/types/index.js';

function buildChange(projectId: string, changeId: string, specId: string, summary: string): WorkChange {
  return {
    id: changeId,
    projectId,
    title: 'Engineering exec run lifecycle',
    summary,
    intent: 'implementation_only',
    status: 'active',
    request: { summary: 'Run one explicit slice.', source: 'user' },
    scope: {
      inScope: ['src/runtime', 'src/ledger'],
      outOfScope: ['src/cli.ts'],
      acceptanceCriteria: ['dry-run still records a run'],
    },
    currentStage: 'engineering_exec',
    activeSpecId: specId,
    stageStatus: {
      engineering: 'done',
      engineering_exec: 'ready',
    },
    blockerIds: [],
    createdAt: '2026-04-04T21:00:00.000Z',
    updatedAt: '2026-04-04T21:00:00.000Z',
  };
}

function buildSpec(projectId: string, changeId: string, specId: string, summary: string): WorkSpec {
  return {
    id: specId,
    projectId,
    changeId,
    version: 1,
    title: 'Explicit execution target',
    summary,
    status: 'approved',
    goals: ['run from persisted slices'],
    constraints: ['selection policy stays separate'],
    acceptanceCriteria: ['engineering_exec records run lifecycle from explicit slice IDs'],
    sourceArtifacts: [{ path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' }],
    designDefinition: { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
    designContext: {
      summary: 'Honor the approved operator UX and empty-state behavior.',
      designDefinition: { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
      supportingArtifacts: [{ path: 'FigmaLink.json', kind: 'json', label: 'FigmaLink.json', stage: 'design' }],
    },
    approvedAt: '2026-04-04T21:01:00.000Z',
    createdAt: '2026-04-04T21:00:00.000Z',
    updatedAt: '2026-04-04T21:01:00.000Z',
  };
}

function buildSlice(projectId: string, changeId: string, specId: string, overrides: Partial<WorkSlice>): WorkSlice {
  return {
    id: 'slice-default',
    projectId,
    changeId,
    specId,
    title: 'Happy path slice',
    summary: 'A stored slice for engineering execution.',
    status: 'ready',
    sequence: 1,
    priority: 'high',
    size: 's',
    dependencyIds: [],
    blockers: [],
    taskRefs: ['P6-T4'],
    sourceTaskIds: ['ENG-001'],
    taskSubset: [
      {
        taskId: 'ENG-001',
        title: 'Persist slice-scoped execution context',
        summary: 'Generate a contract document before engineering execution starts.',
        dependencyIds: [],
      },
    ],
    acceptanceChecks: ['verification output captured'],
    allowedPaths: ['src/runtime'],
    outOfScopePaths: ['src/cli.ts'],
    relatedArtifacts: [
      { path: 'TechSpec.md', kind: 'markdown', label: 'TechSpec.md', stage: 'engineering' },
      { path: 'Backlog.md', kind: 'markdown', label: 'Backlog.md', stage: 'engineering' },
    ],
    implementationNotes: ['Do not fall back to backlog-first execution state.'],
    createdAt: '2026-04-04T21:02:00.000Z',
    updatedAt: '2026-04-04T21:02:00.000Z',
    ...overrides,
  };
}

function setupAppRepo(sandbox: string, suffix: string): { appRepoPath: string; worktreesRootPath: string } {
  const appRepoPath = path.join(sandbox, `demo-app-${suffix}`);
  const worktreesRootPath = path.join(sandbox, `demo-app-${suffix}-worktrees`);
  mkdirSync(appRepoPath, { recursive: true });
  writeFileSync(path.join(appRepoPath, 'README.md'), '# demo\n', 'utf8');
  return { appRepoPath, worktreesRootPath };
}

function assertGenericEntryArtifactsRemoved(readArtifact: (projectId: string, fileName: string) => string | null, projectId: string): void {
  assert.equal(readArtifact(projectId, 'ExecutionPlan.md'), null);
  assert.equal(readArtifact(projectId, 'EngineeringOpenSpecDraft.md'), null);
}

function buildRuntimeConfig(commandTemplate: string, overrides: Partial<RuntimeConfig['execution']> = {}): RuntimeConfig {
  return {
    productName: 'spec-to-ship',
    defaultBranch: 'main',
    guardrailPolicy: 'warn',
    workspace: {
      basePath: '.',
      orchestratorDirName: '.',
      projectDirName: 'demo-app',
      worktreesDirName: 'demo-app-worktrees',
    },
    github: {
      remoteName: 'origin',
      autoPush: false,
      autoPR: false,
      autoMerge: false,
    },
    execution: {
      mode: 'shell',
      templateId: '',
      commandTemplate,
      maxTasksPerRun: 3,
      stopOnFailure: true,
      timeoutMs: 120000,
      allowedCommands: ['node'],
      allowUnsafeRawCommand: true,
      ...overrides,
    },
    costControl: {
      enabled: false,
      budgetUsd: 0,
      warnThresholdPct: 80,
      hardStopThresholdPct: 100,
    },
    chatObservability: {
      sessionBannerEnabled: false,
      wrapperPrefixEnabled: false,
      wrapperPrefixTemplate: '',
    },
    versioning: {
      enforceSemverBumpOnDelivery: false,
      requireChangelogUpdate: false,
      manifestFile: 'package.json',
      changelogFile: 'CHANGELOG.md',
    },
  };
}

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-engineering-exec-run-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      advanceStageOwnershipFromDecision,
      buildEngineeringExecutionHandoff,
      createChange,
      createSlice,
      createSpec,
      deriveAndPersistSlices,
      executeOpenSpecTasks,
      getRun,
      getSlice,
      getLedger,
      initializeSpecFromDecision,
      materializeOpenSpecChange,
      parseSliceDerivationInput,
      recordOrchestrationDecision,
      runEngineeringExecution,
    } = await import('../src/index.js');
    const { readArtifact, writeArtifact } = await import('../src/artifacts/store.js');

    {
      const projectId = 'alpha-happy-path';
      const { appRepoPath, worktreesRootPath } = setupAppRepo(sandbox, 'happy-path');
      const prompt = 'Ship the release-hardening workflow from planning through slice-first execution.';
      const decision = recordOrchestrationDecision(
        projectId,
        prompt,
        {
          intent: 'new_feature',
          rationale: 'A new release-hardening workflow needs full staged planning before execution starts.',
          nextStage: 'pm',
          recommendedStages: ['pm', 'research', 'design', 'engineering', 'engineering_exec'],
          requiresHumanApproval: false,
          createChange: true,
          createSpec: true,
          directToExecution: false,
          stageDecisions: [
            { stage: 'pm', action: 'invoke', reason: 'PM should define the release-hardening scope.' },
            { stage: 'research', action: 'invoke', reason: 'Research should resolve the technical validation gaps.' },
            { stage: 'design', action: 'invoke', reason: 'Design should clarify the operator-facing workflow.' },
            { stage: 'engineering', action: 'invoke', reason: 'Engineering should derive the execution-ready slice plan.' },
            { stage: 'engineering_exec', action: 'invoke', reason: 'Execution should run from the persisted slice plan.' },
          ],
          skippedStages: [],
        },
        '2026-04-07T10:00:00.000Z',
      );
      const initialized = initializeSpecFromDecision(projectId, decision);

      assert.equal(initialized.changeCreated, true);
      assert.equal(initialized.specCreated, true);
      assert.equal(initialized.change.currentStage, 'pm');
      assert.equal(initialized.change.activeSpecId, initialized.spec.id);
      assert.equal(initialized.spec.status, 'draft');
      assert.deepEqual(initialized.spec.goals, [prompt]);

      writeArtifact(projectId, 'PRD.md', '# PRD\n\n- Keep release validation truthful and slice-first.\n');
      const pmSummary = 'PM framed the release-hardening scope and acceptance criteria.';
      const pmResult = advanceStageOwnershipFromDecision(projectId, 'pm', pmSummary, decision, '2026-04-07T10:05:00.000Z');
      assert.equal(pmResult.change.currentStage, 'research');
      assert.equal(pmResult.spec.stageSummaries?.pm, pmSummary);

      writeArtifact(
        projectId,
        'Research.md',
        '# Research\n\n## Investigation Goal\n- Confirm the exact release validation gaps.\n',
      );
      const researchSummary = 'Research captured the technical investigation needed to close the release gaps.';
      const researchResult = advanceStageOwnershipFromDecision(
        projectId,
        'research',
        researchSummary,
        decision,
        '2026-04-07T10:10:00.000Z',
      );
      assert.equal(researchResult.change.currentStage, 'design');
      assert.equal(researchResult.spec.stageSummaries?.research, researchSummary);

      writeArtifact(projectId, 'PrototypeSpec.md', '# Prototype Spec\n\n- Show the release gate and slice status together.\n');
      const designSummary = 'Design defined the operator-facing release hardening workflow.';
      const designResult = advanceStageOwnershipFromDecision(
        projectId,
        'design',
        designSummary,
        decision,
        '2026-04-07T10:15:00.000Z',
      );
      assert.equal(designResult.change.currentStage, 'engineering');
      assert.equal(designResult.spec.stageSummaries?.design, designSummary);

      writeArtifact(
        projectId,
        'TechSpec.md',
        `# Technical Specification

## Architecture Overview
Release validation should stay truthful by reading persisted change, spec, slice, run, and gate state.

## Data Model
The release smoke covers initialized repositories, active workflow records, and slice-first execution state.

## API / Integration points
None.

## Risk & Security Notes
Do not allow legacy pipeline state to contradict initialized operational state.

## Implementation Plan
1. Initialize the managed repository state.
2. Advance staged ownership through engineering.
3. Derive persisted slices from the engineering plan.
4. Execute the next ready slice through engineering_exec.

## Test Plan
Verify init-to-status truthfulness, real operational inspection, and slice-first execution.
`,
      );
      writeArtifact(
        projectId,
        'Backlog.md',
        `| ID | Priority | Task | Description | Estimate | Dependencies | Acceptance Criteria | Allowed Paths | Out of Scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ENG-301 | high | Ship release smoke | Add end-to-end release hardening regression coverage. | 1d | none | init to status is truthful;execution is slice first | scripts/test-cli-v1-contract.sh, scripts/test-engineering-exec-run-lifecycle.ts | src/runtime/worktree-provider.ts |
`,
      );
      const engineeringSummary = 'Engineering finalized the release-hardening plan and derived an execution-ready slice.';
      const engineeringResult = advanceStageOwnershipFromDecision(
        projectId,
        'engineering',
        engineeringSummary,
        decision,
        '2026-04-07T10:20:00.000Z',
      );

      assert.equal(engineeringResult.change.currentStage, 'engineering_exec');
      assert.equal(engineeringResult.change.stageStatus.engineering, 'done');
      assert.equal(engineeringResult.change.stageStatus.engineering_exec, 'ready');
      assert.equal(engineeringResult.spec.status, 'active');
      assert.equal(engineeringResult.spec.stageSummaries?.engineering, engineeringSummary);
      assert.ok(engineeringResult.spec.sourceArtifacts.some((artifact) => artifact.label === 'Research.md'));
      assert.ok(engineeringResult.spec.sourceArtifacts.some((artifact) => artifact.label === 'TechSpec.md'));
      assert.ok(engineeringResult.spec.sourceArtifacts.some((artifact) => artifact.label === 'Backlog.md'));

      const techSpecContent = readArtifact(projectId, 'TechSpec.md');
      const backlogContent = readArtifact(projectId, 'Backlog.md');
      assert.ok(techSpecContent);
      assert.ok(backlogContent);

      const persistedSlices = deriveAndPersistSlices(
        parseSliceDerivationInput({
          projectId,
          change: engineeringResult.change,
          spec: engineeringResult.spec,
          techSpecContent: String(techSpecContent),
          backlogContent: String(backlogContent),
        }),
        {
          persistedAt: '2026-04-07T10:25:00.000Z',
        },
      );

      assert.equal(persistedSlices.slices.length, 1);
      assert.equal(persistedSlices.slices[0]?.status, 'ready');
      assert.deepEqual(persistedSlices.slices[0]?.sourceTaskIds, ['ENG-301']);
      assert.equal(getLedger(projectId)?.activeChangeId, engineeringResult.change.id);
      assert.equal(getLedger(projectId)?.activeSpecId, engineeringResult.spec.id);

      const result = await runEngineeringExecution(projectId, {
        appName: 'demo-app-happy-path',
        appRepoPath,
        worktreesRootPath,
        changeId: engineeringResult.change.id,
        dryRun: true,
        initializeLocalGitIfMissing: false,
      });

      assert.equal(result.changeId, engineeringResult.change.id);
      assert.equal(result.sliceId, persistedSlices.slices[0]?.id);
      assert.ok(result.runId);
      assert.equal(result.verifyPassed, true);
      assert.ok(result.generatedArtifacts.includes('EngineeringExecutionTarget.txt'));
      assert.ok(result.generatedArtifacts.includes('SLICE_CONTEXT.md'));
      assert.ok(result.generatedArtifacts.includes('ExecutionTraceability.md'));
      assert.equal(getRun(projectId, String(result.runId))?.sliceId, persistedSlices.slices[0]?.id);
      assert.equal(getSlice(projectId, String(result.sliceId))?.status, 'done');
      assert.equal(result.traceability.change.id, engineeringResult.change.id);
      assert.equal(result.traceability.spec.id, engineeringResult.spec.id);
      assert.equal(result.traceability.slice.id, persistedSlices.slices[0]?.id);
    }

    {
      const projectId = 'alpha-explicit';
      const changeId = 'change-alpha-explicit';
      const specId = 'spec-alpha-explicit-1';
      const { appRepoPath, worktreesRootPath } = setupAppRepo(sandbox, 'explicit');
      const change = buildChange(projectId, changeId, specId, 'Persist dry-run execution state against an explicit stored slice.');
      const spec = buildSpec(projectId, changeId, specId, 'Use a stored slice ID for engineering execution.');
      const slice = buildSlice(projectId, changeId, specId, {
        id: 'slice-spec-alpha-explicit-1-happy-path',
      });

      createChange(change);
      createSpec(spec);
      createSlice(slice);

      writeArtifact(projectId, 'TechSpec.md', '# TechSpec\n\n- Keep execution slice-scoped.\n');
      writeArtifact(projectId, 'Backlog.md', '# Backlog\n\n- [ ] Historical placeholder\n');

      const preflightHandoff = buildEngineeringExecutionHandoff(projectId, {
        sliceId: slice.id,
        appName: 'demo-app-explicit',
        projectRepoPath: appRepoPath,
        provider: 'codex',
        branchName: 'codex/change-alpha-explicit',
      });
      const bridgeWorktreePath = path.join(sandbox, 'bridge-explicit');
      const bridgeFiles = materializeOpenSpecChange(bridgeWorktreePath, preflightHandoff);
      const proposal = readFileSync(bridgeFiles[0], 'utf8');
      const design = readFileSync(bridgeFiles[1], 'utf8');
      const tasksDoc = readFileSync(bridgeFiles[2], 'utf8');
      const specDoc = readFileSync(bridgeFiles[3], 'utf8');

      assert.match(proposal, /resolved slice `slice-spec-alpha-explicit-1-happy-path`/);
      assert.doesNotMatch(proposal, /Historical placeholder/);
      assert.match(design, /resolved `SLICE_CONTEXT\.md` handoff/i);
      assert.match(tasksDoc, /ENG-001 - Persist slice-scoped execution context/);
      assert.doesNotMatch(tasksDoc, /Run validation/);
      assert.doesNotMatch(tasksDoc, /Push branch and open PR/);
      assert.match(specDoc, /persisted task subset, allowed paths, and out-of-scope boundaries/i);

      const result = await runEngineeringExecution(projectId, {
        appName: 'demo-app-explicit',
        appRepoPath,
        worktreesRootPath,
        sliceId: slice.id,
        dryRun: true,
        initializeLocalGitIfMissing: false,
      });

      assert.equal(result.changeId, change.id);
      assert.equal(result.sliceId, slice.id);
      assert.ok(result.runId);
      assert.equal(result.verifyPassed, true);
      assert.ok(result.generatedArtifacts.includes('EngineeringExecutionTarget.txt'));
      assert.ok(result.generatedArtifacts.includes('SLICE_CONTEXT.md'));
      assert.ok(result.generatedArtifacts.includes('ExecutionTraceability.md'));
      assert.ok(result.generatedArtifacts.includes('EngineeringVerifyOutput.md'));
      assert.ok(!result.generatedArtifacts.includes('ExecutionPlan.md'));
      assert.ok(!result.generatedArtifacts.includes('EngineeringOpenSpecDraft.md'));
      assert.match(result.summary, /runId=/);

      const sliceContext = readArtifact(projectId, 'SLICE_CONTEXT.md');
      assert.match(String(sliceContext || ''), /# Slice Context/);
      assert.match(String(sliceContext || ''), /Run ID: `run-slice-spec-alpha-explicit-1-happy-path-01`/);
      assert.match(String(sliceContext || ''), /Files Allowed To Change/);
      assert.match(String(sliceContext || ''), /src\/runtime/);
      assert.match(String(sliceContext || ''), /src\/cli\.ts/);
      assert.match(String(sliceContext || ''), /Honor the approved operator UX and empty-state behavior/);
      assert.match(String(sliceContext || ''), /Persist slice-scoped execution context/);
      assertGenericEntryArtifactsRemoved(readArtifact, projectId);

      const traceabilityArtifact = readArtifact(projectId, 'ExecutionTraceability.md');
      assert.match(String(traceabilityArtifact || ''), /# Execution Traceability/);
      assert.match(String(traceabilityArtifact || ''), /Request \(user\) -> Change `change-alpha-explicit`/);
      assert.match(String(traceabilityArtifact || ''), /Slice `slice-spec-alpha-explicit-1-happy-path` -> Run `run-slice-spec-alpha-explicit-1-happy-path-01`/);
      assert.match(String(traceabilityArtifact || ''), /Worktree:/);
      assert.equal(result.traceability.change.id, change.id);
      assert.equal(result.traceability.spec.id, spec.id);
      assert.equal(result.traceability.slice.id, slice.id);
      assert.equal(result.traceability.run.id, String(result.runId));
      assert.equal(result.traceability.run.worktreePath, result.worktreePath);
      assert.ok(result.traceability.chain.some((entry) => entry.includes('Worktree')));

      const run = getRun(projectId, String(result.runId));
      assert.equal(run?.status, 'succeeded');
      assert.equal(run?.sliceId, slice.id);
      assert.equal(run?.verificationPassed, true);
      assert.equal(run?.worktreePath, result.worktreePath);
      assert.ok(run?.evidence.some((entry) => entry.path?.endsWith('EngineeringExecutionTarget.txt')));
      assert.ok(run?.evidence.some((entry) => entry.path?.endsWith('SLICE_CONTEXT.md')));
      assert.ok(run?.evidence.some((entry) => entry.path?.endsWith('ExecutionTraceability.md')));
      assert.ok(!run?.evidence.some((entry) => entry.path?.endsWith('ExecutionPlan.md')));
      assert.ok(!run?.evidence.some((entry) => entry.path?.endsWith('EngineeringOpenSpecDraft.md')));

      const updatedSlice = getSlice(projectId, slice.id);
      assert.equal(updatedSlice?.status, 'done');
    }

    {
      const projectId = 'alpha-task-exec';
      const changeId = 'change-alpha-task-exec';
      const specId = 'spec-alpha-task-exec-1';
      const change = buildChange(projectId, changeId, specId, 'Execute only the resolved persisted task subset.');
      const spec = buildSpec(projectId, changeId, specId, 'Drive task execution from the persisted slice handoff.');
      const slice = buildSlice(projectId, changeId, specId, {
        id: 'slice-spec-alpha-task-exec-1',
        sourceTaskIds: ['ENG-010', 'ENG-011'],
        taskSubset: [
          {
            taskId: 'ENG-010',
            title: 'Update runtime handoff',
            summary: 'Pass the resolved slice/task handoff into the worker.',
            dependencyIds: [],
          },
          {
            taskId: 'ENG-011',
            title: 'Execute subset tasks only',
            summary: 'Stop executing generic validation or delivery checklist items.',
            dependencyIds: ['ENG-010'],
          },
        ],
      });

      createChange(change);
      createSpec(spec);
      createSlice(slice);

      const handoff = buildEngineeringExecutionHandoff(projectId, {
        sliceId: slice.id,
        appName: 'demo-app-task-exec',
        projectRepoPath: path.join(sandbox, 'bridge-task-exec'),
        provider: 'codex',
        branchName: 'codex/change-alpha-task-exec',
      });

      const successWorktreePath = path.join(sandbox, 'task-exec-success');
      const successFiles = materializeOpenSpecChange(successWorktreePath, handoff);
      const successResult = executeOpenSpecTasks(
        successWorktreePath,
        buildRuntimeConfig('node --eval "process.exit(0)"', { maxTasksPerRun: 1 }),
        handoff,
      );

      assert.equal(successResult.executed, 1);
      assert.equal(successResult.completed, 1);
      assert.equal(successResult.failed, 0);
      assert.match(successResult.taskReport, /ENG-010 - Update runtime handoff/);

      const successTasksDoc = readFileSync(successFiles[2], 'utf8');
      assert.match(successTasksDoc, /- \[x\] ENG-010 - Update runtime handoff/);
      assert.match(successTasksDoc, /- \[ \] ENG-011 - Execute subset tasks only/);

      const failureWorktreePath = path.join(sandbox, 'task-exec-failure');
      const failureFiles = materializeOpenSpecChange(failureWorktreePath, handoff);
      const failureResult = executeOpenSpecTasks(
        failureWorktreePath,
        buildRuntimeConfig('node --eval "process.exit(process.env.AGP_TASK_ID === \'ENG-011\' ? 1 : 0)"', {
          maxTasksPerRun: 2,
          stopOnFailure: false,
        }),
        handoff,
      );

      assert.equal(failureResult.executed, 2);
      assert.equal(failureResult.completed, 1);
      assert.equal(failureResult.failed, 1);
      assert.match(failureResult.taskReport, /FAIL: ENG-011 - Execute subset tasks only/);

      const failureTasksDoc = readFileSync(failureFiles[2], 'utf8');
      assert.match(failureTasksDoc, /- \[x\] ENG-010 - Update runtime handoff/);
      assert.match(failureTasksDoc, /- \[ \] ENG-011 - Execute subset tasks only/);
      assert.doesNotMatch(failureTasksDoc, /Run validation/);
      assert.doesNotMatch(failureTasksDoc, /Push branch and open PR/);
    }

    {
      const projectId = 'alpha-auto';
      const changeId = 'change-alpha-auto';
      const specId = 'spec-alpha-auto-1';
      const { appRepoPath, worktreesRootPath } = setupAppRepo(sandbox, 'auto');
      const change = buildChange(projectId, changeId, specId, 'Resolve the next executable slice from persisted selection state.');
      const spec = buildSpec(projectId, changeId, specId, 'Select the next ready slice when engineering_exec is invoked without an explicit slice ID.');
      const firstSlice = buildSlice(projectId, changeId, specId, {
        id: 'slice-spec-alpha-auto-1-first',
        title: 'First auto-selected slice',
        sequence: 1,
      });
      const secondSlice = buildSlice(projectId, changeId, specId, {
        id: 'slice-spec-alpha-auto-1-second',
        title: 'Second queued slice',
        status: 'queued',
        sequence: 2,
        taskRefs: ['P6-T5'],
        sourceTaskIds: ['ENG-002'],
      });

      createChange(change);
      createSpec(spec);
      createSlice(firstSlice);
      createSlice(secondSlice);

      writeArtifact(projectId, 'TechSpec.md', '# TechSpec\n\n- Keep execution slice-scoped.\n');
      writeArtifact(projectId, 'Backlog.md', '# Backlog\n\n- [ ] Historical placeholder\n');

      const result = await runEngineeringExecution(projectId, {
        appName: 'demo-app-auto',
        appRepoPath,
        worktreesRootPath,
        changeId,
        dryRun: true,
        initializeLocalGitIfMissing: false,
      });

      assert.equal(result.changeId, change.id);
      assert.equal(result.sliceId, firstSlice.id);
      assert.ok(result.runId);
      assert.match(result.summary, new RegExp(`sliceId=${firstSlice.id}`));
      assertGenericEntryArtifactsRemoved(readArtifact, projectId);

      const run = getRun(projectId, String(result.runId));
      assert.equal(run?.sliceId, firstSlice.id);
      assert.equal(getSlice(projectId, firstSlice.id)?.status, 'done');
      assert.equal(getSlice(projectId, secondSlice.id)?.status, 'queued');
    }

    {
      const projectId = 'alpha-none';
      const changeId = 'change-alpha-none';
      const specId = 'spec-alpha-none-1';
      const { appRepoPath, worktreesRootPath } = setupAppRepo(sandbox, 'none');
      const change = buildChange(projectId, changeId, specId, 'Fail cleanly when no executable slice is available.');
      const spec = buildSpec(projectId, changeId, specId, 'Do not execute when selection cannot resolve a ready slice.');
      const blockedSlice = buildSlice(projectId, changeId, specId, {
        id: 'slice-spec-alpha-none-1-blocked',
        status: 'blocked',
        blockers: ['Waiting on external approval'],
      });

      createChange(change);
      createSpec(spec);
      createSlice(blockedSlice);

      await assert.rejects(
        () =>
          runEngineeringExecution(projectId, {
            appName: 'demo-app-none',
            appRepoPath,
            worktreesRootPath,
            changeId,
            dryRun: true,
            initializeLocalGitIfMissing: false,
          }),
        /No executable slice is available/,
      );
    }

    console.log('Engineering execution run lifecycle checks passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
