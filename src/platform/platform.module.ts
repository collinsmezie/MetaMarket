import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../domain/ports/outbound/llm-provider.port';
import { SchemaRegistry } from './contracts/schema-registry';
import { EVENT_HANDLER_REGISTRY, EventHandlerRegistry } from './events/domain-event';
import { OutboxConsumerWorker } from './events/outbox-consumer.worker';
import { TRACE_RECORDER, type TraceRecorderPort } from './observability/trace.port';
import { TraceQueryService } from './observability/trace-query.service';
import { PromptExecutor } from './prompt-runtime/prompt-executor';
import { PromptRegistry } from './prompt-runtime/prompt-registry';

/**
 * Cross-cutting platform capabilities (Overarching §29 Phase 0/3; Directive §35 Phase 1):
 * contract registry, prompt runtime, durable event consumption, trace queries.
 *
 * Infrastructure adapters (Prisma, Redis, LLM providers, the trace recorder) come from the
 * global InfrastructureModule; this module composes them into the shared runtime every
 * specialist depends on. It is global so component modules never need to import it explicitly.
 */
@Global()
@Module({
  providers: [
    { provide: SchemaRegistry, useFactory: () => new SchemaRegistry() },
    { provide: PromptRegistry, useFactory: () => new PromptRegistry() },
    { provide: EVENT_HANDLER_REGISTRY, useFactory: () => new EventHandlerRegistry() },
    {
      provide: PromptExecutor,
      inject: [LLM_PROVIDER_SERVICE, SchemaRegistry, TRACE_RECORDER, AppConfigService],
      useFactory: (
        llm: LlmService,
        schemas: SchemaRegistry,
        traces: TraceRecorderPort,
        config: AppConfigService,
      ) =>
        new PromptExecutor(llm, schemas, traces, {
          defaultTimeoutMs: config.llmResilience.timeoutMs,
          maxSchemaRepairs: 1,
        }),
    },
    TraceQueryService,
    OutboxConsumerWorker,
  ],
  exports: [
    SchemaRegistry,
    PromptRegistry,
    EVENT_HANDLER_REGISTRY,
    PromptExecutor,
    TraceQueryService,
    OutboxConsumerWorker,
  ],
})
export class PlatformModule {}
