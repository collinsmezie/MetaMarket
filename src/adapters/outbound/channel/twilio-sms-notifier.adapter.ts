import { Inject, Injectable } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import type { Channel } from '../../../domain/models/channel';
import { CHANNEL_CAPABILITIES } from '../../../domain/models/channel';
import type { Response } from '../../../domain/models/response';
import type {
  ChannelNotifierPort,
  DeliveryResult,
  DeliveryTarget,
} from '../../../domain/ports/outbound/channel-notifier.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../../domain/ports/outbound/stage-logger.port';
import { splitText } from './whatsapp-notifier.adapter';

const COMPONENT = 'MCOS';
const STAGE = 'TwilioSmsNotifier';

const SEND_TIMEOUT_MS = 15_000;

/**
 * SMS delivery via Twilio.
 *
 * Exists as much to prove the channel abstraction as to serve SMS users: the same canonical
 * Response that becomes a WhatsApp interactive message here degrades into numbered plain
 * text, with no workflow aware of the difference (MCOS §3.1).
 */
@Injectable()
export class TwilioSmsNotifier implements ChannelNotifierPort {
  readonly channel: Channel = 'sms';

  private readonly accountSid: string | undefined;
  private readonly authToken: string | undefined;
  private readonly from: string | undefined;

  constructor(
    config: AppConfigService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {
    const twilio = config.twilio;
    this.accountSid = twilio.accountSid;
    this.authToken = twilio.authToken;
    this.from = twilio.messagingFrom;
  }

  async send(target: DeliveryTarget, response: Response): Promise<DeliveryResult> {
    if (this.accountSid === undefined || this.authToken === undefined || this.from === undefined) {
      return {
        delivered: false,
        error:
          'TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_FROM must be configured to deliver SMS.',
      };
    }

    const body = this.flatten(response);
    if (body.length === 0) {
      return { delivered: false, error: 'Response contained no text renderable as SMS.' };
    }

    const chunks = splitText(body, CHANNEL_CAPABILITIES.sms.maxTextLength ?? body.length);
    let lastSid: string | undefined;

    for (const [index, chunk] of chunks.entries()) {
      const result = await this.post(target.address, chunk);

      if (!result.ok) {
        return {
          delivered: false,
          error:
            index === 0
              ? result.error
              : `Delivered ${index} of ${chunks.length} SMS parts before failing: ${result.error}`,
        };
      }

      lastSid = result.sid;
    }

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: { to: target.address },
      action: `Delivered the response as ${chunks.length} SMS part(s)`,
      output: { sid: lastSid, messageCount: chunks.length },
    });

    return {
      delivered: true,
      ...(lastSid !== undefined ? { providerMessageId: lastSid } : {}),
      messageCount: chunks.length,
    };
  }

  /**
   * Flattens a canonical response into plain text.
   *
   * SMS has no buttons, so actions become a numbered list the user can reply to. Media
   * becomes a URL, because a link is more useful than silently dropping the attachment.
   */
  private flatten(response: Response): string {
    const sections: string[] = [];

    if (response.text !== undefined && response.text.trim().length > 0) {
      sections.push(response.text.trim());
    }

    for (const item of response.media ?? []) {
      sections.push(item.caption !== undefined ? `${item.caption}: ${item.url}` : item.url);
    }

    const actions = response.actions ?? [];
    if (actions.length > 0) {
      sections.push(actions.map((action, index) => `${index + 1}. ${action.title}`).join('\n'));
      sections.push('Reply with the number of your choice.');
    }

    return sections.join('\n\n');
  }

  private async post(
    to: string,
    body: string,
  ): Promise<{ ok: true; sid?: string } | { ok: false; error: string }> {
    const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ To: to, From: this.from ?? '', Body: body }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        },
      );

      const payload = (await response.json().catch(() => ({}))) as { sid?: string; message?: string };

      if (!response.ok) {
        return { ok: false, error: `Twilio ${response.status}: ${payload.message ?? 'unknown error'}` };
      }

      return payload.sid === undefined ? { ok: true } : { ok: true, sid: payload.sid };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `SMS send failed: ${message}` };
    }
  }
}
