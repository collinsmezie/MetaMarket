import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../adapters/outbound/persistence/prisma.service';
import { MKG_PREDICATES } from '../domain/mkg-vocabulary';
import { MKG_WRITE_PORT, type MkgWritePort } from '../ports/mkg-write.port';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '_')
    .replace(/^-+|-+$/g, '');
}

/**
 * Capability Projection Engine (Phase 10; Overarching TDR §15, MKG TDR §8.4, §20).
 *
 * Converts vendor-originated claims, onboarding data, and capability records into
 * durable MKG graph representations:
 *
 *   Actor(vendorId) ──mkg:SUPPLIES──> MarketConcept(declared_product)
 *   Actor(vendorId) ──mkg:SUPPLIES──> GpcBrick(brick_code)
 *   Actor(vendorId) ──mkg:LOCATED_IN──> Context(city)
 *
 * Non-negotiable invariant:
 * - Direct capability requires vendor onboarding/fulfillment evidence.
 * - Demand never creates supply.
 */
@Injectable()
export class CapabilityProjectionService {
  private readonly logger = new Logger(CapabilityProjectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MKG_WRITE_PORT) private readonly mkgWrite: MkgWritePort,
  ) {}

  /**
   * Projects a single vendor and their capabilities into MKG.
   */
  async projectVendor(vendorId: string): Promise<{ projectedEdges: number }> {
    const vendor = await this.prisma.vendor.findUnique({
      where: { id: vendorId },
      include: { capabilities: true },
    });

    if (!vendor) {
      this.logger.warn(`[projectVendor] Vendor ${vendorId} not found`);
      return { projectedEdges: 0 };
    }

    const actorId = `actor:vendor:${vendor.id}`;
    const vendorLabel = vendor.businessName || vendor.contactPhone || `Vendor ${vendor.id.slice(0, 8)}`;

    // 1. Upsert Actor Node
    await this.mkgWrite.upsertNode({
      id: actorId,
      nodeType: 'ACTOR',
      label: vendorLabel,
      description: vendor.conversationSummary ?? undefined,
      properties: {
        vendorId: vendor.id,
        businessName: vendor.businessName,
        contactPhone: vendor.contactPhone,
        city: vendor.city,
        state: vendor.state,
        country: vendor.country ?? 'Nigeria',
      },
    });

    let edgeCount = 0;

    // 2. Project Location Edge
    if (vendor.city) {
      const locationId = `context:location:${slugify(vendor.city)}`;
      await this.mkgWrite.upsertNode({
        id: locationId,
        nodeType: 'CONTEXT',
        label: vendor.city,
        properties: { type: 'city', state: vendor.state },
      });

      await this.mkgWrite.applyGraphChange({
        decisionId: `proj_loc_${vendor.id}`,
        operation: 'ADD',
        subjectId: actorId,
        predicate: MKG_PREDICATES.LOCATED_IN,
        objectId: locationId,
        beliefScore: 1.0,
        policyVersion: '1.0',
        locality: vendor.city,
      });
      edgeCount++;
    }

    // 3. Project Declared Products
    const declared = vendor.declaredProducts ?? [];
    for (const prod of declared) {
      const prodSlug = slugify(prod);
      if (!prodSlug) continue;

      const conceptId = `concept:${prodSlug}`;
      await this.mkgWrite.upsertNode({
        id: conceptId,
        nodeType: 'CONCEPT',
        label: prod,
      });

      await this.mkgWrite.applyGraphChange({
        decisionId: `proj_prod_${vendor.id}_${prodSlug}`,
        operation: 'ADD',
        subjectId: actorId,
        predicate: MKG_PREDICATES.SUPPLIES,
        objectId: conceptId,
        beliefScore: 0.95,
        policyVersion: '1.0',
        locality: vendor.city ?? undefined,
      });
      edgeCount++;
    }

    // 4. Project Resolved GPC Capabilities
    for (const cap of vendor.capabilities) {
      const brickId = `gpc:brick:${cap.capabilityId}`;
      await this.mkgWrite.upsertNode({
        id: brickId,
        nodeType: 'GPC_BRICK',
        label: cap.capabilityName,
        properties: { domain: cap.capabilityDomain, code: cap.capabilityId },
      });

      await this.mkgWrite.applyGraphChange({
        decisionId: `proj_cap_${vendor.id}_${cap.capabilityId}`,
        operation: 'ADD',
        subjectId: actorId,
        predicate: MKG_PREDICATES.SUPPLIES,
        objectId: brickId,
        beliefScore: cap.confidence ?? 0.85,
        policyVersion: '1.0',
        locality: vendor.city ?? undefined,
      });
      edgeCount++;
    }

    this.logger.log(
      `[projectVendor] Projected vendor ${vendorLabel} (${vendor.id}) into MKG with ${edgeCount} edges`,
    );

    return { projectedEdges: edgeCount };
  }

  /**
   * Projects all vendors currently in the database into MKG.
   */
  async projectAllVendors(): Promise<{ totalVendors: number; totalEdges: number }> {
    const vendors = await this.prisma.vendor.findMany({ select: { id: true } });
    let totalEdges = 0;

    for (const v of vendors) {
      const res = await this.projectVendor(v.id);
      totalEdges += res.projectedEdges;
    }

    this.logger.log(
      `[projectAllVendors] Finished projecting ${vendors.length} vendors with ${totalEdges} total edges into MKG`,
    );

    return { totalVendors: vendors.length, totalEdges };
  }
}
