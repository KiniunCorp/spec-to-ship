import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LLMProvider, LLMProviderConfig } from '../types/index.js';
import { enforceBudgetBeforeRequest, recordUsageEventFromCompletion } from '../costs/tracker.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { loadRuntimeConfig } from '../runtime/config.js';

export function createProvider(config?: LLMProviderConfig): LLMProvider {
  const resolved = normalizeConfig(config ?? loadConfig());
  const runtimeConfig = loadRuntimeConfig();
  const runtimeMode = resolved.mode;
  const providerLabel = resolveProviderLabel(resolved);
  let baseProvider: LLMProvider;

  switch (resolved.mode) {
    case 'openai_compatible': {
      const apiKeyVar = resolved.apiKeyEnvVar || 'OPENAI_API_KEY';
      const apiKey = process.env[apiKeyVar];
      if (!apiKey) {
        throw new Error(`Missing API key: set the ${apiKeyVar} environment variable`);
      }
      baseProvider = new OpenAIProvider(apiKey, resolved.model, resolved.baseURL);
      break;
    }
    case 'api':
    default: {
      const apiKeyVar = resolved.apiKeyEnvVar || defaultApiKeyEnvVar(resolved.provider || 'anthropic');
      const apiKey = process.env[apiKeyVar];
      if (!apiKey) {
        throw new Error(`Missing API key: set the ${apiKeyVar} environment variable`);
      }
      switch (resolved.provider) {
        case 'anthropic':
          baseProvider = new AnthropicProvider(apiKey, resolved.model);
          break;
        case 'openai':
          baseProvider = new OpenAIProvider(apiKey, resolved.model);
          break;
        default:
          throw new Error(`Unknown provider: ${resolved.provider}`);
      }
      break;
    }
  }

  if (process.env.S2S_DISABLE_COSTS === '1') {
    return baseProvider;
  }

  return new CostTrackedProvider(baseProvider, {
    mode: runtimeMode,
    provider: providerLabel,
    model: resolved.model,
    runtimeConfig,
  });
}

export function resolveProviderLabel(config: LLMProviderConfig): string {
  const mode = config.mode || 'api';
  if (mode === 'openai_compatible') {
    return 'openai';
  }
  return String(config.provider || 'anthropic').trim().toLowerCase();
}

function loadConfig(): LLMProviderConfig {
  const configPath = resolve(process.cwd(), 'config', 'llm.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as LLMProviderConfig;
  } catch {
    return {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
      apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    };
  }
}

function normalizeConfig(config: LLMProviderConfig): Required<Pick<LLMProviderConfig, 'mode' | 'model'>> & LLMProviderConfig {
  const mode = config.mode || 'api';
  const provider = (config.provider || 'anthropic') as 'anthropic' | 'openai';
  const model = String(config.model || defaultModel(provider)).trim() || defaultModel(provider);
  const apiKeyEnvVar = config.apiKeyEnvVar || defaultApiKeyEnvVar(provider);
  return {
    ...config,
    mode,
    provider,
    model,
    apiKeyEnvVar,
  };
}

function defaultModel(provider: 'anthropic' | 'openai'): string {
  return provider === 'openai' ? 'gpt-5.4' : 'claude-sonnet-4-5-20250929';
}

function defaultApiKeyEnvVar(provider: 'anthropic' | 'openai'): string {
  return provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
}

export type { LLMProvider, LLMProviderConfig };

class CostTrackedProvider implements LLMProvider {
  constructor(
    private base: LLMProvider,
    private context: {
      mode: 'api' | 'openai_compatible';
      provider: string;
      model: string;
      runtimeConfig: ReturnType<typeof loadRuntimeConfig>;
    },
  ) {}

  async complete(messages: Parameters<LLMProvider['complete']>[0], options?: Parameters<LLMProvider['complete']>[1]) {
    const projectId = options?.meta?.projectId;
    if (projectId) {
      enforceBudgetBeforeRequest(projectId, this.context.runtimeConfig);
    }

    const result = await this.base.complete(messages, options);

    if (projectId) {
      recordUsageEventFromCompletion({
        projectId,
        stage: options?.meta?.stage,
        operation: options?.meta?.operation,
        mode: this.context.mode,
        provider: this.context.provider,
        model: this.context.model,
        usage: result.usage,
        runtimeConfig: this.context.runtimeConfig,
      });
    }

    return result;
  }
}
