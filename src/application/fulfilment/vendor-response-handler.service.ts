import { Inject, Injectable } from '@nestjs/common';
import type { Conversation } from '../../domain/models/conversation';
import type { Response } from '../../domain/models/response';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  VENDOR_REPOSITORY,
  type VendorRepositoryPort,
} from '../../domain/ports/outbound/vendor-repository.port';
import { resolveVendorResponse } from '../../domain/workflows/vendor-response';
import { RequestDistributionService } from './request-distribution.service';

const COMPONENT = 'RequestDistribution';
const STAGE = 'VendorResponseHandler';

/** Sent when a tap arrives for a delivery that is no longer open to an answer. */
const CLOSED_REPLY = 'This request is no longer open — no action needed. Thanks anyway.';

/** Sent when a vendor-response payload arrives from a conversation that is not a vendor's. */
const INERT_REPLY = 'This link is no longer active.';

/**
 * Turns a vendor's button tap into a recorded response (Vendor Fan-Out TDR §9.2).
 *
 * The missing inbound half of the fan-out: `recordVendorResponse` existed but nothing called it,
 * so even a vendor who answered was ignored.
 *
 * Deterministic on purpose. A tapped button carries no ambiguity, and this path spends the
 * vendor's credits — routing it through intent classification would mean an accept could fail, or
 * worse succeed spuriously, because a model had an off day. No LLM, no workflow instance, no
 * intent: the tap is a marketplace action, not a conversational objective.
 */
@Injectable()
export class VendorResponseHandler {
  constructor(
    @Inject(VENDOR_REPOSITORY) private readonly vendors: VendorRepositoryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly distribution: RequestDistributionService,
  ) {}

  /**
   * Handles the tap, or declines to.
   *
   * Returns the reply to send the vendor, or `null` when this turn is not a vendor response and
   * should route normally. Null is the safe default everywhere below: the alternative to "I don't
   * understand this payload" must never be "assume they accepted".
   */
  async tryHandle(params: {
    conversation: Conversation;
    interactivePayload: string | null;
  }): Promise<Response | null> {
    const action = resolveVendorResponse(params.interactivePayload);
    if (action === null) return null;

    // The identity comes from the conversation, never from the payload. The payload names a
    // request; it does not name who is answering, so a leaked button is inert in anyone else's
    // hands and cannot touch another vendor's delivery.
    const vendor = await this.vendors.findByUserId(params.conversation.userId);

    if (vendor === null) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { conversationId: params.conversation.id, requestId: action.requestId },
        action: 'A vendor-response payload was tapped in a conversation with no vendor behind it',
        error: new Error('no vendor for this conversation'),
      });

      return { text: INERT_REPLY, metadata: { vendorResponse: 'inert' } };
    }

    const outcome = await this.distribution.recordVendorResponse({
      requestId: action.requestId,
      vendorId: vendor.id,
      accepted: action.accepted,
    });

    // Null means the delivery is gone, already answered, or timed out. `recordVendorResponse`
    // guards on that, so a second tap mutates nothing and bills nothing.
    if (outcome === null) {
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { requestId: action.requestId, vendorId: vendor.id, accepted: action.accepted },
        action: 'Tap arrived for a delivery that is no longer open; nothing was changed',
        output: { recorded: false },
      });

      return { text: CLOSED_REPLY, metadata: { vendorResponse: 'closed' } };
    }

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { requestId: action.requestId, vendorId: vendor.id, accepted: action.accepted },
      action: action.accepted
        ? outcome.revealed
          ? 'Vendor accepted and was revealed to the customer'
          : 'Vendor accepted but could not pay the visibility fee; they stay hidden'
        : 'Vendor declined; they stay hidden',
      output: { recorded: true, revealed: outcome.revealed },
    });

    return {
      text: this.replyFor(action.accepted, outcome.revealed),
      metadata: { vendorResponse: 'recorded' },
    };
  }

  /**
   * The vendor's confirmation.
   *
   * The insolvent-accept case is deliberately brief: `recordVendorResponse` has already sent the
   * full missed-lead push with the recharge button (Konnet Credits Recharge TDR §25.7), and
   * repeating the explanation here would be two messages saying the same thing. This one only
   * confirms the tap was heard.
   */
  private replyFor(accepted: boolean, revealed: boolean): string {
    if (!accepted) return "No problem — I've let the customer know you're not available this time.";

    if (revealed) {
      return "You're in — your profile has been sent to the customer. Get ready for their call or message.";
    }

    return "Thanks for accepting. Your profile wasn't shared this time — see the message just above for why, and recharge so the next one reaches the customer.";
  }
}
