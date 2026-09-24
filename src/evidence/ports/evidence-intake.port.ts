import type { GraphChangeDecision, ObservationInput } from '../domain/evidence-model';
import type {
  AssertionRecord,
  EvidenceRecord,
  KnowledgeRecord,
  ObservationRecord,
} from './evidence-store.port';

export const EVIDENCE_INTAKE = Symbol('EvidenceIntake');

export interface IngestResult {
  readonly observation: ObservationRecord;
  /** True when this delivery was a duplicate and nothing new was learned (§8, §39). */
  readonly duplicate: boolean;
  readonly evidence: readonly EvidenceRecord[];
  readonly assertions: readonly AssertionRecord[];
  readonly knowledge: readonly KnowledgeRecord[];
  readonly decisions: readonly GraphChangeDecision[];
  readonly promptExecutionIds: readonly string[];
  readonly error: { code: string; message: string } | null;
}

/**
 * Evidence System inbound port (Overarching §24.1 `POST /v1/evidence/ingest`; Evidence TDR §2,
 * §42, §54.6). One observation in, immutable evidence + recalculated beliefs + knowledge +
 * GraphChangeDecisions out. Idempotent on `observationId`.
 */
export interface EvidenceIntakePort {
  ingest(observation: ObservationInput): Promise<IngestResult>;
}
