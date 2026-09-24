import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import { interval, map, merge, Observable } from 'rxjs';
import { resolveWebIdentity } from '../../../domain/models/user-identity';
import {
  CONVERSATION_STREAM,
  type ConversationStreamEvent,
  type ConversationStreamPort,
} from '../../../domain/ports/inbound/conversation-stream.port';
import {
  HANDLE_INCOMING_MESSAGE,
  type HandleIncomingMessagePort,
} from '../../../domain/ports/inbound/handle-incoming-message.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import { CLOCK, type ClockPort } from '../../../domain/ports/outbound/system.port';
import { mapWebMessage, type WebMessageBody } from './web-payload.mapper';

const COMPONENT = 'MCOS';
const STAGE = 'WebChannelAdapter';

/**
 * Interval for SSE keep-alive frames.
 *
 * Reverse proxies and load balancers close idle event streams, typically at 30–60s. A turn can
 * legitimately take longer than that (the orchestrator heartbeat fires at 25s), so the stream
 * must prove it is alive more often than the proxy's patience.
 */
const KEEPALIVE_MS = 15_000;

interface WebStreamQuery {
  readonly sessionId?: string;
  readonly phone?: string;
}

/**
 * Web client endpoints (ADR-001 inbound adapter).
 *
 * The symmetry with `WhatsAppWebhookController` is deliberate and now complete: map the
 * payload, call an inbound port, do nothing else. The adapter depends on exactly two ports —
 * `HandleIncomingMessagePort` for what the user said and `ConversationStreamPort` for what the
 * platform says back — and never on application services or outbound adapters.
 *
 * Processing is not awaited into the HTTP response. A turn that runs a matching fan-out can
 * exceed any sensible request timeout, and the reply's route to the user is the event stream
 * either way — the same durable delivery path WhatsApp uses, one notifier along.
 */
@Controller('channels/web')
export class WebChannelController {
  constructor(
    @Inject(HANDLE_INCOMING_MESSAGE) private readonly handler: HandleIncomingMessagePort,
    @Inject(CONVERSATION_STREAM) private readonly conversations: ConversationStreamPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  /**
   * The reply stream for a session.
   *
   * Keyed on the resolved identity rather than a conversation id the client would have to
   * learn first, which is what lets the browser subscribe before it has ever sent anything.
   */
  @Sse('stream')
  async stream(@Query() query: WebStreamQuery): Promise<Observable<MessageEvent>> {
    const conversationId = await this.conversations.resolveConversation({
      userId: this.identify(query),
      channel: 'web',
    });

    const events = new Observable<ConversationStreamEvent>((subscriber) =>
      this.conversations.subscribe(conversationId, (event) => subscriber.next(event)),
    ).pipe(map((event): MessageEvent => ({ type: event.kind, data: event })));

    // Comment-only frames would be cheaper, but Nest's SSE contract is typed around events, so
    // an explicit ping the client ignores is the honest way to express it.
    const keepalive = interval(KEEPALIVE_MS).pipe(
      map((): MessageEvent => ({ type: 'ping', data: { at: this.clock.now().toISOString() } })),
    );

    return merge(events, keepalive);
  }

  /**
   * Transcript for rehydrating the UI after a reload.
   *
   * The stream only carries what happens while it is open, so without this a refresh looks
   * like the conversation was lost — when in fact the platform remembers all of it.
   */
  @Get('history')
  async history(@Query() query: WebStreamQuery): Promise<{
    conversationId: string;
    history: readonly { role: string; content: string; at: string }[];
  }> {
    const { conversationId, history } = await this.conversations.history({
      userId: this.identify(query),
      channel: 'web',
    });
    return {
      conversationId,
      history: history.map((entry) => ({
        role: entry.role,
        content: entry.content,
        at: entry.at.toISOString(),
      })),
    };
  }

  @Post('messages')
  @HttpCode(HttpStatus.ACCEPTED)
  async receive(@Body() body: WebMessageBody): Promise<{ accepted: true; conversationId: string }> {
    const mapped = mapWebMessage(body, this.clock.now());

    if (!mapped.ok) {
      // Unlike Meta's webhook, this caller is our own client and can act on a 400.
      throw new BadRequestException(mapped.reason);
    }

    const conversationId = await this.conversations.resolveConversation({
      userId: mapped.message.userId,
      channel: 'web',
    });

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { conversationId, parts: mapped.message.parts.map((part) => part.type) },
      action: 'Accepted a web message and dispatched it for processing',
      output: { accepted: true },
    });

    void this.process({ ...mapped.message, conversationId });

    return { accepted: true, conversationId };
  }

  private identify(query: WebStreamQuery): string {
    const sessionId = query.sessionId?.trim();

    if (sessionId === undefined || sessionId.length === 0) {
      throw new BadRequestException('sessionId is required.');
    }

    return resolveWebIdentity({ phone: query.phone, sessionId });
  }

  /**
   * Runs the turn detached from the HTTP response.
   *
   * Every failure is caught: an unhandled rejection here would take the process down rather
   * than fail one message. The user still learns something went wrong, because the
   * orchestrator delivers its own error envelope over the same stream.
   */
  private async process(message: Parameters<HandleIncomingMessagePort['handle']>[0]): Promise<void> {
    try {
      await this.handler.handle(message);
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { messageId: message.id, conversationId: message.conversationId },
        action: 'Web message processing failed',
        error,
      });
    }
  }
}
