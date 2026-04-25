import OpenAI from 'openai';
import type { LLMCompletionOptions, LLMCompletionResult, LLMMessage, LLMProvider } from '../types/index.js';

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;

  constructor(
    private apiKey: string,
    private model: string,
    baseURL?: string,
  ) {
    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });
  }

  async complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResult> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }
    const inputTokens = Number(response.usage?.prompt_tokens ?? 0);
    const outputTokens = Number(response.usage?.completion_tokens ?? 0);
    return {
      content,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: Number(response.usage?.total_tokens ?? inputTokens + outputTokens),
        estimated: false,
      },
      rawProviderUsage: response.usage,
    };
  }
}
