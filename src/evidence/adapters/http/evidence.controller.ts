import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { SchemaRegistry } from '../../../platform/contracts/schema-registry';
import { RequestContextStore, runIdForTurn } from '../../../platform/correlation/request-context';
import { evidenceWire } from '../../application/evidence-query.service';
import {
  type ActorRole,
  EVIDENCE_OBSERVATION_SCHEMA_ID,
  EVIDENCE_REQUEST_SCHEMA_ID,
  type ObservationInput,
  type ObservationType,
} from '../../domain/evidence-model';
import { EVIDENCE_INTAKE, type EvidenceIntakePort } from '../../ports/evidence-intake.port';
import { EVIDENCE_QUERY, type EvidenceQueryPort } from '../../ports/evidence-query.port';

type Wire = Record<string, unknown>;

/**
 * Component-mode API for the Evidence System (Overarching §24.1 `POST /v1/evidence/ingest`;
 * Evidence TDR §30–§31 `POST /v1/evidence/retrieve`). `ingest` accepts one
 * `evidence-observation-v4`; `retrieve` accepts `evidence-request-v4` and answers with the
 * `evidence-response-v4` envelope.
 */
@Controller('v1/evidence')
export class EvidenceController {
  constructor(
    @Inject(EVIDENCE_INTAKE) private readonly intake: EvidenceIntakePort,
    @Inject(EVIDENCE_QUERY) private readonly query: EvidenceQueryPort,
    private readonly schemas: SchemaRegistry,
  ) {}

  @Post('ingest')
  @HttpCode(HttpStatus.OK)
  async ingest(@Body() body: unknown): Promise<Wire> {
    const check = this.schemas.validate(EVIDENCE_OBSERVATION_SCHEMA_ID, body);
    if (!check.valid)
      throw new BadRequestException({
        code: 'EVIDENCE_OBSERVATION_CONTRACT_VIOLATION',
        errors: check.errors.slice(0, 20),
      });
    const wire = body as Wire;
    const source = wire.source as Wire;
    const actor = (wire.actor ?? null) as Wire | null;
    const interaction = (wire.interaction ?? {}) as Wire;
    const context = (wire.context ?? {}) as Wire;
    const turnId = optional(interaction.turn_id);
    const observation: ObservationInput = {
      observationId: String(wire.observation_id),
      observationType: String(wire.observation_type) as ObservationType,
      source: {
        component: String(source.component),
        version: String(source.version),
        eventId: optional(source.event_id),
        requestId: optional(source.request_id),
      },
      actor: actor === null ? null : { id: String(actor.id), role: String(actor.role) as ActorRole },
      channel: optional(wire.channel),
      interaction: {
        conversationId: optional(interaction.conversation_id),
        turnId,
        runId: optional(interaction.run_id) ?? (turnId === null ? null : runIdForTurn(turnId)),
        workflowId: optional(interaction.workflow_id),
        actionId: optional(interaction.action_id),
        interactionId: optional(interaction.interaction_id),
      },
      observedAt: new Date(String(wire.observed_at)),
      context: { ...context, country: optional(context.country) ?? 'NG', region: optional(context.region) },
      payload: (wire.payload as Wire) ?? {},
      rawText: optional(wire.raw_text),
    };
    if (Number.isNaN(observation.observedAt.getTime()))
      throw new BadRequestException({
        code: 'EVIDENCE_OBSERVATION_CONTRACT_VIOLATION',
        errors: [{ path: '/observed_at', message: 'must be an ISO-8601 timestamp' }],
      });
    const result = await RequestContextStore.extend(
      {
        conversationId: observation.interaction.conversationId ?? crypto.randomUUID(),
        turnId: observation.interaction.turnId ?? crypto.randomUUID(),
        runId: observation.interaction.runId ?? `evidence:${observation.observationId}`,
        component: 'EVIDENCE_API',
      },
      () => this.intake.ingest(observation),
    );
    return {
      observation_id: result.observation.observationId,
      component: 'EVIDENCE',
      component_version: '4.4',
      status: result.error !== null ? 'ERROR' : result.duplicate ? 'DUPLICATE' : result.observation.status,
      duplicate: result.duplicate,
      evidence: result.evidence.map(evidenceWire),
      assertions: result.assertions.map((assertion) => ({
        assertion_id: assertion.assertionId,
        subject: assertion.assertion.subject,
        predicate: assertion.assertion.predicate,
        object: assertion.assertion.object,
        subject_label: assertion.subjectLabel,
        object_label: assertion.objectLabel,
        belief: assertion.belief,
        direction: assertion.direction,
        state: assertion.state,
        independent_source_count: assertion.independentSourceCount,
        evidence_count: assertion.evidenceCount,
        requires_more_evidence: assertion.requiresMoreEvidence,
      })),
      knowledge: result.knowledge.map((item) => ({
        knowledge_id: item.knowledgeId,
        type: item.type,
        state: item.state,
        confidence: item.confidence,
        claim: item.claim,
      })),
      graph_change_decisions: result.decisions.map((decision) => ({
        decision_id: decision.decisionId,
        operation: decision.operation,
        relevance_decision: decision.relevanceDecision,
        subject_id: decision.subjectId,
        predicate: decision.predicate,
        object_id: decision.objectId,
        belief_score: decision.beliefScore,
        reason_codes: decision.reasonCodes,
        evidence_ids: decision.evidenceIds,
        policy_version: decision.policyVersion,
      })),
      prompt_execution_ids: result.promptExecutionIds,
      error: result.error,
    };
  }

  @Post('retrieve')
  @HttpCode(HttpStatus.OK)
  async retrieve(@Body() body: unknown): Promise<Wire> {
    const check = this.schemas.validate(EVIDENCE_REQUEST_SCHEMA_ID, body);
    if (!check.valid)
      throw new BadRequestException({
        code: 'EVIDENCE_REQUEST_CONTRACT_VIOLATION',
        errors: check.errors.slice(0, 20),
      });
    const wire = body as Wire;
    const consumer = wire.consumer as Wire;
    const task = wire.task as Wire;
    const semantic = (wire.semantic_target ?? null) as Wire | null;
    const target = (wire.relationship_target ?? null) as Wire | null;
    const response = await this.query.retrieve({
      requestId: String(wire.request_id),
      consumer: { component: String(consumer.component), version: String(consumer.version) },
      task: { type: String(task.type), question: String(task.question ?? '') },
      objects: ((wire.objects as Wire[]) ?? []).map((object) => ({
        id: String(object.id),
        surfaceForm: String(object.surface_form),
        marketConceptId: optional(object.market_concept_id),
      })),
      semanticTarget:
        semantic === null ? null : { phrase: String(semantic.phrase), concept: optional(semantic.concept) },
      relationshipTarget:
        target === null
          ? null
          : {
              subjectId: optional(target.subject_id),
              predicate: optional(target.predicate),
              objectId: optional(target.object_id),
            },
      context: (wire.context as Wire) ?? {},
      candidateInterpretations: ((wire.candidate_interpretations as unknown[]) ?? []).map(String),
      requiredEvidence: ((wire.required_evidence as unknown[]) ?? []).map(String),
    });
    return response.response as Wire;
  }
}

function optional(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
