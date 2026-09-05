import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import type { Artifact } from '../../domain/models/artifact';
import type { Conversation } from '../../domain/models/conversation';
import { PROVIDER_MESSAGE_ID_KEY, type IncomingMessage } from '../../domain/models/incoming-message';
import type { Response } from '../../domain/models/response';
import { fallbackWithReason } from '../../domain/models/response';
import type { IntentResult } from '../../domain/models/understanding';
import { isContinuing } from '../../domain/models/understanding';
import { canResume, type WorkflowInstance } from '../../domain/models/workflow-instance';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  isAccepted,
  type ChannelNotifierRegistryPort,
} from '../../domain/ports/outbound/channel-notifier.port';
import {
  ConversationEvents,
  EVENT_PUBLISHER,
  type DomainEvent,
  type EventPublisherPort,
} from '../../domain/ports/outbound/event-publisher.port';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../../domain/ports/outbound/embedding-provider.port';
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
import { encodeActionPayload } from '../../domain/workflows/action-payload';
import { ConversationPolicyEngine } from '../../domain/workflows/conversation-policy';
import type { WorkflowTrigger } from '../../domain/workflows/workflow-definition';
import { WorkflowEngine, type WorkflowExecutionOutcome } from '../../domain/workflows/workflow-engine';
import { WorkflowManager, type RoutingDecision } from '../../domain/workflows/workflow-manager';
import { WorkflowDefinitionRegistry } from '../../domain/workflows/workflow-registry';
import { resolveSystemAction, type SystemAction } from '../../domain/workflows/system-actions';
import { ConversationContextManager } from '../conversation/conversation-context.manager';
import { VendorResponseHandler } from '../fulfilment/vendor-response-handler.service';
import { ResponseComposer } from '../response/response-composer.service';
import { ConversationContinuityAnalyzer } from '../understanding/continuity-analyzer.service';
import { IntentResolutionService } from '../understanding/intent-resolution.service';
import { SemanticResolutionService } from '../understanding/semantic-resolution.service';
import { UtteranceSegmentationService, type UtteranceSegment } from '../understanding/segmentation.service';
import { WORKFLOW_SERVICES, type WorkflowServiceRegistry } from './workflow-services';

const COMPONENT = 'MCOS';
const STAGE = 'TurnProcessor';

/** Statuses that mean the objective is over and nothing should be treated as in focus. */
const TERMINAL_STATUSES: readonly string[] = ['completed', 'cancelled', 'archived', 'failed'];

export interface TurnInput {
  readonly message: IncomingMessage;
  readonly artifacts: readonly Artifact[];
  readonly text: string;
  readonly interactivePayload: string | null;
}

export interface TurnOutcome {
  readonly response: Response;
  readonly workflowId: string | null;
}

/** The intent a tapped platform action stands for, as certain as an intent gets. */
function intentForSystemAction(action: SystemAction): IntentResult {
  return {
    intent: action.intent,
    confidence: 1,
    entities: { system_action: action.action },
    language: 'en',
  };
}

/**
 * Executes one conversation turn end to end (MCOS §14, Cases A and B).
 *
 * Load context → analyse continuity → resolve intent and semantics when the turn starts
 * something new → route to a workflow → execute → compose → deliver → publish.
 *
 * Runs with the conversation lock already held by the caller.
 */
@Injectable()
export class TurnProcessor {
  constructor(
    @Inject(WORKFLOW_REPOSITORY) private readonly workflows: WorkflowRepositoryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistryPort,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProviderPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    @Inject(WORKFLOW_SERVICES) private readonly services: WorkflowServiceRegistry,
    private readonly context: ConversationContextManager,
    private readonly continuity: ConversationContinuityAnalyzer,
    private readonly segmenter: UtteranceSegmentationService,
    private readonly intents: IntentResolutionService,
    private readonly semantics: SemanticResolutionService,
    private readonly definitions: WorkflowDefinitionRegistry,
    private readonly manager: WorkflowManager,
    private readonly engine: WorkflowEngine,
    private readonly policy: ConversationPolicyEngine,
    private readonly composer: ResponseComposer,
    private readonly vendorResponses: VendorResponseHandler,
    private readonly config: AppConfigService,
  ) {}

  async process(input: TurnInput): Promise<TurnOutcome> {
    const now = this.clock.now();
    const { message, text } = input;

    const { conversation } = await this.context.load({
      userId: message.userId,
      channel: message.channel,
    });

    await this.context.recordUserTurn({
      conversationId: conversation.id,
      channel: message.channel,
      content: text,
    });

    // REQ-TS-001: Trigger best-effort typing status signal when actively processing a request
    await this.indicateTyping(conversation, message);

    // REQ-TS-003: 25-second heartbeat watchdog timer for long-running turns
    const heartbeatTimer = setTimeout(async () => {
      await this.handleProcessingHeartbeat(conversation, message);
    }, 25_000);

    try {
      // A message the platform cannot read at all — media that produced no artifacts, or an
      // unsupported part type. Say so rather than running a workflow on empty input.
      if (text.trim().length === 0) {
        return await this.respondWithFallback(conversation, message, 'no_readable_content', null);
      }

      // A vendor answering a fanned-out request. Handled before anything else because the payload
      // is decisive: it names the request and the answer, so continuity analysis and intent
      // resolution could only add latency, cost, and a way for the turn to go wrong. No workflow
      // is started, resumed or suspended — a vendor's "yes" is a marketplace action, not a
      // conversational objective (Vendor Fan-Out TDR §10).
      const vendorReply = await this.vendorResponses.tryHandle({
        conversation,
        interactivePayload: input.interactivePayload,
        text,
      });

      if (vendorReply !== null) {
        await this.send(conversation, vendorReply, null);
        await this.context.touch(conversation.id, message.channel);
        return { response: vendorReply, workflowId: null };
      }

      // One message can carry several objectives ("Yes, KYB. Also who sells engine oil near
      // Alaba?"). Splitting first is what lets each be routed on its own; before this stage
      // existed the turn resolved to a single intent and the rest of the message was dropped.
      const segments = await this.segmenter.segment({
        conversation,
        text,
        interactivePayload: input.interactivePayload,
      });

      const responses: Response[] = [];
      const events: DomainEvent[] = [];
      let last: WorkflowExecutionOutcome | null = null;
      let failed = false;
      let unroutableReason: string | null = null;

      for (const segment of segments) {
        // Segments after the first must see the registry as the previous one left it. Routing
        // against a stale snapshot would resume a workflow that is no longer in focus, or
        // start a second copy of one that was just created — which is why this loop is
        // sequential rather than a Promise.all.
        const current =
          segment.index === 0
            ? conversation
            : (await this.context.load({ userId: message.userId, channel: message.channel })).conversation;

        const result = await this.runSegment({
          conversation: current,
          segment,
          artifacts: input.artifacts,
          // Segmentation always returns a single segment when a payload is present, so a
          // tapped button can never be attached to the wrong part of a message.
          interactivePayload: input.interactivePayload,
          now,
        });

        if ('unroutable' in result) {
          // One unservable part must not sink the rest of the turn.
          unroutableReason = result.unroutable;
          continue;
        }

        responses.push(...result.outcome.responses);
        events.push(...result.outcome.events);
        failed = failed || result.outcome.failed;
        last = result.outcome;
      }

      if (last === null) {
        return await this.respondWithFallback(
          conversation,
          message,
          unroutableReason ?? 'routing_produced_no_workflow',
          null,
        );
      }

      // Offer the way back to whatever the user was doing before they digressed. Without this
      // a parked objective is preserved but invisible, and the user has to remember it for us.
      const nudge = await this.resumeNudge(conversation.id, last.instance, now);
      if (nudge !== null) responses.push(nudge);

      const response = this.composer.compose(responses, { workflowId: last.instance.id });

      await this.finalise({
        conversation,
        message,
        instance: last.instance,
        response,
        events,
        failed,
      });

      const durationMs = this.clock.now().getTime() - now.getTime();
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { conversationId: conversation.id, messageId: message.id, segments: segments.length },
        action: `Completed turn processing in ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`,
        output: {
          segments: segments.length,
          workflowId: last.instance.id,
          status: last.instance.status,
          ...(unroutableReason !== null ? { unservedSegment: unroutableReason } : {}),
        },
        durationMs,
      });

      return { response, workflowId: last.instance.id };
    } catch (error) {
      // REQ-TS-002: Catch internal errors gracefully and send empathetic pleading error message
      return await this.handleInternalProcessingError(conversation, message, error);
    } finally {
      clearTimeout(heartbeatTimer);
    }
  }

  /**
   * Understands, routes and executes one segment of a message.
   *
   * This is the whole of what a turn used to be. Extracting it is what makes a multi-objective
   * message possible without a second copy of the understanding pipeline: each part goes
   * through exactly the same stages, against the registry as the previous part left it.
   */
  private async runSegment(params: {
    conversation: Conversation;
    segment: UtteranceSegment;
    artifacts: readonly Artifact[];
    interactivePayload: string | null;
    now: Date;
  }): Promise<{ outcome: WorkflowExecutionOutcome } | { unroutable: string }> {
    const { conversation, segment, interactivePayload, now } = params;
    const text = segment.text;

    const relationship = await this.continuity.analyze({
      conversation,
      text,
      interactivePayload,
      now,
    });

    // Case A (continuing an existing workflow) skips intent and semantic resolution: the
    // workflow already knows what it asked for, and re-classifying "Aba" out of context
    // would produce nonsense (MCOS §14).
    const needsUnderstanding = !isContinuing(relationship.relationship);

    // A tapped platform-level action already says what the user wants. Classifying "⚡ Recharge
    // Now" with an LLM could only agree or be wrong, and this one routes to a money flow.
    const systemAction = resolveSystemAction(interactivePayload);

    const intent =
      systemAction !== null
        ? intentForSystemAction(systemAction)
        : needsUnderstanding
          ? await this.intents.resolve({ conversation, text })
          : null;

    const semanticRequest =
      intent !== null && this.shouldResolveSemantics(intent)
        ? await this.semantics.resolve({ intent, text })
        : null;

    const decision = await this.manager.route({
      conversation,
      relationship,
      intent,
      text,
      interactivePayload,
      now,
    });

    // The trigger carries the *segment's* text, not the whole message. That scoping is what
    // stops a buyer-search product from being extracted into the onboarding instance's
    // entities and fingerprint, which would then poison discovery on every later turn.
    const trigger: WorkflowTrigger = {
      conversation,
      recentHistory: conversation.history,
      artifacts: params.artifacts,
      text,
      relationship,
      intent,
      semanticRequest,
      interactivePayload,
      now,
    };

    const instance = await this.applyRouting(decision, conversation, trigger);

    if (instance === null) {
      return {
        unroutable: decision.action === 'unroutable' ? decision.reason : 'routing_produced_no_workflow',
      };
    }

    const first = await this.engine.execute(instance, trigger, this.services);

    // A workflow that has worked out what the user actually wants steps aside for the one that
    // serves it, within the same turn. Without this, a Triage instance resumed by a button tap
    // answers on behalf of capabilities it does not implement.
    const outcome = await this.applyHandoff(first, conversation, trigger);

    return {
      outcome: outcome === first ? outcome : { ...outcome, events: [...first.events, ...outcome.events] },
    };
  }

  /**
   * Invitation to resume a parked objective, or null when there is nothing to resume.
   *
   * Only offered once the turn has finished what it was doing — nudging someone back to an
   * onboarding while they are mid-search would be interrupting them to ask about being
   * interrupted. The button carries the workflow id, so accepting it resumes through discovery
   * Layer 1 with no model in the loop.
   */
  private async resumeNudge(
    conversationId: string,
    instance: WorkflowInstance,
    now: Date,
  ): Promise<Response | null> {
    if (!TERMINAL_STATUSES.includes(instance.status)) return null;

    const suspended = await this.workflows.listByStatus(conversationId, 'suspended');
    const resumable = suspended.filter((candidate) => canResume(candidate, now));

    if (resumable.length === 0) return null;

    // Most recently touched first: of several parked objectives, that is the one the user is
    // most likely to still have in mind.
    const [target] = [...resumable].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return {
      text: 'Shall we carry on with what we were doing before?',
      actions: [
        {
          type: 'resume',
          title: 'Yes, continue',
          payload: encodeActionPayload({ workflowId: target.id, action: 'resume' }),
          ...(target.summary.length > 0 ? { description: target.summary.slice(0, 72) } : {}),
        },
      ],
      metadata: { nudge: 'resume_suspended', resumeWorkflowId: target.id },
    };
  }

  /**
   * Triggers a best-effort typing indicator signal to the active channel notifier (REQ-TS-001).
   */
  private async indicateTyping(conversation: Conversation, message: IncomingMessage): Promise<void> {
    const channel = conversation.lastChannel;
    if (!this.notifiers.supports(channel)) return;

    const providerMessageId = (message.metadata?.[PROVIDER_MESSAGE_ID_KEY] ??
      message.metadata?.providerMessageId ??
      message.id) as string | undefined;

    const notifier = this.notifiers.forChannel(channel);
    if (notifier.indicateTyping !== undefined) {
      try {
        await notifier.indicateTyping({
          channel,
          address: conversation.userId,
          conversationId: conversation.id,
          messageId: providerMessageId,
        });
      } catch (error) {
        this.logger.stageFailed({
          component: COMPONENT,
          stage: `${STAGE}:Typing`,
          input: { conversationId: conversation.id, channel },
          action: 'Failed to signal typing status indicator',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
  }

  /**
   * Dispatches interim progress update and refreshes typing indicator at 25s threshold (REQ-TS-003).
   */
  private async handleProcessingHeartbeat(
    conversation: Conversation,
    message: IncomingMessage,
  ): Promise<void> {
    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Heartbeat`,
      input: { conversationId: conversation.id, messageId: message.id },
      action:
        'Turn processing reached 25s threshold; sending interim progress update and re-triggering typing status',
      output: { heartbeatSent: true },
    });

    const heartbeatResponse: Response = {
      text: "I'm still working on your request! Thank you for your patience—I'll have your results ready in a moment.",
      metadata: { heartbeat: '25s_threshold_update' },
    };

    await this.send(conversation, heartbeatResponse, null);
    await this.indicateTyping(conversation, message);
  }

  /**
   * Catches internal errors during active processing, sends an empathetic error message (REQ-TS-002),
   * which deactivates typing status and informs the user pleading for forgiveness.
   */
  private async handleInternalProcessingError(
    conversation: Conversation,
    message: IncomingMessage,
    error: unknown,
  ): Promise<TurnOutcome> {
    this.logger.stageFailed({
      component: COMPONENT,
      stage: STAGE,
      input: { conversationId: conversation.id, messageId: message.id },
      action:
        'Internal processing error occurred during turn; sending empathetic error response to deactivate typing status',
      error: error instanceof Error ? error : new Error(String(error)),
    });

    const errorResponse: Response = {
      text: "I'm so sorry, I ran into an unexpected technical issue while processing your request. Please forgive me—could you please try sending your message again in a moment?",
      metadata: { error: 'internal_processing_failure' },
    };

    await this.send(conversation, errorResponse, null);

    return { response: errorResponse, workflowId: null };
  }

  /**
   * Runs the workflow a handing-off state named, if one is registered.
   *
   * Bounded to a single hop by construction — the successor's own handoff is not followed — so
   * two workflows that pointed at each other would cost one extra execution, not a loop. The
   * hand-off is also abandoned if the intent resolves back to the workflow that asked for it.
   *
   * When nothing claims the intent the original outcome stands, which is why a handing-off state
   * still supplies a response: on a deployment without the target workflow the user gets that
   * honest answer instead of silence.
   */
  private async applyHandoff(
    outcome: WorkflowExecutionOutcome,
    conversation: Conversation,
    trigger: WorkflowTrigger,
  ): Promise<WorkflowExecutionOutcome> {
    const handoff = outcome.handoff;
    if (handoff === undefined || outcome.failed) return outcome;

    const workflowType = this.definitions.resolveByIntent(handoff.intent);

    if (workflowType === null || workflowType === outcome.instance.workflowType) {
      this.logger.stage({
        component: COMPONENT,
        stage: `${STAGE}:Handoff`,
        input: { from: outcome.instance.workflowType, intent: handoff.intent },
        action:
          workflowType === null
            ? 'No workflow is registered for the handed-off intent; keeping the original reply'
            : 'Handoff resolved back to the same workflow; keeping the original reply',
        output: { handedOff: false },
      });
      return outcome;
    }

    // The successor reads the intent to build its opening state, summary and fingerprint, so it
    // must see the resolved one rather than whatever the message was first classified as.
    const handedTrigger: WorkflowTrigger = {
      ...trigger,
      intent: {
        intent: handoff.intent,
        confidence: 1,
        entities: {},
        language: trigger.intent?.language ?? 'en',
      },
    };

    // `suspend: null` because the workflow handing off has already completed; there is no
    // unfinished objective to park.
    const next = await this.start(
      { action: 'start', workflowType, suspend: null },
      conversation,
      handedTrigger,
    );

    if (next === null) return outcome;

    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Handoff`,
      input: { from: outcome.instance.workflowType, intent: handoff.intent },
      action: `Handed the turn to ${workflowType}, which owns this intent`,
      output: { handedOff: true, workflowId: next.id },
    });

    return this.engine.execute(next, handedTrigger, this.services);
  }

  /**
   * Semantic resolution is only worth its latency and cost when the intent involves
   * marketplace vocabulary. Onboarding a vendor or funding a wallet does not.
   */
  private shouldResolveSemantics(intent: IntentResult): boolean {
    return intent.intent.includes('search') || intent.intent.includes('product');
  }

  /** Turns a routing decision into the workflow instance the engine should run. */
  private async applyRouting(
    decision: RoutingDecision,
    conversation: Conversation,
    trigger: WorkflowTrigger,
  ): Promise<WorkflowInstance | null> {
    switch (decision.action) {
      case 'resume':
        return this.resume(decision.instance, conversation);

      case 'restart':
        return this.restart(decision.instance, conversation, trigger);

      case 'cancel':
        return this.cancel(decision.instance, conversation);

      case 'start':
        return this.start(decision, conversation, trigger);

      case 'clarify':
        // Layer 6 of discovery: the platform genuinely cannot tell which workflow the user
        // means, so asking is better than picking (MCOS §15).
        return this.clarifyTarget(decision.candidates, conversation);

      case 'unroutable':
        return null;
    }
  }

  private async resume(instance: WorkflowInstance, conversation: Conversation): Promise<WorkflowInstance> {
    await this.workflows.setActiveWorkflow(conversation.id, instance.id);

    if (instance.status !== 'suspended') return instance;

    const resumed = await this.workflows.update(instance.id, { status: 'active' });

    await this.publishLifecycle(ConversationEvents.WorkflowResumed, resumed);

    return resumed;
  }

  private async restart(
    instance: WorkflowInstance,
    conversation: Conversation,
    trigger: WorkflowTrigger,
  ): Promise<WorkflowInstance> {
    const definition = this.definitions.get(instance.workflowType);

    const restarted = await this.workflows.update(instance.id, {
      currentState: definition.initialState,
      status: 'active',
      data: definition.initialData(trigger),
      summary: definition.initialSummary(trigger),
      expiresAt: this.policy.expiryFor(definition, trigger.now),
    });

    await this.workflows.setActiveWorkflow(conversation.id, restarted.id);

    return restarted;
  }

  private async cancel(
    instance: WorkflowInstance,
    conversation: Conversation,
  ): Promise<WorkflowInstance | null> {
    const cancelled = await this.workflows.update(instance.id, { status: 'cancelled' });

    if (conversation.workflowRegistry.activeWorkflowId === instance.id) {
      await this.workflows.setActiveWorkflow(conversation.id, null);
    }

    await this.publishLifecycle(ConversationEvents.WorkflowCancelled, cancelled);

    // Cancellation is complete in itself; there is nothing further for the engine to run.
    // The confirmation is emitted by the caller through the fallback-free path below.
    await this.deliverCancellation(conversation, cancelled);

    return null;
  }

  private async start(
    decision: Extract<RoutingDecision, { action: 'start' }>,
    conversation: Conversation,
    trigger: WorkflowTrigger,
  ): Promise<WorkflowInstance | null> {
    const definition = this.definitions.get(decision.workflowType);

    // Context drift: park the current objective rather than destroying it (MCOS §16).
    if (decision.suspend !== null) {
      const suspending = this.definitions.get(decision.suspend.workflowType);
      const interruption = this.policy.canInterrupt(decision.suspend, suspending);

      if (!interruption.allowed) {
        this.logger.stage({
          component: COMPONENT,
          stage: STAGE,
          input: { activeWorkflowId: decision.suspend.id, newType: decision.workflowType },
          action: `Refused to interrupt the active workflow: ${interruption.reason}`,
          output: { startedNewWorkflow: false },
        });

        // Keep serving the protected workflow instead of abandoning it mid-step.
        return decision.suspend;
      }

      const suspended = await this.workflows.update(decision.suspend.id, { status: 'suspended' });
      await this.publishLifecycle(ConversationEvents.WorkflowSuspended, suspended);
    }

    const existing = conversation.workflowRegistry.workflowInstances;
    if (!this.policy.canStartConcurrentInstance(definition, existing)) {
      // Re-use the open instance rather than creating a second onboarding for one vendor.
      const open = existing.find(
        (candidate) =>
          candidate.workflowType === definition.type &&
          (candidate.status === 'active' || candidate.status === 'suspended'),
      );

      if (open !== undefined) return this.resume(open, conversation);
    }

    const fingerprint = definition.initialFingerprint(trigger);
    const embedding = await this.embedFingerprint(fingerprint.entities.concat(fingerprint.keywords));

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

    await this.archiveExcessSuspended(conversation);

    return instance;
  }

  /**
   * Embeds a fingerprint for similarity-based discovery.
   *
   * Best-effort: without an embedding, discovery falls back to layers 1–4, which is a
   * degradation rather than a failure, so an embedding outage must not block the turn.
   */
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

  /** Enforces the suspended-workflow ceiling so state cannot grow without bound. */
  private async archiveExcessSuspended(conversation: Conversation): Promise<void> {
    const suspended = await this.workflows.listByStatus(conversation.id, 'suspended');
    const toArchive = this.policy.suspendedToArchive(suspended);

    for (const instance of toArchive) {
      await this.workflows.update(instance.id, { status: 'archived' });
    }

    if (toArchive.length > 0) {
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { conversationId: conversation.id, suspended: suspended.length },
        action: `Archived ${toArchive.length} least-recently-updated suspended workflow(s) to stay within policy`,
        output: { archived: toArchive.map((instance) => instance.id) },
      });
    }
  }

  private async clarifyTarget(
    candidates: readonly WorkflowInstance[],
    conversation: Conversation,
  ): Promise<null> {
    const response: Response = {
      text: [
        'Which one do you mean?',
        ...candidates.map(
          (candidate, index) => `${index + 1}. ${candidate.summary || candidate.workflowType}`,
        ),
      ].join('\n'),
      metadata: { clarification: 'workflow_disambiguation' },
    };

    await this.send(conversation, response, null);

    return null;
  }

  private async deliverCancellation(conversation: Conversation, instance: WorkflowInstance): Promise<void> {
    await this.send(
      conversation,
      { text: 'No problem — I have cancelled that.', metadata: { workflowId: instance.id } },
      instance.id,
    );
  }

  /** Persists the turn, delivers the reply and publishes the resulting events. */
  private async finalise(params: {
    conversation: Conversation;
    message: IncomingMessage;
    instance: WorkflowInstance;
    response: Response;
    events: readonly DomainEvent[];
    failed: boolean;
  }): Promise<void> {
    // Clear the active pointer once the objective is finished, so the next message is not
    // read as continuing something that is over.
    if (TERMINAL_STATUSES.includes(params.instance.status)) {
      await this.workflows.setActiveWorkflow(params.conversation.id, null);
    }

    await this.send(params.conversation, params.response, params.instance.id);

    if (params.events.length > 0) await this.events.publishAll(params.events);

    await this.context.touch(params.conversation.id, params.message.channel);
  }

  private async respondWithFallback(
    conversation: Conversation,
    message: IncomingMessage,
    reason: string,
    workflowId: string | null,
  ): Promise<TurnOutcome> {
    const response = fallbackWithReason(reason);

    this.logger.stageFailed({
      component: COMPONENT,
      stage: STAGE,
      input: { conversationId: conversation.id, messageId: message.id },
      action: 'Turn could not be handled; returning the fallback envelope',
      error: new Error(reason),
    });

    await this.send(conversation, response, workflowId);

    return { response, workflowId };
  }

  /**
   * Delivers a response on the channel the user is currently using and records it in history.
   */
  private async send(
    conversation: Conversation,
    response: Response,
    workflowId: string | null,
  ): Promise<void> {
    const channel = conversation.lastChannel;

    if (!this.notifiers.supports(channel)) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Delivery`,
        input: { channel, conversationId: conversation.id },
        action: 'No outbound notifier is registered for this channel; the reply cannot be delivered',
        error: new Error(`Unsupported outbound channel "${channel}"`),
      });
      return;
    }

    await this.publishEvent(ConversationEvents.ResponseCreated, conversation.id, workflowId, {
      hasText: response.text !== undefined,
      actions: response.actions?.length ?? 0,
    });

    const result = await this.notifiers
      .forChannel(channel)
      .send({ channel, address: conversation.userId, conversationId: conversation.id }, response);

    // A queued reply counts as said: it is durably recorded and will reach the user, so the
    // history must contain it or the next turn will reason as though the platform stayed silent.
    if (isAccepted(result)) {
      await this.context.recordAssistantTurn({
        conversationId: conversation.id,
        channel,
        content: response.text ?? '',
        ...(workflowId !== null ? { workflowId } : {}),
      });

      if (result.delivered) {
        await this.publishEvent(ConversationEvents.MessageSent, conversation.id, workflowId, {
          providerMessageId: result.providerMessageId,
          messageCount: result.messageCount ?? 1,
        });

        return;
      }

      this.logger.stage({
        component: COMPONENT,
        stage: `${STAGE}:Delivery`,
        input: { channel, conversationId: conversation.id },
        action: 'Channel is unavailable; the reply is queued and will be delivered on retry',
        output: { queued: true },
      });

      return;
    }

    // A delivery failure must not roll back committed workflow state; it is recorded so the
    // outcome is visible rather than silently lost.
    this.logger.stageFailed({
      component: COMPONENT,
      stage: `${STAGE}:Delivery`,
      input: { channel, conversationId: conversation.id },
      action: 'Channel rejected the outbound message',
      error: new Error(result.error ?? 'unknown delivery failure'),
    });

    await this.publishEvent(ConversationEvents.MessageFailed, conversation.id, workflowId, {
      error: result.error ?? 'unknown delivery failure',
    });
  }

  /** Delivers a response outside the normal turn flow, e.g. when the lock was unavailable. */
  async deliver(message: IncomingMessage, response: Response, workflowId: string | null): Promise<void> {
    const context = await this.context.loadById(message.conversationId);
    if (context === null) return;

    await this.send(context.conversation, response, workflowId);
  }

  private async publishLifecycle(eventType: string, instance: WorkflowInstance): Promise<void> {
    await this.publishEvent(eventType, instance.conversationId, instance.id, {
      workflowType: instance.workflowType,
      state: instance.currentState,
      status: instance.status,
    });
  }

  private async publishEvent(
    eventType: string,
    conversationId: string,
    workflowId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.events.publish({
      eventId: this.ids.uuid(),
      eventType,
      timestamp: this.clock.now(),
      producer: 'ConversationOS',
      conversationId,
      ...(workflowId !== null ? { workflowId } : {}),
      payload,
    });
  }

  /** Exposed for the expiry sweeper, which needs the same idle policy. */
  get idleExpiryMs(): number {
    return this.config.conversationPolicy.workflowIdleExpiryMs;
  }
}
