import { Inject, Injectable } from '@nestjs/common';
import { ConversationContextManager } from '../../application/conversation/conversation-context.manager';
import {
  WORKFLOW_SERVICES,
  type WorkflowServiceRegistry,
} from '../../application/pipeline/workflow-services';
import type { Artifact } from '../../domain/models/artifact';
import type { Conversation } from '../../domain/models/conversation';
import type { Response } from '../../domain/models/response';
import type {
  ConversationRelationship,
  IntentResult,
  SemanticRequest,
} from '../../domain/models/understanding';
import { canResume, type WorkflowInstance } from '../../domain/models/workflow-instance';
import {
  ConversationEvents,
  EVENT_PUBLISHER,
  type EventPublisherPort,
} from '../../domain/ports/outbound/event-publisher.port';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../../domain/ports/outbound/embedding-provider.port';
import {
  MESSAGE_REPOSITORY,
  type MessageRepositoryPort,
} from '../../domain/ports/outbound/message-repository.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepositoryPort,
} from '../../domain/ports/outbound/workflow-repository.port';
import { ConversationPolicyEngine } from '../../domain/workflows/conversation-policy';
import type { WorkflowTrigger } from '../../domain/workflows/workflow-definition';
import { WorkflowEngine, type WorkflowExecutionOutcome } from '../../domain/workflows/workflow-engine';
import { WorkflowDefinitionRegistry } from '../../domain/workflows/workflow-registry';
import type { DiscoveredIntent } from '../../intent/domain/idce-resolution';
import type { SemanticObject } from '../../semantics/domain/csre-resolution';
import type { ActionExecutionResult, PlannedAction } from '../domain/action-plan';
import { capabilityForWorkflowType } from '../domain/capability-catalogue';
import { toLegacyRelationship } from '../domain/continuity-decision';
import { artifactFromResponse } from '../domain/response-plan';
import type { WorkflowActionInput, WorkflowExecutionPort } from '../ports/workflow-execution.port';

const COMPONENT = 'LANGGRAPH';
const STAGE = 'WorkflowExecution';

const SERVICE_ENTITY_TYPES = new Set(['SERVICE', 'CAPABILITY', 'ACTIVITY']);
const CATEGORY_ENTITY_TYPES = new Set(['PRODUCT_CATEGORY', 'PRODUCT_SUBCATEGORY']);

/**
 * Workflow execution boundary over the existing deterministic engine (MCOS TDR §21–§23, §56
 * phase 4, §57).
 *
 * A planned action names a capability, an operation and a scope. This adapter resolves the
 * workflow *instance* (explicit id → open instance of the type → new instance), reloads
 * authoritative business state first (§20), translates the validated IDCE/CSRE contracts into the
 * `WorkflowTrigger` the current workflow definitions still consume, and lets `WorkflowEngine`
 * perform every transition. AI output never calls the engine's mutators (§22).
 *
 * The trigger translation is the migration seam: it disappears as each workflow is rebuilt on the
 * v1.3 contracts (gap analysis Phases 10–12).
 */
@Injectable()
export class LegacyWorkflowExecutionAdapter implements WorkflowExecutionPort {
  constructor(
    private readonly definitions: WorkflowDefinitionRegistry,
    private readonly engine: WorkflowEngine,
    private readonly policy: ConversationPolicyEngine,
    private readonly conversations: ConversationContextManager,
    @Inject(WORKFLOW_SERVICES) private readonly services: WorkflowServiceRegistry,
    @Inject(WORKFLOW_REPOSITORY) private readonly workflows: WorkflowRepositoryPort,
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProviderPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  async execute(input: WorkflowActionInput): Promise<ActionExecutionResult> {
    const { action } = input;
    if (action.workflowType === null)
      return failed(action, 'UNSUPPORTED_CAPABILITY', 'Action names no workflow capability');

    // §20: authoritative business state is reloaded before every state-sensitive action.
    const loaded = await this.conversations.loadById(input.turn.conversationId);
    if (loaded === null)
      return failed(action, 'CONVERSATION_NOT_FOUND', 'Conversation vanished during the turn');
    const conversation = loaded.conversation;

    const artifacts = (
      await Promise.all(input.turn.messageIds.map((messageId) => this.messages.loadArtifacts(messageId)))
    ).flat() as Artifact[];

    const trigger = this.buildTrigger(input, conversation, artifacts);

    try {
      if (action.operation === 'CANCEL') return await this.cancel(input, conversation);

      const suspendedWorkflowIds: string[] = [];
      const instance = await this.resolveInstance(input, conversation, trigger, suspendedWorkflowIds);
      if (instance === null) {
        return failed(
          action,
          'NO_WORKFLOW_INSTANCE',
          `No ${action.workflowType} instance to ${action.operation.toLowerCase()}`,
        );
      }

      const first = await this.engine.execute(instance, trigger, this.services);
      const outcome = await this.applyHandoff(first, conversation, trigger);
      await this.events.publishAll([...first.events, ...(outcome === first ? [] : outcome.events)]);

      const responses = outcome === first ? outcome.responses : [...first.responses, ...outcome.responses];
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: {
          actionId: action.actionId,
          workflowType: action.workflowType,
          operation: action.operation,
          workflowId: outcome.instance.id,
        },
        action: `Executed ${action.operation} on ${outcome.instance.workflowType} → ${outcome.instance.currentState} (${outcome.instance.status})`,
        output: {
          transitions: outcome.transitions.length,
          responses: responses.length,
          failed: outcome.failed,
        },
      });

      return {
        actionId: action.actionId,
        status: outcome.failed ? 'FAILED' : 'SUCCESS',
        businessStateChanged: outcome.transitions.length > 0 || instance.id !== outcome.instance.id,
        workflowId: outcome.instance.id,
        workflowType: outcome.instance.workflowType,
        responseArtifacts: responses.map((response, index) =>
          artifactFromResponse(action.actionId, response, action.priority - index * 0.01, {
            workflowId: outcome.instance.id,
          }),
        ),
        emittedEventTypes: [...first.events, ...(outcome === first ? [] : outcome.events)].map(
          (event) => event.eventType,
        ),
        evidenceReferences: [],
        blockingIssues: [],
        suspendedWorkflowIds,
        error: outcome.failed
          ? { code: 'WORKFLOW_DEAD_LETTERED', message: 'State handler failed; workflow dead-lettered' }
          : null,
      };
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { actionId: action.actionId, workflowType: action.workflowType, operation: action.operation },
        action: 'Workflow execution threw; reporting a FAILED action result (turn continues)',
        error,
      });
      return failed(
        action,
        'WORKFLOW_EXECUTION_ERROR',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /** Instance resolution for a planned action (§21 layers as lookup, not routing). */
  private async resolveInstance(
    input: WorkflowActionInput,
    conversation: Conversation,
    trigger: WorkflowTrigger,
    suspendedWorkflowIds: string[] = [],
  ): Promise<WorkflowInstance | null> {
    const { action } = input;
    const registry = conversation.workflowRegistry;
    const now = input.now;

    const explicit = action.scope.workflowIds
      .map((workflowId) => registry.workflowInstances.find((instance) => instance.id === workflowId))
      .find(
        (instance): instance is WorkflowInstance =>
          instance !== undefined && instance.workflowType === action.workflowType && canResume(instance, now),
      );
    if (explicit !== undefined) return this.focus(explicit, conversation);

    if (action.operation !== 'START') {
      const open = registry.workflowInstances.find(
        (instance) => instance.workflowType === action.workflowType && canResume(instance, now),
      );
      if (open !== undefined) return this.focus(open, conversation);
      // Nothing to continue: CONTINUE/RESUME/MODIFY on a capability with no instance starts one.
    }

    return this.start(action, conversation, trigger, suspendedWorkflowIds);
  }

  private async focus(instance: WorkflowInstance, conversation: Conversation): Promise<WorkflowInstance> {
    await this.workflows.setActiveWorkflow(conversation.id, instance.id);
    if (instance.status !== 'suspended') return instance;
    const resumed = await this.workflows.update(instance.id, { status: 'active' });
    await this.publishLifecycle(ConversationEvents.WorkflowResumed, resumed);
    return resumed;
  }

  private async start(
    action: PlannedAction,
    conversation: Conversation,
    trigger: WorkflowTrigger,
    suspendedWorkflowIds: string[] = [],
  ): Promise<WorkflowInstance | null> {
    const definition = this.definitions.get(action.workflowType!);
    const registry = conversation.workflowRegistry;
    const existing = registry.workflowInstances;

    // Context drift: park the current objective rather than destroying it (MCOS §16).
    const active =
      registry.activeWorkflowId === null
        ? null
        : (existing.find((instance) => instance.id === registry.activeWorkflowId) ?? null);
    if (
      active !== null &&
      active.status === 'active' &&
      active.workflowType !== definition.type &&
      canResume(active, trigger.now)
    ) {
      const interruption = this.policy.canInterrupt(active, this.definitions.get(active.workflowType));
      if (!interruption.allowed) {
        this.logger.stage({
          component: COMPONENT,
          stage: STAGE,
          input: { activeWorkflowId: active.id, newType: definition.type },
          action: `Refused to interrupt the active workflow: ${interruption.reason}`,
          output: { startedNewWorkflow: false },
        });
        return active;
      }
      const suspended = await this.workflows.update(active.id, { status: 'suspended' });
      await this.publishLifecycle(ConversationEvents.WorkflowSuspended, suspended);
      suspendedWorkflowIds.push(suspended.id);
    }

    if (!this.policy.canStartConcurrentInstance(definition, existing)) {
      const open = existing.find(
        (candidate) =>
          candidate.workflowType === definition.type &&
          (candidate.status === 'active' || candidate.status === 'suspended'),
      );
      if (open !== undefined) return this.focus(open, conversation);
    }

    const fingerprint = definition.initialFingerprint(trigger);
    const embedding = await this.embedFingerprint([...fingerprint.entities, ...fingerprint.keywords]);
    const instance = await this.workflows.create({
      id: this.ids.uuid(),
      conversationId: conversation.id,
      workflowType: definition.type,
      initialState: definition.initialState,
      summary: definition.initialSummary(trigger),
      semanticFingerprint: fingerprint,
      importantEntities: {},
      data: definition.initialData(trigger),
      priority: definition.policy.priority,
      resumable: definition.policy.resumable,
      expiresAt: this.policy.expiryFor(definition, trigger.now),
      fingerprintEmbedding: embedding,
    });
    await this.workflows.setActiveWorkflow(conversation.id, instance.id);
    await this.publishLifecycle(ConversationEvents.WorkflowStarted, instance);

    const suspendedInstances = await this.workflows.listByStatus(conversation.id, 'suspended');
    for (const stale of this.policy.suspendedToArchive(suspendedInstances)) {
      await this.workflows.update(stale.id, { status: 'archived' });
    }
    return instance;
  }

  private async cancel(
    input: WorkflowActionInput,
    conversation: Conversation,
  ): Promise<ActionExecutionResult> {
    const { action } = input;
    const registry = conversation.workflowRegistry;
    const target =
      action.scope.workflowIds
        .map((id) => registry.workflowInstances.find((instance) => instance.id === id))
        .find((i) => i !== undefined) ??
      registry.workflowInstances.find(
        (instance) => instance.workflowType === action.workflowType && canResume(instance, input.now),
      ) ??
      null;
    if (target === null) return failed(action, 'NO_WORKFLOW_INSTANCE', 'Nothing to cancel');

    const cancelled = await this.workflows.update(target.id, { status: 'cancelled' });
    if (registry.activeWorkflowId === target.id)
      await this.workflows.setActiveWorkflow(conversation.id, null);
    await this.publishLifecycle(ConversationEvents.WorkflowCancelled, cancelled);

    const response: Response = {
      text: `Okay, I've cancelled that${describeInstance(cancelled)}. Tell me whenever you want to start something else.`,
      metadata: { workflowId: cancelled.id, cancelled: true },
    };
    return {
      actionId: action.actionId,
      status: 'SUCCESS',
      businessStateChanged: true,
      workflowId: cancelled.id,
      workflowType: cancelled.workflowType,
      responseArtifacts: [artifactFromResponse(action.actionId, response, action.priority)],
      emittedEventTypes: [ConversationEvents.WorkflowCancelled],
      evidenceReferences: [],
      blockingIssues: [],
      suspendedWorkflowIds: [],
      error: null,
    };
  }

  /**
   * A workflow that works out what the user actually wants steps aside for the one that serves
   * it, within the same turn (Triage → BuyerSearch / VendorOnboarding).
   */
  private async applyHandoff(
    outcome: WorkflowExecutionOutcome,
    conversation: Conversation,
    trigger: WorkflowTrigger,
  ): Promise<WorkflowExecutionOutcome> {
    const handoff = outcome.handoff;
    if (handoff === undefined || outcome.failed) return outcome;
    const workflowType = this.definitions.resolveByIntent(handoff.intent);
    if (workflowType === null || workflowType === outcome.instance.workflowType) return outcome;

    const handedTrigger: WorkflowTrigger = {
      ...trigger,
      intent: {
        intent: handoff.intent,
        confidence: 1,
        entities: trigger.intent?.entities ?? {},
        language: trigger.intent?.language ?? 'en',
      },
    };
    const reloaded = await this.conversations.loadById(conversation.id);
    const next = await this.start(
      {
        actionId: 'handoff',
        intentId: '',
        workflowType,
        operation: 'START',
        scope: { type: 'OBJECT', objectIds: [], workflowIds: [] },
        dependencies: [],
        concurrencyKey: null,
        stateConflictKeys: [],
        prerequisites: [],
        priority: 1,
        status: 'READY',
        needsUser: false,
      },
      reloaded?.conversation ?? conversation,
      handedTrigger,
    );
    if (next === null) return outcome;
    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Handoff`,
      input: { from: outcome.instance.workflowType, intent: handoff.intent },
      action: `Handed the turn to ${workflowType}, which owns this intent`,
      output: { workflowId: next.id },
    });
    return this.engine.execute(next, handedTrigger, this.services);
  }

  /** IDCE/CSRE contracts → the legacy trigger the current workflow definitions consume. */
  private buildTrigger(
    input: WorkflowActionInput,
    conversation: Conversation,
    artifacts: readonly Artifact[],
  ): WorkflowTrigger {
    const { action } = input;
    const capability = action.workflowType === null ? null : capabilityForWorkflowType(action.workflowType);
    const lead =
      input.intents.find((intent) => intent.intentId === action.intentId) ?? input.intents[0] ?? null;
    const boundObjects = input.objects.filter((object) => action.scope.objectIds.includes(object.objectId));
    const objects = boundObjects.length > 0 ? boundObjects : input.objects;

    const legacyIntent =
      input.legacyIntentOverride ??
      (capability !== null && lead !== null
        ? capability.legacyIntent(lead.type)
        : (capability?.legacyIntent('') ?? 'unknown'));

    const intent: IntentResult | null =
      lead === null && input.legacyIntentOverride === null
        ? null
        : {
            intent: legacyIntent,
            confidence: lead?.confidence ?? 1,
            entities: entitiesFrom(lead, objects),
            language: 'en',
            ...(lead?.type === 'CANCEL' ? { command: 'cancel' } : {}),
          };

    const relationship: ConversationRelationship = {
      relationship: toLegacyRelationship(
        input.continuity?.primary ?? 'NO_WORKFLOW_CONTEXT',
        input.answeringClarification,
      ) as ConversationRelationship['relationship'],
      confidence: input.continuity?.confidence ?? 1,
      candidateWorkflowIds: action.scope.workflowIds,
      reasoning: input.continuity?.reason,
    };

    return {
      conversation,
      recentHistory: conversation.history,
      artifacts,
      text: input.text,
      relationship,
      intent,
      semanticRequest: objects.length === 0 ? null : semanticRequestFrom(legacyIntent, lead, objects),
      interactivePayload: input.interactivePayload,
      now: input.now,
    };
  }

  private async embedFingerprint(terms: readonly string[]): Promise<readonly number[] | null> {
    const text = terms.join(' ').trim();
    if (text.length === 0) return null;
    try {
      return await this.embeddings.embed(text);
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:FingerprintEmbedding`,
        input: { terms },
        action: 'Could not embed the workflow fingerprint; discovery will use layers 1-4 only',
        error,
      });
      return null;
    }
  }

  private async publishLifecycle(eventType: string, instance: WorkflowInstance): Promise<void> {
    await this.events.publish({
      eventId: this.ids.uuid(),
      eventType,
      timestamp: this.clock.now(),
      producer: 'ConversationOS',
      conversationId: instance.conversationId,
      workflowId: instance.id,
      payload: { workflowType: instance.workflowType, state: instance.currentState, status: instance.status },
    });
  }
}

function failed(action: PlannedAction, code: string, message: string): ActionExecutionResult {
  return {
    actionId: action.actionId,
    status: 'FAILED',
    businessStateChanged: false,
    workflowId: null,
    workflowType: action.workflowType,
    responseArtifacts: [],
    emittedEventTypes: [],
    evidenceReferences: [],
    blockingIssues: [{ code, message, issueKey: null }],
    suspendedWorkflowIds: [],
    error: { code, message },
  };
}

function describeInstance(instance: WorkflowInstance): string {
  switch (instance.workflowType) {
    case 'BuyerSearch':
      return ' search';
    case 'VendorOnboarding':
      return ' listing';
    case 'CreditRecharge':
      return ' recharge';
    default:
      return '';
  }
}

function entitiesFrom(
  intent: DiscoveredIntent | null,
  objects: readonly SemanticObject[],
): Record<string, string | readonly string[]> {
  const entities: Record<string, string | readonly string[]> = {};
  const products = objects
    .filter((object) => !SERVICE_ENTITY_TYPES.has(object.entityType))
    .map((object) => object.canonicalForm);
  const services = objects
    .filter((object) => SERVICE_ENTITY_TYPES.has(object.entityType))
    .map((object) => object.canonicalForm);
  const brands = objects.map((object) => object.brand).filter((brand): brand is string => brand !== null);
  if (products.length > 0) entities.product = products;
  if (services.length > 0) entities.service = services;
  if (brands.length > 0) entities.brand = [...new Set(brands)];
  for (const constraint of intent?.constraints ?? []) {
    if (typeof constraint.value === 'string' && constraint.value.length > 0) {
      const key = constraint.type.toLowerCase();
      const existing = entities[key];
      entities[key] =
        existing === undefined
          ? constraint.value
          : [...(Array.isArray(existing) ? existing : [existing]), constraint.value];
    }
  }
  return entities;
}

function semanticRequestFrom(
  legacyIntent: string,
  intent: DiscoveredIntent | null,
  objects: readonly SemanticObject[],
): SemanticRequest {
  const toResolved = (object: SemanticObject) => ({
    raw: object.surfaceForm,
    normalized: [object.brand, object.canonicalForm]
      .filter((part): part is string => part !== null && part.length > 0)
      .join(' '),
    aliases: object.aliases,
  });
  const category = objects.find((object) => CATEGORY_ENTITY_TYPES.has(object.entityType));
  const minConfidence = Math.min(1, ...objects.map((object) => object.confidence.semanticResolution));
  return {
    intent: legacyIntent,
    products: objects
      .filter(
        (object) =>
          !SERVICE_ENTITY_TYPES.has(object.entityType) && !CATEGORY_ENTITY_TYPES.has(object.entityType),
      )
      .map(toResolved),
    services: objects.filter((object) => SERVICE_ENTITY_TYPES.has(object.entityType)).map(toResolved),
    ...(category !== undefined ? { category: { name: category.canonicalForm } } : {}),
    ambiguity: objects.some((object) => object.ambiguity.present),
    ambiguityScore: 1 - minConfidence,
    modifiers: objects.flatMap((object) =>
      Object.values(object.attributes).filter((value): value is string => typeof value === 'string'),
    ),
    constraints: (intent?.constraints ?? []).map(
      (constraint) => `${constraint.type}:${String(constraint.value)}`,
    ),
    brands: [
      ...new Set(objects.map((object) => object.brand).filter((brand): brand is string => brand !== null)),
    ],
  };
}
