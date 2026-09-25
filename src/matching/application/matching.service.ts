import { Injectable, Logger } from '@nestjs/common';
import { MkgCandidateRetrievalAdapter } from '../adapters/retrieval/mkg-candidate-retrieval.adapter';
import type {
  MatchCandidate,
  MatchingResult,
  RankedVendorView,
  StructuredDemand,
} from '../domain/matching-models';
import { ScoringPolicy } from '../domain/scoring-policy';
import type { MatchingEnginePort } from '../ports/matching-engine.port';

@Injectable()
export class MatchingService implements MatchingEnginePort {
  private readonly logger = new Logger(MatchingService.name);

  constructor(private readonly retrieval: MkgCandidateRetrievalAdapter) {}

  async match(demand: StructuredDemand): Promise<MatchingResult> {
    const startedAt = Date.now();
    this.logger.log(`[match] Matching demand: query="${demand.query}" concept="${demand.conceptLabel ?? 'auto'}" gpc="${demand.gpcCode ?? 'none'}"`);

    // 1. Retrieve candidates across MKG Direct, MKG Traversal, and GPC Backbone
    const candidates = await this.retrieval.retrieveCandidates(demand);

    if (!candidates.length) {
      this.logger.warn(`[match] No candidates found for query "${demand.query}"`);
      return { outcome: 'no_capability' };
    }

    // 2. Score Candidates using Deterministic Composite Policy (§15.2)
    const scoredCandidates: MatchCandidate[] = candidates.map((cand) => {
      const breakdown = ScoringPolicy.computeScore(cand, demand);
      return {
        ...cand,
        scoreBreakdown: breakdown,
        finalScore: breakdown.totalScore,
      };
    });

    // 3. Filter Eligible Candidates and Sort Descending
    const eligibleCandidates = scoredCandidates
      .filter((c) => c.finalScore > 0.5)
      .sort((a, b) => b.finalScore - a.finalScore);

    if (!eligibleCandidates.length) {
      this.logger.warn(`[match] All candidates fell below eligibility threshold for query "${demand.query}"`);
      return { outcome: 'no_capability' };
    }

    const matchedConcept = demand.conceptLabel || eligibleCandidates[0].matchedConcept || demand.query;

    // 4. Map to Ranked Vendor View
    const rankedVendors: RankedVendorView[] = eligibleCandidates.map((c) => ({
      vendorId: c.vendorId,
      businessName: c.businessName,
      phone: c.contactPhone ?? null,
      city: c.city ?? null,
      state: c.state ?? null,
      score: c.finalScore,
      rating: c.rating ?? '⭐⭐⭐⭐⭐',
      description: c.description ?? (c.reasons.length ? c.reasons[0] : null) ?? `${c.businessName} supplies products for this request`,
      reasons: c.reasons,
    }));

    const durationMs = Date.now() - startedAt;
    this.logger.log(
      `[match] Successfully matched ${rankedVendors.length} vendors for "${demand.query}" in ${durationMs}ms. Top vendor: ${rankedVendors[0].businessName} (score=${rankedVendors[0].score})`,
    );

    return {
      outcome: 'ranked',
      resolved: {
        demand: {
          products: [matchedConcept],
          rawQuery: demand.query,
        },
        primaryCapabilities: [
          {
            id: demand.gpcCode || 'mkg_capability',
            name: matchedConcept,
          },
        ],
      },
      vendors: rankedVendors,
    };
  }
}
