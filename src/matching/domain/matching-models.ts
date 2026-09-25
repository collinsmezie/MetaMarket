/**
 * Matching & Fanout Domain Models (Phase 11; Overarching TDR §15.2, §30.5; MKG TDR §20).
 */

export interface StructuredDemand {
  readonly query: string;
  readonly history?: readonly string[];
  readonly marketConceptId?: string | null;
  readonly conceptLabel?: string | null;
  readonly gpcCode?: string | null;
  readonly customerCity?: string | null;
  readonly attributes?: readonly string[];
}

export type CandidateDerivation = 'STORED_FACT' | 'GRAPH_DERIVED_INFERENCE' | 'TAXONOMY_BACKBONE';

export interface ScoreBreakdown {
  readonly semanticFit: number;
  readonly gpcFit: number;
  readonly capabilityBelief: number;
  readonly graphPrior: number;
  readonly locationFit: number;
  readonly freshness: number;
  readonly contradictionPenalty: number;
  readonly totalScore: number;
}

export interface MatchCandidate {
  readonly vendorId: string;
  readonly businessName: string;
  readonly contactPhone?: string | null;
  readonly city?: string | null;
  readonly state?: string | null;
  readonly matchedConcept: string;
  readonly derivation: CandidateDerivation;
  readonly rawBelief: number;
  readonly pathDepth: number;
  readonly pathPredicate?: string;
  readonly rating?: string | null;
  readonly description?: string | null;
  readonly reasons: readonly string[];
  readonly scoreBreakdown?: ScoreBreakdown;
  readonly finalScore: number;
}

export interface RankedVendorView {
  readonly vendorId: string;
  readonly businessName: string;
  readonly phone?: string | null;
  readonly city: string | null;
  readonly state: string | null;
  readonly score: number;
  readonly rating?: string | null;
  readonly description?: string | null;
  readonly reasons: readonly string[];
}

export interface MatchingResult {
  readonly outcome: 'ranked' | 'clarification_needed' | 'no_capability';
  readonly resolved?: {
    readonly demand: {
      readonly products: readonly string[];
      readonly rawQuery: string;
    };
    readonly primaryCapabilities: readonly {
      readonly id: string;
      readonly name: string;
    }[];
  };
  readonly vendors?: readonly RankedVendorView[];
  readonly question?: string;
  readonly options?: readonly string[];
}
