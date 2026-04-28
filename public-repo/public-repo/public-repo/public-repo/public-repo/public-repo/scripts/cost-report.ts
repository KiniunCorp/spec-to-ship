import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { listProjectsWithUsage, loadUsageSummary, resolveCostControl } from '../src/costs/tracker.js';
import { loadRuntimeConfig } from '../src/runtime/config.js';

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : undefined;
}

function main(): void {
  const projectId = readArg('project-id') || readArg('project');
  const runAll = process.argv.includes('--all') || (!projectId && process.argv.includes('all'));

  if (runAll) {
    const projects = listProjectsWithUsage();
    if (projects.length === 0) {
      console.log('No usage data found under .s2s/artifacts/*/usage.');
      return;
    }
    for (const id of projects) {
      const output = generateProjectReport(id);
      console.log(`${id}: ${output}`);
    }
    return;
  }

  if (!projectId) {
    console.error('Usage: npx tsx scripts/cost-report.ts --project-id=<id> | --all');
    process.exit(1);
  }
  const output = generateProjectReport(projectId);
  console.log(`Report generated: ${output}`);
}

function generateProjectReport(projectId: string): string {
  const runtime = loadRuntimeConfig();
  const control = resolveCostControl(runtime);
  const summary = loadUsageSummary(projectId, control);

  const rows = Object.values(summary.byProviderModelStage).sort((a, b) => b.costUsd - a.costUsd);

  const lines: string[] = [
    '# Usage & Cost Report',
    '',
    `- Project: ${projectId}`,
    `- Currency: ${summary.currency}`,
    `- Total requests: ${summary.totals.requests}`,
    `- Total tokens: ${summary.totals.totalTokens}`,
    `- Total cost (USD): ${summary.totals.costUsd.toFixed(6)}`,
    `- Estimated requests: ${summary.totals.estimatedRequests}`,
    `- Exact requests: ${summary.totals.exactRequests}`,
    `- Missing pricing requests: ${summary.totals.priceMissingRequests}`,
    `- Budget status: ${summary.budget.status}`,
    `- Budget used: ${summary.budget.percentUsed.toFixed(2)}%`,
    '',
    '## Breakdown by provider/model/stage',
    '',
    '| Provider | Model | Stage | Requests | Tokens | Cost USD | Estimated |',
    '|---|---|---|---:|---:|---:|---:|',
  ];

  for (const row of rows) {
    lines.push(
      `| ${row.provider} | ${row.model} | ${row.stage} | ${row.requests} | ${row.totalTokens} | ${row.costUsd.toFixed(6)} | ${row.estimatedRequests} |`,
    );
  }

  if (rows.length === 0) {
    lines.push('| - | - | - | 0 | 0 | 0.000000 | 0 |');
  }

  if (summary.alerts.length > 0) {
    lines.push('', '## Alerts', '');
    for (const alert of summary.alerts) {
      lines.push(`- [${alert.type.toUpperCase()}] ${alert.timestamp} - ${alert.message}`);
    }
  }

  if (summary.totals.priceMissingRequests > 0) {
    lines.push(
      '',
      '> Warning: some requests have no pricing entry. Cost was recorded as 0 USD for those requests.',
    );
  }

  lines.push('');

  const usageDir = path.resolve(process.cwd(), 'artifacts', projectId, 'usage');
  mkdirSync(usageDir, { recursive: true });
  const reportPath = path.join(usageDir, 'UsageReport.md');
  writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');
  return reportPath;
}

main();
