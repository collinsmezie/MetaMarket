import { Inject, Injectable } from '@nestjs/common';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import {
  ENRICHMENT_REPOSITORY,
  type EnrichmentRepositoryPort,
} from '../../../enrichment/ports/enrichment.repository.port';
import {
  type CorrelatedDomainEvent,
  type EventHandler,
  PlatformEvents,
} from '../../../platform/events/domain-event';
import { componentVersion } from '../../../platform/registry/component-registry';
import { EVIDENCE_COMPONENT, type ObservationInput, type ObservationType } from '../../domain/evidence-model';
import { EVIDENCE_INTAKE, type EvidenceIntakePort } from '../../ports/evidence-intake.port';

type Wire = Record<string, unknown>;

/**
 * Durable, exactly-once ingestion of platform facts into the Evidence System (Evidence TDR §42,
 * §50.4–§50.6, §54.6; Overarching §18.7). Runs on the outbox consumer, so evidence is recorded
 * asynchronously after the business transaction and duplicate delivery is a no-op: the
 * observation id is derived from the event id.
 */
@Injectable()
export class EvidenceIngestionHandler implements EventHandler {
  readonly name = 'evidence.ingestion';
  readonly eventTypes = [
    PlatformEvents.SemanticObjectResolved,
    PlatformEvents.GPCMapped,
    PlatformEvents.EvidenceRetrieved,
    PlatformEvents.EnrichmentCompleted,
  ] as const;

  constructor(
    @Inject(EVIDENCE_INTAKE) private readonly evidence: EvidenceIntakePort,
    @Inject(ENRICHMENT_REPOSITORY) private readonly enrichments: EnrichmentRepositoryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  async handle(event: CorrelatedDomainEvent): Promise<void> {
    const observation = await this.toObservation(event);
    if (observation === null) return;
    const result = await this.evidence.ingest(observation);
    if (result.duplicate) {
      this.logger.stage({
        component: EVIDENCE_COMPONENT,
        stage: 'ingest.duplicate',
        input: { eventId: event.eventId, eventType: event.eventType },
        action: 'Redelivered event matched an existing observation; no new evidence (§8)',
        output: { observationId: observation.observationId },
      });
    }
  }

  private async toObservation(event: CorrelatedDomainEvent): Promise<ObservationInput | null> {
    const payload = event.payload as Wire;
    const base = {
      observationId: `obs:${event.eventId}`,
      channel: null,
      interaction: {
        conversationId: event.conversationId ?? null,
        turnId: event.turnId ?? null,
        runId: event.runId ?? null,
        workflowId: event.workflowId ?? null,
        actionId: null,
        interactionId: null,
      },
      observedAt: event.timestamp,
      actor: null,
      rawText: null,
    };
    switch (event.eventType) {
      case PlatformEvents.SemanticObjectResolved: {
        const regional = ((payload.context as Wire | undefined)?.regional_context ?? {}) as Wire;
        return {
          ...base,
          observationType: 'CSRE_SEMANTIC_RESOLUTION' satisfies ObservationType,
          source: {
            component: 'CSRE',
            version: componentVersion('CSRE'),
            eventId: event.eventId,
            requestId: str(payload.requestId),
          },
          context: { country: str(regional.country) ?? 'NG', region: str(regional.region) },
          payload,
        };
      }
      case PlatformEvents.GPCMapped:
        return {
          ...base,
          observationType: 'GPC_MAPPING',
          source: {
            component: 'GPC_RESOLVER',
            version: componentVersion('GPC_RESOLVER'),
            eventId: event.eventId,
            requestId: str(payload.requestId),
          },
          context: { country: 'NG', region: null },
          payload,
        };
      case PlatformEvents.EvidenceRetrieved:
        return {
          ...base,
          observationType: 'WRS_EXTERNAL_EVIDENCE',
          source: {
            component: 'WRS',
            version: componentVersion('WRS'),
            eventId: event.eventId,
            requestId: str(payload.requestId),
          },
          context: { country: 'NG', region: null },
          payload,
        };
      case PlatformEvents.EnrichmentCompleted: {
        const requestId = str(payload.requestId);
        const profiles =
          requestId === null ? [] : await this.enrichments.profilesForRequest(requestId).catch(() => []);
        return {
          ...base,
          observationType: 'ENRICHMENT_INSIGHT',
          source: {
            component: 'ENRICHMENT',
            version: componentVersion('ENRICHMENT'),
            eventId: event.eventId,
            requestId,
          },
          context: { country: 'NG', region: null },
          payload: {
            ...payload,
            profiles: profiles.map((profile) => ({
              id: profile.id,
              objectId: profile.objectId,
              semanticObjectId: profile.semanticObjectId,
              concept: profile.concept,
              canonicalForm: profile.canonicalForm,
              marketConceptId: profile.marketConceptId,
              profile: profile.profile,
            })),
          },
        };
      }
      default:
        return null;
    }
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
