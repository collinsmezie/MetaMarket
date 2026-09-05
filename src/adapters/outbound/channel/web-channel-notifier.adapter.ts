import { Inject, Injectable } from '@nestjs/common';
import type { Channel } from '../../../domain/models/channel';
import type { Response } from '../../../domain/models/response';
import type {
  ChannelNotifierPort,
  DeliveryResult,
  DeliveryTarget,
  TypingTarget,
} from '../../../domain/ports/outbound/channel-notifier.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import { CLOCK, type ClockPort } from '../../../domain/ports/outbound/system.port';
import { WebStreamHub } from './web-stream.hub';

const COMPONENT = 'MCOS';
const STAGE = 'WebChannelNotifier';

/**
 * Outbound delivery for the web client (ADR-001 outbound adapter).
 *
 * Unlike WhatsApp there is no provider to accept custody of the message — the only recipient
 * is a browser holding an SSE connection, and a browser can close at any moment. So a
 * publish that reaches nobody is reported as a *retryable* failure rather than a success.
 * Wrapped in {@link DurableChannelNotifier}, that gives the web channel the same guarantee as
 * an unreachable Graph API: the reply is written down, ordered, and delivered when the client
 * reconnects. Reporting it as delivered would lose exactly the messages a user most needs —
 * the ones that arrived while their laptop was asleep.
 */
@Injectable()
export class WebChannelNotifier implements ChannelNotifierPort {
  readonly channel: Channel = 'web';

  constructor(
    private readonly hub: WebStreamHub,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async send(target: DeliveryTarget, response: Response): Promise<DeliveryResult> {
    const workflowId = response.metadata?.workflowId;

    try {
      const receivers = await this.hub.publish({
        kind: 'message',
        conversationId: target.conversationId,
        response,
        ...(typeof workflowId === 'string' ? { workflowId } : {}),
        at: this.clock.now().toISOString(),
      });

      if (receivers > 0) return { delivered: true, messageCount: 1 };

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { conversationId: target.conversationId },
        action: 'No web client is currently listening; the reply will be delivered on reconnect',
        output: { delivered: false, receivers },
      });

      return {
        delivered: false,
        retryable: true,
        error: 'no active web subscriber',
      };
    } catch (error) {
      // Redis being unreachable is transient by nature, so this is safe to repeat: nothing
      // was published, therefore nothing can be duplicated.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { conversationId: target.conversationId },
        action: 'Could not publish to the web stream; queueing for retry',
        error,
      });

      return {
        delivered: false,
        retryable: true,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Mirrors the WhatsApp typing indicator (REQ-TS-001).
   *
   * Best-effort and unqueued: a typing hint that arrives after the reply it was predicting is
   * worse than no hint at all, so an absent listener is simply dropped.
   */
  async indicateTyping(target: TypingTarget): Promise<void> {
    try {
      await this.hub.publish({
        kind: 'typing',
        conversationId: target.conversationId,
        at: this.clock.now().toISOString(),
      });
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Typing`,
        input: { conversationId: target.conversationId },
        action: 'Could not publish the typing indicator',
        error,
      });
    }
  }
}
