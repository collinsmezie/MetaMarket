import { Module, type OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { WrsController } from './adapters/http/wrs.controller';
import { PrismaWrsRepository } from './adapters/persistence/prisma-wrs.repository';
import {
  TavilySearchProvider,
  UnavailableSearchProvider,
} from './adapters/search/tavily-search-provider.adapter';
import { WrsService } from './application/wrs.service';
import { SEARCH_PROVIDER } from './ports/search-provider.port';
import { WEB_RETRIEVAL } from './ports/web-retrieval.port';
import { WRS_REPOSITORY } from './ports/wrs.repository.port';

/**
 * Web Retrieval System v4.4 (component module). The search provider is selected once from
 * configuration (`WRS_SEARCH_PROVIDER`, final lock Q5): `tavily` needs `TAVILY_API_KEY`; without
 * a usable provider WRS stays wired but reports `WRS_PROVIDER_UNAVAILABLE` so consumers skip the
 * evidence path honestly. Consumers (CSRE, Enrichment, …) own their adapters onto `WEB_RETRIEVAL`.
 */
@Module({
  controllers: [WrsController],
  providers: [
    // Constructed explicitly so the adapter's optional `fetch` parameter stays a plain default.
    {
      provide: TavilySearchProvider,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new TavilySearchProvider(config),
    },
    UnavailableSearchProvider,
    {
      provide: SEARCH_PROVIDER,
      inject: [AppConfigService, TavilySearchProvider, UnavailableSearchProvider],
      useFactory: (
        config: AppConfigService,
        tavily: TavilySearchProvider,
        none: UnavailableSearchProvider,
      ) => (config.wrs.provider === 'tavily' ? tavily : none),
    },
    { provide: WRS_REPOSITORY, useClass: PrismaWrsRepository },
    WrsService,
    { provide: WEB_RETRIEVAL, useExisting: WrsService },
  ],
  exports: [WEB_RETRIEVAL, WRS_REPOSITORY, SEARCH_PROVIDER, WrsService],
})
export class RetrievalModule implements OnModuleInit {
  constructor(private readonly wrs: WrsService) {}

  onModuleInit(): void {
    this.wrs.register();
  }
}
