import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { SchemaRegistry } from '../../../platform/contracts/schema-registry';
import { RequestContextStore, runIdForTurn } from '../../../platform/correlation/request-context';
import {
  ENRICHMENT_REQUEST_SCHEMA_ID,
  type DownstreamPurpose,
  type EnrichmentServiceRequest,
} from '../../domain/enrichment-resolution';
import { SEMANTIC_ENRICHMENT, type SemanticEnrichmentPort } from '../../ports/semantic-enrichment.port';

/**
 * Component-mode API for Enrichment (Overarching §24.1 `POST /v1/enrichment/resolve`, §27.3).
 * Accepts the canonical snake_case 4.1 request and returns the service response with the
 * validated `enrichment-resolution-v4` payload.
 */
@Controller('v1/enrichment')
export class EnrichmentController {
  constructor(
    @Inject(SEMANTIC_ENRICHMENT) private readonly enrichment: SemanticEnrichmentPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@Body() body: unknown): Promise<Record<string, unknown>> {
    const check = this.schemas.validate(ENRICHMENT_REQUEST_SCHEMA_ID, body);
    if (!check.valid) {
      throw new BadRequestException({
        code: 'ENRICHMENT_REQUEST_CONTRACT_VIOLATION',
        errors: check.errors.slice(0, 20),
      });
    }
    const wire = body as Record<string, unknown>;
    const source = wire.source_resolution as Record<string, unknown>;
    const turnId = String(wire.turn_id);
    const request: EnrichmentServiceRequest = {
      schemaVersion: '4.1',
      requestId: String(wire.request_id),
      component: 'ENRICHMENT',
      componentVersion: String(wire.component_version),
      conversationId: String(wire.conversation_id),
      turnId,
      runId: runIdForTurn(turnId),
      contextSnapshotId: String(wire.context_snapshot_id),
      sourceResolution: {
        resolver: 'CSRE',
        componentVersion: String(source.component_version),
        wireSchemaVersion: '5.0',
        resolutionRequestId: String(source.resolution_request_id),
      },
      objects: wire.objects as Record<string, unknown>[],
      relationships: (wire.relationships as Record<string, unknown>[]) ?? [],
      messageContext: (wire.message_context as Record<string, unknown>) ?? {},
      downstreamPurpose: String(wire.downstream_purpose) as DownstreamPurpose,
      policyVersion: String(wire.policy_version),
      ...(Array.isArray(wire.available_evidence)
        ? { availableEvidence: wire.available_evidence as Record<string, unknown>[] }
        : {}),
    };

    const response = await RequestContextStore.extend(
      {
        conversationId: request.conversationId,
        turnId: request.turnId,
        runId: request.runId,
        component: 'ENRICHMENT_API',
      },
      () => this.enrichment.enrich(request),
    );

    return {
      request_id: response.requestId,
      component: response.component,
      component_version: response.componentVersion,
      conversation_id: response.conversationId,
      turn_id: response.turnId,
      run_id: response.runId,
      status: response.status,
      resolution: response.resolution,
      error: response.error,
    };
  }
}
