import type { GpcCandidate } from '../domain/gpc-mapping';

export const GPC_CANDIDATE_RETRIEVAL = Symbol('GpcCandidateRetrieval');

/** Retrieval material for one object (GPC Resolver TDR §12, §76.2). */
export interface CandidateQuery {
  readonly objectId: string;
  readonly canonicalForm: string;
  readonly entityType: string;
  readonly definition: string;
  /** Enrichment terminology and vocabulary, when present (§12 items 3–4, §95.3). */
  readonly aliases: readonly string[];
  readonly taxonomyVocabulary: readonly string[];
  /** Enrichment's taxonomy-oriented embedding text, when present (§11). */
  readonly taxonomyEmbeddingText: string | null;
  /** Prior validated MarketConcept → GPC codes from the knowledge layer (§12 item 10). */
  readonly knownGpcCodes: readonly string[];
}

export interface CandidateRetrievalResult {
  readonly candidates: readonly GpcCandidate[];
  /** Installed sovereign dataset identity these candidates came from (§93.5). */
  readonly gpcVersion: string;
}

/**
 * `GpcCandidateRetrievalPort` (§76.2): owned by the GPC Resolver, backed by the installed
 * sovereign taxonomy index. Vector similarity is candidate generation only (§12); the fused
 * retrieval score is never the mapping confidence (§46).
 */
export interface GpcCandidateRetrievalPort {
  retrieve(queries: readonly CandidateQuery[], limitPerObject: number): Promise<CandidateRetrievalResult>;
  /** Identity of the installed GPC dataset (§93.5, §63). */
  datasetVersion(): Promise<string>;
}

export const GPC_KNOWLEDGE = Symbol('GpcKnowledge');

/** Prior validated mapping from the knowledge layer, with provenance (§23, §76.6). */
export interface PriorGpcMapping {
  readonly marketConceptId: string | null;
  readonly concept: string;
  readonly gpcCode: string;
  readonly gpcLevel: string;
  readonly gpcTitle: string;
  readonly belief: number;
  readonly evidenceIds: readonly string[];
  readonly derivation: 'STORED' | 'INFERRED';
}

/**
 * Read-side MKG context for the resolver (§76.6): prior validated MarketConcept → GPC mappings
 * and approved terminology. Read-only; bound to a Noop until the graph exists (Phase 9).
 */
export interface GpcKnowledgePort {
  priorMappings(query: {
    readonly marketConceptIds: readonly string[];
    readonly concepts: readonly string[];
  }): Promise<readonly PriorGpcMapping[]>;
}
