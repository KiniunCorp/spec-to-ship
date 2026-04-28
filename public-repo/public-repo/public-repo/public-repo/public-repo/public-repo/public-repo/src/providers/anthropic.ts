import Anthropic from '@anthropic-ai/sdk';
import type { LLMCompletionOptions, LLMCompletionResult, LLMMessage, LLMProvider } from '../types/index.js';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(
    private apiKey: string,
    private model: string,
  ) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(messages: LLMMessage[], options?: LLMCompletionOptions): Promise<LLMCompletionResult> {
    const systemMessage = messages.find((m) => m.role === 'system');
    const nonSystemMessages = messages.filter((m) => m.role !== 'system');

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: options?.maxTokens ?? 4096,
      ...(systemMessage ? { system: systemMessage.content } : {}),
      messages: nonSystemMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
    });

    const block = response.content[0];
    if (block.type !== 'text') {
      throw new Error(`Unexpected response block type: ${block.type}`);
    }
    const inputTokens = Number((response as { usage?: { input_tokens?: number } }).usage?.input_tokens ?? 0);
    const outputTokens = Number((response as { usage?: { output_tokens?: number } }).usage?.output_tokens ?? 0);
    return {
      content: block.text,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        estimated: false,
      },
      rawProviderUsage: (response as { usage?: unknown }).usage,
    };
  }
}
