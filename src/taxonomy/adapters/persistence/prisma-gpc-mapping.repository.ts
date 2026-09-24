import { Injectable } from '@nestjs/common';
import { Prisma, type GpcMapping as MappingRow, type GpcResolution as Row } from '@prisma/client';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import type {
  GpcMappingRecord,
  GpcMappingRepositoryPort,
  GpcResolutionRecord,
  NewGpcMapping,
  NewGpcResolutionRecord,
} from '../../ports/gpc-mapping.repository.port';

@Injectable()
export class PrismaGpcMappingRepository implements GpcMappingRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(record: NewGpcResolutionRecord, mappings: readonly NewGpcMapping[]) {
    const row = await this.prisma.gpcResolution.create({
      data: {
        requestId: record.requestId,
        idempotencyKey: record.idempotencyKey,
        conversationId: record.conversationId,
        turnId: record.turnId,
        runId: record.runId,
        contextSnapshotId: record.contextSnapshotId,
        csreRequestId: record.csreRequestId,
        enrichmentRequestId: record.enrichmentRequestId,
        componentVersion: record.componentVersion,
        promptId: record.promptId,
        promptVersion: record.promptVersion,
        schemaVersion: record.schemaVersion,
        policyVersion: record.policyVersion,
        gpcVersion: record.gpcVersion,
        status: record.status,
        resolutionStatus: record.resolutionStatus,
        resolution:
          record.resolution === null ? Prisma.JsonNull : (record.resolution as Prisma.InputJsonValue),
        objectCount: record.objectCount,
        mappedCount: record.mappedCount,
        candidateCount: record.candidateCount,
        promptExecutionId: record.promptExecutionId,
        modelProvider: record.modelProvider,
        modelName: record.modelName,
        latencyMs: record.latencyMs,
        error: record.error === null ? Prisma.JsonNull : record.error,
        mappings: {
          create: mappings.map((entry) => {
            const wire = entry.mapping as Record<string, unknown>;
            const origin = (wire.semantic_origin ?? {}) as Record<string, unknown>;
            const mapping = (wire.mapping ?? {}) as Record<string, unknown>;
            return {
              requestId: record.requestId,
              csreRequestId: record.csreRequestId,
              enrichmentRequestId: record.enrichmentRequestId,
              semanticObjectId: entry.semanticObjectId,
              enrichmentProfileId: entry.enrichmentProfileId,
              conversationId: record.conversationId,
              turnId: record.turnId,
              objectId: entry.objectId,
              concept: String(origin.concept ?? ''),
              marketConceptId: (origin.market_concept_id as string | null) ?? null,
              entityType: entry.entityType,
              state: String(mapping.state),
              gpcCode: (mapping.gpc_code as string | null) ?? null,
              gpcLevel: (mapping.gpc_level as string | null) ?? null,
              gpcTitle: (mapping.gpc_title as string | null) ?? null,
              mappingConfidence: Number(mapping.mapping_confidence ?? 0),
              reasonCodes: Array.isArray(mapping.reason_codes)
                ? (mapping.reason_codes as unknown[]).map(String)
                : [],
              gpcVersion: String(mapping.gpc_version ?? record.gpcVersion),
              resolverVersion: String(mapping.resolver_version ?? record.componentVersion),
              candidateCodes: [...entry.candidateCodes],
              mapping: wire as Prisma.InputJsonValue,
            };
          }),
        },
      },
      include: { mappings: { orderBy: { objectId: 'asc' } } },
    });
    return { resolution: toDomain(row), mappings: row.mappings.map(toMapping) };
  }

  async findByIdempotencyKey(key: string): Promise<GpcResolutionRecord | null> {
    const row = await this.prisma.gpcResolution.findUnique({ where: { idempotencyKey: key } });
    return row === null ? null : toDomain(row);
  }

  async findByRequestId(requestId: string): Promise<GpcResolutionRecord | null> {
    const row = await this.prisma.gpcResolution.findUnique({ where: { requestId } });
    return row === null ? null : toDomain(row);
  }

  async mappingsForRequest(requestId: string): Promise<readonly GpcMappingRecord[]> {
    const rows = await this.prisma.gpcMapping.findMany({
      where: { requestId },
      orderBy: { objectId: 'asc' },
    });
    return rows.map(toMapping);
  }

  async latestMappingsForObjects(semanticObjectIds: readonly string[]): Promise<readonly GpcMappingRecord[]> {
    if (semanticObjectIds.length === 0) return [];
    const rows = await this.prisma.gpcMapping.findMany({
      where: { semanticObjectId: { in: [...semanticObjectIds] }, resolution: { status: 'SUCCESS' } },
      orderBy: { createdAt: 'desc' },
    });
    const latest = new Map<string, MappingRow>();
    for (const row of rows) {
      if (row.semanticObjectId !== null && !latest.has(row.semanticObjectId))
        latest.set(row.semanticObjectId, row);
    }
    return [...latest.values()].map(toMapping);
  }
}

function toDomain(row: Row): GpcResolutionRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    idempotencyKey: row.idempotencyKey,
    conversationId: row.conversationId,
    turnId: row.turnId,
    runId: row.runId,
    contextSnapshotId: row.contextSnapshotId,
    csreRequestId: row.csreRequestId,
    enrichmentRequestId: row.enrichmentRequestId,
    componentVersion: row.componentVersion,
    promptId: row.promptId,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    policyVersion: row.policyVersion,
    gpcVersion: row.gpcVersion,
    status: row.status,
    resolutionStatus: row.resolutionStatus,
    resolution: (row.resolution as Record<string, unknown> | null) ?? null,
    objectCount: row.objectCount,
    mappedCount: row.mappedCount,
    candidateCount: row.candidateCount,
    promptExecutionId: row.promptExecutionId,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    latencyMs: row.latencyMs,
    error: (row.error as { code: string; message: string } | null) ?? null,
    createdAt: row.createdAt,
  };
}

function toMapping(row: MappingRow): GpcMappingRecord {
  return {
    id: row.id,
    resolutionId: row.resolutionId,
    requestId: row.requestId,
    csreRequestId: row.csreRequestId,
    enrichmentRequestId: row.enrichmentRequestId,
    semanticObjectId: row.semanticObjectId,
    enrichmentProfileId: row.enrichmentProfileId,
    conversationId: row.conversationId,
    turnId: row.turnId,
    objectId: row.objectId,
    concept: row.concept,
    marketConceptId: row.marketConceptId,
    entityType: row.entityType,
    state: row.state,
    gpcCode: row.gpcCode,
    gpcLevel: row.gpcLevel,
    gpcTitle: row.gpcTitle,
    mappingConfidence: row.mappingConfidence,
    reasonCodes: row.reasonCodes,
    gpcVersion: row.gpcVersion,
    resolverVersion: row.resolverVersion,
    candidateCodes: row.candidateCodes,
    mapping: row.mapping as Record<string, unknown>,
    createdAt: row.createdAt,
  };
}
