import { Inject, Injectable } from '@nestjs/common';
import type { TurnInputState } from '../../conversation/domain/turn-context';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import {
  specialistFailure,
  specialistRequest,
  specialistSuccess,
  type SpecialistResponseEnvelope,
} from '../../platform/contracts/specialist-envelope';
import { newRequestId } from '../../platform/correlation/request-context';
import { componentVersion } from '../../platform/registry/component-registry';
import type { CSREResolution } from '../../semantics/domain/csre-resolution';
import {
  SEMANTIC_RESOLUTION_REPOSITORY,
  type SemanticResolutionRepositoryPort,
} from '../../semantics/ports/semantic-resolution.repository.port';
import {
  ENRICHMENT_OUTPUT_SCHEMA_ID,
  ENRICHMENT_POLICY_VERSION,
  ENRICHMENT_REQUEST_SCHEMA_ID,
  toEnrichmentResolution,
  type DownstreamPurpose,
  type EnrichmentResolution,
  type EnrichmentServiceRequest,
} from '../domain/enrichment-resolution';
import { SEMANTIC_ENRICHMENT, type SemanticEnrichmentPort } from '../ports/semantic-enrichment.port';

const COMPONENT = 'LANGGRAPH';
const STAGE = 'EnrichmentAdapter';

/**
 * Orchestrator-side typed adapter for Enrichment (Enrichment TDR §28–§29; MCOS §63.4 "Enrichment
 * and GPC Resolver MUST receive the same object_id and the exact CSRE semantic_origin").
 *
 * Takes the CSRE resolution the graph holds, loads the *persisted* wire objects of that CSRE
 * request (byte-exact, with durable ids), builds the canonical 4.1 request, validates both
 * directions and projects into the MCOS specialist envelope. Never repairs a result by guessing.
 */
@Injectable()
export class EnrichmentAdapter {
  constructor(
    @Inject(SEMANTIC_ENRICHMENT) private readonly enrichment: SemanticEnrichmentPort,
    @Inject(SEMANTIC_RESOLUTION_REPOSITORY) private readonly semantics: SemanticResolutionRepositoryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  async enrich(
    input: TurnInputState,
    csre: CSREResolution,
    csreRequestId: string,
    purpose: DownstreamPurpose,
    options: { requestId?: string } = {},
  ): Promise<SpecialistResponseEnvelope<EnrichmentResolution>> {
    const request = await this.buildRequest(input, csre, csreRequestId, purpose, options);
    const envelope = specialistRequest<EnrichmentServiceRequest>(
      'ENRICHMENT',
      '4.1',
      {
        conversationId: input.conversationId,
        turnId: input.turnId,
        runId: input.runId,
        contextSnapshotId: input.contextSnapshotId,
      },
      request,
      request.requestId,
    );

    const requestCheck = this.schemas.validate(ENRICHMENT_REQUEST_SCHEMA_ID, toWireRequest(request));
    if (!requestCheck.valid) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { turnId: input.turnId, errors: requestCheck.errors.slice(0, 5) },
        action: 'Enrichment request failed contract validation before invocation',
        error: new Error('ENRICHMENT_REQUEST_CONTRACT_VIOLATION'),
      });
      return specialistFailure(envelope, {
        code: 'ENRICHMENT_REQUEST_CONTRACT_VIOLATION',
        message: requestCheck.errors.map((error) => `${error.path} ${error.message}`).join('; '),
        retryable: false,
      });
    }

    const response = await this.enrichment.enrich(request);
    if (response.status === 'ERROR' || response.resolution === null) {
      return specialistFailure(
        envelope,
        response.error ?? {
          code: 'ENRICHMENT_ERROR',
          message: 'Enrichment returned no resolution',
          retryable: true,
        },
      );
    }
    const responseCheck = this.schemas.validate(ENRICHMENT_OUTPUT_SCHEMA_ID, response.resolution);
    if (!responseCheck.valid) {
      return specialistFailure(envelope, {
        code: 'ENRICHMENT_RESPONSE_CONTRACT_VIOLATION',
        message: responseCheck.errors.map((error) => `${error.path} ${error.message}`).join('; '),
        retryable: false,
      });
    }
    return specialistSuccess(envelope, toEnrichmentResolution(response.resolution));
  }

  async buildRequest(
    input: TurnInputState,
    csre: CSREResolution,
    csreRequestId: string,
    purpose: DownstreamPurpose,
    options: { requestId?: string } = {},
  ): Promise<EnrichmentServiceRequest> {
    // The persisted rows carry the exact wire objects CSRE emitted (§28.2 "each item MUST be a
    // valid CSRE v5.0 object"); fall back to a projection of the in-memory resolution.
    const persisted = await this.semantics.objectsForRequest(csreRequestId).catch(() => []);
    const objects: Readonly<Record<string, unknown>>[] =
      persisted.length > 0 ? persisted.map((object) => object.object) : csre.objects.map(projectObject);

    return {
      schemaVersion: '4.1',
      requestId: options.requestId ?? newRequestId(),
      component: 'ENRICHMENT',
      componentVersion: componentVersion('ENRICHMENT'),
      conversationId: input.conversationId,
      turnId: input.turnId,
      runId: input.runId,
      contextSnapshotId: input.contextSnapshotId,
      sourceResolution: {
        resolver: 'CSRE',
        componentVersion: componentVersion('CSRE'),
        wireSchemaVersion: '5.0',
        resolutionRequestId: csreRequestId,
      },
      objects,
      relationships: csre.objects.flatMap((object) =>
        object.relationships.map((relationship) => ({
          type: relationship.type,
          objects: relationship.objects,
          context: relationship.context,
        })),
      ),
      messageContext: {
        original_message: csre.originalMessage,
        functional_context: csre.context.functionalContext,
        venues: csre.context.venues.map((venue) => ({
          expression: venue.expression,
          canonical_venue: venue.canonicalVenue,
          venue_type: venue.venueType,
        })),
        qualifiers: csre.context.qualifiers,
        regional_context: {
          country: csre.context.regionalContext.country,
          region: csre.context.regionalContext.region,
          regional_terms: csre.context.regionalContext.regionalTerms,
        },
        location_context: csre.context.locationContext,
      },
      downstreamPurpose: purpose,
      policyVersion: ENRICHMENT_POLICY_VERSION,
    };
  }
}

/** Camel domain object → CSRE wire object (used only when the persisted row is unavailable). */
function projectObject(object: CSREResolution['objects'][number]): Record<string, unknown> {
  return {
    object_id: object.objectId,
    semantic_origin: { ...object.semanticOrigin },
    surface_form: object.surfaceForm,
    canonical_form: object.canonicalForm,
    entity_type: object.entityType,
    definition: object.definition,
    brand: object.brand,
    model: object.model,
    attributes: object.attributes,
    aliases: object.aliases,
    commercial_interpretation: {
      relevance: object.commercialInterpretation.relevance,
      commercial_offering: object.commercialInterpretation.commercialOffering,
      reason: object.commercialInterpretation.reason,
      confidence: object.commercialInterpretation.confidence,
    },
    confidence: {
      semantic_resolution: object.confidence.semanticResolution,
      commercial_relevance: object.confidence.commercialRelevance,
    },
    ambiguity: {
      present: object.ambiguity.present,
      remaining_candidates: object.ambiguity.remainingCandidates.map((candidate) => ({
        meaning: candidate.meaning,
        entity_type: candidate.entityType,
        definition: candidate.definition,
        plausibility: candidate.plausibility,
      })),
    },
    functional_context: object.functionalContext,
    relationships: object.relationships,
  };
}

export function toWireRequest(request: EnrichmentServiceRequest): Record<string, unknown> {
  return {
    schema_version: request.schemaVersion,
    request_id: request.requestId,
    component: request.component,
    component_version: request.componentVersion,
    conversation_id: request.conversationId,
    turn_id: request.turnId,
    context_snapshot_id: request.contextSnapshotId,
    source_resolution: {
      resolver: request.sourceResolution.resolver,
      component_version: request.sourceResolution.componentVersion,
      wire_schema_version: request.sourceResolution.wireSchemaVersion,
      resolution_request_id: request.sourceResolution.resolutionRequestId,
    },
    objects: request.objects,
    relationships: request.relationships,
    message_context: request.messageContext,
    downstream_purpose: request.downstreamPurpose,
    policy_version: request.policyVersion,
  };
}
