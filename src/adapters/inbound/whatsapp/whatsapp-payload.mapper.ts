import { randomUUID } from 'node:crypto';
import type { IncomingMessage, MessagePart } from '../../../domain/models/incoming-message';
import { PROVIDER_MESSAGE_ID_KEY } from '../../../domain/models/incoming-message';
import { normalizePhoneNumber } from '../../../domain/models/user-identity';

// Re-exported because identity normalisation moved to the domain when the web channel
// arrived, and every inbound adapter must resolve a user the same way.
export { normalizePhoneNumber };

/**
 * Translates Meta Cloud API webhook payloads into canonical messages (ADR-001 inbound adapter).
 *
 * Pure functions with no business logic and no AI calls, per Execution.md §2.1 — this file
 * is the only place in the codebase that understands Meta's payload shape.
 */

/** The subset of Meta's webhook envelope this adapter reads. */
export interface WhatsAppWebhookBody {
  readonly object?: string;
  readonly entry?: readonly {
    readonly id?: string;
    readonly changes?: readonly {
      readonly field?: string;
      readonly value?: WhatsAppChangeValue;
    }[];
  }[];
}

interface WhatsAppChangeValue {
  readonly messaging_product?: string;
  readonly metadata?: { readonly display_phone_number?: string; readonly phone_number_id?: string };
  readonly contacts?: readonly { readonly wa_id?: string; readonly profile?: { readonly name?: string } }[];
  readonly messages?: readonly WhatsAppMessage[];
  readonly statuses?: readonly WhatsAppStatus[];
}

interface WhatsAppMessage {
  readonly id?: string;
  readonly from?: string;
  readonly timestamp?: string;
  readonly type?: string;
  readonly text?: { readonly body?: string };
  readonly image?: WhatsAppMedia;
  readonly audio?: WhatsAppMedia & { readonly voice?: boolean };
  readonly video?: WhatsAppMedia;
  readonly document?: WhatsAppMedia & { readonly filename?: string };
  readonly location?: {
    readonly latitude?: number;
    readonly longitude?: number;
    readonly name?: string;
    readonly address?: string;
  };
  readonly contacts?: readonly {
    readonly name?: { readonly formatted_name?: string };
    readonly phones?: readonly { readonly phone?: string }[];
  }[];
  readonly interactive?: {
    readonly type?: string;
    readonly button_reply?: { readonly id?: string; readonly title?: string };
    readonly list_reply?: { readonly id?: string; readonly title?: string; readonly description?: string };
  };
  readonly button?: { readonly payload?: string; readonly text?: string };
  readonly errors?: readonly { readonly code?: number; readonly title?: string }[];
}

interface WhatsAppMedia {
  readonly id?: string;
  readonly mime_type?: string;
  readonly caption?: string;
  readonly sha256?: string;
}

export interface WhatsAppStatus {
  readonly id?: string;
  readonly status?: string;
  readonly recipient_id?: string;
  readonly timestamp?: string;
  readonly errors?: readonly { readonly code?: number; readonly title?: string }[];
}

export interface MappedWebhook {
  readonly messages: readonly IncomingMessage[];
  /** Delivery receipts and read receipts, which carry no conversational content. */
  readonly statuses: readonly WhatsAppStatus[];
  /**
   * Payload entries that could not be mapped, with the reason.
   * Reported rather than dropped so unmapped shapes are visible in logs.
   */
  readonly skipped: readonly { readonly reason: string; readonly messageId?: string }[];
}

/**
 * Extracts every canonical message in a webhook body.
 *
 * Meta batches several messages, from several users, into a single POST, so this returns a
 * list. It never throws: a malformed entry is reported in `skipped` so the webhook can
 * still acknowledge and process its healthy siblings.
 */
export function mapWebhookToMessages(body: WhatsAppWebhookBody): MappedWebhook {
  const messages: IncomingMessage[] = [];
  const statuses: WhatsAppStatus[] = [];
  const skipped: { reason: string; messageId?: string }[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (value === undefined) continue;

      for (const status of value.statuses ?? []) statuses.push(status);

      for (const raw of value.messages ?? []) {
        const mapped = mapMessage(raw, value);

        if (mapped === null) {
          skipped.push({
            reason: `Unsupported or empty message of type "${raw.type ?? 'unknown'}"`,
            ...(raw.id !== undefined ? { messageId: raw.id } : {}),
          });
          continue;
        }

        messages.push(mapped);
      }
    }
  }

  return { messages, statuses, skipped };
}

function mapMessage(raw: WhatsAppMessage, value: WhatsAppChangeValue): IncomingMessage | null {
  const from = raw.from;
  if (from === undefined || from.length === 0) return null;

  const parts = mapParts(raw);
  if (parts.length === 0) return null;

  const contactName = value.contacts?.[0]?.profile?.name;

  return {
    id: randomUUID(),
    // Resolved to the platform conversation by the context manager, keyed on userId.
    conversationId: '',
    // E.164 without the '+' as Meta sends it; normalised so the same human is one identity
    // whether they later arrive over SMS or voice.
    userId: normalizePhoneNumber(from),
    channel: 'whatsapp',
    timestamp: parseTimestamp(raw.timestamp),
    parts,
    metadata: {
      [PROVIDER_MESSAGE_ID_KEY]: raw.id ?? null,
      provider: 'meta',
      phoneNumberId: value.metadata?.phone_number_id ?? null,
      ...(contactName !== undefined ? { profileName: contactName } : {}),
      ...(raw.errors !== undefined ? { providerErrors: raw.errors } : {}),
    },
  };
}

function mapParts(raw: WhatsAppMessage): MessagePart[] {
  switch (raw.type) {
    case 'text': {
      const text = raw.text?.body;
      return text === undefined || text.length === 0 ? [] : [{ type: 'text', text }];
    }

    case 'image':
      return mapMedia('image', raw.image);

    case 'audio': {
      const parts = mapMedia('audio', raw.audio);
      // Distinguishes a recorded voice note from a shared audio file; only the former is
      // reliably conversational speech.
      return parts.map((part) =>
        part.type === 'audio' ? { ...part, voice: raw.audio?.voice === true } : part,
      );
    }

    case 'video':
      return mapMedia('video', raw.video);

    case 'document': {
      const parts = mapMedia('document', raw.document);
      const filename = raw.document?.filename;
      return filename === undefined
        ? parts
        : parts.map((part) => (part.type === 'document' ? { ...part, filename } : part));
    }

    case 'location': {
      const { latitude, longitude, name, address } = raw.location ?? {};
      if (latitude === undefined || longitude === undefined) return [];
      return [
        {
          type: 'location',
          latitude,
          longitude,
          ...(name !== undefined ? { name } : {}),
          ...(address !== undefined ? { address } : {}),
        },
      ];
    }

    case 'contacts': {
      const contact = raw.contacts?.[0];
      const name = contact?.name?.formatted_name;
      if (name === undefined) return [];

      const phones = (contact?.phones ?? [])
        .map((phone) => phone.phone)
        .filter((phone): phone is string => phone !== undefined);

      return [{ type: 'contact', name, phones }];
    }

    case 'interactive': {
      const buttonReply = raw.interactive?.button_reply;
      if (buttonReply?.id !== undefined) {
        return [{ type: 'button_reply', payload: buttonReply.id, title: buttonReply.title ?? '' }];
      }

      const listReply = raw.interactive?.list_reply;
      if (listReply?.id !== undefined) {
        return [
          {
            type: 'list_selection',
            payload: listReply.id,
            title: listReply.title ?? '',
            ...(listReply.description !== undefined ? { description: listReply.description } : {}),
          },
        ];
      }

      return [];
    }

    case 'button': {
      // Template quick-reply buttons use a different shape from interactive replies.
      const payload = raw.button?.payload;
      return payload === undefined ? [] : [{ type: 'button_reply', payload, title: raw.button?.text ?? '' }];
    }

    default:
      // Reactions, stickers, system messages, order messages, and anything Meta adds later.
      return [];
  }
}

function mapMedia(
  type: 'image' | 'audio' | 'video' | 'document',
  media: WhatsAppMedia | undefined,
): MessagePart[] {
  if (media?.id === undefined) return [];

  return [
    {
      type,
      mediaId: media.id,
      ...(media.mime_type !== undefined ? { mimeType: media.mime_type } : {}),
      ...(media.caption !== undefined ? { caption: media.caption } : {}),
    },
  ];
}

/**
 * Meta sends Unix seconds as a string. An unparseable value falls back to "now" rather than
 * producing an invalid Date that would corrupt history ordering.
 */
function parseTimestamp(timestamp: string | undefined): Date {
  if (timestamp === undefined) return new Date();

  const seconds = Number.parseInt(timestamp, 10);
  return Number.isFinite(seconds) ? new Date(seconds * 1_000) : new Date();
}
