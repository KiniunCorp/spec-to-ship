import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

async function main(): Promise<void> {
  const sandbox = mkdtempSync(path.join(tmpdir(), 's2s-orchestration-decision-'));
  const previousCwd = process.cwd();

  try {
    process.chdir(sandbox);

    const {
      ORCHESTRATION_DECISION_RECORD_VERSION,
      buildOrchestrationDecisionRecord,
      buildRouteDecision,
      decideOrchestration,
      getLedger,
      planFlow,
      recordOrchestrationDecision,
    } = await import('../src/index.js');

    const prompt = 'Add a new release dashboard with UI loading states for approvals.';
    const route = buildRouteDecision(planFlow('alpha', prompt));
    const built = buildOrchestrationDecisionRecord('alpha', prompt, route, '2026-04-03T10:00:00.000Z');

    assert.equal(built.schemaVersion, ORCHESTRATION_DECISION_RECORD_VERSION);
    assert.equal(built.projectId, 'alpha');
    assert.equal(built.request, prompt);
    assert.equal(built.decidedAt, '2026-04-03T10:00:00.000Z');
    assert.equal(built.decision.intent, 'new_feature');
    assert.equal(built.decision.stageDecisions.length, 5);

    const persisted = recordOrchestrationDecision('alpha', prompt, route, '2026-04-03T10:05:00.000Z');
    assert.equal(getLedger('alpha')?.lastDecision?.schemaVersion, persisted.schemaVersion);
    assert.equal(getLedger('alpha')?.lastDecision?.request, persisted.request);
    assert.equal(getLedger('alpha')?.lastDecision?.decidedAt, persisted.decidedAt);
    assert.deepEqual(getLedger('alpha')?.lastDecision?.decision.stageDecisions, persisted.decision.stageDecisions);
    assert.equal(getLedger('alpha')?.lastIntent, 'new_feature');
    assert.equal(getLedger('alpha')?.updatedAt, '2026-04-03T10:05:00.000Z');

    const resumed = decideOrchestration(
      'alpha',
      'Resume the current change and continue the execution slice without restarting planning.',
      '2026-04-03T10:10:00.000Z',
    );
    assert.equal(resumed.schemaVersion, ORCHESTRATION_DECISION_RECORD_VERSION);
    assert.equal(resumed.projectId, 'alpha');
    assert.equal(resumed.decidedAt, '2026-04-03T10:10:00.000Z');
    assert.equal(resumed.decision.intent, 'resume_existing_change');
    assert.ok(resumed.decision.stageDecisions.some((decision) => decision.stage === 'engineering'));
    assert.equal(getLedger('alpha')?.lastDecision?.decision.intent, resumed.decision.intent);
    assert.equal(getLedger('alpha')?.lastDecision?.decidedAt, resumed.decidedAt);
  } finally {
    process.chdir(previousCwd);
    rmSync(sandbox, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
