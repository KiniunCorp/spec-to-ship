import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function writeOnboardingArtifacts(
  s2sDir: string,
  payload: {
    state: string;
    requestedPath: string;
    recommendedRoot: string;
    selectedRoot: string;
    projectAlias: string;
    preferredClient: string;
    guardrailPolicy: string;
    conflictCount: number;
    exceptionCount: number;
    decisions: string[];
  },
): void {
  const dir = path.join(s2sDir, 'artifacts', 'onboarding');
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();

  writeFileSync(
    path.join(dir, 'CurrentState.md'),
    [
      '# Current State',
      '',
      `- generatedAt: ${now}`,
      `- state: ${payload.state}`,
      `- requestedPath: ${payload.requestedPath}`,
      `- recommendedRoot: ${payload.recommendedRoot}`,
      `- selectedRoot: ${payload.selectedRoot}`,
      `- conflictCount: ${payload.conflictCount}`,
      `- exceptionCount: ${payload.exceptionCount}`,
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    path.join(dir, 'GovernanceDelta.md'),
    [
      '# Governance Delta',
      '',
      `- projectAlias: ${payload.projectAlias}`,
      `- guardrailPolicy: ${payload.guardrailPolicy}`,
      `- detectedConflicts: ${payload.conflictCount}`,
      `- approvedExceptions: ${payload.exceptionCount}`,
      '',
      'Notes:',
      '- Canonical project governance lives in `.s2s/guardrails/*`.',
      '- Root chat-client files are refreshed as compatibility shims when needed.',
      '- Exceptions remain visible in doctor report.',
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    path.join(dir, 'OnboardingDecisions.md'),
    [
      '# Onboarding Decisions',
      '',
      `- generatedAt: ${now}`,
      `- projectAlias: ${payload.projectAlias}`,
      `- preferredClient: ${payload.preferredClient}`,
      `- guardrailPolicy: ${payload.guardrailPolicy}`,
      '',
      'Decisions:',
      ...payload.decisions.map((line) => `- ${line}`),
      '',
    ].join('\n'),
    'utf8',
  );

  writeFileSync(
    path.join(dir, 'OnboardingPlan.md'),
    [
      '# Onboarding Plan',
      '',
      '1. Detect repository context and root recommendation.',
      '2. Confirm project root and launch client.',
      '3. Materialize canonical guardrails, root compatibility shims, and config files.',
      '4. Resolve guardrail discrepancies policy.',
      '5. Persist onboarding outputs for traceability.',
      '',
      `Completed at: ${now}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

export function writeStageExecutionArtifact(
  s2sDir: string,
  payload: {
    stage: string;
    status: 'success' | 'failed';
    projectAlias: string;
    appRoot: string;
    guardrailPolicy: string;
    activeConflictCount: number;
    startedAt: string;
    completedAt: string;
    summary: string;
  },
): void {
  const stageSafe = String(payload.stage || 'unknown').trim().toLowerCase() || 'unknown';
  const completedAt = String(payload.completedAt || new Date().toISOString());
  const startedAt = String(payload.startedAt || completedAt);
  const stamp = completedAt.replace(/[:.]/g, '-');
  const stageDir = path.join(s2sDir, 'artifacts', 'stages', stageSafe);
  mkdirSync(stageDir, { recursive: true });

  const lines = [
    '# Stage Execution Report',
    '',
    `- projectAlias: ${payload.projectAlias}`,
    `- appRoot: ${payload.appRoot}`,
    `- stage: ${stageSafe}`,
    `- status: ${payload.status}`,
    `- guardrailPolicy: ${payload.guardrailPolicy}`,
    `- activeConflictCount: ${payload.activeConflictCount}`,
    `- startedAt: ${startedAt}`,
    `- completedAt: ${completedAt}`,
    '',
    '## Summary',
    '',
    String(payload.summary || '(no summary)').trim(),
    '',
  ];

  const content = `${lines.join('\n')}\n`;
  writeFileSync(path.join(stageDir, `${stamp}.md`), content, 'utf8');
  writeFileSync(path.join(stageDir, 'latest.md'), content, 'utf8');
}
