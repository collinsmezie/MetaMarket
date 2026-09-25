import { Module } from '@nestjs/common';
import { PrismaService } from '../adapters/outbound/persistence/prisma.service';
import { MkgModule } from '../mkg/mkg.module';
import { PlatformModule } from '../platform/platform.module';
import { MkgCandidateRetrievalAdapter } from './adapters/retrieval/mkg-candidate-retrieval.adapter';
import { MatchingService } from './application/matching.service';
import { MATCHING_ENGINE } from './ports/matching-engine.port';

/**
 * Matching & Fanout Module (Phase 11; Overarching TDR §15.2, §30.5).
 *
 * Operational matching engine:
 * - Reads structured demand produced by CSRE + GPC Resolver.
 * - Queries MKG for direct capabilities and commercial accessory/substitute traversals.
 * - Computes deterministic composite score with inspectable feature contributions.
 * - Ranks and formats vendor cards for seamless customer delivery.
 */
@Module({
  imports: [MkgModule, PlatformModule],
  providers: [
    PrismaService,
    MkgCandidateRetrievalAdapter,
    MatchingService,
    { provide: MATCHING_ENGINE, useExisting: MatchingService },
  ],
  exports: [MatchingService, MATCHING_ENGINE],
})
export class MatchingModule {}
