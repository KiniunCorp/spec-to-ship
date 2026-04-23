import assert from 'node:assert/strict';
import { classifyIntent, decideRoute } from '../src/index.js';
import type { WorkIntent } from '../src/types/index.js';

type IntentFixture = {
  prompt: string;
  expectedIntent: WorkIntent;
};

const fixtures: IntentFixture[] = [
  {
    prompt: 'Add a new approvals dashboard for release managers.',
    expectedIntent: 'new_feature',
  },
  {
    prompt: 'Polish the onboarding flow and improve the existing feature copy.',
    expectedIntent: 'feature_refinement',
  },
  {
    prompt: 'Fix the checkout regression that throws a payment error.',
    expectedIntent: 'bug_fix',
  },
  {
    prompt: 'Investigate the production incident and write the root cause summary.',
    expectedIntent: 'incident_investigation',
  },
  {
    prompt: 'Refactor the orchestration layer to reduce tech debt and improve maintainability.',
    expectedIntent: 'technical_refactor',
  },
  {
    prompt: 'Just implement the queued API client changes without extra planning.',
    expectedIntent: 'implementation_only',
  },
  // Vague new-project prompts must NOT classify as implementation_only.
  // "build" alone doesn't imply a spec already exists.
  {
    prompt: 'Lets build a tech website.',
    expectedIntent: 'new_feature',
  },
  {
    prompt: 'Build a new dashboard for the ops team.',
    expectedIntent: 'new_feature',
  },
  {
    prompt: 'I want to create a CLI tool for managing deployments.',
    expectedIntent: 'new_feature',
  },
  {
    prompt: 'Update the spec and acceptance criteria before we continue execution.',
    expectedIntent: 'spec_revision',
  },
  {
    prompt: 'Resume change-123 and continue the current slice work.',
    expectedIntent: 'resume_existing_change',
  },
  {
    prompt: 'We need a hotfix for the production outage right now.',
    expectedIntent: 'hotfix',
  },
];

function main(): void {
  for (const fixture of fixtures) {
    const result = classifyIntent(fixture.prompt);
    assert.equal(result.intent, fixture.expectedIntent, fixture.prompt);
    assert.ok(result.confidence >= 0.55, `expected explicit confidence for ${fixture.expectedIntent}`);
    assert.ok(result.matchedSignals.length > 0, `expected matched signals for ${fixture.expectedIntent}`);
  }

  const fallback = classifyIntent('Can you help with this request?');
  assert.equal(fallback.intent, 'new_feature');
  assert.equal(fallback.confidence, 0.4);
  assert.deepEqual(fallback.matchedSignals, []);

  const newFeatureRoute = decideRoute('alpha', 'Add a new release dashboard for the QA team.');
  assert.equal(newFeatureRoute.intent, 'new_feature');
  assert.deepEqual(newFeatureRoute.recommendedStages, ['pm', 'design', 'engineering']);
  assert.equal(newFeatureRoute.stageDecisions.find((decision) => decision.stage === 'design')?.action, 'invoke');
  assert.equal(newFeatureRoute.stageDecisions.find((decision) => decision.stage === 'research')?.action, 'skip');

  const bugRoute = decideRoute('alpha', 'Fix the failed sync regression before the next deploy.');
  assert.equal(bugRoute.intent, 'bug_fix');
  assert.deepEqual(bugRoute.recommendedStages, ['engineering']);
  assert.equal(bugRoute.stageDecisions.find((decision) => decision.stage === 'research')?.action, 'skip');

  const hotfixRoute = decideRoute('alpha', 'Ship an urgent hotfix for the production outage.');
  assert.equal(hotfixRoute.intent, 'hotfix');
  assert.deepEqual(hotfixRoute.recommendedStages, ['engineering', 'engineering_exec']);
  assert.equal(hotfixRoute.stageDecisions.find((decision) => decision.stage === 'engineering_exec')?.action, 'invoke');
}

main();
