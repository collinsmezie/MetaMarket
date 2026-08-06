import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../../../config/app-config.service';
import type {
  LlmProviderPort,
  RawCompletion,
  StructuredRequest,
} from '../../../domain/ports/outbound/llm-provider.port';
import { LlmProviderError } from '../../../domain/ports/outbound/llm-provider.port';

/**
 * True for OpenAI reasoning models (the o-series and GPT-5 family).
 *
 * They differ from chat models in ways that matter at the request layer: `temperature` is
 * rejected rather than ignored, and the output cap is `max_completion_tokens`.
 */
export function isReasoningModel(model: string): boolean {
  return /^(o\d|gpt-5)/i.test(model);
}

/**
 * Primary provider (Execution.md §1).
 *
 * Uses OpenAI structured outputs (`json_schema` with `strict: true`) so the schema is
 * enforced at generation time rather than hoped for and validated afterwards.
 */
@Injectable()
export class OpenAiLlmAdapter implements LlmProviderPort {
  readonly name = 'openai' as const;

  private readonly client: OpenAI | null;
  private readonly model: string;

  constructor(config: AppConfigService) {
    const { apiKey, model } = config.openai;
    this.model = model;
    // A missing key is a configuration state, not an error: the service simply skips
    // unconfigured providers when building its fallback chain.
    this.client = apiKey === undefined ? null : new OpenAI({ apiKey });
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async generateStructured(request: StructuredRequest, timeoutMs: number): Promise<RawCompletion> {
    if (this.client === null) {
      throw new LlmProviderError('OPENAI_API_KEY is not configured', this.name, false);
    }

    // Reasoning models reject `temperature` outright and rename the output cap. Sending the
    // chat-model parameters to one produces a 400 on every single call — which the fallback
    // chain silently absorbs, so the deployment looks healthy while the primary provider is
    // completely unusable and every request is paying a fallback's latency.
    const reasoning = isReasoningModel(this.model);

    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this.model,
          ...(reasoning ? {} : { temperature: request.temperature ?? 0 }),
          ...(request.maxOutputTokens === undefined
            ? {}
            : reasoning
              ? { max_completion_tokens: request.maxOutputTokens }
              : { max_tokens: request.maxOutputTokens }),
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: request.schemaName,
              strict: true,
              schema: request.schema as Record<string, unknown>,
            },
          },
        },
        { timeout: timeoutMs, maxRetries: 0 },
      );

      const choice = completion.choices[0];

      // A length-capped response is truncated JSON; treating it as valid output would
      // surface a parse error that looks like a schema problem.
      if (choice?.finish_reason === 'length') {
        throw new LlmProviderError(
          `Response truncated by max_tokens for operation "${request.operation}"`,
          this.name,
          true,
        );
      }

      // Structured outputs refuse rather than guess when a request violates policy.
      const refusal = choice?.message.refusal;
      if (refusal !== null && refusal !== undefined) {
        throw new LlmProviderError(`Model refused the request: ${refusal}`, this.name, false);
      }

      const text = choice?.message.content;
      if (text === null || text === undefined || text.length === 0) {
        throw new LlmProviderError('Model returned an empty response', this.name, true);
      }

      return {
        text,
        model: completion.model,
        usage:
          completion.usage === undefined
            ? undefined
            : {
                inputTokens: completion.usage.prompt_tokens,
                outputTokens: completion.usage.completion_tokens,
              },
      };
    } catch (error) {
      if (error instanceof LlmProviderError) throw error;
      throw this.translate(error);
    }
  }

  /**
   * Maps SDK errors onto the retryable/terminal distinction the service needs.
   *
   * Retrying a 401 or a malformed schema can never succeed and would only delay failover,
   * whereas 429 and 5xx are exactly what failover exists for.
   */
  private translate(error: unknown): LlmProviderError {
    if (error instanceof OpenAI.APIError) {
      const status = error.status ?? 0;
      const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
      return new LlmProviderError(
        `OpenAI API error ${status}: ${error.message}`,
        this.name,
        retryable,
        error,
      );
    }

    if (error instanceof OpenAI.APIConnectionTimeoutError || error instanceof OpenAI.APIConnectionError) {
      return new LlmProviderError(`OpenAI connection failure: ${error.message}`, this.name, true, error);
    }

    const message = error instanceof Error ? error.message : String(error);
    return new LlmProviderError(`Unexpected OpenAI failure: ${message}`, this.name, true, error);
  }

  /** Exposed for health reporting; the model is a deployment fact worth surfacing. */
  describe(): { provider: string; model: string; configured: boolean } {
    return { provider: this.name, model: this.model, configured: this.isConfigured() };
  }
}
