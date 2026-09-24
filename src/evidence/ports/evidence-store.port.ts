import type {
  Assertion,
  AssertionContext,
  BeliefDirection,
  GraphChangeDecision,
  KnowledgeState,
  NodeType,
  NormalizedEvidence,
  ObservationInput,
  Polarity,
} from '../domain/evidence-model';

export const EVIDENCE_STORE = Symbol('EvidenceStore');

export type ObservationStatus = 'RECORDED' | 'INTERPRETED' | 'IGNORED' | 'FAILED';

export interface ObservationRecord extends ObservationInput {
  readonly id: string;
  readonly status: ObservationStatus;
  readonly evidenceCount: number;
  readonly error: { code: string; message: string } | null;
  readonly ingestedAt: Date;
}

export interface EvidenceRecord extends NormalizedEvidence {
  readonly id: string;
  readonly createdAt: Date;
}

/** Relationship-first persistence (§20, §47.10): one row per assertion with its current belief. */
export interface AssertionRecord {
  readonly id: string;
  readonly assertionId: string;
  readonly assertion: Assertion;
  readonly subjectType: NodeType;
  readonly objectType: NodeType;
  readonly subjectLabel: string;
  readonly objectLabel: string;
  readonly context: AssertionContext;
  readonly knowledgeType: string;
  readonly prior: number | null;
  readonly belief: number;
  readonly direction: BeliefDirection;
  readonly state: KnowledgeState;
  readonly observationCount: number;
  readonly evidenceCount: number;
  readonly independentSourceCount: number;
  readonly counts: Readonly<Record<Polarity, number>>;
  readonly requiresMoreEvidence: boolean;
  readonly firstObservedAt: Date | null;
  readonly lastObservedAt: Date | null;
  readonly lastFusedAt: Date | null;
  readonly policyVersion: string;
  /** Last §51.2 fusion output, verbatim. */
  readonly fusion: Readonly<Record<string, unknown>> | null;
  readonly decisionCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface AssertionUpsert {
  readonly assertionId: string;
  readonly assertion: Assertion;
  readonly subjectType: NodeType;
  readonly objectType: NodeType;
  readonly subjectLabel: string;
  readonly objectLabel: string;
  readonly context: AssertionContext;
  readonly knowledgeType: string;
  readonly prior: number | null;
  readonly belief: number;
  readonly direction: BeliefDirection;
  readonly state: KnowledgeState;
  readonly observationCount: number;
  readonly evidenceCount: number;
  readonly independentSourceCount: number;
  readonly counts: Readonly<Record<Polarity, number>>;
  readonly requiresMoreEvidence: boolean;
  readonly firstObservedAt: Date | null;
  readonly lastObservedAt: Date | null;
  readonly lastFusedAt: Date;
  readonly policyVersion: string;
  readonly fusion: Readonly<Record<string, unknown>>;
}

export interface BeliefHistoryEntry {
  readonly assertionId: string;
  readonly score: number;
  readonly previousScore: number | null;
  readonly reason: string;
  readonly evidenceIds: readonly string[];
  readonly policyVersion: string;
  readonly recordedAt: Date;
}

export interface KnowledgeRecord {
  readonly id: string;
  readonly knowledgeId: string;
  readonly assertionId: string;
  readonly type: string;
  readonly claim: Readonly<Record<string, unknown>>;
  readonly scope: Readonly<Record<string, unknown>>;
  readonly confidence: number;
  readonly state: KnowledgeState;
  readonly supportedBy: readonly string[];
  readonly contradictedBy: readonly string[];
  readonly createdAt: Date;
  readonly lastValidatedAt: Date | null;
  readonly updatedAt: Date;
}

export type KnowledgeUpsert = Omit<KnowledgeRecord, 'id' | 'createdAt' | 'updatedAt'>;

export type GraphChangeDecisionStatus = 'PENDING' | 'APPLIED' | 'REJECTED' | 'FAILED';

export interface GraphChangeDecisionRecord extends GraphChangeDecision {
  readonly id: string;
  readonly status: GraphChangeDecisionStatus;
  readonly appliedAt: Date | null;
  readonly failure: string | null;
}

export interface EvidenceStorePort {
  /** Returns null when the observation id is already recorded (duplicate delivery, §8/§39). */
  recordObservation(observation: ObservationInput): Promise<ObservationRecord | null>;
  findObservation(observationId: string): Promise<ObservationRecord | null>;
  completeObservation(
    observationId: string,
    status: ObservationStatus,
    evidenceCount: number,
    error: { code: string; message: string } | null,
  ): Promise<void>;

  appendEvidence(items: readonly NormalizedEvidence[]): Promise<readonly EvidenceRecord[]>;
  evidenceForAssertion(assertionId: string): Promise<readonly EvidenceRecord[]>;
  evidenceForObservation(observationId: string): Promise<readonly EvidenceRecord[]>;
  evidenceForRequest(requestId: string): Promise<readonly EvidenceRecord[]>;

  findAssertion(assertionId: string): Promise<AssertionRecord | null>;
  findAssertions(assertionIds: readonly string[]): Promise<readonly AssertionRecord[]>;
  /** Assertions touching a node (as subject or object), optionally filtered by predicate. */
  assertionsForNode(
    nodeId: string,
    predicates: readonly string[] | null,
  ): Promise<readonly AssertionRecord[]>;
  upsertAssertion(assertion: AssertionUpsert): Promise<AssertionRecord>;
  appendBeliefHistory(entry: BeliefHistoryEntry): Promise<void>;
  beliefHistory(assertionId: string): Promise<readonly (BeliefHistoryEntry & { id: string })[]>;

  upsertKnowledge(knowledge: KnowledgeUpsert): Promise<KnowledgeRecord>;
  knowledgeForAssertions(assertionIds: readonly string[]): Promise<readonly KnowledgeRecord[]>;
  /** Knowledge of a type whose claim matches (e.g. LOCAL_TERM_MAPPING for normalised phrases). */
  knowledgeByType(
    type: string,
    states: readonly KnowledgeState[],
    limit: number,
  ): Promise<readonly KnowledgeRecord[]>;
  knowledgeForNodes(
    nodeIds: readonly string[],
    states: readonly KnowledgeState[],
  ): Promise<readonly KnowledgeRecord[]>;

  recordDecision(decision: GraphChangeDecision): Promise<GraphChangeDecisionRecord>;
  markDecision(
    decisionId: string,
    status: GraphChangeDecisionStatus,
    failure: string | null,
    at: Date,
  ): Promise<void>;
  decisionsForAssertion(assertionId: string): Promise<readonly GraphChangeDecisionRecord[]>;
  decisionsForRun(runId: string): Promise<readonly GraphChangeDecisionRecord[]>;
  pendingDecisions(limit: number): Promise<readonly GraphChangeDecisionRecord[]>;

  observationsForRun(runId: string): Promise<readonly ObservationRecord[]>;
  observationsForRequest(requestId: string): Promise<readonly ObservationRecord[]>;
}
