import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  LLMCompletionResult,
  LLMMessage,
  SliceDerivationPlanSlice,
  WorkChange,
  WorkSpec,
} from '../src/types/index.js';

class StubProvider {
  async complete(_messages: LLMMessage[]): Promise<LLMCompletionResult> {
    return { content: '' };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-slice-derivation-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

  const {
    SLICE_DERIVATION_CONTRACT_VERSION,
    SliceDerivationArtifactPaths,
    SliceDerivationBacklogColumns,
    SliceDerivationTechSpecHeadings,
    collectSupportingArtifactsForSliceDerivation,
    createSliceDerivationInput,
    createSliceDerivationPlan,
    deriveAndPersistSlices,
    derivePersistedSliceId,
    deriveSlicePlan,
    deriveSliceDrafts,
    deriveSliceKeyFromTaskId,
    listSlices,
    parseSliceDerivationBacklog,
    parseSliceDerivationInput,
    parseSliceDerivationTechSpecSections,
    persistSlicePlan,
    saveChange,
    saveSpec,
    updateSlice,
  } = await import('../src/index.js');
  const { listArtifactFiles } = await import('../src/artifacts/store.js');
  const { EngineeringAgent } = await import('../src/agents/engineering.js');

  assert.equal(SLICE_DERIVATION_CONTRACT_VERSION, 1);
  assert.deepEqual(SliceDerivationArtifactPaths, ['TechSpec.md', 'Backlog.md']);
  assert.deepEqual(SliceDerivationTechSpecHeadings, [
    'Architecture Overview',
    'Data Model',
    'API / Integration points',
    'Risk & Security Notes',
    'Implementation Plan',
    'Test Plan',
  ]);
  assert.deepEqual(SliceDerivationBacklogColumns, [
    'ID',
    'Priority',
    'Task',
    'Description',
    'Estimate',
    'Dependencies',
    'Acceptance Criteria',
    'Allowed Paths',
    'Out of Scope',
  ]);

  const change: WorkChange = {
    id: 'change-1',
    projectId: 'alpha',
    title: 'Slice derivation contract',
    summary: 'Define the deterministic engineering-to-slice contract.',
    intent: 'implementation_only',
    status: 'active',
    request: {
      summary: 'Make engineering output parseable for slice derivation.',
      source: 'user',
    },
    scope: {
      inScope: ['src/agents/engineering.ts', 'src/ledger/derive-slices.ts'],
      outOfScope: ['src/runtime/engineering-exec.ts'],
      acceptanceCriteria: ['contract surfaces are versioned and exported'],
    },
    currentStage: 'engineering',
    activeSpecId: 'spec-1',
    stageStatus: {
      engineering: 'in_progress',
    },
    blockerIds: [],
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
  };

  const spec: WorkSpec = {
    id: 'spec-1',
    projectId: 'alpha',
    changeId: 'change-1',
    version: 1,
    title: 'Derivation contract spec',
    summary: 'Lock the planning inputs and slice-plan outputs.',
    status: 'active',
    goals: ['stable contract', 'slice-first execution handoff'],
    constraints: ['do not touch engineering_exec'],
    acceptanceCriteria: ['later parsing and derivation tasks can reuse one shared shape'],
    sourceArtifacts: [
      { path: 'Research.md', kind: 'markdown', stage: 'research' },
      { path: 'PRD.md', kind: 'markdown', stage: 'pm' },
      { path: 'PRD.md', kind: 'markdown', stage: 'pm' },
    ],
    designDefinition: { path: 'PrototypeSpec.md', kind: 'markdown', stage: 'design' },
    createdAt: '2026-04-04T00:00:00.000Z',
    updatedAt: '2026-04-04T00:00:00.000Z',
  };

  const supportingArtifacts = collectSupportingArtifactsForSliceDerivation(spec);
  assert.deepEqual(
    supportingArtifacts.map((artifact) => artifact.path),
    ['PRD.md', 'PrototypeSpec.md', 'Research.md'],
  );

  const input = createSliceDerivationInput({
    projectId: 'alpha',
    change,
    spec,
    techSpec: {
      architectureOverview: '  Service and CLI layers.  ',
      dataModel: ' Change, spec, slice, run, gate. ',
      apiIntegrationPoints: ' none ',
      riskSecurityNotes: ' enforce isolated execution ',
      implementationPlan: ' 1. Define contract\n2. Parse backlog ',
      testPlan: ' contract coverage ',
    },
    backlog: [
      {
        id: ' ENG-002 ',
        title: ' Parse planning artifacts ',
        description: ' Convert engineering markdown into typed derivation input. ',
        priority: 'medium',
        estimate: ' 1d ',
        dependencyIds: [' ENG-001 ', 'ENG-001'],
        acceptanceCriteria: [' parser reads headings ', ' parser reads headings ', ' parser reads backlog rows '],
        allowedPaths: [' src/ledger ', 'src/ledger'],
        outOfScopePaths: [' src/runtime/engineering-exec.ts '],
      },
    ],
  });

  assert.equal(input.schemaVersion, 1);
  assert.equal(input.techSpecPath, 'TechSpec.md');
  assert.equal(input.backlogPath, 'Backlog.md');
  assert.deepEqual(
    input.supportingArtifacts.map((artifact) => artifact.path),
    ['PRD.md', 'PrototypeSpec.md', 'Research.md'],
  );
  assert.deepEqual(input.backlog[0], {
    id: 'ENG-002',
    title: 'Parse planning artifacts',
    description: 'Convert engineering markdown into typed derivation input.',
    priority: 'medium',
    estimate: '1d',
    dependencyIds: ['ENG-001'],
    acceptanceCriteria: ['parser reads headings', 'parser reads backlog rows'],
    allowedPaths: ['src/ledger'],
    outOfScopePaths: ['src/runtime/engineering-exec.ts'],
  });

  const parsedTechSpec = parseSliceDerivationTechSpecSections(`
# Technical Specification

## Architecture Overview
CLI orchestrates deterministic slice generation.

## Data Model
Change, spec, and backlog task entities map into slice derivation inputs.

## API / Integration points
None.

## Risk & Security Notes
Reject missing headings and malformed backlog rows.

## Implementation Plan
1. Parse markdown.
2. Normalize rows.

## Test Plan
Cover success and malformed-table failure paths.
`);
  assert.equal(parsedTechSpec.implementationPlan, '1. Parse markdown.\n2. Normalize rows.');

  const parsedBacklog = parseSliceDerivationBacklog(`
| ID | Priority | Task | Description | Estimate | Dependencies | Acceptance Criteria | Allowed Paths | Out of Scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ENG-001 | high | Contract baseline | Define shared derivation contract. | 1d | none | contract helpers exported;prompt headings deterministic | src/types/index.ts, src/agents/engineering.ts | none |
| ENG-002 | medium | Parse artifacts | Parse planning markdown into typed inputs. | 1d | ENG-001 | headings parsed;backlog rows parsed | src/ledger/derive-slices.ts | src/runtime/engineering-exec.ts |
`);
  assert.equal(parsedBacklog.length, 2);
  assert.deepEqual(parsedBacklog[0].dependencyIds, []);
  assert.deepEqual(parsedBacklog[1].dependencyIds, ['ENG-001']);
  assert.deepEqual(parsedBacklog[0].acceptanceCriteria, ['contract helpers exported', 'prompt headings deterministic']);

  const parsedInput = parseSliceDerivationInput({
    projectId: 'alpha',
    change,
    spec,
    techSpecContent: `
## Architecture Overview
Simple.
## Data Model
Simple.
## API / Integration points
None.
## Risk & Security Notes
Simple.
## Implementation Plan
Simple.
## Test Plan
Simple.
`,
    backlogContent: `
| ID | Priority | Task | Description | Estimate | Dependencies | Acceptance Criteria | Allowed Paths | Out of Scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ENG-009 | low | Parser smoke | Ensure parsing works. | 0.5d | none | parser returns one row | src/ledger/derive-slices.ts | none |
`,
  });
  assert.equal(parsedInput.backlog[0].id, 'ENG-009');
  assert.equal(parsedInput.techSpec.architectureOverview, 'Simple.');
  assert.equal(deriveSliceKeyFromTaskId(' ENG-009 '), 'slice-eng-009');

  const derivedDrafts = deriveSliceDrafts(
    createSliceDerivationInput({
      projectId: 'alpha',
      change,
      spec,
      techSpec: {
        architectureOverview: 'CLI orchestrates deterministic slice generation.',
        dataModel: 'Change, spec, and slice entities persist the plan.',
        apiIntegrationPoints: 'None.',
        riskSecurityNotes: 'Reject duplicate backlog IDs before execution.',
        implementationPlan: '1. Parse markdown.\n2. Derive draft slices.',
        testPlan: 'Cover slice draft derivation and duplicate-ID failures.',
      },
      backlog: [
        {
          id: ' ENG-010 ',
          title: ' Build deterministic slice drafts ',
          description: ' Convert parsed backlog rows into stable draft slices. ',
          priority: 'high',
          estimate: ' 4h ',
          dependencyIds: ['ENG-009'],
          acceptanceCriteria: ['draft slice keys are stable', 'implementation notes include tech spec context'],
          allowedPaths: [' src/ledger/derive-slices.ts '],
          outOfScopePaths: [],
        },
        {
          id: 'ENG-011',
          title: 'Fallback path scope',
          description: 'Use change scope defaults when backlog paths are omitted.',
          priority: 'medium',
          estimate: '2d',
          dependencyIds: [],
          acceptanceCriteria: [],
          allowedPaths: [],
          outOfScopePaths: [],
        },
      ],
    }),
  );

  assert.deepEqual(
    derivedDrafts.map((draft) => ({
      sliceKey: draft.sliceKey,
      size: draft.size,
      sourceTaskIds: draft.sourceTaskIds,
      taskSubset: draft.taskSubset.map((task) => task.taskId),
    })),
    [
      { sliceKey: 'slice-eng-010', size: 'xs', sourceTaskIds: ['ENG-010'], taskSubset: ['ENG-010'] },
      { sliceKey: 'slice-eng-011', size: 'm', sourceTaskIds: ['ENG-011'], taskSubset: ['ENG-011'] },
    ],
  );
  assert.deepEqual(derivedDrafts[0].allowedPaths, ['src/ledger/derive-slices.ts']);
  assert.deepEqual(derivedDrafts[1].allowedPaths, ['src/agents/engineering.ts', 'src/ledger/derive-slices.ts']);
  assert.deepEqual(derivedDrafts[1].outOfScopePaths, ['src/runtime/engineering-exec.ts']);
  assert.deepEqual(derivedDrafts[1].acceptanceChecks, ['later parsing and derivation tasks can reuse one shared shape']);
  assert.deepEqual(
    derivedDrafts[0].relatedArtifacts.map((artifact) => artifact.path),
    ['Backlog.md', 'PRD.md', 'PrototypeSpec.md', 'Research.md', 'TechSpec.md'],
  );
  assert.match(derivedDrafts[0].implementationNotes[0], /Backlog task ENG-010/);
  assert.match(derivedDrafts[0].implementationNotes[1], /Architecture context:/);
  assert.match(derivedDrafts[0].implementationNotes.at(-1) || '', /Test plan reference:/);
  assert.deepEqual(derivedDrafts[0].taskSubset[0], {
    taskId: 'ENG-010',
    title: 'Build deterministic slice drafts',
    summary: 'Convert parsed backlog rows into stable draft slices.',
    dependencyIds: ['ENG-009'],
  });

  const derivedPlan = deriveSlicePlan(
    createSliceDerivationInput({
      projectId: 'alpha',
      change,
      spec,
      techSpec: {
        architectureOverview: 'CLI orchestrates deterministic slice generation.',
        dataModel: 'Change, spec, and slice entities persist the plan.',
        apiIntegrationPoints: 'None.',
        riskSecurityNotes: 'Reject malformed dependency graphs before execution.',
        implementationPlan: '1. Parse markdown.\n2. Derive draft slices.\n3. Assign sequence and dependencies.',
        testPlan: 'Cover topological ordering, missing dependencies, and cycle warnings.',
      },
      backlog: [
        {
          id: 'ENG-020',
          title: 'Foundation contract',
          description: 'Lay down the shared planning types.',
          priority: 'high',
          estimate: '1d',
          dependencyIds: [],
          acceptanceCriteria: ['contract exists'],
          allowedPaths: ['src/types/index.ts'],
          outOfScopePaths: [],
        },
        {
          id: 'ENG-021',
          title: 'Dependent parser',
          description: 'Build parser support on the contract.',
          priority: 'critical',
          estimate: '4h',
          dependencyIds: ['ENG-020'],
          acceptanceCriteria: ['parser uses contract'],
          allowedPaths: ['src/ledger/derive-slices.ts'],
          outOfScopePaths: [],
        },
        {
          id: 'ENG-022',
          title: 'Independent docs',
          description: 'Refresh docs after the parser contract lands.',
          priority: 'medium',
          estimate: '2d',
          dependencyIds: [],
          acceptanceCriteria: ['docs updated'],
          allowedPaths: ['docs/v0-2-0_plan'],
          outOfScopePaths: [],
        },
      ],
    }),
  );

  assert.deepEqual(
    derivedPlan.slices.map((slice) => ({
      sliceKey: slice.sliceKey,
      sequence: slice.sequence,
      dependencyKeys: slice.dependencyKeys,
      blockers: slice.blockers,
      taskSubset: slice.taskSubset.map((task) => task.taskId),
    })),
    [
      {
        sliceKey: 'slice-eng-020',
        sequence: 1,
        dependencyKeys: [],
        blockers: [],
        taskSubset: ['ENG-020'],
      },
      {
        sliceKey: 'slice-eng-021',
        sequence: 2,
        dependencyKeys: ['slice-eng-020'],
        blockers: [],
        taskSubset: ['ENG-021'],
      },
      {
        sliceKey: 'slice-eng-022',
        sequence: 3,
        dependencyKeys: [],
        blockers: [],
        taskSubset: ['ENG-022'],
      },
    ],
  );
  assert.deepEqual(derivedPlan.warnings, []);

  const blockedPlan = deriveSlicePlan(
    createSliceDerivationInput({
      projectId: 'alpha',
      change,
      spec,
      techSpec: {
        architectureOverview: 'CLI orchestrates deterministic slice generation.',
        dataModel: 'Change, spec, and slice entities persist the plan.',
        apiIntegrationPoints: 'None.',
        riskSecurityNotes: 'Flag invalid dependencies before execution.',
        implementationPlan: '1. Parse markdown.\n2. Assign blocked slices.',
        testPlan: 'Cover missing dependency warnings.',
      },
      backlog: [
        {
          id: 'ENG-030',
          title: 'Blocked slice',
          description: 'Depends on a missing task.',
          priority: 'medium',
          estimate: '1d',
          dependencyIds: ['ENG-999'],
          acceptanceCriteria: ['blocked slices surface the reason'],
          allowedPaths: ['src/ledger/derive-slices.ts'],
          outOfScopePaths: [],
        },
      ],
    }),
  );

  assert.deepEqual(blockedPlan.slices[0].dependencyKeys, []);
  assert.deepEqual(blockedPlan.slices[0].blockers, ["Missing backlog dependency 'ENG-999'."]);
  assert.deepEqual(blockedPlan.warnings, [
    "Slice 'slice-eng-030' references missing backlog dependency 'ENG-999' from task 'ENG-030'.",
  ]);

  const cyclicPlan = deriveSlicePlan(
    createSliceDerivationInput({
      projectId: 'alpha',
      change,
      spec,
      techSpec: {
        architectureOverview: 'CLI orchestrates deterministic slice generation.',
        dataModel: 'Change, spec, and slice entities persist the plan.',
        apiIntegrationPoints: 'None.',
        riskSecurityNotes: 'Flag cyclic dependencies before execution.',
        implementationPlan: '1. Parse markdown.\n2. Detect cycles.',
        testPlan: 'Cover circular dependency warnings.',
      },
      backlog: [
        {
          id: 'ENG-040',
          title: 'Cycle A',
          description: 'First side of a dependency cycle.',
          priority: 'high',
          estimate: '1d',
          dependencyIds: ['ENG-041'],
          acceptanceCriteria: ['cycle is flagged'],
          allowedPaths: ['src/ledger/derive-slices.ts'],
          outOfScopePaths: [],
        },
        {
          id: 'ENG-041',
          title: 'Cycle B',
          description: 'Second side of a dependency cycle.',
          priority: 'medium',
          estimate: '1d',
          dependencyIds: ['ENG-040'],
          acceptanceCriteria: ['cycle is flagged'],
          allowedPaths: ['src/ledger/derive-slices.ts'],
          outOfScopePaths: [],
        },
      ],
    }),
  );

  assert.deepEqual(
    cyclicPlan.slices.map((slice) => ({ sliceKey: slice.sliceKey, sequence: slice.sequence, blockers: slice.blockers })),
    [
      {
        sliceKey: 'slice-eng-040',
        sequence: 1,
        blockers: ["Circular slice dependency detected for 'slice-eng-040'."],
      },
      {
        sliceKey: 'slice-eng-041',
        sequence: 2,
        blockers: ["Circular slice dependency detected for 'slice-eng-041'."],
      },
    ],
  );
  assert.deepEqual(cyclicPlan.warnings, ['Circular slice dependency detected across: slice-eng-040, slice-eng-041.']);

  const planSlices: SliceDerivationPlanSlice[] = [
    {
      sliceKey: 'slice-02',
      title: 'Persist derived slices',
      summary: 'Write sequenced slices to artifacts.',
      sequence: 2,
      dependencyKeys: ['slice-01', 'slice-01'],
      blockers: ['wait-for-parse', 'wait-for-parse'],
      sourceTaskIds: ['ENG-004'],
      taskSubset: [
        {
          taskId: 'ENG-004',
          title: 'Persist derived slices',
          summary: 'Write sequenced slices to artifacts.',
          dependencyIds: ['ENG-002'],
        },
      ],
      acceptanceChecks: ['slice artifacts exist'],
      allowedPaths: ['src/ledger'],
      outOfScopePaths: ['src/runtime/engineering-exec.ts'],
      relatedArtifacts: [{ path: 'Backlog.md', kind: 'markdown', stage: 'engineering' }],
      implementationNotes: ['persist after sequencing'],
      priority: 'medium',
      size: 's',
    },
    {
      sliceKey: 'slice-01',
      title: 'Parse planning artifacts',
      summary: 'Convert planning markdown into typed derivation input.',
      sequence: 1,
      dependencyKeys: [],
      blockers: [],
      sourceTaskIds: ['ENG-002'],
      taskSubset: [
        {
          taskId: 'ENG-002',
          title: 'Parse planning artifacts',
          summary: 'Convert planning markdown into typed derivation input.',
          dependencyIds: [],
        },
      ],
      acceptanceChecks: ['rows are typed'],
      allowedPaths: ['src/ledger'],
      outOfScopePaths: ['src/runtime/engineering-exec.ts'],
      relatedArtifacts: [{ path: 'TechSpec.md', kind: 'markdown', stage: 'engineering' }],
      implementationNotes: ['keep parsing deterministic'],
      priority: 'high',
      size: 's',
    },
  ];

  const plan = createSliceDerivationPlan({
    projectId: 'alpha',
    changeId: 'change-1',
    specId: 'spec-1',
    generatedAt: ' 2026-04-04T01:00:00.000Z ',
    slices: planSlices,
    warnings: [' watch loose markdown ', 'watch loose markdown', 'verify dependencies'],
  });

  assert.equal(plan.generatedAt, '2026-04-04T01:00:00.000Z');
  assert.deepEqual(plan.slices.map((slice) => slice.sliceKey), ['slice-01', 'slice-02']);
  assert.deepEqual(plan.slices[1].dependencyKeys, ['slice-01']);
  assert.deepEqual(plan.slices[1].blockers, ['wait-for-parse']);
  assert.deepEqual(plan.slices[1].taskSubset[0].dependencyIds, ['ENG-002']);
  assert.deepEqual(plan.warnings, ['watch loose markdown', 'verify dependencies']);

  saveChange(change);
  saveSpec(spec);

  const persistedResult = persistSlicePlan(derivedPlan, {
    persistedAt: '2026-04-04T02:00:00.000Z',
  });
  const persistedFoundationId = derivePersistedSliceId(spec.id, 'slice-eng-020');
  const persistedDependentId = derivePersistedSliceId(spec.id, 'slice-eng-021');
  const persistedDocsId = derivePersistedSliceId(spec.id, 'slice-eng-022');

  assert.deepEqual(persistedResult.sliceIdsByKey, {
    'slice-eng-020': persistedFoundationId,
    'slice-eng-021': persistedDependentId,
    'slice-eng-022': persistedDocsId,
  });
  assert.deepEqual(persistedResult.createdSliceIds, [
    persistedFoundationId,
    persistedDependentId,
    persistedDocsId,
  ]);
  assert.deepEqual(persistedResult.updatedSliceIds, []);
  assert.deepEqual(persistedResult.cancelledSliceIds, []);
  assert.deepEqual(
    persistedResult.slices.map((slice) => ({
      id: slice.id,
      sliceKey: slice.sliceKey,
      status: slice.status,
      dependencyIds: slice.dependencyIds,
      taskRefs: slice.taskRefs,
      sourceTaskIds: slice.sourceTaskIds,
      implementationNotes: slice.implementationNotes?.length || 0,
    })),
    [
      {
        id: persistedFoundationId,
        sliceKey: 'slice-eng-020',
        status: 'ready',
        dependencyIds: [],
        taskRefs: ['ENG-020'],
        sourceTaskIds: ['ENG-020'],
        implementationNotes: 7,
      },
      {
        id: persistedDependentId,
        sliceKey: 'slice-eng-021',
        status: 'queued',
        dependencyIds: [persistedFoundationId],
        taskRefs: ['ENG-021'],
        sourceTaskIds: ['ENG-021'],
        implementationNotes: 7,
      },
      {
        id: persistedDocsId,
        sliceKey: 'slice-eng-022',
        status: 'ready',
        dependencyIds: [],
        taskRefs: ['ENG-022'],
        sourceTaskIds: ['ENG-022'],
        implementationNotes: 7,
      },
    ],
  );
  assert.equal(persistedResult.ledger.activeChangeId, change.id);
  assert.equal(persistedResult.ledger.activeSpecId, spec.id);
  assert.deepEqual(persistedResult.ledger.sliceIdsByStatus.ready, [persistedFoundationId, persistedDocsId]);
  assert.deepEqual(persistedResult.ledger.sliceIdsByStatus.queued, [persistedDependentId]);
  assert.deepEqual(
    listArtifactFiles('alpha')
      .filter((artifactPath) => artifactPath.startsWith('slices/'))
      .sort(),
    [`slices/${persistedDependentId}.json`, `slices/${persistedDocsId}.json`, `slices/${persistedFoundationId}.json`].sort(),
  );

  const trimmedPlan = createSliceDerivationPlan({
    projectId: 'alpha',
    changeId: change.id,
    specId: spec.id,
    generatedAt: '2026-04-04T02:30:00.000Z',
    slices: [derivedPlan.slices[0]],
    warnings: [],
  });
  const trimmedResult = persistSlicePlan(trimmedPlan, {
    persistedAt: '2026-04-04T02:30:00.000Z',
  });
  assert.deepEqual(trimmedResult.createdSliceIds, []);
  assert.deepEqual(trimmedResult.updatedSliceIds, [persistedFoundationId]);
  assert.deepEqual(trimmedResult.cancelledSliceIds, [persistedDependentId, persistedDocsId]);
  assert.equal(listSlices('alpha').find((slice) => slice.id === persistedDependentId)?.status, 'cancelled');
  assert.equal(listSlices('alpha').find((slice) => slice.id === persistedDocsId)?.status, 'cancelled');

  updateSlice({
    ...listSlices('alpha').find((slice) => slice.id === persistedFoundationId)!,
    status: 'in_progress',
    updatedAt: '2026-04-04T03:00:00.000Z',
  });
  assert.throws(
    () =>
      persistSlicePlan(
        createSliceDerivationPlan({
          projectId: 'alpha',
          changeId: change.id,
          specId: spec.id,
          slices: [],
          warnings: [],
        }),
        { persistedAt: '2026-04-04T03:15:00.000Z' },
      ),
    /Cannot remove in-progress slice/,
  );

  const secondChange: WorkChange = {
    ...change,
    id: 'change-2',
    activeSpecId: 'spec-2',
    title: 'Slice persistence follow-up',
    summary: 'Persist slices for a second spec without ID collisions.',
    updatedAt: '2026-04-04T04:00:00.000Z',
  };
  const secondSpec: WorkSpec = {
    ...spec,
    id: 'spec-2',
    changeId: secondChange.id,
    version: 1,
    title: 'Second persistence spec',
    summary: 'Verify persisted slice IDs stay unique across specs.',
    updatedAt: '2026-04-04T04:00:00.000Z',
  };
  saveChange(secondChange);
  saveSpec(secondSpec);

  const secondPersistedResult = deriveAndPersistSlices(
    createSliceDerivationInput({
      projectId: 'alpha',
      change: secondChange,
      spec: secondSpec,
      techSpec: {
        architectureOverview: 'A second spec reuses the same backlog IDs.',
        dataModel: 'Specs own persisted slice namespaces.',
        apiIntegrationPoints: 'None.',
        riskSecurityNotes: 'Avoid cross-spec slice-id collisions.',
        implementationPlan: '1. Persist slices for another spec.',
        testPlan: 'Ensure persisted IDs differ even when slice keys match.',
      },
      backlog: [
        {
          id: 'ENG-020',
          title: 'Foundation contract',
          description: 'Re-use the same backlog task ID under a new spec.',
          priority: 'high',
          estimate: '1d',
          dependencyIds: [],
          acceptanceCriteria: ['slice ID stays unique'],
          allowedPaths: ['src/ledger/derive-slices.ts'],
          outOfScopePaths: [],
        },
      ],
    }),
    {
      persistedAt: '2026-04-04T04:15:00.000Z',
    },
  );
  assert.deepEqual(secondPersistedResult.createdSliceIds, [derivePersistedSliceId(secondSpec.id, 'slice-eng-020')]);
  assert.notEqual(secondPersistedResult.createdSliceIds[0], persistedFoundationId);

  assert.throws(
    () =>
      parseSliceDerivationBacklog(`
| ID | Priority | Task | Description | Estimate | Dependencies | Acceptance Criteria | Allowed Paths | Out of Scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ENG-100 | urgent | Bad priority row | Should fail. | 1d | none | fails on priority | src/ledger/derive-slices.ts | none |
`),
    /unsupported priority/,
  );

  assert.throws(
    () =>
      deriveSliceDrafts(
        createSliceDerivationInput({
          projectId: 'alpha',
          change,
          spec,
          techSpec: {
            architectureOverview: 'Simple.',
            dataModel: 'Simple.',
            apiIntegrationPoints: 'None.',
            riskSecurityNotes: 'Simple.',
            implementationPlan: 'Simple.',
            testPlan: 'Simple.',
          },
          backlog: [
            {
              id: 'ENG-100',
              title: 'First task',
              description: 'First task',
              priority: 'low',
              estimate: '1d',
              dependencyIds: [],
              acceptanceCriteria: ['first'],
              allowedPaths: ['src/ledger'],
              outOfScopePaths: [],
            },
            {
              id: 'ENG-100',
              title: 'Duplicate task',
              description: 'Duplicate task',
              priority: 'low',
              estimate: '1d',
              dependencyIds: [],
              acceptanceCriteria: ['second'],
              allowedPaths: ['src/ledger'],
              outOfScopePaths: [],
            },
          ],
        }),
      ),
    /unique backlog IDs/,
  );

  const agent = new EngineeringAgent(new StubProvider(), 'alpha');
  assert.deepEqual(agent.outputArtifacts, ['TechSpec.md', 'Backlog.md']);

  for (const heading of SliceDerivationTechSpecHeadings) {
    assert.match(agent.systemPrompt, new RegExp(escapeRegExp(`## ${heading}`)));
  }

  const backlogTableSnippet = `| ${SliceDerivationBacklogColumns.join(' | ')} |`;
  assert.match(agent.systemPrompt, new RegExp(escapeRegExp(backlogTableSnippet)));
  assert.match(agent.systemPrompt, /ENG-001, ENG-002/);
  assert.match(agent.systemPrompt, /Dependencies must reference backlog IDs/);
  assert.match(agent.systemPrompt, /Acceptance Criteria must be a semicolon-separated list/);
  assert.match(agent.systemPrompt, /Allowed Paths and Out of Scope must use repo-relative paths or globs/);

  console.log('Slice derivation contract check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

await main();
