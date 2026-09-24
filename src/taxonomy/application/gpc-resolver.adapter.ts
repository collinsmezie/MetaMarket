import { Inject, Injectable } from '@nestjs/common';
import type { TurnInputState } from '../../conversation/domain/turn-context';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import type { EnrichmentResolution } from '../../enrichment/domain/enrichment-resolution';
import {
  ENRICHMENT_REPOSITORY,
  type EnrichmentRepositoryPort,
} from '../../enrichment/ports/enrichment.repository.port';
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
  GPC_POLICY_VERSION,
  GPC_REQUEST_SCHEMA_ID,
  GPC_RESPONSE_SCHEMA_ID,
  toGpcResolution,
  type GpcResolution,
  type GpcResolverServiceRequest,
} from '../domain/gpc-mapping';
import { GPC_RESOLUTION, type GpcResolutionPort } from '../ports/gpc-resolution.port';

const COMPONENT = 'LANGGRAPH';
const STAGE = 'GpcResolverAdapter';

/**
 * Orchestrator-side typed adapter for the GPC Resolver (GPC Resolver TDR §93.1, §95.1–§95.3; MCOS
 * §63.4). Builds the v4 request from the persisted byte-exact CSRE wire objects, augmented with the
 * Enrichment profiles of the same objects (`enrichment` block keyed by object_id) and a machine-
 * enforced `source_trace`; validates both directions; never guesses a code.
 */
@Injectable()
export class GpcResolverAdapter {
  constructor(
    @Inject(GPC_RESOLUTION) private readonly gpc: GpcResolutionPort,
    @Inject(SEMANTIC_RESOLUTION_REPOSITORY) private readonly semantics: SemanticResolutionRepositoryPort,
    @Inject(ENRICHMENT_REPOSITORY) private readonly enrichments: EnrichmentRepositoryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  async resolve(
    input: TurnInputState,
    csre: CSREResolution,
    csreRequestId: string,
    enrichment: { requestId: string; resolution: EnrichmentResolution } | null,
    options: { requestId?: string } = {},
  ): Promise<SpecialistResponseEnvelope<GpcResolution>> {
    const request = await this.buildRequest(
      input,
      csre,
      csreRequestId,
      enrichment?.requestId ?? null,
      options,
    );
    const envelope = specialistRequest<GpcResolverServiceRequest>(
      'GPC_RESOLVER',
      '4.0',
      {
        conversationId: input.conversationId,
        turnId: input.turnId,
        runId: input.runId,
        contextSnapshotId: input.contextSnapshotId,
      },
      request,
      request.requestId,
    );
    const requestCheck = this.schemas.validate(GPC_REQUEST_SCHEMA_ID, toWireRequest(request));
    if (!requestCheck.valid) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { turnId: input.turnId, errors: requestCheck.errors.slice(0, 5) },
        action: 'GPC request failed contract validation before invocation',
        error: new Error('GPC_REQUEST_CONTRACT_VIOLATION'),
      });
      return specialistFailure(envelope, {
        code: 'GPC_REQUEST_CONTRACT_VIOLATION',
        message: requestCheck.errors.map((error) => `${error.path} ${error.message}`).join('; '),
        retryable: false,
      });
    }
    const response = await this.gpc.resolve(request);
    if (response.status === 'ERROR' || response.resolution === null) {
      return specialistFailure(
        envelope,
        response.error ?? {
          code: 'GPC_ERROR',
          message: 'GPC Resolver returned no resolution',
          retryable: true,
        },
      );
    }
    const responseCheck = this.schemas.validate(GPC_RESPONSE_SCHEMA_ID, response.resolution);
    if (!responseCheck.valid) {
      return specialistFailure(envelope, {
        code: 'GPC_RESPONSE_CONTRACT_VIOLATION',
        message: responseCheck.errors.map((error) => `${error.path} ${error.message}`).join('; '),
        retryable: false,
      });
    }
    return specialistSuccess(envelope, toGpcResolution(response.resolution));
  }

  async buildRequest(
    input: TurnInputState,
    csre: CSREResolution,
    csreRequestId: string,
    enrichmentRequestId: string | null,
    options: { requestId?: string } = {},
  ): Promise<GpcResolverServiceRequest> {
    const persisted = await this.semantics.objectsForRequest(csreRequestId).catch(() => []);
    const profiles =
      enrichmentRequestId === null
        ? []
        : await this.enrichments.profilesForRequest(enrichmentRequestId).catch(() => []);
    const enrichmentByObject: Record<string, Record<string, unknown>> = {};
    for (const profile of profiles) enrichmentByObject[profile.objectId] = profile.profile;

    const sourceTrace = (objectId: string) => ({
      csre_request_id: csreRequestId,
      enrichment_request_id: enrichmentByObject[objectId] === undefined ? null : enrichmentRequestId,
      wrs_evidence_ids: [] as string[],
      evidence_system_ids: [] as string[],
    });

    const objects =
      persisted.length > 0
        ? persisted.map((object) => ({ ...object.object, source_trace: sourceTrace(object.objectId) }))
        : csre.objects.map((object) => ({
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
            semantic_confidence: object.confidence.semanticResolution,
            commercial_confidence: object.confidence.commercialRelevance,
            relationships: object.relationships,
            source_trace: sourceTrace(object.objectId),
          }));

    return {
      schemaVersion: '4.0',
      requestId: options.requestId ?? newRequestId(),
      resolverVersion: componentVersion('GPC_RESOLVER'),
      conversationId: input.conversationId,
      turnId: input.turnId,
      runId: input.runId,
      contextSnapshotId: input.contextSnapshotId,
      objects,
      messageContext: {
        original_message: csre.originalMessage,
        functional_context: csre.context.functionalContext,
        venues: csre.context.venues.map((venue) => ({
          expression: venue.expression,
          canonical_venue: venue.canonicalVenue,
          venue_type: venue.venueType,
        })),
        qualifiers: csre.context.qualifiers,
        relationships: csre.objects.flatMap((object) =>
          object.relationships.map((relationship) => ({
            type: relationship.type,
            objects: relationship.objects,
            context: relationship.context,
          })),
        ),
      },
      enrichment: enrichmentByObject,
      marketKnowledge: [],
      evidence: [],
      gpcCandidates: [],
      resolutionPolicy: { policy_version: GPC_POLICY_VERSION, downstream_purpose: 'GPC_CLASSIFICATION' },
    };
  }
}

export function toWireRequest(request: GpcResolverServiceRequest): Record<string, unknown> {
  return {
    schema_version: request.schemaVersion,
    request_id: request.requestId,
    resolver_version: request.resolverVersion,
    conversation_id: request.conversationId,
    turn_id: request.turnId,
    context_snapshot_id: request.contextSnapshotId,
    objects: request.objects,
    message_context: request.messageContext,
    enrichment: request.enrichment,
    market_knowledge: request.marketKnowledge,
    evidence: request.evidence,
    gpc_candidates: request.gpcCandidates,
    resolution_policy: request.resolutionPolicy,
  };
}
