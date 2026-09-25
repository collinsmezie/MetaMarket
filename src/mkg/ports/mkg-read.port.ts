import type {
  KnowledgeQuery,
  MarketConceptKnowledge,
  MKGReadPort as EnrichmentMkgReadPort,
} from '../../enrichment/ports/mkg-read.port';
import type {
  MkgNodeModel,
  MkgTraversalPath,
  MkgTraverseOptions,
} from '../domain/mkg-models';

export const MKG_READ_PORT = Symbol('MkgReadPort');

export interface CapabilityContextVendor {
  readonly vendorId: string;
  readonly businessName: string;
  readonly beliefScore: number;
  readonly pathDepth: number;
  readonly pathPredicate: string;
  readonly derivation: 'STORED_FACT' | 'GRAPH_DERIVED_INFERENCE';
  readonly locality?: string | null;
}

export interface CapabilityContextResult {
  readonly conceptId: string;
  readonly conceptLabel: string;
  readonly directVendors: readonly CapabilityContextVendor[];
  readonly relatedVendors: readonly CapabilityContextVendor[];
  readonly accessories: readonly {
    readonly conceptId: string;
    readonly label: string;
    readonly beliefScore: number;
  }[];
  readonly substitutes: readonly {
    readonly conceptId: string;
    readonly label: string;
    readonly beliefScore: number;
  }[];
}

/**
 * Authoritative MKG Read Port (MKG TDR §13, §33.2, §33.6).
 * Extends the read contract expected by Enrichment (§29.3).
 */
export interface MkgReadPort extends EnrichmentMkgReadPort {
  /**
   * Traverses the commercial graph starting from a node with cycle protection,
   * depth bounding, predicate filtering, and belief dampening.
   */
  traverseGraph(options: MkgTraverseOptions): Promise<readonly MkgTraversalPath[]>;

  /** Retrieves a single node by its stable ID. */
  getNode(nodeId: string): Promise<MkgNodeModel | null>;

  /** Retrieves multiple nodes by IDs. */
  getNodes(nodeIds: readonly string[]): Promise<readonly MkgNodeModel[]>;

  /**
   * Traverses commercial context for capability matching (direct suppliers + accessory/substitute suppliers).
   */
  getCapabilityContext(conceptId: string, minBelief?: number): Promise<CapabilityContextResult>;

  /**
   * Typed read API for Semantic Enrichment (Enrichment §29.3).
   */
  knowledgeFor(query: KnowledgeQuery): Promise<readonly MarketConceptKnowledge[]>;
}
