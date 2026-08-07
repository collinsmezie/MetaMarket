import { Test } from '@nestjs/testing';
import { PrismaEvidenceRepository } from '../../src/adapters/outbound/persistence/prisma-evidence.repository';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { EvidenceProcessor } from '../../src/application/evidence/evidence-processor.service';
import { EvidenceQueryService } from '../../src/application/evidence/evidence-query.service';
import { AppConfigModule } from '../../src/config/config.module';
import { NEUTRAL_EVIDENCE_SCORE } from '../../src/domain/models/evidence';
import { EVIDENCE_REPOSITORY } from '../../src/domain/ports/outbound/evidence-repository.port';
import type { DomainEvent } from '../../src/domain/ports/outbound/event-publisher.port';
import { STAGE_LOGGER } from '../../src/domain/ports/outbound/stage-logger.port';
import { CLOCK, ID_GENERATOR } from '../../src/domain/ports/outbound/system.port';
import { RecordingStageLogger } from '../fakes';
import { randomUUID } from 'node:crypto';

/**
 * The Evidence Service end to end against real Postgres: events in, scores out.
 *
 * Exercises the pipeline the TDR specifies — publish → raw store → processor → records →
 * aggregator → internal API — and the invariants that make it trustworthy: raw events are
 * immutable, redelivery cannot inflate a score, and the CME never sees a raw event.
 */
describe('Evidence Service integration', () => {
  let prisma: PrismaService;
  let processor: EvidenceProcessor;
  let query: EvidenceQueryService;

  const VENDOR_A = '11111111-1111-4111-8111-111111111111';
  const VENDOR_B = '22222222-2222-4222-8222-222222222222';
  const HAMMER_BRICK = '10003500';

  const event = (overrides: Partial<DomainEvent> & { eventType: string }): DomainEvent => ({
    eventId: randomUUID(),
    timestamp: new Date('2026-08-06T10:00:00Z'),
    producer: 'RequestDistributionService',
    payload: {},
    ...overrides,
  });

  /** Publishes an event and drains the backlog, so assertions see settled scores. */
  const ingest = async (...events: readonly DomainEvent[]) => {
    const repo = (await Promise.resolve(moduleEvidence)) as PrismaEvidenceRepository;

    for (const e of events) await repo.recordRawEvent(e);
    await processor.processBacklog();
  };

  let moduleEvidence: PrismaEvidenceRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [
        PrismaService,
        PrismaEvidenceRepository,
        EvidenceProcessor,
        EvidenceQueryService,
        { provide: EVIDENCE_REPOSITORY, useExisting: PrismaEvidenceRepository },
        { provide: STAGE_LOGGER, useValue: new RecordingStageLogger() },
        { provide: CLOCK, useValue: { now: () => new Date('2026-08-06T12:00:00Z') } },
        { provide: ID_GENERATOR, useValue: { uuid: () => randomUUID(), prefixed: (p: string) => `${p}_x` } },
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    processor = moduleRef.get(EvidenceProcessor);
    query = moduleRef.get(EvidenceQueryService);
    moduleEvidence = moduleRef.get(PrismaEvidenceRepository);

    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.evidenceAggregate.deleteMany();
    await prisma.evidenceRecord.deleteMany();
    await prisma.marketplaceEvent.deleteMany();
  });

  it('turns a fan-out lifecycle into an evidence score', async () => {
    // The Evidence Service TDR's worked example: delivered → accepted → selected → completed.
    await ingest(
      event({
        eventType: 'request.delivered',
        vendorId: VENDOR_A,
        payload: { product: 'Hammer', capability: HAMMER_BRICK },
      }),
      event({
        eventType: 'request.accepted',
        vendorId: VENDOR_A,
        payload: { product: 'Hammer', capability: HAMMER_BRICK, responseTime: 180 },
      }),
      event({ eventType: 'vendor.selected', vendorId: VENDOR_A, payload: { product: 'Hammer' } }),
      event({ eventType: 'match.completed', vendorId: VENDOR_A, payload: { product: 'Hammer' } }),
    );

    const capability = await query.getCapabilityEvidence(VENDOR_A, HAMMER_BRICK);

    expect(capability).not.toBeNull();
    expect(capability?.counters.delivered).toBe(1);
    expect(capability?.counters.accepted).toBe(1);
    expect(capability?.score).toBeGreaterThan(0);

    // Product-level evidence accumulates in parallel, case-normalised.
    const product = await query.getProductEvidence(VENDOR_A, 'hammer');
    expect(product?.counters.completed).toBe(1);
  });

  it('records a rejection as responsive but out of stock', async () => {
    // Replying "no" is good behaviour and bad inventory. Collapsing the two would punish
    // honest vendors for answering.
    await ingest(
      event({ eventType: 'request.delivered', vendorId: VENDOR_A, payload: { capability: HAMMER_BRICK } }),
      event({
        eventType: 'request.rejected',
        vendorId: VENDOR_A,
        payload: { capability: HAMMER_BRICK, responseTime: 60 },
      }),
    );

    const capability = await query.getCapabilityEvidence(VENDOR_A, HAMMER_BRICK);

    expect(capability?.counters.responded).toBe(1);
    expect(capability?.counters.rejected).toBe(1);
    expect(capability?.counters.accepted).toBe(0);
  });

  it('penalises silence', async () => {
    await ingest(
      ...Array.from({ length: 5 }, () =>
        event({ eventType: 'request.delivered', vendorId: VENDOR_B, payload: { capability: HAMMER_BRICK } }),
      ),
      ...Array.from({ length: 5 }, () =>
        event({ eventType: 'request.timeout', vendorId: VENDOR_B, payload: { capability: HAMMER_BRICK } }),
      ),
    );

    const capability = await query.getCapabilityEvidence(VENDOR_B, HAMMER_BRICK);

    expect(capability?.counters.noResponse).toBe(5);
    expect(capability?.score).toBeLessThan(NEUTRAL_EVIDENCE_SCORE);
  });

  it('ignores a redelivered event rather than counting it twice', async () => {
    const duplicate = event({
      eventType: 'request.accepted',
      vendorId: VENDOR_A,
      payload: { capability: HAMMER_BRICK },
    });

    await ingest(duplicate);
    await ingest(duplicate);

    const capability = await query.getCapabilityEvidence(VENDOR_A, HAMMER_BRICK);

    // Double-counting here would silently inflate every score in the marketplace.
    expect(capability?.counters.accepted).toBe(1);
    expect(await prisma.marketplaceEvent.count()).toBe(1);
  });

  it('keeps raw events after processing, for replay and audit', async () => {
    await ingest(
      event({ eventType: 'request.accepted', vendorId: VENDOR_A, payload: { capability: HAMMER_BRICK } }),
    );

    const raw = await prisma.marketplaceEvent.findFirst();

    expect(raw).not.toBeNull();
    expect(raw?.processedAt).not.toBeNull();
    // Immutable: processing marks them, it never consumes them.
    expect(raw?.eventType).toBe('request.accepted');
  });

  it('records evidence at vendor, capability and product level from one event', async () => {
    await ingest(
      event({
        eventType: 'request.accepted',
        vendorId: VENDOR_A,
        payload: { product: 'Hammer', capability: HAMMER_BRICK },
      }),
    );

    const summary = await query.getVendorEvidence(VENDOR_A);

    expect(summary.bySubject.map((s) => s.subjectType).sort()).toEqual(['capability', 'product']);
    // The vendor-level aggregate is what a cold-start search falls back to.
    expect(summary.overallScore).toBeGreaterThan(0);
  });

  it('falls back to overall reliability when there is no subject-specific evidence', async () => {
    await ingest(
      event({ eventType: 'request.delivered', vendorId: VENDOR_A, payload: { capability: '99999999' } }),
      event({ eventType: 'request.accepted', vendorId: VENDOR_A, payload: { capability: '99999999' } }),
    );

    const scores = await query.getEvidenceScores({
      vendorIds: [VENDOR_A],
      subjectType: 'capability',
      subject: HAMMER_BRICK,
    });

    const lookup = scores.get(VENDOR_A);

    // Never asked for a hammer, but proven reliable elsewhere — judged on that, and flagged.
    expect(lookup?.fallback).toBe(true);
    expect(lookup?.score).toBeGreaterThan(0);
  });

  it('places a vendor with no history at neutral rather than last', async () => {
    const scores = await query.getEvidenceScores({
      vendorIds: [VENDOR_B],
      subjectType: 'capability',
      subject: HAMMER_BRICK,
    });

    expect(scores.get(VENDOR_B)?.score).toBe(NEUTRAL_EVIDENCE_SCORE);
    expect(scores.get(VENDOR_B)?.confidence).toBe(0);
  });

  it('ranks a proven vendor above one with a single lucky acceptance', async () => {
    const many = Array.from({ length: 12 }, () => [
      event({ eventType: 'request.delivered', vendorId: VENDOR_A, payload: { capability: HAMMER_BRICK } }),
      event({ eventType: 'request.accepted', vendorId: VENDOR_A, payload: { capability: HAMMER_BRICK } }),
      event({ eventType: 'vendor.selected', vendorId: VENDOR_A, payload: { capability: HAMMER_BRICK } }),
      event({ eventType: 'match.completed', vendorId: VENDOR_A, payload: { capability: HAMMER_BRICK } }),
    ]).flat();

    await ingest(
      ...many,
      event({ eventType: 'request.delivered', vendorId: VENDOR_B, payload: { capability: HAMMER_BRICK } }),
      event({ eventType: 'request.accepted', vendorId: VENDOR_B, payload: { capability: HAMMER_BRICK } }),
    );

    const scores = await query.getEvidenceScores({
      vendorIds: [VENDOR_A, VENDOR_B],
      subjectType: 'capability',
      subject: HAMMER_BRICK,
    });

    expect(scores.get(VENDOR_A)!.score).toBeGreaterThan(scores.get(VENDOR_B)!.score);
  });

  it('explains a score in language a person can read', async () => {
    await ingest(
      event({ eventType: 'request.delivered', vendorId: VENDOR_A, payload: { capability: HAMMER_BRICK } }),
      event({
        eventType: 'request.accepted',
        vendorId: VENDOR_A,
        payload: { capability: HAMMER_BRICK, responseTime: 180 },
      }),
      event({ eventType: 'match.completed', vendorId: VENDOR_A, payload: { capability: HAMMER_BRICK } }),
    );

    const scores = await query.getEvidenceScores({
      vendorIds: [VENDOR_A],
      subjectType: 'capability',
      subject: HAMMER_BRICK,
    });

    // CME §14 requires ranked vendors to expose explainable reasoning.
    expect(scores.get(VENDOR_A)!.reasons.join(' ')).toMatch(/Completed|Confirmed availability/);
  });

  it('ignores events that carry no vendor', async () => {
    await ingest(event({ eventType: 'request.created', customerId: 'customer_1', payload: {} }));

    expect(await prisma.evidenceRecord.count()).toBe(0);
    // Still stored raw: customer-side events matter for analytics even without a vendor.
    expect(await prisma.marketplaceEvent.count()).toBe(1);
  });

  it("converts the event model's seconds-based responseTime correctly", async () => {
    await ingest(
      event({ eventType: 'request.delivered', vendorId: VENDOR_A, payload: { capability: HAMMER_BRICK } }),
      event({
        eventType: 'request.accepted',
        vendorId: VENDOR_A,
        // The Standard Marketplace Event Model expresses this in seconds.
        payload: { capability: HAMMER_BRICK, responseTime: 180 },
      }),
    );

    const capability = await query.getCapabilityEvidence(VENDOR_A, HAMMER_BRICK);

    expect(capability?.counters.responseTimeSumMs).toBe(180_000);
  });
});
