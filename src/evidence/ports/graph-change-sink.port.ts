import type { GraphChangeDecision } from '../domain/evidence-model';

export const GRAPH_CHANGE_SINK = Symbol('GraphChangeSink');

export interface GraphChangeOutcome {
  readonly decisionId: string;
  readonly status: 'ACCEPTED' | 'APPLIED' | 'REJECTED' | 'DEFERRED';
  readonly detail: string | null;
}

/**
 * Evidence → MKG hand-off (Evidence TDR §29, §50.9, §53.1–§53.2; MKG TDR §12). Evidence never
 * writes graph storage; it submits validated `GraphChangeDecision`s. Phase 8 binds a recording
 * sink (decision persisted + `GraphChangeDecided` published); Phase 9 binds the MKG write port.
 */
export interface GraphChangeSinkPort {
  submit(decision: GraphChangeDecision): Promise<GraphChangeOutcome>;
}
