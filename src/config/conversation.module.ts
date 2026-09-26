import { forwardRef, Module } from '@nestjs/common';
import { ConversationRuntimeModule } from '../conversation/conversation-runtime.module';
import { WalletModule } from './wallet.module';
import { MatchingModule } from '../matching/matching.module';
import { MkgModule } from '../mkg/mkg.module';
import { HealthController } from '../adapters/inbound/health/health.controller';
import { WebChannelController } from '../adapters/inbound/web/web-channel.controller';
import { ConversationStreamService } from '../application/conversation/conversation-stream.service';
import { CONVERSATION_STREAM } from '../domain/ports/inbound/conversation-stream.port';
import { WhatsAppWebhookController } from '../adapters/inbound/whatsapp/whatsapp-webhook.controller';
import { MediaProcessingProcessor } from '../adapters/outbound/queue/media-processing.processor';
import { ConversationContextManager } from '../application/conversation/conversation-context.manager';
import { MediaProcessingService } from '../application/media/media-processing.service';
import { TaxonomySeeder } from '../application/taxonomy/taxonomy-seeder.service';
import { BusinessUnderstandingService } from '../application/capability/business-understanding.service';
import { CapabilityDiscoveryService } from '../application/capability/capability-discovery.service';
import { CapabilityPromotionSubscriber } from '../application/capability/capability-promotion.subscriber';
import { CapabilityResolver } from '../application/capability/capability-resolver.service';
import { OnboardingExtractionService } from '../application/capability/onboarding-extraction.service';
import { VendorOnboardingService } from '../application/capability/vendor-onboarding.service';
import { EvidenceProcessor } from '../application/evidence/evidence-processor.service';
import { EvidenceQueryService } from '../application/evidence/evidence-query.service';
import { CapabilityMatchingService } from '../application/matching/capability-matching.service';
import { RequestDistributionService } from '../application/fulfilment/request-distribution.service';
import { VendorFanoutNotifier } from '../application/fulfilment/vendor-fanout-notifier.service';
import { VendorResponseHandler } from '../application/fulfilment/vendor-response-handler.service';
import { MessageIngestionService } from '../application/pipeline/message-ingestion.service';
import { WORKFLOW_SERVICES } from '../application/pipeline/workflow-services';
import { ConversationDelivery } from '../application/response/conversation-delivery.service';
import { WorkflowExpirySweeper } from '../application/workflow/workflow-expiry.sweeper';
import { HANDLE_INCOMING_MESSAGE } from '../domain/ports/inbound/handle-incoming-message.port';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../domain/ports/outbound/embedding-provider.port';
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
import { platformInfoWorkflow } from '../domain/workflows/definitions/platform-info.workflow';
import { WalletService } from '../application/wallet/wallet.service';
import { WorkflowEngine } from '../domain/workflows/workflow-engine';
import { WorkflowManager } from '../domain/workflows/workflow-manager';
import { WorkflowDefinitionRegistry } from '../domain/workflows/workflow-registry';
import { AppConfigService } from './app-config.service';

/**
 * The Conversation OS itself: ingestion, business services, workflow lifecycle, delivery.
 * Understanding and orchestration live in the IDCE, CSRE and LangGraph orchestrator modules.
 *
 * Domain classes are plain constructors with no Nest decorators (ADR-001 keeps the core
 * framework-free), so they are assembled here with explicit factories.
 */
@Module({
  imports: [WalletModule, forwardRef(() => ConversationRuntimeModule), MatchingModule, MkgModule],
  controllers: [WhatsAppWebhookController, WebChannelController, HealthController],
  providers: [
    ConversationContextManager,
    MediaProcessingService,
    TaxonomySeeder,
    BusinessUnderstandingService,
    CapabilityResolver,
    CapabilityDiscoveryService,
    CapabilityPromotionSubscriber,
    ConversationStreamService,
    { provide: CONVERSATION_STREAM, useExisting: ConversationStreamService },
    OnboardingExtractionService,
    VendorOnboardingService,
    EvidenceProcessor,
    EvidenceQueryService,
    CapabilityMatchingService,
    RequestDistributionService,
    VendorFanoutNotifier,
    VendorResponseHandler,
    ConversationDelivery,
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
        // Answers questions about the platform itself. Without it a billing digression had no
        // owner, routing came back unroutable, and a direct question about money was answered
        // with a greeting.
        registry.register(platformInfoWorkflow);
        registry.register(triageWorkflow);
        return registry;
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
        AppConfigService,
      ],
      useFactory: (
        extraction: OnboardingExtractionService,
        discovery: CapabilityDiscoveryService,
        vendors: VendorOnboardingService,
        matching: CapabilityMatchingService,
        distribution: RequestDistributionService,
        wallet: WalletService,
        config: AppConfigService,
      ) => ({
        extraction,
        discovery,
        vendors,
        matching,
        distribution,
        wallet,
        // Pricing passed as data, not as the config service: a workflow that could read the
        // whole configuration would be able to branch on the channel, which MCOS §3.1 forbids.
        credits: {
          visibilityFee: config.credits.visibilityFee,
          onboardingGrant: config.credits.onboardingGrant,
        },
      }),
    },

    { provide: HANDLE_INCOMING_MESSAGE, useExisting: MessageIngestionService },
  ],
  exports: [
    MessageIngestionService,
    HANDLE_INCOMING_MESSAGE,
    EvidenceQueryService,
    ConversationContextManager,
    // Consumed by the LangGraph orchestrator's workflow-execution, fast-path and delivery seams.
    WorkflowDefinitionRegistry,
    WorkflowEngine,
    ConversationPolicyEngine,
    WORKFLOW_SERVICES,
    ConversationDelivery,
    VendorResponseHandler,
  ],
})
export class ConversationModule {}
