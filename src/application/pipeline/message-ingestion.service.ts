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
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import { ConversationContextManager } from '../conversation/conversation-context.manager';
import { MediaProcessingService } from '../media/media-processing.service';
import { TurnProcessor } from './turn-processor.service';

const COMPONENT = 'MCOS';
const STAGE = 'MessageIngestion';

/**
 * Entry point for every inbound message, on every channel (MCOS §14).
 *
 * Responsibilities are deliberately narrow: deduplicate, persist, decide whether the turn
 * can run now or must wait for media, and hand off to {@link TurnProcessor} under the
 * conversation lock.
 */
@Injectable()
export class MessageIngestionService implements HandleIncomingMessagePort {
  constructor(
    @Inject(MESSAGE_REPOSITORY) private readonly messages: MessageRepositoryPort,
    @Inject(MEDIA_PROCESSING_QUEUE) private readonly mediaQueue: MediaProcessingQueuePort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly context: ConversationContextManager,
    private readonly media: MediaProcessingService,
    private readonly turns: TurnProcessor,
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
    const text = collectText(artifacts);
    const interactivePayload = this.interactivePayloadOf(message);

    const outcome = await this.context.withLock(message.conversationId, async () =>
      this.turns.process({ message, artifacts, text, interactivePayload }),
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

    await this.turns.deliver(message, response, null);
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
