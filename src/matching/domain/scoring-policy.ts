import type { MatchCandidate, ScoreBreakdown, StructuredDemand } from './matching-models';

/**
 * Deterministic Composite Scoring Policy (Overarching TDR §15.2).
 *
 * Replaces opaque single LLM scores with an inspectable composite model:
 *
 *   match_score =
 *       semantic_fit
 *     + gpc_fit
 *     + capability_belief
 *     + graph_prior
 *     + location_fit
 *     + freshness
 *     - contradiction_penalty
 */
export class ScoringPolicy {
  // Configurable weights per policy version (§15.2)
  static readonly WEIGHT_SEMANTIC_FIT = 1.2;
  static readonly WEIGHT_GPC_FIT = 1.0;
  static readonly WEIGHT_CAPABILITY_BELIEF = 0.8;
  static readonly WEIGHT_GRAPH_PRIOR = 0.6;
  static readonly WEIGHT_LOCATION_FIT = 0.4;
  static readonly WEIGHT_FRESHNESS = 0.2;
  static readonly PENALTY_CONTRADICTION = 1.5;

  static computeScore(
    candidate: Omit<MatchCandidate, 'finalScore' | 'scoreBreakdown'>,
    demand: StructuredDemand,
  ): ScoreBreakdown {
    // 1. Semantic Fit (0.0 to 1.0)
    let semanticFit = 0.0;
    const targetLabel = (demand.conceptLabel ?? demand.query).toLowerCase().trim();
    const candidateMatched = candidate.matchedConcept.toLowerCase().trim();

    if (candidate.derivation === 'STORED_FACT') {
      if (candidateMatched === targetLabel || candidateMatched.includes(targetLabel) || targetLabel.includes(candidateMatched)) {
        semanticFit = 1.0;
      } else {
        semanticFit = 0.85;
      }
    } else if (candidate.derivation === 'GRAPH_DERIVED_INFERENCE') {
      // 2-hop accessory or substitute
      semanticFit = 0.75;
    } else if (candidate.derivation === 'TAXONOMY_BACKBONE') {
      semanticFit = 0.70;
    }

    // 2. GPC Fit (0.0 to 1.0)
    let gpcFit = 0.0;
    if (demand.gpcCode) {
      if (candidate.pathPredicate?.includes('1000') || candidate.matchedConcept.includes(demand.gpcCode)) {
        gpcFit = 1.0;
      } else if (candidate.derivation === 'STORED_FACT') {
        gpcFit = 0.9;
      } else {
        gpcFit = 0.7;
      }
    } else {
      gpcFit = 0.8; // Default when demand has no specific GPC code constraint
    }

    // 3. Capability Belief (0.0 to 1.0)
    const capabilityBelief = Math.max(0.0, Math.min(1.0, candidate.rawBelief));

    // 4. Graph Prior (0.0 to 1.0)
    let graphPrior = 1.0;
    if (candidate.derivation === 'GRAPH_DERIVED_INFERENCE') {
      graphPrior = 0.85 * (1.0 / (candidate.pathDepth || 2));
    } else if (candidate.derivation === 'TAXONOMY_BACKBONE') {
      graphPrior = 0.75;
    }

    // 5. Location Fit (0.0 to 1.0)
    let locationFit = 0.5; // neutral location score
    if (demand.customerCity && candidate.city) {
      const cCity = demand.customerCity.toLowerCase().trim();
      const vCity = candidate.city.toLowerCase().trim();
      if (vCity === cCity || vCity.includes(cCity) || cCity.includes(vCity)) {
        locationFit = 1.0;
      } else if (candidate.state && demand.customerCity.toLowerCase().includes(candidate.state.toLowerCase())) {
        locationFit = 0.8;
      } else {
        locationFit = 0.3;
      }
    }

    // 6. Freshness (0.0 to 1.0)
    const freshness = 0.9;

    // 7. Contradiction Penalty (0.0 if no contradiction)
    const contradictionPenalty = 0.0;

    const weightedScore =
      semanticFit * this.WEIGHT_SEMANTIC_FIT +
      gpcFit * this.WEIGHT_GPC_FIT +
      capabilityBelief * this.WEIGHT_CAPABILITY_BELIEF +
      graphPrior * this.WEIGHT_GRAPH_PRIOR +
      locationFit * this.WEIGHT_LOCATION_FIT +
      freshness * this.WEIGHT_FRESHNESS -
      contradictionPenalty * this.PENALTY_CONTRADICTION;

    const totalScore = Math.max(0.0, Math.round(weightedScore * 100) / 100);

    return {
      semanticFit,
      gpcFit,
      capabilityBelief,
      graphPrior,
      locationFit,
      freshness,
      contradictionPenalty,
      totalScore,
    };
  }
}
