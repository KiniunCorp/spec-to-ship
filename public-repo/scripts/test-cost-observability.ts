import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { RuntimeConfig } from '../src/types/index.js';
import { enforceBudgetBeforeRequest, loadUsageSummary, recordUsageEventFromCompletion } from '../src/costs/tracker.js';
import { resolveProviderLabel } from '../src/providers/interface.js';

const tempRoot = mkdtempSync(path.join(tmpdir(), 's2s-cost-'));
process.chdir(tempRoot);
mkdirSync(path.join(tempRoot, 'config'), { recursive: true });
mkdirSync(path.join(tempRoot, 'artifacts'), { recursive: true });

writeFileSync(
  path.join(tempRoot, 'config', 'pricing.json'),
  JSON.stringify(
    {
      version: 1,
      currency: 'USD',
      models: [
        {
          provider: 'openai',
          model: 'gpt-5.4',
          inputUsdPer1M: 2.5,
          outputUsdPer1M: 10,
        },
        {
          provider: 'codex',
          model: 'cli-default',
          inputUsdPer1M: 2.5,
          outputUsdPer1M: 10,
          estimationMultiplier: 1.1,
        },
      ],
    },
    null,
    2,
  ) + '\n',
  'utf8',
);

const runtime: RuntimeConfig = {
  productName: 'spec-to-ship',
  defaultBranch: 'main',
  workspace: {
    basePath: '.',
    orchestratorDirName: '.',
    projectDirName: 'app',
    worktreesDirName: 'app-worktrees',
  },
  github: {
    remoteName: 'origin',
    autoPush: false,
    autoPR: false,
    autoMerge: false,
  },
  execution: {
    mode: 'manual',
    templateId: '',
    commandTemplate: '',
    maxTasksPerRun: 1,
    stopOnFailure: true,
    timeoutMs: 60000,
    allowedCommands: [],
    allowUnsafeRawCommand: false,
  },
  costControl: {
    enabled: true,
    budgetUsd: 100,
    warnThresholdPct: 80,
    hardStopThresholdPct: 100,
  },
};

const projectId = 'cost-test-project';
enforceBudgetBeforeRequest(projectId, runtime);

recordUsageEventFromCompletion({
  projectId,
  stage: 'pm',
  operation: 'agent_run',
  mode: 'api',
  provider: 'openai',
  model: 'gpt-5.4',
  usage: {
    inputTokens: 12000,
    outputTokens: 3000,
    totalTokens: 15000,
    estimated: false,
  },
  runtimeConfig: runtime,
});

recordUsageEventFromCompletion({
  projectId,
  stage: 'research',
  operation: 'agent_run',
  mode: 'cli',
  provider: 'codex',
  model: 'cli-default',
  usage: {
    inputTokens: 5000,
    outputTokens: 1000,
    totalTokens: 6000,
    estimated: true,
  },
  runtimeConfig: runtime,
});

const summary = loadUsageSummary(projectId, runtime.costControl);
assert.equal(summary.totals.requests, 2);
assert.equal(summary.totals.estimatedRequests, 1);
assert.equal(summary.totals.exactRequests, 1);
assert.ok(summary.totals.costUsd > 0);

const blockedRuntime: RuntimeConfig = {
  ...runtime,
  costControl: {
    ...runtime.costControl,
    budgetUsd: Number((summary.totals.costUsd * 0.5).toFixed(8)),
  },
};

let blocked = false;
try {
  enforceBudgetBeforeRequest(projectId, blockedRuntime);
} catch {
  blocked = true;
}

assert.equal(blocked, true);

assert.equal(resolveProviderLabel({ mode: 'openai_compatible', model: 'gpt-4.1-mini' }), 'openai');
assert.equal(
  resolveProviderLabel({
    mode: 'cli',
    model: 'cli-default',
    cli: { command: 'OpenCode', args: [] },
  }),
  'opencode',
);
assert.equal(resolveProviderLabel({ mode: 'api', provider: 'openai', model: 'gpt-5.4' }), 'openai');

console.log('Cost observability tests passed.');
