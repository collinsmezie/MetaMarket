import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import type { EvidenceRecord } from '../../domain/models/evidence';
import { applyRecord, computeEvidenceScore, EMPTY_COUNTERS } from '../../domain/models/evidence';
import type { DomainEvent } from '../../domain/ports/outbound/event-publisher.port';
import {
  EVIDENCE_REPOSITORY,
  type EvidenceRepositoryPort,
  type StoredMarketplaceEvent,
} from '../../domain/ports/outbound/evidence-repository.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import {
  isEvidenceBearing,
  ratingOf,
  responseTimeOf,
  signalsFor,
  subjectsFor,
} from './evidence-interpretation';

const COMPONENT = 'Evidence';
const STAGE = 'EvidenceProcessor';

/** Events drained per sweep, bounding the work one tick can do. */
const BATCH_SIZE = 200;

/** How often the backlog is swept. */
const SWEEP_INTERVAL_MS = 10_000;

/**
 * The Evidence Service's ingestion path (Evidence Service TDR, "Evidence Processing Pipeline").
 *
 * Subscribes to marketplace events, stores them raw and immutably, derives evidence records, and
 * re-aggregates the affected scores. Producers publish events and their responsibility ends
 * there — nothing outside this service writes evidence, which is what lets new producers appear
 * without the Evidence Service or the CME changing.
 *
 * Storage happens on the event; interpretation happens on a sweep. Splitting them means a bug in
 * interpretation can be fixed and the backlog reprocessed, because the raw facts were never lost.
 */
@Injectable()
export class EvidenceProcessor {
  private sweeping = false;

  constructor(
    @Inject(EVIDENCE_REPOSITORY) private readonly evidence: EvidenceRepositoryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  /**
   * Captures every marketplace event as it is published.
   *
   * Wildcard-subscribed so a producer never has to register with the Evidence Service. Recording
   * is deliberately all this does on the hot path: it must never slow down or fail the
   * conversation turn that emitted the event.
   */
  @OnEvent('**', { async: true })
  async onMarketplaceEvent(event: DomainEvent): Promise<void> {
    if (event?.eventId === undefined || event?.eventType === undefined) return;

    try {
      const stored = await this.evidence.recordRawEvent(event);

      // Only log the interesting ones; conversation lifecycle events flow through here too.
      if (stored && isEvidenceBearing(event.eventType)) {
        this.logger.stage({
          component: COMPONENT,
          stage: `${STAGE}:Capture`,
          input: { eventType: event.eventType, vendorId: event.vendorId },
          action: 'Recorded a marketplace event in the immutable raw event store',
          output: { eventId: event.eventId },
        });
      }
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Capture`,
        input: { eventType: event.eventType, eventId: event.eventId },
        action: 'Could not record the raw event; it will not become evidence',
        error,
      });
    }
  }

  @Interval(SWEEP_INTERVAL_MS)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;

    try {
      await this.processBacklog();
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: {},
        action: 'Evidence sweep failed; will retry on the next interval',
        error,
      });
    } finally {
      this.sweeping = false;
    }
  }

  /**
   * Turns unprocessed raw events into evidence records and refreshes the affected aggregates.
   *
   * Exposed so tests and the CLI can drain the backlog deterministically rather than waiting for
   * a timer.
   */
  async processBacklog(): Promise<{ events: number; records: number; aggregates: number }> {
    const startedAt = Date.now();

    const events = await this.evidence.findUnprocessed(BATCH_SIZE);
    if (events.length === 0) return { events: 0, records: 0, aggregates: 0 };

    const records: EvidenceRecord[] = [];

    for (const event of events) {
      records.push(...this.deriveRecords(event));
    }

    await this.evidence.appendRecords(records);

    const eventIds = events.map((event) => event.eventId);
    await this.evidence.markProcessed(eventIds, this.clock.now());

    // Re-aggregate only the pairs these events touched, rather than every vendor.
    const pairs = await this.evidence.findPairsForEvents(eventIds);
    for (const pair of pairs) {
      await this.reaggregate(pair);
    }

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { events: events.length },
      action: 'Converted marketplace events into evidence and refreshed the affected scores',
      output: { records: records.length, aggregatesUpdated: pairs.length },
      durationMs: Date.now() - startedAt,
    });

    return { events: events.length, records: records.length, aggregates: pairs.length };
  }

  /**
   * Derives every evidence record one event implies.
   *
   * An event without a vendor cannot be evidence about a vendor — customer-side events are
   * stored raw for analytics but produce no records here.
   */
  private deriveRecords(event: StoredMarketplaceEvent): readonly EvidenceRecord[] {
    if (event.vendorId === null) return [];

    const signals = signalsFor(event.eventType);
    if (signals.length === 0) return [];

    const subjects = subjectsFor(event);
    const responseTimeMs = responseTimeOf(event);
    const rating = ratingOf(event);

    const records: EvidenceRecord[] = [];

    for (const signal of signals) {
      for (const subject of subjects) {
        records.push({
          id: this.ids.uuid(),
          eventId: event.eventId,
          vendorId: event.vendorId,
          subjectType: subject.subjectType,
          subject: subject.subject,
          signal: signal.signal,
          polarity: signal.polarity,
          weight: signal.weight,
          // Latency belongs to the response itself, not to the acceptance decision.
          ...(responseTimeMs !== undefined && signal.signal === 'responded' ? { responseTimeMs } : {}),
          ...(rating !== undefined && signal.signal === 'rated' ? { rating } : {}),
          observedAt: event.occurredAt,
        });
      }
    }

    return records;
  }

  /**
   * Recomputes one aggregate from its full record history
   * (Evidence Service, "Evidence is continuously recalculated as new events arrive").
   *
   * Replaying rather than incrementing means a score can never drift away from the records that
   * justify it, and a corrected interpretation applies retroactively.
   */
  private async reaggregate(pair: {
    vendorId: string;
    subjectType: EvidenceRecord['subjectType'];
    subject: string;
  }): Promise<void> {
    const records = await this.evidence.loadRecords(pair);
    if (records.length === 0) return;

    let counters = EMPTY_COUNTERS;
    for (const record of records) counters = applyRecord(counters, record);

    const { score, confidence } = computeEvidenceScore(counters);

    await this.evidence.saveAggregate({
      vendorId: pair.vendorId,
      subjectType: pair.subjectType,
      subject: pair.subject,
      counters,
      score,
      scoreConfidence: confidence,
      firstObservedAt: records[0].observedAt,
      lastObservedAt: records[records.length - 1].observedAt,
    });
  }
}
