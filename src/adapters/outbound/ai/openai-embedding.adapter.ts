import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { AppConfigService } from '../../../config/app-config.service';
import type { EmbeddingProviderPort } from '../../../domain/ports/outbound/embedding-provider.port';
import { EmbeddingError } from '../../../domain/ports/outbound/embedding-provider.port';

/**
 * OpenAI embeddings for semantic fingerprints, vendor DNA and taxonomy nodes.
 *
 * Single provider by design: the vector column dimension is fixed by the schema, so mixing
 * models would produce vectors that are not comparable with those already stored.
 */

/** OpenAI's per-request input cap for the embeddings endpoint. */
const MAX_BATCH_SIZE = 2_048;

@Injectable()
export class OpenAiEmbeddingAdapter implements EmbeddingProviderPort {
  private readonly client: OpenAI | null;
  readonly model: string;
  readonly dimension: number;

  constructor(config: AppConfigService) {
    const { apiKey, embeddingModel } = config.openai;
    this.model = embeddingModel;
    this.dimension = config.embeddingDimension;
    this.client = apiKey === undefined ? null : new OpenAI({ apiKey });
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  async embed(text: string): Promise<readonly number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];

    if (this.client === null) {
      throw new EmbeddingError(
        'OPENAI_API_KEY is not configured, so embeddings cannot be generated. Vector search and embedding-based workflow discovery are unavailable.',
      );
    }

    // The API rejects empty strings; a space preserves positional alignment with the input
    // array so callers can zip results back to their source items.
    const inputs = texts.map((text) => (text.trim().length === 0 ? ' ' : text));
    const vectors: number[][] = [];

    for (let offset = 0; offset < inputs.length; offset += MAX_BATCH_SIZE) {
      const batch = inputs.slice(offset, offset + MAX_BATCH_SIZE);

      try {
        const response = await this.client.embeddings.create({
          model: this.model,
          input: batch,
          // Explicit: the schema's vector column length is not negotiable at runtime.
          dimensions: this.dimension,
        });

        // The API does not guarantee ordering, but does return an index per item.
        const ordered = [...response.data].sort((a, b) => a.index - b.index);

        for (const item of ordered) {
          if (item.embedding.length !== this.dimension) {
            throw new EmbeddingError(
              `Model "${this.model}" returned ${item.embedding.length} dimensions but the schema expects ${this.dimension}.`,
            );
          }
          vectors.push(item.embedding);
        }
      } catch (error) {
        if (error instanceof EmbeddingError) throw error;
        const message = error instanceof Error ? error.message : String(error);
        throw new EmbeddingError(`Embedding request failed: ${message}`, error);
      }
    }

    return vectors;
  }
}
