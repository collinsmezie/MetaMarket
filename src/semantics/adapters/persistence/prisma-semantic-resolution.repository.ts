import { Injectable } from '@nestjs/common';
import { Prisma, type SemanticObject as ObjectRow, type SemanticResolution as Row } from '@prisma/client';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import type { SemanticOrigin } from '../../domain/csre-resolution';
import type {
  NewSemanticResolutionRecord,
  PersistedSemanticObject,
  SemanticResolutionRecord,
  SemanticResolutionRepositoryPort,
} from '../../ports/semantic-resolution.repository.port';

@Injectable()
export class PrismaSemanticResolutionRepository implements SemanticResolutionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(
    record: NewSemanticResolutionRecord,
  ): Promise<{ resolution: SemanticResolutionRecord; objects: readonly PersistedSemanticObject[] }> {
    const wireObjects =
      record.status === 'SUCCESS' && record.resolution !== null
        ? ((record.resolution.objects as Array<Record<string, unknown>>) ?? [])
        : [];

    const row = await this.prisma.semanticResolution.create({
      data: {
        requestId: record.requestId,
        idempotencyKey: record.idempotencyKey,
        conversationId: record.conversationId,
        turnId: record.turnId,
        runId: record.runId,
        contextSnapshotId: record.contextSnapshotId,
        understandingRevision: record.understandingRevision,
        componentVersion: record.componentVersion,
        promptId: record.promptId,
        promptVersion: record.promptVersion,
        schemaVersion: record.schemaVersion,
        policyVersion: record.policyVersion,
        status: record.status,
        resolutionStatus: record.resolutionStatus,
        resolution:
          record.resolution === null ? Prisma.JsonNull : (record.resolution as Prisma.InputJsonValue),
        objectCount: record.objectCount,
        canonicalForms: [...record.canonicalForms],
        entityTypes: [...record.entityTypes],
        clarificationRequired: record.clarificationRequired,
        promptExecutionId: record.promptExecutionId,
        modelProvider: record.modelProvider,
        modelName: record.modelName,
        latencyMs: record.latencyMs,
        error: record.error === null ? Prisma.JsonNull : record.error,
        objects: {
          create: wireObjects.map((object) => {
            const origin = object.semantic_origin as Record<string, unknown>;
            const commercial = object.commercial_interpretation as Record<string, unknown>;
            const ambiguity = object.ambiguity as Record<string, unknown>;
            return {
              requestId: record.requestId,
              conversationId: record.conversationId,
              turnId: record.turnId,
              objectId: String(object.object_id),
              surfaceForm: String(object.surface_form),
              canonicalForm: String(object.canonical_form),
              entityType: String(object.entity_type),
              brand: (object.brand as string | null) ?? null,
              productModel: (object.model as string | null) ?? null,
              phrase: String(origin.phrase),
              concept: String(origin.concept),
              marketConceptId: (origin.market_concept_id as string | null) ?? null,
              conceptStatus: String(origin.concept_status),
              semanticConfidence: Number(origin.semantic_confidence),
              commercialRelevance: String(commercial.relevance),
              commercialOffering: commercial.commercial_offering === true,
              commercialConfidence: Number(commercial.confidence),
              ambiguityPresent: ambiguity.present === true,
              object: object as Prisma.InputJsonValue,
            };
          }),
        },
      },
      include: { objects: { orderBy: { objectId: 'asc' } } },
    });

    return { resolution: toDomain(row), objects: row.objects.map(toObject) };
  }

  async findByIdempotencyKey(key: string): Promise<SemanticResolutionRecord | null> {
    const row = await this.prisma.semanticResolution.findUnique({ where: { idempotencyKey: key } });
    return row === null ? null : toDomain(row);
  }

  async findByRequestId(requestId: string): Promise<SemanticResolutionRecord | null> {
    const row = await this.prisma.semanticResolution.findUnique({ where: { requestId } });
    return row === null ? null : toDomain(row);
  }

  async findByTurnId(turnId: string): Promise<readonly SemanticResolutionRecord[]> {
    const rows = await this.prisma.semanticResolution.findMany({
      where: { turnId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  async objectsForRequest(requestId: string): Promise<readonly PersistedSemanticObject[]> {
    const rows = await this.prisma.semanticObject.findMany({
      where: { requestId },
      orderBy: { objectId: 'asc' },
    });
    return rows.map(toObject);
  }

  async recentObjects(
    conversationId: string,
    excludingTurnId: string,
    limit: number,
  ): Promise<readonly PersistedSemanticObject[]> {
    const rows = await this.prisma.semanticObject.findMany({
      where: { conversationId, turnId: { not: excludingTurnId }, resolution: { status: 'SUCCESS' } },
      orderBy: [{ createdAt: 'desc' }, { objectId: 'asc' }],
      take: limit,
    });
    return rows.map(toObject);
  }
}

function toDomain(row: Row): SemanticResolutionRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    idempotencyKey: row.idempotencyKey,
    conversationId: row.conversationId,
    turnId: row.turnId,
    runId: row.runId,
    contextSnapshotId: row.contextSnapshotId,
    understandingRevision: row.understandingRevision,
    componentVersion: row.componentVersion,
    promptId: row.promptId,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    policyVersion: row.policyVersion,
    status: row.status,
    resolutionStatus: row.resolutionStatus,
    resolution: (row.resolution as Record<string, unknown> | null) ?? null,
    objectCount: row.objectCount,
    canonicalForms: row.canonicalForms,
    entityTypes: row.entityTypes,
    clarificationRequired: row.clarificationRequired,
    promptExecutionId: row.promptExecutionId,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    latencyMs: row.latencyMs,
    error: (row.error as { code: string; message: string } | null) ?? null,
    createdAt: row.createdAt,
  };
}

function toObject(row: ObjectRow): PersistedSemanticObject {
  const wire = row.object as Record<string, unknown>;
  const origin = (wire.semantic_origin ?? {}) as Partial<SemanticOrigin>;
  return {
    id: row.id,
    resolutionId: row.resolutionId,
    requestId: row.requestId,
    conversationId: row.conversationId,
    turnId: row.turnId,
    objectId: row.objectId,
    surfaceForm: row.surfaceForm,
    canonicalForm: row.canonicalForm,
    entityType: row.entityType,
    brand: row.brand,
    model: row.productModel,
    semanticOrigin: {
      phrase: row.phrase,
      concept: row.concept,
      market_concept_id: row.marketConceptId,
      concept_status: row.conceptStatus === 'KNOWN' ? 'KNOWN' : 'PROPOSED',
      relationship: 'EXPRESSES',
      origin: 'CSRE',
      request_id: origin.request_id ?? row.requestId,
      semantic_confidence: row.semanticConfidence,
    },
    commercialRelevance: row.commercialRelevance,
    commercialOffering: row.commercialOffering,
    semanticConfidence: row.semanticConfidence,
    commercialConfidence: row.commercialConfidence,
    ambiguityPresent: row.ambiguityPresent,
    object: wire,
    createdAt: row.createdAt,
  };
}
