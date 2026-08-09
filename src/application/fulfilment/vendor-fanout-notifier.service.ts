import { Inject, Injectable } from '@nestjs/common';
import type { Response } from '../../domain/models/response';
import type { Vendor } from '../../domain/models/vendor';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  isAccepted,
  type ChannelNotifierRegistryPort,
} from '../../domain/ports/outbound/channel-notifier.port';
import { EVENT_PUBLISHER, type EventPublisherPort } from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import { encodeVendorResponse } from '../../domain/workflows/vendor-response';
import { ConversationContextManager } from '../conversation/conversation-context.manager';

const COMPONENT = 'RequestDistribution';
const STAGE = 'VendorFanoutNotifier';

/**
 * Asks a fanned-out vendor whether they can serve a customer's request (Vendor Fan-Out TDR §9.1).
 *
 * Until this existed the fan-out was silent: `distribute()` wrote delivery rows and published
 * `request.delivered`, but nothing reached the vendor's phone, so every fanned-out row could only
 * ever time out. This is the missing outbound half.
 *
 * Best-effort by contract, exactly like `WalletNotifier`, and for the same reason: distribution
 * is already committed by the time the ask is attempted. A failed push must never roll back a
 * customer's search or block their reply — it leaves the delivery row pending, and the existing
 * 30-minute sweep records a timeout, which is honest. A vendor who was never asked did not
 * respond.
 */
@Injectable()
export class VendorFanoutNotifier {
  constructor(
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly context: ConversationContextManager,
  ) {}

  /** Sends the ask. Total by contract: never throws, whatever the channel does. */
  async notifyVendor(params: {
    requestId: string;
    deliveryId: string;
    vendor: Vendor;
    capabilityName: string;
    customerCity: string | null;
    fee: number;
  }): Promise<void> {
    const response = this.compose(params);

    try {
      if (!this.notifiers.supports('whatsapp')) {
        this.logger.stageFailed({
          component: COMPONENT,
          stage: STAGE,
          input: { requestId: params.requestId, vendorId: params.vendor.id },
          action: 'No WhatsApp notifier is registered; the vendor cannot be asked',
          error: new Error('Unsupported channel: whatsapp'),
        });
        return;
      }

      const result = await this.notifiers.forChannel('whatsapp').send(
        {
          channel: 'whatsapp',
          address: params.vendor.userId,
          conversationId: params.vendor.conversationId,
        },
        response,
      );

      if (!isAccepted(result)) {
        // Commonly Meta's 24-hour service window. Not retried: re-minting buttons for a request
        // that may already be answered would be worse than the honest timeout.
        this.logger.stageFailed({
          component: COMPONENT,
          stage: STAGE,
          input: { requestId: params.requestId, vendorId: params.vendor.id },
          action: 'Channel rejected the vendor ask; the delivery stays pending and will time out',
          error: new Error(result.error ?? 'unknown delivery failure'),
        });
        return;
      }

      // So the vendor's next turn sees what they were asked, and the tap has context behind it.
      await this.context.recordAssistantTurn({
        conversationId: params.vendor.conversationId,
        channel: 'whatsapp',
        content: response.text ?? '',
      });

      // Published once the ask is accepted for delivery — sent now, or durably queued.
      // `vendor.notified` means "this vendor was asked", which is what makes a later timeout
      // interpretable as silence rather than as a message we never managed to send.
      await this.events.publish({
        eventId: this.ids.uuid(),
        eventType: 'vendor.notified',
        timestamp: this.clock.now(),
        producer: STAGE,
        requestId: params.requestId,
        vendorId: params.vendor.id,
        conversationId: params.vendor.conversationId,
        payload: { deliveryId: params.deliveryId, capabilityName: params.capabilityName },
      });

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { requestId: params.requestId, vendorId: params.vendor.id },
        action: `Asked the vendor whether they can supply "${params.capabilityName}"`,
        output: { delivered: true },
      });
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { requestId: params.requestId, vendorId: params.vendor.id },
        action: 'Vendor ask failed unexpectedly; distribution is already committed and stands',
        error,
      });
    }
  }

  /**
   * The ask itself.
   *
   * States the fee up front. A vendor who taps yes is agreeing to be charged, and finding that
   * out afterwards from the deduction notice would be a worse product than one fewer tap.
   */
  private compose(params: {
    requestId: string;
    vendor: Vendor;
    capabilityName: string;
    customerCity: string | null;
    fee: number;
  }): Response {
    const where = params.customerCity ?? params.vendor.location?.city ?? null;
    const near = where === null ? 'A customer' : `A customer near ${where}`;

    return {
      text: [
        `${near} is looking for "${params.capabilityName}".`,
        'Your profile is a strong match. Would you like to be introduced?',
        '',
        `If you accept, the visibility fee (${params.fee} credits) is charged and your profile is sent to them.`,
      ].join('\n'),
      actions: [
        {
          type: 'vendor_response',
          title: 'Yes, I have it',
          payload: encodeVendorResponse({ requestId: params.requestId, accepted: true }),
        },
        {
          type: 'vendor_response',
          title: "I don't have it",
          payload: encodeVendorResponse({ requestId: params.requestId, accepted: false }),
        },
      ],
      metadata: { vendorAsk: true, requestId: params.requestId },
    };
  }
}
