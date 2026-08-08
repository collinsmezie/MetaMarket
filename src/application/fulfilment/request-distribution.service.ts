import { Inject, Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { RankedVendor } from '../../domain/models/demand';
import type { Vendor } from '../../domain/models/vendor';
import { PrismaService } from '../../adapters/outbound/persistence/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  WALLET_DEBIT_REASONS,
  deliveryDebitReference,
  responseDebitReference,
} from '../../domain/models/credit';
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
import {
  VENDOR_REPOSITORY,
  type VendorRepositoryPort,
} from '../../domain/ports/outbound/vendor-repository.port';
import { WalletNotifier } from '../wallet/wallet-notifier.service';
import { WalletService } from '../wallet/wallet.service';
import { VendorFanoutNotifier } from './vendor-fanout-notifier.service';

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

/** A vendor considered for an immediate slot, with the wallet identity billing needs. */
interface Candidate {
  readonly ranked: RankedVendor;
  /** Position in the CME's ranking, kept as the delivery rank so ordering survives skips. */
  readonly rank: number;
  readonly vendor: Vendor;
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
    @Inject(VENDOR_REPOSITORY) private readonly vendors: VendorRepositoryPort,
    private readonly wallet: WalletService,
    private readonly walletNotifier: WalletNotifier,
    private readonly fanout: VendorFanoutNotifier,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Loads the ranked vendors in one concurrent pass, dropping any that no longer exist.
   *
   * A missing vendor is not an error worth failing a search over — rankings are built from
   * materialised beliefs that can outlive a deleted record — so it is simply absent from the map
   * and every caller treats absence as "cannot be contacted".
   */
  private async resolveVendors(vendorIds: readonly string[]): Promise<Map<string, Vendor>> {
    const records = await Promise.all(vendorIds.map((id) => this.vendors.findById(id)));

    return new Map(
      records.filter((vendor): vendor is Vendor => vendor !== null).map((vendor) => [vendor.id, vendor]),
    );
  }

  /** Credits a vendor pays to become visible to one customer (TDR §25.2). */
  private get visibilityFee(): number {
    return this.config.credits.visibilityFee;
  }

  /**
   * Creates the customer request and distributes it.
   *
   * Immediate slots are filled by walking the ranking in order and stopping at the first vendor
   * who can pay the visibility fee (Konnet Credits Recharge TDR §25.6). The debit comes before
   * the reveal, never after: a vendor shown to a customer without being charged is revenue lost
   * silently, and the inverse — charged without being shown — is the one the reconciliation
   * query exists to catch.
   *
   * If nobody can pay, the top-ranked vendor is delivered anyway, unpaid. The billing model
   * degrades before the customer experience does: a buyer who asks for a hammer gets an answer
   * whether or not the marketplace has solvent vendors that day.
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
    const fee = this.visibilityFee;
    const capabilityName = params.capabilityName ?? params.product ?? params.query;

    // Bounded so an insolvent marketplace cannot turn one search into a wallet lookup per ranked
    // vendor. Beyond this depth a vendor would not have been contacted at all.
    const considered = params.ranked.slice(0, IMMEDIATE_DELIVERY_COUNT + FANOUT_LIMIT);

    // Resolved once, concurrently, because both the billing walk and the fan-out ask need the
    // vendor record — `userId` to bill and `conversationId` to reach their phone. Fetching them
    // one at a time down two loops would put up to eighteen sequential round trips on the
    // buyer's turn for information a single pass already has.
    const resolved = await this.resolveVendors(considered.map((vendor) => vendor.vendorId));

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

    // Best-effort vendor pushes, awaited together at the end. The notifier never throws, and
    // collecting them keeps the outcome observable instead of racing the caller's next turn.
    const pushes: Promise<void>[] = [];

    // ── Immediate delivery: billed first, revealed second ────────────────────────────
    const selected: Candidate[] = [];
    const skipped: { candidate: Candidate; balance: number }[] = [];

    for (const [rank, rankedVendor] of considered.entries()) {
      if (selected.length >= IMMEDIATE_DELIVERY_COUNT) break;

      const vendor = resolved.get(rankedVendor.vendorId);

      if (vendor === undefined) {
        // Ranked but no longer on the platform. Not a billing problem, so not a skip: there is
        // nobody to charge and nobody to notify.
        this.logger.stageFailed({
          component: COMPONENT,
          stage: `${STAGE}:Billing`,
          input: { requestId: request.id, vendorId: rankedVendor.vendorId },
          action: 'Ranked vendor no longer exists; passing over them for the immediate slot',
          error: new Error('vendor not found'),
        });
        continue;
      }

      const candidate: Candidate = { ranked: rankedVendor, rank, vendor };

      const debit = await this.wallet.debit({
        userId: vendor.userId,
        amountCredits: fee,
        reason: WALLET_DEBIT_REASONS.profileDelivery,
        providerReference: deliveryDebitReference(request.id, vendor.id),
        metadata: {
          requestId: request.id,
          vendorId: vendor.id,
          capabilityId: params.capabilityId,
          nairaPerCredit: this.config.credits.nairaPerCredit,
        },
      });

      if (debit.outcome === 'insufficient') {
        skipped.push({ candidate, balance: debit.balance });
        continue;
      }

      // `debited` or `duplicate`. Duplicate means a retry already paid for this exact
      // (request, vendor) pair, so the work is funded and must complete — charging again is the
      // only wrong answer here.
      const balanceAfter =
        debit.outcome === 'debited' ? debit.balanceAfter : await this.wallet.getBalance(vendor.userId);

      await this.recordDelivery({
        requestId: request.id,
        candidate,
        now,
        immediate: true,
        revealed: true,
        creditDeducted: true,
        tolerateExisting: debit.outcome === 'duplicate',
      });

      selected.push(candidate);

      events.push(
        this.event('request.delivered', {
          requestId: request.id,
          vendorId: vendor.id,
          payload: { capability: params.capabilityId, product: params.product, immediate: true },
        }),
        this.event('vendor.profile.delivered', {
          requestId: request.id,
          vendorId: vendor.id,
          payload: { customerId: params.customerId, query: params.query },
        }),
        // The unchanged marketplace signal. `wallet.debited` is the money event and is published
        // by WalletService; this one says a lead was billed, which the Evidence Service reads.
        this.event('vendor.credit.deducted', {
          requestId: request.id,
          vendorId: vendor.id,
          payload: {
            reason: WALLET_DEBIT_REASONS.profileDelivery,
            capability: params.capabilityId,
            credits: fee,
          },
        }),
      );

      pushes.push(
        this.walletNotifier.notifyConnected({
          userId: vendor.userId,
          conversationId: vendor.conversationId,
          capabilityName,
          credits: fee,
          balanceAfter,
        }),
      );
    }

    // ── Unpaid fallback: the customer always gets an answer ──────────────────────────
    while (selected.length < IMMEDIATE_DELIVERY_COUNT && skipped.length > 0) {
      const { candidate } = skipped.shift()!;

      await this.recordDelivery({
        requestId: request.id,
        candidate,
        now,
        immediate: true,
        revealed: true,
        creditDeducted: false,
        tolerateExisting: false,
      });

      selected.push(candidate);

      events.push(
        this.event('request.delivered', {
          requestId: request.id,
          vendorId: candidate.vendor.id,
          payload: {
            capability: params.capabilityId,
            product: params.product,
            immediate: true,
            unpaid: true,
          },
        }),
        this.event('vendor.profile.delivered', {
          requestId: request.id,
          vendorId: candidate.vendor.id,
          payload: { customerId: params.customerId, query: params.query, unpaid: true },
        }),
      );

      // No `vendor.credit.deducted`: nothing was deducted, and claiming otherwise would corrupt
      // both the ledger's story and the Evidence Service's.
      this.logger.stage({
        component: COMPONENT,
        stage: `${STAGE}:Billing`,
        input: { requestId: request.id, vendorId: candidate.vendor.id, fee },
        action:
          'No ranked vendor could pay the visibility fee; delivered the top-ranked vendor unpaid so the customer still gets an answer',
        output: { degraded: true, creditDeducted: false },
      });

      pushes.push(
        this.walletNotifier.notifyFreeTrial({
          userId: candidate.vendor.userId,
          conversationId: candidate.vendor.conversationId,
          capabilityName,
        }),
      );
    }

    // ── Fan-out: asked on WhatsApp, not yet visible, not billed until they accept ────
    const selectedIds = new Set(selected.map((candidate) => candidate.ranked.vendorId));
    const fannedOut = considered
      .map((rankedVendor, rank) => ({ rankedVendor, rank, vendor: resolved.get(rankedVendor.vendorId) }))
      .filter(
        (entry): entry is { rankedVendor: RankedVendor; rank: number; vendor: Vendor } =>
          // A vendor who cannot be asked cannot answer. Writing a pending row for a vendor who
          // no longer exists would buy nothing but a spurious `request.timeout` half an hour
          // later, which the Evidence Service would read as a real vendor ignoring a real
          // customer (Vendor Fan-Out TDR §14 V2).
          entry.vendor !== undefined && !selectedIds.has(entry.rankedVendor.vendorId),
      )
      .slice(0, FANOUT_LIMIT);

    for (const { rankedVendor, rank, vendor } of fannedOut) {
      const delivery = await this.prisma.requestDelivery.create({
        data: {
          requestId: request.id,
          vendorId: vendor.id,
          rank,
          score: rankedVendor.score,
          immediate: false,
          deliveredAt: now,
        },
      });

      events.push(
        this.event('request.delivered', {
          requestId: request.id,
          vendorId: vendor.id,
          payload: { capability: params.capabilityId, product: params.product, immediate: false },
        }),
      );

      // The ask. Best-effort: it publishes its own `vendor.notified` on success and swallows
      // every failure, so a vendor whose phone is unreachable cannot break the buyer's turn.
      pushes.push(
        this.fanout.notifyVendor({
          requestId: request.id,
          deliveryId: delivery.id,
          vendor,
          capabilityName,
          customerCity: params.customerCity,
          fee,
        }),
      );
    }

    // ── Missed leads: every vendor passed over for want of credits ───────────────────
    for (const { candidate, balance } of skipped) {
      events.push(
        this.event('vendor.credit.insufficient', {
          requestId: request.id,
          vendorId: candidate.vendor.id,
          payload: {
            requiredCredits: fee,
            balance,
            capability: params.capabilityId,
          },
        }),
      );

      pushes.push(
        this.walletNotifier.notifyInsufficient({
          userId: candidate.vendor.userId,
          conversationId: candidate.vendor.conversationId,
          capabilityName,
          requiredCredits: fee,
          balance,
          variant: 'lead',
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

    // The notifier swallows its own failures, so this settles rather than rejects.
    await Promise.allSettled(pushes);

    const immediate = selected.map((candidate) => candidate.ranked);

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { query: params.query, rankedVendors: params.ranked.length, visibilityFee: fee },
      action: `Delivered ${immediate.length} vendor(s) immediately and fanned the request out to ${fannedOut.length} more`,
      output: {
        requestId: request.id,
        immediate: immediate.map((vendor) => vendor.businessName),
        fannedOut: fannedOut.map((entry) => entry.rankedVendor.businessName),
        skippedForCredits: skipped.map((entry) => entry.candidate.ranked.businessName),
      },
      durationMs: Date.now() - startedAt,
    });

    return {
      requestId: request.id,
      immediate,
      fannedOut: fannedOut.map((entry) => entry.rankedVendor),
    };
  }

  /**
   * Writes the delivery row for a vendor filling an immediate slot.
   *
   * `tolerateExisting` is the crash-recovery path: a debit that committed before the row was
   * written leaves the fee paid and the delivery missing, and the retry has to be able to finish
   * the job rather than trip over its own unique constraint.
   */
  private async recordDelivery(params: {
    requestId: string;
    candidate: Candidate;
    now: Date;
    immediate: boolean;
    revealed: boolean;
    creditDeducted: boolean;
    tolerateExisting: boolean;
  }): Promise<void> {
    const data = {
      rank: params.candidate.rank,
      score: params.candidate.ranked.score,
      immediate: params.immediate,
      revealedToCustomer: params.revealed,
      creditDeducted: params.creditDeducted,
      deliveredAt: params.now,
    };

    if (!params.tolerateExisting) {
      await this.prisma.requestDelivery.create({
        data: { requestId: params.requestId, vendorId: params.candidate.vendor.id, ...data },
      });
      return;
    }

    await this.prisma.requestDelivery.upsert({
      where: {
        requestId_vendorId: { requestId: params.requestId, vendorId: params.candidate.vendor.id },
      },
      create: { requestId: params.requestId, vendorId: params.candidate.vendor.id, ...data },
      update: { revealedToCustomer: params.revealed, creditDeducted: params.creditDeducted },
    });
  }

  /**
   * Records a vendor's answer to a fanned-out request.
   *
   * Accepting is what makes a vendor visible to the customer — "Matched vendors that do not
   * respond SHALL NOT be presented to the customer" (§6) — and, since the visibility fee is the
   * product, that rule becomes "visible only once they respond **and** the debit succeeds"
   * (Konnet Credits Recharge TDR §25.6). A decline is free: the vendor stays hidden either way,
   * so there is nothing to charge for.
   *
   * The acceptance is recorded honestly even when the vendor cannot pay. They did say they have
   * the product, which is a positive capability signal the Evidence Service should learn from;
   * what they do not get is the reveal.
   */
  async findPendingDeliveryForVendor(vendorId: string): Promise<{
    requestId: string;
    deliveryId: string;
    request: {
      id: string;
      conversationId: string;
      customerId: string;
      capabilityId: string | null;
      capabilityName: string | null;
      product: string | null;
      query: string;
    };
  } | null> {
    const delivery = await this.prisma.requestDelivery.findFirst({
      where: { vendorId, status: 'pending' },
      orderBy: { deliveredAt: 'desc' },
      include: { request: true },
    });

    if (delivery === null) return null;

    return {
      requestId: delivery.requestId,
      deliveryId: delivery.id,
      request: delivery.request,
    };
  }

  /**
   * Records a vendor's answer to a fanned-out request.
   */
  async recordVendorResponse(params: {
    requestId: string;
    vendorId: string;
    accepted: boolean;
  }): Promise<{
    revealed: boolean;
    request: {
      id: string;
      conversationId: string;
      customerId: string;
      capabilityId: string | null;
      capabilityName: string | null;
      product: string | null;
      query: string;
    };
  } | null> {
    const delivery = await this.prisma.requestDelivery.findUnique({
      where: { requestId_vendorId: { requestId: params.requestId, vendorId: params.vendorId } },
      include: { request: true },
    });

    if (delivery === null || delivery.status !== 'pending') return null;

    const now = this.clock.now();
    const responseTimeMs = now.getTime() - delivery.deliveredAt.getTime();
    const events: DomainEvent[] = [];
    const pushes: Promise<void>[] = [];

    // A decline needs no vendor record and no wallet: nothing becomes visible, so nothing is due.
    const billing = params.accepted
      ? await this.billResponder({ delivery, request: delivery.request })
      : { revealed: false, creditDeducted: false, events: [], pushes: [] };

    events.push(...billing.events);
    pushes.push(...billing.pushes);

    await this.prisma.requestDelivery.update({
      where: { id: delivery.id },
      data: {
        status: params.accepted ? 'accepted' : 'rejected',
        respondedAt: now,
        responseTimeMs,
        revealedToCustomer: billing.revealed,
        ...(billing.creditDeducted ? { creditDeducted: true } : {}),
      },
    });

    events.unshift(
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
    );

    await this.events.publishAll(events);
    await Promise.allSettled(pushes);

    this.logger.stage({
      component: COMPONENT,
      stage: `${STAGE}:Response`,
      input: { requestId: params.requestId, vendorId: params.vendorId, accepted: params.accepted },
      action: !params.accepted
        ? 'Vendor declined; they remain hidden from the customer'
        : billing.revealed
          ? 'Vendor accepted and paid the visibility fee; they are now visible to the customer'
          : 'Vendor accepted but could not pay the visibility fee; the acceptance is recorded and they stay hidden',
      output: { responseTimeMs, revealed: billing.revealed, creditDeducted: billing.creditDeducted },
    });

    return { revealed: billing.revealed, request: delivery.request };
  }

  /**
   * Charges an accepting responder before they become visible (TDR §25.6).
   *
   * Returns what the caller should write and publish rather than writing it, so the delivery row
   * is still updated exactly once whichever way the debit goes.
   */
  private async billResponder(params: {
    delivery: { id: string; vendorId: string; requestId: string };
    request: {
      capabilityId: string | null;
      capabilityName: string | null;
      product: string | null;
      query: string;
    };
  }): Promise<{
    revealed: boolean;
    creditDeducted: boolean;
    events: DomainEvent[];
    pushes: Promise<void>[];
  }> {
    const fee = this.visibilityFee;
    const { delivery, request } = params;
    const capabilityName = request.capabilityName ?? request.product ?? request.query;

    const vendor = await this.vendors.findById(delivery.vendorId);

    if (vendor === null) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Billing`,
        input: { requestId: delivery.requestId, vendorId: delivery.vendorId },
        action: 'Responding vendor no longer exists; recorded the acceptance without revealing them',
        error: new Error('vendor not found'),
      });
      return { revealed: false, creditDeducted: false, events: [], pushes: [] };
    }

    const debit = await this.wallet.debit({
      userId: vendor.userId,
      amountCredits: fee,
      reason: WALLET_DEBIT_REASONS.responseAccepted,
      providerReference: responseDebitReference(delivery.requestId, vendor.id),
      metadata: {
        requestId: delivery.requestId,
        deliveryId: delivery.id,
        capabilityId: request.capabilityId,
        product: request.product,
      },
    });

    if (debit.outcome === 'insufficient') {
      return {
        revealed: false,
        creditDeducted: false,
        events: [
          this.event('vendor.credit.insufficient', {
            requestId: delivery.requestId,
            vendorId: vendor.id,
            payload: { requiredCredits: fee, balance: debit.balance, capability: request.capabilityId },
          }),
        ],
        pushes: [
          this.walletNotifier.notifyInsufficient({
            userId: vendor.userId,
            conversationId: vendor.conversationId,
            capabilityName,
            requiredCredits: fee,
            balance: debit.balance,
            variant: 'responder',
          }),
        ],
      };
    }

    // `duplicate` here is the crash-recovery path: the fee was taken and the reveal never
    // landed. Charging again would punish the vendor for our outage.
    const balanceAfter =
      debit.outcome === 'debited' ? debit.balanceAfter : await this.wallet.getBalance(vendor.userId);

    return {
      revealed: true,
      creditDeducted: true,
      events: [
        this.event('vendor.credit.deducted', {
          requestId: delivery.requestId,
          vendorId: vendor.id,
          payload: {
            reason: WALLET_DEBIT_REASONS.responseAccepted,
            capability: request.capabilityId,
            credits: fee,
          },
        }),
      ],
      pushes: [
        this.walletNotifier.notifyConnected({
          userId: vendor.userId,
          conversationId: vendor.conversationId,
          capabilityName,
          credits: fee,
          balanceAfter,
        }),
      ],
    };
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
        // Fan-out rows only. An immediate delivery is also created `pending`, but it was never a
        // question: that vendor was billed and shown to the customer without being asked
        // anything, so sweeping them would publish `request.timeout` — read by the Evidence
        // Service as `no_response`, polarity -1 — against the one vendor who did nothing wrong.
        // Silence is only evidence when there was a question.
        where: { status: 'pending', immediate: false, deliveredAt: { lte: cutoff } },
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
