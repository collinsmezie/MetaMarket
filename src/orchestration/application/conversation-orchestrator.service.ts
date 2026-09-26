import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ConversationContextManager } from '../../application/conversation/conversation-context.manager';
import { ConversationDelivery } from '../../application/response/conversation-delivery.service';
import type { ConversationWorkingContext, TurnInputState } from '../../conversation/domain/turn-context';
import type { TurnOrchestratorPort, TurnOutcome } from '../../conversation/ports/turn-orchestrator.port';
import type { Channel } from '../../domain/models/channel';
import type { Conversation } from '../../domain/models/conversation';
import { fallbackWithReason } from '../../domain/models/response';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  type ChannelNotifierRegistryPort,
} from '../../domain/ports/outbound/channel-notifier.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { CLOCK, type ClockPort } from '../../domain/ports/outbound/system.port';
import { decodeReplayPayload } from '../../domain/workflows/action-payload';
import {
  SEMANTIC_RESOLUTION_REPOSITORY,
  type SemanticResolutionRepositoryPort,
} from '../../semantics/ports/semantic-resolution.repository.port';
import { EMPTY_EXECUTION, EMPTY_PLAN } from '../domain/action-plan';
import { EMPTY_UNDERSTANDING } from '../domain/unified-understanding';
import { ConversationCheckpointer } from './conversation-checkpointer.provider';
import { ConversationGraphNodes } from './conversation-graph.nodes';
import { buildConversationGraph, type ConversationGraph } from './graph/conversation.graph';
import {
  NO_FAST_PATH,
  PENDING_SLOT,
  RUN_CONTEXT_KEY,
  type ConversationGraphStateType,
  type GraphWorkingContext,
} from './graph/conversation-graph.state';
import { OrchestrationPrompts } from './orchestration-prompts';

const COMPONENT = 'LANGGRAPH';
const STAGE = 'ConversationOrchestrator';
/** REQ-TS-003 / MCOS §45: interim progress message once a turn passes this threshold. */
const HEARTBEAT_MS = 25_000;
const RECURSION_LIMIT = 60;

/**
 * The v4.4 conversation orchestrator bound to MCOS's `TURN_ORCHESTRATOR` seam (MCOS TDR §8–§11,
 * §45–§47, §56 phases 3–7, §57).
 *
 * MCOS calls it once per sealed logical turn with the conversation lock held. It records the
 * user turn, runs the LangGraph conversation graph on the conversation-scoped thread with an
 * explicit per-turn envelope, keeps the user informed on slow turns, contains any failure into
 * one honest fallback, and returns the durable turn outcome. Delivery happens inside the graph
 * through the existing durable path (§46), so a returned outcome means the outbound command
 * was accepted.
 */
@Injectable()
export class ConversationOrchestrator implements TurnOrchestratorPort {
  private compiled: ConversationGraph | null = null;

  constructor(
    private readonly nodes: ConversationGraphNodes,
    private readonly checkpointer: ConversationCheckpointer,
    private readonly prompts: OrchestrationPrompts,
    private readonly conversations: ConversationContextManager,
    private readonly delivery: ConversationDelivery,
    @Inject(SEMANTIC_RESOLUTION_REPOSITORY) private readonly semantics: SemanticResolutionRepositoryPort,
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  private graph(): ConversationGraph {
    if (this.compiled === null) {
      this.prompts.register();
      this.compiled = buildConversationGraph(this.nodes, this.checkpointer.instance);
    }
    return this.compiled;
  }

  async runTurn(input: TurnInputState, context: ConversationWorkingContext): Promise<TurnOutcome> {
    const startedAt = this.clock.now();
    const loaded = await this.conversations.loadById(input.conversationId);
    if (loaded === null)
      return failed('CONVERSATION_NOT_FOUND', 'Conversation not found for the logical turn');
    // The reply goes back on the channel this turn arrived on (MCOS §24): a user who started on
    // WhatsApp and continues in the browser is answered in the browser. The stored record is
    // touched so later out-of-turn deliveries (vendor replies, heartbeats) follow them too.
    const conversation = await this.withActiveChannel(loaded.conversation, input);

    await this.recordUserTurn(conversation, input);
    await this.indicateTyping(conversation, input);
    const heartbeat = setTimeout(() => void this.sendHeartbeat(conversation, input), HEARTBEAT_MS);

    const runKey = randomUUID();
    this.nodes.registerRun(runKey, { input, context, conversation, now: startedAt });

    try {
      const graph = this.graph();
      const config = {
        configurable: { thread_id: `conversation:${input.conversationId}`, [RUN_CONTEXT_KEY]: runKey },
        recursionLimit: RECURSION_LIMIT,
      };

      // §47: a retried turn recognises the actions it already committed instead of running them twice.
      const prior = await graph.getState(config).catch(() => null);
      const sameTurn = prior?.values?.turnId === input.turnId;
      const carriedExecution = sameTurn
        ? (prior!.values as ConversationGraphStateType).execution
        : EMPTY_EXECUTION;
      const carriedArtifacts = sameTurn ? (prior!.values as ConversationGraphStateType).artifacts : [];

      const final = (await graph.invoke(
        {
          conversationId: input.conversationId,
          turnId: input.turnId,
          runId: input.runId,
          input,
          context: toGraphContext(context),
          effectiveText: '',
          effectivePayload: null,
          fastPath: NO_FAST_PATH,
          idce: PENDING_SLOT,
          csre: PENDING_SLOT,
          enrichment: PENDING_SLOT,
          gpc: PENDING_SLOT,
          understanding: EMPTY_UNDERSTANDING,
          plan: EMPTY_PLAN,
          execution: { ...carriedExecution, runningActionIds: [] },
          artifacts: carriedArtifacts,
          clarification: null,
          response: { composed: null, delivered: false, source: 'NONE' },
          recovery: [],
          lifecycle: { status: 'RUNNING', nodes: [] },
        },
        config,
      )) as ConversationGraphStateType;

      const outcome = await this.toOutcome(final);
      const durationMs = this.clock.now().getTime() - startedAt.getTime();
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { turnId: input.turnId, text: final.effectiveText, retriedSameTurn: sameTurn },
        action: `Orchestrated the logical turn → ${outcome.status} in ${durationMs}ms`,
        output: {
          fastPath: final.fastPath.kind,
          intents: outcome.intentTypes,
          plan: final.plan.actions.map(
            (action) => `${action.workflowType ?? '-'}:${action.operation}:${action.status}`,
          ),
          planSource: final.plan.source,
          clarification: final.clarification?.outcome ?? null,
          responseSource: final.response.source,
          workflowIds: outcome.workflowIds,
        },
        durationMs,
      });
      return outcome;
    } catch (error) {
      return this.containFailure(conversation, input, error);
    } finally {
      clearTimeout(heartbeat);
      this.nodes.releaseRun(runKey);
    }
  }

  private async toOutcome(final: ConversationGraphStateType): Promise<TurnOutcome> {
    const results = final.execution.results;
    const workflowIds = [
      ...new Set(results.map((result) => result.workflowId).filter((id): id is string => id !== null)),
    ];
    const intentTypes = final.understanding.idce?.intents.map((intent) => intent.type) ?? [];
    const objectIds =
      final.understanding.csreRequestId === null
        ? []
        : (await this.semantics.objectsForRequest(final.understanding.csreRequestId).catch(() => [])).map(
            (object) => object.id,
          );
    const response = final.response.composed;
    const failedResult = results.find((result) => result.status === 'FAILED');
    const recovery = final.recovery[final.recovery.length - 1];

    return {
      status: final.lifecycle.status === 'RUNNING' ? 'COMMITTED' : final.lifecycle.status,
      responses: response === null ? [] : [response],
      responseIds: [],
      workflowIds,
      intentTypes,
      objectIds,
      summary: (response?.text ?? '').slice(0, 240),
      error:
        final.lifecycle.status === 'FAILED'
          ? {
              code: recovery?.code ?? failedResult?.error?.code ?? 'TURN_FAILED',
              message: recovery?.message ?? failedResult?.error?.message ?? 'Turn failed',
              retryable: false,
            }
          : null,
    };
  }

  /** §44: an orchestration failure degrades to one honest reply; the conversation record stays intact. */
  private async containFailure(
    conversation: Conversation,
    input: TurnInputState,
    error: unknown,
  ): Promise<TurnOutcome> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.stageFailed({
      component: COMPONENT,
      stage: STAGE,
      input: { turnId: input.turnId },
      action: 'Conversation graph failed; delivering the fallback envelope',
      error,
    });
    const response = fallbackWithReason('orchestrator_internal_error');
    try {
      await this.delivery.send(conversation, response, null);
    } catch (deliveryError) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Fallback`,
        input: { turnId: input.turnId },
        action: 'Fallback delivery failed too',
        error: deliveryError,
      });
    }
    return {
      status: 'FAILED',
      responses: [response],
      responseIds: [],
      workflowIds: [],
      intentTypes: [],
      objectIds: [],
      summary: response.text ?? '',
      error: { code: 'ORCHESTRATOR_INTERNAL_ERROR', message, retryable: false },
    };
  }

  /** History is MCOS-owned; the assembled logical turn is one user entry (deduplicated on retry). */
  private async withActiveChannel(conversation: Conversation, input: TurnInputState): Promise<Conversation> {
    const channel = input.channel as Channel;
    if (conversation.lastChannel === channel) return conversation;
    await this.conversations.touch(conversation.id, channel).catch((error: unknown) =>
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Channel`,
        input: { conversationId: conversation.id, from: conversation.lastChannel, to: channel },
        action: 'Could not record the channel switch; replying on the new channel regardless',
        error,
      }),
    );
    return { ...conversation, lastChannel: channel };
  }

  private async recordUserTurn(conversation: Conversation, input: TurnInputState): Promise<void> {
    const payload =
      [...input.currentMessages].reverse().find((message) => message.interactivePayload !== null)
        ?.interactivePayload ?? null;
    const text =
      input.assembledText.trim().length > 0
        ? input.assembledText.trim()
        : payload === null
          ? ''
          : (decodeReplayPayload(payload) ?? '');
    if (text.length === 0) return;
    const last = conversation.history[conversation.history.length - 1];
    if (last !== undefined && last.role === 'user' && last.content === text) return;
    await this.conversations.recordUserTurn({
      conversationId: conversation.id,
      channel: input.channel as Channel,
      content: text,
    });
  }

  private async indicateTyping(conversation: Conversation, input: TurnInputState): Promise<void> {
    const channel = conversation.lastChannel;
    if (!this.notifiers.supports(channel)) return;
    const notifier = this.notifiers.forChannel(channel);
    if (notifier.indicateTyping === undefined) return;
    const last = input.currentMessages[input.currentMessages.length - 1];
    const messageId = last?.providerEventId ?? last?.messageId;
    try {
      await notifier.indicateTyping({
        channel,
        address: conversation.userId,
        conversationId: conversation.id,
        ...(messageId !== undefined ? { messageId } : {}),
      });
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Typing`,
        input: { conversationId: conversation.id, channel },
        action: 'Failed to signal typing status indicator',
        error,
      });
    }
  }

  private async sendHeartbeat(conversation: Conversation, input: TurnInputState): Promise<void> {
    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Heartbeat`,
      input: { conversationId: conversation.id, turnId: input.turnId },
      action: `Turn passed ${HEARTBEAT_MS / 1000}s; refreshing typing indicator`,
      output: { heartbeatSent: true },
    });
    await this.indicateTyping(conversation, input);
  }
}

function toGraphContext(context: ConversationWorkingContext): GraphWorkingContext {
  const pending = context.pendingClarification;
  return {
    ...context,
    pendingClarification:
      pending === null
        ? null
        : {
            clarificationId: pending.clarificationId,
            originatingTurnId: pending.originatingTurnId,
            question: pending.question,
            targetActionIds: pending.targetActionIds,
            targetIntentIds: pending.targetIntentIds,
            blocking: pending.blocking,
            status: pending.status,
            issueKey: pending.issueKey,
            askedAt: pending.askedAt.toISOString(),
            expectedResolution: pending.expectedResolution,
          },
  };
}

function failed(code: string, message: string): TurnOutcome {
  return {
    status: 'FAILED',
    responses: [],
    responseIds: [],
    workflowIds: [],
    intentTypes: [],
    objectIds: [],
    summary: '',
    error: { code, message, retryable: false },
  };
}
