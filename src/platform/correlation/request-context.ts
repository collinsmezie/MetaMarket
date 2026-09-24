import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Request correlation context (Overarching TDR §25, §26; Directive §26).
 *
 * Every unit of work that crosses a component boundary carries these identifiers so a single
 * inbound message can be traced through turn assembly, orchestration, every specialist call,
 * every persisted decision and the final delivery. They travel implicitly through
 * `AsyncLocalStorage` so domain and application code never has to thread them by hand — and
 * therefore can never forget to.
 *
 * Identifier semantics:
 *  - `correlationId` — one per inbound stimulus (HTTP request, webhook, queue job). Never changes
 *    as work fans out.
 *  - `requestId` — one per component invocation. A child invocation gets a new `requestId` and
 *    records its parent, forming the `REQ-001 → REQ-002 (parent=REQ-001)` chain the TDR asks for.
 *  - `conversationId`, `turnId`, `runId`, `messageId` — MCOS identities, filled in as soon as
 *    they are known (`runId = turn:{turnId}` per MCOS §8).
 */
export interface RequestContext {
  readonly correlationId: string;
  readonly requestId: string;
  readonly parentRequestId: string | null;
  readonly component: string | null;
  readonly conversationId: string | null;
  readonly turnId: string | null;
  readonly runId: string | null;
  readonly messageId: string | null;
  /** Workflow action currently executing, when inside the scheduler (MCOS §49). */
  readonly actionId: string | null;
}

export type RequestContextPatch = Partial<Omit<RequestContext, 'correlationId'>>;

const storage = new AsyncLocalStorage<RequestContext>();

export function newRequestId(): string {
  return `req_${randomUUID()}`;
}

export function newCorrelationId(): string {
  return `corr_${randomUUID()}`;
}

/** Derives the orchestration run id for a logical turn (MCOS §8: `run_id = turn:{turnId}`). */
export function runIdForTurn(turnId: string): string {
  return `turn:${turnId}`;
}

function build(base: Partial<RequestContext>): RequestContext {
  return {
    correlationId: base.correlationId ?? newCorrelationId(),
    requestId: base.requestId ?? newRequestId(),
    parentRequestId: base.parentRequestId ?? null,
    component: base.component ?? null,
    conversationId: base.conversationId ?? null,
    turnId: base.turnId ?? null,
    runId: base.runId ?? null,
    messageId: base.messageId ?? null,
    actionId: base.actionId ?? null,
  };
}

/**
 * Static accessor rather than an injectable: correlation is ambient infrastructure and the
 * logger, the LLM funnel and the outbox all need it without adding a constructor dependency
 * to every class in the system.
 */
export const RequestContextStore = {
  /** The active context, or null when running outside any correlated scope (e.g. boot). */
  current(): RequestContext | null {
    return storage.getStore() ?? null;
  },

  /** Runs `fn` inside a brand-new root context (one inbound stimulus). */
  root<T>(seed: Partial<RequestContext>, fn: () => T): T {
    return storage.run(build(seed), fn);
  },

  /**
   * Runs `fn` inside a child context: same correlation, new `requestId`, parent recorded.
   * Fields in `patch` override the inherited ones (typically `component`, `turnId`, `runId`).
   */
  child<T>(patch: RequestContextPatch, fn: () => T): T {
    const parent = storage.getStore();
    const next = build({
      ...(parent ?? {}),
      ...patch,
      correlationId: parent?.correlationId,
      requestId: newRequestId(),
      parentRequestId: parent?.requestId ?? null,
    });
    return storage.run(next, fn);
  },

  /**
   * Enriches the current context in place for the remainder of the scope. Used when an MCOS
   * identity becomes known mid-flight (the conversation id after identity resolution, the turn
   * id after assembly) without wanting a new `requestId`.
   */
  extend<T>(patch: RequestContextPatch, fn: () => T): T {
    const parent = storage.getStore();
    return storage.run(build({ ...(parent ?? {}), ...patch }), fn);
  },

  /**
   * Re-establishes a context that was persisted with a durable record (queue entry, outbox
   * event) so asynchronous workers continue the same correlation chain.
   */
  resume<T>(persisted: Partial<RequestContext>, fn: () => T): T {
    return storage.run(build(persisted), fn);
  },

  /** Serialisable snapshot for persisting alongside durable records. */
  snapshot(): RequestContext | null {
    const current = storage.getStore();
    return current === undefined ? null : { ...current };
  },
};
