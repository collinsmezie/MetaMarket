import { Inject, Injectable } from '@nestjs/common';
import type { CapabilityRef } from '../../domain/models/capability';
import type {
  DemandObject,
  RankedVendor,
  RankingComponents,
  ResolvedDemand,
  SemanticExpansion,
} from '../../domain/models/demand';
import { combineRanking, needsClarification, proximityScore } from '../../domain/models/demand';
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

const COMPONENT = 'CME';

/** Candidates pulled per capability before ranking. Broad on purpose (CME §11). */
const CANDIDATES_PER_CAPABILITY = 40;

/**
 * Belief floor for a vendor to be considered a candidate at all.
 *
 * Low, because retrieval should be inclusive and ranking should discriminate — excluding a
 * plausible vendor here means they can never be surfaced, however good their evidence.
 */
const MIN_CANDIDATE_CONFIDENCE = 0.15;

/** Ranked vendors returned by default. */
const DEFAULT_RESULT_LIMIT = 10;

export interface MatchRequest {
  readonly query: string;
  readonly history?: readonly string[];
  /** Customer location, for proximity scoring. */
  readonly customerCity?: string | null;
  readonly limit?: number;
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
 *
 * Demand Understanding → Ambiguity Manager → Semantic Expansion → Canonical Resolution →
 * Capability→GPC Mapping → Candidate Retrieval → Evidence Lookup → Ranking.
 *
 * It returns ranked candidates and nothing else: the CME "does not generate conversational
 * responses", and it never decides whether a conversation is a search — that is the
 * Conversation OS's job (CME §19).
 */
@Injectable()
export class CapabilityMatchingService {
  constructor(
    @Inject(VENDOR_REPOSITORY) private readonly vendors: VendorRepositoryPort,
    @Inject(TAXONOMY_REPOSITORY) private readonly taxonomy: TaxonomyRepositoryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly understanding: DemandUnderstandingService,
    private readonly resolver: CapabilityResolver,
    private readonly evidence: EvidenceQueryService,
  ) {}

  async match(request: MatchRequest): Promise<MatchResult> {
    const startedAt = Date.now();

    // ── Stage 1: Demand Understanding ────────────────────────────────────────────────
    const demand = await this.understanding.understand({
      query: request.query,
      history: request.history ?? [],
    });

    // ── Stage 2: Ambiguity Manager ───────────────────────────────────────────────────
    // Retrieval is deliberately skipped when clarifying, so the customer is never shown a
    // vendor list assembled from the wrong reading of their words (CME Test 2).
    if (needsClarification(demand)) {
      const question = this.buildClarificationQuestion(demand);

      this.logger.stage({
        component: COMPONENT,
        stage: 'AmbiguityManager',
        input: { query: request.query, ambiguityType: demand.ambiguityType },
        action: 'Ambiguity would materially change the vendor set; requesting clarification before retrieval',
        output: { question, options: demand.ambiguityOptions },
        durationMs: Date.now() - startedAt,
      });

      return {
        outcome: 'clarification_needed',
        demand,
        question,
        options: demand.ambiguityOptions,
      };
    }

    // ── Stage 3: Semantic Expansion ──────────────────────────────────────────────────
    const expansion = await this.understanding.expand(demand);

    // ── Stages 4-5: Canonical resolution and Capability→GPC mapping ──────────────────
    const resolved = await this.resolveCapabilities(demand, expansion);

    if (resolved.primaryCapabilities.length === 0 && resolved.expandedCapabilities.length === 0) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: 'CanonicalCapabilityResolution',
        input: { query: request.query },
        action: 'Nothing in the request resolved to a canonical capability; cannot retrieve vendors',
        error: new Error('No canonical capability resolved'),
      });

      return { outcome: 'no_capability', demand };
    }

    // ── Stage 6: Candidate Vendor Retrieval ──────────────────────────────────────────
    const candidates = await this.retrieveCandidates(resolved);

    if (candidates.size === 0) {
      this.logger.stage({
        component: COMPONENT,
        stage: 'CandidateVendorRetrieval',
        input: { capabilities: resolved.primaryCapabilities.map((c) => c.id) },
        action: 'No vendor in the marketplace has these capabilities yet',
        output: { candidates: 0 },
      });

      return { outcome: 'ranked', resolved, vendors: [] };
    }

    // ── Stages 7-8: Evidence Lookup and Ranking ──────────────────────────────────────
    const ranked = await this.rank({
      resolved,
      candidates: [...candidates.values()],
      customerCity: request.customerCity ?? null,
      limit: request.limit ?? DEFAULT_RESULT_LIMIT,
    });

    this.logger.stage({
      component: COMPONENT,
      stage: 'RankingEngine',
      input: {
        query: request.query,
        primaryCapabilities: resolved.primaryCapabilities.map((c) => c.name),
        candidates: candidates.size,
      },
      action: 'Ranked candidate vendors on capability match, expansion, evidence and proximity',
      output: {
        vendors: ranked.map((vendor) => ({
          name: vendor.businessName,
          score: Number(vendor.score.toFixed(3)),
          capability: Number(vendor.components.capabilityMatch.toFixed(2)),
          evidence: Number(vendor.components.evidenceScore.toFixed(2)),
        })),
      },
      durationMs: Date.now() - startedAt,
    });

    return { outcome: 'ranked', resolved, vendors: ranked };
  }

  /**
   * Resolves the demand to canonical capability identifiers.
   *
   * Primary capabilities come from what the customer actually named; expanded ones come from the
   * reasoning graphs. They are kept apart because they must not be scored alike — a vendor
   * matching what was asked for should always outrank one matching only what it implies.
   */
  private async resolveCapabilities(
    demand: DemandObject,
    expansion: SemanticExpansion,
  ): Promise<ResolvedDemand> {
    const primaryTerms = [...demand.products, ...demand.services, ...demand.businessTypes];

    const expandedTerms = [
      ...expansion.inferredProducts,
      ...expansion.capabilities.map((entry) => entry.name),
      ...expansion.inventoryAffinities.map((entry) => entry.name),
    ];

    const [primary, expanded] = await Promise.all([
      this.resolver.resolveProducts(primaryTerms),
      this.resolver.resolveProducts(expandedTerms),
    ]);

    const primaryIds = new Set(primary.map((entry) => entry.capability.id));

    return {
      demand,
      expansion,
      primaryCapabilities: primary.map((entry) => entry.capability),
      // A capability reached both ways is primary; listing it twice would double-count it.
      expandedCapabilities: expanded
        .map((entry) => entry.capability)
        .filter((capability) => !primaryIds.has(capability.id)),
    };
  }

  /**
   * Retrieves a broad candidate set (CME §11: "This stage intentionally retrieves a broad
   * candidate set. No ranking occurs here.").
   */
  /**
   * Retrieves a broad candidate set (CME §11: "This stage intentionally retrieves a broad
   * candidate set. No ranking occurs here.").
   *
   * Extends retrieval across exact brick codes and ancestor taxonomy nodes (family/segment)
   * to ensure DAEM Layer 2 Archetype Expansion candidates enter the scoring pool.
   */
  private async retrieveCandidates(resolved: ResolvedDemand): Promise<Map<string, VendorProfile>> {
    const primaryCaps = resolved.primaryCapabilities;
    const expandedCaps = resolved.expandedCapabilities;

    const targetCapabilityIds = new Set<string>();
    for (const cap of primaryCaps) {
      targetCapabilityIds.add(cap.id);
      try {
        const node = await this.taxonomy.findByCode(cap.id);
        if (node?.familyCode) targetCapabilityIds.add(node.familyCode);
        if (node?.segmentCode) targetCapabilityIds.add(node.segmentCode);
      } catch {
        // Taxonomy lookup fallback: retain primary capability id.
      }
    }

    for (const cap of expandedCaps) {
      targetCapabilityIds.add(cap.id);
    }

    const capIdsArray = Array.from(targetCapabilityIds);

    const batches = await Promise.all(
      capIdsArray.map((capabilityId) =>
        this.vendors.findByCapability({
          capabilityId,
          minConfidence: MIN_CANDIDATE_CONFIDENCE,
          limit: CANDIDATES_PER_CAPABILITY,
        }),
      ),
    );

    const candidates = new Map<string, VendorProfile>();

    for (const batch of batches) {
      for (const profile of batch) {
        // Only vendors who finished onboarding are searchable.
        if (profile.vendor.status !== 'active') continue;
        candidates.set(profile.vendor.id, profile);
      }
    }

    this.logger.stage({
      component: COMPONENT,
      stage: 'CandidateVendorRetrieval',
      action:
        'Retrieved candidate vendor profiles matching primary, expanded, and archetype segment capabilities',
      input: { primaryCapabilities: primaryCaps.map((c) => c.name), queriedCapabilityIds: capIdsArray },
      output: {
        candidateCount: candidates.size,
        candidates: Array.from(candidates.values()).map((p) => ({
          vendorId: p.vendor.id,
          businessName: p.vendor.businessName,
          declaredProducts: p.dna.declaredProducts,
        })),
      },
    });

    return candidates;
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
  private async rank(params: {
    resolved: ResolvedDemand;
    candidates: readonly VendorProfile[];
    customerCity: string | null;
    limit: number;
  }): Promise<readonly RankedVendor[]> {
    const { resolved, candidates } = params;

    // One evidence lookup for the whole candidate set, against the strongest capability the
    // customer actually asked for.
    const evidenceSubject = resolved.primaryCapabilities[0] ?? resolved.expandedCapabilities[0];

    const evidenceScores = await this.evidence.getEvidenceScores({
      vendorIds: candidates.map((profile) => profile.vendor.id),
      subjectType: 'capability',
      subject: evidenceSubject.id,
    });

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
          cleaned = `${shortName} specializes in ${cleaned.replace(specPrefix, '')}`;
        } else if (shortPrefix.test(cleaned)) {
          cleaned = `${shortName} specializes in ${cleaned.replace(shortPrefix, '')}`;
        } else {
          cleaned = cleaned.replace(/^(?:specializes\s+in|sells|capabilities|services):\s*/i, '').trim();
          cleaned = `${shortName} specializes in ${cleaned}`;
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
      const node = await this.taxonomy.findByCode(brickCode);
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

  private buildClarificationQuestion(demand: DemandObject): string {
    const subject = demand.products[0] ?? demand.rawQuery;

    return [
      `Which type of ${subject.toLowerCase()} are you looking for?`,
      ...demand.ambiguityOptions.map((option) => `• ${option}`),
    ].join('\n');
  }
}
