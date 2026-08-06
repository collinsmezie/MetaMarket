/**
 * The communication channels the platform speaks.
 *
 * This is the *only* place the domain acknowledges that channels exist, and it does so
 * as an opaque label used for delivery routing and formatting hints. No business rule
 * may branch on the channel value (MCOS §3.1) — adding `telegram` here must never
 * require touching a workflow.
 */
export const CHANNELS = ['whatsapp', 'sms', 'voice', 'ussd'] as const;

export type Channel = (typeof CHANNELS)[number];

export function isChannel(value: string): value is Channel {
  return (CHANNELS as readonly string[]).includes(value);
}

/**
 * Delivery capabilities of a channel, used by the Channel Formatter to decide how to
 * render a canonical Response. Kept as data so the domain never asks "is this WhatsApp?".
 */
export interface ChannelCapabilities {
  readonly supportsRichText: boolean;
  readonly supportsButtons: boolean;
  readonly supportsLists: boolean;
  readonly supportsMedia: boolean;
  /** Hard character ceiling per outbound message, or null when effectively unbounded. */
  readonly maxTextLength: number | null;
  /** Maximum interactive actions the channel can render in one message. */
  readonly maxActions: number;
}

export const CHANNEL_CAPABILITIES: Readonly<Record<Channel, ChannelCapabilities>> = {
  whatsapp: {
    supportsRichText: true,
    supportsButtons: true,
    supportsLists: true,
    supportsMedia: true,
    maxTextLength: 4096,
    // Meta renders at most 3 reply buttons; beyond that a list message is required.
    maxActions: 3,
  },
  sms: {
    supportsRichText: false,
    supportsButtons: false,
    supportsLists: false,
    supportsMedia: false,
    maxTextLength: 1600,
    maxActions: 0,
  },
  voice: {
    supportsRichText: false,
    supportsButtons: false,
    supportsLists: false,
    supportsMedia: false,
    maxTextLength: null,
    maxActions: 0,
  },
  ussd: {
    supportsRichText: false,
    supportsButtons: false,
    // USSD menus are numbered lists rendered as plain text.
    supportsLists: true,
    supportsMedia: false,
    maxTextLength: 182,
    maxActions: 9,
  },
};
