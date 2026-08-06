/**
 * Domain event publishing (MCOS §19, Evidence Service "Standard Marketplace Event Model").
 *
 * Services communicate through events rather than direct calls (Execution.md §2.6). The
 * Conversation OS in particular publishes business events and never writes evidence
 * itself (MCOS Refinement #11 §8), which is what keeps marketplace learning independent.
 */

export const EVENT_PUBLISHER = Symbol('EventPublisher');

/**
 * Envelope shared by every marketplace event.
 *
 * Matches the Standard Marketplace Event Model so the Evidence Service can consume events
 * from any producer without per-producer parsing.
 */
export interface DomainEvent<TPayload = Readonly<Record<string, unknown>>> {
  readonly eventId: string;
  readonly eventType: string;
  readonly timestamp: Date;
  /** Component that emitted the event, e.g. `ConversationOS`, `RequestDistributionService`. */
  readonly producer: string;
  readonly conversationId?: string;
  readonly workflowId?: string;
  readonly vendorId?: string;
  readonly customerId?: string;
  readonly requestId?: string;
  readonly payload: TPayload;
}

export interface EventPublisherPort {
  publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>;

  /** Publishes a batch atomically with respect to the outbox. */
  publishAll(events: readonly DomainEvent[]): Promise<void>;
}

/**
 * Conversation OS lifecycle events (MCOS §19).
 * Named constants rather than inline strings so subscribers cannot drift on spelling.
 */
export const ConversationEvents = {
  MessageReceived: 'conversation.message.received',
  MediaProcessed: 'conversation.media.processed',
  ConversationLoaded: 'conversation.loaded',
  ContinuityAnalyzed: 'conversation.continuity.analyzed',
  IntentResolved: 'conversation.intent.resolved',
  SemanticResolved: 'conversation.semantic.resolved',
  WorkflowStarted: 'workflow.started',
  WorkflowResumed: 'workflow.resumed',
  WorkflowSuspended: 'workflow.suspended',
  WorkflowCompleted: 'workflow.completed',
  WorkflowCancelled: 'workflow.cancelled',
  WorkflowFailed: 'workflow.failed',
  WorkflowExpired: 'workflow.expired',
  BusinessOperationCompleted: 'business.operation.completed',
  ResponseCreated: 'conversation.response.created',
  MessageSent: 'conversation.message.sent',
  MessageFailed: 'conversation.message.failed',
} as const;

export type ConversationEventType = (typeof ConversationEvents)[keyof typeof ConversationEvents];
