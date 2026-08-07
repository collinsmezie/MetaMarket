import { Inject, Injectable } from '@nestjs/common';
import { koboToNairaLabel } from '../../domain/models/credit';
import type { Response } from '../../domain/models/response';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  isAccepted,
  type ChannelNotifierRegistryPort,
} from '../../domain/ports/outbound/channel-notifier.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { encodeActionPayload } from '../../domain/workflows/action-payload';
import { SYSTEM_WORKFLOW_ID } from '../../domain/workflows/system-actions';
import { ConversationContextManager } from '../conversation/conversation-context.manager';

const COMPONENT = 'Wallet';
const STAGE = 'WalletNotifier';

/**
 * The one action every wallet push offers: get back to solvent without leaving the chat.
 *
 * `system` is the reserved non-instance workflow id, so the tap starts a fresh CreditRecharge
 * rather than resuming anything (system-actions.ts). No payment logic lives in the button.
 */
const RECHARGE_ACTION = {
  type: 'quick_reply' as const,
  title: '⚡ Recharge Now',
  payload: encodeActionPayload({ workflowId: SYSTEM_WORKFLOW_ID, action: 'recharge' }),
};

/**
 * System-initiated wallet pushes (Konnet Credits Recharge TDR §12, §25.7, §25.12).
 *
 * These are the platform's only messages that are not replies to something the user said: a bank
 * transfer landed, a lead was missed, a profile was shared, a grant arrived. Each composes a
 * canonical `Response` and lets the channel adapter render it, so WhatsApp's formatting rules
 * are not duplicated here.
 *
 * Every method is best-effort by contract and none of them throws. The state they describe is
 * already committed, and rolling back money because a message failed would be far worse than a
 * missing message.
 */
@Injectable()
export class WalletNotifier {
  constructor(
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly context: ConversationContextManager,
  ) {}

  /** Confirms a credit to the user (§12). */
  async notifyCredited(params: {
    userId: string;
    conversationId: string;
    credits: number;
    amountKobo: number;
    balanceAfter: number;
  }): Promise<void> {
    await this.push({
      userId: params.userId,
      conversationId: params.conversationId,
      what: 'the credit confirmation',
      detail: { credits: params.credits, balanceAfter: params.balanceAfter },
      response: {
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
      },
    });
  }

  /**
   * Tells a vendor a lead passed them by because they could not pay the visibility fee (§25.7).
   *
   * Two variants, because the two situations are genuinely different and one message cannot be
   * honest about both: the `lead` vendor never saw the request, while the `responder` vendor
   * actively said yes and still was not shown. Telling a responder they "missed a lead" would
   * read as a system error to someone who knows they answered.
   */
  async notifyInsufficient(params: {
    userId: string;
    conversationId: string;
    capabilityName: string;
    requiredCredits: number;
    balance: number;
    variant: 'lead' | 'responder';
  }): Promise<void> {
    const text =
      params.variant === 'lead'
        ? [
            '⚠️ You missed a lead',
            '',
            `A customer asked about "${params.capabilityName}" and your profile was a strong match — but your credit balance (${params.balance} credits) was below the ${params.requiredCredits}-credit visibility fee, so it was not shared.`,
            '',
            'Recharge now to keep receiving leads.',
          ].join('\n')
        : [
            "⚠️ You said yes — but your profile wasn't shared",
            '',
            `You accepted a request for "${params.capabilityName}", but your credit balance (${params.balance} credits) was below the ${params.requiredCredits}-credit visibility fee, so your profile was not sent to the customer.`,
            '',
            'Recharge now so your next "Yes" reaches them.',
          ].join('\n');

    await this.push({
      userId: params.userId,
      conversationId: params.conversationId,
      what: `the missed-lead notification (${params.variant})`,
      detail: { balance: params.balance, requiredCredits: params.requiredCredits },
      response: {
        text,
        actions: [RECHARGE_ACTION],
        metadata: { walletInsufficient: params.variant },
      },
    });
  }

  /**
   * Tells a vendor their profile went to a customer, and what it cost (§25.7).
   *
   * The positive counterpart to `notifyInsufficient`, and the reason a charge is never a
   * surprise: the vendor learns about the deduction and the incoming contact in the same breath.
   */
  async notifyConnected(params: {
    userId: string;
    conversationId: string;
    capabilityName: string;
    credits: number;
    balanceAfter: number;
  }): Promise<void> {
    await this.push({
      userId: params.userId,
      conversationId: params.conversationId,
      what: 'the connected notification',
      detail: { credits: params.credits, balanceAfter: params.balanceAfter },
      response: {
        text: [
          "🎉 You've been connected",
          '',
          `A customer asked about "${params.capabilityName}" and your profile has been shared with them. Get ready — they may call or message you shortly.`,
          '',
          `The ${params.credits}-credit visibility fee has been deducted.`,
          'Current Balance:',
          `${params.balanceAfter} Credits`,
        ].join('\n'),
        metadata: { walletConnected: true },
      },
    });
  }

  /**
   * Tells the unpaid fallback vendor the lead was on the house (§25.7).
   *
   * Sent instead of the missed-lead message, never alongside it: they did get the lead, so
   * "you missed a lead" would contradict what just happened. Naming it a trial keeps the
   * degradation from quietly becoming the vendor's expectation.
   */
  async notifyFreeTrial(params: {
    userId: string;
    conversationId: string;
    capabilityName: string;
  }): Promise<void> {
    await this.push({
      userId: params.userId,
      conversationId: params.conversationId,
      what: 'the free-trial notification',
      detail: { capabilityName: params.capabilityName },
      response: {
        text: [
          "🎁 Free trial — this one's on us",
          '',
          `A customer asked about "${params.capabilityName}" and your profile was shared with them — free of charge this time.`,
          '',
          "You're in free trial mode, which may end soon. Recharge to keep getting opportunities like this one.",
        ].join('\n'),
        actions: [RECHARGE_ACTION],
        metadata: { walletFreeTrial: true },
      },
    });
  }

  /**
   * Welcomes a newly onboarded vendor with their starting credits (§25.12).
   *
   * No action button: they are funded, so offering a recharge would be noise.
   */
  async notifyOnboardingCredit(params: {
    userId: string;
    conversationId: string;
    credits: number;
    balanceAfter: number;
  }): Promise<void> {
    await this.push({
      userId: params.userId,
      conversationId: params.conversationId,
      what: 'the onboarding grant notification',
      detail: { credits: params.credits, balanceAfter: params.balanceAfter },
      response: {
        text: [
          '🎉 Welcome to Konnet!',
          '',
          `${params.credits} free credits have been added to your account to get you started.`,
          '',
          'Current Balance:',
          `${params.balanceAfter} Credits`,
        ].join('\n'),
        metadata: { walletOnboardingGrant: true },
      },
    });
  }

  /**
   * The one delivery path every wallet push shares.
   *
   * Total by contract: no branch throws. Callers are on committed-money paths — a debit that
   * has already decremented a balance, a grant that is already in the ledger — where the only
   * safe failure is a logged one.
   */
  private async push(params: {
    userId: string;
    conversationId: string;
    what: string;
    detail: Record<string, unknown>;
    response: Response;
  }): Promise<void> {
    try {
      if (!this.notifiers.supports('whatsapp')) {
        this.logger.stageFailed({
          component: COMPONENT,
          stage: STAGE,
          input: { userId: params.userId },
          action: `No WhatsApp notifier is registered; ${params.what} cannot be delivered`,
          error: new Error('Unsupported channel: whatsapp'),
        });
        return;
      }

      const result = await this.notifiers
        .forChannel('whatsapp')
        .send(
          { channel: 'whatsapp', address: params.userId, conversationId: params.conversationId },
          params.response,
        );

      if (!isAccepted(result)) {
        this.logger.stageFailed({
          component: COMPONENT,
          stage: STAGE,
          input: { userId: params.userId, ...params.detail },
          action: `Channel rejected ${params.what}; the wallet state it describes is unaffected`,
          error: new Error(result.error ?? 'unknown delivery failure'),
        });
        return;
      }

      // Recorded so the next turn's context includes what the platform told them.
      await this.context.recordAssistantTurn({
        conversationId: params.conversationId,
        channel: 'whatsapp',
        content: params.response.text ?? '',
      });

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { userId: params.userId, ...params.detail },
        action: `Sent ${params.what}`,
        output: { delivered: true },
      });
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { userId: params.userId, ...params.detail },
        action: `${params.what} failed unexpectedly; the wallet state it describes is already committed`,
        error,
      });
    }
  }
}
