import { Controller, Get, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import {
  CLARIFICATION_REPOSITORY,
  type ClarificationRepositoryPort,
} from '../../conversation/ports/clarification.repository.port';
import {
  LOGICAL_TURN_REPOSITORY,
  type LogicalTurnRepositoryPort,
} from '../../conversation/ports/logical-turn.repository.port';
import {
  TURN_CONTEXT_REPOSITORY,
  type TurnContextRepositoryPort,
} from '../../conversation/ports/turn-context.repository.port';
import { SchemaRegistry } from '../contracts/schema-registry';
import { TraceQueryService } from '../observability/trace-query.service';
import { PromptRegistry } from '../prompt-runtime/prompt-registry';
import { COMPONENT_REGISTRY, SPECIFICATION_REGISTRY } from '../registry/component-registry';

/**
 * Development-only trace inspection API (Overarching §28; Directive §48.7, §49.9).
 *
 * This surface exists so an operator can answer "why did the system produce this answer?" from
 * persisted state without reading source. It is mounted only when the dev API is enabled
 * (never in production) and lives in its own module so a future authorization boundary wraps
 * exactly this controller (Final Lock §12).
 */
@Controller('dev')
export class DevTraceController {
  constructor(
    private readonly traces: TraceQueryService,
    private readonly schemas: SchemaRegistry,
    private readonly prompts: PromptRegistry,
    @Inject(LOGICAL_TURN_REPOSITORY) private readonly turns: LogicalTurnRepositoryPort,
    @Inject(CLARIFICATION_REPOSITORY) private readonly clarifications: ClarificationRepositoryPort,
    @Inject(TURN_CONTEXT_REPOSITORY) private readonly contexts: TurnContextRepositoryPort,
  ) {}

  /** Pinned component/wire versions and every registered contract — the preflight registry. */
  @Get('registry')
  registry() {
    return {
      specification: SPECIFICATION_REGISTRY,
      components: COMPONENT_REGISTRY,
      schemas: this.schemas.all().map((schema) => ({ id: schema.id, version: schema.version })),
      prompts: this.prompts.all().map((prompt) => ({
        id: prompt.id,
        version: prompt.version,
        component: prompt.component,
        schemaId: prompt.schemaId,
      })),
    };
  }

  @Get('runs/:runId')
  async run(@Param('runId') runId: string) {
    const run = await this.traces.run(decodeURIComponent(runId));
    if (run === null) throw new NotFoundException(`Run ${runId} not found`);
    return run;
  }

  @Get('runs/:runId/steps')
  steps(@Param('runId') runId: string) {
    return this.traces.steps(decodeURIComponent(runId));
  }

  @Get('runs/:runId/prompts')
  prompts_(@Param('runId') runId: string) {
    return this.traces.prompts(decodeURIComponent(runId));
  }

  @Get('requests/:requestId/trace')
  async request(@Param('requestId') requestId: string) {
    const trace = await this.traces.request(requestId);
    if (trace === null) throw new NotFoundException(`Request ${requestId} not found`);
    return trace;
  }

  @Get('runs/:runId/events')
  events(@Param('runId') runId: string) {
    return this.traces.events(decodeURIComponent(runId));
  }

  /** Evidence System learning for a run (Overarching §24.2 `/dev/runs/{runId}/evidence`; final lock §13). */
  @Get('runs/:runId/evidence')
  evidence(@Param('runId') runId: string) {
    return this.traces.evidenceForRun(decodeURIComponent(runId));
  }

  /** The logical turn: assembly state, messages, queue entry, context snapshot (MCOS §5A, §63.1). */
  @Get('turns/:turnId')
  async turn(@Param('turnId') turnId: string) {
    const turn = await this.turns.findById(turnId);
    if (turn === null) throw new NotFoundException(`Turn ${turnId} not found`);
    const [queue, snapshot] = await Promise.all([
      this.turns.queueEntry(turnId),
      this.contexts.findByTurnId(turnId),
    ]);
    return {
      turn,
      queue,
      contextSnapshot: snapshot,
      inspectRun: turn.runId === null ? null : `/dev/runs/${encodeURIComponent(turn.runId)}`,
    };
  }

  @Get('conversations/:conversationId/turns')
  conversationTurns(@Param('conversationId') conversationId: string, @Query('limit') limit?: string) {
    return this.turns.listForConversation(conversationId, Math.min(Number(limit ?? 50) || 50, 200));
  }

  @Get('conversations/:conversationId/clarifications')
  conversationClarifications(@Param('conversationId') conversationId: string) {
    return this.clarifications.listForConversation(conversationId, 50);
  }

  @Get('conversations/:conversationId/runs')
  runs(@Param('conversationId') conversationId: string) {
    return this.traces.runsForConversation(conversationId);
  }

  @Get('conversations/:conversationId/timeline')
  timeline(@Param('conversationId') conversationId: string) {
    return this.traces.timeline(conversationId);
  }
}
