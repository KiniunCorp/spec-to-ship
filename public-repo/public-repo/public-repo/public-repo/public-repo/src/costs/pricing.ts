import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface PricingModelEntry {
  provider: string;
  model: string;
  inputUsdPer1M: number;
  outputUsdPer1M: number;
  estimationMultiplier?: number;
}

export interface PricingConfig {
  version: number;
  currency: 'USD';
  models: PricingModelEntry[];
}

const DEFAULT_PRICING: PricingConfig = {
  version: 1,
  currency: 'USD',
  models: [],
};

export function loadPricingConfig(): PricingConfig {
  const configPath = resolve(process.cwd(), 'config', 'pricing.json');
  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as PricingConfig;
    if (!Array.isArray(parsed.models)) return DEFAULT_PRICING;
    return {
      version: Number(parsed.version || 1),
      currency: parsed.currency === 'USD' ? 'USD' : 'USD',
      models: parsed.models.map((entry) => ({
        provider: String(entry.provider || '').trim().toLowerCase(),
        model: String(entry.model || '').trim(),
        inputUsdPer1M: Number(entry.inputUsdPer1M || 0),
        outputUsdPer1M: Number(entry.outputUsdPer1M || 0),
        estimationMultiplier: Number(entry.estimationMultiplier || 1),
      })),
    };
  } catch {
    return DEFAULT_PRICING;
  }
}

export function resolvePricingModel(
  config: PricingConfig,
  provider: string,
  model: string,
): PricingModelEntry | null {
  const p = String(provider || '').trim().toLowerCase();
  const m = String(model || '').trim();
  if (!p || !m) return null;

  const exact = config.models.find((entry) => entry.provider === p && entry.model === m);
  if (exact) return exact;

  const providerWildcard = config.models.find((entry) => entry.provider === p && entry.model === '*');
  if (providerWildcard) return providerWildcard;

  const globalWildcard = config.models.find((entry) => entry.provider === '*' && entry.model === '*');
  if (globalWildcard) return globalWildcard;

  return null;
}
