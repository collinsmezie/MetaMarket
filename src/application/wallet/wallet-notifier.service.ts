import { Inject, Injectable } from '@nestjs/common';
import { koboToNairaLabel } from '../../domain/models/credit';
import type { Response } from '../../domain/models/response';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  type ChannelNotifierRegistryPort,
} from '../../domain/ports/outbound/channel-notifier.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { ConversationContextManager } from '../conversation/conversation-context.manager';

const COMPONENT = 'Wallet';
const STAGE = 'WalletNotifier';

/**
 * Sends the payment confirmation (Konnet Credits Recharge TDR §12).
 *
 * This is the one place outside the conversation pipeline that pushes a message, and the
 * exception is justified: the confirmation is system-initiated by a bank transfer, not a reply
 * to anything the user said. It composes a canonical `Response` and lets the channel adapter
 * render it, so WhatsApp's length and formatting rules are not duplicated here.
 */
@Injectable()
export class WalletNotifier {
  constructor(
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly context: ConversationContextManager,
  ) {}

  /**
   * Confirms a credit to the user.
   *
   * Best-effort by contract: the money is already committed, so a failed push must never
   * propagate. The balance is visible on their next "Recharge" either way.
   */
  async notifyCredited(params: {
    userId: string;
    conversationId: string;
    credits: number;
    amountKobo: number;
    balanceAfter: number;
  }): Promise<void> {
    const response: Response = {
      text: [
        '✅ Payment Received',
        '',
        `${koboToNairaLabel(params.amountKobo)} has been received.`,
        '',
        `${params.credits} Credits have been added.`,
        '',
        'Current Balance:',
        `${params.balanceAfter} Credits`,
      ].join('\n'),
      metadata: { walletConfirmation: true },
    };

    try {
      if (!this.notifiers.supports('whatsapp')) {
        this.logger.stageFailed({
          component: COMPONENT,
          stage: STAGE,
          input: { userId: params.userId },
          action: 'No WhatsApp notifier is registered; the credit confirmation cannot be delivered',
          error: new Error('Unsupported channel: whatsapp'),
        });
        return;
      }

      const result = await this.notifiers
        .forChannel('whatsapp')
        .send(
          { channel: 'whatsapp', address: params.userId, conversationId: params.conversationId },
          response,
        );

      if (!result.delivered) {
        this.logger.stageFailed({
          component: COMPONENT,
          stage: STAGE,
          input: { userId: params.userId, credits: params.credits },
          action: 'Channel rejected the credit confirmation; the credit itself is unaffected',
          error: new Error(result.error ?? 'unknown delivery failure'),
        });
        return;
      }

      // Recorded so the next turn's context includes what the platform told them.
      await this.context.recordAssistantTurn({
        conversationId: params.conversationId,
        channel: 'whatsapp',
        content: response.text ?? '',
      });

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { userId: params.userId, credits: params.credits },
        action: 'Sent the credit confirmation',
        output: { balanceAfter: params.balanceAfter },
      });
    } catch (error) {
      // Never rethrow: rolling back a committed credit because a message failed would be far
      // worse than a missing notification.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { userId: params.userId },
        action: 'Credit confirmation failed unexpectedly; the credit is already committed',
        error,
      });
    }
  }
}
