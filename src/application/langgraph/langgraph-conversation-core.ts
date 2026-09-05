import { randomUUID } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { END, START, StateGraph, type BaseCheckpointSaver } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { Artifact } from '../../domain/models/artifact';
import type { Conversation } from '../../domain/models/conversation';
import { PROVIDER_MESSAGE_ID_KEY, type IncomingMessage } from '../../domain/models/incoming-message';
import type { Response } from '../../domain/models/response';
import { fallbackWithReason } from '../../domain/models/response';
import { canResume } from '../../domain/models/workflow-instance';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  type ChannelNotifierRegistryPort,
} from '../../domain/ports/outbound/channel-notifier.port';
import type {
  ConversationCorePort,
  ConversationTurnInput,
  ConversationTurnResult,
} from '../../domain/ports/inbound/conversation-core.port';
import { SEGMENT_EXECUTOR, type SegmentExecutorPort } from '../../domain/ports/inbound/segment-executor.port';
import {
  EVENT_PUBLISHER,
  type DomainEvent,
  type EventPublisherPort,
} from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { CLOCK, type ClockPort } from '../../domain/ports/outbound/system.port';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepositoryPort,
} from '../../domain/ports/outbound/workflow-repository.port';
import { encodeActionPayload } from '../../domain/workflows/action-payload';
import { ConversationContextManager } from '../conversation/conversation-context.manager';
import { VendorResponseHandler } from '../fulfilment/vendor-response-handler.service';
import { ConversationDelivery } from '../response/conversation-delivery.service';
import { ResponseComposer } from '../response/response-composer.service';
import { UtteranceSegmentationService } from '../understanding/segmentation.service';
import { TurnCheckpointer } from './turn-checkpointer.provider';
import { TURN_CONTEXT_KEY, TurnGraphState, type TurnGraphStateType } from './turn-graph.state';

const COMPONENT = 'MCOS';
const STAGE = 'LangGraphCore';

/** Statuses that mean the objective is over and nothing should be treated as in focus. */
const TERMINAL_STATUSES: readonly string[] = ['completed', 'cancelled', 'archived', 'failed'];

/** Everything about a turn that cannot go through a checkpoint. */
interface TurnContext {
  readonly message: IncomingMessage;
  /** Flattened text for the turn, as ingestion collected it. */
  readonly text: string;
  readonly artifacts: readonly Artifact[];
  readonly interactivePayload: string | null;
  readonly now: Date;
  /** The conversation as loaded at the start of the turn. Re-read between segments. */
  conversation: Conversation;
}

/** The three steps of a turn plan, supplied by the core so the graph stays declarative. */
interface TurnGraphHandlers {
  segment(state: TurnGraphStateType, config: RunnableConfig): Promise<Partial<TurnGraphStateType>>;
  serve(state: TurnGraphStateType, config: RunnableConfig): Promise<Partial<TurnGraphStateType>>;
  finalize(state: TurnGraphStateType, config: RunnableConfig): Promise<Partial<TurnGraphStateType>>;
}

/**
 * The turn plan as a graph.
 *
 * A module-level function rather than a method so the compiled graph's type can be inferred
 * and carried on the field — `invoke` then returns the real state shape instead of a generic
 * one that has to be cast back.
 */
function buildTurnGraph(handlers: TurnGraphHandlers, checkpointer: BaseCheckpointSaver) {
  return (
    new StateGraph(TurnGraphState)
      .addNode('segment', (state, config) => handlers.segment(state, config))
      .addNode('serve', (state, config) => handlers.serve(state, config))
      .addNode('finalize', (state, config) => handlers.finalize(state, config))
      .addEdge(START, 'segment')
      // A message that produced no segments still has to be answered, so the empty case skips
      // straight to the end rather than entering the loop with nothing to serve.
      .addConditionalEdges('segment', (state) => (state.segments.length > 0 ? 'serve' : 'finalize'), {
        serve: 'serve',
        finalize: 'finalize',
      })
      .addConditionalEdges(
        'serve',
        (state) => (state.cursor < state.segments.length ? 'serve' : 'finalize'),
        { serve: 'serve', finalize: 'finalize' },
      )
      .addEdge('finalize', END)
      .compile({ checkpointer })
  );
}

/**
 * The LangGraph conversation core (Conversation-Core-Comparison TDR §6).
 *
 * MCOS keeps everything either side of this class: channel adapters, ingestion and the
 * conversation lock upstream; capability services, the workflow registry and outbound delivery
 * downstream. What LangGraph owns is the *turn plan* — split the message, serve each request in
 * order, merge the replies — expressed as a checkpointed graph rather than a loop.
 *
 * The graph is deliberately sequential, not a `Send` fan-out. Two requests in one message are
 * not independent: the second must route against the registry as the first left it, or it
 * resumes a workflow that is no longer in focus, or starts a second copy of one just created.
 * Fanning out here would be using the framework's most attractive feature to produce a race.
 * That constraint comes from the domain, and it is the single most useful thing this branch has
 * to say about whether a graph framework helps with conversational chaos.
 */
@Injectable()
export class LangGraphConversationCore implements ConversationCorePort, OnModuleInit {
  private graph!: ReturnType<typeof buildTurnGraph>;
  /** Per-invocation context, keyed because it cannot be checkpointed. */
  private readonly contexts = new Map<string, TurnContext>();

  constructor(
    @Inject(SEGMENT_EXECUTOR) private readonly segmentExecutor: SegmentExecutorPort,
    @Inject(WORKFLOW_REPOSITORY) private readonly workflows: WorkflowRepositoryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly context: ConversationContextManager,
    private readonly segmenter: UtteranceSegmentationService,
    private readonly composer: ResponseComposer,
    private readonly delivery: ConversationDelivery,
    private readonly vendorResponses: VendorResponseHandler,
    private readonly checkpointer: TurnCheckpointer,
  ) {}

  onModuleInit(): void {
    this.graph = buildTurnGraph(
      {
        segment: (state, config) => this.segmentNode(state, config),
        serve: (state, config) => this.serveNode(state, config),
        finalize: (state, config) => this.finalizeNode(state, config),
      },
      this.checkpointer.instance,
    );
  }

  async handleTurn(input: ConversationTurnInput): Promise<ConversationTurnResult> {
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

    // REQ-TS-001 / REQ-TS-003. Kept in the core rather than in shared delivery because both
    // are tied to the lifetime of *this* turn, which is the one thing the two cores do not
    // share.
    await this.indicateTyping(conversation, message);
    const heartbeat = setTimeout(() => void this.sendHeartbeat(conversation, message), 25_000);

    try {
      if (text.trim().length === 0) {
        return await this.respondWithFallback(conversation, message, 'no_readable_content');
      }

      // A vendor answering a fanned-out request is decisive on its payload alone — no
      // understanding, no workflow, no graph.
      const vendorReply = await this.vendorResponses.tryHandle({
        conversation,
        interactivePayload: input.interactivePayload,
        text,
      });

      if (vendorReply !== null) {
        await this.delivery.send(conversation, vendorReply, null);
        await this.context.touch(conversation.id, message.channel);
        return { response: vendorReply, workflowId: null };
      }

      const contextKey = randomUUID();
      this.contexts.set(contextKey, {
        message,
        text,
        artifacts: input.artifacts,
        interactivePayload: input.interactivePayload,
        now,
        conversation,
      });

      let final: TurnGraphStateType;
      try {
        final = await this.graph.invoke(
          { conversationId: conversation.id },
          {
            configurable: {
              // One thread per *turn*, not per conversation. A conversation-scoped thread would
              // resume last turn's state — its cursor, its responses — into a fresh message.
              // Continuity across turns is the workflow registry's job, not the graph's.
              thread_id: `${conversation.id}:${message.id}`,
              [TURN_CONTEXT_KEY]: contextKey,
            },
            recursionLimit: 12,
          },
        );
      } finally {
        this.contexts.delete(contextKey);
      }

      if (final.lastWorkflowId === null) {
        return await this.respondWithFallback(
          conversation,
          message,
          final.unroutable ?? 'routing_produced_no_workflow',
        );
      }

      const response = this.composer.compose([...final.responses], {
        workflowId: final.lastWorkflowId,
      });

      await this.finalise({
        conversation,
        message,
        workflowId: final.lastWorkflowId,
        response,
        events: final.events,
      });

      const durationMs = this.clock.now().getTime() - now.getTime();
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { conversationId: conversation.id, messageId: message.id },
        action: `Completed turn processing in ${durationMs}ms (${(durationMs / 1000).toFixed(2)}s)`,
        output: {
          segments: final.segments.length,
          workflowId: final.lastWorkflowId,
          ...(final.unroutable !== null ? { unservedSegment: final.unroutable } : {}),
        },
        durationMs,
      });

      return { response, workflowId: final.lastWorkflowId };
    } catch (error) {
      return await this.handleInternalError(conversation, message, error);
    } finally {
      clearTimeout(heartbeat);
    }
  }

  async deliver(message: IncomingMessage, response: Response, workflowId: string | null): Promise<void> {
    await this.delivery.deliver(message, response, workflowId);
  }

  // ── Nodes ─────────────────────────────────────────────────────────────────────────────────

  /** Splits the message into the requests it carries. */
  private async segmentNode(
    _state: TurnGraphStateType,
    config: RunnableConfig,
  ): Promise<Partial<TurnGraphStateType>> {
    const turn = this.turnContext(config);

    const segments = await this.segmenter.segment({
      conversation: turn.conversation,
      text: turn.text,
      interactivePayload: turn.interactivePayload,
    });

    return { segments: segments.map((segment) => ({ ...segment })), cursor: 0 };
  }

  /**
   * Serves the segment at the cursor.
   *
   * Re-reads the conversation first for every segment after the first, so routing sees the
   * registry as the previous segment left it.
   */
  private async serveNode(
    state: TurnGraphStateType,
    config: RunnableConfig,
  ): Promise<Partial<TurnGraphStateType>> {
    const turn = this.turnContext(config);
    const segment = state.segments[state.cursor];

    if (segment === undefined) return { cursor: state.cursor + 1 };

    if (segment.index > 0) {
      const reloaded = await this.context.load({
        userId: turn.message.userId,
        channel: turn.message.channel,
      });
      turn.conversation = reloaded.conversation;
    }

    const result = await this.segmentExecutor.executeSegment({
      conversation: turn.conversation,
      segment,
      artifacts: turn.artifacts,
      interactivePayload: turn.interactivePayload,
      now: turn.now,
    });

    if ('unroutable' in result) {
      // One unservable request must not sink the rest of the turn.
      return { cursor: state.cursor + 1, unroutable: result.unroutable };
    }

    return {
      cursor: state.cursor + 1,
      responses: result.outcome.responses,
      events: result.outcome.events,
      lastWorkflowId: result.outcome.instance.id,
      failed: result.outcome.failed,
    };
  }

  /** Adds the invitation back to a parked objective, if there is one. */
  private async finalizeNode(
    _state: TurnGraphStateType,
    config: RunnableConfig,
  ): Promise<Partial<TurnGraphStateType>> {
    const turn = this.turnContext(config);
    const nudge = await this.resumeNudge(turn.conversation.id, turn.now);

    return nudge === null ? {} : { responses: [nudge] };
  }

  // ── Support ───────────────────────────────────────────────────────────────────────────────

  private turnContext(config: RunnableConfig): TurnContext {
    const key = config.configurable?.[TURN_CONTEXT_KEY] as string | undefined;
    const turn = key === undefined ? undefined : this.contexts.get(key);

    if (turn === undefined) {
      // Only reachable if a checkpointed turn were resumed in a later process, where the
      // in-memory context is gone. Failing loudly beats running a turn against a context
      // belonging to somebody else.
      throw new Error('Turn context is not available; the graph cannot run detached from a turn.');
    }

    return turn;
  }

  /**
   * Invitation to resume a parked objective, or null when there is nothing to resume.
   *
   * Same rule as the other core: offered when nothing is in focus, read from the registry
   * rather than from whichever workflow the turn last touched.
   */
  private async resumeNudge(conversationId: string, now: Date): Promise<Response | null> {
    const [active, suspended] = await Promise.all([
      this.workflows.listByStatus(conversationId, 'active'),
      this.workflows.listByStatus(conversationId, 'suspended'),
    ]);

    if (active.some((candidate) => canResume(candidate, now))) return null;

    const resumable = suspended.filter((candidate) => canResume(candidate, now));
    if (resumable.length === 0) return null;

    const [target] = [...resumable].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    const label = target.summary.trim();

    return {
      text:
        label.length > 0
          ? `Before that — shall we carry on with what we started?\n\n_${label.slice(0, 120)}_`
          : 'Shall we carry on with what we were doing before?',
      actions: [
        {
          type: 'resume',
          title: 'Yes, continue',
          payload: encodeActionPayload({ workflowId: target.id, action: 'resume' }),
          ...(label.length > 0 ? { description: label.slice(0, 72) } : {}),
        },
      ],
      metadata: { nudge: 'resume_suspended', resumeWorkflowId: target.id },
    };
  }

  private async finalise(params: {
    conversation: Conversation;
    message: IncomingMessage;
    workflowId: string;
    response: Response;
    events: readonly DomainEvent[];
  }): Promise<void> {
    const instance = await this.workflows.findById(params.workflowId);

    // Clear the active pointer once the objective is finished, so the next message is not read
    // as continuing something that is over.
    if (instance !== null && TERMINAL_STATUSES.includes(instance.status)) {
      await this.workflows.setActiveWorkflow(params.conversation.id, null);
    }

    await this.delivery.send(params.conversation, params.response, params.workflowId);

    if (params.events.length > 0) await this.events.publishAll([...params.events]);

    await this.context.touch(params.conversation.id, params.message.channel);
  }

  private async respondWithFallback(
    conversation: Conversation,
    message: IncomingMessage,
    reason: string,
  ): Promise<ConversationTurnResult> {
    const response = fallbackWithReason(reason);

    this.logger.stageFailed({
      component: COMPONENT,
      stage: STAGE,
      input: { conversationId: conversation.id, messageId: message.id },
      action: 'Turn could not be handled; returning the fallback envelope',
      error: new Error(reason),
    });

    await this.delivery.send(conversation, response, null);

    return { response, workflowId: null };
  }

  private async handleInternalError(
    conversation: Conversation,
    message: IncomingMessage,
    error: unknown,
  ): Promise<ConversationTurnResult> {
    this.logger.stageFailed({
      component: COMPONENT,
      stage: STAGE,
      input: { conversationId: conversation.id, messageId: message.id },
      action: 'Internal processing error during the turn; sending an honest error response',
      error: error instanceof Error ? error : new Error(String(error)),
    });

    const response: Response = {
      text: "I'm so sorry, I ran into an unexpected technical issue while processing your request. Please forgive me—could you please try sending your message again in a moment?",
      metadata: { error: 'internal_processing_failure' },
    };

    await this.delivery.send(conversation, response, null);

    return { response, workflowId: null };
  }

  /** REQ-TS-001: best-effort typing signal on channels that support one. */
  private async indicateTyping(conversation: Conversation, message: IncomingMessage): Promise<void> {
    const channel = conversation.lastChannel;
    if (!this.notifiers.supports(channel)) return;

    const notifier = this.notifiers.forChannel(channel);
    if (notifier.indicateTyping === undefined) return;

    const providerMessageId = (message.metadata?.[PROVIDER_MESSAGE_ID_KEY] ??
      message.metadata?.providerMessageId ??
      message.id) as string | undefined;

    try {
      await notifier.indicateTyping({
        channel,
        address: conversation.userId,
        conversationId: conversation.id,
        ...(providerMessageId !== undefined ? { messageId: providerMessageId } : {}),
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

  /** REQ-TS-003: interim progress update once a turn passes 25 seconds. */
  private async sendHeartbeat(conversation: Conversation, message: IncomingMessage): Promise<void> {
    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Heartbeat`,
      input: { conversationId: conversation.id, messageId: message.id },
      action: 'Turn reached 25s; sending an interim update and re-triggering the typing status',
      output: { heartbeatSent: true },
    });

    await this.delivery.send(
      conversation,
      {
        text: "I'm still working on your request! Thank you for your patience—I'll have your results ready in a moment.",
        metadata: { heartbeat: '25s_threshold_update' },
      },
      null,
    );

    await this.indicateTyping(conversation, message);
  }
}
