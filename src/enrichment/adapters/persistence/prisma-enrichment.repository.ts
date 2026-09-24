import { Inject, Injectable } from '@nestjs/common';
import {
  Prisma,
  type EnrichmentProfile as ProfileRow,
  type EnrichmentResolution as Row,
} from '@prisma/client';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../../../domain/ports/outbound/embedding-provider.port';
import type { DownstreamPurpose } from '../../domain/enrichment-resolution';
import type {
  EnrichmentProfileRecord,
  EnrichmentRepositoryPort,
  EnrichmentResolutionRecord,
  NewEnrichmentProfile,
  NewEnrichmentResolutionRecord,
} from '../../ports/enrichment.repository.port';

@Injectable()
export class PrismaEnrichmentRepository implements EnrichmentRepositoryPort {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProviderPort,
  ) {}

  async save(
    record: NewEnrichmentResolutionRecord,
    profiles: readonly NewEnrichmentProfile[],
  ): Promise<{ resolution: EnrichmentResolutionRecord; profiles: readonly EnrichmentProfileRecord[] }> {
    const row = await this.prisma.enrichmentResolution.create({
      data: {
        requestId: record.requestId,
        idempotencyKey: record.idempotencyKey,
        conversationId: record.conversationId,
        turnId: record.turnId,
        runId: record.runId,
        contextSnapshotId: record.contextSnapshotId,
        sourceResolutionRequestId: record.sourceResolutionRequestId,
        componentVersion: record.componentVersion,
        promptId: record.promptId,
        promptVersion: record.promptVersion,
        schemaVersion: record.schemaVersion,
        policyVersion: record.policyVersion,
        downstreamPurpose: record.downstreamPurpose,
        status: record.status,
        enrichmentStatus: record.enrichmentStatus,
        resolution:
          record.resolution === null ? Prisma.JsonNull : (record.resolution as Prisma.InputJsonValue),
        objectCount: record.objectCount,
        evidenceRequired: record.evidenceRequired,
        promptExecutionId: record.promptExecutionId,
        modelProvider: record.modelProvider,
        modelName: record.modelName,
        latencyMs: record.latencyMs,
        error: record.error === null ? Prisma.JsonNull : record.error,
        profiles: {
          create: profiles.map((entry) => {
            const wire = entry.profile as Record<string, unknown>;
            const origin = (wire.semantic_origin ?? {}) as Record<string, unknown>;
            const embedding = (wire.embedding_representations ?? {}) as Record<string, unknown>;
            return {
              requestId: record.requestId,
              sourceResolutionRequestId: record.sourceResolutionRequestId,
              semanticObjectId: entry.semanticObjectId,
              conversationId: record.conversationId,
              turnId: record.turnId,
              objectId: entry.objectId,
              canonicalForm: String(wire.canonical_form),
              entityType: String(wire.entity_type),
              concept: String(origin.concept),
              marketConceptId: (origin.market_concept_id as string | null) ?? null,
              conceptStatus: String(origin.concept_status),
              definition: String(wire.definition ?? ''),
              canonicalEmbeddingText: String(embedding.canonical_embedding_text ?? ''),
              functionalEmbeddingText: String(embedding.functional_embedding_text ?? ''),
              taxonomyEmbeddingText: String(embedding.taxonomy_embedding_text ?? ''),
              searchTerms: strings(embedding.search_terms),
              semanticKeywords: strings(embedding.semantic_keywords),
              negativeTerms: strings(embedding.negative_terms),
              evidenceRequired: wire.evidence_required === true,
              embeddingModel: entry.embeddings?.model ?? null,
              profile: wire as Prisma.InputJsonValue,
            };
          }),
        },
      },
      include: { profiles: { orderBy: { objectId: 'asc' } } },
    });

    // pgvector columns are `Unsupported` in Prisma; write them with raw SQL after the row exists.
    for (const created of row.profiles) {
      const embeddings = profiles.find((entry) => entry.objectId === created.objectId)?.embeddings ?? null;
      if (embeddings === null) continue;
      await this.writeVector(created.id, 'canonical_embedding', embeddings.canonical);
      await this.writeVector(created.id, 'functional_embedding', embeddings.functional);
      await this.writeVector(created.id, 'taxonomy_embedding', embeddings.taxonomy);
    }

    return { resolution: toDomain(row), profiles: row.profiles.map(toProfile) };
  }

  async findByIdempotencyKey(key: string): Promise<EnrichmentResolutionRecord | null> {
    const row = await this.prisma.enrichmentResolution.findUnique({ where: { idempotencyKey: key } });
    return row === null ? null : toDomain(row);
  }

  async findByRequestId(requestId: string): Promise<EnrichmentResolutionRecord | null> {
    const row = await this.prisma.enrichmentResolution.findUnique({ where: { requestId } });
    return row === null ? null : toDomain(row);
  }

  async profilesForRequest(requestId: string): Promise<readonly EnrichmentProfileRecord[]> {
    const rows = await this.prisma.enrichmentProfile.findMany({
      where: { requestId },
      orderBy: { objectId: 'asc' },
    });
    return rows.map(toProfile);
  }

  async latestProfilesForObjects(
    semanticObjectIds: readonly string[],
  ): Promise<readonly EnrichmentProfileRecord[]> {
    if (semanticObjectIds.length === 0) return [];
    const rows = await this.prisma.enrichmentProfile.findMany({
      where: { semanticObjectId: { in: [...semanticObjectIds] }, resolution: { status: 'SUCCESS' } },
      orderBy: { createdAt: 'desc' },
    });
    const latest = new Map<string, ProfileRow>();
    for (const row of rows) {
      if (row.semanticObjectId !== null && !latest.has(row.semanticObjectId))
        latest.set(row.semanticObjectId, row);
    }
    return [...latest.values()].map(toProfile);
  }

  private async writeVector(
    profileId: string,
    column: 'canonical_embedding' | 'functional_embedding' | 'taxonomy_embedding',
    vector: readonly number[] | null,
  ): Promise<void> {
    if (vector === null) return;
    if (vector.length !== this.embeddings.dimension) {
      throw new Error(
        `Enrichment embedding has ${vector.length} dimensions but the schema expects ${this.embeddings.dimension}.`,
      );
    }
    const literal = `[${vector.join(',')}]`;
    await this.prisma.$executeRaw`
      UPDATE enrichment_profiles SET ${Prisma.raw(column)} = ${literal}::vector WHERE id = ${profileId}::uuid
    `;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function toDomain(row: Row): EnrichmentResolutionRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    idempotencyKey: row.idempotencyKey,
    conversationId: row.conversationId,
    turnId: row.turnId,
    runId: row.runId,
    contextSnapshotId: row.contextSnapshotId,
    sourceResolutionRequestId: row.sourceResolutionRequestId,
    componentVersion: row.componentVersion,
    promptId: row.promptId,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    policyVersion: row.policyVersion,
    downstreamPurpose: row.downstreamPurpose as DownstreamPurpose,
    status: row.status,
    enrichmentStatus: row.enrichmentStatus,
    resolution: (row.resolution as Record<string, unknown> | null) ?? null,
    objectCount: row.objectCount,
    evidenceRequired: row.evidenceRequired,
    promptExecutionId: row.promptExecutionId,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    latencyMs: row.latencyMs,
    error: (row.error as { code: string; message: string } | null) ?? null,
    createdAt: row.createdAt,
  };
}

function toProfile(row: ProfileRow): EnrichmentProfileRecord {
  return {
    id: row.id,
    resolutionId: row.resolutionId,
    requestId: row.requestId,
    sourceResolutionRequestId: row.sourceResolutionRequestId,
    semanticObjectId: row.semanticObjectId,
    conversationId: row.conversationId,
    turnId: row.turnId,
    objectId: row.objectId,
    canonicalForm: row.canonicalForm,
    entityType: row.entityType,
    concept: row.concept,
    marketConceptId: row.marketConceptId,
    conceptStatus: row.conceptStatus,
    definition: row.definition,
    canonicalEmbeddingText: row.canonicalEmbeddingText,
    functionalEmbeddingText: row.functionalEmbeddingText,
    taxonomyEmbeddingText: row.taxonomyEmbeddingText,
    searchTerms: row.searchTerms,
    semanticKeywords: row.semanticKeywords,
    negativeTerms: row.negativeTerms,
    evidenceRequired: row.evidenceRequired,
    embeddingModel: row.embeddingModel,
    profile: row.profile as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}
