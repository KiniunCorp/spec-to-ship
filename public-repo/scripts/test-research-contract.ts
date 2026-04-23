import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

async function main(): Promise<void> {
  const { ResearchAgent } = await import('../src/agents/research.js');
  const { validateResearch } = await import('../src/quality/checks.js');
  const { RESEARCH_TEMPLATE } = await import('../src/templates/index.js');

  const agent = new ResearchAgent(
    {
      async complete() {
        throw new Error('Provider should not be called while inspecting the prompt contract.');
      },
    },
    'research-contract',
  );

  assert.match(agent.systemPrompt, /senior technical investigator/i);
  assert.match(agent.systemPrompt, /Do not propose user interviews, surveys, market research, or prototype usability testing/i);
  assert.match(agent.systemPrompt, /## Investigation Goal/);
  assert.match(agent.systemPrompt, /## Unknowns and Hypotheses/);
  assert.match(agent.systemPrompt, /## Investigation Plan/);
  assert.match(agent.systemPrompt, /## Risks and Constraints/);
  assert.match(agent.systemPrompt, /## Recommendation/);

  assert.deepEqual(RESEARCH_TEMPLATE.requiredHeadings, [
    'Investigation Goal',
    'Current Technical Context',
    'Unknowns and Hypotheses',
    'Investigation Plan',
    'Risks and Constraints',
    'Recommendation',
  ]);

  const validResearch = `# Research

## Investigation Goal
- Confirm whether the release-approval flow can reuse the existing audit event bus safely.

## Current Technical Context
- Approval gates already persist change/spec linkage in the ledger.
- Delivery uses GitHub-backed branch safety checks.

## Unknowns and Hypotheses
- The approval event payload may be missing actor metadata.
- Reusing the event bus may introduce ordering issues during retries.

## Investigation Plan
- Inspect the current approval gate payload to confirm which fields are emitted.
- Trace the delivery path to verify whether events are retried or deduplicated.
- Review existing ledger consumers to identify ordering assumptions that would break on retries.

## Risks and Constraints
- Event schema drift would break downstream audit ingestion.
- Delivery retries could create duplicate approvals if idempotency is missing.

## Recommendation
- Gather the payload and retry evidence first, then proceed to engineering if actor metadata and idempotency guarantees are confirmed.`;

  assert.equal(validateResearch(validResearch).passed, true);

  const invalidResearch = `# Research

## Investigation Goal
- Investigate the issue.

## Current Technical Context
- Context is incomplete.

## Risks and Constraints
- Unknown.

## Recommendation
- Ask users what they think.`;

  const invalidCheck = validateResearch(invalidResearch);
  assert.equal(invalidCheck.passed, false);
  assert.ok(invalidCheck.issues.includes('Missing Investigation Plan section'));
  assert.ok(invalidCheck.issues.includes('Missing Unknowns and Hypotheses section'));

  const cliHelp = spawnSync('tsx', ['src/cli.ts', 'help', 'stage'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(cliHelp.status, 0, cliHelp.stderr || cliHelp.stdout);
  assert.match(cliHelp.stdout, /research\s+Technical investigation and architecture validation/);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
