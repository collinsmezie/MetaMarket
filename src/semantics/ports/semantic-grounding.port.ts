export const SEMANTIC_GROUNDING = Symbol('SemanticGrounding');

/** A concept already in the platform's Market Concept Scheme (CSRE §25.2, §31.4). */
export interface KnownMarketConcept {
  readonly marketConceptId: string;
  readonly label: string;
  readonly entityType: string | null;
  readonly aliases: readonly string[];
}

/** Market-language knowledge (§31.4): what a phrase has been observed to mean, with provenance. */
export interface LexiconEvidence {
  readonly phrase: string;
  readonly concept: string;
  readonly marketConceptId: string | null;
  readonly geographicScope: string | null;
  readonly sourceType: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
  readonly lastObservedAt: string | null;
}

export interface GroundingQuery {
  readonly conversationId: string;
  readonly message: string;
  readonly locations: readonly string[];
}

/**
 * CSRE outbound port for resolution *context* (CSRE §5, §25.2, §31.4).
 *
 * The knowledge layer (Evidence System + Market Knowledge Graph, Phases 8–9) supplies known
 * concepts and observed market language; CSRE consumes them as evidence and never writes back
 * (§30.1). Bound to `EvidenceSemanticGrounding` (learned LOCAL_TERM_MAPPING knowledge); every
 * concept CSRE resolves is `PROPOSED`.
 */
export interface SemanticGroundingPort {
  knownConcepts(query: GroundingQuery): Promise<readonly KnownMarketConcept[]>;
  lexiconEvidence(query: GroundingQuery): Promise<readonly LexiconEvidence[]>;
}

export const EXTERNAL_EVIDENCE_RETRIEVAL = Symbol('ExternalEvidenceRetrieval');

export interface ExternalEvidenceQuery {
  readonly requestId: string;
  readonly conversationId: string;
  readonly turnId: string;
  /** Unresolved or ambiguous surface forms with their leading candidate meanings. */
  readonly expressions: readonly { readonly surfaceForm: string; readonly candidates: readonly string[] }[];
  readonly regionalContext: Readonly<Record<string, unknown>>;
}

export interface ExternalEvidenceItem {
  readonly evidenceId: string;
  readonly source: string;
  readonly sourceType: string;
  readonly claim: string;
  readonly supportsInterpretation: string | null;
  readonly contradictsInterpretation: string | null;
  readonly geographicRelevance: string | null;
  readonly reliability: number;
}

/**
 * CSRE → WRS evidence path (CSRE §9, §17, §30.1; WRS TDR). Invoked only when the first pass
 * leaves material ambiguity that evidence could distinguish. Bound to a disabled adapter until
 * WRS exists (Phase 7); `available()` false means the evidence path is skipped, never faked.
 */
export interface ExternalEvidenceRetrievalPort {
  available(): boolean;
  retrieve(query: ExternalEvidenceQuery): Promise<readonly ExternalEvidenceItem[]>;
}
