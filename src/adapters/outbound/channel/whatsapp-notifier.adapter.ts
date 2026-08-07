import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import type { Channel } from '../../../domain/models/channel';
import { CHANNEL_CAPABILITIES } from '../../../domain/models/channel';
import type { Action, Response } from '../../../domain/models/response';
import type {
  ChannelNotifierPort,
  DeliveryResult,
  DeliveryTarget,
} from '../../../domain/ports/outbound/channel-notifier.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';

const COMPONENT = 'MCOS';
const STAGE = 'WhatsAppNotifier';

const SEND_TIMEOUT_MS = 15_000;

/**
 * Ceiling on one `send`, across every payload and every retry.
 *
 * Deliberately below `CONVERSATION_LOCK_TTL_MS` (30s). Delivery happens inside the turn, which
 * holds the conversation lock; if retries outlived the lock, a second worker could pick up the
 * same conversation while this one was still writing to it. Bounding the send is what keeps
 * "retry harder" from turning a network problem into a concurrency problem.
 */
const SEND_DEADLINE_MS = 20_000;

/**
 * Attempts per message before giving up.
 *
 * The outbound channel is the last mile: a reply lost here is a user who asked something and
 * got silence, with no queue behind it to try again. Mobile networks and the Graph API both
 * fail transiently often enough that one shot is not a delivery guarantee.
 */
const MAX_SEND_ATTEMPTS = 3;

/** Attempt N waits BASE · 2^(N-1) plus jitter, matching the LLM provider's discipline. */
const RETRY_BASE_MS = 250;

/**
 * Connection-phase failures: the request never reached Meta, so retrying cannot duplicate a
 * message. Anything ambiguous is deliberately absent from this list — see `classify`.
 */
const SAFE_TO_RETRY_CODES = new Set([
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EADDRNOTAVAIL',
]);

/**
 * Renders canonical responses as WhatsApp messages and sends them via the Graph API.
 *
 * All Meta-specific rendering rules live here: at most three reply buttons, a 4096-character
 * body limit, and the list-message form required beyond three options.
 */
@Injectable()
export class WhatsAppNotifier implements ChannelNotifierPort {
  readonly channel: Channel = 'whatsapp';

  private readonly accessToken: string | undefined;
  private readonly phoneNumberId: string | undefined;
  private readonly graphVersion: string;

  constructor(
    config: AppConfigService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {
    const whatsapp = config.whatsapp;
    this.accessToken = whatsapp.accessToken;
    this.phoneNumberId = whatsapp.phoneNumberId;
    this.graphVersion = whatsapp.graphApiVersion;
  }

  async send(target: DeliveryTarget, response: Response): Promise<DeliveryResult> {
    if (this.accessToken === undefined || this.phoneNumberId === undefined) {
      return {
        delivered: false,
        error:
          'WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID must be configured to deliver WhatsApp messages.',
      };
    }

    const payloads = this.render(target.address, response);

    if (payloads.length === 0) {
      return { delivered: false, error: 'Response contained nothing renderable for WhatsApp.' };
    }

    let lastProviderMessageId: string | undefined;
    const deadline = Date.now() + SEND_DEADLINE_MS;

    for (const [index, payload] of payloads.entries()) {
      const result = await this.post(payload, deadline);

      if (!result.ok) {
        // Report partial delivery honestly: earlier messages did reach the user.
        return {
          delivered: false,
          error:
            index === 0
              ? result.error
              : `Delivered ${index} of ${payloads.length} messages before failing: ${result.error}`,
          ...(lastProviderMessageId !== undefined ? { providerMessageId: lastProviderMessageId } : {}),
        };
      }

      lastProviderMessageId = result.providerMessageId;
    }

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { to: target.address, actions: response.actions?.length ?? 0 },
      action: `Delivered the response as ${payloads.length} WhatsApp message(s)`,
      output: { providerMessageId: lastProviderMessageId, messageCount: payloads.length },
    });

    return {
      delivered: true,
      ...(lastProviderMessageId !== undefined ? { providerMessageId: lastProviderMessageId } : {}),
      messageCount: payloads.length,
    };
  }

  /**
   * Converts a canonical response into one or more Graph API payloads.
   *
   * Long text is split rather than truncated: cutting a vendor list mid-entry loses
   * information the user needs.
   */
  private render(to: string, response: Response): Record<string, unknown>[] {
    const capabilities = CHANNEL_CAPABILITIES.whatsapp;
    const payloads: Record<string, unknown>[] = [];

    const media = response.media ?? [];
    for (const item of media) {
      payloads.push({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: item.type,
        [item.type]: {
          link: item.url,
          ...(item.caption !== undefined ? { caption: item.caption } : {}),
          ...(item.filename !== undefined ? { filename: item.filename } : {}),
        },
      });
    }

    const text = response.text?.trim() ?? '';
    const actions = response.actions ?? [];

    if (text.length === 0 && actions.length === 0) return payloads;

    const limit = capabilities.maxTextLength ?? text.length;

    if (actions.length === 0) {
      for (const chunk of splitText(text, limit)) {
        payloads.push({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: { body: chunk, preview_url: false },
        });
      }

      return payloads;
    }

    // Interactive messages cannot be split, so any overflow text is sent first as plain
    // messages and the interactive body carries only the final chunk.
    const chunks = splitText(text.length > 0 ? text : ' ', limit);
    const bodyText = chunks.pop() ?? ' ';

    for (const chunk of chunks) {
      payloads.push({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: chunk, preview_url: false },
      });
    }

    payloads.push(this.renderInteractive(to, bodyText, actions, capabilities.maxActions));

    return payloads;
  }

  /**
   * Buttons up to Meta's limit of three; beyond that a list message, which supports ten
   * rows. Sending four buttons is rejected by the API outright.
   */
  private renderInteractive(
    to: string,
    body: string,
    actions: readonly Action[],
    maxButtons: number,
  ): Record<string, unknown> {
    const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'interactive' };

    if (actions.length <= maxButtons) {
      return {
        ...base,
        interactive: {
          type: 'button',
          body: { text: body },
          action: {
            buttons: actions.map((action) => ({
              type: 'reply',
              // Meta caps button titles at 20 characters and rejects longer ones.
              reply: { id: action.payload, title: truncate(action.title, 20) },
            })),
          },
        },
      };
    }

    return {
      ...base,
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: 'Choose',
          sections: [
            {
              title: 'Options',
              rows: actions.slice(0, 10).map((action) => ({
                id: action.payload,
                title: truncate(action.title, 24),
                ...(action.description !== undefined
                  ? { description: truncate(action.description, 72) }
                  : {}),
              })),
            },
          ],
        },
      },
    };
  }

  /**
   * Sends one payload, retrying only where a retry cannot duplicate the message.
   */
  private async post(
    payload: Record<string, unknown>,
    deadline: number,
  ): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string }> {
    let last: { ok: false; error: string; retryable: boolean } = {
      ok: false,
      error: 'no attempt was made',
      retryable: false,
    };

    for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt += 1) {
      const budget = deadline - Date.now();

      if (budget <= 0) {
        return { ok: false, error: `${last.error} (send deadline reached after ${attempt - 1} attempt(s))` };
      }

      const outcome = await this.attempt(payload, Math.min(SEND_TIMEOUT_MS, budget));

      if (outcome.ok) {
        if (attempt > 1) {
          this.logger.stage({
            component: COMPONENT,
            stage: `${STAGE}:Retry`,
            input: { attempt },
            action: `Delivered on attempt ${attempt} after a transient failure`,
            output: { recovered: true },
          });
        }
        return outcome;
      }

      last = outcome;

      // No point sleeping through a backoff we cannot afford to act on.
      if (!outcome.retryable || attempt === MAX_SEND_ATTEMPTS || Date.now() >= deadline) break;

      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:Retry`,
        input: { attempt, of: MAX_SEND_ATTEMPTS },
        action: 'Transient send failure; retrying after backoff',
        error: new Error(outcome.error),
      });

      await this.backoff(attempt);
    }

    return { ok: false, error: last.error };
  }

  private async attempt(
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string; retryable: boolean }> {
    try {
      const response = await fetch(
        `https://graph.facebook.com/${this.graphVersion}/${this.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(timeoutMs),
        },
      );

      const body = (await response.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { message?: string; code?: number; error_data?: { details?: string } };
      };

      if (!response.ok) {
        const detail = body.error?.error_data?.details ?? body.error?.message ?? 'unknown error';

        // 429 and 5xx mean Meta answered and definitively did not accept the message, so a
        // retry cannot duplicate it. Every other 4xx is a decision — bad token, invalid
        // recipient, outside the 24-hour service window — and retrying only burns quota and
        // delays an honest failure.
        const retryable = response.status === 429 || response.status >= 500;

        return { ok: false, error: `Graph API ${response.status}: ${detail}`, retryable };
      }

      const providerMessageId = body.messages?.[0]?.id;

      return providerMessageId === undefined ? { ok: true } : { ok: true, providerMessageId };
    } catch (error) {
      return { ok: false, ...classify(error) };
    }
  }

  /** Exponential backoff with jitter, so concurrent turns do not retry in lockstep. */
  private async backoff(attempt: number): Promise<void> {
    const delay = RETRY_BASE_MS * 2 ** (attempt - 1) * (0.5 + Math.random());
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * Turns a thrown fetch error into a message worth reading and a retry decision.
 *
 * `fetch` throws a bare `TypeError: fetch failed` and hides the real reason in `cause`, which
 * is how an IPv6 route problem reached production logs as four uninformative words. The chain
 * is unwound here so the log names the actual failure.
 *
 * The retry decision is deliberately conservative. Only connection-phase failures are retried,
 * because those prove nothing was sent. A socket reset or a client-side timeout mid-flight is
 * ambiguous — Meta may well have accepted and delivered the message — and WhatsApp offers no
 * idempotency key, so retrying those would risk sending a user the same notice twice. A missing
 * message is bad; a duplicate deduction notice is worse.
 */
function classify(error: unknown): { error: string; retryable: boolean } {
  const parts: string[] = [];
  let code: string | undefined;
  let current: unknown = error;

  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const withCode = current as Error & { code?: string; errors?: unknown[] };

    if (withCode.code !== undefined) code ??= withCode.code;
    if (current.message.length > 0) parts.push(current.message);

    // AggregateError from Happy Eyeballs: every address family failed, and the reason lives
    // on the individual attempts rather than the aggregate.
    const nested = Array.isArray(withCode.errors) ? withCode.errors[0] : undefined;
    current = (current as Error & { cause?: unknown }).cause ?? nested;
  }

  if (parts.length === 0) parts.push(String(error));

  const detail = [...new Set(parts)].join(': ');
  const named = code === undefined ? detail : `${detail} (${code})`;

  const isTimeout = error instanceof Error && error.name === 'TimeoutError';
  const retryable = code !== undefined && SAFE_TO_RETRY_CODES.has(code) && !isTimeout;

  return { error: `WhatsApp send failed: ${named}`, retryable };
}

/**
 * Splits text into channel-sized chunks on paragraph, then line, then word boundaries.
 *
 * Splitting mid-word makes a message look corrupted; splitting on structure preserves
 * readability of vendor lists, which are the longest thing this platform sends.
 */
export function splitText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit);

    const breakPoint = Math.max(
      window.lastIndexOf('\n\n'),
      window.lastIndexOf('\n'),
      window.lastIndexOf(' '),
    );

    // No natural boundary (a single very long token) — a hard cut is the only option.
    const cut = breakPoint > limit * 0.5 ? breakPoint : limit;

    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);

  return chunks;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
