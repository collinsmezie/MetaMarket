import { Module, type OnModuleInit } from '@nestjs/common';
import { EnrichmentModule } from '../enrichment/enrichment.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { SemanticsModule } from '../semantics/semantics.module';
import { GpcResolverController } from './adapters/http/gpc-resolver.controller';
import { EvidenceGpcKnowledge } from './adapters/knowledge/evidence-gpc-knowledge.adapter';
import { PrismaGpcMappingRepository } from './adapters/persistence/prisma-gpc-mapping.repository';
import { TaxonomyCandidateRetrievalAdapter } from './adapters/retrieval/taxonomy-candidate-retrieval.adapter';
import { GpcResolverAdapter } from './application/gpc-resolver.adapter';
import { GpcResolverService } from './application/gpc-resolver.service';
import { GPC_CANDIDATE_RETRIEVAL, GPC_KNOWLEDGE } from './ports/gpc-candidate-retrieval.port';
import { GPC_MAPPING_REPOSITORY } from './ports/gpc-mapping.repository.port';
import { GPC_RESOLUTION } from './ports/gpc-resolution.port';

/**
 * GPC Resolver v4.4 (component module): sovereign classification of CSRE MarketConcepts.
 * Candidate retrieval is owned here (over the installed taxonomy index); knowledge context is a
 * read-only port bound to a Noop until the Market Knowledge Graph exists.
 */
@Module({
  imports: [SemanticsModule, EnrichmentModule, EvidenceModule],
  controllers: [GpcResolverController],
  providers: [
    { provide: GPC_MAPPING_REPOSITORY, useClass: PrismaGpcMappingRepository },
    { provide: GPC_CANDIDATE_RETRIEVAL, useClass: TaxonomyCandidateRetrievalAdapter },
    { provide: GPC_KNOWLEDGE, useClass: EvidenceGpcKnowledge },
    GpcResolverService,
    { provide: GPC_RESOLUTION, useExisting: GpcResolverService },
    GpcResolverAdapter,
  ],
  exports: [GPC_RESOLUTION, GPC_MAPPING_REPOSITORY, GpcResolverAdapter],
})
export class GpcResolverModule implements OnModuleInit {
  constructor(private readonly gpc: GpcResolverService) {}

  onModuleInit(): void {
    this.gpc.register();
  }
}
