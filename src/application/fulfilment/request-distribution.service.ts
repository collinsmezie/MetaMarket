import { Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { RankedVendor } from '../../domain/models/demand';
import { PrismaService } from '../../adapters/outbound/persistence/prisma.service';
import {
  EVENT_PUBLISHER,
  type DomainEvent,
  type EventPublisherPort,
} from '../../domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';

const COMPONENT = 'RequestDistribution';
const STAGE = 'RequestDistributionService';

/**
 * How many top-ranked vendors reach the customer immediately.
 *
 * One, deliberately. The immediate delivery costs the vendor a credit whether or not the customer
 * ever contacts them, so handing out several on speculation would bill vendors for nothing. The
 * rest earn visibility by responding.
 */
const IMMEDIATE_DELIVERY_COUNT = 1;

/** Vendors the request is fanned out to beyond the immediate one. */
const FANOUT_LIMIT = 8;

/** How long vendors have to respond before the delivery is recorded as a no-response. */
const RESPONSE_WINDOW_MS = 30 * 60 * 1000;

/** How long the whole request stays open. */
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

export interface DistributionResult {
  readonly requestId: string;
  /** Vendors revealed to the customer straight away. */
  readonly immediate: readonly RankedVendor[];
  /** Vendors the request was fanned out to, not yet visible to the customer. */
  readonly fannedOut: readonly RankedVendor[];
}

/**
 * Demand-driven fulfilment (MCOS Refinement #11 §1-§6).
 *
 * Immediately returns the highest-ranked vendor, notifies them, deducts their credit, then
 * creates the request and fans it out to the rest. Remaining vendors become visible to the
 * customer only when they explicitly respond — a vendor who ignores the request is never shown.
 *
 * Distribution strategy lives here and nowhere else: the Conversation OS "SHALL remain
 * independent of the distribution strategy" (§4).
 */
@Injectable()
export class RequestDistributionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisherPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  /**
   * Creates the customer request and distributes it.
   *
   * The ordering matters and follows the TDR exactly: deliver the top vendor to the customer,
   * notify and bill them, and only then fan out. Billing before successful delivery would charge
   * a vendor for an introduction the customer never received.
   */
  async distribute(params: {
    conversationId: string;
    workflowId: string;
    customerId: string;
    query: string;
    capabilityId: string | null;
    capabilityName: string | null;
    product: string | null;
    customerCity: string | null;
    ranked: readonly RankedVendor[];
  }): Promise<DistributionResult> {
    const startedAt = Date.now();
    const now = this.clock.now();

    const immediate = params.ranked.slice(0, IMMEDIATE_DELIVERY_COUNT);
    const fannedOut = params.ranked.slice(IMMEDIATE_DELIVERY_COUNT, IMMEDIATE_DELIVERY_COUNT + FANOUT_LIMIT);

    const request = await this.prisma.customerRequest.create({
      data: {
        id: this.ids.uuid(),
        conversationId: params.conversationId,
        workflowId: params.workflowId,
        customerId: params.customerId,
        query: params.query,
        capabilityId: params.capabilityId,
        capabilityName: params.capabilityName,
        product: params.product?.toLowerCase() ?? null,
        customerCity: params.customerCity,
        expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
      },
    });

    const events: DomainEvent[] = [
      this.event('request.created', {
        requestId: request.id,
        conversationId: params.conversationId,
        customerId: params.customerId,
        payload: { query: params.query, capability: params.capabilityId, product: params.product },
      }),
    ];

    // ── Immediate delivery: visible to the customer at once, and billed ──────────────
    for (const [index, vendor] of immediate.entries()) {
      await this.prisma.requestDelivery.create({
        data: {
          requestId: request.id,
          vendorId: vendor.vendorId,
          rank: index,
          score: vendor.score,
          immediate: true,
          revealedToCustomer: true,
          creditDeducted: true,
          deliveredAt: now,
        },
      });

      events.push(
        this.event('request.delivered', {
          requestId: request.id,
          vendorId: vendor.vendorId,
          payload: { capability: params.capabilityId, product: params.product, immediate: true },
        }),
        // The vendor is told their details went to a customer, and billed for it (§3).
        this.event('vendor.profile.delivered', {
          requestId: request.id,
          vendorId: vendor.vendorId,
          payload: { customerId: params.customerId, query: params.query },
        }),
        this.event('vendor.credit.deducted', {
          requestId: request.id,
          vendorId: vendor.vendorId,
          payload: { reason: 'profile_delivered_to_customer', capability: params.capabilityId },
        }),
      );
    }

    // ── Fan-out: asked, but not yet visible to the customer ──────────────────────────
    for (const [index, vendor] of fannedOut.entries()) {
      await this.prisma.requestDelivery.create({
        data: {
          requestId: request.id,
          vendorId: vendor.vendorId,
          rank: IMMEDIATE_DELIVERY_COUNT + index,
          score: vendor.score,
          immediate: false,
          deliveredAt: now,
        },
      });

      events.push(
        this.event('request.delivered', {
          requestId: request.id,
          vendorId: vendor.vendorId,
          payload: { capability: params.capabilityId, product: params.product, immediate: false },
        }),
      );
    }

    if (fannedOut.length > 0) {
      events.push(
        this.event('request.distributed', {
          requestId: request.id,
          payload: { vendorCount: fannedOut.length, capability: params.capabilityId },
        }),
      );
    }

    await this.events.publishAll(events);

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { query: params.query, rankedVendors: params.ranked.length },
      action: `Delivered ${immediate.length} vendor(s) immediately and fanned the request out to ${fannedOut.length} more`,
      output: {
        requestId: request.id,
        immediate: immediate.map((vendor) => vendor.businessName),
        fannedOut: fannedOut.map((vendor) => vendor.businessName),
      },
      durationMs: Date.now() - startedAt,
    });

    return { requestId: request.id, immediate, fannedOut };
  }

  /**
   * Records a vendor's answer to a fanned-out request.
   *
   * Accepting is what makes a vendor visible to the customer — "Matched vendors that do not
   * respond SHALL NOT be presented to the customer" (§6).
   */
  async recordVendorResponse(params: {
    requestId: string;
    vendorId: string;
    accepted: boolean;
  }): Promise<{ revealed: boolean } | null> {
    const delivery = await this.prisma.requestDelivery.findUnique({
      where: { requestId_vendorId: { requestId: params.requestId, vendorId: params.vendorId } },
      include: { request: true },
    });

    if (delivery === null || delivery.status !== 'pending') return null;

    const now = this.clock.now();
    const responseTimeMs = now.getTime() - delivery.deliveredAt.getTime();

    await this.prisma.requestDelivery.update({
      where: { id: delivery.id },
      data: {
        status: params.accepted ? 'accepted' : 'rejected',
        respondedAt: now,
        responseTimeMs,
        revealedToCustomer: params.accepted,
      },
    });

    await this.events.publishAll([
      this.event(params.accepted ? 'request.accepted' : 'request.rejected', {
        requestId: params.requestId,
        vendorId: params.vendorId,
        payload: {
          capability: delivery.request.capabilityId,
          product: delivery.request.product,
          // Seconds, per the Standard Marketplace Event Model.
          responseTime: Math.round(responseTimeMs / 1000),
        },
      }),
    ]);

    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Response`,
      input: { requestId: params.requestId, vendorId: params.vendorId },
      action: params.accepted
        ? 'Vendor accepted; they are now visible to the customer'
        : 'Vendor declined; they remain hidden from the customer',
      output: { responseTimeMs, revealed: params.accepted },
    });

    return { revealed: params.accepted };
  }

  /** Vendors who have accepted and may therefore be shown to the customer. */
  async revealedVendors(requestId: string): Promise<readonly { vendorId: string; rank: number }[]> {
    const rows = await this.prisma.requestDelivery.findMany({
      where: { requestId, revealedToCustomer: true },
      orderBy: { rank: 'asc' },
      select: { vendorId: true, rank: true },
    });

    return rows;
  }

  /**
   * Records the customer's choice, and the completion that follows it.
   *
   * These are the strongest signals the Evidence Service receives — a customer picking a vendor
   * and a deal completing outrank anything a vendor says about themselves.
   */
  async recordSelection(params: { requestId: string; vendorId: string }): Promise<void> {
    const request = await this.prisma.customerRequest.findUnique({ where: { id: params.requestId } });
    if (request === null) return;

    await this.events.publishAll([
      this.event('vendor.selected', {
        requestId: params.requestId,
        vendorId: params.vendorId,
        payload: { capability: request.capabilityId, product: request.product },
      }),
    ]);
  }

  async recordCompletion(params: { requestId: string; vendorId: string }): Promise<void> {
    const request = await this.prisma.customerRequest.findUnique({ where: { id: params.requestId } });
    if (request === null) return;

    await this.prisma.customerRequest.update({
      where: { id: params.requestId },
      data: { status: 'fulfilled', fulfilledAt: this.clock.now() },
    });

    await this.events.publishAll([
      this.event('match.completed', {
        requestId: params.requestId,
        vendorId: params.vendorId,
        payload: { capability: request.capabilityId, product: request.product },
      }),
    ]);
  }

  /**
   * Marks unanswered deliveries as timed out.
   *
   * Silence has to be recorded explicitly: without a `request.timeout` event the Evidence Service
   * would see a vendor who never replies as having no history rather than a poor record, and
   * ignoring requests would carry no cost at all.
   */
  @Interval(60_000)
  async sweepTimeouts(): Promise<void> {
    const now = this.clock.now();
    const cutoff = new Date(now.getTime() - RESPONSE_WINDOW_MS);

    try {
      const stale = await this.prisma.requestDelivery.findMany({
        where: { status: 'pending', deliveredAt: { lte: cutoff } },
        include: { request: true },
        take: 200,
      });

      if (stale.length === 0) return;

      await this.prisma.requestDelivery.updateMany({
        where: { id: { in: stale.map((delivery) => delivery.id) } },
        data: { status: 'timeout' },
      });

      await this.events.publishAll(
        stale.map((delivery) =>
          this.event('request.timeout', {
            requestId: delivery.requestId,
            vendorId: delivery.vendorId,
            payload: {
              capability: delivery.request.capabilityId,
              product: delivery.request.product,
              timeoutMinutes: RESPONSE_WINDOW_MS / 60_000,
            },
          }),
        ),
      );

      this.logger.stage({
        component: COMPONENT,
        stage: `${STAGE}:TimeoutSweep`,
        input: { cutoff: cutoff.toISOString() },
        action: `Recorded ${stale.length} unanswered delivery/deliveries as no-response`,
        output: { timedOut: stale.length },
      });
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:TimeoutSweep`,
        input: {},
        action: 'Timeout sweep failed; will retry on the next interval',
        error,
      });
    }
  }

  private event(
    eventType: string,
    fields: {
      requestId?: string;
      vendorId?: string;
      customerId?: string;
      conversationId?: string;
      payload: Record<string, unknown>;
    },
  ): DomainEvent {
    return {
      eventId: this.ids.uuid(),
      eventType,
      timestamp: this.clock.now(),
      producer: 'RequestDistributionService',
      ...(fields.requestId !== undefined ? { requestId: fields.requestId } : {}),
      ...(fields.vendorId !== undefined ? { vendorId: fields.vendorId } : {}),
      ...(fields.customerId !== undefined ? { customerId: fields.customerId } : {}),
      ...(fields.conversationId !== undefined ? { conversationId: fields.conversationId } : {}),
      payload: fields.payload,
    };
  }
}
