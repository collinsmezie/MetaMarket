export const EVIDENCE_QUERY = Symbol('EvidenceQuery');

/** §30 / §50.1 request in domain form. */
export interface EvidenceQueryRequest {
  readonly requestId: string;
  readonly consumer: { component: string; version: string };
  readonly task: { type: string; question: string };
  readonly objects: readonly { id: string; surfaceForm: string; marketConceptId: string | null }[];
  readonly semanticTarget: { phrase: string; concept: string | null } | null;
  readonly relationshipTarget: {
    subjectId: string | null;
    predicate: string | null;
    objectId: string | null;
  } | null;
  readonly context: Readonly<Record<string, unknown>>;
  readonly candidateInterpretations: readonly string[];
  readonly requiredEvidence: readonly string[];
}

/** §31 / §50.2 stable envelope as validated snake_case wire. */
export interface EvidenceQueryResponse {
  readonly requestId: string;
  readonly status: 'SUCCESS' | 'PARTIAL' | 'NO_RELIABLE_EVIDENCE' | 'ERROR';
  readonly response: Readonly<Record<string, unknown>>;
}

/**
 * Evidence System read port (§29 consumers: CSRE grounding, Enrichment, GPC priors, Matching).
 * Returns evidence + knowledge + current beliefs with provenance; never decides the consumer's
 * question (§45). Knowledge returned here is not fresh evidence (§38, §54.3).
 */
export interface EvidenceQueryPort {
  retrieve(request: EvidenceQueryRequest): Promise<EvidenceQueryResponse>;
}
