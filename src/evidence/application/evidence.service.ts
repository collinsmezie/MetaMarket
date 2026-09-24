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
import { PromptExecutor, type PromptOutcome } from '../../platform/prompt-runtime/prompt-executor';
import { loadPromptFile, PromptRegistry } from '../../platform/prompt-runtime/prompt-registry';
import { componentVersion } from '../../platform/registry/component-registry';
import { WRS_REPOSITORY, type WrsRepositoryPort } from '../../retrieval/ports/wrs.repository.port';
import {
  type Assertion,
  assertionIdOf,
  EVIDENCE_COMPONENT,
  EVIDENCE_FUSION_SCHEMA_ID,
  EVIDENCE_INTERPRET_PROMPT_ID,
  EVIDENCE_INTERPRET_PROMPT_VERSION,
  EVIDENCE_INTERPRETATION_SCHEMA_ID,
  EVIDENCE_OBSERVATION_SCHEMA_ID,
  EVIDENCE_POLICY_VERSION,
  EVIDENCE_REQUEST_SCHEMA_ID,
  EVIDENCE_RESPONSE_SCHEMA_ID,
  EVIDENCE_WIRE_SCHEMA_VERSION,
  GRAPH_RELEVANCE_SCHEMA_ID,
  type GraphChangeDecision,
  KNOWLEDGE_EXTRACTION_SCHEMA_ID,
  type KnowledgeState,
  knowledgeTypeFor,
  type NormalizedEvidence,
  normalizePolarity,
  type ObservationInput,
  stableHash,
} from '../domain/evidence-model';
import {
  decideRelevance,
  fuse,
  type FusionResult,
  promote,
  type RelevanceResult,
} from '../domain/evidence-policy';
import { validateInterpretationInvariants } from '../domain/interpretation-invariants';
import {
  type InterpretedItem,
  interpretCsreObservation,
  interpretEnrichmentObservation,
  interpretGpcObservation,
  interpretStructuredInteraction,
  interpretWrsObservation,
  toEvidence,
  type WrsRequestView,
} from '../domain/observation-interpreters';
import type { EvidenceIntakePort, IngestResult } from '../ports/evidence-intake.port';
import {
  EVIDENCE_STORE,
  type AssertionRecord,
  type EvidenceRecord,
  type EvidenceStorePort,
  type KnowledgeRecord,
  type ObservationRecord,
} from '../ports/evidence-store.port';
import { GRAPH_CHANGE_SINK, type GraphChangeSinkPort } from '../ports/graph-change-sink.port';
import fusionSchema from '../schemas/evidence-fusion-v4.json';
import interpretationSchema from '../schemas/evidence-interpretation-v4.json';
import observationSchema from '../schemas/evidence-observation-v4.json';
import requestSchema from '../schemas/evidence-request-v4.json';
import responseSchema from '../schemas/evidence-response-v4.json';
import relevanceSchema from '../schemas/graph-relevance-v4.json';
import knowledgeSchema from '../schemas/knowledge-extraction-v4.json';

const STAGE = 'ingest';
type Wire = Record<string, unknown>;

/**
 * Evidence System v4.4 — the learning and belief layer (Evidence TDR).
 *
 * `ingest` runs the four-layer pipeline for one observation (§2): record the raw observation
 * immutably (§15) → interpret it into provenance-bearing evidence (deterministically for
 * structured upstream facts, through the bound interpretation prompt for free text; §32, §50.3)
 * → recompute each touched assertion's belief from its full evidence history with the versioned
 * policy (§7, §33, §44) → promote/demote knowledge (§17, §54.2) → decide graph relevance (§25,
 * §34) and hand a `GraphChangeDecision` to MKG (§53.2). Every structured stage is validated
 * against its §51 schema before persistence (§50.8). Duplicate delivery is one observation (§8).
 */
@Injectable()
export class EvidenceService implements EvidenceIntakePort {
  private definition: PromptDefinition | null = null;

  constructor(
    @Inject(EVIDENCE_STORE) private readonly store: EvidenceStorePort,
    @Inject(GRAPH_CHANGE_SINK) private readonly graph: GraphChangeSinkPort,
    @Inject(WRS_REPOSITORY) private readonly wrs: WrsRepositoryPort,
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
    for (const schema of [
      observationSchema,
      requestSchema,
      responseSchema,
      interpretationSchema,
      fusionSchema,
      relevanceSchema,
      knowledgeSchema,
    ]) {
      this.schemas.register(schema as Record<string, unknown>, { version: EVIDENCE_WIRE_SCHEMA_VERSION });
    }
    this.definition = this.prompts.register({
      id: EVIDENCE_INTERPRET_PROMPT_ID,
      version: EVIDENCE_INTERPRET_PROMPT_VERSION,
      component: EVIDENCE_COMPONENT,
      schemaId: EVIDENCE_INTERPRETATION_SCHEMA_ID,
      system: loadPromptFile(join(__dirname, '..', 'prompts', 'evidence.interpret.md')),
      sections: ['observation', 'raw-text', 'objects', 'candidates', 'context'],
      modelPolicy: { ...DEFAULT_MODEL_POLICY, model: this.config.specialistModel, maxOutputTokens: 3_000 },
      description: 'Transforms a free-text marketplace observation into provenance-preserving evidence.',
    });
    return this.definition;
  }

  async ingest(observation: ObservationInput): Promise<IngestResult> {
    this.register();
    let record = await this.store.recordObservation(observation);
    let reprocessing = false;
    if (record === null) {
      const existing = await this.store.findObservation(observation.observationId);
      if (existing === null)
        throw new Error(`Observation ${observation.observationId} could not be recorded`);
      if (existing.status !== 'FAILED') {
        // §8/§39: redelivery of a known observation is not new evidence.
        const [evidence, assertions] = await Promise.all([
          this.store.evidenceForObservation(existing.observationId),
          Promise.resolve([] as AssertionRecord[]),
        ]);
        return {
          observation: existing,
          duplicate: true,
          evidence,
          assertions,
          knowledge: [],
          decisions: [],
          promptExecutionIds: [],
          error: null,
        };
      }
      record = existing;
      reprocessing = true;
    }
    const parent = RequestContextStore.current();
    const recorded = record;
    return RequestContextStore.resume(
      {
        correlationId: parent?.correlationId,
        requestId: observation.observationId,
        parentRequestId: observation.source.requestId ?? parent?.requestId ?? null,
        component: EVIDENCE_COMPONENT,
        conversationId: observation.interaction.conversationId,
        turnId: observation.interaction.turnId,
        runId: observation.interaction.runId,
        messageId: parent?.messageId ?? null,
      },
      () => this.run(recorded, reprocessing),
    );
  }

  private async run(observation: ObservationRecord, reprocessing: boolean): Promise<IngestResult> {
    const startedAt = this.clock.now();
    const current = RequestContextStore.current();
    const runId = observation.interaction.runId ?? `evidence:${observation.observationId}`;
    await this.traces.startStep({
      runId,
      requestId: observation.observationId,
      parentRequestId: observation.source.requestId,
      correlationId: current?.correlationId ?? `corr_${observation.observationId}`,
      conversationId: observation.interaction.conversationId,
      turnId: observation.interaction.turnId,
      component: EVIDENCE_COMPONENT,
      componentVersion: componentVersion('EVIDENCE'),
      stage: STAGE,
      schemaVersion: EVIDENCE_WIRE_SCHEMA_VERSION,
      startedAt,
      inputSummary: {
        observation_type: observation.observationType,
        source: observation.source,
        actor: observation.actor,
        has_raw_text: observation.rawText !== null,
        reprocessing,
      },
    });

    const promptExecutionIds: string[] = [];
    try {
      const interpreted = await this.interpret(observation, promptExecutionIds);
      if (interpreted.status === 'ERROR') {
        await this.store.completeObservation(observation.observationId, 'FAILED', 0, interpreted.error);
        await this.traces.finishStep({
          requestId: observation.observationId,
          status: 'ERROR',
          completedAt: this.clock.now(),
          decision: { status: 'FAILED' },
          outputSummary: null,
          persistedRecordIds: [observation.id],
          promptExecutionIds,
          retryCount: 0,
          error: { ...interpreted.error, retryable: interpreted.retryable },
        });
        return {
          observation: { ...observation, status: 'FAILED', error: interpreted.error },
          duplicate: false,
          evidence: [],
          assertions: [],
          knowledge: [],
          decisions: [],
          promptExecutionIds,
          error: interpreted.error,
        };
      }

      const normalized = toEvidence(observation, interpreted.items);
      const evidence = await this.store.appendEvidence(normalized);
      const assertionIds = [...new Set(normalized.map((item) => item.assertionId))];
      const assertions: AssertionRecord[] = [];
      const knowledge: KnowledgeRecord[] = [];
      const decisions: GraphChangeDecision[] = [];
      for (const assertionId of assertionIds) {
        const sample = normalized.find((item) => item.assertionId === assertionId)!;
        const outcome = await this.fuseAssertion(assertionId, sample, observation, runId);
        assertions.push(outcome.assertion);
        if (outcome.knowledge !== null) knowledge.push(outcome.knowledge);
        if (outcome.decision !== null) decisions.push(outcome.decision);
      }

      const status = evidence.length === 0 ? 'IGNORED' : 'INTERPRETED';
      await this.store.completeObservation(observation.observationId, status, evidence.length, null);
      await this.events.publish(
        correlatedEvent({
          eventId: this.ids.uuid(),
          eventType: PlatformEvents.ObservationRecorded,
          producer: EVIDENCE_COMPONENT,
          occurredAt: this.clock.now(),
          payload: {
            observationId: observation.observationId,
            observationType: observation.observationType,
            source: observation.source,
            evidenceIds: evidence.map((item) => item.evidenceId),
            assertionIds,
            decisionIds: decisions.map((decision) => decision.decisionId),
            status,
          },
          conversationId: observation.interaction.conversationId ?? undefined,
          turnId: observation.interaction.turnId ?? undefined,
          runId: observation.interaction.runId ?? undefined,
          aggregate: { type: 'Observation', id: observation.id },
        }),
      );

      const summary = {
        status,
        evidence: evidence.map((item) => ({
          evidence_id: item.evidenceId,
          assertion: item.assertion,
          polarity: item.polarity,
          strength: item.strength,
          kind: item.kind,
        })),
        assertions: assertions.map((assertion) => ({
          assertion_id: assertion.assertionId,
          subject: assertion.subjectLabel,
          predicate: assertion.assertion.predicate,
          object: assertion.objectLabel,
          belief: assertion.belief,
          state: assertion.state,
          independent_sources: assertion.independentSourceCount,
        })),
        decisions: decisions.map((decision) => ({
          decision_id: decision.decisionId,
          operation: decision.operation,
          relevance: decision.relevanceDecision,
          belief: decision.beliefScore,
        })),
      };
      const latencyMs = this.clock.now().getTime() - startedAt.getTime();
      await this.traces.finishStep({
        requestId: observation.observationId,
        status: 'SUCCESS',
        completedAt: this.clock.now(),
        decision: summary,
        outputSummary: {
          status,
          evidence: evidence.length,
          assertions: assertions.length,
          knowledge: knowledge.length,
          decisions: decisions.length,
          model_call: promptExecutionIds.length > 0,
        },
        persistedRecordIds: [
          observation.id,
          ...evidence.map((item) => item.id),
          ...assertions.map((assertion) => assertion.id),
        ],
        promptExecutionIds,
        retryCount: 0,
        error: null,
      });
      this.logger.stage({
        component: EVIDENCE_COMPONENT,
        stage: STAGE,
        input: { observationId: observation.observationId, type: observation.observationType },
        action: `Ingested ${observation.observationType}: ${evidence.length} evidence → ${assertions.length} assertion(s) ${assertions.map((a) => `${a.subjectLabel} ${a.assertion.predicate} ${a.objectLabel}=${a.belief.toFixed(3)}/${a.state}`).join('; ')}${decisions.length > 0 ? ` → ${decisions.map((d) => d.operation).join(',')}` : ''}`,
        output: summary,
        durationMs: latencyMs,
      });
      return {
        observation: { ...observation, status, evidenceCount: evidence.length },
        duplicate: false,
        evidence,
        assertions,
        knowledge,
        decisions,
        promptExecutionIds,
        error: null,
      };
    } catch (error) {
      const failure = {
        code: 'EVIDENCE_INGESTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      };
      await this.store
        .completeObservation(observation.observationId, 'FAILED', 0, failure)
        .catch(() => undefined);
      await this.traces
        .finishStep({
          requestId: observation.observationId,
          status: 'ERROR',
          completedAt: this.clock.now(),
          decision: { status: 'FAILED' },
          outputSummary: null,
          persistedRecordIds: [observation.id],
          promptExecutionIds,
          retryCount: 0,
          error: { ...failure, retryable: true },
        })
        .catch(() => undefined);
      this.logger.stageFailed({
        component: EVIDENCE_COMPONENT,
        stage: STAGE,
        input: { observationId: observation.observationId },
        action: 'Evidence ingestion failed; observation marked FAILED for reprocessing',
        error,
      });
      throw error;
    }
  }

  // ── Interpretation ──────────────────────────────────────────────────────────────────────────

  private async interpret(
    observation: ObservationRecord,
    promptExecutionIds: string[],
  ): Promise<
    | { status: 'SUCCESS'; items: InterpretedItem[] }
    | { status: 'ERROR'; error: { code: string; message: string }; retryable: boolean }
  > {
    switch (observation.observationType) {
      case 'CSRE_SEMANTIC_RESOLUTION':
        return { status: 'SUCCESS', items: interpretCsreObservation(observation) };
      case 'GPC_MAPPING':
        return { status: 'SUCCESS', items: interpretGpcObservation(observation) };
      case 'ENRICHMENT_INSIGHT':
        return { status: 'SUCCESS', items: interpretEnrichmentObservation(observation) };
      case 'WRS_EXTERNAL_EVIDENCE': {
        const requestId = observation.source.requestId ?? String(observation.payload.requestId ?? '');
        const [retrieval, rows] = await Promise.all([
          this.wrs.findByRequestId(requestId),
          this.wrs.evidenceForRequest(requestId),
        ]);
        if (retrieval === null)
          return {
            status: 'ERROR',
            error: {
              code: 'WRS_RETRIEVAL_NOT_FOUND',
              message: `WRS retrieval ${requestId} is not persisted`,
            },
            retryable: true,
          };
        return {
          status: 'SUCCESS',
          items: interpretWrsObservation(
            observation,
            wrsRequestView(
              retrieval.requestId,
              retrieval.request,
              retrieval.consumerComponent,
              retrieval.consumerVersion,
              retrieval.consumerPurpose,
              retrieval.question,
            ),
            rows,
          ),
        };
      }
      default: {
        if (
          Array.isArray(observation.payload.objects) &&
          (observation.payload.objects as unknown[]).length > 0
        ) {
          return { status: 'SUCCESS', items: interpretStructuredInteraction(observation) };
        }
        if (observation.rawText === null || observation.rawText.trim().length === 0)
          return { status: 'SUCCESS', items: [] };
        return this.interpretFreeText(observation, promptExecutionIds);
      }
    }
  }

  /** §32 Evidence Interpretation Agent, bound to `evidence-interpretation-v4` + semantic invariants. */
  private async interpretFreeText(
    observation: ObservationRecord,
    promptExecutionIds: string[],
  ): Promise<
    | { status: 'SUCCESS'; items: InterpretedItem[] }
    | { status: 'ERROR'; error: { code: string; message: string }; retryable: boolean }
  > {
    const definition = this.register();
    const candidates = Array.isArray(observation.payload.candidates)
      ? (observation.payload.candidates as Wire[])
      : [];
    const candidateIds = candidates.map((candidate) => String(candidate.candidate_id ?? candidate.id ?? ''));
    const outcome: PromptOutcome<Wire> = await this.executor.execute<Wire>({
      definition,
      sections: [
        {
          name: 'observation',
          content: {
            observation_id: observation.observationId,
            observation_type: observation.observationType,
            actor_id:
              observation.actor === null
                ? null
                : `${observation.actor.role.toLowerCase()}:${observation.actor.id}`,
            actor_role: observation.actor?.role ?? null,
            actor_label: observation.payload.actor_label ?? null,
            channel: observation.channel,
            observed_at: observation.observedAt.toISOString(),
            source: observation.source,
          },
        },
        { name: 'raw-text', content: observation.rawText },
        { name: 'objects', content: observation.payload.objects ?? [] },
        { name: 'candidates', content: candidates },
        { name: 'context', content: { ...observation.context, interaction: observation.interaction } },
      ],
      task: 'Interpret the RAW TEXT observation into evidence items. Return only the evidence-interpretation-v4 JSON object.',
      semanticValidator: (output) =>
        validateInterpretationInvariants(output, observation, candidateIds, null),
      decisionSummary: (output) => ({
        evidence: ((output as Wire).evidence as unknown[] | undefined)?.length ?? 0,
      }),
    });
    promptExecutionIds.push(outcome.execution.id);
    if (outcome.status !== 'SUCCESS')
      return {
        status: 'ERROR',
        error: { code: outcome.error.code, message: outcome.error.message },
        retryable: outcome.error.retryable,
      };
    const items = ((outcome.data.evidence as Wire[]) ?? []).map((item): InterpretedItem => {
      const assertion = item.assertion as Wire;
      const provenance = (item.provenance ?? {}) as Wire;
      return {
        assertion: {
          subject: String(assertion.subject),
          predicate: String(assertion.predicate),
          object: String(assertion.object),
        },
        subjectLabel: String(item.subject_label),
        objectLabel: String(item.object_label),
        polarity: normalizePolarity(item.polarity),
        strength: Number(item.strength ?? 0),
        kind: (item.kind as InterpretedItem['kind']) ?? 'DIRECT',
        claim: String(item.claim),
        supports: Array.isArray(item.supports) ? (item.supports as unknown[]).map(String) : [],
        contradicts: Array.isArray(item.contradicts) ? (item.contradicts as unknown[]).map(String) : [],
        independenceKey: String(item.independence_key),
        quote: typeof provenance.quote === 'string' ? provenance.quote : null,
        sourceId: observation.source.eventId,
        sourceUrl: null,
        upstream: {
          model_evidence_id: item.evidence_id,
          prompt_execution_id: outcome.execution.id,
          prompt: `${definition.id}@${definition.version}`,
        },
        sourcePayload: item,
      };
    });
    return { status: 'SUCCESS', items };
  }

  // ── Fusion → knowledge → graph decision ─────────────────────────────────────────────────────

  private async fuseAssertion(
    assertionId: string,
    sample: NormalizedEvidence,
    observation: ObservationRecord,
    runId: string,
  ): Promise<{
    assertion: AssertionRecord;
    knowledge: KnowledgeRecord | null;
    decision: GraphChangeDecision | null;
  }> {
    const now = this.clock.now();
    const [history, existing] = await Promise.all([
      this.store.evidenceForAssertion(assertionId),
      this.store.findAssertion(assertionId),
    ]);
    const prior =
      existing?.prior ?? (typeof observation.payload.prior === 'number' ? observation.payload.prior : null);
    const fusion = fuse({
      assertionId,
      assertion: sample.assertion,
      evidence: history,
      prior,
      previousBelief: existing?.belief ?? null,
      now,
    });
    this.assertValid(EVIDENCE_FUSION_SCHEMA_ID, fusionWire(fusion), 'EVIDENCE_FUSION_CONTRACT_VIOLATION');

    const state = promote(sample.assertion, fusion, existing?.state ?? null);
    const assertion = await this.store.upsertAssertion({
      assertionId,
      assertion: sample.assertion,
      subjectType: sample.subjectType,
      objectType: sample.objectType,
      subjectLabel: existing?.subjectLabel ?? sample.subjectLabel,
      objectLabel: existing?.objectLabel ?? sample.objectLabel,
      context: existing?.context ?? sample.context,
      knowledgeType: knowledgeTypeFor(sample.assertion) ?? 'COMMERCIAL_RELATIONSHIP',
      prior,
      belief: fusion.currentScore,
      direction: fusion.direction,
      state,
      observationCount: fusion.observationCount,
      evidenceCount: history.length,
      independentSourceCount: fusion.independentSourceCount,
      counts: fusion.counts,
      requiresMoreEvidence: fusion.requiresMoreEvidence,
      firstObservedAt: history[0]?.observedAt ?? null,
      lastObservedAt: fusion.lastObservedAt,
      lastFusedAt: now,
      policyVersion: EVIDENCE_POLICY_VERSION,
      fusion: fusionWire(fusion),
    });

    const previousBelief = existing?.belief ?? null;
    const newEvidenceIds = history
      .filter((item) => item.observationId === observation.observationId)
      .map((item) => item.evidenceId);
    if (previousBelief === null || Math.abs(fusion.currentScore - previousBelief) >= 0.0005) {
      await this.store.appendBeliefHistory({
        assertionId,
        score: fusion.currentScore,
        previousScore: previousBelief,
        reason:
          fusion.journey
            .filter((step) => newEvidenceIds.includes(step.evidenceId))
            .map((step) => step.reason)
            .join('+') || `refused_${observation.observationType.toLowerCase()}`,
        evidenceIds: newEvidenceIds,
        policyVersion: EVIDENCE_POLICY_VERSION,
        recordedAt: now,
      });
      await this.events.publish(
        correlatedEvent({
          eventId: this.ids.uuid(),
          eventType:
            sample.assertion.predicate === 'mkg:SUPPLIES' ||
            sample.assertion.predicate === 'mkg:IN_STOCK' ||
            sample.assertion.predicate === 'mkg:OUT_OF_STOCK'
              ? PlatformEvents.CapabilityBeliefUpdated
              : PlatformEvents.BeliefUpdated,
          producer: EVIDENCE_COMPONENT,
          occurredAt: now,
          payload: {
            assertionId,
            subject: sample.assertion.subject,
            predicate: sample.assertion.predicate,
            object: sample.assertion.object,
            subjectLabel: assertion.subjectLabel,
            objectLabel: assertion.objectLabel,
            belief: fusion.currentScore,
            previousBelief,
            direction: fusion.direction,
            state,
            independentSourceCount: fusion.independentSourceCount,
            evidenceIds: newEvidenceIds,
            observationId: observation.observationId,
            policyVersion: EVIDENCE_POLICY_VERSION,
          },
          runId: observation.interaction.runId ?? undefined,
          aggregate: { type: 'EvidenceAssertion', id: assertion.id },
        }),
      );
    }

    const knowledge = await this.persistKnowledge(
      assertion,
      fusion,
      state,
      existing?.state ?? null,
      now,
      observation,
    );
    const relevance = decideRelevance({
      assertionId,
      fusion,
      previousBelief,
      previousState: existing?.state ?? null,
      hadPriorDecision: (existing?.decisionCount ?? 0) > 0,
    });
    this.assertValid(
      GRAPH_RELEVANCE_SCHEMA_ID,
      relevanceWire(relevance),
      'GRAPH_RELEVANCE_CONTRACT_VIOLATION',
    );
    let decision: GraphChangeDecision | null = null;
    if (relevance.operation !== null) {
      decision = {
        decisionId: `gcd:${stableHash(`${assertionId}|${relevance.operation}|${observation.observationId}`)}`,
        assertionId,
        operation: relevance.operation,
        relevanceDecision: relevance.decision,
        subjectId: sample.assertion.subject,
        predicate: sample.assertion.predicate,
        objectId: sample.assertion.object,
        beliefScore: fusion.currentScore,
        reasonCodes: relevance.reasonCodes,
        evidenceIds: relevance.evidenceIds,
        policyVersion: EVIDENCE_POLICY_VERSION,
        correlationId: RequestContextStore.current()?.correlationId ?? `corr_${observation.observationId}`,
        runId: runId.startsWith('evidence:') ? null : runId,
        createdAt: now,
      };
      await this.store.recordDecision(decision);
      const outcome = await this.graph.submit(decision);
      if (outcome.status === 'APPLIED')
        await this.store.markDecision(decision.decisionId, 'APPLIED', null, this.clock.now());
      else if (outcome.status === 'REJECTED')
        await this.store.markDecision(decision.decisionId, 'REJECTED', outcome.detail, this.clock.now());
    }
    return {
      assertion: { ...assertion, decisionCount: assertion.decisionCount + (decision === null ? 0 : 1) },
      knowledge,
      decision,
    };
  }

  private async persistKnowledge(
    assertion: AssertionRecord,
    fusion: FusionResult,
    state: KnowledgeState,
    previousState: KnowledgeState | null,
    now: Date,
    observation: ObservationRecord,
  ): Promise<KnowledgeRecord | null> {
    const type = knowledgeTypeFor(assertion.assertion);
    if (type === null) return null;
    const knowledgeId = `k:${assertion.assertionId}`;
    const candidate = {
      knowledge_id: knowledgeId,
      type,
      claim: knowledgeClaim(type, assertion),
      scope: {
        country: assertion.context.country,
        region: assertion.context.region,
        predicate: assertion.assertion.predicate,
        language: 'en-NG',
      },
      confidence: fusion.currentScore,
      supported_by: fusion.supportingEvidenceIds,
      contradicted_by: fusion.contradictoryEvidenceIds,
    };
    this.assertValid(
      KNOWLEDGE_EXTRACTION_SCHEMA_ID,
      { schema_version: EVIDENCE_WIRE_SCHEMA_VERSION, knowledge_candidates: [candidate] },
      'KNOWLEDGE_CONTRACT_VIOLATION',
    );
    const record = await this.store.upsertKnowledge({
      knowledgeId,
      assertionId: assertion.assertionId,
      type,
      claim: candidate.claim,
      scope: candidate.scope,
      confidence: fusion.currentScore,
      state,
      supportedBy: fusion.supportingEvidenceIds,
      contradictedBy: fusion.contradictoryEvidenceIds,
      lastValidatedAt: now,
    });
    const rank: Record<KnowledgeState, number> = {
      INACTIVE: 0,
      CANDIDATE: 1,
      WEAKENING: 2,
      SUPPORTED: 3,
      ESTABLISHED: 4,
    };
    if (
      previousState !== state &&
      rank[state] > rank[previousState ?? 'CANDIDATE'] &&
      state !== 'CANDIDATE'
    ) {
      await this.events.publish(
        correlatedEvent({
          eventId: this.ids.uuid(),
          eventType: PlatformEvents.KnowledgePromoted,
          producer: EVIDENCE_COMPONENT,
          occurredAt: now,
          payload: {
            knowledgeId,
            type,
            claim: candidate.claim,
            state,
            previousState,
            confidence: fusion.currentScore,
            supportedBy: fusion.supportingEvidenceIds,
            assertionId: assertion.assertionId,
          },
          runId: observation.interaction.runId ?? undefined,
          aggregate: { type: 'Knowledge', id: record.id },
        }),
      );
    }
    return record;
  }

  private assertValid(schemaId: string, payload: unknown, code: string): void {
    const check = this.schemas.validate(schemaId, payload);
    if (!check.valid)
      throw new Error(`${code}: ${check.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`);
  }
}

export function fusionWire(fusion: FusionResult): Wire {
  return {
    schema_version: EVIDENCE_WIRE_SCHEMA_VERSION,
    relationship_id: fusion.relationshipId,
    current_score: fusion.currentScore,
    direction: fusion.direction,
    evidence_summary: fusion.evidenceSummary,
    supporting_evidence_ids: fusion.supportingEvidenceIds,
    contradictory_evidence_ids: fusion.contradictoryEvidenceIds,
    requires_more_evidence: fusion.requiresMoreEvidence,
  };
}

export function relevanceWire(relevance: RelevanceResult): Wire {
  return {
    schema_version: EVIDENCE_WIRE_SCHEMA_VERSION,
    relationship_id: relevance.relationshipId,
    decision: relevance.decision,
    belief_score: relevance.beliefScore,
    justification: relevance.justification,
    evidence_ids: relevance.evidenceIds,
  };
}

export function knowledgeClaim(type: string, assertion: AssertionRecord): Wire {
  const { subject, predicate, object } = assertion.assertion;
  switch (type) {
    case 'LOCAL_TERM_MAPPING':
      return predicate === 'mkg:HAS_ALIAS'
        ? {
            surface_term: assertion.objectLabel,
            canonical_concept: assertion.subjectLabel,
            concept_id: subject,
            phrase_id: object,
            relationship: predicate,
          }
        : {
            surface_term: assertion.subjectLabel,
            canonical_concept: assertion.objectLabel,
            concept_id: object,
            phrase_id: subject,
            relationship: predicate,
          };
    case 'TAXONOMY_ANCHOR':
      return {
        concept: assertion.subjectLabel,
        concept_id: subject,
        gpc_code: object.replace(/^gpc:/, ''),
        gpc_label: assertion.objectLabel,
        relationship: predicate,
      };
    case 'VENDOR_CAPABILITY':
      return {
        vendor_id: subject,
        vendor_label: assertion.subjectLabel,
        concept: assertion.objectLabel,
        concept_id: object,
        relationship: predicate,
      };
    case 'MARKET_DEMAND':
      return {
        actor_id: subject,
        concept: assertion.objectLabel,
        concept_id: object,
        relationship: predicate,
      };
    default:
      return {
        subject,
        subject_label: assertion.subjectLabel,
        predicate,
        object,
        object_label: assertion.objectLabel,
      };
  }
}

export function wrsRequestView(
  requestId: string,
  request: Readonly<Wire> | null,
  component: string,
  version: string,
  purpose: string,
  question: string,
): WrsRequestView {
  const evidenceRequest = ((request?.evidence_request ?? {}) as Wire) ?? {};
  const context = (evidenceRequest.context ?? {}) as Wire;
  const target = (evidenceRequest.relationship_target ?? null) as Wire | null;
  const phrase =
    typeof context.phrase === 'string'
      ? context.phrase
      : typeof context.surface_form === 'string'
        ? context.surface_form
        : null;
  const concept =
    typeof context.concept === 'string'
      ? context.concept
      : typeof context.canonical_form === 'string'
        ? context.canonical_form
        : null;
  return {
    requestId,
    consumer: { component, version, purpose },
    question,
    phrase,
    concept,
    marketConceptId: typeof context.market_concept_id === 'string' ? context.market_concept_id : null,
    candidates: ((evidenceRequest.candidates as Wire[]) ?? []).map((candidate) => ({
      candidateId: String(candidate.candidate_id),
      label: String(candidate.label),
    })),
    relationshipTarget:
      target === null
        ? null
        : {
            subjectId: (target.subject_id as string | null) ?? null,
            predicate: (target.predicate as string | null) ?? null,
            objectId: (target.object_id as string | null) ?? null,
          },
    country:
      typeof context.country_code === 'string'
        ? context.country_code
        : typeof context.country === 'string'
          ? context.country
          : null,
  };
}

export type { Assertion };
export {
  assertionIdOf,
  EVIDENCE_OBSERVATION_SCHEMA_ID,
  EVIDENCE_REQUEST_SCHEMA_ID,
  EVIDENCE_RESPONSE_SCHEMA_ID,
};
export type { EvidenceRecord };
