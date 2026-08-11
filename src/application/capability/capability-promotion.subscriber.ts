import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { CapabilityDiscoveryService } from './capability-discovery.service';

const COMPONENT = 'CDE';
const STAGE = 'CapabilityPromotionSubscriber';

/**
 * Bridges marketplace behaviour events into the Capability Discovery Engine,
 * closing the evidence-driven affinity promotion lifecycle (DAEM TDR §6).
 *
 * When a vendor taps "Yes, I have it" (request.accepted), this subscriber
 * records the acceptance as a direct capability observation at strength 0.95.
 * The CDE re-derives beliefs from the full evidence history, promoting what
 * was previously a Layer 2 archetype inference into a Layer 3 direct Brick
 * capability — the vendor is "now permanently a Tier 1 Direct Stockist"
 * (DAEM TDR §6, Step 8).
 *
 * When a vendor taps "Not my line of business" (request.rejected), the edge
 * is pruned by recording a negative signal (DAEM TDR §5).
 *
 * CONTRIBUTING §5.1: Contexts integrate through events, not calls.
 * CONTRIBUTING §5.5: Consumers are idempotent and never throw.
 * CONTRIBUTING §8.3: Extends by adding a collaborator, not growing the caller.
 */
@Injectable()
export class CapabilityPromotionSubscriber {
  constructor(
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly discovery: CapabilityDiscoveryService,
  ) {}

  /**
   * Promotes a vendor's capability to Layer 3 when they accept a request.
   *
   * The event is emitted by `RequestDistributionService.recordVendorResponse()`.
   * The capability id carried in the payload is the GPC Brick the customer
   * asked for — exactly what should become a direct belief.
   */
  @OnEvent('request.accepted', { async: true })
  async onRequestAccepted(event: DomainEvent): Promise<void> {
    const capabilityId = event.payload?.capability;
    const product = event.payload?.product;
    const vendorId = event.vendorId;

    if (vendorId === undefined || typeof capabilityId !== 'string') {
      // No vendor or no capability in the event; nothing to promote.
      return;
    }

    try {
      await this.discovery.observeBehaviour({
        vendorId,
        capability: {
          domain: 'product',
          id: capabilityId,
          name: typeof product === 'string' ? product : capabilityId,
        },
        positive: true,
        source: 'request_accepted',
        originalText: `Accepted request for ${typeof product === 'string' ? product : capabilityId}`,
        ...(event.conversationId !== undefined ? { conversationId: event.conversationId } : {}),
      });

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { vendorId, capabilityId, product },
        action: 'Promoted accepted request capability to Layer 3 direct Brick (DAEM TDR §6)',
        output: { promoted: true },
      });
    } catch (error) {
      // CONTRIBUTING §5.5: consumers never throw — log and return.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { vendorId, capabilityId },
        action:
          'Could not promote the accepted capability; the evidence is still recorded by the Evidence Service',
        error,
      });
    }
  }

  /**
   * Prunes an affinity edge when a vendor explicitly rejects a request.
   *
   * "Not my line of business" is a strong negative signal: the vendor is
   * telling the platform that the archetype's affinity vector was wrong for
   * this particular item (DAEM TDR §5).
   */
  @OnEvent('request.rejected', { async: true })
  async onRequestRejected(event: DomainEvent): Promise<void> {
    const capabilityId = event.payload?.capability;
    const product = event.payload?.product;
    const vendorId = event.vendorId;

    if (vendorId === undefined || typeof capabilityId !== 'string') return;

    try {
      await this.discovery.observeBehaviour({
        vendorId,
        capability: {
          domain: 'product',
          id: capabilityId,
          name: typeof product === 'string' ? product : capabilityId,
        },
        positive: false,
        source: 'request_rejected',
        originalText: `Rejected request for ${typeof product === 'string' ? product : capabilityId}`,
        ...(event.conversationId !== undefined ? { conversationId: event.conversationId } : {}),
      });

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { vendorId, capabilityId, product },
        action: 'Recorded rejection as negative capability signal; affinity edge pruned (DAEM TDR §5)',
        output: { pruned: true },
      });
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { vendorId, capabilityId },
        action: 'Could not record the rejection signal',
        error,
      });
    }
  }
}
