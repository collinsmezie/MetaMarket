import { Inject, Injectable } from '@nestjs/common';
import {
  EVENT_PUBLISHER,
  type EventPublisherPort,
} from '../../../domain/ports/outbound/event-publisher.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../../domain/ports/outbound/system.port';
import { correlatedEvent, PlatformEvents } from '../../../platform/events/domain-event';
import { EVIDENCE_COMPONENT, type GraphChangeDecision } from '../../domain/evidence-model';
import { EVIDENCE_STORE, type EvidenceStorePort } from '../../ports/evidence-store.port';
import type { GraphChangeOutcome, GraphChangeSinkPort } from '../../ports/graph-change-sink.port';

/**
 * Phase 8 binding of the Evidence → MKG hand-off (Evidence TDR §53.1–§53.2; MKG TDR §12, §23).
 * The decision is already persisted by the service; this sink publishes `GraphChangeDecided` so
 * the graph writer (Phase 9 MKG) can apply it asynchronously through the outbox (§54.6). The
 * decision stays PENDING until MKG reports the mutation, so nothing pretends a graph write
 * happened before it did (MKG §29 "never report successful mutation before graph commit").
 */
@Injectable()
export class RecordingGraphChangeSink implements GraphChangeSinkPort {
  constructor(
    @Inject(EVIDENCE_STORE) private readonly store: EvidenceStorePort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  async submit(decision: GraphChangeDecision): Promise<GraphChangeOutcome> {
    await this.events.publish(
      correlatedEvent({
        eventId: this.ids.uuid(),
        eventType: PlatformEvents.GraphChangeDecided,
        producer: EVIDENCE_COMPONENT,
        occurredAt: this.clock.now(),
        payload: {
          decisionId: decision.decisionId,
          assertionId: decision.assertionId,
          operation: decision.operation,
          relevanceDecision: decision.relevanceDecision,
          subjectId: decision.subjectId,
          predicate: decision.predicate,
          objectId: decision.objectId,
          beliefScore: decision.beliefScore,
          reasonCodes: decision.reasonCodes,
          evidenceIds: decision.evidenceIds,
          policyVersion: decision.policyVersion,
        },
        runId: decision.runId ?? undefined,
        aggregate: { type: 'GraphChangeDecision', id: decision.decisionId },
      }),
    );
    void this.store;
    return {
      decisionId: decision.decisionId,
      status: 'DEFERRED',
      detail: 'Published GraphChangeDecided; awaiting the MKG graph writer (Phase 9)',
    };
  }
}
