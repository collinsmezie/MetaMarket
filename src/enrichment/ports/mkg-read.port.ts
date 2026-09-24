export const MKG_READ = Symbol('MKGRead');

/** Knowledge the graph holds about a concept, with provenance (Enrichment §29.3, MKG TDR). */
export interface MarketConceptKnowledge {
  readonly marketConceptId: string;
  readonly prefLabel: string;
  readonly altLabels: readonly string[];
  readonly broader: readonly string[];
  readonly narrower: readonly string[];
  readonly relationships: readonly {
    readonly type: string;
    readonly target: string;
    readonly belief: number;
  }[];
  readonly gpcLineage: readonly {
    readonly gpcCode: string;
    readonly title: string;
    readonly belief: number;
  }[];
  /** Stored facts vs graph-derived inference must stay distinguishable (§29.3). */
  readonly derivation: 'STORED' | 'INFERRED';
  readonly evidenceIds: readonly string[];
}

export interface KnowledgeQuery {
  readonly marketConceptIds: readonly string[];
  readonly labels: readonly string[];
  readonly locality: string | null;
}

/**
 * Typed MKG read port for Enrichment (§9.1, §29.3). Read-only by construction: Enrichment is
 * forbidden from writing the graph. Bound to {@link NoopMkgRead} until the Market Knowledge
 * Graph exists (Phase 9), so knowledge context is empty rather than guessed.
 */
export interface MKGReadPort {
  knowledgeFor(query: KnowledgeQuery): Promise<readonly MarketConceptKnowledge[]>;
}

export const ENRICHMENT_EVIDENCE_RETRIEVAL = Symbol('EnrichmentEvidenceRetrieval');

/** Consumer-aware WRS request (Enrichment §26.5, §27.1). */
export interface EnrichmentEvidenceRequest {
  readonly requestId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly objectId: string;
  readonly semanticOrigin: Readonly<Record<string, unknown>>;
  readonly question: string;
  readonly reason: string;
  readonly candidates: readonly string[];
  readonly geographicContext: string | null;
  readonly preferredSourceTypes: readonly string[];
  readonly requestedFields: readonly string[];
}

export interface EnrichmentEvidenceItem {
  /** WRS evidence id, never replaced (§28.4). */
  readonly evidenceId: string;
  readonly source: string;
  readonly sourceType: string;
  readonly claim: string;
  readonly reliability: number;
  readonly geographicRelevance: string | null;
}

/**
 * Enrichment → WRS evidence path (§8, §9, §26.5). Optional and evidence-driven; bound to a
 * disabled adapter until WRS exists (Phase 7). `available()` false means enrichment proceeds
 * with `EVIDENCE_REQUIRED` recorded honestly rather than faked.
 */
export interface EnrichmentEvidenceRetrievalPort {
  available(): boolean;
  retrieve(request: EnrichmentEvidenceRequest): Promise<readonly EnrichmentEvidenceItem[]>;
}
