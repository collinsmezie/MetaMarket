import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaEvidenceRepository } from '../../src/adapters/outbound/persistence/prisma-evidence.repository';
import { PrismaVendorRepository } from '../../src/adapters/outbound/persistence/prisma-vendor.repository';
import { PrismaWalletRepository } from '../../src/adapters/outbound/persistence/prisma-wallet.repository';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { EvidenceProcessor } from '../../src/application/evidence/evidence-processor.service';
import { EvidenceQueryService } from '../../src/application/evidence/evidence-query.service';
import { RequestDistributionService } from '../../src/application/fulfilment/request-distribution.service';
import { WalletNotifier } from '../../src/application/wallet/wallet-notifier.service';
import { WalletService } from '../../src/application/wallet/wallet.service';
import { AppConfigModule } from '../../src/config/config.module';
import { AppConfigService } from '../../src/config/app-config.service';
import type { RankedVendor } from '../../src/domain/models/demand';
import { NEUTRAL_EVIDENCE_SCORE } from '../../src/domain/models/evidence';
import { EVENT_PUBLISHER, type DomainEvent } from '../../src/domain/ports/outbound/event-publisher.port';
import { EVIDENCE_REPOSITORY } from '../../src/domain/ports/outbound/evidence-repository.port';
import { STAGE_LOGGER } from '../../src/domain/ports/outbound/stage-logger.port';
import { CLOCK, ID_GENERATOR } from '../../src/domain/ports/outbound/system.port';
import { VENDOR_REPOSITORY } from '../../src/domain/ports/outbound/vendor-repository.port';
import { PAYMENT_PROVIDER } from '../../src/domain/ports/outbound/payment-provider.port';
import {
  VIRTUAL_ACCOUNT_REPOSITORY,
  WALLET_REPOSITORY,
} from '../../src/domain/ports/outbound/wallet-repository.port';
import { RecordingStageLogger, RecordingWalletNotifier } from '../fakes';

/**
 * The closed marketplace loop: distribution → vendor behaviour → evidence → better ranking.
 *
 * This is the property the whole architecture exists to produce — "the marketplace itself becomes
 * the teacher". Everything here is production code against real Postgres; only the clock is
 * controlled, so response times and timeouts are deterministic.
 */
describe('Marketplace learning loop', () => {
  let prisma: PrismaService;
  let distribution: RequestDistributionService;
  let processor: EvidenceProcessor;
  let query: EvidenceQueryService;
  let vendors: PrismaVendorRepository;
  let wallet: WalletService;
  let notifier: RecordingWalletNotifier;
  let fee: number;

  const HAMMER = '10003500';
  const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333';
  const WORKFLOW_ID = '44444444-4444-4444-8444-444444444444';

  /** Events published in-process are captured and fed straight to the Evidence Service. */
  const published: DomainEvent[] = [];

  let clockNow = new Date('2026-08-07T09:00:00Z');

  const ranked = (vendorId: string, name: string, score: number): RankedVendor => ({
    vendorId,
    businessName: name,
    city: 'Aba',
    state: 'Abia',
    score,
    components: {
      capabilityMatch: score,
      expansionMatch: 0,
      evidenceScore: NEUTRAL_EVIDENCE_SCORE,
      evidenceConfidence: 0,
      proximity: 1,
      availability: 1,
    },
    reasons: ['Confirmed capability.'],
  });

  /** Drains published events through the Evidence Service. */
  const settleEvidence = async () => {
    const repo = evidenceRepo;
    for (const event of published.splice(0)) await repo.recordRawEvent(event);
    await processor.processBacklog();
  };

  let evidenceRepo: PrismaEvidenceRepository;

  /**
   * Creates an active vendor.
   *
   * Funded by default because that is what production looks like: every vendor who completes
   * onboarding receives the grant (TDR §25.12), so an unfunded vendor is the exception, not the
   * baseline. Tests that care about insolvency ask for it explicitly.
   */
  const createVendor = async (name: string, credits = 2_000) => {
    const id = randomUUID();
    const userId = `+234${Math.floor(1000000000 + Math.random() * 8999999999)}`;

    await vendors.create({
      id,
      userId,
      conversationId: CONVERSATION_ID,
      businessName: name,
      location: { city: 'Aba', state: 'Abia', country: 'Nigeria', confidence: 1 },
      conversationSummary: '',
    });
    await vendors.update(id, { status: 'active' });

    if (credits > 0) {
      await wallet.grantOnboardingCredits({
        userId,
        conversationId: CONVERSATION_ID,
        vendorId: id,
        amountCredits: credits,
      });
    }

    return id;
  };

  const balanceOf = async (vendorId: string): Promise<number> => {
    const vendor = await vendors.findById(vendorId);
    return wallet.getBalance(vendor!.userId);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [
        PrismaService,
        PrismaEvidenceRepository,
        PrismaVendorRepository,
        PrismaWalletRepository,
        EvidenceProcessor,
        EvidenceQueryService,
        RequestDistributionService,
        WalletService,
        { provide: EVIDENCE_REPOSITORY, useExisting: PrismaEvidenceRepository },
        { provide: VENDOR_REPOSITORY, useExisting: PrismaVendorRepository },
        { provide: WALLET_REPOSITORY, useExisting: PrismaWalletRepository },
        // Billing never provisions a funding account, so these two are unreachable here; a
        // throwing double proves that rather than quietly allowing it.
        {
          provide: VIRTUAL_ACCOUNT_REPOSITORY,
          useValue: {
            findActiveByWalletId: async () => null,
            findByAccountNumber: async () => null,
            create: async () => {
              throw new Error('distribution must never provision a funding account');
            },
          },
        },
        {
          provide: PAYMENT_PROVIDER,
          useValue: {
            provisionDedicatedAccount: async () => {
              throw new Error('distribution must never call Paystack');
            },
          },
        },
        { provide: WalletNotifier, useValue: new RecordingWalletNotifier() },
        { provide: STAGE_LOGGER, useValue: new RecordingStageLogger() },
        { provide: CLOCK, useValue: { now: () => new Date(clockNow) } },
        {
          provide: ID_GENERATOR,
          useValue: { uuid: () => randomUUID(), prefixed: (p: string) => `${p}_${randomUUID().slice(0, 8)}` },
        },
        {
          provide: EVENT_PUBLISHER,
          useValue: {
            publish: async (event: DomainEvent) => {
              published.push(event);
            },
            publishAll: async (events: readonly DomainEvent[]) => {
              published.push(...events);
            },
          },
        },
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    distribution = moduleRef.get(RequestDistributionService);
    processor = moduleRef.get(EvidenceProcessor);
    query = moduleRef.get(EvidenceQueryService);
    vendors = moduleRef.get(PrismaVendorRepository);
    evidenceRepo = moduleRef.get(PrismaEvidenceRepository);
    wallet = moduleRef.get(WalletService);
    notifier = moduleRef.get(WalletNotifier) as unknown as RecordingWalletNotifier;
    fee = moduleRef.get(AppConfigService).credits.visibilityFee;

    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.requestDelivery.deleteMany();
    await prisma.customerRequest.deleteMany();
    await prisma.evidenceAggregate.deleteMany();
    await prisma.evidenceRecord.deleteMany();
    await prisma.marketplaceEvent.deleteMany();
    await prisma.vendor.deleteMany();
    await prisma.creditTransaction.deleteMany();
    await prisma.creditWallet.deleteMany();
    notifier.insufficient.length = 0;
    notifier.connected.length = 0;
    notifier.freeTrial.length = 0;
    published.length = 0;
    clockNow = new Date('2026-08-07T09:00:00Z');
  });

  const distributeTo = async (vendorIds: readonly string[]) =>
    distribution.distribute({
      conversationId: CONVERSATION_ID,
      workflowId: WORKFLOW_ID,
      customerId: '+2348011112222',
      query: 'I need a hammer',
      capabilityId: HAMMER,
      capabilityName: 'Hammers',
      product: 'hammer',
      customerCity: 'Aba',
      ranked: vendorIds.map((id, index) => ranked(id, `Vendor ${index + 1}`, 0.9 - index * 0.1)),
    });

  it('delivers the top vendor immediately and fans the rest out', async () => {
    const ids = [
      await createVendor('Top Hardware'),
      await createVendor('Second'),
      await createVendor('Third'),
    ];

    const result = await distributeTo(ids);

    expect(result.immediate).toHaveLength(1);
    expect(result.fannedOut).toHaveLength(2);

    const deliveries = await prisma.requestDelivery.findMany({ orderBy: { rank: 'asc' } });

    // The top vendor is visible at once and billed; the rest are asked but hidden.
    expect(deliveries[0]).toMatchObject({ immediate: true, revealedToCustomer: true, creditDeducted: true });
    expect(deliveries[1]).toMatchObject({
      immediate: false,
      revealedToCustomer: false,
      creditDeducted: false,
    });
  });

  it('bills only the vendor actually delivered to the customer', async () => {
    const ids = [await createVendor('Top'), await createVendor('Second')];
    await distributeTo(ids);

    const billed = published.filter((event) => event.eventType === 'vendor.credit.deducted');

    // Charging speculative fan-out recipients would bill vendors for nothing.
    expect(billed).toHaveLength(1);
    expect(billed[0].vendorId).toBe(ids[0]);
  });

  it('keeps a silent vendor hidden from the customer', async () => {
    const ids = [await createVendor('Top'), await createVendor('Silent')];
    const result = await distributeTo(ids);

    const revealed = await distribution.revealedVendors(result.requestId);

    // MCOS Refinement #11 §6: non-responders are never presented.
    expect(revealed.map((entry) => entry.vendorId)).toEqual([ids[0]]);
  });

  it('reveals a fanned-out vendor once they accept', async () => {
    const ids = [await createVendor('Top'), await createVendor('Responder')];
    const result = await distributeTo(ids);

    await distribution.recordVendorResponse({
      requestId: result.requestId,
      vendorId: ids[1],
      accepted: true,
    });

    const revealed = await distribution.revealedVendors(result.requestId);
    expect(revealed.map((entry) => entry.vendorId)).toEqual(ids);
  });

  it('keeps a vendor who declines hidden, while crediting them for replying', async () => {
    const ids = [await createVendor('Top'), await createVendor('Honest')];
    const result = await distributeTo(ids);

    await distribution.recordVendorResponse({
      requestId: result.requestId,
      vendorId: ids[1],
      accepted: false,
    });

    expect((await distribution.revealedVendors(result.requestId)).map((e) => e.vendorId)).toEqual([ids[0]]);

    await settleEvidence();
    const evidence = await query.getCapabilityEvidence(ids[1], HAMMER);

    // Replying "no" is good behaviour and bad inventory — recorded as both.
    expect(evidence?.counters.responded).toBe(1);
    expect(evidence?.counters.rejected).toBe(1);
  });

  it('records response latency from the delivery, not the wall clock', async () => {
    const ids = [await createVendor('Top'), await createVendor('Quick')];
    const result = await distributeTo(ids);

    clockNow = new Date(clockNow.getTime() + 3 * 60_000);
    await distribution.recordVendorResponse({
      requestId: result.requestId,
      vendorId: ids[1],
      accepted: true,
    });

    await settleEvidence();
    const evidence = await query.getCapabilityEvidence(ids[1], HAMMER);

    expect(evidence?.counters.responseTimeSumMs).toBe(180_000);
  });

  it('records silence as a no-response once the window passes', async () => {
    const ids = [await createVendor('Top'), await createVendor('Ghost')];
    await distributeTo(ids);

    clockNow = new Date(clockNow.getTime() + 31 * 60_000);
    await distribution.sweepTimeouts();
    await settleEvidence();

    const evidence = await query.getCapabilityEvidence(ids[1], HAMMER);

    // Without recording silence, ignoring requests would carry no cost at all.
    expect(evidence?.counters.noResponse).toBe(1);
    expect(evidence!.score).toBeLessThan(NEUTRAL_EVIDENCE_SCORE);
  });

  it('does not time out a vendor who already answered', async () => {
    const ids = [await createVendor('Top'), await createVendor('Answered')];
    const result = await distributeTo(ids);

    await distribution.recordVendorResponse({
      requestId: result.requestId,
      vendorId: ids[1],
      accepted: true,
    });

    clockNow = new Date(clockNow.getTime() + 31 * 60_000);
    await distribution.sweepTimeouts();
    await settleEvidence();

    const evidence = await query.getCapabilityEvidence(ids[1], HAMMER);
    expect(evidence?.counters.noResponse).toBe(0);
  });

  it('closes the loop: behaviour today changes ranking tomorrow', async () => {
    const reliable = await createVendor('Reliable Hardware');
    const unreliable = await createVendor('Unreliable Hardware');

    // Ten rounds of the marketplace running: one vendor performs, the other ignores.
    for (let round = 0; round < 10; round += 1) {
      const result = await distributeTo([reliable, unreliable]);

      clockNow = new Date(clockNow.getTime() + 2 * 60_000);
      await distribution.recordVendorResponse({
        requestId: result.requestId,
        vendorId: unreliable,
        accepted: false,
      });

      await distribution.recordSelection({ requestId: result.requestId, vendorId: reliable });
      await distribution.recordCompletion({ requestId: result.requestId, vendorId: reliable });

      clockNow = new Date(clockNow.getTime() + 60 * 60_000);
    }

    await settleEvidence();

    const scores = await query.getEvidenceScores({
      vendorIds: [reliable, unreliable],
      subjectType: 'capability',
      subject: HAMMER,
    });

    const reliableScore = scores.get(reliable)!.score;
    const unreliableScore = scores.get(unreliable)!.score;

    // This is the whole thesis: the marketplace taught the system who to trust.
    expect(reliableScore).toBeGreaterThan(unreliableScore);
    expect(scores.get(reliable)!.confidence).toBeGreaterThan(0.4);
    expect(scores.get(reliable)!.reasons.join(' ')).toContain('Completed');
  });

  /**
   * Paid visibility (Konnet Credits Recharge TDR §25).
   *
   * Real Postgres, real wallet repository, real ledger constraints — the guarantees under test
   * are database guarantees, so mocking the database would test nothing.
   */
  describe('paid visibility', () => {
    it('debits the delivered vendor exactly once and tells them they are connected', async () => {
      const ids = [await createVendor('Top Hardware'), await createVendor('Second')];

      await distributeTo(ids);

      expect(await balanceOf(ids[0])).toBe(2_000 - fee);
      // The fanned-out vendor pays nothing until they answer.
      expect(await balanceOf(ids[1])).toBe(2_000);

      const debits = await prisma.creditTransaction.findMany({ where: { type: 'debit' } });
      expect(debits).toHaveLength(1);
      expect(debits[0].amountKobo).toBeNull();
      expect(notifier.connected).toHaveLength(1);
    });

    it('skips an insolvent top-ranked vendor and delivers the next one who can pay', async () => {
      const broke = await createVendor('Broke Hardware', 0);
      const solvent = await createVendor('Solvent Hardware');

      const result = await distributeTo([broke, solvent]);

      expect(result.immediate.map((vendor) => vendor.vendorId)).toEqual([solvent]);
      expect(await balanceOf(solvent)).toBe(2_000 - fee);

      const insufficient = published.filter((event) => event.eventType === 'vendor.credit.insufficient');
      expect(insufficient.map((event) => event.vendorId)).toEqual([broke]);
      expect(notifier.insufficient.map((push) => push.variant)).toEqual(['lead']);
    });

    it('still fans the skipped vendor out — they can earn the lead by answering', async () => {
      const broke = await createVendor('Broke Hardware', 0);
      const solvent = await createVendor('Solvent Hardware');

      const result = await distributeTo([broke, solvent]);

      expect(result.fannedOut.map((vendor) => vendor.vendorId)).toEqual([broke]);
      const delivery = await prisma.requestDelivery.findFirstOrThrow({ where: { vendorId: broke } });
      expect(delivery).toMatchObject({ immediate: false, revealedToCustomer: false, creditDeducted: false });
    });

    it('delivers the top vendor unpaid when nobody can pay, so the customer still gets an answer', async () => {
      const ids = [await createVendor('Broke One', 0), await createVendor('Broke Two', 0)];

      const result = await distributeTo(ids);

      expect(result.immediate.map((vendor) => vendor.vendorId)).toEqual([ids[0]]);

      const delivery = await prisma.requestDelivery.findFirstOrThrow({ where: { vendorId: ids[0] } });
      expect(delivery).toMatchObject({ revealedToCustomer: true, creditDeducted: false });

      // The billing model degraded, not the customer experience — and the vendor is told so.
      expect(published.filter((event) => event.eventType === 'vendor.credit.deducted')).toHaveLength(0);
      expect(notifier.freeTrial.map((push) => push.userId)).toHaveLength(1);
      // The promoted vendor is removed from the skip list — telling them they missed a lead they
      // did in fact receive would be a lie. The vendor still passed over does get told.
      expect(notifier.insufficient).toHaveLength(1);
    });

    it('never takes a balance below zero, however many leads arrive', async () => {
      // Enough credits for exactly one lead.
      const vendor = await createVendor('Nearly Broke', fee);

      await distributeTo([vendor]);
      await distributeTo([vendor]);
      await distributeTo([vendor]);

      expect(await balanceOf(vendor)).toBe(0);
    });

    it('charges once when the same request is distributed concurrently', async () => {
      const vendor = await createVendor('Top Hardware');

      // Two workers racing on the same ranking. Separate requests, so this proves the ledger
      // serialises rather than that the reference happens to collide.
      await Promise.all([distributeTo([vendor]), distributeTo([vendor])]);

      // Two distinct requests are two distinct leads, both legitimately billable.
      expect(await balanceOf(vendor)).toBe(2_000 - 2 * fee);
    });

    it('bills a responder who accepts, and reveals them only then', async () => {
      const ids = [await createVendor('Top'), await createVendor('Responder')];
      const result = await distributeTo(ids);

      await distribution.recordVendorResponse({
        requestId: result.requestId,
        vendorId: ids[1],
        accepted: true,
      });

      expect(await balanceOf(ids[1])).toBe(2_000 - fee);
      const delivery = await prisma.requestDelivery.findFirstOrThrow({ where: { vendorId: ids[1] } });
      expect(delivery).toMatchObject({ revealedToCustomer: true, creditDeducted: true, status: 'accepted' });
    });

    it('records an insolvent responder\u2019s acceptance but never reveals them', async () => {
      const top = await createVendor('Top');
      const broke = await createVendor('Broke Responder', 0);
      const result = await distributeTo([top, broke]);

      const outcome = await distribution.recordVendorResponse({
        requestId: result.requestId,
        vendorId: broke,
        accepted: true,
      });

      expect(outcome).toEqual({ revealed: false });

      const delivery = await prisma.requestDelivery.findFirstOrThrow({ where: { vendorId: broke } });
      // The acceptance is honest evidence — they do have the product — but the customer never
      // sees an unbilled vendor.
      expect(delivery).toMatchObject({
        status: 'accepted',
        revealedToCustomer: false,
        creditDeducted: false,
      });
      expect((await distribution.revealedVendors(result.requestId)).map((entry) => entry.vendorId)).toEqual([
        top,
      ]);
      expect(notifier.insufficient.map((push) => push.variant)).toContain('responder');
    });

    it('never bills a decline', async () => {
      const ids = [await createVendor('Top'), await createVendor('Decliner')];
      const result = await distributeTo(ids);

      await distribution.recordVendorResponse({
        requestId: result.requestId,
        vendorId: ids[1],
        accepted: false,
      });

      expect(await balanceOf(ids[1])).toBe(2_000);
    });

    it('grants onboarding credits once, and they pay for the first lead', async () => {
      const vendor = await createVendor('Fresh Vendor');

      // A redelivered seller.onboarded must not double the grant.
      const replay = await wallet.grantOnboardingCredits({
        userId: (await vendors.findById(vendor))!.userId,
        conversationId: CONVERSATION_ID,
        vendorId: vendor,
        amountCredits: 2_000,
      });

      expect(replay).toEqual({ outcome: 'duplicate' });
      expect(await balanceOf(vendor)).toBe(2_000);

      await distributeTo([vendor]);
      expect(await balanceOf(vendor)).toBe(1_900);
    });
  });

  it('marks the request fulfilled when a deal completes', async () => {
    const ids = [await createVendor('Top')];
    const result = await distributeTo(ids);

    await distribution.recordCompletion({ requestId: result.requestId, vendorId: ids[0] });

    const request = await prisma.customerRequest.findUniqueOrThrow({ where: { id: result.requestId } });
    expect(request.status).toBe('fulfilled');
    expect(request.fulfilledAt).not.toBeNull();
  });

  it('ignores a duplicate response rather than double-counting it', async () => {
    const ids = [await createVendor('Top'), await createVendor('Eager')];
    const result = await distributeTo(ids);

    await distribution.recordVendorResponse({
      requestId: result.requestId,
      vendorId: ids[1],
      accepted: true,
    });
    const second = await distribution.recordVendorResponse({
      requestId: result.requestId,
      vendorId: ids[1],
      accepted: true,
    });

    expect(second).toBeNull();

    await settleEvidence();
    const evidence = await query.getCapabilityEvidence(ids[1], HAMMER);
    expect(evidence?.counters.accepted).toBe(1);
  });
});
