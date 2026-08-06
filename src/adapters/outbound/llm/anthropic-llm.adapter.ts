import Anthropic from '@anthropic-ai/sdk';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import type {
  LlmProviderPort,
  RawCompletion,
  StructuredRequest,
} from '../../../domain/ports/outbound/llm-provider.port';
import { LlmProviderError } from '../../../domain/ports/outbound/llm-provider.port';

/**
 * Second fallback provider (Execution.md §2.4).
 *
 * Anthropic has no dedicated JSON-schema response mode, so the schema is enforced through a
 * single-tool definition: the model is required to call the tool, and the tool's input
 * schema *is* the response schema. That yields validated structured output rather than
 * relying on a "reply with JSON" instruction.
 */
@Injectable()
export class AnthropicLlmAdapter implements LlmProviderPort {
  readonly name = 'anthropic' as const;

  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(config: AppConfigService) {
    const { apiKey, model } = config.anthropic;
    this.model = model;
    this.client = apiKey === undefined ? null : new Anthropic({ apiKey });
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async generateStructured(request: StructuredRequest, timeoutMs: number): Promise<RawCompletion> {
    if (this.client === null) {
      throw new LlmProviderError('ANTHROPIC_API_KEY is not configured', this.name, false);
    }

    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');

    const conversation = request.messages.filter((message) => message.role !== 'system');

    try {
      const response = await this.client.messages.create(
        {
          model: this.model,
          // Anthropic requires an explicit output cap.
          max_tokens: request.maxOutputTokens ?? 4_096,
          temperature: request.temperature ?? 0,
          ...(system.length > 0 ? { system } : {}),
          messages: conversation.map((message) => ({
            role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
            content: message.content,
          })),
          tools: [
            {
              name: request.schemaName,
              description: `Return the structured result for the "${request.operation}" operation.`,
              input_schema: request.schema as Anthropic.Tool['input_schema'],
            },
          ],
          // Forcing the tool call is what makes the schema binding mandatory.
          tool_choice: { type: 'tool', name: request.schemaName },
        },
        { timeout: timeoutMs, maxRetries: 0 },
      );

      if (response.stop_reason === 'max_tokens') {
        throw new LlmProviderError(
          `Response truncated by max_tokens for operation "${request.operation}"`,
          this.name,
          true,
        );
      }

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
      );

      if (toolUse === undefined) {
        throw new LlmProviderError(
          'Anthropic returned no tool_use block despite a forced tool choice',
          this.name,
          true,
        );
      }

      return {
        // The tool input is already a parsed object; re-serialising keeps the port's
        // contract (raw JSON text) identical across providers.
        text: JSON.stringify(toolUse.input),
        model: response.model,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      throw this.translate(error);
    }
  }

  private translate(error: unknown): LlmProviderError {
    if (error instanceof Anthropic.APIError) {
      const status = error.status ?? 0;
      const retryable = status === 408 || status === 429 || status >= 500;
      return new LlmProviderError(
        `Anthropic API error ${status}: ${error.message}`,
        this.name,
        retryable,
        error,
      );
    }

    const message = error instanceof Error ? error.message : String(error);
    return new LlmProviderError(`Unexpected Anthropic failure: ${message}`, this.name, true, error);
  }
}
