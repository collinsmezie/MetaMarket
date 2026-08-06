import { PROVIDER_MESSAGE_ID_KEY } from '../../../domain/models/incoming-message';
import {
  mapWebhookToMessages,
  normalizePhoneNumber,
  type WhatsAppWebhookBody,
} from './whatsapp-payload.mapper';

/**
 * Mapper specs use real Meta webhook shapes.
 *
 * This is the boundary the whole channel-agnostic design rests on: if a payload shape is
 * mishandled here, no amount of correctness inward saves the turn.
 */

function envelope(
  message: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): WhatsAppWebhookBody {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
              contacts: [{ wa_id: '2348012345678', profile: { name: 'Emeka' } }],
              messages: [message],
              ...extra,
            },
          },
        ],
      },
    ],
  };
}

describe('mapWebhookToMessages', () => {
  it('maps a text message to a canonical text part', () => {
    const { messages } = mapWebhookToMessages(
      envelope({
        from: '2348012345678',
        id: 'wamid.HBgNMjM0ODAxMjM0NTY3OBUCABIYFjNBMDcyN0JGMDlBMEE2QkQxMkQ4AA==',
        timestamp: '1785412800',
        type: 'text',
        text: { body: 'I need artist brush' },
      }),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].parts).toEqual([{ type: 'text', text: 'I need artist brush' }]);
    expect(messages[0].channel).toBe('whatsapp');
    expect(messages[0].metadata[PROVIDER_MESSAGE_ID_KEY]).toContain('wamid.');
  });

  it('maps a voice note to an audio part flagged as voice, without downloading it', () => {
    const { messages } = mapWebhookToMessages(
      envelope({
        from: '2348012345678',
        id: 'wamid.audio',
        timestamp: '1785412800',
        type: 'audio',
        audio: { id: 'media_456', mime_type: 'audio/ogg; codecs=opus', voice: true },
      }),
    );

    // The adapter must produce a reference only: blocking the webhook on transcription is
    // what causes Meta retry storms.
    expect(messages[0].parts).toEqual([
      { type: 'audio', mediaId: 'media_456', mimeType: 'audio/ogg; codecs=opus', voice: true },
    ]);
  });

  it('distinguishes a shared audio file from a recorded voice note', () => {
    const { messages } = mapWebhookToMessages(
      envelope({
        from: '2348012345678',
        id: 'wamid.audiofile',
        timestamp: '1785412800',
        type: 'audio',
        audio: { id: 'media_789', mime_type: 'audio/mpeg' },
      }),
    );

    expect(messages[0].parts[0]).toMatchObject({ type: 'audio', voice: false });
  });

  it('maps an interactive button reply, preserving the payload id for deterministic resumption', () => {
    const { messages } = mapWebhookToMessages(
      envelope({
        from: '2348012345678',
        id: 'wamid.button',
        timestamp: '1785412800',
        type: 'interactive',
        interactive: {
          type: 'button_reply',
          button_reply: { id: 'mm|wf_123|view_sellers', title: 'View Suppliers' },
        },
      }),
    );

    expect(messages[0].parts).toEqual([
      { type: 'button_reply', payload: 'mm|wf_123|view_sellers', title: 'View Suppliers' },
    ]);
  });

  it('maps a list selection with its description', () => {
    const { messages } = mapWebhookToMessages(
      envelope({
        from: '2348012345678',
        id: 'wamid.list',
        timestamp: '1785412800',
        type: 'interactive',
        interactive: {
          type: 'list_reply',
          list_reply: {
            id: 'mm|wf_9|pick|vendor_3',
            title: 'Bright Electricals',
            description: '1.2 km away',
          },
        },
      }),
    );

    expect(messages[0].parts[0]).toMatchObject({
      type: 'list_selection',
      payload: 'mm|wf_9|pick|vendor_3',
      description: '1.2 km away',
    });
  });

  it('maps a location share', () => {
    const { messages } = mapWebhookToMessages(
      envelope({
        from: '2348012345678',
        id: 'wamid.loc',
        timestamp: '1785412800',
        type: 'location',
        location: { latitude: 5.1167, longitude: 7.3667, name: 'Aba' },
      }),
    );

    expect(messages[0].parts[0]).toMatchObject({ type: 'location', latitude: 5.1167, name: 'Aba' });
  });

  it('maps an image with its caption', () => {
    const { messages } = mapWebhookToMessages(
      envelope({
        from: '2348012345678',
        id: 'wamid.img',
        timestamp: '1785412800',
        type: 'image',
        image: { id: 'media_img', mime_type: 'image/jpeg', caption: 'my stock list' },
      }),
    );

    expect(messages[0].parts[0]).toMatchObject({
      type: 'image',
      mediaId: 'media_img',
      caption: 'my stock list',
    });
  });

  it('extracts several messages from one batched webhook', () => {
    const body: WhatsAppWebhookBody = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '2348011111111',
                    id: 'wamid.1',
                    timestamp: '1785412800',
                    type: 'text',
                    text: { body: 'hi' },
                  },
                  {
                    from: '2348022222222',
                    id: 'wamid.2',
                    timestamp: '1785412801',
                    type: 'text',
                    text: { body: 'hello' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const { messages } = mapWebhookToMessages(body);

    // Meta batches messages from different users into one POST.
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.userId)).toEqual(['+2348011111111', '+2348022222222']);
  });

  it('separates delivery statuses from conversational messages', () => {
    const body: WhatsAppWebhookBody = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.x', status: 'delivered' }] } }] }],
    };

    const { messages, statuses } = mapWebhookToMessages(body);

    expect(messages).toHaveLength(0);
    expect(statuses).toHaveLength(1);
  });

  it('reports unsupported message types as skipped rather than dropping them silently', () => {
    const { messages, skipped } = mapWebhookToMessages(
      envelope({ from: '2348012345678', id: 'wamid.reaction', timestamp: '1785412800', type: 'reaction' }),
    );

    expect(messages).toHaveLength(0);
    expect(skipped[0].reason).toContain('reaction');
  });

  it('never throws on a malformed payload', () => {
    // Providers ship new shapes without notice; a mapper crash would 500 the webhook.
    expect(() => mapWebhookToMessages({} as WhatsAppWebhookBody)).not.toThrow();
    expect(() => mapWebhookToMessages({ entry: [{}] } as WhatsAppWebhookBody)).not.toThrow();
    expect(() => mapWebhookToMessages({ entry: [{ changes: [{}] }] } as WhatsAppWebhookBody)).not.toThrow();
  });

  it('falls back to the current time when the timestamp is unparseable', () => {
    const { messages } = mapWebhookToMessages(
      envelope({
        from: '2348012345678',
        id: 'wamid.badtime',
        timestamp: 'not-a-number',
        type: 'text',
        text: { body: 'hi' },
      }),
    );

    expect(messages[0].timestamp.getTime()).not.toBeNaN();
  });
});

describe('normalizePhoneNumber', () => {
  it('produces the same identity regardless of provider formatting', () => {
    // Meta omits the '+', Twilio includes it; treating these as different users would split
    // one person's conversation across channels.
    expect(normalizePhoneNumber('2348012345678')).toBe('+2348012345678');
    expect(normalizePhoneNumber('+234 801 234 5678')).toBe('+2348012345678');
    expect(normalizePhoneNumber('+234-801-234-5678')).toBe('+2348012345678');
  });
});
