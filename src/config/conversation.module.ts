import { Module } from '@nestjs/common';
import { WalletModule } from './wallet.module';
import { HealthController } from '../adapters/inbound/health/health.controller';
import { WhatsAppWebhookController } from '../adapters/inbound/whatsapp/whatsapp-webhook.controller';
import { MediaProcessingProcessor } from '../adapters/outbound/queue/media-processing.processor';
import { ConversationContextManager } from '../application/conversation/conversation-context.manager';
import { MediaProcessingService } from '../application/media/media-processing.service';
import { TaxonomySeeder } from '../application/taxonomy/taxonomy-seeder.service';
import { BusinessUnderstandingService } from '../application/capability/business-understanding.service';
import { CapabilityDiscoveryService } from '../application/capability/capability-discovery.service';
import { CapabilityResolver } from '../application/capability/capability-resolver.service';
import { OnboardingExtractionService } from '../application/capability/onboarding-extraction.service';
import { VendorOnboardingService } from '../application/capability/vendor-onboarding.service';
import { EvidenceProcessor } from '../application/evidence/evidence-processor.service';
import { EvidenceQueryService } from '../application/evidence/evidence-query.service';
import { DemandUnderstandingService } from '../application/matching/demand-understanding.service';
import { CapabilityMatchingService } from '../application/matching/capability-matching.service';
import { RequestDistributionService } from '../application/fulfilment/request-distribution.service';
import { VendorFanoutNotifier } from '../application/fulfilment/vendor-fanout-notifier.service';
import { VendorResponseHandler } from '../application/fulfilment/vendor-response-handler.service';
import { MessageIngestionService } from '../application/pipeline/message-ingestion.service';
import { TurnProcessor } from '../application/pipeline/turn-processor.service';
import { WORKFLOW_SERVICES } from '../application/pipeline/workflow-services';
import { ResponseComposer } from '../application/response/response-composer.service';
import { ConversationContinuityAnalyzer } from '../application/understanding/continuity-analyzer.service';
import { IntentResolutionService } from '../application/understanding/intent-resolution.service';
import { SemanticResolutionService } from '../application/understanding/semantic-resolution.service';
import { WorkflowExpirySweeper } from '../application/workflow/workflow-expiry.sweeper';
import { HANDLE_INCOMING_MESSAGE } from '../domain/ports/inbound/handle-incoming-message.port';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../domain/ports/outbound/embedding-provider.port';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../domain/ports/outbound/system.port';
import {
  WORKFLOW_REPOSITORY,
  type WorkflowRepositoryPort,
} from '../domain/ports/outbound/workflow-repository.port';
import { ConversationPolicyEngine } from '../domain/workflows/conversation-policy';
import { triageWorkflow } from '../domain/workflows/definitions/triage.workflow';
import { vendorOnboardingWorkflow } from '../domain/workflows/definitions/vendor-onboarding.workflow';
import { buyerSearchWorkflow } from '../domain/workflows/definitions/buyer-search.workflow';
import { creditRechargeWorkflow } from '../domain/workflows/definitions/credit-recharge.workflow';
import { WalletService } from '../application/wallet/wallet.service';
import { WorkflowEngine } from '../domain/workflows/workflow-engine';
import { WorkflowManager } from '../domain/workflows/workflow-manager';
import { WorkflowDefinitionRegistry } from '../domain/workflows/workflow-registry';
import { AppConfigService } from './app-config.service';

/**
 * The Conversation OS itself: understanding stages, workflow lifecycle, and the pipeline.
 *
 * Domain classes are plain constructors with no Nest decorators (ADR-001 keeps the core
 * framework-free), so they are assembled here with explicit factories.
 */
@Module({
  imports: [WalletModule],
  controllers: [WhatsAppWebhookController, HealthController],
  providers: [
    ConversationContextManager,
    MediaProcessingService,
    TaxonomySeeder,
    BusinessUnderstandingService,
    CapabilityResolver,
    CapabilityDiscoveryService,
    OnboardingExtractionService,
    VendorOnboardingService,
    EvidenceProcessor,
    EvidenceQueryService,
    DemandUnderstandingService,
    CapabilityMatchingService,
    RequestDistributionService,
    VendorFanoutNotifier,
    VendorResponseHandler,
    ResponseComposer,
    ConversationContinuityAnalyzer,
    SemanticResolutionService,
    TurnProcessor,
    MessageIngestionService,
    MediaProcessingProcessor,
    WorkflowExpirySweeper,

    {
      provide: WorkflowDefinitionRegistry,
      useFactory: () => {
        const registry = new WorkflowDefinitionRegistry();
        // Vendor Onboarding outranks Triage on the vendor_onboarding intent by policy
        // priority, so registering it is all that is needed to take over that flow.
        registry.register(vendorOnboardingWorkflow);
        registry.register(buyerSearchWorkflow);
        registry.register(creditRechargeWorkflow);
        registry.register(triageWorkflow);
        return registry;
      },
    },

    {
      // The prompt lists exactly the intents this deployment can route, so the model is
      // never asked to produce a label nothing can handle.
      provide: IntentResolutionService,
      inject: [LLM_PROVIDER_SERVICE, STAGE_LOGGER, WorkflowDefinitionRegistry],
      useFactory: (llm: LlmService, logger: StageLoggerPort, definitions: WorkflowDefinitionRegistry) => {
        const intents = [
          ...new Set(definitions.all().flatMap((definition) => definition.startingIntents)),
        ].filter((intent) => intent !== 'unknown');

        return new IntentResolutionService(llm, logger, intents);
      },
    },

    {
      provide: ConversationPolicyEngine,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        new ConversationPolicyEngine({
          defaultIdleExpiryMs: config.conversationPolicy.workflowIdleExpiryMs,
          maxSuspendedWorkflows: config.conversationPolicy.maxSuspendedWorkflows,
        }),
    },

    {
      provide: WorkflowManager,
      inject: [WorkflowDefinitionRegistry, WORKFLOW_REPOSITORY, STAGE_LOGGER, EMBEDDING_PROVIDER],
      useFactory: (
        definitions: WorkflowDefinitionRegistry,
        workflows: WorkflowRepositoryPort,
        logger: StageLoggerPort,
        embeddings: EmbeddingProviderPort,
      ) => new WorkflowManager(definitions, workflows, logger, embeddings),
    },

    {
      provide: WorkflowEngine,
      inject: [WorkflowDefinitionRegistry, WORKFLOW_REPOSITORY, CLOCK, ID_GENERATOR, STAGE_LOGGER],
      useFactory: (
        definitions: WorkflowDefinitionRegistry,
        workflows: WorkflowRepositoryPort,
        clock: ClockPort,
        ids: IdGeneratorPort,
        logger: StageLoggerPort,
      ) => new WorkflowEngine(definitions, workflows, clock, ids, logger),
    },

    {
      // The capabilities workflow state handlers may reach. Listing them in one place keeps
      // what a workflow can do explicit and reviewable.
      provide: WORKFLOW_SERVICES,
      inject: [
        OnboardingExtractionService,
        CapabilityDiscoveryService,
        VendorOnboardingService,
        CapabilityMatchingService,
        RequestDistributionService,
        WalletService,
      ],
      useFactory: (
        extraction: OnboardingExtractionService,
        discovery: CapabilityDiscoveryService,
        vendors: VendorOnboardingService,
        matching: CapabilityMatchingService,
        distribution: RequestDistributionService,
        wallet: WalletService,
      ) => ({ extraction, discovery, vendors, matching, distribution, wallet }),
    },

    { provide: HANDLE_INCOMING_MESSAGE, useExisting: MessageIngestionService },
  ],
  exports: [MessageIngestionService, HANDLE_INCOMING_MESSAGE, EvidenceQueryService],
})
export class ConversationModule {}
