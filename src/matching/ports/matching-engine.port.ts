import type { MatchingResult, StructuredDemand } from '../domain/matching-models';

export const MATCHING_ENGINE = Symbol('MatchingEngine');

/**
 * Authoritative Matching Engine Port (Phase 11; Overarching TDR §15.2).
 */
export interface MatchingEnginePort {
  /**
   * Matches structured demand against vendor capabilities, traverses MKG for accessory/substitute priors,
   * performs eligibility filtering and deterministic composite scoring, and outputs a ranked recipient plan.
   */
  match(demand: StructuredDemand): Promise<MatchingResult>;
}
