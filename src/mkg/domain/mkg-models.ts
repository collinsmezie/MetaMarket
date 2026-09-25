import type { MkgLifecycleState } from '@prisma/client';

export type { MkgLifecycleState };

export type MkgNodeType =
  | 'CONCEPT'
  | 'PHRASE'
  | 'GPC_CLASS'
  | 'GPC_BRICK'
  | 'ACTOR'
  | 'CONTEXT'
  | 'ASSERTION';

export interface MkgNodeModel {
  readonly id: string;
  readonly nodeType: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly description?: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MkgEdgeModel {
  readonly id: string;
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly beliefScore: number;
  readonly priorScore: number;
  readonly lifecycleState: MkgLifecycleState;
  readonly evidenceIds: readonly string[];
  readonly decisionId?: string | null;
  readonly policyVersion: string;
  readonly locality?: string | null;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly idempotencyKey?: string | null;
  readonly validFrom?: Date | null;
  readonly validUntil?: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Validated graph change command crossing MKG write port (MKG TDR §12, §22, §23).
 */
export interface GraphChangeCommand {
  readonly decisionId: string;
  readonly operation: 'ADD' | 'REINFORCE' | 'DECAY' | 'DEACTIVATE' | 'PRUNE' | 'REJECT';
  readonly subjectId: string;
  readonly predicate: string;
  readonly objectId: string;
  readonly beliefScore?: number;
  readonly priorScore?: number;
  readonly evidenceIds?: readonly string[];
  readonly policyVersion?: string;
  readonly correlationId?: string;
  readonly occurredAt?: string;
  readonly locality?: string | null;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export type MkgDerivationType = 'STORED_FACT' | 'GRAPH_DERIVED_PRIOR' | 'GRAPH_DERIVED_INFERENCE';

export interface MkgTraversalStep {
  readonly edge: MkgEdgeModel;
  readonly targetNode: MkgNodeModel;
  readonly direction: 'OUTGOING' | 'INCOMING';
}

export interface MkgTraversalPath {
  readonly startNode: MkgNodeModel;
  readonly steps: readonly MkgTraversalStep[];
  readonly depth: number;
  readonly cumulativeBelief: number;
  readonly derivation: MkgDerivationType;
  readonly endNode: MkgNodeModel;
}

export interface MkgTraverseOptions {
  readonly startNodeId: string;
  readonly predicates?: readonly string[];
  readonly direction?: 'OUTGOING' | 'INCOMING' | 'BOTH';
  readonly maxDepth?: number;
  readonly includeInactive?: boolean;
  readonly minBelief?: number;
  readonly locality?: string | null;
}

export interface GraphMutationResult {
  readonly success: boolean;
  readonly edgeId?: string;
  readonly operation: string;
  readonly previousState?: MkgLifecycleState | null;
  readonly newState: MkgLifecycleState;
  readonly idempotencyKey: string;
  readonly detail?: string;
}
