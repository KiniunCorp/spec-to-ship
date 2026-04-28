import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkChange, WorkSlice, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-slice-selection-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      createChange,
      createSlice,
      createSpec,
      listExecutableSlices,
      refreshLedger,
      requireNextExecutableSlice,
      resolveExecutableSliceSelection,
      selectNextExecutableSlice,
    } = await import('../src/index.js');

    const alphaChange: WorkChange = {
      id: 'change-alpha',
      projectId: 'alpha',
      title: 'Slice-first execution',
      summary: 'Test default scope and ordering.',
      intent: 'implementation_only',
      status: 'active',
      request: { summary: 'Implement explicit slice selection.', source: 'user' },
      scope: {
        inScope: ['src/ledger', 'src/runtime'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['selection is deterministic'],
      },
      currentStage: 'engineering_exec',
      activeSpecId: 'spec-current',
      stageStatus: { engineering_exec: 'ready' },
      blockerIds: [],
      createdAt: '2026-04-04T10:00:00.000Z',
      updatedAt: '2026-04-04T10:30:00.000Z',
    };

    const alphaSpecs: WorkSpec[] = [
      {
        id: 'spec-previous',
        projectId: 'alpha',
        changeId: 'change-alpha',
        version: 1,
        title: 'Previous spec',
        summary: 'Older approved scope.',
        status: 'approved',
        goals: ['retain history'],
        constraints: [],
        acceptanceCriteria: ['older specs can still be addressed explicitly'],
        sourceArtifacts: [],
        approvedAt: '2026-04-04T10:05:00.000Z',
        createdAt: '2026-04-04T10:05:00.000Z',
        updatedAt: '2026-04-04T10:05:00.000Z',
      },
      {
        id: 'spec-current',
        projectId: 'alpha',
        changeId: 'change-alpha',
        version: 2,
        title: 'Current spec',
        summary: 'Active execution scope.',
        status: 'approved',
        goals: ['select only the active spec by default'],
        constraints: [],
        acceptanceCriteria: ['slice execution stays deterministic'],
        sourceArtifacts: [],
        approvedAt: '2026-04-04T10:10:00.000Z',
        createdAt: '2026-04-04T10:10:00.000Z',
        updatedAt: '2026-04-04T10:10:00.000Z',
      },
    ];

    const alphaSlices: WorkSlice[] = [
      {
        id: 'slice-previous-ready',
        projectId: 'alpha',
        changeId: 'change-alpha',
        specId: 'spec-previous',
        title: 'Older ready slice',
        summary: 'Should only be selected when the older spec is requested.',
        status: 'ready',
        sequence: 0,
        priority: 'critical',
        size: 'xs',
        dependencyIds: [],
        blockers: [],
        taskRefs: ['ENG-000'],
        acceptanceChecks: ['older spec remains addressable'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-04T10:11:00.000Z',
        updatedAt: '2026-04-04T10:11:00.000Z',
      },
      {
        id: 'slice-dependency-done',
        projectId: 'alpha',
        changeId: 'change-alpha',
        specId: 'spec-current',
        title: 'Completed prerequisite',
        summary: 'Dependency already done.',
        status: 'done',
        sequence: 0,
        priority: 'medium',
        size: 's',
        dependencyIds: [],
        blockers: [],
        taskRefs: ['ENG-001'],
        acceptanceChecks: ['dependency marked done'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-04T10:12:00.000Z',
        updatedAt: '2026-04-04T10:12:00.000Z',
        completedAt: '2026-04-04T10:20:00.000Z',
      },
      {
        id: 'slice-ready-seq-one',
        projectId: 'alpha',
        changeId: 'change-alpha',
        specId: 'spec-current',
        title: 'Lowest sequence wins',
        summary: 'Should outrank higher-priority later slices.',
        status: 'ready',
        sequence: 1,
        priority: 'medium',
        size: 'l',
        dependencyIds: ['slice-dependency-done'],
        blockers: [],
        taskRefs: ['ENG-002'],
        acceptanceChecks: ['lowest sequence selected first'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-04T10:13:00.000Z',
        updatedAt: '2026-04-04T10:13:00.000Z',
      },
      {
        id: 'slice-queued-critical-small',
        projectId: 'alpha',
        changeId: 'change-alpha',
        specId: 'spec-current',
        title: 'Priority beats size on same sequence',
        summary: 'Queued slices are executable when dependencies are done.',
        status: 'queued',
        sequence: 2,
        priority: 'critical',
        size: 's',
        dependencyIds: ['slice-dependency-done'],
        blockers: [],
        taskRefs: ['ENG-003'],
        acceptanceChecks: ['queued status can execute'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-04T10:14:00.000Z',
        updatedAt: '2026-04-04T10:14:00.000Z',
      },
      {
        id: 'slice-ready-high-large',
        projectId: 'alpha',
        changeId: 'change-alpha',
        specId: 'spec-current',
        title: 'Lower priority loses same-sequence tie',
        summary: 'Ready but should sort after the critical queued slice.',
        status: 'ready',
        sequence: 2,
        priority: 'high',
        size: 'l',
        dependencyIds: ['slice-dependency-done'],
        blockers: [],
        taskRefs: ['ENG-004'],
        acceptanceChecks: ['priority tie-break enforced'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-04T10:15:00.000Z',
        updatedAt: '2026-04-04T10:15:00.000Z',
      },
      {
        id: 'slice-ready-blocked',
        projectId: 'alpha',
        changeId: 'change-alpha',
        specId: 'spec-current',
        title: 'Blockers exclude execution',
        summary: 'Still open but not executable.',
        status: 'ready',
        sequence: 0,
        priority: 'critical',
        size: 'xs',
        dependencyIds: [],
        blockers: ['manual-review'],
        taskRefs: ['ENG-005'],
        acceptanceChecks: ['blockers must be absent'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-04T10:16:00.000Z',
        updatedAt: '2026-04-04T10:16:00.000Z',
      },
      {
        id: 'slice-ready-missing-dependency',
        projectId: 'alpha',
        changeId: 'change-alpha',
        specId: 'spec-current',
        title: 'Missing dependencies exclude execution',
        summary: 'Dependencies must be complete.',
        status: 'ready',
        sequence: 0,
        priority: 'critical',
        size: 'xs',
        dependencyIds: ['slice-missing'],
        blockers: [],
        taskRefs: ['ENG-006'],
        acceptanceChecks: ['dependencies must exist and be done'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-04T10:17:00.000Z',
        updatedAt: '2026-04-04T10:17:00.000Z',
      },
      {
        id: 'slice-in-progress',
        projectId: 'alpha',
        changeId: 'change-alpha',
        specId: 'spec-current',
        title: 'In-progress slices are not re-selected',
        summary: 'Open but ineligible.',
        status: 'in_progress',
        sequence: 3,
        priority: 'critical',
        size: 'xs',
        dependencyIds: [],
        blockers: [],
        taskRefs: ['ENG-007'],
        acceptanceChecks: ['in-progress slices stay out of selection'],
        allowedPaths: ['src/ledger'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-04T10:18:00.000Z',
        updatedAt: '2026-04-04T10:18:00.000Z',
      },
    ];

    createChange(alphaChange);
    for (const spec of alphaSpecs) createSpec(spec);
    for (const slice of alphaSlices) createSlice(slice);
    refreshLedger('alpha', { updatedAt: '2026-04-04T10:30:00.000Z' });

    const alphaSelection = resolveExecutableSliceSelection('alpha');
    assert.equal(alphaSelection.change?.id, 'change-alpha');
    assert.equal(alphaSelection.spec?.id, 'spec-current');
    assert.deepEqual(
      alphaSelection.candidates.map((candidate) => candidate.slice.id).sort(),
      [
        'slice-in-progress',
        'slice-queued-critical-small',
        'slice-ready-blocked',
        'slice-ready-high-large',
        'slice-ready-missing-dependency',
        'slice-ready-seq-one',
      ],
    );
    assert.deepEqual(alphaSelection.executableSlices.map((slice) => slice.id), [
      'slice-ready-seq-one',
      'slice-queued-critical-small',
      'slice-ready-high-large',
    ]);
    assert.equal(alphaSelection.selectedSlice?.id, 'slice-ready-seq-one');
    assert.equal(selectNextExecutableSlice('alpha')?.id, 'slice-ready-seq-one');
    assert.equal(requireNextExecutableSlice('alpha').id, 'slice-ready-seq-one');
    assert.deepEqual(listExecutableSlices('alpha').map((slice) => slice.id), [
      'slice-ready-seq-one',
      'slice-queued-critical-small',
      'slice-ready-high-large',
    ]);
    assert.equal(
      alphaSelection.candidates.find((candidate) => candidate.slice.id === 'slice-ready-blocked')?.executable,
      false,
    );
    assert.deepEqual(
      alphaSelection.candidates.find((candidate) => candidate.slice.id === 'slice-ready-blocked')?.blockers,
      ['manual-review'],
    );
    assert.deepEqual(
      alphaSelection.candidates.find((candidate) => candidate.slice.id === 'slice-ready-missing-dependency')
        ?.incompleteDependencyIds,
      ['slice-missing'],
    );
    assert.equal(
      alphaSelection.candidates.find((candidate) => candidate.slice.id === 'slice-in-progress')?.eligibleStatus,
      false,
    );

    assert.deepEqual(listExecutableSlices('alpha', { specId: 'spec-previous' }).map((slice) => slice.id), [
      'slice-previous-ready',
    ]);

    const betaChange: WorkChange = {
      id: 'change-beta',
      projectId: 'beta',
      title: 'No executable slice',
      summary: 'Used to verify failure handling.',
      intent: 'implementation_only',
      status: 'active',
      request: { summary: 'No slice should be executable.', source: 'user' },
      scope: {
        inScope: ['src/runtime'],
        outOfScope: ['src/cli.ts'],
        acceptanceCriteria: ['fail clearly when no slice can execute'],
      },
      currentStage: 'engineering_exec',
      activeSpecId: 'spec-beta',
      stageStatus: { engineering_exec: 'ready' },
      blockerIds: [],
      createdAt: '2026-04-04T11:00:00.000Z',
      updatedAt: '2026-04-04T11:05:00.000Z',
    };
    const betaSpec: WorkSpec = {
      id: 'spec-beta',
      projectId: 'beta',
      changeId: 'change-beta',
      version: 1,
      title: 'Blocked execution spec',
      summary: 'No executable slice should be returned.',
      status: 'approved',
      goals: ['validate failure path'],
      constraints: [],
      acceptanceCriteria: ['selection returns null'],
      sourceArtifacts: [],
      approvedAt: '2026-04-04T11:01:00.000Z',
      createdAt: '2026-04-04T11:01:00.000Z',
      updatedAt: '2026-04-04T11:01:00.000Z',
    };
    const betaSlices: WorkSlice[] = [
      {
        id: 'beta-ready-blocked',
        projectId: 'beta',
        changeId: 'change-beta',
        specId: 'spec-beta',
        title: 'Blocked ready slice',
        summary: 'Has blockers.',
        status: 'ready',
        sequence: 1,
        priority: 'critical',
        size: 'xs',
        dependencyIds: [],
        blockers: ['approval-needed'],
        taskRefs: ['BETA-001'],
        acceptanceChecks: ['blockers prevent execution'],
        allowedPaths: ['src/runtime'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-04T11:02:00.000Z',
        updatedAt: '2026-04-04T11:02:00.000Z',
      },
      {
        id: 'beta-queued-missing',
        projectId: 'beta',
        changeId: 'change-beta',
        specId: 'spec-beta',
        title: 'Missing dependency',
        summary: 'Dependency is not complete.',
        status: 'queued',
        sequence: 2,
        priority: 'high',
        size: 's',
        dependencyIds: ['beta-missing'],
        blockers: [],
        taskRefs: ['BETA-002'],
        acceptanceChecks: ['missing dependencies prevent execution'],
        allowedPaths: ['src/runtime'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-04T11:03:00.000Z',
        updatedAt: '2026-04-04T11:03:00.000Z',
      },
    ];

    createChange(betaChange);
    createSpec(betaSpec);
    for (const slice of betaSlices) createSlice(slice);
    refreshLedger('beta', { updatedAt: '2026-04-04T11:05:00.000Z' });

    const betaSelection = resolveExecutableSliceSelection('beta');
    assert.equal(betaSelection.selectedSlice, null);
    assert.deepEqual(betaSelection.executableSlices, []);
    assert.equal(selectNextExecutableSlice('beta'), null);

    let missingExecutableError = '';
    try {
      requireNextExecutableSlice('beta');
    } catch (error) {
      missingExecutableError = String((error as Error)?.message || error || '');
    }
    assert.match(missingExecutableError, /No executable slice is available/);
    assert.match(missingExecutableError, /status ready\/queued, dependencies done, blockers absent/);

    console.log('Slice selection policy check passed.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
