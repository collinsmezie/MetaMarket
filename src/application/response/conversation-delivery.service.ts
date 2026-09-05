import { Inject, Injectable } from '@nestjs/common';
import type { Conversation } from '../../domain/models/conversation';
import type { IncomingMessage } from '../../domain/models/incoming-message';
import type { Response } from '../../domain/models/response';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  isAccepted,
  type ChannelNotifierRegistryPort,
} from '../../domain/ports/outbound/channel-notifier.port';
import {
  ConversationEvents,
  EVENT_PUBLISHER,
  type EventPublisherPort,
} from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import { ConversationContextManager } from '../conversation/conversation-context.manager';

const COMPONENT = 'MCOS';
const STAGE = 'ConversationDelivery';

/**
 * Sends a composed response to the user and records that it was said.
 *
 * Extracted from the turn processor because it is not orchestration: it belongs to whichever
 * conversation core is running, and there are two of them under comparison. Duplicating it
 * would duplicate the parts that are easy to get subtly wrong — that a queued reply still
 * counts as said, that a delivery failure must not roll back committed workflow state — and a
 * difference in *those* would contaminate a comparison meant to be about routing.
 */
@Injectable()
export class ConversationDelivery {
  constructor(
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly context: ConversationContextManager,
  ) {}

  /** Delivers a response on the channel the user is currently using and records it in history. */
  async send(conversation: Conversation, response: Response, workflowId: string | null): Promise<void> {
    const channel = conversation.lastChannel;

    if (!this.notifiers.supports(channel)) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
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
        stage: STAGE,
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
      stage: STAGE,
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

  async publishEvent(
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
}
