import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../../config/app-config.service';
import {
  HANDLE_INCOMING_MESSAGE,
  type HandleIncomingMessagePort,
} from '../../../domain/ports/inbound/handle-incoming-message.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import { mapWebhookToMessages, type WhatsAppWebhookBody } from './whatsapp-payload.mapper';
import { verifyWhatsAppSignature } from './whatsapp-signature';

const COMPONENT = 'MCOS';
const STAGE = 'WhatsAppChannelAdapter';

/** Express request augmented with the raw body captured for signature verification. */
type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * Meta Cloud API webhook endpoint (ADR-001 inbound adapter).
 *
 * Two rules govern this controller:
 *
 * 1. It always answers 200 once the request is authenticated (Execution.md §2.5). Meta
 *    retries any non-2xx aggressively and escalates to disabling the subscription, so a bug
 *    in our processing must never be reported back as a delivery failure.
 * 2. It performs no business logic and calls no AI. It maps the payload and invokes the
 *    inbound port (Execution.md §2.1).
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    @Inject(HANDLE_INCOMING_MESSAGE) private readonly handler: HandleIncomingMessagePort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Subscription verification handshake.
   *
   * Meta calls this once when the webhook is configured and expects the challenge echoed
   * back verbatim as plain text.
   */
  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    const expected = this.config.whatsapp.verifyToken;

    if (expected === undefined) {
      throw new ForbiddenException('WHATSAPP_VERIFY_TOKEN is not configured on this deployment.');
    }

    if (mode !== 'subscribe' || token !== expected || challenge === undefined) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Verify`,
        input: { mode, tokenProvided: token !== undefined },
        action: 'Rejected a webhook verification attempt with an incorrect token',
        error: new Error('Verification token mismatch'),
      });

      throw new ForbiddenException('Webhook verification failed.');
    }

    return challenge;
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() request: RequestWithRawBody,
    @Body() body: WhatsAppWebhookBody,
  ): Promise<{ received: true }> {
    if (!this.isAuthentic(request)) {
      // The one case that is not answered 200: an unsigned request is not from Meta, and
      // acknowledging it would invite an injection attack.
      throw new ForbiddenException('Invalid webhook signature.');
    }

    // Processing is intentionally not awaited into the response: Meta imposes a short
    // timeout, and a slow transcription or LLM chain must not turn into a retry storm.
    void this.process(body);

    return { received: true };
  }

  private isAuthentic(request: RequestWithRawBody): boolean {
    const { appSecret, verifySignature } = this.config.whatsapp;

    if (!verifySignature) {
      this.logger.stage({
        component: COMPONENT,
        stage: `${STAGE}:Signature`,
        input: { verifySignature },
        action: 'Signature verification is disabled by configuration; accepting the request',
        output: { verified: false },
      });
      return true;
    }

    if (appSecret === undefined) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Signature`,
        input: {},
        action: 'Rejected the webhook because WHATSAPP_APP_SECRET is not configured',
        error: new Error('Missing app secret with signature verification enabled'),
      });
      return false;
    }

    const rawBody = request.rawBody;

    if (rawBody === undefined) {
      // Verifying against a re-serialised body would silently pass tampered payloads whose
      // JSON happens to round-trip identically, so refuse instead.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Signature`,
        input: {},
        action: 'Rejected the webhook because the raw request body was not captured',
        error: new Error('rawBody missing; the raw-body middleware is not installed'),
      });
      return false;
    }

    const header = request.header('x-hub-signature-256');

    return verifyWhatsAppSignature({ rawBody, signatureHeader: header, appSecret });
  }

  /**
   * Maps and dispatches the webhook's messages.
   *
   * Every failure is caught and logged: this runs detached from the HTTP response, so an
   * unhandled rejection here would crash the process rather than fail one message.
   */
  private async process(body: WhatsAppWebhookBody): Promise<void> {
    try {
      const { messages, statuses, skipped } = mapWebhookToMessages(body);

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { entries: body.entry?.length ?? 0 },
        action: 'Normalized the Meta webhook payload into canonical messages',
        output: {
          messages: messages.length,
          statuses: statuses.length,
          skipped: skipped.length,
        },
      });

      for (const skip of skipped) {
        this.logger.stage({
          component: COMPONENT,
          stage: `${STAGE}:Skipped`,
          input: { messageId: skip.messageId },
          action: skip.reason,
          output: { processed: false },
        });
      }

      for (const message of messages) {
        try {
          await this.handler.handle(message);
        } catch (error) {
          // One bad message must not prevent its siblings in the same batch from running.
          this.logger.stageFailed({
            component: COMPONENT,
            stage: STAGE,
            input: { messageId: message.id, userId: message.userId },
            action: 'Message processing failed; continuing with the rest of the batch',
            error,
          });
        }
      }
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { entries: body.entry?.length ?? 0 },
        action: 'Could not process the webhook payload',
        error,
      });
    }
  }
}
