import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Observable, Subject } from 'rxjs';
import type { Response } from '../../../domain/models/response';
import { RedisService } from '../persistence/redis.service';

/**
 * Fan-out bus for the web channel.
 *
 * The web client holds an SSE connection; the turn that answers it may be running on a
 * different replica, because inbound HTTP and the conversation lock are load-balanced
 * independently of which node happens to hold the browser's socket. So delivery goes through
 * Redis pub/sub rather than an in-process map: an in-process map works on one machine and
 * silently drops every reply the moment a second replica exists.
 *
 * `publish` returns Redis's own subscriber count, which is exactly the signal the notifier
 * needs to distinguish "the user is watching" from "queue it for when they come back".
 */

export type WebStreamEvent =
  | {
      readonly kind: 'message';
      readonly conversationId: string;
      /** The canonical response. Rendering stays the client's concern (MCOS §13). */
      readonly response: Response;
      readonly workflowId?: string;
      readonly at: string;
    }
  | {
      readonly kind: 'typing';
      readonly conversationId: string;
      readonly at: string;
    };

/** Redis channel namespace. Pattern-subscribed once rather than per conversation. */
const KEY_PREFIX = 'mcos:web:';
const KEY_PATTERN = `${KEY_PREFIX}*`;

@Injectable()
export class WebStreamHub implements OnModuleDestroy {
  private readonly logger = new Logger(WebStreamHub.name);
  /**
   * A connection in subscriber mode cannot run ordinary commands, so this must be a
   * dedicated one rather than the shared client.
   */
  private readonly subscriber: Redis;
  /** conversationId → the SSE subscribers attached to *this* replica. */
  private readonly local = new Map<string, Set<Subject<WebStreamEvent>>>();

  constructor(private readonly redis: RedisService) {
    this.subscriber = redis.client.duplicate();

    this.subscriber.on('error', (error) =>
      this.logger.error(`Web stream subscriber error: ${error.message}`),
    );

    void this.subscriber.psubscribe(KEY_PATTERN).catch((error: Error) => {
      // Without the subscription this replica delivers nothing over SSE. It is still able to
      // accept messages and queue replies, so the process must not die — but this is loud.
      this.logger.error(`Could not subscribe to "${KEY_PATTERN}": ${error.message}`);
    });

    this.subscriber.on('pmessage', (_pattern: string, channel: string, payload: string) => {
      this.dispatchLocally(channel.slice(KEY_PREFIX.length), payload);
    });
  }

  /**
   * Publishes an event to every replica.
   *
   * @returns how many subscribers received it across the cluster; 0 means nobody is watching.
   */
  async publish(event: WebStreamEvent): Promise<number> {
    return this.redis.client.publish(`${KEY_PREFIX}${event.conversationId}`, JSON.stringify(event));
  }

  /** The event stream for one conversation, scoped to the lifetime of the subscription. */
  stream(conversationId: string): Observable<WebStreamEvent> {
    return new Observable<WebStreamEvent>((subscriber) => {
      const subject = new Subject<WebStreamEvent>();
      const subscription = subject.subscribe(subscriber);

      const listeners = this.local.get(conversationId) ?? new Set<Subject<WebStreamEvent>>();
      listeners.add(subject);
      this.local.set(conversationId, listeners);

      return () => {
        listeners.delete(subject);
        // Leaving empty sets behind would leak one map entry per conversation that ever
        // connected, which on a long-lived process is unbounded.
        if (listeners.size === 0) this.local.delete(conversationId);

        subscription.unsubscribe();
        subject.complete();
      };
    });
  }

  private dispatchLocally(conversationId: string, payload: string): void {
    const listeners = this.local.get(conversationId);
    if (listeners === undefined || listeners.size === 0) return;

    let event: WebStreamEvent;
    try {
      event = JSON.parse(payload) as WebStreamEvent;
    } catch (error) {
      this.logger.error(
        `Discarded an unparseable web stream payload for ${conversationId}: ${String(error)}`,
      );
      return;
    }

    for (const listener of listeners) listener.next(event);
  }

  async onModuleDestroy(): Promise<void> {
    for (const listeners of this.local.values()) {
      for (const listener of listeners) listener.complete();
    }
    this.local.clear();

    await this.subscriber.quit();
  }
}
