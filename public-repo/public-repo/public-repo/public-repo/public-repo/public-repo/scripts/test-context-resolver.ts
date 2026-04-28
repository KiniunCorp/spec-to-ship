import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WorkChange, WorkGate, WorkRun, WorkSlice, WorkSpec } from '../src/types/index.js';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-context-resolver-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      createChange,
      createGate,
      createRun,
      createSlice,
      createSpec,
      listOpenChanges,
      listOpenRuns,
      listOpenSlices,
      listOpenSpecs,
      resolveContext,
    } = await import('../src/index.js');
    const { writeArtifact } = await import('../src/artifacts/store.js');

    const projectId = 'alpha';

    const changes: WorkChange[] = [
      {
        id: 'change-active',
        projectId,
        title: 'Active change',
        summary: 'Current implementation work.',
        intent: 'implementation_only',
        status: 'active',
        request: { summary: 'Keep implementation moving.', source: 'user' },
        scope: { inScope: ['src/orchestrator'], outOfScope: ['src/cli.ts'], acceptanceCriteria: ['context stays stable'] },
        currentStage: 'engineering',
        activeSpecId: 'spec-active-2',
        stageStatus: { engineering: 'in_progress' },
        blockerIds: [],
        createdAt: '2026-04-02T01:00:00.000Z',
        updatedAt: '2026-04-02T05:00:00.000Z',
      },
      {
        id: 'change-blocked',
        projectId,
        title: 'Blocked change',
        summary: 'Waiting on approval.',
        intent: 'bug_fix',
        status: 'blocked',
        request: { summary: 'Investigate a blocked regression.', source: 'user' },
        scope: { inScope: ['src/runtime'], outOfScope: ['src/cli.ts'], acceptanceCriteria: ['unblock safely'] },
        currentStage: 'research',
        stageStatus: { research: 'blocked' },
        blockerIds: ['gate:gate-review'],
        createdAt: '2026-04-02T00:30:00.000Z',
        updatedAt: '2026-04-02T04:00:00.000Z',
      },
      {
        id: 'change-draft',
        projectId,
        title: 'Draft change',
        summary: 'Future follow-up.',
        intent: 'new_feature',
        status: 'draft',
        request: { summary: 'Potential dashboard work.', source: 'user' },
        scope: { inScope: ['docs'], outOfScope: [], acceptanceCriteria: ['evaluate later'] },
        stageStatus: {},
        blockerIds: [],
        createdAt: '2026-04-02T02:00:00.000Z',
        updatedAt: '2026-04-02T03:00:00.000Z',
      },
      {
        id: 'change-done',
        projectId,
        title: 'Completed change',
        summary: 'Historical work.',
        intent: 'technical_refactor',
        status: 'done',
        request: { summary: 'Already shipped.', source: 'system' },
        scope: { inScope: ['src/ledger'], outOfScope: [], acceptanceCriteria: ['history preserved'] },
        stageStatus: { engineering: 'done' },
        blockerIds: [],
        createdAt: '2026-04-01T01:00:00.000Z',
        updatedAt: '2026-04-01T02:00:00.000Z',
        completedAt: '2026-04-01T02:00:00.000Z',
      },
    ];

    const specs: WorkSpec[] = [
      {
        id: 'spec-active-2',
        projectId,
        changeId: 'change-active',
        version: 2,
        title: 'Current active spec',
        summary: 'Most relevant implementation spec.',
        status: 'approved',
        goals: ['keep execution aligned'],
        constraints: ['stay within assigned scope'],
        acceptanceCriteria: ['resolver surfaces the latest open spec'],
        sourceArtifacts: [
          { path: 'PRD.md', kind: 'markdown', label: 'PRD.md', stage: 'pm' },
          { path: 'PrototypeSpec.md', kind: 'markdown', label: 'PrototypeSpec.md', stage: 'design' },
          { path: 'FigmaLink.json', kind: 'json', label: 'FigmaLink.json', stage: 'design' },
        ],
        designDefinition: {
          path: 'PrototypeSpec.md',
          kind: 'markdown',
          label: 'PrototypeSpec.md',
          stage: 'design',
        },
        stageSummaries: {
          design: 'Use the linked prototype spec and frame manifest as the design reference during execution.',
        },
        approvedAt: '2026-04-02T05:10:00.000Z',
        createdAt: '2026-04-02T04:30:00.000Z',
        updatedAt: '2026-04-02T05:10:00.000Z',
      },
      {
        id: 'spec-blocked-1',
        projectId,
        changeId: 'change-blocked',
        version: 1,
        title: 'Blocked investigation spec',
        summary: 'Research is paused pending approval.',
        status: 'review_ready',
        goals: ['capture bug context'],
        constraints: [],
        acceptanceCriteria: ['remain visible to the resolver'],
        sourceArtifacts: [],
        createdAt: '2026-04-02T03:00:00.000Z',
        updatedAt: '2026-04-02T04:30:00.000Z',
      },
      {
        id: 'spec-archived',
        projectId,
        changeId: 'change-blocked',
        version: 0,
        title: 'Old archived spec',
        summary: 'Should not appear in open specs.',
        status: 'archived',
        goals: ['ignore old state'],
        constraints: [],
        acceptanceCriteria: ['archive stays hidden'],
        sourceArtifacts: [],
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T01:00:00.000Z',
      },
    ];

    const slices: WorkSlice[] = [
      {
        id: 'slice-running',
        projectId,
        changeId: 'change-active',
        specId: 'spec-active-2',
        title: 'Current execution slice',
        summary: 'In progress work.',
        status: 'in_progress',
        sequence: 2,
        priority: 'high',
        size: 's',
        dependencyIds: [],
        blockers: [],
        taskRefs: ['P2-T2'],
        acceptanceChecks: ['context validation'],
        allowedPaths: ['src/orchestrator'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-02T04:35:00.000Z',
        updatedAt: '2026-04-02T05:20:00.000Z',
      },
      {
        id: 'slice-ready',
        projectId,
        changeId: 'change-active',
        specId: 'spec-active-2',
        title: 'Queued follow-up slice',
        summary: 'Ready after the current work.',
        status: 'ready',
        sequence: 1,
        priority: 'medium',
        size: 's',
        dependencyIds: [],
        blockers: [],
        taskRefs: ['P2-T3'],
        acceptanceChecks: ['planner integration'],
        allowedPaths: ['src/orchestrator'],
        outOfScopePaths: ['src/cli.ts'],
        relatedArtifacts: [],
        createdAt: '2026-04-02T04:20:00.000Z',
        updatedAt: '2026-04-02T05:00:00.000Z',
      },
      {
        id: 'slice-done',
        projectId,
        changeId: 'change-blocked',
        specId: 'spec-blocked-1',
        title: 'Completed historical slice',
        summary: 'Should not appear as open work.',
        status: 'done',
        sequence: 3,
        priority: 'low',
        size: 'xs',
        dependencyIds: [],
        blockers: [],
        taskRefs: [],
        acceptanceChecks: [],
        allowedPaths: ['src/runtime'],
        outOfScopePaths: [],
        relatedArtifacts: [],
        createdAt: '2026-04-01T04:00:00.000Z',
        updatedAt: '2026-04-01T05:00:00.000Z',
        completedAt: '2026-04-01T05:00:00.000Z',
      },
    ];

    const runs: WorkRun[] = [
      {
        id: 'run-running',
        projectId,
        changeId: 'change-active',
        specId: 'spec-active-2',
        sliceId: 'slice-running',
        status: 'running',
        provider: 'codex',
        evidence: [],
        createdAt: '2026-04-02T05:25:00.000Z',
        updatedAt: '2026-04-02T05:30:00.000Z',
      },
      {
        id: 'run-created',
        projectId,
        changeId: 'change-active',
        specId: 'spec-active-2',
        sliceId: 'slice-ready',
        status: 'created',
        provider: 'codex',
        evidence: [],
        createdAt: '2026-04-02T05:00:00.000Z',
        updatedAt: '2026-04-02T05:05:00.000Z',
      },
      {
        id: 'run-succeeded',
        projectId,
        changeId: 'change-blocked',
        specId: 'spec-blocked-1',
        sliceId: 'slice-done',
        status: 'succeeded',
        provider: 'codex',
        verificationPassed: true,
        evidence: [],
        createdAt: '2026-04-01T05:10:00.000Z',
        updatedAt: '2026-04-01T05:30:00.000Z',
        finishedAt: '2026-04-01T05:30:00.000Z',
      },
    ];

    const gates: WorkGate[] = [
      {
        id: 'gate-review',
        projectId,
        changeId: 'change-blocked',
        type: 'spec_review',
        status: 'pending',
        title: 'Blocked spec review',
        reason: 'Human review is required.',
        specId: 'spec-blocked-1',
        createdAt: '2026-04-02T04:10:00.000Z',
        updatedAt: '2026-04-02T04:10:00.000Z',
      },
    ];

    for (const change of changes) {
      createChange(change);
    }
    for (const spec of specs) {
      createSpec(spec);
    }
    for (const slice of slices) {
      createSlice(slice);
    }
    for (const run of runs) {
      createRun(run);
    }
    for (const gate of gates) {
      createGate(gate);
    }

    writeArtifact(projectId, 'PRD.md', '# Product Definition');
    writeArtifact(projectId, 'PrototypeSpec.md', '# Prototype Specification');
    writeArtifact(projectId, 'FigmaLink.json', '{\n  "pageName": "Alpha Prototype",\n  "frames": []\n}');
    writeArtifact(projectId, 'TechSpec.md', '# Technical Plan');

    assert.deepEqual(
      listOpenChanges(projectId).map((change) => change.id),
      ['change-active', 'change-blocked', 'change-draft'],
    );
    assert.deepEqual(
      listOpenSpecs(projectId).map((spec) => spec.id),
      ['spec-active-2', 'spec-blocked-1'],
    );
    assert.deepEqual(
      listOpenSlices(projectId).map((slice) => slice.id),
      ['slice-running', 'slice-ready'],
    );
    assert.deepEqual(
      listOpenRuns(projectId).map((run) => run.id),
      ['run-running', 'run-created'],
    );

    const resolved = resolveContext(projectId, 'resume_existing_change');
    assert.equal(resolved.activeChange?.id, 'change-active');
    assert.equal(resolved.activeSpec?.id, 'spec-active-2');
    assert.equal(resolved.flags.hasExistingWork, true);
    assert.equal(resolved.flags.hasActiveWork, true);
    assert.equal(resolved.flags.hasStageArtifacts, true);
    assert.equal(resolved.flags.hasPendingGate, true);
    assert.equal(resolved.flags.hasBlockedChange, true);
    assert.deepEqual(
      resolved.artifacts.map((artifact) => artifact.label),
      ['FigmaLink.json', 'PRD.md', 'PrototypeSpec.md', 'TechSpec.md'],
    );
    assert.equal(
      resolved.designContext?.summary,
      'Use the linked prototype spec and frame manifest as the design reference during execution.',
    );
    assert.equal(resolved.designContext?.designDefinition?.label, 'PrototypeSpec.md');
    assert.deepEqual(
      resolved.designContext?.supportingArtifacts.map((artifact) => artifact.label),
      ['FigmaLink.json'],
    );
    assert.ok(resolved.rationale.includes('active change change-active'));
    assert.ok(resolved.rationale.includes('active spec spec-active-2'));
    assert.ok(resolved.matchedSignals.includes('intent:resume_existing_change'));
    assert.ok(resolved.matchedSignals.includes('pending_gates:1'));

    const empty = resolveContext('empty-project', 'new_feature');
    assert.equal(empty.flags.hasExistingWork, false);
    assert.equal(empty.flags.hasActiveWork, false);
    assert.deepEqual(empty.openChanges, []);
    assert.deepEqual(empty.artifacts, []);
    assert.equal(empty.rationale, 'No existing project artifacts or operational work records were found.');
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

void main();
