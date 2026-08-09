import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  EvidenceAggregate,
  EvidenceCounters,
  EvidenceRecord,
  EvidenceSignal,
  EvidenceSubjectType,
} from '../../../domain/models/evidence';
import type { DomainEvent } from '../../../domain/ports/outbound/event-publisher.port';
import type {
  EvidenceRepositoryPort,
  StoredMarketplaceEvent,
} from '../../../domain/ports/outbound/evidence-repository.port';
import { PrismaService } from './prisma.service';

/** Fields the event envelope may carry that identify what the evidence is about. */
interface EventSubjectFields {
  product: string | null;
  capability: string | null;
}

@Injectable()
export class PrismaEvidenceRepository implements EvidenceRepositoryPort {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Stores a raw event, treating a duplicate id as a no-op.
   *
   * Relies on the unique index rather than a prior read so two workers relaying the same event
   * concurrently cannot both record it — double-counting would silently inflate a vendor's
   * acceptance rate.
   */
  async recordRawEvent(event: DomainEvent): Promise<boolean> {
    const subject = this.subjectFieldsOf(event);

    try {
      await this.prisma.marketplaceEvent.create({
        data: {
          eventId: event.eventId,
          eventType: event.eventType,
          producer: event.producer,
          vendorId: event.vendorId ?? null,
          customerId: event.customerId ?? null,
          requestId: event.requestId ?? null,
          conversationId: event.conversationId ?? null,
          product: subject.product,
          capability: subject.capability,
          metadata: (event.payload ?? {}) as Prisma.InputJsonValue,
          occurredAt: event.timestamp,
        },
      });

      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  async findUnprocessed(limit: number): Promise<readonly StoredMarketplaceEvent[]> {
    const rows = await this.prisma.marketplaceEvent.findMany({
      where: { processedAt: null },
      orderBy: { occurredAt: 'asc' },
      take: limit,
    });

    return rows.map((row) => ({
      eventId: row.eventId,
      eventType: row.eventType,
      producer: row.producer,
      vendorId: row.vendorId,
      customerId: row.customerId,
      requestId: row.requestId,
      conversationId: row.conversationId,
      product: row.product,
      capability: row.capability,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      occurredAt: row.occurredAt,
    }));
  }

  async markProcessed(eventIds: readonly string[], at: Date): Promise<void> {
    if (eventIds.length === 0) return;

    await this.prisma.marketplaceEvent.updateMany({
      where: { eventId: { in: [...eventIds] } },
      data: { processedAt: at },
    });
  }

  async appendRecords(records: readonly EvidenceRecord[]): Promise<void> {
    if (records.length === 0) return;

    await this.prisma.evidenceRecord.createMany({
      data: records.map((record) => ({
        id: record.id,
        eventId: record.eventId,
        vendorId: record.vendorId,
        subjectType: record.subjectType,
        subject: record.subject,
        signal: record.signal,
        polarity: record.polarity,
        weight: record.weight,
        responseTimeMs: record.responseTimeMs ?? null,
        rating: record.rating ?? null,
        observedAt: record.observedAt,
      })),
      skipDuplicates: true,
    });
  }

  async loadRecords(params: {
    vendorId: string;
    subjectType: EvidenceSubjectType;
    subject: string;
  }): Promise<readonly EvidenceRecord[]> {
    const rows = await this.prisma.evidenceRecord.findMany({
      where: {
        vendorId: params.vendorId,
        subjectType: params.subjectType,
        subject: params.subject,
      },
      orderBy: { observedAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      vendorId: row.vendorId,
      subjectType: row.subjectType as EvidenceSubjectType,
      subject: row.subject,
      signal: row.signal as EvidenceSignal,
      polarity: row.polarity === -1 ? -1 : 1,
      weight: row.weight,
      ...(row.responseTimeMs !== null ? { responseTimeMs: row.responseTimeMs } : {}),
      ...(row.rating !== null ? { rating: row.rating } : {}),
      observedAt: row.observedAt,
    }));
  }

  async saveAggregate(aggregate: EvidenceAggregate): Promise<void> {
    const counters = aggregate.counters;

    const data = {
      delivered: counters.delivered,
      responded: counters.responded,
      accepted: counters.accepted,
      rejected: counters.rejected,
      noResponse: counters.noResponse,
      selected: counters.selected,
      completed: counters.completed,
      cancelled: counters.cancelled,
      responseTimeSumMs: BigInt(Math.round(counters.responseTimeSumMs)),
      responseTimeCount: counters.responseTimeCount,
      ratingSum: counters.ratingSum,
      ratingCount: counters.ratingCount,
      evidenceScore: aggregate.score,
      scoreConfidence: aggregate.scoreConfidence,
      lastObservedAt: aggregate.lastObservedAt,
    };

    await this.prisma.evidenceAggregate.upsert({
      where: {
        vendorId_subjectType_subject: {
          vendorId: aggregate.vendorId,
          subjectType: aggregate.subjectType,
          subject: aggregate.subject,
        },
      },
      create: {
        vendorId: aggregate.vendorId,
        subjectType: aggregate.subjectType,
        subject: aggregate.subject,
        firstObservedAt: aggregate.firstObservedAt,
        ...data,
      },
      update: data,
    });
  }

  async findAggregate(params: {
    vendorId: string;
    subjectType: EvidenceSubjectType;
    subject: string;
  }): Promise<EvidenceAggregate | null> {
    const row = await this.prisma.evidenceAggregate.findUnique({
      where: {
        vendorId_subjectType_subject: {
          vendorId: params.vendorId,
          subjectType: params.subjectType,
          subject: params.subject,
        },
      },
    });

    return row === null ? null : this.toDomain(row);
  }

  async findAggregatesForVendor(vendorId: string): Promise<readonly EvidenceAggregate[]> {
    const rows = await this.prisma.evidenceAggregate.findMany({
      where: { vendorId },
      orderBy: { evidenceScore: 'desc' },
    });

    return rows.map((row) => this.toDomain(row));
  }

  async findAggregatesForSubject(params: {
    subjectType: EvidenceSubjectType;
    subject: string;
    vendorIds: readonly string[];
  }): Promise<readonly EvidenceAggregate[]> {
    if (params.vendorIds.length === 0) return [];

    const rows = await this.prisma.evidenceAggregate.findMany({
      where: {
        subjectType: params.subjectType,
        subject: params.subject,
        vendorId: { in: [...params.vendorIds] },
      },
    });

    return rows.map((row) => this.toDomain(row));
  }

  async findPairsForEvents(
    eventIds: readonly string[],
  ): Promise<readonly { vendorId: string; subjectType: EvidenceSubjectType; subject: string }[]> {
    if (eventIds.length === 0) return [];

    const rows = await this.prisma.evidenceRecord.findMany({
      where: { eventId: { in: [...eventIds] } },
      select: { vendorId: true, subjectType: true, subject: true },
      distinct: ['vendorId', 'subjectType', 'subject'],
    });

    return rows.map((row) => ({
      vendorId: row.vendorId,
      subjectType: row.subjectType as EvidenceSubjectType,
      subject: row.subject,
    }));
  }

  /**
   * Pulls the subject out of the event envelope.
   *
   * The Standard Marketplace Event Model puts `product` and `capability` in the payload, so this
   * is the one place that reaches into it — everything downstream works with typed fields.
   */
  private subjectFieldsOf(event: DomainEvent): EventSubjectFields {
    const payload = (event.payload ?? {}) as Record<string, unknown>;

    const read = (key: string): string | null => {
      const value = payload[key];
      return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    };

    return { product: read('product'), capability: read('capability') };
  }

  private toDomain(row: {
    vendorId: string;
    subjectType: string;
    subject: string;
    delivered: number;
    responded: number;
    accepted: number;
    rejected: number;
    noResponse: number;
    selected: number;
    completed: number;
    cancelled: number;
    responseTimeSumMs: bigint;
    responseTimeCount: number;
    ratingSum: number;
    ratingCount: number;
    evidenceScore: number;
    scoreConfidence: number;
    firstObservedAt: Date;
    lastObservedAt: Date;
  }): EvidenceAggregate {
    const counters: EvidenceCounters = {
      delivered: row.delivered,
      responded: row.responded,
      accepted: row.accepted,
      rejected: row.rejected,
      noResponse: row.noResponse,
      selected: row.selected,
      completed: row.completed,
      cancelled: row.cancelled,
      responseTimeSumMs: Number(row.responseTimeSumMs),
      responseTimeCount: row.responseTimeCount,
      ratingSum: row.ratingSum,
      ratingCount: row.ratingCount,
    };

    return {
      vendorId: row.vendorId,
      subjectType: row.subjectType as EvidenceSubjectType,
      subject: row.subject,
      counters,
      score: row.evidenceScore,
      scoreConfidence: row.scoreConfidence,
      firstObservedAt: row.firstObservedAt,
      lastObservedAt: row.lastObservedAt,
    };
  }
}
