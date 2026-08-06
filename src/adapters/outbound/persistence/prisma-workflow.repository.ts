import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '../../../config/app-config.service';
import type {
  SemanticFingerprint,
  WorkflowInstance,
  WorkflowRegistry,
  WorkflowStatus,
} from '../../../domain/models/workflow-instance';
import { WORKFLOW_STATUSES } from '../../../domain/models/workflow-instance';
import type {
  CreateWorkflowInstanceInput,
  TransitionRecord,
  WorkflowMutation,
  WorkflowRepositoryPort,
  WorkflowSimilarityMatch,
} from '../../../domain/ports/outbound/workflow-repository.port';
import { PrismaService } from './prisma.service';

/**
 * PostgreSQL + pgvector persistence for workflow instances.
 *
 * Vector columns are `Unsupported` in Prisma, so embeddings are written and searched with
 * raw SQL. That raw SQL is confined to this file — callers work with plain number arrays.
 */
@Injectable()
export class PrismaWorkflowRepository implements WorkflowRepositoryPort {
  private readonly embeddingDimension: number;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfigService,
  ) {
    this.embeddingDimension = config.embeddingDimension;
  }

  async create(input: CreateWorkflowInstanceInput): Promise<WorkflowInstance> {
    const row = await this.prisma.workflowInstance.create({
      data: {
        id: input.id,
        conversationId: input.conversationId,
        workflowType: input.workflowType,
        currentState: input.initialState,
        status: 'active',
        summary: input.summary,
        semanticFingerprint: input.semanticFingerprint as unknown as Prisma.InputJsonValue,
        importantEntities: input.importantEntities as Prisma.InputJsonValue,
        data: input.data as Prisma.InputJsonValue,
        priority: input.priority,
        resumable: input.resumable,
        expiresAt: input.expiresAt,
      },
    });

    if (input.fingerprintEmbedding !== null) {
      await this.writeEmbedding(input.id, input.fingerprintEmbedding);
    }

    return this.toDomain(row);
  }

  async findById(workflowId: string): Promise<WorkflowInstance | null> {
    const row = await this.prisma.workflowInstance.findUnique({ where: { id: workflowId } });
    return row === null ? null : this.toDomain(row);
  }

  async loadRegistry(conversationId: string): Promise<WorkflowRegistry> {
    const [conversation, rows] = await Promise.all([
      this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { activeWorkflowId: true },
      }),
      this.prisma.workflowInstance.findMany({
        where: { conversationId },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return {
      activeWorkflowId: conversation?.activeWorkflowId ?? null,
      workflowInstances: rows.map((row) => this.toDomain(row)),
    };
  }

  /**
   * Applies a mutation and its audit record in one transaction.
   *
   * Splitting these would allow a crash to leave a state change with no explanation of how
   * the workflow got there, which is precisely what the audit trail exists to prevent.
   */
  async update(
    workflowId: string,
    mutation: WorkflowMutation,
    transition?: TransitionRecord,
  ): Promise<WorkflowInstance> {
    const data: Prisma.WorkflowInstanceUpdateInput = {
      ...(mutation.currentState !== undefined ? { currentState: mutation.currentState } : {}),
      ...(mutation.status !== undefined ? { status: mutation.status } : {}),
      ...(mutation.summary !== undefined ? { summary: mutation.summary } : {}),
      ...(mutation.semanticFingerprint !== undefined
        ? { semanticFingerprint: mutation.semanticFingerprint as unknown as Prisma.InputJsonValue }
        : {}),
      ...(mutation.importantEntities !== undefined
        ? { importantEntities: mutation.importantEntities as Prisma.InputJsonValue }
        : {}),
      ...(mutation.data !== undefined ? { data: mutation.data as Prisma.InputJsonValue } : {}),
      ...(mutation.expiresAt !== undefined ? { expiresAt: mutation.expiresAt } : {}),
    };

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.workflowInstance.update({ where: { id: workflowId }, data });

      if (transition !== undefined) {
        await tx.workflowTransition.create({
          data: {
            workflowId,
            fromState: transition.fromState,
            toState: transition.toState,
            trigger: transition.trigger,
            error: transition.error ?? null,
            at: transition.at,
          },
        });
      }

      return updated;
    });

    if (mutation.fingerprintEmbedding !== undefined) {
      await this.writeEmbedding(workflowId, mutation.fingerprintEmbedding);
    }

    return this.toDomain(row);
  }

  async setActiveWorkflow(conversationId: string, workflowId: string | null): Promise<void> {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { activeWorkflowId: workflowId },
    });
  }

  async listByStatus(conversationId: string, status: WorkflowStatus): Promise<readonly WorkflowInstance[]> {
    const rows = await this.prisma.workflowInstance.findMany({
      where: { conversationId, status },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((row) => this.toDomain(row));
  }

  /**
   * Workflows tracking a specific deterministic identifier (MCOS §15 Layer 2).
   *
   * Filters on the JSONB `important_entities` path so the match is exact rather than a
   * substring hit somewhere else in the document.
   */
  async findByImportantEntity(
    conversationId: string,
    key: string,
    value: string,
  ): Promise<readonly WorkflowInstance[]> {
    const rows = await this.prisma.workflowInstance.findMany({
      where: {
        conversationId,
        importantEntities: { path: [key], equals: value },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((row) => this.toDomain(row));
  }

  /**
   * Nearest workflows by fingerprint embedding (MCOS §15 Layer 5).
   *
   * `<=>` is pgvector's cosine *distance*, so similarity is 1 − distance. Ordering by the
   * raw operator is what allows the HNSW index to be used.
   */
  async findSimilarByEmbedding(params: {
    conversationId: string;
    embedding: readonly number[];
    limit: number;
    minSimilarity: number;
  }): Promise<readonly WorkflowSimilarityMatch[]> {
    this.assertDimension(params.embedding);

    const literal = this.toVectorLiteral(params.embedding);
    const maxDistance = 1 - params.minSimilarity;

    const rows = await this.prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT id, (fingerprint_embedding <=> ${literal}::vector) AS distance
      FROM workflow_instances
      WHERE conversation_id = ${params.conversationId}::uuid
        AND fingerprint_embedding IS NOT NULL
        AND status IN ('active', 'suspended')
        AND (fingerprint_embedding <=> ${literal}::vector) <= ${maxDistance}
      ORDER BY fingerprint_embedding <=> ${literal}::vector
      LIMIT ${params.limit}
    `;

    return rows.map((row) => ({ workflowId: row.id, similarity: 1 - Number(row.distance) }));
  }

  async findExpired(now: Date, limit: number): Promise<readonly WorkflowInstance[]> {
    const rows = await this.prisma.workflowInstance.findMany({
      where: {
        status: { in: ['active', 'suspended'] },
        expiresAt: { not: null, lte: now },
      },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });

    return rows.map((row) => this.toDomain(row));
  }

  async transitionHistory(workflowId: string): Promise<readonly TransitionRecord[]> {
    const rows = await this.prisma.workflowTransition.findMany({
      where: { workflowId },
      orderBy: { at: 'asc' },
    });

    return rows.map((row) => ({
      workflowId: row.workflowId,
      fromState: row.fromState,
      toState: row.toState,
      trigger: row.trigger,
      at: row.at,
      ...(row.error !== null ? { error: row.error } : {}),
    }));
  }

  private async writeEmbedding(workflowId: string, embedding: readonly number[] | null): Promise<void> {
    if (embedding === null) {
      await this.prisma.$executeRaw`
        UPDATE workflow_instances SET fingerprint_embedding = NULL WHERE id = ${workflowId}::uuid
      `;
      return;
    }

    this.assertDimension(embedding);

    await this.prisma.$executeRaw`
      UPDATE workflow_instances
      SET fingerprint_embedding = ${this.toVectorLiteral(embedding)}::vector
      WHERE id = ${workflowId}::uuid
    `;
  }

  /**
   * Catches a model/column dimension mismatch at the write, with a message that names the
   * cause. Postgres would otherwise reject it with an opaque cast error.
   */
  private assertDimension(embedding: readonly number[]): void {
    if (embedding.length !== this.embeddingDimension) {
      throw new Error(
        `Embedding has ${embedding.length} dimensions but the schema expects ${this.embeddingDimension}. ` +
          'Changing the embedding model requires a migration that alters the vector column.',
      );
    }
  }

  private toVectorLiteral(embedding: readonly number[]): string {
    return `[${embedding.join(',')}]`;
  }

  private toDomain(row: {
    id: string;
    conversationId: string;
    workflowType: string;
    currentState: string;
    status: string;
    summary: string;
    semanticFingerprint: Prisma.JsonValue;
    importantEntities: Prisma.JsonValue;
    data: Prisma.JsonValue;
    priority: number;
    resumable: boolean;
    createdAt: Date;
    updatedAt: Date;
    expiresAt: Date | null;
  }): WorkflowInstance {
    return {
      id: row.id,
      conversationId: row.conversationId,
      workflowType: row.workflowType,
      currentState: row.currentState,
      status: this.toStatus(row.status),
      summary: row.summary,
      semanticFingerprint: row.semanticFingerprint as unknown as SemanticFingerprint,
      importantEntities: (row.importantEntities ?? {}) as Record<string, string>,
      data: (row.data ?? {}) as Record<string, unknown>,
      priority: row.priority,
      resumable: row.resumable,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: row.expiresAt,
    };
  }

  private toStatus(value: string): WorkflowStatus {
    if (!(WORKFLOW_STATUSES as readonly string[]).includes(value)) {
      throw new Error(`Stored workflow status "${value}" is not a known status.`);
    }
    return value as WorkflowStatus;
  }
}
