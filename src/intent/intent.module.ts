import { Module, type OnModuleInit } from '@nestjs/common';
import { IdceController } from './adapters/http/idce.controller';
import { PrismaIntentResolutionRepository } from './adapters/persistence/prisma-intent-resolution.repository';
import { IdceSpecialistAdapter } from './application/idce-specialist.adapter';
import { IdceService } from './application/idce.service';
import { INTENT_DISCOVERY } from './ports/intent-discovery.port';
import { INTENT_RESOLUTION_REPOSITORY } from './ports/intent-resolution.repository.port';

/**
 * IDCE — Intent Discovery & Classification Engine v1.6 (component module).
 *
 * Owns intent resolution and its persistence. Depends only on the platform runtime (prompt
 * runtime, schema registry, traces, events) and exposes one inbound port plus the MCOS-side
 * specialist adapter. It never imports CSRE, taxonomy, matching or workflow code.
 */
@Module({
  controllers: [IdceController],
  providers: [
    { provide: INTENT_RESOLUTION_REPOSITORY, useClass: PrismaIntentResolutionRepository },
    IdceService,
    { provide: INTENT_DISCOVERY, useExisting: IdceService },
    IdceSpecialistAdapter,
  ],
  exports: [INTENT_DISCOVERY, INTENT_RESOLUTION_REPOSITORY, IdceSpecialistAdapter],
})
export class IntentModule implements OnModuleInit {
  constructor(private readonly idce: IdceService) {}

  onModuleInit(): void {
    this.idce.register();
  }
}
