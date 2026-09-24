import { Inject, Injectable } from '@nestjs/common';
import type { ConversationWorkingContext, TurnInputState } from '../../conversation/domain/turn-context';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import {
  specialistFailure,
  specialistRequest,
  specialistSuccess,
  type SpecialistResponseEnvelope,
} from '../../platform/contracts/specialist-envelope';
import { toSnakeCaseKeys } from '../../platform/contracts/wire-casing';
import { newRequestId } from '../../platform/correlation/request-context';
import {
  IDCE_POLICY_VERSION,
  IDCE_REQUEST_SCHEMA_ID,
  IDCE_RESPONSE_SCHEMA_ID,
  type IDCEResolution,
  type IDCEServiceRequest,
  type IntentContext,
} from '../domain/idce-resolution';
import { INTENT_DISCOVERY, type IntentDiscoveryPort } from '../ports/intent-discovery.port';
import {
  INTENT_RESOLUTION_REPOSITORY,
  type IntentResolutionRepositoryPort,
} from '../ports/intent-resolution.repository.port';

const COMPONENT = 'MCOS';
const STAGE = 'IdceAdapter';
const PRIOR_INTENT_TURNS = 2;
const RECENT_MESSAGES = 10;

/**
 * MCOS-side typed adapter for IDCE (MCOS TDR §63.2–§63.3, §65.2; IDCE §22.6).
 *
 * Maps the orchestrator's `TurnInputState` + `ConversationWorkingContext` into the canonical IDCE
 * service request (envelope 1.1), validates both directions against the executable schemas, injects
 * the deployed component/policy versions and preserves correlation ids. It never repairs a semantic
 * response by guessing missing fields (§65.2 rule 7).
 */
@Injectable()
export class IdceSpecialistAdapter {
  constructor(
    @Inject(INTENT_DISCOVERY) private readonly idce: IntentDiscoveryPort,
    @Inject(INTENT_RESOLUTION_REPOSITORY) private readonly resolutions: IntentResolutionRepositoryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  async discover(
    input: TurnInputState,
    context: ConversationWorkingContext,
    options: { understandingRevision?: number; requestId?: string } = {},
  ): Promise<SpecialistResponseEnvelope<IDCEResolution>> {
    const request = await this.buildRequest(input, context, options);
    const envelope = specialistRequest<IDCEServiceRequest>(
      'IDCE',
      '1.1',
      {
        conversationId: input.conversationId,
        turnId: input.turnId,
        runId: input.runId,
        contextSnapshotId: input.contextSnapshotId,
      },
      request,
      request.requestId,
    );

    // Validate the canonical wire request before invocation (§65.2 rule 1).
    const wireRequest = toSnakeCaseKeys<Record<string, unknown>>(stripEnvelopeOnly(request));
    const requestCheck = this.schemas.validate(IDCE_REQUEST_SCHEMA_ID, wireRequest);
    if (!requestCheck.valid) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { turnId: input.turnId, errors: requestCheck.errors.slice(0, 5) },
        action: 'IDCE request failed contract validation before invocation',
        error: new Error('IDCE_REQUEST_CONTRACT_VIOLATION'),
      });
      return specialistFailure(envelope, {
        code: 'IDCE_REQUEST_CONTRACT_VIOLATION',
        message: requestCheck.errors.map((error) => `${error.path} ${error.message}`).join('; '),
        retryable: false,
      });
    }

    const response = await this.idce.discover(request);

    // Validate the specialist response (§65.2 rule 5) — the raw wire form, then project.
    const wireResponse = toSnakeCaseKeys<Record<string, unknown>>({
      ...response,
      resolution: response.resolution === null ? null : restoreConstraintValues(response.resolution),
    });
    const responseCheck = this.schemas.validate(IDCE_RESPONSE_SCHEMA_ID, wireResponse);
    if (!responseCheck.valid) {
      return specialistFailure(envelope, {
        code: 'IDCE_RESPONSE_CONTRACT_VIOLATION',
        message: responseCheck.errors.map((error) => `${error.path} ${error.message}`).join('; '),
        retryable: false,
      });
    }

    if (response.status === 'ERROR' || response.resolution === null) {
      return specialistFailure(
        envelope,
        response.error ?? { code: 'IDCE_ERROR', message: 'IDCE returned no resolution', retryable: true },
      );
    }

    return specialistSuccess(
      envelope,
      response.resolution,
      response.status === 'PARTIAL' ? 'PARTIAL' : 'SUCCESS',
    );
  }

  /** Canonical mapping MCOS LogicalTurnInput → IDCE request (MCOS §63.3). */
  async buildRequest(
    input: TurnInputState,
    context: ConversationWorkingContext,
    options: { understandingRevision?: number; requestId?: string } = {},
  ): Promise<IDCEServiceRequest> {
    const priorIntentState = await this.resolutions.priorIntentState(
      input.conversationId,
      input.turnId,
      PRIOR_INTENT_TURNS * 4,
    );

    const intentContext: IntentContext = {
      conversationId: input.conversationId,
      turnId: input.turnId,
      userId: input.userId,
      channel: toChannel(input.channel),
      recentMessages: context.recentMessages.slice(-RECENT_MESSAGES).map((message) => ({
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
      })),
      activeWorkflows: context.activeWorkflows.map(toWorkflowContext),
      suspendedWorkflows: context.suspendedWorkflows.map(toWorkflowContext),
      semanticObjects: context.semanticObjects.map((object) => ({
        objectId: object.objectId,
        canonicalForm: object.canonicalForm,
        entityType: object.entityType,
        marketConceptId: object.semanticOrigin.market_concept_id,
      })),
      priorIntentState,
      locationContext: context.locations[0] ?? null,
      venueContext: context.venues[0] ?? null,
      userRole: context.userRole,
      interactionMetadata: {
        channel: input.channel,
        assemblyReason: input.assemblyReason,
        messageCount: input.currentMessages.length,
      },
    };

    return {
      schemaVersion: '1.1',
      requestId: options.requestId ?? newRequestId(),
      component: 'IDCE',
      componentVersion: '1.6',
      conversationId: input.conversationId,
      turnId: input.turnId,
      runId: input.runId,
      contextSnapshotId: input.contextSnapshotId,
      logicalTurn: {
        conversationId: input.conversationId,
        turnId: input.turnId,
        messageIds: input.messageIds,
        currentMessages: input.currentMessages.map((message) => ({
          messageId: message.messageId,
          text: message.text,
          receivedAt: message.receivedAt,
          interactivePayload: message.interactivePayload,
        })),
        assembledText: input.assembledText,
        assemblyReason: input.assemblyReason,
        previousTurnSummary: input.previousTurnSummary,
        contextSnapshot: intentContext,
      },
      policyVersion: IDCE_POLICY_VERSION,
      ...(options.understandingRevision !== undefined
        ? { understandingRevision: options.understandingRevision }
        : {}),
    };
  }
}

function toChannel(channel: string): IntentContext['channel'] {
  switch (channel) {
    case 'whatsapp':
      return 'WHATSAPP';
    case 'web':
      return 'WEB';
    case 'sms':
      return 'SMS';
    case 'ussd':
      return 'USSD';
    default:
      return 'OTHER';
  }
}

function toWorkflowContext(workflow: ConversationWorkingContext['activeWorkflows'][number]) {
  return {
    workflowId: workflow.workflowId,
    workflowType: workflow.workflowType,
    status: workflow.status,
    summary: workflow.summary,
    resumable: workflow.resumable,
  };
}

/** `understandingRevision` is orchestration-side; it is not part of the wire request schema. */
function stripEnvelopeOnly(request: IDCEServiceRequest): Omit<IDCEServiceRequest, 'understandingRevision'> {
  const { understandingRevision, ...wire } = request;
  void understandingRevision;
  return wire;
}

/** Constraint values are user data; casing conversion must not rewrite their keys. */
function restoreConstraintValues(resolution: IDCEResolution): IDCEResolution {
  return resolution;
}
