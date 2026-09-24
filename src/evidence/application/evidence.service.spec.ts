import type { AppConfigService } from '../../config/app-config.service';
import type { EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import type { StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { FixedClock } from '../../domain/ports/outbound/system.port';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import type { TraceRecorderPort } from '../../platform/observability/trace.port';
import type { PromptExecutor } from '../../platform/prompt-runtime/prompt-executor';
import { PromptRegistry } from '../../platform/prompt-runtime/prompt-registry';
import type { WrsRepositoryPort } from '../../retrieval/ports/wrs.repository.port';
import type {
  GraphChangeDecision,
  KnowledgeState,
  NormalizedEvidence,
  ObservationInput,
} from '../domain/evidence-model';
import type {
  AssertionRecord,
  AssertionUpsert,
  BeliefHistoryEntry,
  EvidenceRecord,
  EvidenceStorePort,
  GraphChangeDecisionRecord,
  GraphChangeDecisionStatus,
  KnowledgeRecord,
  KnowledgeUpsert,
  ObservationRecord,
  ObservationStatus,
} from '../ports/evidence-store.port';
import type { GraphChangeSinkPort } from '../ports/graph-change-sink.port';
import { EvidenceService } from './evidence.service';

class InMemoryStore implements EvidenceStorePort {
  readonly observations = new Map<string, ObservationRecord>();
  readonly evidence: EvidenceRecord[] = [];
  readonly assertions = new Map<string, AssertionRecord>();
  readonly history: BeliefHistoryEntry[] = [];
  readonly knowledge = new Map<string, KnowledgeRecord>();
  readonly decisions: GraphChangeDecisionRecord[] = [];
  private seq = 0;

  async recordObservation(observation: ObservationInput) {
    if (this.observations.has(observation.observationId)) return null;
    const record: ObservationRecord = {
      ...observation,
      id: `o${++this.seq}`,
      status: 'RECORDED',
      evidenceCount: 0,
      error: null,
      ingestedAt: new Date(),
    };
    this.observations.set(observation.observationId, record);
    return record;
  }
  async findObservation(id: string) {
    return this.observations.get(id) ?? null;
  }
  async completeObservation(
    id: string,
    status: ObservationStatus,
    evidenceCount: number,
    error: { code: string; message: string } | null,
  ) {
    const existing = this.observations.get(id)!;
    this.observations.set(id, { ...existing, status, evidenceCount, error });
  }
  async appendEvidence(items: readonly NormalizedEvidence[]) {
    const added: EvidenceRecord[] = [];
    for (const item of items) {
      if (this.evidence.some((e) => e.evidenceId === item.evidenceId)) continue;
      const record = { ...item, id: `e${++this.seq}`, createdAt: new Date() };
      this.evidence.push(record);
      added.push(record);
    }
    return added;
  }
  async evidenceForAssertion(assertionId: string) {
    return this.evidence
      .filter((e) => e.assertionId === assertionId)
      .sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime());
  }
  async evidenceForObservation(observationId: string) {
    return this.evidence.filter((e) => e.observationId === observationId);
  }
  async evidenceForRequest() {
    return [];
  }
  async findAssertion(id: string) {
    return this.assertions.get(id) ?? null;
  }
  async findAssertions(ids: readonly string[]) {
    return ids.map((id) => this.assertions.get(id)).filter((a): a is AssertionRecord => a !== undefined);
  }
  async assertionsForNode(nodeId: string) {
    return [...this.assertions.values()].filter(
      (a) => a.assertion.subject === nodeId || a.assertion.object === nodeId,
    );
  }
  async upsertAssertion(upsert: AssertionUpsert) {
    const existing = this.assertions.get(upsert.assertionId);
    const record: AssertionRecord = {
      ...upsert,
      id: existing?.id ?? `a${++this.seq}`,
      decisionCount: existing?.decisionCount ?? 0,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.assertions.set(upsert.assertionId, record);
    return record;
  }
  async appendBeliefHistory(entry: BeliefHistoryEntry) {
    this.history.push(entry);
  }
  async beliefHistory(assertionId: string) {
    return this.history.filter((h) => h.assertionId === assertionId).map((h, i) => ({ ...h, id: `h${i}` }));
  }
  async upsertKnowledge(upsert: KnowledgeUpsert) {
    const existing = this.knowledge.get(upsert.knowledgeId);
    const record: KnowledgeRecord = {
      ...upsert,
      id: existing?.id ?? `k${++this.seq}`,
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.knowledge.set(upsert.knowledgeId, record);
    return record;
  }
  async knowledgeForAssertions(ids: readonly string[]) {
    return [...this.knowledge.values()].filter((k) => ids.includes(k.assertionId));
  }
  async knowledgeByType(type: string, states: readonly KnowledgeState[]) {
    return [...this.knowledge.values()].filter((k) => k.type === type && states.includes(k.state));
  }
  async knowledgeForNodes() {
    return [];
  }
  async recordDecision(decision: GraphChangeDecision) {
    const record: GraphChangeDecisionRecord = {
      ...decision,
      id: `d${++this.seq}`,
      status: 'PENDING',
      appliedAt: null,
      failure: null,
    };
    this.decisions.push(record);
    const assertion = this.assertions.get(decision.assertionId);
    if (assertion)
      this.assertions.set(decision.assertionId, { ...assertion, decisionCount: assertion.decisionCount + 1 });
    return record;
  }
  async markDecision(decisionId: string, status: GraphChangeDecisionStatus) {
    const index = this.decisions.findIndex((d) => d.decisionId === decisionId);
    this.decisions[index] = { ...this.decisions[index]!, status };
  }
  async decisionsForAssertion(assertionId: string) {
    return this.decisions.filter((d) => d.assertionId === assertionId);
  }
  async decisionsForRun() {
    return [];
  }
  async pendingDecisions() {
    return this.decisions.filter((d) => d.status === 'PENDING');
  }
  async observationsForRun() {
    return [];
  }
  async observationsForRequest() {
    return [];
  }
}

function build() {
  const store = new InMemoryStore();
  const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
  const submitted: GraphChangeDecision[] = [];
  const sink: GraphChangeSinkPort = {
    submit: async (decision) => {
      submitted.push(decision);
      return { decisionId: decision.decisionId, status: 'DEFERRED', detail: null };
    },
  };
  const service = new EvidenceService(
    store,
    sink,
    { findByRequestId: async () => null, evidenceForRequest: async () => [] } as unknown as WrsRepositoryPort,
    {
      startStep: async () => undefined,
      finishStep: async () => undefined,
      recordPromptExecution: async () => undefined,
    } as unknown as TraceRecorderPort,
    {
      publish: async (event: { eventType: string; payload: Record<string, unknown> }) =>
        void events.push(event),
      publishAll: async () => undefined,
    } as unknown as EventPublisherPort,
    { stage: () => undefined, stageFailed: () => undefined } as unknown as StageLoggerPort,
    new FixedClock(new Date('2026-09-24T12:00:00Z')),
    { uuid: () => `evt_${Math.random().toString(36).slice(2, 8)}` } as never,
    new PromptRegistry(),
    new SchemaRegistry(),
    {
      execute: async () => ({
        status: 'PROVIDER_FAILURE',
        error: { code: 'NOT_EXPECTED', message: 'free text not used here', retryable: false },
        execution: { id: 'px' },
      }),
    } as unknown as PromptExecutor,
    { specialistModel: 'test-model' } as unknown as AppConfigService,
  );
  return { service, store, events, submitted };
}

const csreObservation = (
  eventId: string,
  conversationId: string,
  phrase = 'iron sponge',
  concept = 'steel wool scouring pad',
  confidence = 0.95,
): ObservationInput => ({
  observationId: `obs:${eventId}`,
  observationType: 'CSRE_SEMANTIC_RESOLUTION',
  source: { component: 'CSRE', version: '5.4', eventId, requestId: `req_${eventId}` },
  actor: null,
  channel: 'web',
  interaction: {
    conversationId,
    turnId: `turn_${eventId}`,
    runId: `turn:turn_${eventId}`,
    workflowId: null,
    actionId: null,
    interactionId: null,
  },
  observedAt: new Date('2026-09-24T11:00:00Z'),
  context: { country: 'NG', region: 'Lagos' },
  payload: {
    requestId: `req_${eventId}`,
    objectId: 'object_1',
    semanticObjectId: `so_${eventId}`,
    surfaceForm: phrase,
    canonicalForm: concept,
    entityType: 'PRODUCT',
    commercialRelevance: 'DIRECT_PRODUCT',
    ambiguityPresent: false,
    semanticOrigin: {
      phrase,
      concept,
      market_concept_id: null,
      concept_status: 'PROPOSED',
      relationship: 'EXPRESSES',
      origin: 'CSRE',
      request_id: `req_${eventId}`,
      semantic_confidence: confidence,
    },
  },
  rawText: null,
});

const vendorObservation = (
  eventId: string,
  type: ObservationInput['observationType'],
  objects: Record<string, unknown>[],
  interactionId: string,
): ObservationInput => ({
  observationId: `obs:${eventId}`,
  observationType: type,
  source: { component: 'LIVE', version: '1', eventId, requestId: null },
  actor: { id: 'v1', role: 'VENDOR' },
  channel: 'whatsapp',
  interaction: {
    conversationId: 'conv_v1',
    turnId: null,
    runId: null,
    workflowId: null,
    actionId: null,
    interactionId,
  },
  observedAt: new Date('2026-09-24T11:30:00Z'),
  context: { country: 'NG', region: null },
  payload: { objects },
  rawText: null,
});

describe('EvidenceService', () => {
  it('turns a CSRE semantic-origin observation into evidence, a CANDIDATE assertion and an ADD decision; redelivery is a no-op', async () => {
    const { service, store, events, submitted } = build();
    const first = await service.ingest(csreObservation('e1', 'conv_a'));
    expect(first.duplicate).toBe(false);
    expect(first.evidence).toHaveLength(1);
    expect(first.assertions[0]).toMatchObject({
      assertion: {
        subject: 'phrase:ng:iron sponge',
        predicate: 'mkg:EXPRESSES',
        object: 'concept:proposed:steel wool scouring pad',
      },
      state: 'CANDIDATE',
      independentSourceCount: 1,
    });
    // A single model resolution is exploratory support (§5 0.2–0.4), never more.
    expect(first.assertions[0]!.belief).toBeGreaterThan(0.15);
    expect(first.assertions[0]!.belief).toBeLessThan(0.4);
    // Too weak to add to the graph yet: INVESTIGATE emits no GraphChangeDecision (§25).
    expect(first.decisions).toEqual([]);
    expect(submitted).toHaveLength(0);
    expect(events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['BeliefUpdated', 'ObservationRecorded']),
    );

    const again = await service.ingest(csreObservation('e1', 'conv_a'));
    expect(again.duplicate).toBe(true);
    expect(store.evidence).toHaveLength(1);
    expect(store.decisions).toHaveLength(0);
  });

  it('corroboration across conversations promotes local-term knowledge to SUPPORTED and reinforces the graph', async () => {
    const { service, store } = build();
    await service.ingest(csreObservation('e1', 'conv_a'));
    // Same conversation again: same independence key → not corroboration.
    const same = await service.ingest(csreObservation('e2', 'conv_a'));
    expect(same.assertions[0]!.independentSourceCount).toBe(1);
    const other = await service.ingest(csreObservation('e3', 'conv_b'));
    expect(other.assertions[0]!.independentSourceCount).toBe(2);
    expect(other.assertions[0]!.state).toBe('CANDIDATE'); // conservative: model-only support needs more usage
    expect(other.decisions.map((d) => d.operation)).toEqual(['ADD']); // now strong enough to enter the graph
    const third = await service.ingest(csreObservation('e4', 'conv_c'));
    expect(third.decisions.map((d) => d.operation)).toEqual(['REINFORCE']);
    const fourth = await service.ingest(csreObservation('e5', 'conv_d'));
    expect(fourth.assertions[0]!.independentSourceCount).toBe(4);
    expect(fourth.assertions[0]!.belief).toBeGreaterThanOrEqual(0.6);
    expect(fourth.assertions[0]!.state).toBe('SUPPORTED');
    const knowledge = [...store.knowledge.values()][0]!;
    expect(knowledge).toMatchObject({
      type: 'LOCAL_TERM_MAPPING',
      state: 'SUPPORTED',
      claim: { surface_term: 'iron sponge', canonical_concept: 'steel wool scouring pad' },
    });
    expect(knowledge.supportedBy).toHaveLength(4);
    expect(store.history).toHaveLength(4); // the same-conversation repeat changed nothing
  });

  it('keeps vendor capability history: confirmation raises belief, a later rejection lowers it without erasing evidence', async () => {
    const { service, store, events } = build();
    const yes = await service.ingest(
      vendorObservation('v1a', 'VENDOR_CONFIRMATION', [{ label: 'wall sockets' }], 'int-1'),
    );
    expect(yes.assertions[0]).toMatchObject({
      assertion: { subject: 'vendor:v1', predicate: 'mkg:SUPPLIES', object: 'concept:proposed:wall sockets' },
      state: 'SUPPORTED',
    });
    const before = yes.assertions[0]!.belief;
    const no = await service.ingest(
      vendorObservation('v1b', 'VENDOR_REJECTION', [{ label: 'wall sockets' }], 'int-2'),
    );
    expect(no.assertions[0]!.belief).toBeLessThan(before);
    expect(no.assertions[0]!.counts).toEqual({ POSITIVE: 1, NEGATIVE: 1, NEUTRAL: 0, CONTRADICTORY: 0 });
    expect(store.evidence).toHaveLength(2);
    expect(events.filter((e) => e.eventType === 'CapabilityBeliefUpdated')).toHaveLength(2);
    expect(no.decisions.map((d) => d.operation)[0]).toMatch(/DECAY|DEACTIVATE/);
  });

  it('records buyer demand as REQUESTED, never as vendor capability', async () => {
    const { service } = build();
    const demand = await service.ingest({
      ...vendorObservation('b1', 'BUYER_REQUEST', [{ label: 'wall sockets' }], 'int-3'),
      actor: { id: 'b1', role: 'BUYER' },
    });
    expect(demand.assertions.map((a) => a.assertion.predicate)).toEqual(['mkg:REQUESTED']);
    expect(demand.assertions[0]!.assertion.subject).toBe('buyer:b1');
  });
});
