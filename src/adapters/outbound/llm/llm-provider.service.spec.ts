import { z } from 'zod';
import type { AppConfigService } from '../../../config/app-config.service';
import type {
  LlmProviderName,
  LlmProviderPort,
  RawCompletion,
  StructuredRequest,
} from '../../../domain/ports/outbound/llm-provider.port';
import { AllProvidersFailedError, LlmProviderError } from '../../../domain/ports/outbound/llm-provider.port';
import type { StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import type { AnthropicLlmAdapter } from './anthropic-llm.adapter';
import type { GeminiLlmAdapter } from './gemini-llm.adapter';
import type { OpenAiLlmAdapter } from './openai-llm.adapter';
import { LlmProviderService } from './llm-provider.service';

/**
 * These specs are the contract behind Execution.md §2.4 — automatic failover with uniform
 * schema guarantees. They use fake providers because the requirement is about *our*
 * orchestration, not about any vendor's behaviour.
 */

const SCHEMA = z.object({ intent: z.string() });
const validate = (value: unknown) => SCHEMA.parse(value);

const request: StructuredRequest = {
  operation: 'intent_resolution',
  messages: [{ role: 'user', content: 'I need artist brush' }],
  schemaName: 'IntentResult',
  schema: { type: 'object', properties: { intent: { type: 'string' } }, required: ['intent'] },
};

class FakeProvider implements LlmProviderPort {
  calls = 0;

  constructor(
    readonly name: LlmProviderName,
    private readonly behaviour: (call: number) => RawCompletion | Error,
    private readonly configured = true,
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  async generateStructured(): Promise<RawCompletion> {
    this.calls += 1;
    const outcome = this.behaviour(this.calls);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

const succeedsWith = (intent: string): RawCompletion => ({
  text: JSON.stringify({ intent }),
  model: 'fake-model',
  usage: { inputTokens: 10, outputTokens: 5 },
});

const silentLogger: StageLoggerPort = {
  stage: () => undefined,
  stageFailed: () => undefined,
  withCorrelation: () => silentLogger,
};

function buildService(providers: {
  openai: FakeProvider;
  gemini: FakeProvider;
  anthropic: FakeProvider;
}): LlmProviderService {
  const config = {
    llmResilience: {
      maxAttempts: 3,
      // Kept tiny so retry paths do not slow the suite; behaviour is unchanged.
      timeoutMs: 50,
      circuitBreakerThreshold: 2,
      circuitBreakerResetMs: 10_000,
    },
  } as AppConfigService;

  return new LlmProviderService(
    config,
    silentLogger,
    providers.openai as unknown as OpenAiLlmAdapter,
    providers.gemini as unknown as GeminiLlmAdapter,
    providers.anthropic as unknown as AnthropicLlmAdapter,
  );
}

const rateLimited = (provider: LlmProviderName) => new LlmProviderError('429 rate limited', provider, true);

const badKey = (provider: LlmProviderName) => new LlmProviderError('401 invalid api key', provider, false);

describe('LlmProviderService', () => {
  it('uses OpenAI first when it is healthy', async () => {
    const openai = new FakeProvider('openai', () => succeedsWith('buyer_product_search'));
    const gemini = new FakeProvider('gemini', () => succeedsWith('wrong'));
    const anthropic = new FakeProvider('anthropic', () => succeedsWith('wrong'));

    const result = await buildService({ openai, gemini, anthropic }).complete(request, validate);

    expect(result.provider).toBe('openai');
    expect(result.data).toEqual({ intent: 'buyer_product_search' });
    expect(result.failedProviders).toEqual([]);
    expect(gemini.calls).toBe(0);
    expect(anthropic.calls).toBe(0);
  });

  it('retries the same provider on a retryable error before failing over', async () => {
    const openai = new FakeProvider('openai', (call) =>
      call === 1 ? rateLimited('openai') : succeedsWith('buyer_product_search'),
    );
    const gemini = new FakeProvider('gemini', () => succeedsWith('gemini_answer'));
    const anthropic = new FakeProvider('anthropic', () => succeedsWith('anthropic_answer'));

    const result = await buildService({ openai, gemini, anthropic }).complete(request, validate);

    expect(openai.calls).toBe(2);
    expect(result.provider).toBe('openai');
    expect(gemini.calls).toBe(0);
  });

  it('fails over to Gemini once OpenAI exhausts its attempts', async () => {
    const openai = new FakeProvider('openai', () => rateLimited('openai'));
    const gemini = new FakeProvider('gemini', () => succeedsWith('gemini_answer'));
    const anthropic = new FakeProvider('anthropic', () => succeedsWith('anthropic_answer'));

    const result = await buildService({ openai, gemini, anthropic }).complete(request, validate);

    expect(openai.calls).toBe(3);
    expect(result.provider).toBe('gemini');
    expect(result.failedProviders).toEqual(['openai']);
    expect(anthropic.calls).toBe(0);
  });

  it('falls through to Anthropic when both OpenAI and Gemini fail', async () => {
    const openai = new FakeProvider('openai', () => rateLimited('openai'));
    const gemini = new FakeProvider('gemini', () => rateLimited('gemini'));
    const anthropic = new FakeProvider('anthropic', () => succeedsWith('anthropic_answer'));

    const result = await buildService({ openai, gemini, anthropic }).complete(request, validate);

    expect(result.provider).toBe('anthropic');
    expect(result.failedProviders).toEqual(['openai', 'gemini']);
  });

  it('does not retry a non-retryable error, failing over immediately', async () => {
    const openai = new FakeProvider('openai', () => badKey('openai'));
    const gemini = new FakeProvider('gemini', () => succeedsWith('gemini_answer'));
    const anthropic = new FakeProvider('anthropic', () => succeedsWith('anthropic_answer'));

    const result = await buildService({ openai, gemini, anthropic }).complete(request, validate);

    // A bad key cannot heal, so burning two more attempts on it would only add latency.
    expect(openai.calls).toBe(1);
    expect(result.provider).toBe('gemini');
  });

  it('throws AllProvidersFailedError when every provider is exhausted', async () => {
    const openai = new FakeProvider('openai', () => rateLimited('openai'));
    const gemini = new FakeProvider('gemini', () => rateLimited('gemini'));
    const anthropic = new FakeProvider('anthropic', () => rateLimited('anthropic'));

    await expect(buildService({ openai, gemini, anthropic }).complete(request, validate)).rejects.toThrow(
      AllProvidersFailedError,
    );
  });

  it('rejects output that violates the schema and fails over instead of returning it', async () => {
    // The uniform-validation guarantee: a provider returning the wrong shape is a failure,
    // not a result, no matter how confidently it answered.
    const openai = new FakeProvider('openai', () => ({
      text: JSON.stringify({ unexpected: 'shape' }),
      model: 'fake-model',
    }));
    const gemini = new FakeProvider('gemini', () => succeedsWith('gemini_answer'));
    const anthropic = new FakeProvider('anthropic', () => succeedsWith('anthropic_answer'));

    const result = await buildService({ openai, gemini, anthropic }).complete(request, validate);

    expect(result.provider).toBe('gemini');
    expect(result.data).toEqual({ intent: 'gemini_answer' });
  });

  it('tolerates a fallback provider wrapping JSON in a code fence', async () => {
    const openai = new FakeProvider('openai', () => badKey('openai'));
    const gemini = new FakeProvider('gemini', () => ({
      text: '```json\n{"intent":"buyer_product_search"}\n```',
      model: 'gemini-2.0-flash',
    }));
    const anthropic = new FakeProvider('anthropic', () => succeedsWith('anthropic_answer'));

    const result = await buildService({ openai, gemini, anthropic }).complete(request, validate);

    expect(result.provider).toBe('gemini');
    expect(result.data).toEqual({ intent: 'buyer_product_search' });
  });

  it('skips providers that have no API key configured', async () => {
    const openai = new FakeProvider('openai', () => succeedsWith('never'), false);
    const gemini = new FakeProvider('gemini', () => succeedsWith('gemini_answer'));
    const anthropic = new FakeProvider('anthropic', () => succeedsWith('anthropic_answer'), false);

    const service = buildService({ openai, gemini, anthropic });

    expect(service.configuredProviders).toEqual(['gemini']);
    await expect(service.complete(request, validate)).resolves.toMatchObject({ provider: 'gemini' });
    expect(openai.calls).toBe(0);
  });

  it('reports a configuration problem when no provider has a key', async () => {
    const service = buildService({
      openai: new FakeProvider('openai', () => succeedsWith('x'), false),
      gemini: new FakeProvider('gemini', () => succeedsWith('x'), false),
      anthropic: new FakeProvider('anthropic', () => succeedsWith('x'), false),
    });

    await expect(service.complete(request, validate)).rejects.toThrow(/No LLM provider is configured/);
  });

  it('opens the circuit after repeated failures and stops calling the provider', async () => {
    const openai = new FakeProvider('openai', () => rateLimited('openai'));
    const gemini = new FakeProvider('gemini', () => succeedsWith('gemini_answer'));
    const anthropic = new FakeProvider('anthropic', () => succeedsWith('anthropic_answer'));
    const service = buildService({ openai, gemini, anthropic });

    // Threshold is 2 provider-level failures.
    await service.complete(request, validate);
    await service.complete(request, validate);
    const callsBefore = openai.calls;

    await service.complete(request, validate);

    // Third turn must skip OpenAI entirely rather than spending three more timeouts on it.
    expect(openai.calls).toBe(callsBefore);
    expect(service.health().openai).toMatchObject({ state: 'open' });
  });
});
