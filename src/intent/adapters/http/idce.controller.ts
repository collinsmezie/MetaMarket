import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { SchemaRegistry } from '../../../platform/contracts/schema-registry';
import { toCamelCaseKeys, toSnakeCaseKeys } from '../../../platform/contracts/wire-casing';
import { RequestContextStore } from '../../../platform/correlation/request-context';
import { IDCE_REQUEST_SCHEMA_ID, type IDCEServiceRequest } from '../../domain/idce-resolution';
import { INTENT_DISCOVERY, type IntentDiscoveryPort } from '../../ports/intent-discovery.port';

/**
 * Component-mode API for IDCE (Overarching §24.1 `POST /v1/idce/resolve`, §27.3 Component Mode).
 *
 * Accepts the canonical snake_case IDCE service request (envelope 1.1), validates it against the
 * executable schema, and returns the snake_case service response. Exists so Live Test Mode can
 * exercise the specialist directly and inspect its persisted resolution and prompt execution.
 */
@Controller('v1/idce')
export class IdceController {
  constructor(
    @Inject(INTENT_DISCOVERY) private readonly idce: IntentDiscoveryPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  @Post('resolve')
  @HttpCode(HttpStatus.OK)
  async resolve(@Body() body: unknown): Promise<Record<string, unknown>> {
    const check = this.schemas.validate(IDCE_REQUEST_SCHEMA_ID, body);
    if (!check.valid) {
      throw new BadRequestException({
        code: 'IDCE_REQUEST_CONTRACT_VIOLATION',
        errors: check.errors.slice(0, 20),
      });
    }

    const request = toCamelCaseKeys<IDCEServiceRequest>(body);
    const response = await RequestContextStore.extend(
      {
        conversationId: request.conversationId,
        turnId: request.turnId,
        runId: request.runId,
        component: 'IDCE_API',
      },
      () => this.idce.discover(request),
    );

    return toSnakeCaseKeys<Record<string, unknown>>(response);
  }
}
