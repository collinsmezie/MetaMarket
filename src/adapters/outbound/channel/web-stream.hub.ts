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
 * Presence is tracked separately from pub/sub, and deliberately so. `PUBLISH` returns the
 * number of *Redis* subscribers, which counts every replica's pattern subscription whether or
 * not a browser is attached to it — so it is never zero and cannot answer the only question
 * the notifier actually asks: is anyone there to receive this? Getting that wrong marks
 * replies delivered when nobody is listening, which loses exactly the messages composed while
 * the user's laptop was asleep.
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

/** One presence hash per conversation: connection id → expiry epoch millis. */
const PRESENCE_PREFIX = 'mcos:web:present:';

/**
 * How long a connection is presumed present without refreshing.
 *
 * Generous relative to {@link PRESENCE_REFRESH_MS} so that one missed refresh — a GC pause, a
 * brief Redis blip — does not make a live browser look absent and send its reply to the queue.
 */
const PRESENCE_TTL_MS = 45_000;
const PRESENCE_REFRESH_MS = 15_000;

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
  private nextConnectionId = 0;

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
   * Publishes an event to whichever replica holds the listener.
   *
   * Presence is checked first: with nobody attached there is no point publishing, and the
   * caller needs the zero in order to queue. A client that disconnects between the check and
   * the publish loses that one message — the same race WhatsApp has between the Graph API
   * accepting a message and the handset receiving it, and not one an SSE stream can close
   * without acknowledgements.
   *
   * @returns how many connections are attached across the cluster; 0 means nobody is watching.
   */
  async publish(event: WebStreamEvent): Promise<number> {
    const listeners = await this.listenerCount(event.conversationId);
    if (listeners === 0) return 0;

    await this.redis.client.publish(`${KEY_PREFIX}${event.conversationId}`, JSON.stringify(event));

    return listeners;
  }

  /**
   * Connections currently attached to this conversation, on any replica.
   *
   * Expired entries are pruned on read, which is what stops a replica that died mid-stream
   * from making a conversation look permanently watched.
   */
  async listenerCount(conversationId: string): Promise<number> {
    const key = `${PRESENCE_PREFIX}${conversationId}`;

    let present: Record<string, string>;
    try {
      present = await this.redis.client.hgetall(key);
    } catch (error) {
      // Redis being unreachable means the reply cannot be published either. Reporting zero
      // sends it to the durable queue, which is the right outcome.
      this.logger.error(`Could not read web presence for ${conversationId}: ${String(error)}`);
      return 0;
    }

    const now = Date.now();
    const stale: string[] = [];
    let live = 0;

    for (const [connectionId, expiresAt] of Object.entries(present)) {
      if (Number(expiresAt) > now) live += 1;
      else stale.push(connectionId);
    }

    if (stale.length > 0) {
      void this.redis.client.hdel(key, ...stale).catch(() => {
        // Pruning is opportunistic; the entries stay expired and will be pruned next read.
      });
    }

    return live;
  }

  /** The event stream for one conversation, scoped to the lifetime of the subscription. */
  stream(conversationId: string): Observable<WebStreamEvent> {
    return new Observable<WebStreamEvent>((subscriber) => {
      const subject = new Subject<WebStreamEvent>();
      const subscription = subject.subscribe(subscriber);
      const connectionId = `c${(this.nextConnectionId += 1)}`;

      const listeners = this.local.get(conversationId) ?? new Set<Subject<WebStreamEvent>>();
      listeners.add(subject);
      this.local.set(conversationId, listeners);

      void this.markPresent(conversationId, connectionId);
      const refresh = setInterval(
        () => void this.markPresent(conversationId, connectionId),
        PRESENCE_REFRESH_MS,
      );

      return () => {
        clearInterval(refresh);
        void this.markAbsent(conversationId, connectionId);

        listeners.delete(subject);
        // Leaving empty sets behind would leak one map entry per conversation that ever
        // connected, which on a long-lived process is unbounded.
        if (listeners.size === 0) this.local.delete(conversationId);

        subscription.unsubscribe();
        subject.complete();
      };
    });
  }

  private async markPresent(conversationId: string, connectionId: string): Promise<void> {
    const key = `${PRESENCE_PREFIX}${conversationId}`;

    try {
      await this.redis.client.hset(key, connectionId, String(Date.now() + PRESENCE_TTL_MS));
      // Expire the whole hash as a backstop, so an abandoned conversation cannot leave a key
      // behind for ever if teardown never ran.
      await this.redis.client.pexpire(key, PRESENCE_TTL_MS * 2);
    } catch (error) {
      // A browser that cannot register presence still receives anything published while it is
      // attached; it only loses the queue-on-disconnect guarantee.
      this.logger.warn(`Could not record web presence for ${conversationId}: ${String(error)}`);
    }
  }

  private async markAbsent(conversationId: string, connectionId: string): Promise<void> {
    try {
      await this.redis.client.hdel(`${PRESENCE_PREFIX}${conversationId}`, connectionId);
    } catch {
      // The entry expires on its own; a failed cleanup costs at most one wasted publish.
    }
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
