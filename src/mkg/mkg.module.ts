import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../adapters/outbound/persistence/prisma.service';
import { MKG_READ } from '../enrichment/ports/mkg-read.port';
import {
  EVENT_HANDLER_REGISTRY,
  type EventHandlerRegistry,
} from '../platform/events/domain-event';
import { PlatformModule } from '../platform/platform.module';
import { MkgGraphChangeHandler } from './adapters/events/mkg-graph-change.handler';
import { PrismaMkgAdapter } from './adapters/persistence/prisma-mkg.adapter';
import { CapabilityProjectionService } from './application/capability-projection.service';
import { MkgService } from './application/mkg.service';
import { MKG_READ_PORT } from './ports/mkg-read.port';
import { MKG_WRITE_PORT } from './ports/mkg-write.port';

/**
 * Market Knowledge Graph (MKG) v1.1 Standalone Module (Phase 9 & 10).
 *
 * Owns the marketplace's proprietary memory of commercial relationships:
 * - Stored in PostgreSQL 16 native triplestore (`mkg_nodes` and `mkg_edges`).
 * - Read-side: multi-hop traversal with cycle protection, belief thresholds, and derivation typing.
 * - Write-side: consumes `PlatformEvents.GraphChangeDecided` from Evidence System with strict idempotency.
 * - Non-negotiable invariant: buyer demand never creates vendor inventory; GPC hierarchy is sovereign and immutable.
 */
@Module({
  imports: [PlatformModule],
  providers: [
    PrismaService,
    PrismaMkgAdapter,
    { provide: MKG_READ_PORT, useExisting: PrismaMkgAdapter },
    { provide: MKG_WRITE_PORT, useExisting: PrismaMkgAdapter },
    { provide: MKG_READ, useExisting: PrismaMkgAdapter },
    MkgService,
    MkgGraphChangeHandler,
    CapabilityProjectionService,
  ],
  exports: [
    MkgService,
    MKG_READ_PORT,
    MKG_WRITE_PORT,
    MKG_READ,
    PrismaMkgAdapter,
    CapabilityProjectionService,
  ],
})
export class MkgModule implements OnModuleInit {
  constructor(
    private readonly graphChangeHandler: MkgGraphChangeHandler,
    @Inject(EVENT_HANDLER_REGISTRY) private readonly handlers: EventHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.handlers.register(this.graphChangeHandler);
  }
}
