import { Inject, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import { EVENT_PUBLISHER, type EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import { RequestContextStore } from '../../platform/correlation/request-context';
import { correlatedEvent, PlatformEvents } from '../../platform/events/domain-event';
import { TRACE_RECORDER, type TraceRecorderPort } from '../../platform/observability/trace.port';
import { DEFAULT_MODEL_POLICY, type PromptDefinition } from '../../platform/prompt-runtime/prompt-definition';
import {
  PromptExecutor,
  type PromptOutcome,
  type PromptSection,
} from '../../platform/prompt-runtime/prompt-executor';
import { loadPromptFile, PromptRegistry } from '../../platform/prompt-runtime/prompt-registry';
import { componentVersion } from '../../platform/registry/component-registry';
import { planQueries, type PlannedQuery } from '../domain/query-plan';
import {
  type CollectedSource,
  toWireRequest,
  WRS_PROMPT_ID,
  WRS_PROMPT_VERSION,
  WRS_REQUEST_SCHEMA_ID,
  WRS_RESPONSE_SCHEMA_ID,
  WRS_WIRE_SCHEMA_VERSION,
  type WrsInvocationStatus,
  type WrsServiceRequest,
  type WrsServiceResponse,
} from '../domain/wrs-evidence';
import { validateWrsInvariants } from '../domain/wrs-invariants';
import {
  SEARCH_PROVIDER,
  SearchProviderError,
  type SearchProviderPort,
  type SearchResponse,
} from '../ports/search-provider.port';
import type { WebRetrievalPort } from '../ports/web-retrieval.port';
import { WRS_REPOSITORY, type WrsRepositoryPort } from '../ports/wrs.repository.port';
import requestSchema from '../schemas/wrs-request-v4.json';
import responseSchema from '../schemas/wrs-response-v4.json';

const COMPONENT = 'WRS';
const STAGE = 'retrieve';
/** Upper bound on distinct sources handed to the evaluator (§16.1 cost discipline). */
const MAX_COLLECTED_SOURCES = 15;

type Wire = Record<string, unknown>;

const TASK_TYPES: Record<string, string> = {
  CSRE: 'market_semantic_validation',
  ENRICHMENT: 'enrichment_evidence',
  GPC_RESOLVER: 'taxonomy_evidence',
  MATCHING_FANOUT: 'vendor_capability_evidence',
  MKG: 'relationship_evidence',
  EVIDENCE: 'evidence_refresh',
  OTHER: 'general_evidence',
};

/**
 * Web Retrieval System v4.4 — consumer-aware evidence retrieval (WRS TDR).
 *
 * Pipeline (§6): deterministic query planning → `SearchProviderPort` search (Tavily by default,
 * replaceable; final lock Q5) → source de-duplication → one model evaluation bound to
 * `wrs-response-v4` with provenance invariants → persistence of the envelope and one immutable
 * evidence row per item (§18.3, §20.4) → `EvidenceRetrieved`.
 *
 * Honesty rules (§15, §20.6): no provider ⇒ typed `WRS_PROVIDER_UNAVAILABLE`; no sources ⇒
 * deterministic `NO_RELIABLE_EVIDENCE` without a model call; the model may only cite sources
 * that were actually retrieved. WRS never decides the consumer's domain question.
 */
@Injectable()
export class WrsService implements WebRetrievalPort {
  private definition: PromptDefinition | null = null;

  constructor(
    @Inject(WRS_REPOSITORY) private readonly retrievals: WrsRepositoryPort,
    @Inject(SEARCH_PROVIDER) private readonly provider: SearchProviderPort,
    @Inject(TRACE_RECORDER) private readonly traces: TraceRecorderPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly prompts: PromptRegistry,
    private readonly schemas: SchemaRegistry,
    private readonly executor: PromptExecutor,
    private readonly config: AppConfigService,
  ) {}

  register(): PromptDefinition {
    if (this.definition !== null) return this.definition;
    this.schemas.register(responseSchema as Record<string, unknown>, { version: WRS_WIRE_SCHEMA_VERSION });
    this.schemas.register(requestSchema as Record<string, unknown>, { version: WRS_WIRE_SCHEMA_VERSION });
    this.definition = this.prompts.register({
      id: WRS_PROMPT_ID,
      version: WRS_PROMPT_VERSION,
      component: COMPONENT,
      schemaId: WRS_RESPONSE_SCHEMA_ID,
      system: loadPromptFile(join(__dirname, '..', 'prompts', 'wrs.master.md')),
      sections: [
        'policy',
        'consumer',
        'evidence-request',
        'current-candidates',
        'relationship-target',
        'context',
        'evidence-requirements',
        'requested-output-contract',
        'search-results',
      ],
      modelPolicy: { ...DEFAULT_MODEL_POLICY, model: this.config.specialistModel, maxOutputTokens: 4_000 },
      description: 'Evaluates retrieved web material into consumer-aware, provenance-bearing evidence.',
    });
    return this.definition;
  }

  /** True when a search provider is configured; consumers skip the evidence path otherwise. */
  available(): boolean {
    return this.provider.available();
  }

  async retrieve(request: WrsServiceRequest): Promise<WrsServiceResponse> {
    const definition = this.register();
    const existing = await this.retrievals.findByRequestId(request.requestId);
    if (existing !== null && existing.response !== null && existing.promptVersion === definition.version) {
      return this.envelope(request, existing.response, null);
    }
    const parent = RequestContextStore.current();
    return RequestContextStore.resume(
      {
        correlationId: parent?.correlationId,
        requestId: request.requestId,
        parentRequestId: parent?.requestId ?? null,
        component: COMPONENT,
        conversationId: request.conversationId ?? parent?.conversationId ?? null,
        turnId: request.turnId ?? parent?.turnId ?? null,
        runId: request.runId ?? parent?.runId ?? null,
        messageId: parent?.messageId ?? null,
      },
      () => this.run(request, definition),
    );
  }

  private async run(request: WrsServiceRequest, definition: PromptDefinition): Promise<WrsServiceResponse> {
    const startedAt = this.clock.now();
    const current = RequestContextStore.current();
    const queries = planQueries(request, this.config.wrs.maxQueries);
    await this.traces.startStep({
      runId: request.runId ?? current?.runId ?? `run_${request.requestId}`,
      requestId: request.requestId,
      parentRequestId: current?.parentRequestId ?? null,
      correlationId: current?.correlationId ?? `corr_${request.requestId}`,
      conversationId: request.conversationId ?? current?.conversationId ?? null,
      turnId: request.turnId ?? current?.turnId ?? null,
      component: COMPONENT,
      componentVersion: componentVersion('WRS'),
      stage: STAGE,
      schemaVersion: WRS_WIRE_SCHEMA_VERSION,
      startedAt,
      inputSummary: {
        consumer: request.consumer,
        question: request.question,
        candidates: request.candidates.length,
        requested_fields: request.requestedFields,
        provider: this.provider.name,
        queries: queries.map((query) => query.query),
      },
    });

    // §20.6: an absent provider is a typed, retryable-false failure — never guessed evidence.
    if (!this.provider.available()) {
      return this.fail(
        request,
        queries,
        [],
        null,
        'PROVIDER_UNAVAILABLE',
        {
          code: 'WRS_PROVIDER_UNAVAILABLE',
          message: `No search provider is available (WRS_SEARCH_PROVIDER=${this.config.wrs.provider}${this.config.wrs.provider === 'tavily' ? ', TAVILY_API_KEY unset' : ''})`,
          retryable: false,
        },
        startedAt,
      );
    }

    // §6 step 4: run the planned queries; a partial provider outage degrades, a total one fails.
    const settled = await Promise.allSettled(
      queries.map((query) =>
        this.provider.search({
          query: query.query,
          maxResults: this.config.wrs.maxResultsPerQuery,
          recencyDays: null,
          country: query.country,
          depth: 'BASIC',
        }),
      ),
    );
    const responses = settled
      .filter((r): r is PromiseFulfilledResult<SearchResponse> => r.status === 'fulfilled')
      .map((r) => r.value);
    const failures = settled
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => r.reason as unknown);
    if (responses.length === 0 && failures.length > 0) {
      const first = failures[0];
      const retryable = first instanceof SearchProviderError ? first.retryable : true;
      return this.fail(
        request,
        queries,
        [],
        null,
        'TEMPORARY_FAILURE',
        {
          code: 'WRS_PROVIDER_FAILURE',
          message: first instanceof Error ? first.message : String(first),
          retryable,
        },
        startedAt,
      );
    }
    const collected = collectSources(responses, queries);

    let wire: Wire;
    let outcome: PromptOutcome<Wire> | null = null;
    if (collected.length === 0) {
      // §20.6: nothing retrieved ⇒ NO_RELIABLE_EVIDENCE, decided in code.
      wire = noEvidenceResponse(request, 'No search result materially bears on the question');
    } else {
      outcome = await this.executor.execute<Wire>({
        definition,
        sections: this.sections(request, definition, collected),
        task: TASK,
        semanticValidator: (output) =>
          validateWrsInvariants(output, collected, request.candidates, request.requestedFields),
        decisionSummary: (output) => summarize(output as Wire),
      });
      if (outcome.status !== 'SUCCESS') {
        const status: WrsInvocationStatus =
          outcome.status === 'PROVIDER_FAILURE'
            ? 'TEMPORARY_FAILURE'
            : outcome.status === 'SCHEMA_FAILURE'
              ? 'SCHEMA_FAILURE'
              : 'POLICY_FAILURE';
        return this.fail(
          request,
          queries,
          collected,
          outcome,
          status,
          { code: outcome.error.code, message: outcome.error.message, retryable: outcome.error.retryable },
          startedAt,
        );
      }
      wire = stamp(outcome.data, request, collected);
    }

    const check = this.schemas.validate(WRS_RESPONSE_SCHEMA_ID, wire);
    if (!check.valid) {
      return this.fail(
        request,
        queries,
        collected,
        outcome,
        'SCHEMA_FAILURE',
        {
          code: 'WRS_POST_STAMP_SCHEMA_VIOLATION',
          message: check.errors.map((e) => `${e.path} ${e.message}`).join('; '),
          retryable: false,
        },
        startedAt,
      );
    }

    const summary = summarize(wire);
    const latencyMs = this.clock.now().getTime() - startedAt.getTime();
    const status: WrsInvocationStatus =
      summary.status === 'NO_RELIABLE_EVIDENCE' ? 'NO_RELIABLE_EVIDENCE' : 'SUCCESS';
    const { retrieval, evidence } = await this.persist(
      request,
      queries,
      collected,
      status,
      wire,
      outcome,
      latencyMs,
      null,
    );

    // §75.2-style fact for the Evidence System: one event per retrieval carrying the evidence ids.
    await this.events.publish(
      correlatedEvent({
        eventId: this.ids.uuid(),
        eventType: PlatformEvents.EvidenceRetrieved,
        producer: COMPONENT,
        occurredAt: this.clock.now(),
        payload: {
          requestId: request.requestId,
          retrievalId: retrieval.id,
          consumer: request.consumer,
          status: summary.status,
          evidenceIds: evidence.map((item) => item.evidenceId),
          sourceCount: collected.length,
          provider: this.provider.name,
        },
        conversationId: request.conversationId ?? undefined,
        turnId: request.turnId ?? undefined,
        runId: request.runId ?? undefined,
        aggregate: { type: 'WrsRetrieval', id: retrieval.id },
      }),
    );

    await this.traces.finishStep({
      requestId: request.requestId,
      status: 'SUCCESS',
      completedAt: this.clock.now(),
      decision: summary,
      outputSummary: {
        status: summary.status,
        evidence: evidence.length,
        sources: collected.length,
        queries: queries.length,
        model_call: outcome !== null,
      },
      persistedRecordIds: [retrieval.id, ...evidence.map((item) => item.id)],
      promptExecutionIds: outcome === null ? [] : [outcome.execution.id],
      retryCount: outcome === null ? 0 : Math.max(0, outcome.execution.providerAttempts - 1),
      error: null,
    });
    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: {
        requestId: request.requestId,
        consumer: request.consumer.component,
        queries: queries.length,
        sources: collected.length,
      },
      action: `Retrieved ${summary.status} for ${request.consumer.component}: ${evidence.length} evidence item(s) from ${collected.length} source(s)`,
      output: summary,
      durationMs: latencyMs,
    });
    return this.envelope(request, wire, null);
  }

  private async fail(
    request: WrsServiceRequest,
    queries: readonly PlannedQuery[],
    collected: readonly CollectedSource[],
    outcome: PromptOutcome<Wire> | null,
    status: WrsInvocationStatus,
    error: { code: string; message: string; retryable: boolean },
    startedAt: Date,
  ): Promise<WrsServiceResponse> {
    const latencyMs = this.clock.now().getTime() - startedAt.getTime();
    const { retrieval } = await this.persist(request, queries, collected, status, null, outcome, latencyMs, {
      code: error.code,
      message: error.message,
    });
    await this.traces.finishStep({
      requestId: request.requestId,
      status: 'ERROR',
      completedAt: this.clock.now(),
      decision: { status },
      outputSummary: null,
      persistedRecordIds: [retrieval.id],
      promptExecutionIds: outcome === null ? [] : [outcome.execution.id],
      retryCount: outcome === null ? 0 : Math.max(0, outcome.execution.providerAttempts - 1),
      error,
    });
    this.logger.stageFailed({
      component: COMPONENT,
      stage: STAGE,
      input: { requestId: request.requestId, consumer: request.consumer.component },
      action: `Retrieval ended with ${status}; returning a typed ERROR (never fabricated evidence)`,
      error: new Error(error.message),
    });
    return this.envelope(request, null, error);
  }

  private sections(
    request: WrsServiceRequest,
    definition: PromptDefinition,
    collected: readonly CollectedSource[],
  ): PromptSection[] {
    return [
      {
        name: 'policy',
        content: {
          request_id: request.requestId,
          component_version: componentVersion('WRS'),
          prompt_version: definition.version,
          schema_version: WRS_WIRE_SCHEMA_VERSION,
          task_type: taskTypeOf(request),
          retrieved_at: this.clock.now().toISOString(),
        },
      },
      {
        name: 'consumer',
        content: {
          component: request.consumer.component,
          version: request.consumer.version,
          purpose: request.consumer.purpose,
        },
      },
      {
        name: 'evidence-request',
        content: { question: request.question, requested_fields: request.requestedFields },
      },
      {
        name: 'current-candidates',
        content: request.candidates.map((candidate) => ({
          candidate_id: candidate.candidateId,
          label: candidate.label,
          description: candidate.description,
        })),
      },
      {
        name: 'relationship-target',
        content:
          request.relationshipTarget === null
            ? null
            : {
                subject_id: request.relationshipTarget.subjectId,
                predicate: request.relationshipTarget.predicate,
                object_id: request.relationshipTarget.objectId,
                object_type: request.relationshipTarget.objectType,
              },
      },
      { name: 'context', content: request.context },
      { name: 'evidence-requirements', content: request.evidenceRequirements },
      { name: 'requested-output-contract', content: request.outputContract },
      {
        name: 'search-results',
        content: collected.map((source) => ({
          source_id: source.sourceId,
          url: source.url,
          title: source.title,
          snippet: source.snippet,
          published_at: source.publishedAt,
          matched_queries: source.queries,
        })),
      },
    ];
  }

  private async persist(
    request: WrsServiceRequest,
    queries: readonly PlannedQuery[],
    collected: readonly CollectedSource[],
    status: WrsInvocationStatus,
    wire: Wire | null,
    outcome: PromptOutcome<Wire> | null,
    latencyMs: number,
    error: { code: string; message: string } | null,
  ) {
    return this.retrievals.save({
      requestId: request.requestId,
      conversationId: request.conversationId,
      turnId: request.turnId,
      runId: request.runId,
      consumerComponent: request.consumer.component,
      consumerVersion: request.consumer.version,
      consumerPurpose: request.consumer.purpose,
      question: request.question,
      request: toWireRequest(request),
      provider: this.provider.name,
      componentVersion: componentVersion('WRS'),
      promptId: WRS_PROMPT_ID,
      promptVersion: WRS_PROMPT_VERSION,
      schemaVersion: WRS_WIRE_SCHEMA_VERSION,
      status,
      responseStatus: wire === null ? null : String(wire.status),
      response: wire,
      queries: queries.map((query) => query.query),
      sourceCount: collected.length,
      evidenceCount: wire === null ? 0 : ((wire.evidence as unknown[]) ?? []).length,
      promptExecutionId: outcome?.execution.id ?? null,
      modelProvider: outcome?.execution.modelProvider ?? null,
      modelName: outcome?.execution.modelName ?? null,
      latencyMs,
      error,
    });
  }

  private envelope(
    request: WrsServiceRequest,
    wire: Readonly<Wire> | null,
    error: { code: string; message: string; retryable: boolean } | null,
  ): WrsServiceResponse {
    return {
      requestId: request.requestId,
      component: 'WRS',
      componentVersion: componentVersion('WRS'),
      status: error !== null || wire === null ? 'ERROR' : 'SUCCESS',
      response: wire,
      error,
    };
  }
}

const TASK = [
  "Evaluate the SEARCH RESULTS as external evidence for the consumer's EVIDENCE REQUEST.",
  'Extract only claims the supplied sources actually state; label inference as INFERENCE; record contradictions rather than collapsing them; assess geographic and temporal relevance for the Nigerian market context when applicable.',
  'If no source materially bears on the question, return NO_RELIABLE_EVIDENCE with an UNRESOLVED finding and no evidence items.',
  'Return only the wrs-response-v4 JSON object.',
].join('\n');

export function taskTypeOf(request: WrsServiceRequest): string {
  return TASK_TYPES[request.consumer.component] ?? TASK_TYPES.OTHER!;
}

/** De-duplicate by normalised URL, merge query provenance, rank by provider score (§7 ranking input only). */
export function collectSources(
  responses: readonly SearchResponse[],
  queries: readonly PlannedQuery[],
): CollectedSource[] {
  const byUrl = new Map<
    string,
    {
      url: string;
      title: string;
      snippet: string;
      publishedAt: string | null;
      score: number;
      queries: Set<string>;
    }
  >();
  const order = new Map(queries.map((query, index) => [query.query, index]));
  for (const response of responses) {
    for (const result of response.results) {
      const key = normaliseUrl(result.url);
      const existing = byUrl.get(key);
      if (existing === undefined) {
        byUrl.set(key, {
          url: result.url,
          title: result.title,
          snippet: result.snippet,
          publishedAt: result.publishedAt,
          score: result.score,
          queries: new Set([response.query]),
        });
      } else {
        existing.queries.add(response.query);
        existing.score = Math.max(existing.score, result.score);
        if (result.snippet.length > existing.snippet.length) existing.snippet = result.snippet;
      }
    }
  }
  return [...byUrl.values()]
    .sort((a, b) => b.queries.size - a.queries.size || b.score - a.score || a.url.localeCompare(b.url))
    .slice(0, MAX_COLLECTED_SOURCES)
    .map((entry, index) => ({
      sourceId: `src_${index + 1}`,
      url: entry.url,
      title: entry.title,
      snippet: entry.snippet,
      publishedAt: entry.publishedAt,
      providerScore: entry.score,
      queries: [...entry.queries].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
    }));
}

function normaliseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) parsed.searchParams.delete(key);
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function noEvidenceResponse(request: WrsServiceRequest, reason: string): Wire {
  return {
    schema_version: WRS_WIRE_SCHEMA_VERSION,
    request_id: request.requestId,
    consumer: {
      component: request.consumer.component,
      version: request.consumer.version,
      purpose: request.consumer.purpose,
    },
    task_type: taskTypeOf(request),
    status: 'NO_RELIABLE_EVIDENCE',
    evidence: [],
    findings: [{ finding: reason, kind: 'UNRESOLVED', evidence_ids: [], supports: [], contradicts: [] }],
    contradictions: [],
    sources: [],
    confidence: { overall: 0, evidence_quality: 0, evidence_consistency: 0 },
    payload: {},
  };
}

/** Globally unique, never-replaced evidence id (§18.3, §28.4): the model's local id namespaced by request. */
export function globalEvidenceId(requestId: string, localId: string): string {
  return localId.startsWith(`${requestId}#`) ? localId : `${requestId}#${localId}`;
}

/**
 * Runtime-owned stamps (§18.2): correlation, consumer identity, globally unique evidence ids
 * (with every reference rewritten), and source metadata copied from what was actually retrieved.
 */
function stamp(
  wire: Readonly<Wire>,
  request: WrsServiceRequest,
  collected: readonly CollectedSource[],
): Wire {
  const byId = new Map(collected.map((source) => [source.sourceId, source]));
  const rename = (id: unknown) => globalEvidenceId(request.requestId, String(id));
  const renameAll = (ids: unknown) => (Array.isArray(ids) ? ids.map(rename) : []);
  const evidence = ((wire.evidence as Wire[]) ?? []).map((item): Wire => {
    const source = byId.get(String(item.source_id));
    const renamed: Wire = { ...item, evidence_id: rename(item.evidence_id) };
    return source === undefined
      ? renamed
      : { ...renamed, source_url: source.url, source_title: source.title };
  });
  const findings = ((wire.findings as Wire[]) ?? []).map((finding) => ({
    ...finding,
    evidence_ids: renameAll(finding.evidence_ids),
  }));
  const contradictions = ((wire.contradictions as Wire[]) ?? []).map((entry) => ({
    ...entry,
    evidence_ids: renameAll(entry.evidence_ids),
  }));
  const cited = new Set(evidence.map((item) => String(item.source_id)));
  const listed = ((wire.sources as Wire[]) ?? []).map((source) => {
    const match = byId.get(String(source.source_id));
    return match === undefined ? source : { ...source, url: match.url, title: match.title };
  });
  const listedIds = new Set(listed.map((source) => String(source.source_id)));
  const missing = [...cited]
    .filter((id) => !listedIds.has(id))
    .map((id) => {
      const source = byId.get(id)!;
      const item = evidence.find((entry) => String(entry.source_id) === id)!;
      return {
        source_id: id,
        url: source.url,
        title: source.title,
        source_type: item.source_type,
        quality: item.quality,
        relevance: Number(item.confidence ?? 0),
      };
    });
  return {
    ...wire,
    schema_version: WRS_WIRE_SCHEMA_VERSION,
    request_id: request.requestId,
    consumer: {
      component: request.consumer.component,
      version: request.consumer.version,
      purpose: request.consumer.purpose,
    },
    task_type: taskTypeOf(request),
    evidence,
    findings,
    contradictions,
    sources: [...listed, ...missing],
  };
}

export interface WrsSummary {
  status: string;
  evidence: Array<{
    evidence_id: string;
    kind: string;
    claim: string;
    supports: string[];
    contradicts: string[];
    source_id: string;
    confidence: number;
  }>;
  findings: number;
  contradictions: number;
  confidence: number;
}

export function summarize(wire: Readonly<Wire>): WrsSummary {
  const confidence = (wire.confidence ?? {}) as Wire;
  return {
    status: String(wire.status),
    evidence: ((wire.evidence as Wire[]) ?? []).map((item) => ({
      evidence_id: String(item.evidence_id),
      kind: String(item.kind),
      claim: String(item.claim),
      supports: Array.isArray(item.supports) ? (item.supports as unknown[]).map(String) : [],
      contradicts: Array.isArray(item.contradicts) ? (item.contradicts as unknown[]).map(String) : [],
      source_id: String(item.source_id),
      confidence: Number(item.confidence ?? 0),
    })),
    findings: ((wire.findings as unknown[]) ?? []).length,
    contradictions: ((wire.contradictions as unknown[]) ?? []).length,
    confidence: Number(confidence.overall ?? 0),
  };
}

export { WRS_REQUEST_SCHEMA_ID };
