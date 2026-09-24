import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../adapters/outbound/persistence/prisma.service';
import { sanitizeForLog } from '../../shared/logging/stage-logger';
import type {
  PromptExecutionRecord,
  RunCompletion,
  RunStart,
  TraceRecorderPort,
  TraceStepFinish,
  TraceStepStart,
} from './trace.port';

/**
 * Persists runs, steps and prompt executions (Overarching §18.4, §26, §28).
 *
 * Trace persistence is best-effort *with respect to the user's turn* — a trace-store failure is
 * logged loudly and never converts a successful business action into a failed reply — but it is
 * never silently skipped: the failure is itself recorded in the process log.
 */
@Injectable()
export class PrismaTraceRecorder implements TraceRecorderPort {
  private readonly logger = new Logger(PrismaTraceRecorder.name);

  constructor(private readonly prisma: PrismaService) {}

  async startRun(run: RunStart): Promise<void> {
    await this.guard('startRun', () =>
      this.prisma.orchestrationRun.upsert({
        where: { runId: run.runId },
        create: {
          runId: run.runId,
          conversationId: run.conversationId,
          turnId: run.turnId,
          correlationId: run.correlationId,
          channel: run.channel,
          messageIds: [...run.messageIds],
          status: 'ACTIVE',
          startedAt: run.startedAt,
        },
        update: { status: 'ACTIVE', startedAt: run.startedAt, completedAt: null, error: Prisma.JsonNull },
      }),
    );
  }

  async completeRun(completion: RunCompletion): Promise<void> {
    await this.guard('completeRun', () =>
      this.prisma.orchestrationRun.update({
        where: { runId: completion.runId },
        data: {
          status: completion.status,
          completedAt: completion.completedAt,
          finalResponse: json(sanitizeForLog(completion.finalResponse)),
          error: completion.error === null ? Prisma.JsonNull : json(completion.error),
        },
      }),
    );
  }

  async startStep(step: TraceStepStart): Promise<void> {
    await this.guard('startStep', async () => {
      // Component Mode (Overarching §27.3): a specialist invoked directly through its own API has
      // no orchestration run yet. Anchor the step on a run row so `/dev/requests/{id}/trace` and
      // `/dev/runs/{runId}` work identically for component-mode and pipeline-mode invocations.
      await this.prisma.orchestrationRun.upsert({
        where: { runId: step.runId },
        create: {
          runId: step.runId,
          conversationId: step.conversationId ?? '',
          turnId: step.turnId ?? '',
          correlationId: step.correlationId,
          channel: 'component',
          messageIds: [],
          status: 'ACTIVE',
          startedAt: step.startedAt,
        },
        update: {},
      });
      const sequence = await this.prisma.traceStep.count({ where: { runId: step.runId } });
      await this.prisma.traceStep.upsert({
        where: { requestId: step.requestId },
        create: {
          runId: step.runId,
          requestId: step.requestId,
          parentRequestId: step.parentRequestId,
          correlationId: step.correlationId,
          conversationId: step.conversationId,
          turnId: step.turnId,
          component: step.component,
          componentVersion: step.componentVersion,
          stage: step.stage,
          schemaVersion: step.schemaVersion,
          status: 'STARTED',
          sequence,
          inputSummary: json(sanitizeForLog(step.inputSummary)),
          startedAt: step.startedAt,
        },
        update: { status: 'STARTED', startedAt: step.startedAt },
      });
    });
  }

  async finishStep(step: TraceStepFinish): Promise<void> {
    await this.guard('finishStep', () =>
      this.prisma.traceStep.update({
        where: { requestId: step.requestId },
        data: {
          status: step.status,
          completedAt: step.completedAt,
          decision: json(sanitizeForLog(step.decision)),
          outputSummary: json(sanitizeForLog(step.outputSummary)),
          persistedRecordIds: [...step.persistedRecordIds],
          promptExecutionIds: [...step.promptExecutionIds],
          retryCount: step.retryCount,
          error: step.error === null ? Prisma.JsonNull : json(step.error),
        },
      }),
    );
  }

  async recordPromptExecution(execution: PromptExecutionRecord): Promise<void> {
    await this.guard('recordPromptExecution', () =>
      this.prisma.promptExecution.create({
        data: {
          id: execution.id,
          requestId: execution.requestId,
          parentRequestId: execution.parentRequestId,
          correlationId: execution.correlationId,
          conversationId: execution.conversationId,
          turnId: execution.turnId,
          runId: execution.runId,
          component: execution.component,
          componentVersion: execution.componentVersion,
          promptId: execution.promptId,
          promptVersion: execution.promptVersion,
          schemaId: execution.schemaId,
          schemaVersion: execution.schemaVersion,
          modelProvider: execution.modelProvider,
          modelName: execution.modelName,
          inputHash: execution.inputHash,
          input: json(execution.input),
          output: execution.output === null ? Prisma.JsonNull : json(execution.output),
          rawOutput: execution.rawOutput,
          status: execution.status,
          validationErrors: json(execution.validationErrors),
          repairAttempts: execution.repairAttempts,
          providerAttempts: execution.providerAttempts,
          failedProviders: [...execution.failedProviders],
          latencyMs: execution.latencyMs,
          usage: execution.usage === null ? Prisma.JsonNull : json(execution.usage),
          decisionSummary:
            execution.decisionSummary === null ? Prisma.JsonNull : json(execution.decisionSummary),
          sharedInvocation: execution.sharedInvocation,
          createdAt: execution.createdAt,
        },
      }),
    );
  }

  private async guard(operation: string, work: () => Promise<unknown>): Promise<void> {
    try {
      await work();
    } catch (error) {
      this.logger.error(
        `Trace persistence failed (${operation}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return (value === undefined ? null : value) as Prisma.InputJsonValue;
}
