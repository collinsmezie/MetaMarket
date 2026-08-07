import { Inject, Injectable } from '@nestjs/common';
import type { EvidenceAggregate, EvidenceRates } from '../../domain/models/evidence';
import {
  deriveRates,
  EMPTY_COUNTERS,
  explainEvidence,
  NEUTRAL_EVIDENCE_SCORE,
} from '../../domain/models/evidence';
import {
  EVIDENCE_REPOSITORY,
  type EvidenceRepositoryPort,
} from '../../domain/ports/outbound/evidence-repository.port';

/**
 * The internal Evidence API (Evidence Service TDR, "Internal Evidence API").
 *
 * The only way other subsystems read marketplace evidence: "The Capability Matching Engine
 * should never access raw events directly. It only consumes processed evidence."
 */

export interface VendorEvidenceSummary {
  readonly vendorId: string;
  /** Overall behavioural score across all subjects. */
  readonly overallScore: number;
  readonly overallRates: EvidenceRates;
  /** Per-capability and per-product scores, best first. */
  readonly bySubject: readonly EvidenceAggregate[];
  readonly reasons: readonly string[];
}

export interface SubjectEvidenceLookup {
  readonly vendorId: string;
  readonly score: number;
  readonly confidence: number;
  /** True when the score came from a general fallback rather than this exact subject. */
  readonly fallback: boolean;
  readonly reasons: readonly string[];
}

@Injectable()
export class EvidenceQueryService {
  constructor(@Inject(EVIDENCE_REPOSITORY) private readonly evidence: EvidenceRepositoryPort) {}

  /** All evidence held about one vendor. */
  async getVendorEvidence(vendorId: string): Promise<VendorEvidenceSummary> {
    const aggregates = await this.evidence.findAggregatesForVendor(vendorId);
    const overall = aggregates.find((aggregate) => aggregate.subjectType === 'vendor');

    return {
      vendorId,
      overallScore: overall?.score ?? NEUTRAL_EVIDENCE_SCORE,
      overallRates: deriveRates(overall?.counters ?? EMPTY_COUNTERS),
      bySubject: aggregates.filter((aggregate) => aggregate.subjectType !== 'vendor'),
      reasons: overall === undefined ? ['No marketplace history yet.'] : explainEvidence(overall),
    };
  }

  async getCapabilityEvidence(vendorId: string, capabilityId: string): Promise<EvidenceAggregate | null> {
    return this.evidence.findAggregate({ vendorId, subjectType: 'capability', subject: capabilityId });
  }

  async getProductEvidence(vendorId: string, product: string): Promise<EvidenceAggregate | null> {
    return this.evidence.findAggregate({
      vendorId,
      subjectType: 'product',
      subject: product.toLowerCase(),
    });
  }

  /**
   * Evidence scores for a candidate set against one subject — the ranking-time lookup.
   *
   * Falls back through subject-specific evidence → the vendor's overall record → neutral. The
   * fallback chain is what makes the score usable on day one: a vendor who has never been asked
   * for a hammer is judged on their general reliability rather than treated as unproven, and a
   * brand-new vendor sits at neutral rather than last.
   *
   * One query per level rather than per vendor, because ranking runs on every search.
   */
  async getEvidenceScores(params: {
    vendorIds: readonly string[];
    subjectType: 'capability' | 'product';
    subject: string;
  }): Promise<ReadonlyMap<string, SubjectEvidenceLookup>> {
    const subject = params.subjectType === 'product' ? params.subject.toLowerCase() : params.subject;

    const [specific, general] = await Promise.all([
      this.evidence.findAggregatesForSubject({
        subjectType: params.subjectType,
        subject,
        vendorIds: params.vendorIds,
      }),
      this.evidence.findAggregatesForSubject({
        subjectType: 'vendor',
        subject: '',
        vendorIds: params.vendorIds,
      }),
    ]);

    const specificByVendor = new Map(specific.map((aggregate) => [aggregate.vendorId, aggregate]));
    const generalByVendor = new Map(general.map((aggregate) => [aggregate.vendorId, aggregate]));

    const results = new Map<string, SubjectEvidenceLookup>();

    for (const vendorId of params.vendorIds) {
      const exact = specificByVendor.get(vendorId);

      if (exact !== undefined) {
        results.set(vendorId, {
          vendorId,
          score: exact.score,
          confidence: exact.scoreConfidence,
          fallback: false,
          reasons: explainEvidence(exact),
        });
        continue;
      }

      const overall = generalByVendor.get(vendorId);

      if (overall !== undefined) {
        results.set(vendorId, {
          vendorId,
          score: overall.score,
          // Discounted: general reliability is weaker evidence for this specific request than
          // a record against the request itself.
          confidence: overall.scoreConfidence * 0.5,
          fallback: true,
          reasons: explainEvidence(overall),
        });
        continue;
      }

      results.set(vendorId, {
        vendorId,
        score: NEUTRAL_EVIDENCE_SCORE,
        confidence: 0,
        fallback: true,
        reasons: ['No marketplace history yet.'],
      });
    }

    return results;
  }
}
