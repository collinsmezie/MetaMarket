import { Injectable } from '@nestjs/common';
import { Prisma, type WrsEvidence as EvidenceRow, type WrsRetrieval as Row } from '@prisma/client';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import type { WrsInvocationStatus } from '../../domain/wrs-evidence';
import type {
  NewWrsRetrievalRecord,
  WrsEvidenceRecord,
  WrsRepositoryPort,
  WrsRetrievalRecord,
} from '../../ports/wrs.repository.port';

type Wire = Record<string, unknown>;

@Injectable()
export class PrismaWrsRepository implements WrsRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(record: NewWrsRetrievalRecord) {
    const evidence = ((record.response?.evidence as Wire[] | undefined) ?? []).map((item) => ({
      requestId: record.requestId,
      evidenceId: String(item.evidence_id),
      consumerComponent: record.consumerComponent,
      claim: String(item.claim),
      kind: String(item.kind),
      supports: Array.isArray(item.supports) ? (item.supports as unknown[]).map(String) : [],
      contradicts: Array.isArray(item.contradicts) ? (item.contradicts as unknown[]).map(String) : [],
      relationshipTarget:
        item.relationship_target === null || item.relationship_target === undefined
          ? Prisma.JsonNull
          : (item.relationship_target as Prisma.InputJsonValue),
      sourceId: String(item.source_id),
      sourceUrl: (item.source_url as string | null) ?? null,
      sourceTitle: (item.source_title as string | null) ?? null,
      sourceType: String(item.source_type),
      geographicRelevance: String(item.geographic_relevance),
      temporalRelevance: String(item.temporal_relevance),
      quality: String(item.quality),
      confidence: Number(item.confidence ?? 0),
      evidence: item as Prisma.InputJsonValue,
    }));
    const row = await this.prisma.wrsRetrieval.create({
      data: {
        requestId: record.requestId,
        conversationId: record.conversationId,
        turnId: record.turnId,
        runId: record.runId,
        consumerComponent: record.consumerComponent,
        consumerVersion: record.consumerVersion,
        consumerPurpose: record.consumerPurpose,
        question: record.question,
        request: record.request === null ? Prisma.JsonNull : (record.request as Prisma.InputJsonValue),
        provider: record.provider,
        componentVersion: record.componentVersion,
        promptId: record.promptId,
        promptVersion: record.promptVersion,
        schemaVersion: record.schemaVersion,
        status: record.status,
        responseStatus: record.responseStatus,
        response: record.response === null ? Prisma.JsonNull : (record.response as Prisma.InputJsonValue),
        queries: [...record.queries],
        sourceCount: record.sourceCount,
        evidenceCount: record.evidenceCount,
        promptExecutionId: record.promptExecutionId,
        modelProvider: record.modelProvider,
        modelName: record.modelName,
        latencyMs: record.latencyMs,
        error: record.error === null ? Prisma.JsonNull : record.error,
        evidence: { create: evidence },
      },
      include: { evidence: { orderBy: { evidenceId: 'asc' } } },
    });
    return { retrieval: toDomain(row), evidence: row.evidence.map(toEvidence) };
  }

  async findByRequestId(requestId: string) {
    const row = await this.prisma.wrsRetrieval.findUnique({ where: { requestId } });
    return row === null ? null : toDomain(row);
  }

  async evidenceForRequest(requestId: string) {
    const rows = await this.prisma.wrsEvidence.findMany({
      where: { requestId },
      orderBy: { evidenceId: 'asc' },
    });
    return rows.map(toEvidence);
  }
}

function toDomain(row: Row): WrsRetrievalRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    conversationId: row.conversationId,
    turnId: row.turnId,
    runId: row.runId,
    consumerComponent: row.consumerComponent,
    consumerVersion: row.consumerVersion,
    consumerPurpose: row.consumerPurpose,
    question: row.question,
    request: (row.request as Wire | null) ?? null,
    provider: row.provider,
    componentVersion: row.componentVersion,
    promptId: row.promptId,
    promptVersion: row.promptVersion,
    schemaVersion: row.schemaVersion,
    status: row.status as WrsInvocationStatus,
    responseStatus: row.responseStatus,
    response: (row.response as Wire | null) ?? null,
    queries: row.queries,
    sourceCount: row.sourceCount,
    evidenceCount: row.evidenceCount,
    promptExecutionId: row.promptExecutionId,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    latencyMs: row.latencyMs,
    error: (row.error as { code: string; message: string } | null) ?? null,
    createdAt: row.createdAt,
  };
}

function toEvidence(row: EvidenceRow): WrsEvidenceRecord {
  return {
    id: row.id,
    retrievalId: row.retrievalId,
    requestId: row.requestId,
    evidenceId: row.evidenceId,
    consumerComponent: row.consumerComponent,
    claim: row.claim,
    kind: row.kind,
    supports: row.supports,
    contradicts: row.contradicts,
    relationshipTarget: (row.relationshipTarget as Wire | null) ?? null,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    sourceTitle: row.sourceTitle,
    sourceType: row.sourceType,
    geographicRelevance: row.geographicRelevance,
    temporalRelevance: row.temporalRelevance,
    quality: row.quality,
    confidence: row.confidence,
    evidence: row.evidence as Wire,
    createdAt: row.createdAt,
  };
}
