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

    for (const [index, payload] of payloads.entries()) {
      const result = await this.post(payload);

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

  private async post(
    payload: Record<string, unknown>,
  ): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string }> {
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
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        },
      );

      const body = (await response.json().catch(() => ({}))) as {
        messages?: { id?: string }[];
        error?: { message?: string; code?: number; error_data?: { details?: string } };
      };

      if (!response.ok) {
        const detail = body.error?.error_data?.details ?? body.error?.message ?? 'unknown error';
        return { ok: false, error: `Graph API ${response.status}: ${detail}` };
      }

      const providerMessageId = body.messages?.[0]?.id;

      return providerMessageId === undefined ? { ok: true } : { ok: true, providerMessageId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `WhatsApp send failed: ${message}` };
    }
  }
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
