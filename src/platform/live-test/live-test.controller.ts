import { BadRequestException, Body, Controller, Inject, Post } from '@nestjs/common';
import { mapWebMessage } from '../../adapters/inbound/web/web-payload.mapper';
import { isTerminalTurnStatus } from '../../conversation/domain/logical-turn';
import {
  LOGICAL_TURN_REPOSITORY,
  type LogicalTurnRepositoryPort,
} from '../../conversation/ports/logical-turn.repository.port';
import {
  HANDLE_INCOMING_MESSAGE,
  type HandleIncomingMessagePort,
} from '../../domain/ports/inbound/handle-incoming-message.port';
import { CLOCK, type ClockPort } from '../../domain/ports/outbound/system.port';
import { RequestContextStore } from '../correlation/request-context';
import { TraceQueryService } from '../observability/trace-query.service';

/**
 * Live Test Mode driver (Overarching §27; Final Lock §13).
 *
 *   POST /dev/live-tests/runs
 *     → transport messages → MCOS ingestion → Turn Assembly → queue → orchestrator →
 *     persisted trace → GET /dev/runs/{runId} / GET /dev/turns/{turnId}
 *
 * Messages enter through the same inbound port the web channel uses and are processed by the
 * same asynchronous turn queue; the driver simply waits for each message's logical turn to reach
 * a terminal state so the caller receives the ids to inspect. Nothing is mocked or short-circuited.
 */

interface LiveTestRunBody {
  readonly sessionId?: string;
  readonly phone?: string;
  /** Messages sent in order. */
  readonly messages?: readonly string[];
  /**
   * Gap between messages in ms. Below the channel's quiet window this exercises coalescing into
   * one logical turn (MCOS §5A); omit or exceed the window to get one turn per message.
   */
  readonly interMessageDelayMs?: number;
  /** Wait for each message's turn to complete before sending the next (default: only when no delay is given). */
  readonly awaitEachTurn?: boolean;
  /** Send all messages without awaiting (exercises concurrent arrival and queue ordering). */
  readonly concurrent?: boolean;
  /** Maximum time to wait for the final turn to commit. */
  readonly waitTimeoutMs?: number;
}

const POLL_MS = 150;

@Controller('dev/live-tests')
export class LiveTestController {
  constructor(
    @Inject(HANDLE_INCOMING_MESSAGE) private readonly handler: HandleIncomingMessagePort,
    @Inject(LOGICAL_TURN_REPOSITORY) private readonly turns: LogicalTurnRepositoryPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    private readonly traces: TraceQueryService,
  ) {}

  @Post('runs')
  async run(@Body() body: LiveTestRunBody) {
    const sessionId = body.sessionId?.trim() || `livetest-${Date.now().toString(36)}`;
    const messages = (body.messages ?? []).map((text) => text.trim()).filter((text) => text.length > 0);
    if (messages.length === 0) throw new BadRequestException('messages[] must contain at least one message');

    const startedAt = this.clock.now();
    const waitTimeoutMs = body.waitTimeoutMs ?? 180_000;
    const awaitEach =
      body.awaitEachTurn ?? (body.interMessageDelayMs === undefined && body.concurrent !== true);
    const sent: Array<{
      index: number;
      text: string;
      messageId: string;
      conversationId: string;
      deduplicated: boolean;
    }> = [];

    const send = async (text: string, index: number) => {
      const mapped = mapWebMessage(
        { sessionId, phone: body.phone, text, clientMessageId: `livetest-${startedAt.getTime()}-${index}` },
        this.clock.now(),
      );
      if (!mapped.ok) throw new BadRequestException(mapped.reason);

      const outcome = await RequestContextStore.child(
        { component: 'LIVE_TEST', messageId: mapped.message.id },
        () => this.handler.handle(mapped.message),
      );
      sent.push({
        index,
        text,
        messageId: mapped.message.id,
        conversationId: outcome.conversationId,
        deduplicated: outcome.deduplicated,
      });
      if (awaitEach) await this.awaitTurn(mapped.message.id, waitTimeoutMs);
    };

    if (body.concurrent === true) {
      await Promise.all(messages.map((text, index) => send(text, index)));
    } else {
      for (const [index, text] of messages.entries()) {
        await send(text, index);
        if (
          index < messages.length - 1 &&
          body.interMessageDelayMs !== undefined &&
          body.interMessageDelayMs > 0
        ) {
          await sleep(body.interMessageDelayMs);
        }
      }
    }

    // Every message's turn must be terminal before we report.
    const turnIds = new Set<string>();
    for (const message of sent) {
      const turn = await this.awaitTurn(message.messageId, waitTimeoutMs);
      if (turn !== null) turnIds.add(turn.turnId);
    }

    const conversationId = sent[0]?.conversationId ?? null;
    const turns = await Promise.all([...turnIds].map((turnId) => this.turns.findById(turnId)));
    const runs = conversationId === null ? [] : await this.traces.runsForConversation(conversationId);

    return {
      sessionId,
      conversationId,
      correlationId: RequestContextStore.current()?.correlationId ?? null,
      assembly: {
        interMessageDelayMs: body.interMessageDelayMs ?? null,
        awaitEachTurn: awaitEach,
        concurrent: body.concurrent === true,
      },
      messages: sent.sort((a, b) => a.index - b.index),
      turns: turns
        .filter((turn): turn is NonNullable<typeof turn> => turn !== null)
        .sort((a, b) => a.firstMessageAt.getTime() - b.firstMessageAt.getTime())
        .map((turn) => ({
          turnId: turn.turnId,
          status: turn.status,
          messageIds: turn.messageIds,
          assembledText: turn.assembledText,
          assemblyReason: turn.assemblyReason,
          boundaryReason: turn.boundaryReason,
          supersedesTurnId: turn.supersedesTurnId,
          runId: turn.runId,
          summary: turn.summary,
          error: turn.error,
          inspect: `/dev/turns/${turn.turnId}`,
          inspectRun: turn.runId === null ? null : `/dev/runs/${encodeURIComponent(turn.runId)}`,
        })),
      runs: runs
        .filter((run) => turnIds.has(run.turnId))
        .map((run) => ({
          runId: run.runId,
          status: run.status,
          startedAt: run.startedAt,
          completedAt: run.completedAt,
          finalResponse: run.finalResponse,
          inspect: `/dev/runs/${encodeURIComponent(run.runId)}`,
        })),
      timeline: conversationId === null ? null : `/dev/conversations/${conversationId}/timeline`,
      totalLatencyMs: this.clock.now().getTime() - startedAt.getTime(),
    };
  }

  /** Polls until the message's logical turn is terminal (or CANCELLED by a retraction), else null. */
  private async awaitTurn(messageId: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const turn = await this.turns.findByMessageId(messageId);
      if (turn !== null && isTerminalTurnStatus(turn.status)) return turn;
      if (Date.now() >= deadline) return turn;
      await sleep(POLL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
