import type { DomainEvent } from './event-publisher.port';
import type { EvidenceAggregate, EvidenceRecord, EvidenceSubjectType } from '../../models/evidence';

/**
 * Persistence for the Evidence Service.
 *
 * Two invariants are expressed in the shape of this port. Raw events and evidence records are
 * append-only — there is deliberately no update or delete for either, because "raw events are
 * immutable, they should never be modified after persistence". Aggregates, by contrast, are a
 * derived view and may be recomputed freely.
 */

export const EVIDENCE_REPOSITORY = Symbol('EvidenceRepository');

/** A raw marketplace event as stored, before interpretation. */
export interface StoredMarketplaceEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly producer: string;
  readonly vendorId: string | null;
  readonly customerId: string | null;
  readonly requestId: string | null;
  readonly conversationId: string | null;
  readonly product: string | null;
  readonly capability: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: Date;
}

export interface EvidenceRepositoryPort {
  /**
   * Stores a raw event before any processing.
   *
   * Returns false when the event id was already recorded — a redelivered event is not a new
   * marketplace fact, and counting it twice would inflate a vendor's score.
   */
  recordRawEvent(event: DomainEvent): Promise<boolean>;

  /** Raw events not yet turned into evidence, oldest first. */
  findUnprocessed(limit: number): Promise<readonly StoredMarketplaceEvent[]>;

  markProcessed(eventIds: readonly string[], at: Date): Promise<void>;

  /** Appends derived evidence. There is no counterpart that modifies or removes it. */
  appendRecords(records: readonly EvidenceRecord[]): Promise<void>;

  /** Every record for a vendor/subject pair, for recomputing an aggregate from scratch. */
  loadRecords(params: {
    vendorId: string;
    subjectType: EvidenceSubjectType;
    subject: string;
  }): Promise<readonly EvidenceRecord[]>;

  /** Writes the derived aggregate for a vendor/subject pair. */
  saveAggregate(aggregate: EvidenceAggregate): Promise<void>;

  findAggregate(params: {
    vendorId: string;
    subjectType: EvidenceSubjectType;
    subject: string;
  }): Promise<EvidenceAggregate | null>;

  /** Every aggregate for a vendor, best score first. */
  findAggregatesForVendor(vendorId: string): Promise<readonly EvidenceAggregate[]>;

  /**
   * Aggregates for a set of vendors against one subject.
   *
   * The demand-side batch lookup: ranking has a candidate list and needs each one's evidence in
   * a single query rather than one round trip per vendor.
   */
  findAggregatesForSubject(params: {
    subjectType: EvidenceSubjectType;
    subject: string;
    vendorIds: readonly string[];
  }): Promise<readonly EvidenceAggregate[]>;

  /** Distinct vendor/subject pairs touched by the given events, for targeted re-aggregation. */
  findPairsForEvents(
    eventIds: readonly string[],
  ): Promise<readonly { vendorId: string; subjectType: EvidenceSubjectType; subject: string }[]>;
}
