import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../adapters/outbound/persistence/prisma.service';
import { MKG_PREDICATES } from '../../../mkg/domain/mkg-vocabulary';
import { MKG_READ_PORT, type MkgReadPort } from '../../../mkg/ports/mkg-read.port';
import type { MatchCandidate, StructuredDemand } from '../../domain/matching-models';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '_')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class MkgCandidateRetrievalAdapter {
  private readonly logger = new Logger(MkgCandidateRetrievalAdapter.name);

  constructor(
    @Inject(MKG_READ_PORT) private readonly mkgRead: MkgReadPort,
    private readonly prisma: PrismaService,
  ) {}

  async retrieveCandidates(demand: StructuredDemand): Promise<MatchCandidate[]> {
    const candidateMap = new Map<string, MatchCandidate>();

    // 1. Identify Target Concept ID in MKG
    let conceptId = demand.marketConceptId;
    if (!conceptId && demand.conceptLabel) {
      conceptId = `concept:${slugify(demand.conceptLabel)}`;
    }
    if (!conceptId && demand.query) {
      // Check if query or phrase expresses an existing concept in MKG
      const phraseId = `phrase:${slugify(demand.query)}`;
      const phraseNode = await this.mkgRead.getNode(phraseId);
      if (phraseNode) {
        // Find outgoing EXPRESSES edge
        const paths = await this.mkgRead.traverseGraph({
          startNodeId: phraseId,
          predicates: [MKG_PREDICATES.EXPRESSES, MKG_PREDICATES.HAS_ALIAS],
          direction: 'OUTGOING',
          maxDepth: 1,
        });
        if (paths.length > 0) {
          conceptId = paths[0].endNode.id;
        }
      }
      if (!conceptId) {
        conceptId = `concept:${slugify(demand.query)}`;
      }
    }

    const matchedConceptLabel = demand.conceptLabel || demand.query;

    // 2. Path A: Direct Suppliers in MKG (1-hop)
    if (conceptId) {
      const directSupplierEdges = await this.prisma.mkgEdge.findMany({
        where: {
          objectId: conceptId,
          predicate: MKG_PREDICATES.SUPPLIES,
          lifecycleState: { in: ['ACTIVE', 'REINFORCED'] },
        },
        include: { subject: true },
      });

      for (const edge of directSupplierEdges) {
        const vendorId = edge.subjectId.replace(/^actor:vendor:/, '').replace(/^actor:/, '');
        candidateMap.set(vendorId, {
          vendorId,
          businessName: edge.subject.label,
          matchedConcept: matchedConceptLabel,
          derivation: 'STORED_FACT',
          rawBelief: edge.beliefScore,
          pathDepth: 1,
          pathPredicate: edge.predicate,
          reasons: [`Directly supplies ${matchedConceptLabel}`],
          finalScore: 0,
        });
      }

      // Also check 2-hop Capability Context in MKG (Accessories & Substitutes)
      const capContext = await this.mkgRead.getCapabilityContext(conceptId);
      for (const relVendor of capContext.relatedVendors) {
        if (!candidateMap.has(relVendor.vendorId)) {
          candidateMap.set(relVendor.vendorId, {
            vendorId: relVendor.vendorId,
            businessName: relVendor.businessName,
            matchedConcept: matchedConceptLabel,
            derivation: 'GRAPH_DERIVED_INFERENCE',
            rawBelief: relVendor.beliefScore,
            pathDepth: relVendor.pathDepth,
            pathPredicate: relVendor.pathPredicate,
            reasons: [`Supplies related accessories or substitutes for ${matchedConceptLabel}`],
            finalScore: 0,
          });
        }
      }
    }

    // 3. Path B: GPC Backbone in MKG & VendorCapability Table
    if (demand.gpcCode) {
      const gpcBrickId = `gpc:brick:${demand.gpcCode}`;
      const gpcSupplierEdges = await this.prisma.mkgEdge.findMany({
        where: {
          objectId: gpcBrickId,
          predicate: MKG_PREDICATES.SUPPLIES,
          lifecycleState: { in: ['ACTIVE', 'REINFORCED'] },
        },
        include: { subject: true },
      });

      for (const edge of gpcSupplierEdges) {
        const vendorId = edge.subjectId.replace(/^actor:vendor:/, '').replace(/^actor:/, '');
        if (!candidateMap.has(vendorId)) {
          candidateMap.set(vendorId, {
            vendorId,
            businessName: edge.subject.label,
            matchedConcept: matchedConceptLabel,
            derivation: 'TAXONOMY_BACKBONE',
            rawBelief: edge.beliefScore,
            pathDepth: 1,
            pathPredicate: `GPC:${demand.gpcCode}`,
            reasons: [`Supplies GPC classification ${demand.gpcCode}`],
            finalScore: 0,
          });
        }
      }

      // Also query relational vendor_capabilities table as sovereign fallback
      const relationalCaps = await this.prisma.vendorCapability.findMany({
        where: { capabilityId: demand.gpcCode },
        include: { vendor: true },
      });

      for (const rc of relationalCaps) {
        if (!candidateMap.has(rc.vendorId)) {
          candidateMap.set(rc.vendorId, {
            vendorId: rc.vendorId,
            businessName: rc.vendor.businessName || rc.vendor.contactPhone || 'Vendor',
            matchedConcept: rc.capabilityName || matchedConceptLabel,
            derivation: 'TAXONOMY_BACKBONE',
            rawBelief: rc.confidence ?? 0.8,
            pathDepth: 1,
            pathPredicate: `GPC:${demand.gpcCode}`,
            reasons: [`Verified capability in ${rc.capabilityName}`],
            finalScore: 0,
          });
        }
      }
    }

    // 4. Path C: Lexical Fallback if candidate map is still empty
    if (candidateMap.size === 0 && demand.query) {
      const qWords = demand.query
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);

      if (qWords.length > 0) {
        const matchedVendors = await this.prisma.vendor.findMany({
          where: {
            OR: [
              ...qWords.map((w) => ({ businessName: { contains: w, mode: 'insensitive' as const } })),
              ...qWords.map((w) => ({ declaredProducts: { has: w } })),
            ],
          },
          take: 10,
        });

        for (const v of matchedVendors) {
          candidateMap.set(v.id, {
            vendorId: v.id,
            businessName: v.businessName || v.contactPhone || 'Vendor',
            matchedConcept: matchedConceptLabel,
            derivation: 'TAXONOMY_BACKBONE',
            rawBelief: 0.7,
            pathDepth: 1,
            reasons: [`Matches product or business profile for ${demand.query}`],
            finalScore: 0,
          });
        }
      }
    }

    // 5. Hydrate Vendor Details from Database
    const vendorIds = Array.from(candidateMap.keys());
    if (vendorIds.length > 0) {
      const vendorRows = await this.prisma.vendor.findMany({
        where: { id: { in: vendorIds } },
        select: {
          id: true,
          businessName: true,
          contactPhone: true,
          city: true,
          state: true,
          conversationSummary: true,
        },
      });

      for (const row of vendorRows) {
        const existing = candidateMap.get(row.id);
        if (existing) {
          candidateMap.set(row.id, {
            ...existing,
            businessName: row.businessName || existing.businessName,
            contactPhone: row.contactPhone,
            city: row.city,
            state: row.state,
            description: existing.description ?? row.conversationSummary ?? undefined,
          });
        }
      }
    }

    this.logger.debug(
      `[retrieveCandidates] Retrieved ${candidateMap.size} candidates for demand query="${demand.query}" concept="${matchedConceptLabel}"`,
    );

    return Array.from(candidateMap.values());
  }
}
