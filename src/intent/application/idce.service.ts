import { Inject, Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import { EVENT_PUBLISHER, type EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import { toCamelCaseKeys } from '../../platform/contracts/wire-casing';
import { RequestContextStore } from '../../platform/correlation/request-context';
import { correlatedEvent, PlatformEvents } from '../../platform/events/domain-event';
import { TRACE_RECORDER, type TraceRecorderPort } from '../../platform/observability/trace.port';
import { DEFAULT_MODEL_POLICY, type PromptDefinition } from '../../platform/prompt-runtime/prompt-definition';
import { PromptExecutor, type PromptOutcome } from '../../platform/prompt-runtime/prompt-executor';
import { loadPromptFile, PromptRegistry } from '../../platform/prompt-runtime/prompt-registry';
import { componentVersion } from '../../platform/registry/component-registry';
import { validateIdceInvariants } from '../domain/idce-invariants';
import {
  IDCE_OUTPUT_SCHEMA_ID,
  IDCE_PROMPT_ID,
  IDCE_PROMPT_VERSION,
  IDCE_REQUEST_SCHEMA_ID,
  IDCE_RESPONSE_SCHEMA_ID,
  idceIdempotencyKey,
  type IDCEInvocationStatus,
  type IDCEResolution,
  type IDCEServiceRequest,
  type IDCEServiceResponse,
} from '../domain/idce-resolution';
import { INTENT_TAXONOMY_GROUPS, INTENT_TAXONOMY_VERSION } from '../domain/intent-taxonomy';
import type { IntentDiscoveryPort } from '../ports/intent-discovery.port';
import {
  INTENT_RESOLUTION_REPOSITORY,
  type IntentResolutionRecord,
  type IntentResolutionRepositoryPort,
} from '../ports/intent-resolution.repository.port';
import resolutionSchema from '../schemas/idce-resolution-1.0.json';
import requestSchema from '../schemas/idce-service-request-v1.1.json';
import responseSchema from '../schemas/idce-service-response-v1.1.json';

const COMPONENT = 'IDCE';
const STAGE = 'discover';
const RESOLUTION_SCHEMA_VERSION = '1.0';

/**
 * Intent Discovery & Classification Engine v1.6 (IDCE TDR).
 *
 * Answers "what is the user trying to accomplish?" for one logical turn and nothing else:
 * no referent resolution, no taxonomy, no routing decision, no business mutation (§2.2). Every
 * invocation goes through the shared prompt runtime — pinned prompt + executable schema +
 * semantic invariants + one bounded repair — and is persisted with its versions (§18.3, §21, §25).
 */
@Injectable()
export class IdceService implements IntentDiscoveryPort {
  private definition: PromptDefinition | null = null;

  constructor(
    @Inject(INTENT_RESOLUTION_REPOSITORY) private readonly resolutions: IntentResolutionRepositoryPort,
    @Inject(TRACE_RECORDER) private readonly traces: TraceRecorderPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly prompts: PromptRegistry,
    private readonly schemas: SchemaRegistry,
    private readonly executor: PromptExecutor,
    private readonly config: AppConfigService,
  ) {}

  /** Registers the IDCE contracts (idempotent). */
  register(): PromptDefinition {
    if (this.definition !== null) return this.definition;
    this.schemas.register(resolutionSchema as Record<string, unknown>, {
      version: RESOLUTION_SCHEMA_VERSION,
    });
    this.schemas.register(requestSchema as Record<string, unknown>, { version: '1.1' });
    this.schemas.register(responseSchema as Record<string, unknown>, { version: '1.1' });
    this.definition = this.prompts.register({
      id: IDCE_PROMPT_ID,
      version: IDCE_PROMPT_VERSION,
      component: 'IDCE',
      schemaId: IDCE_OUTPUT_SCHEMA_ID,
      system: loadPromptFile(join(__dirname, '..', 'prompts', 'idce.master.md')),
      sections: [
        'intent-taxonomy',
        'policy',
        'conversation-context',
        'active-workflows',
        'suspended-workflows',
        'prior-intent-state',
        'semantic-objects',
        'location-context',
        'venue-context',
        'user-role',
        'previous-turn-summary',
        'current-messages',
        'assembled-text',
      ],
      modelPolicy: { ...DEFAULT_MODEL_POLICY, model: this.config.specialistModel, maxOutputTokens: 2_000 },
      description: 'Discovers and classifies every materially distinct user objective in a logical turn.',
    });
    return this.definition;
  }

  async discover(request: IDCEServiceRequest): Promise<IDCEServiceResponse> {
    const definition = this.register();
    const revision = request.understandingRevision ?? 0;
    const idempotencyKey = idceIdempotencyKey(request.conversationId, request.turnId, revision);

    // §21 / §22.4 rule 2: the same turn + snapshot + versions is idempotent — no second model call
    // and no duplicate persistent intent record.
    const existing = await this.resolutions.findByIdempotencyKey(idempotencyKey);
    if (
      existing !== null &&
      existing.status === 'SUCCESS' &&
      existing.resolution !== null &&
      existing.contextSnapshotId === request.contextSnapshotId &&
      existing.promptVersion === definition.version &&
      existing.schemaVersion === RESOLUTION_SCHEMA_VERSION
    ) {
      return this.envelope(request, existing.resolution as Record<string, unknown>, null);
    }

    const parent = RequestContextStore.current();
    return RequestContextStore.resume(
      {
        correlationId: parent?.correlationId,
        requestId: request.requestId,
        parentRequestId: parent?.requestId ?? null,
        component: COMPONENT,
        conversationId: request.conversationId,
        turnId: request.turnId,
        runId: request.runId,
        messageId: parent?.messageId ?? null,
      },
      () => this.run(request, definition, idempotencyKey, revision),
    );
  }

  private async run(
    request: IDCEServiceRequest,
    definition: PromptDefinition,
    idempotencyKey: string,
    revision: number,
  ): Promise<IDCEServiceResponse> {
    const startedAt = this.clock.now();
    const turn = request.logicalTurn;
    const context = turn.contextSnapshot;

    await this.traces.startStep({
      runId: request.runId,
      requestId: request.requestId,
      parentRequestId: RequestContextStore.current()?.parentRequestId ?? null,
      correlationId: RequestContextStore.current()?.correlationId ?? `corr_${request.requestId}`,
      conversationId: request.conversationId,
      turnId: request.turnId,
      component: COMPONENT,
      componentVersion: componentVersion('IDCE'),
      stage: STAGE,
      schemaVersion: RESOLUTION_SCHEMA_VERSION,
      startedAt,
      inputSummary: {
        assembled_text: turn.assembledText,
        message_count: turn.currentMessages.length,
        assembly_reason: turn.assemblyReason,
        semantic_objects: context.semanticObjects.length,
        active_workflows: context.activeWorkflows.length,
        user_role: context.userRole,
      },
    });

    const outcome: PromptOutcome<Record<string, unknown>> = await this.executor.execute({
      definition,
      sections: [
        {
          name: 'intent-taxonomy',
          content: { version: INTENT_TAXONOMY_VERSION, groups: INTENT_TAXONOMY_GROUPS },
        },
        {
          name: 'policy',
          content: {
            policy_version: request.policyVersion,
            prompt_version: definition.version,
            schema_version: RESOLUTION_SCHEMA_VERSION,
            channel: context.channel,
            assembly_reason: turn.assemblyReason,
          },
        },
        { name: 'conversation-context', content: context.recentMessages },
        { name: 'active-workflows', content: context.activeWorkflows },
        { name: 'suspended-workflows', content: context.suspendedWorkflows },
        { name: 'prior-intent-state', content: context.priorIntentState },
        { name: 'semantic-objects', content: context.semanticObjects },
        { name: 'location-context', content: context.locationContext },
        { name: 'venue-context', content: context.venueContext },
        { name: 'user-role', content: context.userRole },
        { name: 'previous-turn-summary', content: turn.previousTurnSummary },
        { name: 'current-messages', content: turn.currentMessages },
        { name: 'assembled-text', content: turn.assembledText },
      ],
      task: 'Discover every materially distinct user objective in the current logical turn and return the IDCE resolution.',
      semanticValidator: validateIdceInvariants,
      decisionSummary: (output) => summarize(output as Record<string, unknown>),
    });

    const latencyMs = this.clock.now().getTime() - startedAt.getTime();

    if (outcome.status !== 'SUCCESS') {
      const status: IDCEInvocationStatus =
        outcome.status === 'PROVIDER_FAILURE'
          ? 'TEMPORARY_FAILURE'
          : outcome.status === 'SCHEMA_FAILURE'
            ? 'SCHEMA_FAILURE'
            : 'POLICY_FAILURE';
      const error = { code: outcome.error.code, message: outcome.error.message };

      await this.persist(
        request,
        idempotencyKey,
        revision,
        status,
        null,
        outcome.execution.id,
        outcome.execution.modelProvider,
        outcome.execution.modelName,
        latencyMs,
        error,
      );
      await this.traces.finishStep({
        requestId: request.requestId,
        status: 'ERROR',
        completedAt: this.clock.now(),
        decision: { status },
        outputSummary: null,
        persistedRecordIds: [],
        promptExecutionIds: [outcome.execution.id],
        retryCount: Math.max(0, outcome.execution.providerAttempts - 1),
        error: { ...error, retryable: outcome.error.retryable },
      });
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { requestId: request.requestId, turnId: request.turnId },
        action: `Intent discovery failed with ${status}; returning a typed ERROR envelope (never a fabricated intent)`,
        error: new Error(error.message),
      });
      return this.envelope(request, null, { ...error, retryable: outcome.error.retryable });
    }

    // Authoritative version stamps (the model copies them, the runtime owns them).
    const wire: Record<string, unknown> = {
      ...outcome.data,
      model_metadata: { prompt_version: definition.version, schema_version: RESOLUTION_SCHEMA_VERSION },
    };
    const summary = summarize(wire);

    const record = await this.persist(
      request,
      idempotencyKey,
      revision,
      'SUCCESS',
      wire,
      outcome.execution.id,
      outcome.execution.modelProvider,
      outcome.execution.modelName,
      latencyMs,
      null,
    );

    await this.events.publish(
      correlatedEvent({
        eventId: this.ids.uuid(),
        eventType: PlatformEvents.IntentResolved,
        producer: COMPONENT,
        occurredAt: this.clock.now(),
        payload: {
          requestId: request.requestId,
          turnId: request.turnId,
          intentResolutionId: record.id,
          ...summary,
        },
        conversationId: request.conversationId,
        turnId: request.turnId,
        runId: request.runId,
        aggregate: { type: 'IntentResolution', id: record.id },
      }),
    );

    await this.traces.finishStep({
      requestId: request.requestId,
      status: 'SUCCESS',
      completedAt: this.clock.now(),
      decision: summary,
      outputSummary: {
        intent_count: summary.intents.length,
        clarification_required: summary.clarification_required,
      },
      persistedRecordIds: [record.id],
      promptExecutionIds: [outcome.execution.id],
      retryCount: Math.max(0, outcome.execution.providerAttempts - 1),
      error: null,
    });

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { requestId: request.requestId, turnId: request.turnId, text: turn.assembledText },
      action: `Resolved ${summary.intents.length} intent(s) (${summary.resolution_status})`,
      output: summary,
      durationMs: latencyMs,
    });

    return this.envelope(request, wire, null);
  }

  private async persist(
    request: IDCEServiceRequest,
    idempotencyKey: string,
    revision: number,
    status: IDCEInvocationStatus,
    wire: Record<string, unknown> | null,
    promptExecutionId: string,
    modelProvider: string | null,
    modelName: string | null,
    latencyMs: number,
    error: { code: string; message: string } | null,
  ): Promise<IntentResolutionRecord> {
    const summary = wire === null ? null : summarize(wire);
    return this.resolutions.save({
      requestId: request.requestId,
      idempotencyKey: status === 'SUCCESS' ? idempotencyKey : `${idempotencyKey}:failed:${request.requestId}`,
      conversationId: request.conversationId,
      turnId: request.turnId,
      runId: request.runId,
      contextSnapshotId: request.contextSnapshotId,
      understandingRevision: revision,
      componentVersion: componentVersion('IDCE'),
      promptId: IDCE_PROMPT_ID,
      promptVersion: IDCE_PROMPT_VERSION,
      schemaVersion: RESOLUTION_SCHEMA_VERSION,
      policyVersion: request.policyVersion,
      status,
      resolutionStatus: summary?.resolution_status ?? null,
      resolution: wire,
      primaryIntentType: summary?.intents.find((intent) => intent.role === 'PRIMARY')?.type ?? null,
      intentTypes: summary?.intents.map((intent) => intent.type) ?? [],
      clarificationRequired: summary?.clarification_required ?? false,
      promptExecutionId,
      modelProvider,
      modelName,
      latencyMs,
      error,
    });
  }

  private envelope(
    request: IDCEServiceRequest,
    wire: Record<string, unknown> | null,
    error: { code: string; message: string; retryable: boolean } | null,
  ): IDCEServiceResponse {
    const resolution = wire === null ? null : toResolution(wire);
    return {
      schemaVersion: '1.1',
      requestId: request.requestId,
      component: 'IDCE',
      componentVersion: componentVersion('IDCE'),
      conversationId: request.conversationId,
      turnId: request.turnId,
      runId: request.runId,
      status: error !== null ? 'ERROR' : resolution?.resolutionStatus === 'PARTIAL' ? 'PARTIAL' : 'SUCCESS',
      resolution,
      error,
    };
  }
}

/** Wire → camelCase, preserving free-form constraint values untouched (they are user data, not contract keys). */
function toResolution(wire: Record<string, unknown>): IDCEResolution {
  const camel = toCamelCaseKeys<IDCEResolution>(wire);
  const wireIntents = (wire.intents as Array<{ constraints?: Array<{ value: unknown }> }>) ?? [];
  return {
    ...camel,
    intents: camel.intents.map((intent, index) => ({
      ...intent,
      constraints: intent.constraints.map((constraint, cIndex) => ({
        ...constraint,
        value: wireIntents[index]?.constraints?.[cIndex]?.value ?? constraint.value,
      })),
    })),
  };
}

interface DecisionSummary {
  resolution_status: string;
  intents: Array<{
    intent_id: string;
    type: string;
    role: string;
    status: string;
    confidence: number;
    object_ids: string[];
  }>;
  clarification_required: boolean;
  relations: number;
}

function summarize(wire: Record<string, unknown>): DecisionSummary {
  const intents = (wire.intents as Array<Record<string, unknown>>) ?? [];
  const clarification = wire.clarification as { required?: boolean } | null;
  return {
    resolution_status: String(wire.resolution_status),
    intents: intents.map((intent) => ({
      intent_id: String(intent.intent_id),
      type: String(intent.type),
      role: String(intent.role),
      status: String(intent.status),
      confidence: Number(intent.confidence),
      object_ids: ((intent.scope as { object_ids?: string[] } | undefined)?.object_ids ?? []) as string[],
    })),
    clarification_required: clarification?.required === true,
    relations: ((wire.relations as unknown[]) ?? []).length,
  };
}

export { IDCE_REQUEST_SCHEMA_ID, IDCE_RESPONSE_SCHEMA_ID };
