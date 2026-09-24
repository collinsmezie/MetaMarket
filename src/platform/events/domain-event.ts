import type { DomainEvent } from '../../domain/ports/outbound/event-publisher.port';
import { RequestContextStore } from '../correlation/request-context';

/**
 * Versioned, correlated event envelope (Overarching TDR §18.6, §33; Directive §22).
 *
 * Extends the existing `DomainEvent` (kept for compatibility with the in-process subscribers
 * that remain during migration) with the identifiers the TDR requires on every event: version,
 * correlation/turn/run ids and the aggregate the event describes. Events are past-tense facts;
 * commands are imperative and are not events.
 */
export interface CorrelatedDomainEvent<
  TPayload = Readonly<Record<string, unknown>>,
> extends DomainEvent<TPayload> {
  readonly eventVersion: string;
  readonly correlationId: string;
  readonly turnId?: string;
  readonly runId?: string;
  readonly aggregate?: { readonly type: string; readonly id: string };
}

/** Event names as past-tense facts (Overarching §33). */
export const PlatformEvents = {
  MessageReceived: 'MessageReceived',
  LogicalTurnCreated: 'LogicalTurnCreated',
  LogicalTurnSealed: 'LogicalTurnSealed',
  LogicalTurnCommitted: 'LogicalTurnCommitted',
  IntentResolved: 'IntentResolved',
  SemanticObjectResolved: 'SemanticObjectResolved',
  EnrichmentCompleted: 'EnrichmentCompleted',
  GPCMapped: 'GPCMapped',
  EvidenceRetrieved: 'EvidenceRetrieved',
  ObservationRecorded: 'ObservationRecorded',
  BeliefUpdated: 'BeliefUpdated',
  KnowledgePromoted: 'KnowledgePromoted',
  CapabilityDiscovered: 'CapabilityDiscovered',
  CapabilityBeliefUpdated: 'CapabilityBeliefUpdated',
  GraphChangeDecided: 'GraphChangeDecided',
  GraphMutated: 'GraphMutated',
  BuyerRequestCreated: 'BuyerRequestCreated',
  MatchCandidatesComputed: 'MatchCandidatesComputed',
  VendorSelected: 'VendorSelected',
  FanoutDispatched: 'FanoutDispatched',
  VendorNotified: 'VendorNotified',
  VendorResponded: 'VendorResponded',
  CustomerDisclosureCompleted: 'CustomerDisclosureCompleted',
  CreditCharged: 'CreditCharged',
  WorkflowStarted: 'WorkflowStarted',
  WorkflowSuspended: 'WorkflowSuspended',
  WorkflowResumed: 'WorkflowResumed',
  WorkflowCompleted: 'WorkflowCompleted',
  DeliveryQueued: 'DeliveryQueued',
  DeliverySucceeded: 'DeliverySucceeded',
  DeliveryFailed: 'DeliveryFailed',
} as const;

export type PlatformEventType = (typeof PlatformEvents)[keyof typeof PlatformEvents];

export interface EventFactoryInput<TPayload> {
  readonly eventId: string;
  readonly eventType: string;
  readonly producer: string;
  readonly occurredAt: Date;
  readonly payload: TPayload;
  readonly eventVersion?: string;
  readonly conversationId?: string;
  readonly workflowId?: string;
  readonly vendorId?: string;
  readonly customerId?: string;
  readonly requestId?: string;
  readonly turnId?: string;
  readonly runId?: string;
  readonly aggregate?: { readonly type: string; readonly id: string };
}

/**
 * Builds an event, filling correlation identifiers from the active request context when the
 * producer did not supply them. Producers therefore cannot emit an uncorrelated event by
 * forgetting a field.
 */
export function correlatedEvent<TPayload>(
  input: EventFactoryInput<TPayload>,
): CorrelatedDomainEvent<TPayload> {
  const context = RequestContextStore.current();
  const event: CorrelatedDomainEvent<TPayload> = {
    eventId: input.eventId,
    eventType: input.eventType,
    eventVersion: input.eventVersion ?? '1.0',
    timestamp: input.occurredAt,
    producer: input.producer,
    correlationId: context?.correlationId ?? `corr_${input.eventId}`,
    payload: input.payload,
    ...((input.conversationId ?? context?.conversationId)
      ? { conversationId: (input.conversationId ?? context?.conversationId) as string }
      : {}),
    ...((input.turnId ?? context?.turnId) ? { turnId: (input.turnId ?? context?.turnId) as string } : {}),
    ...((input.runId ?? context?.runId) ? { runId: (input.runId ?? context?.runId) as string } : {}),
    ...(input.workflowId !== undefined ? { workflowId: input.workflowId } : {}),
    ...(input.vendorId !== undefined ? { vendorId: input.vendorId } : {}),
    ...(input.customerId !== undefined ? { customerId: input.customerId } : {}),
    ...((input.requestId ?? context?.requestId) !== undefined &&
    (input.requestId ?? context?.requestId) !== null
      ? { requestId: (input.requestId ?? context?.requestId) as string }
      : {}),
    ...(input.aggregate !== undefined ? { aggregate: input.aggregate } : {}),
  };
  return event;
}

export function isCorrelatedEvent(event: DomainEvent): event is CorrelatedDomainEvent {
  return typeof (event as Partial<CorrelatedDomainEvent>).correlationId === 'string';
}

/**
 * A durable event consumer (Overarching §18.7 "background publisher"; Directive §22).
 *
 * Handlers are invoked by the outbox consumer, exactly once per `(eventId, consumerName)` even
 * across retries and replicas. They must therefore be safe to call after a partial failure but
 * are not required to be idempotent themselves.
 */
export interface EventHandler {
  /** Stable consumer name; part of the idempotency key. */
  readonly name: string;
  /** Event types handled, or `'*'` for all. */
  readonly eventTypes: readonly string[] | '*';
  handle(event: CorrelatedDomainEvent): Promise<void>;
}

export const EVENT_HANDLER_REGISTRY = Symbol('EventHandlerRegistry');

export class EventHandlerRegistry {
  private readonly handlers: EventHandler[] = [];

  register(handler: EventHandler): void {
    if (this.handlers.some((existing) => existing.name === handler.name)) {
      throw new Error(`Event handler "${handler.name}" is already registered`);
    }
    this.handlers.push(handler);
  }

  handlersFor(eventType: string): readonly EventHandler[] {
    return this.handlers.filter(
      (handler) => handler.eventTypes === '*' || handler.eventTypes.includes(eventType),
    );
  }

  all(): readonly EventHandler[] {
    return [...this.handlers];
  }
}
