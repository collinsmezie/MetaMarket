import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '../../../config/app-config.service';
import type {
  CapabilityBelief,
  CapabilityDomain,
  CapabilitySignal,
  EvidenceObject,
  EvidenceSource,
  InformationDensity,
} from '../../../domain/models/capability';
import type { NormalizedLocation, Vendor, VendorProfile, VendorStatus } from '../../../domain/models/vendor';
import type {
  CreateVendorInput,
  VendorMutation,
  VendorRepositoryPort,
  VendorSimilarityMatch,
} from '../../../domain/ports/outbound/vendor-repository.port';
import { PrismaService } from './prisma.service';

type VendorRow = Prisma.VendorGetPayload<Record<string, never>>;

@Injectable()
export class PrismaVendorRepository implements VendorRepositoryPort {
  private readonly embeddingDimension: number;

  constructor(
    private readonly prisma: PrismaService,
    config: AppConfigService,
  ) {
    this.embeddingDimension = config.embeddingDimension;
  }

  async create(input: CreateVendorInput): Promise<Vendor> {
    const row = await this.prisma.vendor.create({
      data: {
        id: input.id,
        userId: input.userId,
        conversationId: input.conversationId,
        businessName: input.businessName,
        city: input.location?.city ?? null,
        state: input.location?.state ?? null,
        country: input.location?.country ?? null,
        locationConfidence: input.location?.confidence ?? null,
        latitude: input.location?.latitude ?? null,
        longitude: input.location?.longitude ?? null,
        conversationSummary: input.conversationSummary,
      },
    });

    return this.toDomain(row);
  }

  async findById(vendorId: string): Promise<Vendor | null> {
    const row = await this.prisma.vendor.findUnique({ where: { id: vendorId } });
    return row === null ? null : this.toDomain(row);
  }

  async findByUserId(userId: string): Promise<Vendor | null> {
    const row = await this.prisma.vendor.findUnique({ where: { userId } });
    return row === null ? null : this.toDomain(row);
  }

  async update(vendorId: string, mutation: VendorMutation): Promise<Vendor> {
    const data: Prisma.VendorUpdateInput = {
      ...(mutation.businessName !== undefined ? { businessName: mutation.businessName } : {}),
      ...(mutation.status !== undefined ? { status: mutation.status } : {}),
      ...(mutation.conversationSummary !== undefined
        ? { conversationSummary: mutation.conversationSummary }
        : {}),
      ...(mutation.declaredProducts !== undefined
        ? { declaredProducts: [...mutation.declaredProducts] }
        : {}),
      ...(mutation.declaredServices !== undefined
        ? { declaredServices: [...mutation.declaredServices] }
        : {}),
      ...(mutation.brands !== undefined ? { brands: [...mutation.brands] } : {}),
      ...(mutation.onboardedAt !== undefined ? { onboardedAt: mutation.onboardedAt } : {}),
      ...(mutation.location !== undefined
        ? {
            city: mutation.location?.city ?? null,
            state: mutation.location?.state ?? null,
            country: mutation.location?.country ?? null,
            locationConfidence: mutation.location?.confidence ?? null,
            latitude: mutation.location?.latitude ?? null,
            longitude: mutation.location?.longitude ?? null,
          }
        : {}),
    };

    const row = await this.prisma.vendor.update({ where: { id: vendorId }, data });

    if (mutation.dnaEmbedding !== undefined) {
      await this.writeDnaEmbedding(vendorId, mutation.dnaEmbedding);
    }

    return this.toDomain(row);
  }

  async loadProfile(vendorId: string): Promise<VendorProfile | null> {
    const row = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: { capabilities: { orderBy: { confidence: 'desc' } } },
    });

    if (row === null) return null;

    return this.toProfile(row, row.capabilities);
  }

  async appendEvidence(evidence: readonly EvidenceObject[]): Promise<void> {
    if (evidence.length === 0) return;

    await this.prisma.capabilityEvidence.createMany({
      data: evidence.map((item) => ({
        id: item.id,
        vendorId: item.vendorId,
        source: item.source,
        originalText: item.originalText,
        normalizedMeaning: item.normalizedMeaning,
        informationDensity: item.informationDensity,
        supports: item.supports as unknown as Prisma.InputJsonValue,
        reasoning: item.reasoning,
        conversationId: item.conversationId ?? null,
        workflowId: item.workflowId ?? null,
        observedAt: item.observedAt,
      })),
      // A retried turn can re-submit evidence it already recorded; that is not a new
      // observation and must not be counted twice.
      skipDuplicates: true,
    });
  }

  async loadEvidence(vendorId: string): Promise<readonly EvidenceObject[]> {
    const rows = await this.prisma.capabilityEvidence.findMany({
      where: { vendorId },
      orderBy: { observedAt: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      vendorId: row.vendorId,
      source: row.source as EvidenceSource,
      observedAt: row.observedAt,
      originalText: row.originalText,
      normalizedMeaning: row.normalizedMeaning,
      informationDensity: row.informationDensity as InformationDensity,
      supports: row.supports as unknown as readonly CapabilitySignal[],
      reasoning: row.reasoning,
      ...(row.conversationId !== null ? { conversationId: row.conversationId } : {}),
      ...(row.workflowId !== null ? { workflowId: row.workflowId } : {}),
    }));
  }

  /**
   * Replaces the materialised beliefs in one transaction.
   *
   * Delete-then-insert rather than upsert: a capability whose supporting evidence no longer
   * implies it must disappear, and an upsert would leave it behind at a stale confidence.
   */
  async replaceBeliefs(vendorId: string, beliefs: readonly CapabilityBelief[]): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.vendorCapability.deleteMany({ where: { vendorId } }),
      ...(beliefs.length === 0
        ? []
        : [
            this.prisma.vendorCapability.createMany({
              data: beliefs.map((belief) => ({
                vendorId,
                capabilityDomain: belief.capability.domain,
                capabilityId: belief.capability.id,
                capabilityName: belief.capability.name,
                logOdds: belief.logOdds,
                confidence: belief.confidence,
                evidenceCount: belief.evidenceCount,
                inferred: belief.inferred,
                lastObservedAt: belief.lastObservedAt,
              })),
            }),
          ]),
    ]);
  }

  async findByCapability(params: {
    capabilityId: string;
    minConfidence: number;
    limit: number;
  }): Promise<readonly VendorProfile[]> {
    const matches = await this.prisma.vendorCapability.findMany({
      where: { capabilityId: params.capabilityId, confidence: { gte: params.minConfidence } },
      orderBy: { confidence: 'desc' },
      take: params.limit,
      include: { vendor: { include: { capabilities: { orderBy: { confidence: 'desc' } } } } },
    });

    return matches.map((match) => this.toProfile(match.vendor, match.vendor.capabilities));
  }

  async findSimilarByDna(params: {
    embedding: readonly number[];
    limit: number;
    minSimilarity: number;
  }): Promise<readonly VendorSimilarityMatch[]> {
    this.assertDimension(params.embedding);

    const literal = `[${params.embedding.join(',')}]`;
    const maxDistance = 1 - params.minSimilarity;

    const rows = await this.prisma.$queryRaw<{ id: string; distance: number }[]>`
      SELECT id, (dna_embedding <=> ${literal}::vector) AS distance
      FROM vendors
      WHERE dna_embedding IS NOT NULL
        AND status = 'active'
        AND (dna_embedding <=> ${literal}::vector) <= ${maxDistance}
      ORDER BY dna_embedding <=> ${literal}::vector
      LIMIT ${params.limit}
    `;

    return rows.map((row) => ({ vendorId: row.id, similarity: 1 - Number(row.distance) }));
  }

  private async writeDnaEmbedding(vendorId: string, embedding: readonly number[] | null): Promise<void> {
    if (embedding === null) {
      await this.prisma.$executeRaw`
        UPDATE vendors SET dna_embedding = NULL WHERE id = ${vendorId}::uuid
      `;
      return;
    }

    this.assertDimension(embedding);

    await this.prisma.$executeRaw`
      UPDATE vendors SET dna_embedding = ${`[${embedding.join(',')}]`}::vector
      WHERE id = ${vendorId}::uuid
    `;
  }

  private assertDimension(embedding: readonly number[]): void {
    if (embedding.length !== this.embeddingDimension) {
      throw new Error(
        `Vendor DNA embedding has ${embedding.length} dimensions but the schema expects ${this.embeddingDimension}.`,
      );
    }
  }

  private toProfile(
    row: VendorRow,
    capabilities: readonly {
      capabilityDomain: string;
      capabilityId: string;
      capabilityName: string;
      logOdds: number;
      confidence: number;
      evidenceCount: number;
      inferred: boolean;
      lastObservedAt: Date;
    }[],
  ): VendorProfile {
    return {
      vendor: this.toDomain(row),
      dna: {
        vendorId: row.id,
        beliefs: capabilities.map((capability) => ({
          capability: {
            domain: capability.capabilityDomain as CapabilityDomain,
            id: capability.capabilityId,
            name: capability.capabilityName,
          },
          logOdds: capability.logOdds,
          confidence: capability.confidence,
          evidenceCount: capability.evidenceCount,
          lastObservedAt: capability.lastObservedAt,
          inferred: capability.inferred,
        })),
        declaredProducts: row.declaredProducts,
        declaredServices: row.declaredServices,
        brands: row.brands,
        summary: row.conversationSummary,
        evidenceCount: capabilities.reduce((total, capability) => total + capability.evidenceCount, 0),
        updatedAt: row.updatedAt,
      },
    };
  }

  private toDomain(row: VendorRow): Vendor {
    const location: NormalizedLocation | null =
      row.city !== null && row.state !== null
        ? {
            city: row.city,
            state: row.state,
            country: row.country ?? 'Nigeria',
            confidence: row.locationConfidence ?? 1,
            ...(row.latitude !== null ? { latitude: row.latitude } : {}),
            ...(row.longitude !== null ? { longitude: row.longitude } : {}),
          }
        : null;

    return {
      id: row.id,
      userId: row.userId,
      conversationId: row.conversationId,
      businessName: row.businessName,
      location,
      status: row.status as VendorStatus,
      conversationSummary: row.conversationSummary,
      onboardedAt: row.onboardedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
