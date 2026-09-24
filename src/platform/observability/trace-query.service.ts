import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../adapters/outbound/persistence/prisma.service';
import { computeRunMetrics, type RunMetrics } from './run-metrics';

/**
 * Read side of the trace store for the dev inspection API (Overarching §28).
 *
 * Reads only. Nothing here mutates business or orchestration state.
 */
@Injectable()
export class TraceQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async run(runId: string) {
    const run = await this.prisma.orchestrationRun.findUnique({ where: { runId } });
    if (run === null) return null;

    const [steps, promptExecutions] = await Promise.all([
      this.prisma.traceStep.findMany({
        where: { runId },
        orderBy: [{ sequence: 'asc' }, { startedAt: 'asc' }],
      }),
      this.prisma.promptExecution.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
    ]);

    const metrics: RunMetrics = computeRunMetrics({
      run: { startedAt: run.startedAt, completedAt: run.completedAt },
      promptExecutions,
      steps,
    });

    return {
      run,
      metrics,
      steps: steps.map((step) => ({
        requestId: step.requestId,
        parentRequestId: step.parentRequestId,
        component: step.component,
        componentVersion: step.componentVersion,
        stage: step.stage,
        status: step.status,
        schemaVersion: step.schemaVersion,
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        latencyMs: step.completedAt === null ? null : step.completedAt.getTime() - step.startedAt.getTime(),
        decision: step.decision,
        persistedRecordIds: step.persistedRecordIds,
        promptExecutionIds: step.promptExecutionIds,
        retryCount: step.retryCount,
        error: step.error,
      })),
      promptExecutions: promptExecutions.map((execution) => ({
        id: execution.id,
        requestId: execution.requestId,
        component: execution.component,
        componentVersion: execution.componentVersion,
        promptId: execution.promptId,
        promptVersion: execution.promptVersion,
        schemaId: execution.schemaId,
        schemaVersion: execution.schemaVersion,
        modelProvider: execution.modelProvider,
        modelName: execution.modelName,
        status: execution.status,
        latencyMs: execution.latencyMs,
        repairAttempts: execution.repairAttempts,
        providerAttempts: execution.providerAttempts,
        usage: execution.usage,
        decisionSummary: execution.decisionSummary,
        sharedInvocation: execution.sharedInvocation,
        createdAt: execution.createdAt,
      })),
    };
  }

  async steps(runId: string) {
    return this.prisma.traceStep.findMany({
      where: { runId },
      orderBy: [{ sequence: 'asc' }, { startedAt: 'asc' }],
    });
  }

  /** Full prompt executions including sanitised inputs/outputs — the "exact adapter payloads" view. */
  async prompts(runId: string) {
    return this.prisma.promptExecution.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } });
  }

  async events(runId: string) {
    return this.prisma.outboxEvent.findMany({ where: { runId }, orderBy: { occurredAt: 'asc' } });
  }

  /** Everything recorded under one request id: the step, its prompt executions, its events. */
  async request(requestId: string) {
    const [
      step,
      promptExecutions,
      events,
      intentResolution,
      semanticResolution,
      enrichmentResolution,
      gpcResolution,
      wrsRetrieval,
      wrsRetrievals,
      observations,
    ] = await Promise.all([
      this.prisma.traceStep.findUnique({ where: { requestId } }),
      this.prisma.promptExecution.findMany({ where: { requestId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.outboxEvent.findMany({ where: { requestId }, orderBy: { occurredAt: 'asc' } }),
      this.prisma.intentResolution.findUnique({ where: { requestId } }),
      this.prisma.semanticResolution.findUnique({
        where: { requestId },
        include: { objects: { orderBy: { objectId: 'asc' } } },
      }),
      this.prisma.enrichmentResolution.findUnique({
        where: { requestId },
        include: { profiles: { orderBy: { objectId: 'asc' } } },
      }),
      this.prisma.gpcResolution.findUnique({
        where: { requestId },
        include: { mappings: { orderBy: { objectId: 'asc' } } },
      }),
      this.prisma.wrsRetrieval.findUnique({
        where: { requestId },
        include: { evidence: { orderBy: { evidenceId: 'asc' } } },
      }),
      // WRS calls made on behalf of this request (ids `${requestId}:wrs:…`).
      this.prisma.wrsRetrieval.findMany({
        where: { requestId: { startsWith: `${requestId}:wrs:` } },
        include: { evidence: { orderBy: { evidenceId: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      // Evidence System observations derived from this request (CSRE/GPC/WRS/Enrichment facts).
      this.prisma.observation.findMany({
        where: { OR: [{ requestId }, { observationId: requestId }] },
        include: { evidence: { orderBy: { evidenceId: 'asc' } } },
        orderBy: { observedAt: 'asc' },
      }),
    ]);
    if (
      step === null &&
      promptExecutions.length === 0 &&
      intentResolution === null &&
      semanticResolution === null &&
      enrichmentResolution === null &&
      gpcResolution === null &&
      wrsRetrieval === null &&
      observations.length === 0
    ) {
      return null;
    }
    return {
      requestId,
      step,
      promptExecutions,
      events,
      intentResolution,
      semanticResolution,
      enrichmentResolution,
      gpcResolution,
      wrsRetrieval,
      wrsRetrievals,
      observations,
    };
  }

  /** Everything the Evidence System learned from one run: observations, evidence, touched assertions, decisions. */
  async evidenceForRun(runId: string) {
    const observations = await this.prisma.observation.findMany({
      where: { runId },
      include: { evidence: { orderBy: { evidenceId: 'asc' } } },
      orderBy: { observedAt: 'asc' },
    });
    const assertionIds = [...new Set(observations.flatMap((o) => o.evidence.map((e) => e.assertionId)))];
    const [assertions, knowledge, decisions, history] = await Promise.all([
      this.prisma.evidenceAssertion.findMany({ where: { assertionId: { in: assertionIds } } }),
      this.prisma.knowledge.findMany({ where: { assertionId: { in: assertionIds } } }),
      this.prisma.graphChangeDecision.findMany({ where: { runId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.beliefHistory.findMany({
        where: { assertionId: { in: assertionIds } },
        orderBy: { recordedAt: 'asc' },
      }),
    ]);
    return { runId, observations, assertions, knowledge, decisions, beliefHistory: history };
  }

  async runsForConversation(conversationId: string) {
    return this.prisma.orchestrationRun.findMany({
      where: { conversationId },
      orderBy: { startedAt: 'asc' },
    });
  }

  async timeline(conversationId: string) {
    const [inbound, history, outbound, runs, events] = await Promise.all([
      this.prisma.inboundMessage.findMany({ where: { conversationId }, orderBy: { receivedAt: 'asc' } }),
      this.prisma.historyEntry.findMany({ where: { conversationId }, orderBy: { timestamp: 'asc' } }),
      this.prisma.outboundMessage.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.orchestrationRun.findMany({ where: { conversationId }, orderBy: { startedAt: 'asc' } }),
      this.prisma.outboxEvent.findMany({ where: { conversationId }, orderBy: { occurredAt: 'asc' } }),
    ]);

    const entries: Array<{ at: Date; kind: string; data: unknown }> = [
      ...inbound.map((message) => ({
        at: message.receivedAt,
        kind: 'inbound_message',
        data: {
          id: message.id,
          channel: message.channel,
          parts: message.parts,
          processedAt: message.processedAt,
        },
      })),
      ...history.map((entry) => ({
        at: entry.timestamp,
        kind: `history_${entry.role}`,
        data: { id: entry.id, content: entry.content, channel: entry.channel, workflowId: entry.workflowId },
      })),
      ...outbound.map((message) => ({
        at: message.createdAt,
        kind: 'outbound_message',
        data: {
          id: message.id,
          channel: message.channel,
          status: message.status,
          attempts: message.attempts,
          sentAt: message.sentAt,
          response: message.response,
        },
      })),
      ...runs.map((run) => ({
        at: run.startedAt,
        kind: 'orchestration_run',
        data: { runId: run.runId, turnId: run.turnId, status: run.status, completedAt: run.completedAt },
      })),
      ...events.map((event) => ({
        at: event.occurredAt,
        kind: `event:${event.eventType}`,
        data: {
          eventId: event.eventId,
          eventVersion: event.eventVersion,
          producer: event.producer,
          runId: event.runId,
          consumedAt: event.consumedAt,
          publishedAt: event.publishedAt,
        },
      })),
    ];

    entries.sort((a, b) => a.at.getTime() - b.at.getTime());
    return { conversationId, entries };
  }
}
