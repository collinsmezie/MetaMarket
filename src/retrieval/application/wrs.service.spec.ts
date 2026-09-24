import type { AppConfigService } from '../../config/app-config.service';
import type { EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import type { StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { FixedClock } from '../../domain/ports/outbound/system.port';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import type { PromptExecutionRecord, TraceRecorderPort } from '../../platform/observability/trace.port';
import type {
  PromptExecutor,
  PromptInvocation,
  PromptOutcome,
} from '../../platform/prompt-runtime/prompt-executor';
import { PromptRegistry } from '../../platform/prompt-runtime/prompt-registry';
import type { WrsServiceRequest } from '../domain/wrs-evidence';
import type { SearchProviderPort, SearchRequest, SearchResponse } from '../ports/search-provider.port';
import { SearchProviderError } from '../ports/search-provider.port';
import type {
  NewWrsRetrievalRecord,
  WrsEvidenceRecord,
  WrsRepositoryPort,
  WrsRetrievalRecord,
} from '../ports/wrs.repository.port';
import { collectSources, WrsService } from './wrs.service';

class InMemoryRetrievals implements WrsRepositoryPort {
  readonly rows: WrsRetrievalRecord[] = [];
  readonly evidence: WrsEvidenceRecord[] = [];
  async save(record: NewWrsRetrievalRecord) {
    const retrieval = { ...record, id: `wr_${this.rows.length + 1}`, createdAt: new Date() };
    this.rows.push(retrieval);
    const items = ((record.response?.evidence as Record<string, unknown>[] | undefined) ?? []).map(
      (item, index): WrsEvidenceRecord => ({
        id: `we_${this.evidence.length + index + 1}`,
        retrievalId: retrieval.id,
        requestId: record.requestId,
        evidenceId: String(item.evidence_id),
        consumerComponent: record.consumerComponent,
        claim: String(item.claim),
        kind: String(item.kind),
        supports: (item.supports as string[]) ?? [],
        contradicts: (item.contradicts as string[]) ?? [],
        relationshipTarget: null,
        sourceId: String(item.source_id),
        sourceUrl: (item.source_url as string | null) ?? null,
        sourceTitle: (item.source_title as string | null) ?? null,
        sourceType: String(item.source_type),
        geographicRelevance: String(item.geographic_relevance),
        temporalRelevance: String(item.temporal_relevance),
        quality: String(item.quality),
        confidence: Number(item.confidence),
        evidence: item,
        createdAt: new Date(),
      }),
    );
    this.evidence.push(...items);
    return { retrieval, evidence: items };
  }
  async findByRequestId(requestId: string) {
    return this.rows.find((row) => row.requestId === requestId) ?? null;
  }
  async evidenceForRequest(requestId: string) {
    return this.evidence.filter((item) => item.requestId === requestId);
  }
}

class ScriptedProvider implements SearchProviderPort {
  readonly name = 'scripted';
  readonly requests: SearchRequest[] = [];
  constructor(
    private readonly isAvailable: boolean,
    private readonly respond: (request: SearchRequest) => SearchResponse | Error,
  ) {}
  available() {
    return this.isAvailable;
  }
  async search(request: SearchRequest) {
    this.requests.push(request);
    const result = this.respond(request);
    if (result instanceof Error) throw result;
    return result;
  }
}

const execution = (id: string): PromptExecutionRecord =>
  ({
    id,
    providerAttempts: 1,
    modelProvider: 'openai',
    modelName: 'test',
  }) as unknown as PromptExecutionRecord;

const request = (overrides: Partial<WrsServiceRequest> = {}): WrsServiceRequest => ({
  schemaVersion: '4.0',
  requestId: 'csre_1:wrs:1',
  consumer: { component: 'CSRE', version: '5.4', purpose: 'market_semantic_validation' },
  question: 'Does "iron sponge" mean steel wool in Nigerian markets?',
  context: { phrase: 'iron sponge', geographic_context: 'Lagos, Nigeria', country_code: 'NG' },
  candidates: [{ candidateId: 'cand_1', label: 'steel wool scouring pad', description: null }],
  relationshipTarget: null,
  evidenceRequirements: [],
  requestedFields: [],
  outputContract: {},
  conversationId: 'conv_1',
  turnId: 'turn_1',
  runId: 'run_1',
  contextSnapshotId: null,
  ...overrides,
});

const modelResponse = (sourceId: string, quote: string | null = 'Iron sponge (steel wool) for pots') => ({
  schema_version: '4.0',
  request_id: 'ignored',
  consumer: { component: 'X', version: '0', purpose: 'x' },
  task_type: 'x',
  status: 'SUCCESS',
  evidence: [
    {
      evidence_id: 'ev_1',
      claim: 'Nigerian retailers list "iron sponge" as steel wool scouring pads',
      supports: ['cand_1'],
      contradicts: [],
      relationship_target: null,
      quote,
      source_id: sourceId,
      source_url: null,
      source_title: null,
      source_type: 'retailer',
      geographic_relevance: 'HIGH',
      temporal_relevance: 'CURRENT',
      quality: 'MEDIUM',
      confidence: 0.82,
      kind: quote === null ? 'INFERENCE' : 'OBSERVED',
    },
  ],
  findings: [
    {
      finding: 'Phrase denotes steel wool locally',
      kind: 'OBSERVED',
      evidence_ids: ['ev_1'],
      supports: ['cand_1'],
      contradicts: [],
    },
  ],
  contradictions: [],
  sources: [],
  confidence: { overall: 0.8, evidence_quality: 0.7, evidence_consistency: 0.9 },
  payload: {},
});

function build(
  provider: SearchProviderPort,
  script: (invocation: PromptInvocation) => PromptOutcome<unknown>,
) {
  const retrievals = new InMemoryRetrievals();
  const events: unknown[] = [];
  const steps: unknown[] = [];
  const invocations: PromptInvocation[] = [];
  const schemas = new SchemaRegistry();
  const executor = {
    execute: async (invocation: PromptInvocation) => {
      invocations.push(invocation);
      const outcome = script(invocation);
      if (outcome.status === 'SUCCESS') {
        // Mirror the runtime: schema then semantic validation, surfaced as a POLICY failure.
        const violations = invocation.semanticValidator?.(outcome.data) ?? [];
        if (violations.length > 0) {
          return {
            status: 'SEMANTIC_FAILURE',
            error: {
              code: 'SEMANTIC_INVARIANT_VIOLATION',
              message: violations.map((v) => v.keyword).join(','),
              retryable: false,
            },
            execution: execution('px_fail'),
          };
        }
      }
      return outcome;
    },
  } as unknown as PromptExecutor;
  const service = new WrsService(
    retrievals,
    provider,
    {
      startStep: async (step: unknown) => void steps.push(step),
      finishStep: async (step: unknown) => void steps.push(step),
    } as unknown as TraceRecorderPort,
    { publish: async (event: unknown) => void events.push(event) } as unknown as EventPublisherPort,
    { stage: () => undefined, stageFailed: () => undefined } as unknown as StageLoggerPort,
    new FixedClock(new Date('2026-09-24T12:00:00Z')),
    { uuid: () => 'evt_1' } as never,
    new PromptRegistry(),
    schemas,
    executor,
    {
      specialistModel: 'test-model',
      wrs: { provider: 'tavily', tavilyApiKey: 'k', maxQueries: 3, maxResultsPerQuery: 5, timeoutMs: 1000 },
    } as unknown as AppConfigService,
  );
  return { service, retrievals, events, steps, invocations };
}

const okSearch = (request: SearchRequest): SearchResponse => ({
  provider: 'scripted',
  query: request.query,
  latencyMs: 5,
  results: [
    {
      url: 'https://www.jumia.com.ng/iron-sponge?utm_source=x',
      title: 'Iron Sponge Steel Wool',
      snippet: 'Iron sponge (steel wool) for pots',
      publishedAt: null,
      score: 0.9,
    },
    {
      url: 'https://forum.example/thread#c1',
      title: 'Forum',
      snippet: 'what is iron sponge',
      publishedAt: null,
      score: 0.4,
    },
  ],
});

describe('WrsService', () => {
  it('reports PROVIDER_UNAVAILABLE without a model call when no provider is configured', async () => {
    const { service, retrievals, invocations } = build(new ScriptedProvider(false, okSearch), () => {
      throw new Error('must not be called');
    });
    const result = await service.retrieve(request());
    expect(result.status).toBe('ERROR');
    expect(result.error?.code).toBe('WRS_PROVIDER_UNAVAILABLE');
    expect(invocations).toHaveLength(0);
    expect(retrievals.rows[0]?.status).toBe('PROVIDER_UNAVAILABLE');
    expect(service.available()).toBe(false);
  });

  it('plans queries, de-duplicates sources, stamps provenance and persists evidence rows + event', async () => {
    const provider = new ScriptedProvider(true, okSearch);
    const { service, retrievals, events, invocations } = build(provider, () => ({
      status: 'SUCCESS',
      data: modelResponse('src_1'),
      execution: execution('px_1'),
    }));
    const result = await service.retrieve(request());
    expect(result.status).toBe('SUCCESS');
    expect(provider.requests.map((r) => r.query)).toEqual([
      'Does iron sponge mean steel wool in Nigerian markets?',
      'iron sponge Lagos, Nigeria',
      'iron sponge steel wool scouring pad Lagos, Nigeria',
    ]);
    const searchResults = invocations[0]!.sections.find((s) => s.name === 'search-results')!
      .content as Record<string, unknown>[];
    expect(searchResults).toHaveLength(2); // same two URLs across three queries
    expect(searchResults[0]).toMatchObject({
      source_id: 'src_1',
      url: 'https://www.jumia.com.ng/iron-sponge?utm_source=x',
    });
    const response = result.response!;
    expect(response.request_id).toBe('csre_1:wrs:1');
    expect(response.consumer).toEqual({
      component: 'CSRE',
      version: '5.4',
      purpose: 'market_semantic_validation',
    });
    expect(response.task_type).toBe('market_semantic_validation');
    const evidence = (response.evidence as Record<string, unknown>[])[0]!;
    expect(evidence.source_url).toBe('https://www.jumia.com.ng/iron-sponge?utm_source=x');
    expect(evidence.source_title).toBe('Iron Sponge Steel Wool');
    expect((response.sources as Record<string, unknown>[]).map((s) => s.source_id)).toEqual(['src_1']);
    expect(retrievals.rows[0]).toMatchObject({
      status: 'SUCCESS',
      responseStatus: 'SUCCESS',
      evidenceCount: 1,
      sourceCount: 2,
      promptExecutionId: 'px_1',
    });
    expect(retrievals.evidence[0]).toMatchObject({
      evidenceId: 'csre_1:wrs:1#ev_1',
      sourceUrl: 'https://www.jumia.com.ng/iron-sponge?utm_source=x',
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { eventType: string; payload: { evidenceIds: string[] } }).eventType).toBe(
      'EvidenceRetrieved',
    );
    expect((events[0] as { payload: { evidenceIds: string[] } }).payload.evidenceIds).toEqual([
      'csre_1:wrs:1#ev_1',
    ]);
  });

  it('returns a typed ERROR when the model cites a source that was never retrieved', async () => {
    const { service, retrievals } = build(new ScriptedProvider(true, okSearch), () => ({
      status: 'SUCCESS',
      data: modelResponse('src_99'),
      execution: execution('px_1'),
    }));
    const result = await service.retrieve(request());
    expect(result.status).toBe('ERROR');
    expect(result.error?.message).toContain('provenance_from_collected_sources');
    expect(retrievals.rows[0]?.status).toBe('POLICY_FAILURE');
  });

  it('decides NO_RELIABLE_EVIDENCE in code when searches return nothing', async () => {
    const { service, invocations, retrievals } = build(
      new ScriptedProvider(true, (r) => ({
        provider: 'scripted',
        query: r.query,
        results: [],
        latencyMs: 1,
      })),
      () => {
        throw new Error('must not be called');
      },
    );
    const result = await service.retrieve(request());
    expect(result.status).toBe('SUCCESS');
    expect(result.response?.status).toBe('NO_RELIABLE_EVIDENCE');
    expect(invocations).toHaveLength(0);
    expect(retrievals.rows[0]?.status).toBe('NO_RELIABLE_EVIDENCE');
  });

  it('degrades on partial provider failure and fails typed on total provider failure', async () => {
    let calls = 0;
    const partial = new ScriptedProvider(true, (r) =>
      calls++ === 0 ? new SearchProviderError('rate limited', 'scripted', true) : okSearch(r),
    );
    const partialRun = build(partial, () => ({
      status: 'SUCCESS',
      data: modelResponse('src_1'),
      execution: execution('px_1'),
    }));
    expect((await partialRun.service.retrieve(request())).status).toBe('SUCCESS');

    const total = new ScriptedProvider(true, () => new SearchProviderError('down', 'scripted', true));
    const totalRun = build(total, () => {
      throw new Error('must not be called');
    });
    const result = await totalRun.service.retrieve(request());
    expect(result.error).toMatchObject({ code: 'WRS_PROVIDER_FAILURE', retryable: true });
    expect(totalRun.retrievals.rows[0]?.status).toBe('TEMPORARY_FAILURE');
  });

  it('serves a repeated request id from persistence without searching again', async () => {
    const provider = new ScriptedProvider(true, okSearch);
    const { service } = build(provider, () => ({
      status: 'SUCCESS',
      data: modelResponse('src_1'),
      execution: execution('px_1'),
    }));
    await service.retrieve(request());
    const searches = provider.requests.length;
    const again = await service.retrieve(request());
    expect(again.status).toBe('SUCCESS');
    expect(provider.requests).toHaveLength(searches);
  });
});

describe('collectSources', () => {
  it('merges by normalised URL, ranks by query coverage then score, and numbers sources deterministically', () => {
    const queries = [
      { query: 'a', purpose: 'QUESTION' as const, country: null },
      { query: 'b', purpose: 'LOCALITY' as const, country: null },
    ];
    const sources = collectSources(
      [
        {
          provider: 'p',
          query: 'a',
          latencyMs: 1,
          results: [
            { url: 'https://x.com/p/', title: 'X', snippet: 's', publishedAt: null, score: 0.5 },
            { url: 'https://y.com/', title: 'Y', snippet: 'long snippet', publishedAt: null, score: 0.99 },
          ],
        },
        {
          provider: 'p',
          query: 'b',
          latencyMs: 1,
          results: [
            {
              url: 'https://x.com/p?utm_campaign=z#frag',
              title: 'X',
              snippet: 'longer snippet here',
              publishedAt: null,
              score: 0.7,
            },
          ],
        },
      ],
      queries,
    );
    expect(sources.map((s) => [s.sourceId, s.url, s.queries, s.providerScore, s.snippet])).toEqual([
      ['src_1', 'https://x.com/p/', ['a', 'b'], 0.7, 'longer snippet here'],
      ['src_2', 'https://y.com/', ['a'], 0.99, 'long snippet'],
    ]);
  });
});
