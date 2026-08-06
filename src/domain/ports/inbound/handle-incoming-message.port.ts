import type { IncomingMessage } from '../../models/incoming-message';
import type { Response } from '../../models/response';

/**
 * The single entry point channel adapters call (ADR-001 driver port).
 *
 * Every channel — WhatsApp, SMS, Voice, USSD — funnels through this one method, which is
 * what makes adding a channel a matter of writing an adapter and nothing else.
 */

export const HANDLE_INCOMING_MESSAGE = Symbol('HandleIncomingMessage');

export interface HandleIncomingMessageResult {
  readonly conversationId: string;
  /** The response composed for the user, if the turn produced one synchronously. */
  readonly response: Response | null;
  /** Workflow that handled the turn, absent when the message was ignored or deduplicated. */
  readonly workflowId: string | null;
  /**
   * True when the message duplicated one already processed.
   *
   * Meta retries webhooks, so this is a normal outcome rather than an error, and callers
   * must not re-deliver a response for it.
   */
  readonly deduplicated: boolean;
  /**
   * True when the turn was parked awaiting asynchronous media processing; the response
   * will be delivered when the media job completes.
   */
  readonly deferred: boolean;
}

export interface HandleIncomingMessagePort {
  handle(message: IncomingMessage): Promise<HandleIncomingMessageResult>;
}
