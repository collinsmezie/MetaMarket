import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfigService } from '../../../config/app-config.service';
import {
  HANDLE_PAYMENT_NOTIFICATION,
  type HandlePaymentNotificationPort,
} from '../../../domain/ports/inbound/handle-payment-notification.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import { mapWebhookToNotification } from './paystack-payload.mapper';
import { verifyPaystackSignature } from './paystack-signature';

const COMPONENT = 'Wallet';
const STAGE = 'PaystackWebhook';

type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * Paystack webhook endpoint (Konnet Credits Recharge TDR §10.3).
 *
 * Follows the same two rules as the WhatsApp controller, for the same reasons:
 *
 *  1. Every authenticated request is answered 200, even when processing fails. Paystack retries
 *     non-2xx aggressively, and a bug on our side must not turn one payment into a retry storm.
 *     Real failures are recorded in `payment_notifications.status` and surfaced as
 *     `wallet.credit.failed` events.
 *  2. It performs no business logic. It authenticates, maps, and hands off.
 */
@Controller('webhooks/paystack')
export class PaystackWebhookController {
  constructor(
    @Inject(HANDLE_PAYMENT_NOTIFICATION) private readonly handler: HandlePaymentNotificationPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    private readonly config: AppConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() request: RequestWithRawBody, @Body() body: unknown): Promise<{ received: true }> {
    // The one case not answered 200: an unsigned request is not from Paystack, and
    // acknowledging it would invite forged credits.
    if (!this.isAuthentic(request)) {
      throw new ForbiddenException('Invalid Paystack signature.');
    }

    // Detached so a slow database never becomes a provider timeout; the processor's sweep is
    // the durability backstop.
    void this.process(body);

    return { received: true };
  }

  private isAuthentic(request: RequestWithRawBody): boolean {
    const { secretKey, verifySignature } = this.config.paystack;

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

    if (secretKey === undefined) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Signature`,
        input: {},
        action: 'Rejected the webhook because PAYSTACK_SECRET_KEY is not configured',
        error: new Error('Missing secret key with signature verification enabled'),
      });
      return false;
    }

    const rawBody = request.rawBody;

    if (rawBody === undefined) {
      // Verifying a re-serialised body would accept payloads whose tampering JSON
      // round-tripping hides, so refuse rather than approximate.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Signature`,
        input: {},
        action: 'Rejected the webhook because the raw request body was not captured',
        error: new Error('rawBody missing; the raw-body middleware is not installed'),
      });
      return false;
    }

    return verifyPaystackSignature({
      rawBody,
      signatureHeader: request.header('x-paystack-signature'),
      secretKey,
    });
  }

  /**
   * Maps and dispatches one notification.
   *
   * Runs detached from the HTTP response, so every failure is caught: an unhandled rejection
   * here would take the process down rather than fail one payment.
   */
  private async process(body: unknown): Promise<void> {
    try {
      const mapped = mapWebhookToNotification(body);

      if (mapped.kind === 'ignored') {
        this.logger.stage({
          component: COMPONENT,
          stage: STAGE,
          input: { eventType: mapped.eventType },
          action: `Acknowledged without crediting: ${mapped.reason}`,
          output: { credited: false },
        });
        return;
      }

      const result = await this.handler.handle(mapped.notification);

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: {
          eventType: mapped.notification.eventType,
          accountNumber: mapped.notification.accountNumber,
          amountKobo: mapped.notification.amountKobo,
        },
        action: result.duplicate
          ? 'Duplicate delivery of a payment already recorded'
          : 'Accepted the payment notification for crediting',
        output: { duplicate: result.duplicate },
      });
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: {},
        action: 'Could not process the Paystack webhook payload',
        error,
      });
    }
  }
}
