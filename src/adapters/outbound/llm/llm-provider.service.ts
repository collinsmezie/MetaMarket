import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import type {
  LlmProviderName,
  LlmProviderPort,
  LlmService,
  StructuredRequest,
  StructuredResult,
} from '../../../domain/ports/outbound/llm-provider.port';
import { AllProvidersFailedError, LlmProviderError } from '../../../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import { CircuitBreaker } from './circuit-breaker';
import { extractJson } from './json-extraction';
import { AnthropicLlmAdapter } from './anthropic-llm.adapter';
import { GeminiLlmAdapter } from './gemini-llm.adapter';
import { OpenAiLlmAdapter } from './openai-llm.adapter';

const COMPONENT = 'MCOS';
const STAGE = 'LlmProviderService';

/**
 * Fallback order (Execution.md §1): OpenAI primary, then Gemini, then Anthropic.
 * Ordered by capability and cost rather than alphabetically.
 */
const PROVIDER_ORDER: readonly LlmProviderName[] = ['openai', 'gemini', 'anthropic'];

/** Base delay for exponential backoff; attempt N waits BASE · 2^(N-1) plus jitter. */
const BACKOFF_BASE_MS = 250;
const MAX_BACKOFF_MS = 4_000;

interface AttemptFailure {
  readonly provider: LlmProviderName;
  readonly error: string;
}

/**
 * The single entry point for LLM inference (Execution.md §2.4).
 *
 * Applies retry, backoff, circuit breaking, failover and schema validation uniformly, so no
 * caller implements resilience itself and no caller knows which provider answered.
 */
@Injectable()
export class LlmProviderService implements LlmService {
  private readonly providers: readonly LlmProviderPort[];
  private readonly breakers = new Map<LlmProviderName, CircuitBreaker>();

  constructor(
    private readonly config: AppConfigService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    openai: OpenAiLlmAdapter,
    gemini: GeminiLlmAdapter,
    anthropic: AnthropicLlmAdapter,
  ) {
    const byName = new Map<LlmProviderName, LlmProviderPort>([
      ['openai', openai],
      ['gemini', gemini],
      ['anthropic', anthropic],
    ]);

    // Unconfigured providers are excluded rather than left to fail on every call.
    this.providers = PROVIDER_ORDER.map((name) => byName.get(name)).filter(
      (provider): provider is LlmProviderPort => provider !== undefined && provider.isConfigured(),
    );

    const { circuitBreakerThreshold, circuitBreakerResetMs } = config.llmResilience;
    for (const provider of this.providers) {
      this.breakers.set(
        provider.name,
        new CircuitBreaker({ failureThreshold: circuitBreakerThreshold, resetMs: circuitBreakerResetMs }),
      );
    }
  }

  /** Provider names in fallback order; empty when nothing is configured. */
  get configuredProviders(): readonly LlmProviderName[] {
    return this.providers.map((provider) => provider.name);
  }

  /** Health snapshot per provider, for the readiness endpoint. */
  health(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(
      this.providers.map((provider) => [provider.name, this.breakers.get(provider.name)?.snapshot()]),
    );
  }

  async complete<T>(
    request: StructuredRequest,
    validate: (value: unknown) => T,
  ): Promise<StructuredResult<T>> {
    if (this.providers.length === 0) {
      // Distinct from a runtime outage: this is a deployment that was never given a key.
      throw new AllProvidersFailedError(request.operation, [
        {
          provider: 'openai',
          error:
            'No LLM provider is configured. Set OPENAI_API_KEY (and optionally GEMINI_API_KEY / ANTHROPIC_API_KEY).',
        },
      ]);
    }

    const { maxAttempts, timeoutMs } = this.config.llmResilience;
    const failures: AttemptFailure[] = [];
    const failedProviders: LlmProviderName[] = [];

    for (const provider of this.providers) {
      const breaker = this.breakers.get(provider.name);

      if (breaker !== undefined && !breaker.allowRequest()) {
        failures.push({ provider: provider.name, error: 'circuit open' });
        failedProviders.push(provider.name);
        continue;
      }

      const outcome = await this.attemptProvider(provider, request, validate, maxAttempts, timeoutMs);

      if (outcome.ok) {
        breaker?.recordSuccess();

        this.logger.stage({
          component: COMPONENT,
          stage: STAGE,
          input: { operation: request.operation, schema: request.schemaName },
          action:
            failedProviders.length === 0
              ? `Completed via ${provider.name}`
              : `Completed via ${provider.name} after failing over from ${failedProviders.join(', ')}`,
          output: {
            provider: provider.name,
            model: outcome.model,
            attempts: outcome.attempts,
            usage: outcome.usage,
          },
          durationMs: outcome.latencyMs,
        });

        return {
          data: outcome.data,
          provider: provider.name,
          model: outcome.model,
          usage: outcome.usage,
          latencyMs: outcome.latencyMs,
          failedProviders,
        };
      }

      breaker?.recordFailure();
      failures.push({ provider: provider.name, error: outcome.error });
      failedProviders.push(provider.name);

      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:${provider.name}`,
        input: { operation: request.operation, schema: request.schemaName },
        action: `Provider exhausted ${outcome.attempts} attempt(s); failing over to the next provider`,
        error: outcome.error,
      });
    }

    // Every provider is gone. The caller is responsible for returning FALLBACK_ENVELOPE
    // rather than looping or failing silently (Execution.md §2.5).
    throw new AllProvidersFailedError(request.operation, failures);
  }

  /**
   * Retries one provider with exponential backoff before giving up on it.
   *
   * Retrying the same provider first is correct: a 429 usually clears in under a second,
   * and switching providers costs prompt-cache locality and output consistency.
   */
  private async attemptProvider<T>(
    provider: LlmProviderPort,
    request: StructuredRequest,
    validate: (value: unknown) => T,
    maxAttempts: number,
    timeoutMs: number,
  ): Promise<
    | {
        ok: true;
        data: T;
        model: string;
        usage?: { inputTokens: number; outputTokens: number };
        latencyMs: number;
        attempts: number;
      }
    | { ok: false; error: string; attempts: number }
  > {
    let lastError = 'unknown error';

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now();

      try {
        const completion = await provider.generateStructured(request, timeoutMs);
        // Validate identically for every provider, so a provider with weaker native schema
        // support can never leak a malformed object into the domain.
        const data = validate(extractJson(completion.text));

        return {
          ok: true,
          data,
          model: completion.model,
          usage: completion.usage,
          latencyMs: Date.now() - startedAt,
          attempts: attempt,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);

        const retryable = error instanceof LlmProviderError ? error.retryable : true;

        if (!retryable || attempt === maxAttempts) {
          return { ok: false, error: lastError, attempts: attempt };
        }

        await this.backoff(attempt);
      }
    }

    return { ok: false, error: lastError, attempts: maxAttempts };
  }

  /** Exponential backoff with jitter, so concurrent turns do not retry in lockstep. */
  private async backoff(attempt: number): Promise<void> {
    const exponential = Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    const jitter = Math.random() * exponential * 0.25;
    await new Promise((resolve) => setTimeout(resolve, exponential + jitter));
  }
}
