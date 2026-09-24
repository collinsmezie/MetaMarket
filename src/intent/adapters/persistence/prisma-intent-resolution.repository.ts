import { Injectable } from '@nestjs/common';
import { Prisma, type IntentResolution as Row } from '@prisma/client';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import { toCamelCaseKeys } from '../../../platform/contracts/wire-casing';
import type { IDCEResolution, IntentContextRecord } from '../../domain/idce-resolution';
import type {
  IntentResolutionRecord,
  IntentResolutionRepositoryPort,
  NewIntentResolutionRecord,
} from '../../ports/intent-resolution.repository.port';

@Injectable()
export class PrismaIntentResolutionRepository implements IntentResolutionRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async save(record: NewIntentResolutionRecord): Promise<IntentResolutionRecord> {
    const row = await this.prisma.intentResolution.create({
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
        primaryIntentType: record.primaryIntentType,
        intentTypes: [...record.intentTypes],
        clarificationRequired: record.clarificationRequired,
        promptExecutionId: record.promptExecutionId,
        modelProvider: record.modelProvider,
        modelName: record.modelName,
        latencyMs: record.latencyMs,
        error: record.error === null ? Prisma.JsonNull : record.error,
      },
    });
    return toDomain(row);
  }

  async findByIdempotencyKey(key: string): Promise<IntentResolutionRecord | null> {
    const row = await this.prisma.intentResolution.findUnique({ where: { idempotencyKey: key } });
    return row === null ? null : toDomain(row);
  }

  async findByRequestId(requestId: string): Promise<IntentResolutionRecord | null> {
    const row = await this.prisma.intentResolution.findUnique({ where: { requestId } });
    return row === null ? null : toDomain(row);
  }

  async findByTurnId(turnId: string): Promise<readonly IntentResolutionRecord[]> {
    const rows = await this.prisma.intentResolution.findMany({
      where: { turnId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }

  async priorIntentState(
    conversationId: string,
    excludingTurnId: string,
    limit: number,
  ): Promise<readonly IntentContextRecord[]> {
    const rows = await this.prisma.intentResolution.findMany({
      where: { conversationId, status: 'SUCCESS', turnId: { not: excludingTurnId } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    const records: IntentContextRecord[] = [];
    for (const row of rows) {
      const resolution = row.resolution as { intents?: Array<Record<string, unknown>> } | null;
      for (const intent of resolution?.intents ?? []) {
        const scope = (intent.scope ?? {}) as { object_ids?: string[] };
        records.push({
          turnId: row.turnId,
          intentId: String(intent.intent_id),
          type: String(intent.type),
          status: String(intent.status),
          objectIds: scope.object_ids ?? [],
        });
      }
    }
    return records;
  }

  async latestResolutionForTurn(turnId: string): Promise<IDCEResolution | null> {
    const row = await this.prisma.intentResolution.findFirst({
      where: { turnId, status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
    });
    if (row === null || row.resolution === null) return null;
    return toCamelCaseKeys<IDCEResolution>(row.resolution);
  }
}

function toDomain(row: Row): IntentResolutionRecord {
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
    primaryIntentType: row.primaryIntentType,
    intentTypes: row.intentTypes,
    clarificationRequired: row.clarificationRequired,
    promptExecutionId: row.promptExecutionId,
    modelProvider: row.modelProvider,
    modelName: row.modelName,
    latencyMs: row.latencyMs,
    error: (row.error as { code: string; message: string } | null) ?? null,
    createdAt: row.createdAt,
  };
}
