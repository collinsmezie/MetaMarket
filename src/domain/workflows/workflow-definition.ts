import type { Artifact } from '../models/artifact';
import type { Conversation, HistoryEntry } from '../models/conversation';
import type { Response } from '../models/response';
import type { SemanticFingerprint, WorkflowInstance, WorkflowStatus } from '../models/workflow-instance';
import type { ConversationRelationship, IntentResult, SemanticRequest } from '../models/understanding';
import type { DomainEvent } from '../ports/outbound/event-publisher.port';

/**
 * The contract a business workflow implements to run inside the Conversation OS.
 *
 * A workflow is a deterministic finite state machine (MCOS §3.5). The LLM supplies
 * extracted information via {@link WorkflowTrigger}; the engine — never the model —
 * decides which transition fires. Adding a workflow requires no change to the platform
 * (MCOS §24).
 */

/** Everything the platform learned about the current turn, handed to a state handler. */
export interface WorkflowTrigger {
  readonly conversation: Conversation;
  readonly recentHistory: readonly HistoryEntry[];
  /** Text and other artifacts extracted from the current message. */
  readonly artifacts: readonly Artifact[];
  /** Flattened user text for this turn; empty when the turn carried no readable content. */
  readonly text: string;
  readonly relationship: ConversationRelationship;
  /** Absent when the turn continued an existing workflow and intent was not re-resolved. */
  readonly intent: IntentResult | null;
  readonly semanticRequest: SemanticRequest | null;
  /**
   * Payload from a tapped button or selected list row, when the turn was interactive.
   * Deterministic input — prefer it over re-inferring what the user meant.
   */
  readonly interactivePayload: string | null;
  readonly now: Date;
}

/**
 * Services a state handler is allowed to reach.
 *
 * Passed in rather than imported so workflows stay unit-testable with fakes, and so the
 * set of capabilities a workflow may use is explicit and reviewable.
 */
export interface WorkflowServices {
  readonly [serviceName: string]: unknown;
}

export interface WorkflowExecutionContext<TData = Readonly<Record<string, unknown>>> {
  readonly instance: WorkflowInstance;
  readonly data: TData;
  readonly trigger: WorkflowTrigger;
  readonly services: WorkflowServices;
}

/**
 * What a state handler returns. Purely declarative: the handler describes the outcome and
 * the engine performs persistence, transition validation and event publication.
 */
export interface StateExecutionResult {
  /**
   * Target state. Omit to stay put — normal when waiting for the user's next message.
   * Must appear in the current state's `allowedTransitions` or the engine rejects it.
   */
  readonly transitionTo?: string;
  /** Response to send. Omit when the turn produces no user-facing output. */
  readonly response?: Response;
  /** Shallow-merged into the instance's `data`. */
  readonly dataPatch?: Readonly<Record<string, unknown>>;
  /** Replaces the instance summary (MCOS §11 requires it stay current). */
  readonly summary?: string;
  readonly semanticFingerprint?: SemanticFingerprint;
  readonly importantEntities?: Readonly<Record<string, string>>;
  /** Business events to publish after the transition commits. */
  readonly events?: readonly DomainEvent[];
  /**
   * Requests a terminal status, e.g. `completed` when the objective is met.
   * The engine validates that the state is allowed to terminate the workflow.
   */
  readonly status?: WorkflowStatus;
  /** Absolute expiry, or null to clear it. */
  readonly expiresAt?: Date | null;
  /**
   * Hands the turn to whichever workflow owns `intent`.
   *
   * For workflows whose job is to work out what the user wants rather than to serve it —
   * Triage above all, which MCOS designs to be superseded as real capabilities register. Once
   * it knows the answer it must step aside, because a button tap resumes the parked instance
   * directly (discovery Layer 1) and never passes through intent routing again.
   *
   * `response` is still honoured, but only as the fallback for when nothing claims the intent,
   * so a workflow that hands off stays honest on a deployment where the target does not exist.
   */
  readonly handoff?: { readonly intent: string };
}

export interface WorkflowStateDefinition {
  readonly name: string;
  /**
   * States reachable from here. Declaring them makes the machine auditable and lets the
   * engine reject an illegal transition instead of silently corrupting state.
   */
  readonly allowedTransitions: readonly string[];
  /**
   * True when the state parks waiting for the user.
   *
   * The engine stops its execution loop at such a state rather than running on, which is
   * what prevents a workflow from monologuing several messages in a row.
   */
  readonly waitsForInput: boolean;
  /** True when reaching this state legitimately ends the workflow. */
  readonly isFinal?: boolean;

  execute(context: WorkflowExecutionContext): Promise<StateExecutionResult>;
}

/** How the platform should treat this workflow's lifecycle (MCOS §5.11). */
export interface WorkflowPolicy {
  /** False for workflows that must not be pushed aside mid-flight, e.g. payment capture. */
  readonly interruptible: boolean;
  /** Higher wins when two workflows both plausibly match a message. */
  readonly priority: number;
  /** Idle lifetime before the workflow expires, or null for no expiry. */
  readonly idleExpiryMs: number | null;
  /** False for one-shot workflows that should never be brought back. */
  readonly resumable: boolean;
  /** Whether several instances may coexist in one conversation (MCOS §17). */
  readonly allowConcurrentInstances: boolean;
}

export interface WorkflowDefinition {
  readonly type: string;
  readonly initialState: string;
  readonly states: readonly WorkflowStateDefinition[];
  readonly policy: WorkflowPolicy;

  /**
   * Intents that start this workflow.
   *
   * Deterministic routing from a resolved intent to a workflow type, so the model's job
   * ends at naming the intent.
   */
  readonly startingIntents: readonly string[];

  /** Initial `data` for a new instance, derived from the triggering turn. */
  initialData(trigger: WorkflowTrigger): Readonly<Record<string, unknown>>;

  /** Initial summary and fingerprint, so a brand-new workflow is already discoverable. */
  initialSummary(trigger: WorkflowTrigger): string;
  initialFingerprint(trigger: WorkflowTrigger): SemanticFingerprint;
}

export const DEFAULT_WORKFLOW_POLICY: WorkflowPolicy = {
  interruptible: true,
  priority: 0,
  idleExpiryMs: null,
  resumable: true,
  allowConcurrentInstances: false,
};

/** Raised when a handler asks for a transition the state machine does not declare. */
export class IllegalTransitionError extends Error {
  constructor(
    readonly workflowType: string,
    readonly fromState: string,
    readonly toState: string,
    readonly allowed: readonly string[],
  ) {
    super(
      `Workflow "${workflowType}" cannot transition ${fromState} → ${toState}. ` +
        `Allowed: ${allowed.length > 0 ? allowed.join(', ') : '(none)'}.`,
    );
    this.name = 'IllegalTransitionError';
  }
}

export class UnknownWorkflowStateError extends Error {
  constructor(
    readonly workflowType: string,
    readonly state: string,
  ) {
    super(`Workflow "${workflowType}" has no state named "${state}".`);
    this.name = 'UnknownWorkflowStateError';
  }
}

export class UnknownWorkflowTypeError extends Error {
  constructor(readonly workflowType: string) {
    super(`No workflow definition registered for type "${workflowType}".`);
    this.name = 'UnknownWorkflowTypeError';
  }
}

/**
 * Validates a definition's internal consistency at registration time.
 *
 * Catching a typo'd transition target at boot is far cheaper than discovering it when a
 * live conversation hits that branch weeks later.
 */
export function validateDefinition(definition: WorkflowDefinition): void {
  const stateNames = new Set(definition.states.map((state) => state.name));

  if (definition.states.length === 0) {
    throw new Error(`Workflow "${definition.type}" declares no states.`);
  }

  if (stateNames.size !== definition.states.length) {
    throw new Error(`Workflow "${definition.type}" has duplicate state names.`);
  }

  if (!stateNames.has(definition.initialState)) {
    throw new Error(
      `Workflow "${definition.type}" initial state "${definition.initialState}" is not among its states.`,
    );
  }

  for (const state of definition.states) {
    for (const target of state.allowedTransitions) {
      if (!stateNames.has(target)) {
        throw new Error(
          `Workflow "${definition.type}" state "${state.name}" allows a transition to unknown state "${target}".`,
        );
      }
    }
  }

  const hasFinalState = definition.states.some((state) => state.isFinal === true);
  if (!hasFinalState) {
    throw new Error(`Workflow "${definition.type}" has no final state, so instances could never complete.`);
  }
}
