import { Inject, Injectable, Optional } from '@nestjs/common';
import type { CapabilityRef } from '../../domain/models/capability';
import type {
  DemandObject,
  RankedVendor,
  RankingComponents,
  ResolvedDemand,
} from '../../domain/models/demand';
import { combineRanking, proximityScore } from '../../domain/models/demand';
import {
  evaluateGraphMatch,
  type GraphMatchResult,
  type MerchantArchetype,
} from '../../domain/models/hybrid-knowledge-graph';
import type { VendorProfile } from '../../domain/models/vendor';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  TAXONOMY_REPOSITORY,
  type TaxonomyRepositoryPort,
} from '../../domain/ports/outbound/taxonomy-repository.port';
import {
  VENDOR_REPOSITORY,
  type VendorRepositoryPort,
} from '../../domain/ports/outbound/vendor-repository.port';
import { CapabilityResolver } from '../capability/capability-resolver.service';
import { EvidenceQueryService } from '../evidence/evidence-query.service';
import { DemandUnderstandingService } from './demand-understanding.service';
import { MatchingService } from '../../matching/application/matching.service';

const COMPONENT = 'CME';

export interface MatchRequest {
  readonly query: string;
  readonly history?: readonly string[];
  /** Customer location, for proximity scoring. */
  readonly customerCity?: string | null;
  readonly limit?: number;
  /** Pre-resolved semantic concept from upstream CSRE (Overarching §15.2, §30.5). */
  readonly conceptLabel?: string | null;
  readonly gpcCode?: string | null;
}

export type MatchResult =
  | {
      readonly outcome: 'ranked';
      readonly resolved: ResolvedDemand;
      readonly vendors: readonly RankedVendor[];
    }
  /** Ambiguity would materially change the vendor set; no retrieval performed (CME Test 2). */
  | {
      readonly outcome: 'clarification_needed';
      readonly demand: DemandObject;
      readonly question: string;
      readonly options: readonly string[];
    }
  | { readonly outcome: 'no_capability'; readonly demand: DemandObject };

/**
 * The Capability Matching Engine (CME TDR §5).
 * Delegates matching to the graph-native Phase 11 MatchingService.
 */
@Injectable()
export class CapabilityMatchingService {
  constructor(
    @Optional() @Inject(VENDOR_REPOSITORY) _vendors: VendorRepositoryPort | undefined,
    @Optional() @Inject(TAXONOMY_REPOSITORY) private readonly taxonomy: TaxonomyRepositoryPort | undefined,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Optional() _understanding?: DemandUnderstandingService,
    @Optional() _resolver?: CapabilityResolver,
    @Optional() private readonly evidence?: EvidenceQueryService,
    @Optional() private readonly newMatching?: MatchingService,
  ) {}

  async match(request: MatchRequest): Promise<MatchResult> {
    const startedAt = Date.now();

    // ── Phase 11 / v1.3 Matching & Fanout Seam ──────────────────────────────────────
    if (this.newMatching) {
      try {
        const mkgResult = await this.newMatching.match({
          query: request.query,
          history: request.history,
          customerCity: request.customerCity,
          conceptLabel: request.conceptLabel,
          gpcCode: request.gpcCode,
        });

        if (mkgResult.outcome === 'ranked' && mkgResult.vendors && mkgResult.vendors.length > 0) {
          const vendors: RankedVendor[] = mkgResult.vendors.map((v) => ({
            vendorId: v.vendorId,
            businessName: v.businessName,
            phone: v.phone ?? undefined,
            city: v.city ?? null,
            state: v.state ?? null,
            score: v.score,
            rating: v.rating ?? undefined,
            description: v.description ?? undefined,
            components: {
              capabilityMatch: Math.min(1.0, v.score / 4),
              expansionMatch: 0.8,
              evidenceScore: 0.9,
              evidenceConfidence: 0.9,
              proximity: 0.8,
              availability: 1.0,
            },
            reasons: v.reasons ? [...v.reasons] : [],
          }));

          const resolvedDemand: ResolvedDemand = {
            demand: {
              rawQuery: request.query,
              mode: 'item',
              products: (mkgResult.resolved?.demand.products ? [...mkgResult.resolved.demand.products] : [request.conceptLabel || request.query]),
              services: [],
              businessTypes: [],
              quantities: [],
              modifiers: [],
              constraints: [],
              brands: [],
              location: request.customerCity || '',
              ambiguityType: 'none',
              ambiguityScore: 0,
              ambiguityOptions: [],
            },
            expansion: {
              missions: [],
              capabilities: [],
              inventoryAffinities: [],
              inferredProducts: [],
            },
            primaryCapabilities: (mkgResult.resolved?.primaryCapabilities ? mkgResult.resolved.primaryCapabilities.map((c) => ({
              domain: 'product' as const,
              id: c.id,
              name: c.name,
            })) : [
              { domain: 'product' as const, id: request.gpcCode || 'mkg_capability', name: request.conceptLabel || request.query },
            ]),
            expandedCapabilities: [],
          };

          return {
            outcome: 'ranked',
            resolved: resolvedDemand,
            vendors,
          };
        }

        // When the Phase 11 graph-native matching finds no verified suppliers, return clean
        // no_capability immediately. Do NOT fall back to legacy CDE taxonomy hallucination.
        this.logger.stage({
          component: COMPONENT,
          stage: 'MkgMatchingDelegation',
          input: { query: request.query, gpcCode: request.gpcCode },
          action: 'No verified suppliers found in MKG; returning clean no_capability without legacy fallback',
          output: { outcome: 'no_capability' },
          durationMs: Date.now() - startedAt,
        });

        return {
          outcome: 'no_capability',
          demand: {
            rawQuery: request.query,
            mode: 'item',
            products: (mkgResult.resolved?.demand.products ? [...mkgResult.resolved.demand.products] : [request.conceptLabel || request.query]),
            services: [],
            businessTypes: [],
            quantities: [],
            modifiers: [],
            constraints: [],
            brands: [],
            location: request.customerCity || '',
            ambiguityType: 'none',
            ambiguityScore: 0,
            ambiguityOptions: [],
          },
        };
      } catch (err) {
        this.logger.stageFailed({
          component: COMPONENT,
          stage: 'MkgMatchingDelegation',
          input: { query: request.query },
          action: 'Error delegating to Phase 11 MatchingService; returning clean no_capability',
          error: err as Error,
        });

        return {
          outcome: 'no_capability',
          demand: {
            rawQuery: request.query,
            mode: 'item',
            products: [request.conceptLabel || request.query],
            services: [],
            businessTypes: [],
            quantities: [],
            modifiers: [],
            constraints: [],
            brands: [],
            location: request.customerCity || '',
            ambiguityType: 'none',
            ambiguityScore: 0,
            ambiguityOptions: [],
          },
        };
      }
    }

    this.logger.stageFailed({
      component: COMPONENT,
      stage: 'MatchingDelegation',
      input: { query: request.query },
      action: 'No modern MatchingService available; returning clean no_capability',
      error: new Error('MatchingService unavailable'),
    });

    return {
      outcome: 'no_capability',
      demand: {
        rawQuery: request.query,
        mode: 'item',
        products: [request.conceptLabel || request.query],
        services: [],
        businessTypes: [],
        quantities: [],
        modifiers: [],
        constraints: [],
        brands: [],
        location: request.customerCity || '',
        ambiguityType: 'none',
        ambiguityScore: 0,
        ambiguityOptions: [],
      },
    };
  }


  /**
   * Scores and orders the candidates, attaching an explanation to each
   * (CME §13, §14, DAEM TDR §4).
   *
   * Integrates the 3-Layer HKGM graph evaluation: each vendor is evaluated against the primary
   * target capability's GPC Segment through `evaluateGraphMatch`. The resulting Layer 2/Layer 1
   * signals are fed into the ranking components alongside the existing capability and evidence
   * scores.
   */
  async rank(params: {
    resolved: ResolvedDemand;
    candidates: readonly VendorProfile[];
    customerCity: string | null;
    limit: number;
  }): Promise<readonly RankedVendor[]> {
    const { resolved, candidates } = params;

    // One evidence lookup for the whole candidate set, against the strongest capability the
    // customer actually asked for.
    const evidenceSubject = resolved.primaryCapabilities[0] ?? resolved.expandedCapabilities[0];

    const evidenceScores = this.evidence && evidenceSubject
      ? await this.evidence.getEvidenceScores({
          vendorIds: candidates.map((profile) => profile.vendor.id),
          subjectType: 'capability',
          subject: evidenceSubject.id,
        })
      : new Map();

    // ── HKGM Layer 3→2→1: Resolve the target Segment for graph matching ─────────────
    // The graph match evaluates whether a vendor's archetype covers the target Segment.
    // Resolved once per ranking pass, not per vendor (CONTRIBUTING §8.3).
    const targetSegmentId = await this.resolveSegment(evidenceSubject.id);

    const graphEvaluations: Record<string, unknown>[] = [];

    const ranked = candidates.map((profile) => {
      const capabilityMatch = this.coverage(profile, resolved.primaryCapabilities);
      const expansionMatch = this.coverage(profile, resolved.expandedCapabilities);

      const evidence = evidenceScores.get(profile.vendor.id);

      // ── HKGM graph evaluation (DAEM TDR §4) ────────────────────────────────────
      const archetype = this.inferArchetype(profile);
      const graphResult =
        targetSegmentId !== null
          ? evaluateGraphMatch(
              profile.dna.beliefs.filter((b) => b.confidence >= 0.3).map((b) => b.capability.id),
              archetype,
              evidenceSubject.id,
              targetSegmentId,
            )
          : null;

      if (graphResult !== null) {
        graphEvaluations.push({
          vendorId: profile.vendor.id,
          businessName: profile.vendor.businessName,
          tier: graphResult.tier,
          graphScore: graphResult.score,
          isMatch: graphResult.isMatch,
          archetypePrimarySegment: archetype?.primarySegment ?? null,
          targetSegmentId,
        });
      }

      const components: RankingComponents = {
        capabilityMatch,
        expansionMatch,
        evidenceScore: evidence?.score ?? 0.5,
        evidenceConfidence: evidence?.confidence ?? 0,
        proximity: this.proximityFor(profile, params.customerCity),
        availability: profile.vendor.status === 'active' ? 1 : 0,
        // HKGM signals: archetype affinity and mission match (DAEM TDR §4).
        archetypeAffinityMatch: graphResult?.tier === 'TIER_2_ARCHETYPE' ? graphResult.score : 0,
        missionMatch: graphResult?.tier === 'TIER_3_MISSION' ? graphResult.score : 0,
      };

      const businessName = profile.vendor.businessName;
      const shortName = businessName.split(' ')[0];
      const conversationSummary = profile.vendor.conversationSummary?.trim() ?? '';
      const dnaSummary = profile.dna.summary.trim();
      const declaredProducts = profile.dna.declaredProducts;

      // Extract vendor archetype from conversationSummary or dnaSummary (portion before technical lists)
      const summarySource = conversationSummary.length > 0 ? conversationSummary : dnaSummary;
      let archetypeText = summarySource
        ? summarySource.split(/\s+(?:Sells|Capabilities|Services|Brands):/i)[0].trim()
        : '';

      if (!archetypeText && declaredProducts.length > 0) {
        archetypeText = declaredProducts.join(', ');
      }

      let description: string | null = null;
      if (archetypeText.length > 0) {
        let cleaned = archetypeText
          .replace(/\.+$/, '')
          .replace(/\s*-\s*Replacement Parts\/Accessories/gi, '')
          .replace(/\s*-\s*Other/gi, '')
          .replace(/\s*\(Automotive\)/gi, '')
          .trim();

        const specPrefix = new RegExp(`^(?:${businessName}|${shortName})\\s+specializes\\s+in\\s+`, 'i');
        const shortPrefix = new RegExp(`^(?:${businessName}|${shortName})\\s+`, 'i');

        if (specPrefix.test(cleaned)) {
          cleaned = `${shortName} can provide ${cleaned.replace(specPrefix, '')}`;
        } else if (shortPrefix.test(cleaned)) {
          cleaned = `${shortName} can provide ${cleaned.replace(shortPrefix, '')}`;
        } else {
          cleaned = cleaned.replace(/^(?:specializes\s+in|sells|capabilities|services):\s*/i, '').trim();
          cleaned = `${shortName} can provide ${cleaned}`;
        }

        if (!cleaned.endsWith('.')) {
          cleaned += '.';
        }

        description = cleaned;
      }

      // DAEM TDR §4: Cross-Domain Protection
      // If a vendor has no direct capability match and its archetype has zero edge connection
      // to the target segment (isMatch is false / tier is CROSS_DOMAIN), force final score to 0.0.
      const isCrossDomainSuppressed = capabilityMatch === 0 && graphResult !== null && !graphResult.isMatch;
      const finalScore = isCrossDomainSuppressed ? 0.0 : combineRanking(components);

      return {
        vendorId: profile.vendor.id,
        businessName: profile.vendor.businessName,
        phone: profile.vendor.userId,
        city: profile.vendor.location?.city ?? null,
        state: profile.vendor.location?.state ?? null,
        score: finalScore,
        rating: '⭐⭐⭐⭐⭐',
        description,
        components,
        reasons: this.explain(profile, resolved, components, evidence?.reasons ?? [], graphResult),
      };
    });

    this.logger.stage({
      component: COMPONENT,
      stage: 'HkgmGraphEvaluation',
      action: 'Evaluated 3-layer HKGM graph matching, archetype affinity and cross-domain suppression',
      input: { targetCapability: evidenceSubject.name, targetSegmentId, candidateCount: candidates.length },
      output: { evaluations: graphEvaluations },
    });

    return ranked
      .filter((vendor) => vendor.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limit);
  }

  /**
   * Resolves a GPC Brick code to its owning Segment code.
   *
   * Used by the HKGM graph evaluation to determine the target Segment for
   * cross-domain suppression (DAEM TDR §4). Returns null gracefully when
   * the taxonomy lookup fails — graph matching degrades, retrieval still works.
   */
  private async resolveSegment(brickCode: string): Promise<string | null> {
    try {
      const node = this.taxonomy ? await this.taxonomy.findByCode(brickCode) : null;
      return node?.segmentCode ?? null;
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: 'HkgmSegmentResolution',
        input: { brickCode },
        action: 'Could not resolve the target Segment; HKGM graph matching will be skipped this turn',
        error,
      });
      return null;
    }
  }

  /**
   * Infers a vendor's MerchantArchetype from their Capability DNA.
   *
   * This is the dynamic, autonomous archetype inference the DAEM TDR §5
   * requires: "NO static, hardcoded dictionary or manual lookup table is
   * maintained by developers." The archetype is derived entirely from the
   * vendor's existing beliefs — their primary segment is the segment of
   * their strongest capability, and affinity segments are the segments of
   * their other confident capabilities.
   *
   * Returns null when the DNA is too thin to infer a meaningful archetype.
   */
  private inferArchetype(profile: VendorProfile): MerchantArchetype | null {
    // Include direct beliefs or inferred beliefs with confidence >= 0.25 for archetype inference
    // so broad vendors onboarded with informal statements (e.g. "I sell sports materials")
    // have their archetype derived accurately without being wrongly assigned null/CROSS_DOMAIN.
    const confidentBeliefs = profile.dna.beliefs.filter(
      (b) => (!b.inferred && b.confidence >= 0.3) || b.confidence >= 0.25,
    );
    if (confidentBeliefs.length === 0) return null;

    // Group capabilities by their segment prefix (first 8 digits of GPC code).
    // GPC codes follow the pattern: Segment (8 digits) → Family → Class → Brick.
    const segmentCounts = new Map<string, number>();

    for (const belief of confidentBeliefs) {
      if (belief.capability.domain !== 'product') continue;

      // GPC brick codes embed their segment: the first characters up to the segment level.
      const segmentPrefix = belief.capability.id.substring(0, 2) + '000000';
      segmentCounts.set(segmentPrefix, (segmentCounts.get(segmentPrefix) ?? 0) + belief.confidence);
    }

    if (segmentCounts.size === 0) return null;

    // Primary segment is the one with the highest cumulative confidence.
    const sorted = [...segmentCounts.entries()].sort((a, b) => b[1] - a[1]);
    const primarySegment = sorted[0][0];
    const affinitySegments = sorted.slice(1).map(([segment]) => segment);

    return {
      archetypeId: `inferred:${profile.vendor.id}`,
      primarySegment,
      affinitySegments,
    };
  }

  /**
   * How well a vendor's DNA covers a capability set.
   *
   * Uses the mean of the best per-capability beliefs rather than the maximum: a vendor who
   * genuinely covers the whole request should beat one who happens to stock a single item from
   * it, which matters most for multi-item requests.
   */
  private coverage(profile: VendorProfile, capabilities: readonly CapabilityRef[]): number {
    if (capabilities.length === 0) return 0;

    const beliefs = new Map(profile.dna.beliefs.map((belief) => [belief.capability.id, belief.confidence]));

    const total = capabilities.reduce((sum, capability) => sum + (beliefs.get(capability.id) ?? 0), 0);

    return total / capabilities.length;
  }

  /**
   * Proximity from city names.
   *
   * A same-city match is treated as close and anything else as unknown rather than far: without
   * geocoding, guessing a distance between two Nigerian towns would be worse than admitting
   * ignorance, and `proximityScore(null)` is deliberately neutral.
   */
  private proximityFor(profile: VendorProfile, customerCity: string | null): number {
    const vendorCity = profile.vendor.location?.city ?? null;

    if (customerCity === null || vendorCity === null) return proximityScore(null);

    return vendorCity.toLowerCase() === customerCity.toLowerCase() ? proximityScore(0) : proximityScore(null);
  }

  /**
   * Builds the explanation the TDR requires for every ranked vendor
   * (CME §14, DAEM TDR §4).
   *
   * Now includes HKGM-specific explanations when a vendor was surfaced through
   * archetype affinity (Layer 2) or mission matching (Layer 1).
   */
  private explain(
    profile: VendorProfile,
    resolved: ResolvedDemand,
    components: RankingComponents,
    evidenceReasons: readonly string[],
    graphResult?: GraphMatchResult | null,
  ): readonly string[] {
    const reasons: string[] = [];

    const matched = resolved.primaryCapabilities
      .map((capability) => profile.dna.beliefs.find((belief) => belief.capability.id === capability.id))
      .filter((belief): belief is NonNullable<typeof belief> => belief !== undefined)
      .sort((a, b) => b.confidence - a.confidence);

    if (matched.length > 0) {
      const best = matched[0];
      reasons.push(
        best.inferred
          ? `Likely supplies ${best.capability.name}.`
          : `Confirmed ${best.capability.name} capability.`,
      );
    } else if (graphResult?.tier === 'TIER_2_ARCHETYPE') {
      // HKGM Layer 2: the vendor's archetype covers this domain (DAEM TDR §7, Scenario 1).
      reasons.push('This type of business typically stocks this item.');
    } else if (graphResult?.tier === 'TIER_3_MISSION') {
      // HKGM Layer 1: surfaced through mission decomposition (DAEM TDR §7, Scenario 2).
      reasons.push('Carries items related to what you are trying to do.');
    } else if (components.expansionMatch > 0) {
      // The overlapping-inventory case: worth saying out loud, because the vendor is not an
      // obvious match and the customer deserves to know why they were surfaced.
      reasons.push('Stocks related items and may carry this.');
    }

    if (profile.dna.declaredProducts.length > 0) {
      reasons.push(`Sells ${profile.dna.declaredProducts.slice(0, 4).join(', ')}.`);
    }

    reasons.push(...evidenceReasons);

    if (profile.vendor.location !== null) {
      reasons.push(`Located in ${profile.vendor.location.city}, ${profile.vendor.location.state}.`);
    }

    return reasons;
  }
}
