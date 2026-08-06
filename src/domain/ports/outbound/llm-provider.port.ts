/**
 * The single contract every LLM provider implements (Execution.md §2.4).
 *
 * The domain never imports OpenAI, Gemini or Anthropic SDKs. It asks for structured
 * data against a schema and receives validated output or a typed failure — which is
 * what makes automatic failover between providers possible without touching callers.
 */

export const LLM_PROVIDERS = ['openai', 'gemini', 'anthropic'] as const;

export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

/**
 * A structured-output request.
 *
 * `schema` is a JSON Schema object describing the exact shape required. Providers are
 * expected to enforce it natively where they can (OpenAI structured outputs, Gemini
 * response schemas) and the service validates the result regardless, so a provider that
 * merely "tries" cannot leak a malformed object into the domain.
 */
export interface StructuredRequest {
  /** Short identifier used in logs and metrics, e.g. `intent_resolution`. */
  readonly operation: string;
  readonly messages: readonly LlmMessage[];
  readonly schemaName: string;
  readonly schema: Readonly<Record<string, unknown>>;
  /** 0 for deterministic extraction; higher only where variety genuinely helps. */
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
}

export interface StructuredResult<T> {
  readonly data: T;
  readonly provider: LlmProviderName;
  readonly model: string;
  readonly usage?: LlmUsage;
  /** Wall-clock duration of the successful attempt, for latency budgets. */
  readonly latencyMs: number;
  /** Providers tried and failed before this one succeeded. Empty on a first-try success. */
  readonly failedProviders: readonly LlmProviderName[];
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * A single provider adapter. Implementations do not retry or fall back — those policies
 * live in the LlmProviderService so they are applied uniformly.
 */
export interface LlmProviderPort {
  readonly name: LlmProviderName;

  /** False when no API key is configured, which removes it from the fallback chain. */
  isConfigured(): boolean;

  /**
   * Returns raw text that is expected to parse as JSON matching `request.schema`.
   * Schema validation is the caller's responsibility so it is identical across providers.
   */
  generateStructured(request: StructuredRequest, timeoutMs: number): Promise<RawCompletion>;
}

export interface RawCompletion {
  readonly text: string;
  readonly model: string;
  readonly usage?: LlmUsage;
}

/** Distinguishes failures worth retrying/failing over from ones that never will succeed. */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly provider: LlmProviderName,
    /** Rate limits, timeouts and 5xx are retryable; a malformed request or bad key is not. */
    readonly retryable: boolean,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'LlmProviderError';
  }
}

/** Raised when every configured provider has been exhausted (Execution.md §2.5). */
export class AllProvidersFailedError extends Error {
  constructor(
    readonly operation: string,
    readonly attempts: readonly { provider: LlmProviderName; error: string }[],
  ) {
    super(
      `All LLM providers failed for operation "${operation}": ${attempts
        .map((attempt) => `${attempt.provider} (${attempt.error})`)
        .join('; ')}`,
    );
    this.name = 'AllProvidersFailedError';
  }
}

export const LLM_PROVIDER_SERVICE = Symbol('LlmProviderService');

/**
 * The abstraction domain services depend on. One method, because callers should never
 * have to think about which provider answered.
 */
export interface LlmService {
  /**
   * Runs `request` against the provider chain, validating the result with `validate`.
   * Throws {@link AllProvidersFailedError} only after every configured provider has failed.
   */
  complete<T>(request: StructuredRequest, validate: (value: unknown) => T): Promise<StructuredResult<T>>;
}
