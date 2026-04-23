import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path, { resolve } from 'node:path';
import type { LLMUsage, RuntimeConfig } from '../types/index.js';
import { loadPricingConfig, resolvePricingModel } from './pricing.js';

export type BudgetStatus = 'ok' | 'warning' | 'blocked';

export interface UsageEvent {
  timestamp: string;
  projectId: string;
  stage: string;
  operation: string;
  mode: 'api' | 'openai_compatible';
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimated: boolean;
  priceFound: boolean;
  costUsd: number;
  budgetStatus: BudgetStatus;
  note?: string;
}

export interface UsageAggregate {
  provider: string;
  model: string;
  stage: string;
  requests: number;
  estimatedRequests: number;
  exactRequests: number;
  priceMissingRequests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface UsageSummary {
  version: number;
  currency: 'USD';
  projectId: string;
  totals: {
    requests: number;
    estimatedRequests: number;
    exactRequests: number;
    priceMissingRequests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
  };
  byProviderModelStage: Record<string, UsageAggregate>;
  budget: {
    enabled: boolean;
    budgetUsd: number;
    warnThresholdPct: number;
    hardStopThresholdPct: number;
    percentUsed: number;
    status: BudgetStatus;
  };
  alerts: Array<{
    timestamp: string;
    type: 'warning' | 'blocked';
    message: string;
  }>;
  lastEventAt?: string;
}

interface CostControl {
  enabled: boolean;
  budgetUsd: number;
  warnThresholdPct: number;
  hardStopThresholdPct: number;
}

export function enforceBudgetBeforeRequest(projectId: string, runtimeConfig: RuntimeConfig): void {
  const control = resolveCostControl(runtimeConfig);
  if (!control.enabled || control.budgetUsd <= 0) return;

  const summary = loadUsageSummary(projectId, control);
  if (summary.budget.status === 'blocked') {
    throw new Error(
      `Budget hard-stop reached for project '${projectId}': ${summary.totals.costUsd.toFixed(4)} USD / ${control.budgetUsd.toFixed(4)} USD.`,
    );
  }
}

export function recordUsageEventFromCompletion(args: {
  projectId: string;
  stage?: string;
  operation?: string;
  mode: 'api' | 'openai_compatible';
  provider: string;
  model: string;
  usage?: LLMUsage;
  runtimeConfig: RuntimeConfig;
}): { event: UsageEvent | null; summary: UsageSummary } {
  const control = resolveCostControl(args.runtimeConfig);
  const summary = loadUsageSummary(args.projectId, control);

  if (!args.usage) {
    return { event: null, summary };
  }

  const pricingConfig = loadPricingConfig();
  const pricing = resolvePricingModel(pricingConfig, args.provider, args.model);

  const inputTokens = Number(args.usage.inputTokens || 0);
  const outputTokens = Number(args.usage.outputTokens || 0);
  const totalTokens = Number(args.usage.totalTokens || inputTokens + outputTokens);

  const multiplier = args.usage.estimated ? Number(pricing?.estimationMultiplier || 1) : 1;
  const rawCost =
    pricing
      ? ((inputTokens / 1_000_000) * pricing.inputUsdPer1M + (outputTokens / 1_000_000) * pricing.outputUsdPer1M) * multiplier
      : 0;

  const event: UsageEvent = {
    timestamp: new Date().toISOString(),
    projectId: args.projectId,
    stage: String(args.stage || 'unknown'),
    operation: String(args.operation || 'unspecified'),
    mode: args.mode,
    provider: String(args.provider || '').trim().toLowerCase(),
    model: String(args.model || '').trim(),
    inputTokens,
    outputTokens,
    totalTokens,
    estimated: Boolean(args.usage.estimated),
    priceFound: Boolean(pricing),
    costUsd: roundUsd(rawCost),
    budgetStatus: 'ok',
    ...(pricing ? {} : { note: `No pricing entry for provider='${args.provider}' model='${args.model}'` }),
  };

  appendUsageEvent(args.projectId, event);
  const next = applyEventToSummary(summary, event, control);
  saveUsageSummary(args.projectId, next);
  return { event: { ...event, budgetStatus: next.budget.status }, summary: next };
}

export function loadUsageSummary(projectId: string, control: CostControl): UsageSummary {
  const filePath = summaryPath(projectId);
  if (!existsSync(filePath)) {
    return emptySummary(projectId, control);
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as UsageSummary;
    return {
      ...emptySummary(projectId, control),
      ...parsed,
      budget: buildBudgetState(parsed.totals?.costUsd || 0, control),
    };
  } catch {
    return emptySummary(projectId, control);
  }
}

export function readUsageEvents(projectId: string): UsageEvent[] {
  const filePath = eventsPath(projectId);
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const events: UsageEvent[] = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line) as UsageEvent);
    } catch {
      // Ignore malformed lines to keep report resilient.
    }
  }
  return events;
}

export function listProjectsWithUsage(): string[] {
  const root = resolve(process.cwd(), '.s2s', 'artifacts');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((entry) => existsSync(path.join(root, entry, 'usage', 'summary.json')));
}

export function resolveCostControl(runtimeConfig: RuntimeConfig): CostControl {
  const source = runtimeConfig.costControl || {
    enabled: false,
    budgetUsd: 0,
    warnThresholdPct: 80,
    hardStopThresholdPct: 100,
  };
  const warnThresholdPct = clampPct(source.warnThresholdPct, 80);
  const hardStopThresholdPct = Math.max(warnThresholdPct, clampPct(source.hardStopThresholdPct, 100));
  const budgetUsd = Number(source.budgetUsd || 0);
  return {
    enabled: Boolean(source.enabled) && budgetUsd > 0,
    budgetUsd: budgetUsd > 0 ? budgetUsd : 0,
    warnThresholdPct,
    hardStopThresholdPct,
  };
}

function appendUsageEvent(projectId: string, event: UsageEvent): void {
  ensureUsageDir(projectId);
  appendFileSync(eventsPath(projectId), `${JSON.stringify(event)}\n`, 'utf8');
}

function saveUsageSummary(projectId: string, summary: UsageSummary): void {
  ensureUsageDir(projectId);
  writeFileSync(summaryPath(projectId), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
}

function ensureUsageDir(projectId: string): void {
  mkdirSync(path.join(resolve(process.cwd(), '.s2s', 'artifacts'), projectId, 'usage'), { recursive: true });
}

function eventsPath(projectId: string): string {
  return path.join(resolve(process.cwd(), '.s2s', 'artifacts'), projectId, 'usage', 'events.ndjson');
}

function summaryPath(projectId: string): string {
  return path.join(resolve(process.cwd(), '.s2s', 'artifacts'), projectId, 'usage', 'summary.json');
}

function applyEventToSummary(summary: UsageSummary, event: UsageEvent, control: CostControl): UsageSummary {
  const totals = {
    requests: Number(summary.totals.requests || 0) + 1,
    estimatedRequests: Number(summary.totals.estimatedRequests || 0) + (event.estimated ? 1 : 0),
    exactRequests: Number(summary.totals.exactRequests || 0) + (event.estimated ? 0 : 1),
    priceMissingRequests: Number(summary.totals.priceMissingRequests || 0) + (event.priceFound ? 0 : 1),
    inputTokens: Number(summary.totals.inputTokens || 0) + event.inputTokens,
    outputTokens: Number(summary.totals.outputTokens || 0) + event.outputTokens,
    totalTokens: Number(summary.totals.totalTokens || 0) + event.totalTokens,
    costUsd: roundUsd(Number(summary.totals.costUsd || 0) + event.costUsd),
  };

  const key = aggregateKey(event.provider, event.model, event.stage);
  const current = summary.byProviderModelStage[key] || {
    provider: event.provider,
    model: event.model,
    stage: event.stage,
    requests: 0,
    estimatedRequests: 0,
    exactRequests: 0,
    priceMissingRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };

  const byProviderModelStage: Record<string, UsageAggregate> = {
    ...summary.byProviderModelStage,
    [key]: {
      ...current,
      requests: current.requests + 1,
      estimatedRequests: current.estimatedRequests + (event.estimated ? 1 : 0),
      exactRequests: current.exactRequests + (event.estimated ? 0 : 1),
      priceMissingRequests: current.priceMissingRequests + (event.priceFound ? 0 : 1),
      inputTokens: current.inputTokens + event.inputTokens,
      outputTokens: current.outputTokens + event.outputTokens,
      totalTokens: current.totalTokens + event.totalTokens,
      costUsd: roundUsd(current.costUsd + event.costUsd),
    },
  };

  const previousBudget = summary.budget.status;
  const budget = buildBudgetState(totals.costUsd, control);
  const alerts = [...summary.alerts];
  if (rankBudget(budget.status) > rankBudget(previousBudget) && budget.status !== 'ok') {
    alerts.push({
      timestamp: event.timestamp,
      type: budget.status === 'blocked' ? 'blocked' : 'warning',
      message:
        budget.status === 'blocked'
          ? `Budget hard-stop reached (${budget.percentUsed.toFixed(2)}%).`
          : `Budget warning threshold reached (${budget.percentUsed.toFixed(2)}%).`,
    });
  }

  return {
    ...summary,
    totals,
    byProviderModelStage,
    budget,
    alerts,
    lastEventAt: event.timestamp,
  };
}

function buildBudgetState(costUsd: number, control: CostControl): UsageSummary['budget'] {
  if (!control.enabled || control.budgetUsd <= 0) {
    return {
      enabled: false,
      budgetUsd: 0,
      warnThresholdPct: control.warnThresholdPct,
      hardStopThresholdPct: control.hardStopThresholdPct,
      percentUsed: 0,
      status: 'ok',
    };
  }

  const percentUsed = Number(((costUsd / control.budgetUsd) * 100).toFixed(4));
  let status: BudgetStatus = 'ok';
  if (percentUsed >= control.hardStopThresholdPct) {
    status = 'blocked';
  } else if (percentUsed >= control.warnThresholdPct) {
    status = 'warning';
  }

  return {
    enabled: true,
    budgetUsd: control.budgetUsd,
    warnThresholdPct: control.warnThresholdPct,
    hardStopThresholdPct: control.hardStopThresholdPct,
    percentUsed,
    status,
  };
}

function emptySummary(projectId: string, control: CostControl): UsageSummary {
  return {
    version: 1,
    currency: 'USD',
    projectId,
    totals: {
      requests: 0,
      estimatedRequests: 0,
      exactRequests: 0,
      priceMissingRequests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    },
    byProviderModelStage: {},
    budget: buildBudgetState(0, control),
    alerts: [],
  };
}

function aggregateKey(provider: string, model: string, stage: string): string {
  return `${provider}::${model}::${stage}`;
}

function roundUsd(value: number): number {
  return Number((value || 0).toFixed(8));
}

function clampPct(value: number, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < 0) return 0;
  if (numeric > 1000) return 1000;
  return numeric;
}

function rankBudget(status: BudgetStatus): number {
  if (status === 'blocked') return 2;
  if (status === 'warning') return 1;
  return 0;
}
