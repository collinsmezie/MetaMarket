/**
 * Embedding generation for semantic fingerprints, vendor DNA and taxonomy nodes.
 *
 * Backed by OpenAI `text-embedding-3-small` (1536-dim). The dimension is fixed by the
 * pgvector column definitions, so a model change is a migration, not a config tweak —
 * {@link EmbeddingProviderPort.dimension} exists so that mismatch fails loudly at boot.
 */

export const EMBEDDING_PROVIDER = Symbol('EmbeddingProvider');

export interface EmbeddingProviderPort {
  readonly model: string;
  readonly dimension: number;

  /** Embeds a single text. Returns a vector of exactly {@link dimension} floats. */
  embed(text: string): Promise<readonly number[]>;

  /**
   * Embeds many texts in one round trip.
   * Used by taxonomy seeding, where per-item calls would be prohibitively slow.
   */
  embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** Cosine similarity of two equal-length vectors, in [-1,1]. */
export function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) {
    throw new EmbeddingError(`Cannot compare vectors of different dimensions: ${a.length} vs ${b.length}`);
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
