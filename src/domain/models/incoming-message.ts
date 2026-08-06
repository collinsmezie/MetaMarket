import type { Channel } from './channel';

/**
 * Canonical inbound message model (MCOS §12).
 *
 * Channel adapters translate provider payloads into this shape and nothing downstream
 * ever sees a Meta/Twilio structure again. Media arrives here as a *reference* only —
 * an adapter must not block a webhook on downloading and transcribing a voice note;
 * that is the Media Processing Service's job (MCOS §5.2, §20).
 */

export const MESSAGE_PART_TYPES = [
  'text',
  'image',
  'audio',
  'video',
  'document',
  'contact',
  'location',
  'button_reply',
  'list_selection',
] as const;

export type MessagePartType = (typeof MESSAGE_PART_TYPES)[number];

interface MessagePartBase {
  readonly type: MessagePartType;
}

export interface TextPart extends MessagePartBase {
  readonly type: 'text';
  readonly text: string;
}

/** Media parts carry a provider media handle; bytes are fetched asynchronously. */
export interface MediaPart extends MessagePartBase {
  readonly type: 'image' | 'audio' | 'video' | 'document';
  readonly mediaId: string;
  readonly mimeType?: string;
  readonly filename?: string;
  /** Provider-supplied caption, e.g. a WhatsApp image caption. */
  readonly caption?: string;
  /** True when the channel flags the audio as a voice note rather than a music file. */
  readonly voice?: boolean;
}

export interface ContactPart extends MessagePartBase {
  readonly type: 'contact';
  readonly name: string;
  readonly phones: readonly string[];
}

export interface LocationPart extends MessagePartBase {
  readonly type: 'location';
  readonly latitude: number;
  readonly longitude: number;
  readonly name?: string;
  readonly address?: string;
}

/**
 * A tap on an interactive button.
 *
 * `payload` is the opaque id the platform itself minted when composing the outbound
 * message. It carries the originating workflow id, which is what lets the Workflow
 * Manager resume deterministically instead of guessing semantically (MCOS §12 Stage 13).
 */
export interface ButtonReplyPart extends MessagePartBase {
  readonly type: 'button_reply';
  readonly payload: string;
  readonly title: string;
}

export interface ListSelectionPart extends MessagePartBase {
  readonly type: 'list_selection';
  readonly payload: string;
  readonly title: string;
  readonly description?: string;
}

export type MessagePart =
  TextPart | MediaPart | ContactPart | LocationPart | ButtonReplyPart | ListSelectionPart;

export interface IncomingMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly channel: Channel;
  readonly timestamp: Date;
  readonly parts: readonly MessagePart[];
  /**
   * Channel-specific detail preserved for audit and debugging only.
   * Business logic reading this would violate MCOS §3.1.
   */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/** The provider's own message id, used to make webhook processing idempotent. */
export const PROVIDER_MESSAGE_ID_KEY = 'providerMessageId';

export function isTextPart(part: MessagePart): part is TextPart {
  return part.type === 'text';
}

export function isMediaPart(part: MessagePart): part is MediaPart {
  return part.type === 'image' || part.type === 'audio' || part.type === 'video' || part.type === 'document';
}

export function isInteractiveReplyPart(part: MessagePart): part is ButtonReplyPart | ListSelectionPart {
  return part.type === 'button_reply' || part.type === 'list_selection';
}

/** True when the message needs asynchronous media work before it can be understood. */
export function requiresMediaProcessing(message: IncomingMessage): boolean {
  return message.parts.some(isMediaPart);
}
