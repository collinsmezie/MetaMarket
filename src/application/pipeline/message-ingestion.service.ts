import { Inject, Injectable } from '@nestjs/common';
import type { Artifact } from '../../domain/models/artifact';
import { collectText } from '../../domain/models/artifact';
import type { IncomingMessage } from '../../domain/models/incoming-message';
import {
  isInteractiveReplyPart,
  PROVIDER_MESSAGE_ID_KEY,
  requiresMediaProcessing,
} from '../../domain/models/incoming-message';
import type { Response } from '../../domain/models/response';
import { fallbackWithReason } from '../../domain/models/response';
import type {
  HandleIncomingMessagePort,
  HandleIncomingMessageResult,
} from '../../domain/ports/inbound/handle-incoming-message.port';
import {
  ConversationEvents,
  EVENT_PUBLISHER,
  type DomainEvent,
  type EventPublisherPort,
} from '../../domain/ports/outbound/event-publisher.port';
import {
  MEDIA_PROCESSING_QUEUE,
  type MediaProcessingQueuePort,
} from '../../domain/ports/outbound/media.port';
import {
  MESSAGE_REPOSITORY,
  type MessageRepositoryPort,
} from '../../domain/ports/outbound/message-repository.port';
import {
  OUTBOUND_MESSAGE_REPOSITORY,
  type OutboundMessageRepositoryPort,
} from '../../domain/ports/outbound/outbound-message-repository.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import { decodeReplayPayload } from '../../domain/workflows/action-payload';
import { ConversationContextManager } from '../conversation/conversation-context.manager';
import { MediaProcessingService } from '../media/media-processing.service';
import {
  CONVERSATION_CORE,
  type ConversationCorePort,
} from '../../domain/ports/inbound/conversation-core.port';

const COMPONENT = 'MCOS';
const STAGE = 'MessageIngestion';

/**
 * Entry point for every inbound message, on every channel (MCOS §14).
 *
 * Responsibilities are deliberately narrow: deduplicate, persist, decide whether the turn
 * can run now or must wait for media, and hand off to the conversation core under the
 * conversation lock.
 */
@Injectable()
export class MessageIngestionService implements HandleIncomingMessagePort {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
    @Inject(OUTBOUND_MESSAGE_REPOSITORY) private readonly outbound: OutboundMessageRepositoryPort,
    @Inject(MEDIA_PROCESSING_QUEUE) private readonly mediaQueue: MediaProcessingQueuePort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly context: ConversationContextManager,
    private readonly media: MediaProcessingService,
    @Inject(CONVERSATION_CORE) private readonly core: ConversationCorePort,
  ) {}

  async handle(incoming: IncomingMessage): Promise<HandleIncomingMessageResult> {
    const startedAt = Date.now();

    // Adapters know a phone number, not a conversation id, so the platform resolves it here
    // before anything is persisted against it.
    const conversationId = await this.context.resolveConversationId({
      userId: incoming.userId,
      channel: incoming.channel,
    });

    const message: IncomingMessage = { ...incoming, conversationId };

    const stored = await this.messages.saveIncoming(message);

    if (!stored) {
      // Meta retries webhooks it believes were not acknowledged. Re-running the turn could
      // duplicate a workflow or double-charge a vendor, so a duplicate is a no-op.
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { providerMessageId: message.metadata[PROVIDER_MESSAGE_ID_KEY] },
        action: 'Ignored a duplicate webhook delivery for a message already recorded',
        output: { deduplicated: true },
        durationMs: Date.now() - startedAt,
      });

      return {
        conversationId: message.conversationId,
        response: null,
        workflowId: null,
        deduplicated: true,
        deferred: false,
      };
    }

    await this.publish({
      eventType: ConversationEvents.MessageReceived,
      conversationId: message.conversationId,
      payload: {
        messageId: message.id,
        channel: message.channel,
        partTypes: message.parts.map((part) => part.type),
      },
    });

    const inlineArtifacts = this.media.extractInlineArtifacts(message);
    await this.messages.appendArtifacts(message.id, inlineArtifacts);

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: {
        messageId: message.id,
        channel: message.channel,
        parts: message.parts.map((part) => part.type),
      },
      action: 'Persisted the canonical message and extracted inline artifacts',
      output: {
        inlineArtifacts: inlineArtifacts.length,
        requiresMedia: requiresMediaProcessing(message),
      },
      durationMs: Date.now() - startedAt,
    });

    // Heavy media work must not block the webhook (MCOS §20). The turn resumes in
    // `resumeAfterMedia` once every media part has produced its artifacts.
    if (requiresMediaProcessing(message)) {
      for (const job of this.media.mediaJobsFor(message)) {
        await this.mediaQueue.enqueue(job);
      }

      return {
        conversationId: message.conversationId,
        response: null,
        workflowId: null,
        deduplicated: false,
        deferred: true,
      };
    }

    return this.runTurn(message, inlineArtifacts);
  }

  /**
   * Continues a turn that was parked awaiting media processing.
   *
   * Called by the media worker once the last outstanding job for the message completes.
   */
  async resumeAfterMedia(messageId: string): Promise<HandleIncomingMessageResult | null> {
    const message = await this.messages.findById(messageId);

    if (message === null) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:ResumeAfterMedia`,
        input: { messageId },
        action: 'Cannot resume a turn for a message that is no longer stored',
        error: new Error(`Message ${messageId} not found`),
      });
      return null;
    }

    // Guards against two media jobs finishing simultaneously and both resuming the turn.
    if (await this.messages.isProcessed(messageId)) return null;

    const artifacts = await this.messages.loadArtifacts(messageId);

    await this.publish({
      eventType: ConversationEvents.MediaProcessed,
      conversationId: message.conversationId,
      payload: { messageId, artifactCount: artifacts.length },
    });

    return this.runTurn(message, artifacts);
  }

  /**
   * Runs the conversation turn under the conversation lock.
   *
   * The lock guarantees a single worker owns the conversation for the duration, which is
   * what makes horizontal scaling safe (MCOS §20).
   */
  private async runTurn(
    message: IncomingMessage,
    artifacts: readonly Artifact[],
  ): Promise<HandleIncomingMessageResult> {
    const chosen = await this.resolveChoice(message, collectText(artifacts));

    const outcome = await this.context.withLock(message.conversationId, async () =>
      this.core.handleTurn({
        message,
        artifacts,
        text: chosen.text,
        interactivePayload: chosen.interactivePayload,
      }),
    );

    if (outcome === null) {
      // Another worker holds this conversation. Telling the user to retry is honest and
      // avoids interleaving two half-processed turns.
      const response = fallbackWithReason('conversation_locked');

      await this.deliverLockFailure(message, response);

      return {
        conversationId: message.conversationId,
        response,
        workflowId: null,
        deduplicated: false,
        deferred: false,
      };
    }

    await this.messages.markProcessed(message.id, this.clock.now());

    return {
      conversationId: message.conversationId,
      response: outcome.response,
      workflowId: outcome.workflowId,
      deduplicated: false,
      deferred: false,
    };
  }

  private async deliverLockFailure(message: IncomingMessage, response: Response): Promise<void> {
    this.logger.stageFailed({
      component: COMPONENT,
      stage: STAGE,
      input: { conversationId: message.conversationId, messageId: message.id },
      action: 'Could not obtain the conversation lock; asking the user to retry shortly',
      error: new Error('Conversation lock unavailable'),
    });

    await this.core.deliver(message, response, null);
  }

  /**
   * Resolves an answer that names one of the options the platform last offered.
   *
   * Two shapes reach here. A *tapped* suggestion carries a replay payload, which grants no
   * authority over any workflow — the option's words are the whole message, so the payload is
   * dropped and the text routes normally. A *typed* answer may be just a number, because on
   * WhatsApp the options are numbered in the message body and replying "2" is the natural thing
   * to do.
   *
   * Resolution is deliberately narrow: only a bare number, and only within the range actually
   * offered. "2" on its own is a choice; "2 cartons" is a quantity, and treating it as a menu
   * selection would silently answer a question the user was not answering.
   */
  private async resolveChoice(
    message: IncomingMessage,
    text: string,
  ): Promise<{ text: string; interactivePayload: string | null }> {
    const payload = this.interactivePayloadOf(message);

    const replayed = payload === null ? null : decodeReplayPayload(payload);
    if (replayed !== null) {
      // The button title already arrived as the message text; prefer the payload only if the
      // channel sent no title with it.
      return { text: text.trim().length > 0 ? text : replayed, interactivePayload: null };
    }

    if (payload !== null) return { text, interactivePayload: payload };

    const choice = await this.resolveNumberedChoice(message.conversationId, text);
    return choice === null ? { text, interactivePayload: null } : { text: choice, interactivePayload: null };
  }

  /** The label the user's number refers to, or null when the reply is not a bare choice. */
  private async resolveNumberedChoice(conversationId: string, text: string): Promise<string | null> {
    const trimmed = text.trim();
    if (!/^\d{1,2}[.)]?$/.test(trimmed)) return null;

    const index = Number.parseInt(trimmed, 10) - 1;
    if (index < 0) return null;

    let last;
    try {
      last = await this.outbound.latestForConversation(conversationId);
    } catch (error) {
      // A lookup failure must not swallow the user's message: it simply goes through as typed.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Choice`,
        input: { conversationId, reply: trimmed },
        action: 'Could not read the last offered options; treating the reply as plain text',
        error,
      });
      return null;
    }

    const options = last?.response.actions ?? [];
    const option = options[index];

    if (option === undefined) return null;

    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Choice`,
      input: { conversationId, reply: trimmed },
      action: `Read "${trimmed}" as the offered option "${option.title}"`,
      output: { option: option.title, offered: options.length },
    });

    return option.title;
  }

  private interactivePayloadOf(message: IncomingMessage): string | null {
    const part = message.parts.find(isInteractiveReplyPart);
    return part === undefined ? null : part.payload;
  }

  private async publish(params: {
    eventType: string;
    conversationId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const event: DomainEvent = {
      eventId: this.ids.uuid(),
      eventType: params.eventType,
      timestamp: this.clock.now(),
      producer: 'ConversationOS',
      conversationId: params.conversationId,
      payload: params.payload,
    };

    await this.events.publish(event);
  }
}
