import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { SchemaRegistry } from '../../../platform/contracts/schema-registry';
import { RequestContextStore, runIdForTurn } from '../../../platform/correlation/request-context';
import {
  WRS_REQUEST_SCHEMA_ID,
  type WrsConsumerComponent,
  type WrsServiceRequest,
} from '../../domain/wrs-evidence';
import { WEB_RETRIEVAL, type WebRetrievalPort } from '../../ports/web-retrieval.port';

type Wire = Record<string, unknown>;

/**
 * Component-mode API for WRS (Overarching §24.1 `POST /v1/wrs/retrieve`). Accepts the
 * `wrs-request-v4` wire; correlation fields are optional and minted when absent.
 */
@Controller('v1/wrs')
export class WrsController {
  constructor(
    @Inject(WEB_RETRIEVAL) private readonly wrs: WebRetrievalPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  @Post('retrieve')
  @HttpCode(HttpStatus.OK)
  async retrieve(@Body() body: unknown): Promise<Wire> {
    const check = this.schemas.validate(WRS_REQUEST_SCHEMA_ID, body);
    if (!check.valid) {
      throw new BadRequestException({
        code: 'WRS_REQUEST_CONTRACT_VIOLATION',
        errors: check.errors.slice(0, 20),
      });
    }
    const wire = body as Wire;
    const consumer = wire.consumer as Wire;
    const evidenceRequest = wire.evidence_request as Wire;
    const target = evidenceRequest.relationship_target as Wire | null;
    // Component mode mints correlation ids when absent (Overarching §27.3); outbox columns are UUIDs.
    const conversationId =
      typeof wire.conversation_id === 'string' ? wire.conversation_id : crypto.randomUUID();
    const turnId = typeof wire.turn_id === 'string' ? wire.turn_id : crypto.randomUUID();
    const request: WrsServiceRequest = {
      schemaVersion: '4.0',
      requestId: String(wire.request_id),
      consumer: {
        component: String(consumer.component) as WrsConsumerComponent,
        version: String(consumer.version),
        purpose: String(consumer.purpose),
      },
      question: String(evidenceRequest.question),
      context: (evidenceRequest.context as Wire) ?? {},
      candidates: ((evidenceRequest.candidates as Wire[]) ?? []).map((candidate) => ({
        candidateId: String(candidate.candidate_id),
        label: String(candidate.label),
        description: (candidate.description as string | null) ?? null,
      })),
      relationshipTarget:
        target === null || target === undefined
          ? null
          : {
              subjectId: (target.subject_id as string | null) ?? null,
              predicate: (target.predicate as string | null) ?? null,
              objectId: (target.object_id as string | null) ?? null,
              objectType: (target.object_type as string | null) ?? null,
            },
      evidenceRequirements: ((evidenceRequest.evidence_requirements as unknown[]) ?? []).map(String),
      requestedFields: ((evidenceRequest.requested_fields as unknown[]) ?? []).map(String),
      outputContract: (evidenceRequest.output_contract as Wire) ?? {},
      conversationId,
      turnId,
      runId: runIdForTurn(turnId),
      contextSnapshotId: typeof wire.context_snapshot_id === 'string' ? wire.context_snapshot_id : null,
    };
    const response = await RequestContextStore.extend(
      {
        conversationId,
        turnId,
        runId: runIdForTurn(turnId),
        component: 'WRS_API',
      },
      () => this.wrs.retrieve(request),
    );
    return {
      request_id: response.requestId,
      component: response.component,
      component_version: response.componentVersion,
      status: response.status,
      response: response.response,
      error: response.error,
    };
  }
}
