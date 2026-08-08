import { Inject, Injectable } from '@nestjs/common';
import type { Conversation } from '../../domain/models/conversation';
import type { Response } from '../../domain/models/response';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  type ChannelNotifierRegistryPort,
} from '../../domain/ports/outbound/channel-notifier.port';
import {
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
import {
  VENDOR_REPOSITORY,
  type VendorRepositoryPort,
} from '../../domain/ports/outbound/vendor-repository.port';
import {
  parseVendorTextResponse,
  resolveVendorResponse,
  type VendorOptionCode,
} from '../../domain/workflows/vendor-response';
import { RequestDistributionService } from './request-distribution.service';

const COMPONENT = 'RequestDistribution';
const STAGE = 'VendorResponseHandler';

const CLOSED_REPLY = 'This request is no longer open — no action needed. Thanks anyway.';
const INERT_REPLY = 'This link is no longer active.';

export interface VendorResponseInput {
  readonly conversation: Conversation;
  readonly interactivePayload: string | null;
  readonly text?: string;
}

@Injectable()
export class VendorResponseHandler {
  constructor(
    @Inject(VENDOR_REPOSITORY) private readonly vendors: VendorRepositoryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(CHANNEL_NOTIFIER_REGISTRY) private readonly notifiers: ChannelNotifierRegistryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
    private readonly distribution: RequestDistributionService,
  ) {}

  async tryHandle(params: VendorResponseInput): Promise<Response | null> {
    const vendor = await this.vendors.findByUserId(params.conversation.userId);
    if (vendor === null) {
      if (params.interactivePayload !== null && resolveVendorResponse(params.interactivePayload) !== null) {
        return { text: INERT_REPLY, metadata: { vendorResponse: 'inert' } };
      }
      return null;
    }

    let requestId: string | null = null;
    let options: VendorOptionCode[] = [];

    const resolvedPayload = resolveVendorResponse(params.interactivePayload);
    if (resolvedPayload !== null) {
      requestId = resolvedPayload.requestId;
      options = [...resolvedPayload.options];
    } else if (params.text && params.text.trim().length > 0) {
      const pending = await this.distribution.findPendingDeliveryForVendor(vendor.id);
      if (pending !== null) {
        const parsed = parseVendorTextResponse(params.text);
        if (parsed.length > 0) {
          requestId = pending.requestId;
          options = [...parsed];
        }
      }
    }

    if (requestId === null || options.length === 0) {
      return null;
    }

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: {
        vendorId: vendor.id,
        businessName: vendor.businessName,
        requestId,
        interactivePayload: params.interactivePayload,
        textInput: params.text ?? null,
      },
      action: `Processing vendor response options [${options.join(', ')}]`,
      output: { optionsCount: options.length },
    });

    const replies: string[] = [];
    let recordedAny = false;

    // Process Option 1 ("YES_HAVE_IT") or Option 3 ("CAN_GET_IT")
    if (options.includes('YES_HAVE_IT') || options.includes('CAN_GET_IT')) {
      const outcome = await this.distribution.recordVendorResponse({
        requestId,
        vendorId: vendor.id,
        accepted: true,
      });

      if (outcome !== null) {
        recordedAny = true;
        const productName =
          outcome.request.product ?? outcome.request.capabilityName ?? outcome.request.query;

        // Auto-inventory update
        const profile = await this.vendors.loadProfile(vendor.id);
        const currentProducts = profile?.dna.declaredProducts ?? [];
        if (!currentProducts.includes(productName)) {
          await this.vendors.update(vendor.id, {
            declaredProducts: [...currentProducts, productName],
          });
        }

        // Deliver profile card to buyer if revealed
        if (outcome.revealed) {
          await this.deliverProfileCardToBuyer({
            buyerConversationId: outcome.request.conversationId,
            vendor,
            resolvedProduct: productName,
          });

          this.logger.stage({
            component: COMPONENT,
            stage: `${STAGE}:OptionAccept`,
            input: { vendorId: vendor.id, requestId, productName },
            action: 'Vendor accepted request: updated inventory and delivered profile card to buyer',
            output: { revealed: true, buyerConversationId: outcome.request.conversationId },
          });

          replies.push(
            "You're in — your profile has been sent to the customer. Get ready for their call or message.",
          );
        } else {
          this.logger.stage({
            component: COMPONENT,
            stage: `${STAGE}:OptionAccept`,
            input: { vendorId: vendor.id, requestId, productName },
            action: 'Vendor accepted request: recorded response',
            output: { revealed: false },
          });

          replies.push(
            "Thanks for accepting! Your profile was recorded for this request.",
          );
        }
      }
    }

    // Process Option 2 ("NO_DONT_HAVE") if no accept option was handled
    if (options.includes('NO_DONT_HAVE') && !options.includes('YES_HAVE_IT') && !options.includes('CAN_GET_IT')) {
      const outcome = await this.distribution.recordVendorResponse({
        requestId,
        vendorId: vendor.id,
        accepted: false,
      });

      if (outcome !== null) {
        recordedAny = true;
        this.logger.stage({
          component: COMPONENT,
          stage: `${STAGE}:OptionDecline`,
          input: { vendorId: vendor.id, requestId },
          action: 'Vendor declined request (Option 2: No / Don\'t have)',
          output: { recorded: true },
        });

        replies.push('ok, noted with thanks');
      }
    }

    // Process Option 4 ("REFER_SOMEONE")
    if (options.includes('REFER_SOMEONE')) {
      await this.events.publish({
        eventId: this.ids.uuid(),
        eventType: 'vendor.referral.provided',
        timestamp: this.clock.now(),
        producer: 'VendorResponseHandler',
        vendorId: vendor.id,
        requestId,
        payload: { vendorId: vendor.id, requestId },
      });

      this.logger.stage({
        component: COMPONENT,
        stage: `${STAGE}:OptionReferral`,
        input: { vendorId: vendor.id, requestId },
        action: 'Vendor selected referral option (Option 4): published referral event and requested contact details',
        output: { eventPublished: 'vendor.referral.provided' },
      });

      replies.push(
        'Thanks for offering to help! Please reply with the WhatsApp number of the person/business you are referring.',
      );
    }

    // Process Option 5 ("NOT_MY_LINE")
    if (options.includes('NOT_MY_LINE')) {
      const outcome = await this.distribution.recordVendorResponse({
        requestId,
        vendorId: vendor.id,
        accepted: false,
      });

      if (outcome !== null) {
        recordedAny = true;
        if (outcome.request.capabilityId) {
          await this.pruneVendorCapability(vendor.id, outcome.request.capabilityId);
        }
      }

      await this.events.publish({
        eventId: this.ids.uuid(),
        eventType: 'vendor.capability.pruned',
        timestamp: this.clock.now(),
        producer: 'VendorResponseHandler',
        vendorId: vendor.id,
        requestId,
        payload: { vendorId: vendor.id, requestId },
      });

      this.logger.stage({
        component: COMPONENT,
        stage: `${STAGE}:OptionPruning`,
        input: { vendorId: vendor.id, requestId },
        action: 'Vendor selected pruning option (Option 5: Not my line): updated beliefs and published pruning event',
        output: { eventPublished: 'vendor.capability.pruned' },
      });

      replies.push(
        "Thank you for letting us know! We've updated our records so you won't receive requests for this item in the future.",
      );
    }

    if (!recordedAny && replies.length === 0) {
      return { text: CLOSED_REPLY, metadata: { vendorResponse: 'closed' } };
    }

    return {
      text: replies.join('\n\n'),
      metadata: { vendorResponse: 'recorded', options },
    };
  }

  /** Delivers vendor profile card with direct WhatsApp link CTA to buyer. */
  private async deliverProfileCardToBuyer(params: {
    buyerConversationId: string;
    vendor: any;
    resolvedProduct: string;
  }): Promise<void> {
    try {
      const cleanPhone = params.vendor.userId.replace(/[^0-9]/g, '');
      const waUrl = `https://wa.me/${cleanPhone}`;
      const location = params.vendor.location
        ? `${params.vendor.location.city ?? ''}${params.vendor.location.state ? `, ${params.vendor.location.state}` : ''}`
        : 'Local';

      const cardText = [
        `*Match Found for "${params.resolvedProduct}"!*`,
        '',
        `*Business:* ${params.vendor.businessName}`,
        `*Location:* ${location}`,
        '',
        `📲 *Message Vendor:* ${waUrl}`,
      ].join('\n');

      if (this.notifiers.supports('whatsapp')) {
        await this.notifiers.forChannel('whatsapp').send(
          { channel: 'whatsapp', address: params.buyerConversationId, conversationId: params.buyerConversationId },
          {
            text: cardText,
            actions: [
              {
                type: 'url',
                title: 'Message Vendor',
                payload: waUrl,
              },
            ],
            metadata: { vendorProfileCard: true, vendorId: params.vendor.id },
          },
        );
      }
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:BuyerDelivery`,
        input: { buyerConversationId: params.buyerConversationId, vendorId: params.vendor.id },
        action: 'Failed to deliver vendor profile card to buyer',
        error,
      });
    }
  }

  /** Prunes a capability belief from a vendor profile. */
  private async pruneVendorCapability(vendorId: string, capabilityId: string): Promise<void> {
    try {
      const profile = await this.vendors.loadProfile(vendorId);
      if (profile === null) return;

      const updatedBeliefs = profile.dna.beliefs.filter(
        (b) => b.capability.id !== capabilityId,
      );

      await this.vendors.replaceBeliefs(vendorId, updatedBeliefs);
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:PruneCapability`,
        input: { vendorId, capabilityId },
        action: 'Failed to prune vendor capability',
        error,
      });
    }
  }
}
