import { Inject, Injectable } from '@nestjs/common';
import type { Vendor } from '../../domain/models/vendor';
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
import {
  VENDOR_REPOSITORY,
  type VendorRepositoryPort,
} from '../../domain/ports/outbound/vendor-repository.port';

const COMPONENT = 'CDE';
const STAGE = 'VendorOnboardingService';

/**
 * Seller-onboarding business operations invoked by the workflow.
 *
 * Kept out of the workflow definition so the state machine stays declarative and the
 * Conversation OS remains an orchestrator that "SHALL NOT implement business logic"
 * (MCOS Refinement #11 §10).
 */
@Injectable()
export class VendorOnboardingService {
  constructor(
    @Inject(VENDOR_REPOSITORY) private readonly vendors: VendorRepositoryPort,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  /**
   * Returns the vendor record for a conversation, creating a provisional one if needed.
   *
   * Created early and deliberately incomplete: the CDE starts accumulating evidence from the
   * vendor's very first sentence, and evidence needs somewhere to live before the profile
   * is finished. The vendor stays `onboarding` — and therefore unsearchable — until it is.
   */
  async ensureVendor(params: {
    userId: string;
    conversationId: string;
  }): Promise<{ vendorId: string; alreadyOnboarded: boolean; businessName: string }> {
    const existing = await this.vendors.findByUserId(params.userId);

    // `active` means they finished onboarding and are searchable. Callers need to know, because
    // running a returning vendor back through the profile-building questions asks them for a
    // city and a business name the platform already has.
    if (existing !== null) {
      return {
        vendorId: existing.id,
        alreadyOnboarded: existing.status === 'active',
        businessName: existing.businessName,
      };
    }

    const vendor = await this.vendors.create({
      id: this.ids.uuid(),
      userId: params.userId,
      conversationId: params.conversationId,
      businessName: '',
      // Collected by the onboarding workflow before the profile is completed. A vendor who
      // arrived over WhatsApp has a usable number already; one who arrived in the browser
      // does not, which is why this cannot default to the conversation identity.
      contactPhone: null,
      location: null,
      conversationSummary: '',
    });

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { userId: params.userId },
      action: 'Created a provisional vendor record so capability evidence can begin accumulating',
      output: { vendorId: vendor.id, status: vendor.status },
    });

    return { vendorId: vendor.id, alreadyOnboarded: false, businessName: vendor.businessName };
  }

  /**
   * Completes the profile and makes the vendor searchable
   * (Vendor-Onboarding.md Step 5: "The vendor SHALL become searchable immediately").
   */
  async finalizeProfile(params: {
    vendorId: string;
    businessName: string;
    contactPhone: string;
    city: string;
    state: string;
    summary: string;
  }): Promise<Vendor> {
    const now = this.clock.now();

    const vendor = await this.vendors.update(params.vendorId, {
      businessName: params.businessName,
      contactPhone: params.contactPhone,
      location: {
        city: params.city,
        state: params.state,
        country: 'Nigeria',
        // Confirmed with the vendor before reaching here, either stated or agreed to.
        confidence: 1,
      },
      status: 'active',
      onboardedAt: now,
    });

    const profile = await this.vendors.loadProfile(params.vendorId);
    const capabilityCount = profile?.dna.beliefs.filter((belief) => belief.confidence >= 0.5).length ?? 0;

    await this.events.publish({
      eventId: this.ids.uuid(),
      eventType: 'seller.onboarded',
      timestamp: now,
      producer: 'CapabilityDiscoveryEngine',
      vendorId: params.vendorId,
      conversationId: vendor.conversationId,
      payload: {
        businessName: params.businessName,
        city: params.city,
        state: params.state,
        capabilityCount,
        // The Evidence Service consumes this in Phase 3 as the vendor's first evidence.
        topCapabilities: (profile?.dna.beliefs ?? []).slice(0, 10).map((belief) => ({
          id: belief.capability.id,
          name: belief.capability.name,
          confidence: belief.confidence,
        })),
      },
    });

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { vendorId: params.vendorId, businessName: params.businessName },
      action: 'Assembled the vendor profile; the vendor is now searchable',
      output: {
        status: vendor.status,
        location: `${params.city}, ${params.state}`,
        confidentCapabilities: capabilityCount,
        totalCapabilities: profile?.dna.beliefs.length ?? 0,
      },
    });

    return vendor;
  }

  /** Publishes a capability-confirmed event, consumed by the Evidence Service in Phase 3. */
  async publishCapabilityConfirmed(params: {
    vendorId: string;
    capabilityId: string;
    capabilityName: string;
    confidence: number;
  }): Promise<void> {
    await this.events.publish({
      eventId: this.ids.uuid(),
      eventType: 'seller.capability.confirmed',
      timestamp: this.clock.now(),
      producer: 'CapabilityDiscoveryEngine',
      vendorId: params.vendorId,
      payload: {
        capabilityId: params.capabilityId,
        capabilityName: params.capabilityName,
        confidence: params.confidence,
      },
    });
  }

  /** Exposed so the workflow can reference the platform's own lifecycle event names. */
  static readonly WORKFLOW_COMPLETED_EVENT = ConversationEvents.WorkflowCompleted;
}
