import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { SchemaRegistry } from '../../../platform/contracts/schema-registry';
import { RequestContextStore, runIdForTurn } from '../../../platform/correlation/request-context';
import { GPC_REQUEST_SCHEMA_ID, type GpcResolverServiceRequest } from '../../domain/gpc-mapping';
import { GPC_RESOLUTION, type GpcResolutionPort } from '../../ports/gpc-resolution.port';

/**
 * Component-mode API for the GPC Resolver (Overarching §24.1 `POST /v1/gpc/resolve`, §27.3).
 * `conversation_id`/`turn_id`/`context_snapshot_id` are accepted as optional correlation; component
 * mode mints them when absent.
 */
@Controller('v1/gpc')
export class GpcResolverController {
  constructor(
    @Inject(GPC_RESOLUTION) private readonly gpc: GpcResolutionPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@Body() body: unknown): Promise<Record<string, unknown>> {
    const check = this.schemas.validate(GPC_REQUEST_SCHEMA_ID, body);
    if (!check.valid)
      throw new BadRequestException({
        code: 'GPC_REQUEST_CONTRACT_VIOLATION',
        errors: check.errors.slice(0, 20),
      });
    const wire = body as Record<string, unknown>;
    const turnId = String(wire.turn_id ?? crypto.randomUUID());
    const request: GpcResolverServiceRequest = {
      schemaVersion: '4.0',
      requestId: String(wire.request_id),
      resolverVersion: String(wire.resolver_version),
      conversationId: String(wire.conversation_id ?? crypto.randomUUID()),
      turnId,
      runId: runIdForTurn(turnId),
      contextSnapshotId: String(wire.context_snapshot_id ?? 'component-mode'),
      objects: wire.objects as Record<string, unknown>[],
      messageContext: (wire.message_context as Record<string, unknown>) ?? {},
      enrichment: (wire.enrichment as Record<string, unknown>) ?? {},
      marketKnowledge: (wire.market_knowledge as Record<string, unknown>[]) ?? [],
      evidence: (wire.evidence as Record<string, unknown>[]) ?? [],
      gpcCandidates: (wire.gpc_candidates as Record<string, unknown>[]) ?? [],
      resolutionPolicy: (wire.resolution_policy as Record<string, unknown>) ?? {},
    };
    const response = await RequestContextStore.extend(
      {
        conversationId: request.conversationId,
        turnId: request.turnId,
        runId: request.runId,
        component: 'GPC_API',
      },
      () => this.gpc.resolve(request),
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
