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
import { newRequestId } from '../../platform/correlation/request-context';
import {
  CSRE_OUTPUT_SCHEMA_ID,
  CSRE_POLICY_VERSION,
  CSRE_REQUEST_SCHEMA_ID,
  toCsreResolution,
  type CSREResolution,
  type CSREServiceRequest,
} from '../domain/csre-resolution';
import { SEMANTIC_GROUNDING, type SemanticGroundingPort } from '../ports/semantic-grounding.port';
import { SEMANTIC_RESOLUTION, type SemanticResolutionPort } from '../ports/semantic-resolution.port';

const COMPONENT = 'MCOS';
const STAGE = 'CsreAdapter';
const RECENT_MESSAGES = 10;

/**
 * MCOS-side typed adapter for CSRE (CSRE TDR §31.2–§31.3; MCOS §63.3, §65.2).
 *
 * Canonical transformation `LogicalTurnInput → CSREServiceRequest`: assembled text → `message`,
 * current messages → `current_messages`, working context → `conversation_context` /
 * `regional_context` / `commercial_context`, observed market language → `lexicon_evidence`,
 * pending clarification answered by this turn → `clarification_answers`. Injects the deployed
 * component version, preserves every correlation id, validates request and response against the
 * executable schemas and never repairs a semantic response by guessing (§31.3).
 */
@Injectable()
export class CsreSpecialistAdapter {
  constructor(
    @Inject(SEMANTIC_RESOLUTION) private readonly csre: SemanticResolutionPort,
    @Inject(SEMANTIC_GROUNDING) private readonly grounding: SemanticGroundingPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  async resolve(
    input: TurnInputState,
    context: ConversationWorkingContext,
    options: { understandingRevision?: number; requestId?: string } = {},
  ): Promise<SpecialistResponseEnvelope<CSREResolution>> {
    const request = await this.buildRequest(input, context, options);
    const envelope = specialistRequest<CSREServiceRequest>(
      'CSRE',
      '5.1',
      {
        conversationId: input.conversationId,
        turnId: input.turnId,
        runId: input.runId,
        contextSnapshotId: input.contextSnapshotId,
      },
      request,
      request.requestId,
    );

    const requestCheck = this.schemas.validate(CSRE_REQUEST_SCHEMA_ID, toWireRequest(request));
    if (!requestCheck.valid) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { turnId: input.turnId, errors: requestCheck.errors.slice(0, 5) },
        action: 'CSRE request failed contract validation before invocation',
        error: new Error('CSRE_REQUEST_CONTRACT_VIOLATION'),
      });
      return specialistFailure(envelope, {
        code: 'CSRE_REQUEST_CONTRACT_VIOLATION',
        message: requestCheck.errors.map((error) => `${error.path} ${error.message}`).join('; '),
        retryable: false,
      });
    }

    const response = await this.csre.resolve(request);

    if (response.status === 'ERROR' || response.resolution === null) {
      return specialistFailure(
        envelope,
        response.error ?? { code: 'CSRE_ERROR', message: 'CSRE returned no resolution', retryable: true },
      );
    }

    // §31.3: validate the v5 payload before projecting it into the MCOS envelope.
    const responseCheck = this.schemas.validate(CSRE_OUTPUT_SCHEMA_ID, response.resolution);
    if (!responseCheck.valid) {
      return specialistFailure(envelope, {
        code: 'CSRE_RESPONSE_CONTRACT_VIOLATION',
        message: responseCheck.errors.map((error) => `${error.path} ${error.message}`).join('; '),
        retryable: false,
      });
    }

    return specialistSuccess(envelope, toCsreResolution(response.resolution));
  }

  /** Canonical mapping MCOS LogicalTurnInput → CSRE request (§31.2). */
  async buildRequest(
    input: TurnInputState,
    context: ConversationWorkingContext,
    options: { understandingRevision?: number; requestId?: string } = {},
  ): Promise<CSREServiceRequest> {
    const locations = context.locations.map((location) => location.normalizedValue ?? location.value);
    const lexicon = await this.grounding.lexiconEvidence({
      conversationId: input.conversationId,
      message: input.assembledText,
      locations,
    });

    const pending = context.pendingClarification;
    const answersPending =
      pending !== null &&
      pending.originatingTurnId !== input.turnId &&
      (pending.status === 'WAITING_FOR_USER' || pending.status === 'ANSWER_RECEIVED');

    return {
      schemaVersion: '5.1',
      requestId: options.requestId ?? newRequestId(),
      component: 'CSRE',
      componentVersion: '5.4',
      conversationId: input.conversationId,
      turnId: input.turnId,
      runId: input.runId,
      contextSnapshotId: input.contextSnapshotId,
      message: input.assembledText,
      currentMessages: input.currentMessages.map((message) => ({
        messageId: message.messageId,
        text: message.text,
        receivedAt: message.receivedAt,
        interactivePayload: message.interactivePayload,
      })),
      conversationContext: {
        recent_messages: context.recentMessages.slice(-RECENT_MESSAGES).map((message) => ({
          role: message.role,
          text: message.text,
          created_at: message.createdAt,
        })),
        previous_turn_summary: input.previousTurnSummary,
        active_workflows: context.activeWorkflows.map(toWorkflowContext),
        suspended_workflows: context.suspendedWorkflows.map(toWorkflowContext),
        prior_semantic_objects: context.semanticObjects.map((object) => ({
          object_id: object.objectId,
          phrase: object.semanticOrigin.phrase,
          canonical_form: object.canonicalForm,
          entity_type: object.entityType,
          market_concept_id: object.semanticOrigin.market_concept_id,
        })),
        user_role: context.userRole,
      },
      regionalContext: {
        country: 'Nigeria',
        locations: context.locations.map((location) => ({
          value: location.value,
          normalized: location.normalizedValue,
          confidence: location.confidence,
        })),
        language_hints: ['en-NG', 'pcm'],
      },
      commercialContext: {
        user_role: context.userRole,
        vendor_id: context.vendorId,
        channel: input.channel,
        venues: context.venues.map((venue) => ({ value: venue.value, venue_type: venue.venueType })),
      },
      lexiconEvidence: lexicon.map((item) => ({
        phrase: item.phrase,
        concept: item.concept,
        market_concept_id: item.marketConceptId,
        geographic_scope: item.geographicScope,
        source_type: item.sourceType,
        confidence: item.confidence,
        evidence_ids: item.evidenceIds,
        last_observed_at: item.lastObservedAt,
      })),
      externalEvidence: [],
      clarificationAnswers: answersPending
        ? [
            {
              clarification_id: pending.clarificationId,
              question: pending.question,
              answer: input.assembledText,
              asked_at: pending.askedAt.toISOString(),
            },
          ]
        : [],
      policyVersion: CSRE_POLICY_VERSION,
      ...(options.understandingRevision !== undefined
        ? { understandingRevision: options.understandingRevision }
        : {}),
    };
  }
}

function toWorkflowContext(workflow: ConversationWorkingContext['activeWorkflows'][number]) {
  return {
    workflow_id: workflow.workflowId,
    workflow_type: workflow.workflowType,
    status: workflow.status,
    summary: workflow.summary,
    resumable: workflow.resumable,
  };
}

/** Snake_case wire request (§29.2); `run_id` and `understanding_revision` are orchestration-side. */
export function toWireRequest(request: CSREServiceRequest): Record<string, unknown> {
  return {
    schema_version: request.schemaVersion,
    request_id: request.requestId,
    component: request.component,
    component_version: request.componentVersion,
    conversation_id: request.conversationId,
    turn_id: request.turnId,
    context_snapshot_id: request.contextSnapshotId,
    message: request.message,
    current_messages: request.currentMessages.map((message) => ({
      message_id: message.messageId,
      text: message.text,
      received_at: message.receivedAt,
      interactive_payload: message.interactivePayload,
    })),
    conversation_context: request.conversationContext,
    regional_context: request.regionalContext,
    commercial_context: request.commercialContext,
    lexicon_evidence: request.lexiconEvidence,
    external_evidence: request.externalEvidence,
    clarification_answers: request.clarificationAnswers,
    policy_version: request.policyVersion,
  };
}
