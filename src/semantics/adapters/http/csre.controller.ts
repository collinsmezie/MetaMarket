import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { SchemaRegistry } from '../../../platform/contracts/schema-registry';
import { RequestContextStore, runIdForTurn } from '../../../platform/correlation/request-context';
import { CSRE_REQUEST_SCHEMA_ID, type CSREServiceRequest } from '../../domain/csre-resolution';
import { SEMANTIC_RESOLUTION, type SemanticResolutionPort } from '../../ports/semantic-resolution.port';

/**
 * Component-mode API for CSRE (Overarching §24.1 `POST /v1/csre/resolve`, §27.3 Component Mode).
 *
 * Accepts the canonical snake_case service request (5.1), validates it against the executable
 * schema and returns the service response with the validated `csre-resolution-v5` payload. The
 * free-form context blocks are passed to the model exactly as supplied.
 */
@Controller('v1/csre')
export class CsreController {
  constructor(
    @Inject(SEMANTIC_RESOLUTION) private readonly csre: SemanticResolutionPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@Body() body: unknown): Promise<Record<string, unknown>> {
    const check = this.schemas.validate(CSRE_REQUEST_SCHEMA_ID, body);
    if (!check.valid) {
      throw new BadRequestException({
        code: 'CSRE_REQUEST_CONTRACT_VIOLATION',
        errors: check.errors.slice(0, 20),
      });
    }

    const wire = body as Record<string, unknown>;
    const turnId = String(wire.turn_id);
    const request: CSREServiceRequest = {
      schemaVersion: '5.1',
      requestId: String(wire.request_id),
      component: 'CSRE',
      componentVersion: String(wire.component_version),
      conversationId: String(wire.conversation_id),
      turnId,
      runId: runIdForTurn(turnId),
      contextSnapshotId: String(wire.context_snapshot_id),
      message: String(wire.message),
      currentMessages: ((wire.current_messages as Array<Record<string, unknown>>) ?? []).map((message) => ({
        messageId: String(message.message_id),
        text: String(message.text),
        receivedAt: String(message.received_at),
        interactivePayload: (message.interactive_payload as string | null | undefined) ?? null,
      })),
      conversationContext: wire.conversation_context as Record<string, unknown>,
      regionalContext: wire.regional_context as Record<string, unknown>,
      commercialContext: wire.commercial_context as Record<string, unknown>,
      lexiconEvidence: wire.lexicon_evidence as Record<string, unknown>[],
      externalEvidence: wire.external_evidence as Record<string, unknown>[],
      clarificationAnswers: wire.clarification_answers as Record<string, unknown>[],
      policyVersion: String(wire.policy_version),
    };

    const response = await RequestContextStore.extend(
      {
        conversationId: request.conversationId,
        turnId: request.turnId,
        runId: request.runId,
        component: 'CSRE_API',
      },
      () => this.csre.resolve(request),
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
