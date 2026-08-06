import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '../../../config/app-config.service';
import type {
  ServiceCapabilityMatch,
  ServiceCapabilityRecord,
  ServiceCapabilityRepositoryPort,
} from '../../../domain/ports/outbound/service-capability-repository.port';
import { PrismaService } from './prisma.service';

@Injectable()
export class PrismaServiceCapabilityRepository implements ServiceCapabilityRepositoryPort {
  private readonly embeddingDimension: number;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfigService,
  ) {
    this.embeddingDimension = config.embeddingDimension;
  }

  async findById(id: string): Promise<ServiceCapabilityRecord | null> {
    const row = await this.prisma.serviceCapability.findUnique({ where: { id } });
    return row === null ? null : this.toDomain(row);
  }

  async findSimilar(params: {
    embedding: readonly number[];
    limit: number;
    minSimilarity: number;
  }): Promise<readonly ServiceCapabilityMatch[]> {
    this.assertDimension(params.embedding);

    const literal = `[${params.embedding.join(',')}]`;
    const maxDistance = 1 - params.minSimilarity;

    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        canonical_name: string;
        description: string;
        aliases: string[];
        usage_count: number;
        distance: number;
      }[]
    >`
      SELECT id, canonical_name, description, aliases, usage_count,
             (embedding <=> ${literal}::vector) AS distance
      FROM service_capabilities
      WHERE embedding IS NOT NULL
        AND (embedding <=> ${literal}::vector) <= ${maxDistance}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${params.limit}
    `;

    return rows.map((row) => ({
      record: {
        id: row.id,
        canonicalName: row.canonical_name,
        description: row.description,
        aliases: row.aliases,
        usageCount: row.usage_count,
      },
      similarity: 1 - Number(row.distance),
    }));
  }

  /**
   * Registers a capability idempotently.
   *
   * Two vendors onboarding the same service simultaneously must converge on one registry
   * entry, so the slug's uniqueness — not a prior read — is what arbitrates.
   */
  async register(params: {
    id: string;
    canonicalName: string;
    description: string;
    embedding: readonly number[];
  }): Promise<ServiceCapabilityRecord> {
    this.assertDimension(params.embedding);

    const existing = await this.prisma.serviceCapability.findUnique({ where: { id: params.id } });

    if (existing !== null) {
      await this.prisma.serviceCapability.update({
        where: { id: params.id },
        data: { usageCount: { increment: 1 } },
      });
      return this.toDomain({ ...existing, usageCount: existing.usageCount + 1 });
    }

    try {
      const created = await this.prisma.serviceCapability.create({
        data: {
          id: params.id,
          canonicalName: params.canonicalName,
          description: params.description,
          usageCount: 1,
        },
      });

      await this.prisma.$executeRaw`
        UPDATE service_capabilities
        SET embedding = ${`[${params.embedding.join(',')}]`}::vector
        WHERE id = ${params.id}
      `;

      return this.toDomain(created);
    } catch (error) {
      // A concurrent registration won the race; adopt its entry rather than failing.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const row = await this.prisma.serviceCapability.update({
          where: { id: params.id },
          data: { usageCount: { increment: 1 } },
        });
        return this.toDomain(row);
      }
      throw error;
    }
  }

  async recordAlias(id: string, alias: string): Promise<void> {
    const row = await this.prisma.serviceCapability.findUnique({ where: { id } });
    if (row === null) return;

    const normalized = alias.trim().toLowerCase();
    if (normalized.length === 0) return;

    // Case-insensitive membership: the same phrasing in different casing is not a new alias.
    const known = row.aliases.some((existing) => existing.toLowerCase() === normalized);
    if (known || row.canonicalName.toLowerCase() === normalized) return;

    await this.prisma.serviceCapability.update({
      where: { id },
      data: { aliases: { push: alias.trim() } },
    });
  }

  async countAll(): Promise<number> {
    return this.prisma.serviceCapability.count();
  }

  private assertDimension(embedding: readonly number[]): void {
    if (embedding.length !== this.embeddingDimension) {
      throw new Error(
        `Service capability embedding has ${embedding.length} dimensions but the schema expects ${this.embeddingDimension}.`,
      );
    }
  }

  private toDomain(row: {
    id: string;
    canonicalName: string;
    description: string;
    aliases: string[];
    usageCount: number;
  }): ServiceCapabilityRecord {
    return {
      id: row.id,
      canonicalName: row.canonicalName,
      description: row.description,
      aliases: row.aliases,
      usageCount: row.usageCount,
    };
  }
}
