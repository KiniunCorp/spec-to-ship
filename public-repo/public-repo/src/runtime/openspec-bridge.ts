import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineeringExecutionHandoff } from '../types/index.js';

export function materializeOpenSpecChange(projectRepoPath: string, handoff: EngineeringExecutionHandoff): string[] {
  const changeRoot = path.join(projectRepoPath, 'openspec', 'changes', handoff.changeId);
  const specsRoot = path.join(changeRoot, 'specs', 'engineering-execution');
  mkdirSync(specsRoot, { recursive: true });

  const proposal = buildProposal(handoff);
  const design = buildDesign(handoff);
  const tasks = buildTasks(handoff);
  const spec = buildSpec(handoff);

  const files = [
    path.join(changeRoot, 'proposal.md'),
    path.join(changeRoot, 'design.md'),
    path.join(changeRoot, 'tasks.md'),
    path.join(specsRoot, 'spec.md'),
  ];

  writeFileSync(files[0], proposal, 'utf8');
  writeFileSync(files[1], design, 'utf8');
  writeFileSync(files[2], tasks, 'utf8');
  writeFileSync(files[3], spec, 'utf8');

  return files;
}

function buildProposal(handoff: EngineeringExecutionHandoff): string {
  return [
    '# Proposal',
    '',
    `Implement engineering execution for change \`${handoff.changeId}\` using resolved slice \`${handoff.sliceId}\`.`,
    '',
    '## Slice Scope',
    '',
    `- Slice: \`${handoff.sliceId}\` (${handoff.sliceTitle})`,
    `- Sequence: ${handoff.sliceSequence}`,
    ...(handoff.runId ? [`- Run: \`${handoff.runId}\``] : []),
    ...(handoff.tasks.length > 0
      ? handoff.tasks.map((task) => `- Task \`${task.taskId}\`: ${task.title} — ${task.summary}`)
      : ['- No explicit persisted task subset was available for this slice.']),
    '',
    '## Scope Constraints',
    '',
    ...renderBulletList(handoff.allowedPaths, 'No explicit allowed-path restriction was persisted.'),
    '',
    '## Out of Scope',
    '',
    ...renderBulletList(handoff.outOfScopePaths, 'No explicit out-of-scope paths were persisted.'),
    '',
    '## Acceptance Checks',
    '',
    ...renderBulletList(handoff.acceptanceChecks, 'No slice-specific acceptance checks were persisted.'),
    '',
  ].join('\n');
}

function buildDesign(handoff: EngineeringExecutionHandoff): string {
  const excerpt = handoff.sliceContextDocument.slice(0, 8000) || '(Slice context unavailable)';
  return [
    '# Design',
    '',
    '## Context',
    '',
    'This design is derived from the resolved `SLICE_CONTEXT.md` handoff for the active slice.',
    '',
    '## Slice Context Excerpt',
    '',
    excerpt,
    '',
  ].join('\n');
}

function buildTasks(handoff: EngineeringExecutionHandoff): string {
  return [
    '# Tasks',
    '',
    ...(handoff.tasks.length > 0
      ? handoff.tasks.map((task) => {
          const dependencies = task.dependencyIds.length ? ` (depends on ${task.dependencyIds.join(', ')})` : '';
          return `- [ ] ${task.taskId} - ${task.title}: ${task.summary}${dependencies}`;
        })
      : ['- [ ] SLICE-UNSCOPED - Review the persisted slice context and identify the missing task subset before implementation.']),
    '',
  ].join('\n');
}

function buildSpec(handoff: EngineeringExecutionHandoff): string {
  return [
    '# Engineering Execution Spec',
    '',
    '## Requirements',
    '',
    '- Engineering execution MUST create an OpenSpec change from the resolved persisted slice handoff.',
    '- Implementation MUST stay within the persisted task subset, allowed paths, and out-of-scope boundaries for this slice.',
    '- Validation evidence MUST be recorded before delivery.',
    '',
    '## Planned Slice',
    '',
    `- Change: \`${handoff.changeId}\``,
    `- Spec: \`${handoff.specId}\``,
    `- Slice: \`${handoff.sliceId}\` (${handoff.sliceTitle})`,
    '',
    '## Planned Tasks',
    '',
    ...renderBulletList(
      handoff.tasks.map((task) => `${task.taskId}: ${task.title}`),
      'No explicit persisted task subset was available for this slice.',
    ),
    '',
    '## Acceptance Checks',
    '',
    ...renderBulletList(handoff.acceptanceChecks, 'No slice-specific acceptance checks were persisted.'),
    '',
  ].join('\n');
}

function renderBulletList(values: readonly string[], emptyMessage: string): string[] {
  const normalized = values.map((value) => String(value || '').trim()).filter(Boolean);
  if (normalized.length === 0) {
    return [`- ${emptyMessage}`];
  }
  return normalized.map((value) => `- ${value}`);
}
