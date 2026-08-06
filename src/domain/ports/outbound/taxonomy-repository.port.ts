/**
 * Access to the GS1 GPC taxonomy — the authoritative source of canonical product
 * capability identifiers (CDE "Capability Resolver").
 *
 * The resolver retrieves candidates through this port and an LLM only *ranks* them. No code
 * path may mint a capability identifier that did not come from here.
 */

export const TAXONOMY_REPOSITORY = Symbol('TaxonomyRepository');

/** GPC hierarchy levels, named so call sites do not pass bare integers. */
export const GPC_LEVEL = {
  Segment: 1,
  Family: 2,
  Class: 3,
  Brick: 4,
  AttributeType: 5,
  AttributeValue: 6,
} as const;

export type GpcLevel = (typeof GPC_LEVEL)[keyof typeof GPC_LEVEL];

export interface TaxonomyNode {
  readonly code: string;
  readonly level: number;
  readonly title: string;
  readonly definition: string;
  readonly definitionExcludes: string | null;
  readonly active: boolean;
  readonly parentCode: string | null;
  readonly segmentCode: string | null;
  readonly familyCode: string | null;
  readonly classCode: string | null;
  readonly brickCode: string | null;
}

export interface TaxonomyMatch {
  readonly node: TaxonomyNode;
  /** Cosine similarity in [-1,1]; 1 is identical. */
  readonly similarity: number;
}

/** A node ready to be written, with the text that will be embedded for it. */
export interface TaxonomyNodeInput extends TaxonomyNode {
  readonly embeddedText: string;
}

export interface TaxonomySearchOptions {
  readonly embedding: readonly number[];
  /**
   * The user's words, for the lexical half of hybrid retrieval.
   *
   * Omit when there is no natural-language query — searching by a vendor's DNA vector, for
   * instance — and retrieval falls back to dense similarity alone.
   */
  readonly text?: string;
  readonly limit: number;
  readonly minSimilarity: number;
  /** Restrict to specific hierarchy levels, e.g. bricks only. */
  readonly levels?: readonly number[];
  /** Restrict to descendants of a segment, for narrowing a second-pass search. */
  readonly segmentCode?: string;
}

/** A GPC attribute type (level 5) or value (level 6), stored once per code. */
export interface TaxonomyAttributeInput {
  readonly code: string;
  readonly level: number;
  readonly title: string;
  readonly definition: string;
  readonly active: boolean;
}

/** Attribute types applicable to a brick. */
export interface BrickAttributeTypeLink {
  readonly brickCode: string;
  readonly attributeTypeCode: string;
}

/** Values an attribute type may take for a brick. */
export interface BrickAttributeValueLink extends BrickAttributeTypeLink {
  readonly attributeValueCode: string;
}

export interface TaxonomyRepositoryPort {
  /** Inserts or updates hierarchy nodes (levels 1-4) without touching their embeddings. */
  upsertNodes(nodes: readonly TaxonomyNodeInput[]): Promise<void>;

  /** Inserts or updates the shared attribute vocabulary (levels 5-6). */
  upsertAttributes(attributes: readonly TaxonomyAttributeInput[]): Promise<void>;

  /** Replaces brick↔attribute links. */
  upsertBrickAttributeTypes(links: readonly BrickAttributeTypeLink[]): Promise<void>;
  upsertBrickAttributeValues(links: readonly BrickAttributeValueLink[]): Promise<void>;

  /** Writes embeddings for already-upserted nodes. */
  writeEmbeddings(entries: readonly { code: string; embedding: readonly number[] }[]): Promise<void>;

  /**
   * Discards stored embeddings at or above `maxLevel` and reports how many were cleared.
   *
   * Needed when the embedding model or the text-building strategy changes: mixing vectors
   * from two models in one index makes similarity scores meaningless.
   */
  clearEmbeddings(maxLevel: number): Promise<number>;

  /**
   * Nodes at or above `maxLevel` whose stored embedded text differs from what would be
   * generated now, or that have no embedding yet.
   *
   * Drives incremental re-seeding: an unchanged taxonomy costs nothing to re-run, which
   * matters because embeddings are billed per call.
   */
  findNodesNeedingEmbedding(maxLevel: number, limit: number): Promise<readonly TaxonomyNodeInput[]>;

  /** Semantic retrieval over the taxonomy. */
  search(options: TaxonomySearchOptions): Promise<readonly TaxonomyMatch[]>;

  findByCode(code: string): Promise<TaxonomyNode | null>;

  /** Ancestors from segment down to the node's parent, for explainable capability paths. */
  ancestorsOf(code: string): Promise<readonly TaxonomyNode[]>;

  countByLevel(): Promise<Readonly<Record<number, number>>>;

  countEmbedded(): Promise<number>;
}
