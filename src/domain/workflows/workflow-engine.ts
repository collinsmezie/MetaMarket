import type { Response } from '../models/response';
import { fallbackWithReason } from '../models/response';
import type { WorkflowInstance, WorkflowStatus } from '../models/workflow-instance';
import type { DomainEvent } from '../ports/outbound/event-publisher.port';
import { ConversationEvents } from '../ports/outbound/event-publisher.port';
import type { ClockPort, IdGeneratorPort } from '../ports/outbound/system.port';
import type { StageLoggerPort } from '../ports/outbound/stage-logger.port';
import type {
  TransitionRecord,
  WorkflowMutation,
  WorkflowRepositoryPort,
} from '../ports/outbound/workflow-repository.port';
import type {
  StateExecutionResult,
  WorkflowExecutionContext,
  WorkflowServices,
  WorkflowTrigger,
} from './workflow-definition';
import { IllegalTransitionError, UnknownWorkflowStateError } from './workflow-definition';
import type { WorkflowDefinitionRegistry } from './workflow-registry';

const COMPONENT = 'MCOS';

/**
 * Upper bound on chained transitions within a single turn.
 *
 * A well-formed workflow settles in a handful of steps; anything more indicates a cycle,
 * and stopping is far better than looping on the user's message forever.
 */
const MAX_TRANSITIONS_PER_TURN = 12;

export interface WorkflowExecutionOutcome {
  readonly instance: WorkflowInstance;
  /** Responses produced this turn, in emission order. */
  readonly responses: readonly Response[];
  readonly events: readonly DomainEvent[];
  readonly transitions: readonly TransitionRecord[];
  /** True when execution was dead-lettered instead of completing normally. */
  readonly failed: boolean;
  /**
   * Set when a state asked for the turn to be handed to whichever workflow owns this intent
   * (`StateExecutionResult.handoff`). The engine only reports it; resolving the intent to a
   * workflow is routing, which belongs to the caller.
   */
  readonly handoff?: { readonly intent: string };
}

/**
 * Executes workflow state machines deterministically (MCOS §5.8).
 *
 * The engine owns state transitions, validates them against each state's declared targets,
 * persists them with an audit record, and publishes lifecycle events. It never detects
 * intent, never knows which channel a message came from, and never manages conversations.
 */
export class WorkflowEngine {
  constructor(
    private readonly registry: WorkflowDefinitionRegistry,
    private readonly workflows: WorkflowRepositoryPort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
    private readonly logger: StageLoggerPort,
  ) {}

  /**
   * Runs the instance forward until it needs more input, terminates, or hits the step cap.
   *
   * An unhandled error inside a state handler dead-letters the workflow rather than
   * propagating: the user gets an honest fallback and the session does not hang
   * (Execution.md §2.5).
   */
  async execute(
    instance: WorkflowInstance,
    trigger: WorkflowTrigger,
    services: WorkflowServices,
  ): Promise<WorkflowExecutionOutcome> {
    const responses: Response[] = [];
    const events: DomainEvent[] = [];
    const transitions: TransitionRecord[] = [];
    let handoff: { readonly intent: string } | undefined;

    let current = instance;
    let steps = 0;

    while (steps < MAX_TRANSITIONS_PER_TURN) {
      steps += 1;

      const state = this.registry.getState(current.workflowType, current.currentState);
      const startedAt = Date.now();

      let result: StateExecutionResult;

      try {
        const context: WorkflowExecutionContext = {
          instance: current,
          data: current.data,
          trigger,
          services,
        };
        result = await state.execute(context);
      } catch (error) {
        this.logger.stageFailed({
          component: COMPONENT,
          stage: `WorkflowEngine:${current.workflowType}:${current.currentState}`,
          input: { workflowId: current.id, text: trigger.text },
          action: 'State handler threw; dead-lettering the workflow instance',
          error,
        });

        const deadLettered = await this.deadLetter(current, error);
        return {
          instance: deadLettered.instance,
          responses: [...responses, deadLettered.response],
          events: [...events, deadLettered.event],
          transitions: [...transitions, deadLettered.transition],
          failed: true,
        };
      }

      // Reject an undeclared transition before it can corrupt persisted state.
      if (result.transitionTo !== undefined && result.transitionTo !== current.currentState) {
        if (!state.allowedTransitions.includes(result.transitionTo)) {
          const illegal = new IllegalTransitionError(
            current.workflowType,
            current.currentState,
            result.transitionTo,
            state.allowedTransitions,
          );

          this.logger.stageFailed({
            component: COMPONENT,
            stage: `WorkflowEngine:${current.workflowType}:${current.currentState}`,
            input: { workflowId: current.id, requestedTransition: result.transitionTo },
            action: 'Rejected an undeclared state transition',
            error: illegal,
          });

          const deadLettered = await this.deadLetter(current, illegal, 'failed');
          return {
            instance: deadLettered.instance,
            responses: [...responses, deadLettered.response],
            events: [...events, deadLettered.event],
            transitions: [...transitions, deadLettered.transition],
            failed: true,
          };
        }
      }

      const targetState = result.transitionTo ?? current.currentState;
      const status = this.resolveStatus(current, result, targetState);

      const mutation: WorkflowMutation = {
        currentState: targetState,
        ...(status !== undefined ? { status } : {}),
        ...(result.summary !== undefined ? { summary: result.summary } : {}),
        ...(result.semanticFingerprint !== undefined
          ? { semanticFingerprint: result.semanticFingerprint }
          : {}),
        ...(result.importantEntities !== undefined
          ? { importantEntities: { ...current.importantEntities, ...result.importantEntities } }
          : {}),
        ...(result.dataPatch !== undefined ? { data: { ...current.data, ...result.dataPatch } } : {}),
        ...(result.expiresAt !== undefined ? { expiresAt: result.expiresAt } : {}),
      };

      const transitioned = targetState !== current.currentState;
      const transition: TransitionRecord | undefined = transitioned
        ? {
            workflowId: current.id,
            fromState: current.currentState,
            toState: targetState,
            trigger: trigger.relationship.relationship,
            at: this.clock.now(),
          }
        : undefined;

      current = await this.workflows.update(current.id, mutation, transition);

      if (transition !== undefined) transitions.push(transition);
      if (result.response !== undefined) responses.push(result.response);
      if (result.events !== undefined) events.push(...result.events);
      if (result.handoff !== undefined) handoff = result.handoff;

      this.logger.stage({
        component: COMPONENT,
        stage: `WorkflowEngine:${current.workflowType}`,
        input: {
          workflowId: current.id,
          state: transition?.fromState ?? current.currentState,
          relationship: trigger.relationship.relationship,
        },
        action: transitioned
          ? `Transitioned ${transition?.fromState} → ${targetState}`
          : `Executed ${current.currentState} without transitioning`,
        output: {
          state: current.currentState,
          status: current.status,
          respondedToUser: result.response !== undefined,
        },
        durationMs: Date.now() - startedAt,
      });

      if (status !== undefined && this.isTerminalStatus(status)) {
        events.push(this.lifecycleEvent(current, status));
        break;
      }

      // No transition requested means the workflow is parked awaiting the next message.
      if (!transitioned) break;

      const nextState = this.registry.getState(current.workflowType, current.currentState);

      // A state that only exists to collect input has now asked its question; stop here so
      // the platform sends one coherent reply instead of a monologue.
      if (nextState.waitsForInput && result.response !== undefined) break;
    }

    if (steps >= MAX_TRANSITIONS_PER_TURN) {
      const runaway = new Error(
        `Workflow "${current.workflowType}" exceeded ${MAX_TRANSITIONS_PER_TURN} transitions in one turn; suspected transition cycle.`,
      );

      this.logger.stageFailed({
        component: COMPONENT,
        stage: `WorkflowEngine:${current.workflowType}`,
        input: { workflowId: current.id, state: current.currentState },
        action: 'Aborted execution after exceeding the per-turn transition cap',
        error: runaway,
      });

      const deadLettered = await this.deadLetter(current, runaway, 'failed');
      return {
        instance: deadLettered.instance,
        responses: [...responses, deadLettered.response],
        events: [...events, deadLettered.event],
        transitions: [...transitions, deadLettered.transition],
        failed: true,
      };
    }

    return {
      instance: current,
      responses,
      events,
      transitions,
      failed: false,
      ...(handoff !== undefined ? { handoff } : {}),
    };
  }

  /**
   * Decides the instance's status after a step.
   *
   * A handler may request one explicitly; otherwise reaching a final state completes the
   * workflow and anything else leaves it active.
   */
  private resolveStatus(
    current: WorkflowInstance,
    result: StateExecutionResult,
    targetState: string,
  ): WorkflowStatus | undefined {
    if (result.status !== undefined) return result.status;

    let target;
    try {
      target = this.registry.getState(current.workflowType, targetState);
    } catch (error) {
      if (error instanceof UnknownWorkflowStateError) return undefined;
      throw error;
    }

    if (target.isFinal === true) return 'completed';
    if (current.status === 'suspended') return 'active';
    return undefined;
  }

  private isTerminalStatus(status: WorkflowStatus): boolean {
    return status === 'completed' || status === 'cancelled' || status === 'archived' || status === 'failed';
  }

  /**
   * Parks a broken workflow in a recoverable state with an audit trail.
   *
   * Defaults to `suspended` so a transient database or provider blip does not discard the
   * user's progress; definition violations pass `failed` because retrying cannot help.
   */
  private async deadLetter(
    instance: WorkflowInstance,
    error: unknown,
    status: Extract<WorkflowStatus, 'suspended' | 'failed'> = 'suspended',
  ): Promise<{
    instance: WorkflowInstance;
    response: Response;
    event: DomainEvent;
    transition: TransitionRecord;
  }> {
    const message = error instanceof Error ? error.message : String(error);

    const transition: TransitionRecord = {
      workflowId: instance.id,
      fromState: instance.currentState,
      toState: instance.currentState,
      trigger: status === 'failed' ? 'engine_failure' : 'engine_suspension',
      at: this.clock.now(),
      error: message,
    };

    const updated = await this.workflows.update(
      instance.id,
      { status, data: { ...instance.data, lastError: message } },
      transition,
    );

    return {
      instance: updated,
      response: fallbackWithReason(status === 'failed' ? 'workflow_failed' : 'workflow_suspended'),
      event: {
        eventId: this.ids.uuid(),
        eventType:
          status === 'failed' ? ConversationEvents.WorkflowFailed : ConversationEvents.WorkflowSuspended,
        timestamp: this.clock.now(),
        producer: 'ConversationOS',
        conversationId: instance.conversationId,
        workflowId: instance.id,
        payload: { workflowType: instance.workflowType, state: instance.currentState, error: message },
      },
      transition,
    };
  }

  private lifecycleEvent(instance: WorkflowInstance, status: WorkflowStatus): DomainEvent {
    const eventType =
      status === 'completed'
        ? ConversationEvents.WorkflowCompleted
        : status === 'cancelled'
          ? ConversationEvents.WorkflowCancelled
          : status === 'failed'
            ? ConversationEvents.WorkflowFailed
            : ConversationEvents.WorkflowSuspended;

    return {
      eventId: this.ids.uuid(),
      eventType,
      timestamp: this.clock.now(),
      producer: 'ConversationOS',
      conversationId: instance.conversationId,
      workflowId: instance.id,
      payload: {
        workflowType: instance.workflowType,
        finalState: instance.currentState,
        summary: instance.summary,
      },
    };
  }
}
