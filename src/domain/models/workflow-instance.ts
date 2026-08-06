/**
 * Workflow instance model and registry (MCOS §7, §8, §9, §10, §11).
 *
 * A workflow instance is an independent, resumable unit of business intent. A single
 * conversation can hold several at once — three product searches, an onboarding and a
 * complaint — each with its own state (MCOS §17).
 */

export const WORKFLOW_STATUSES = [
  'active',
  'suspended',
  'completed',
  'cancelled',
  'archived',
  'failed',
] as const;

export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number];

/**
 * Statuses a workflow can be brought back from.
 *
 * `completed`, `cancelled` and `archived` are terminal; `failed` is terminal for
 * automatic resumption and requires operator intervention (Execution.md §2.5).
 */
const RESUMABLE_STATUSES: readonly WorkflowStatus[] = ['active', 'suspended'];

export const TERMINAL_STATUSES: readonly WorkflowStatus[] = ['completed', 'cancelled', 'archived', 'failed'];

/**
 * A compact, queryable description of what a workflow is *about* (MCOS §10).
 *
 * Its purpose is workflow discovery: when a user says something ambiguous three days
 * later, matching against fingerprints is what identifies the right workflow to resume
 * without replaying the whole conversation.
 */
export interface SemanticFingerprint {
  readonly intent: string;
  readonly entities: readonly string[];
  readonly category?: string;
  readonly keywords: readonly string[];
}

export interface WorkflowInstance {
  readonly id: string;
  readonly conversationId: string;
  readonly workflowType: string;
  /** Current node in the workflow's state machine. Owned solely by the Workflow Engine. */
  readonly currentState: string;
  readonly status: WorkflowStatus;
  /**
   * Continuously updated natural-language summary (MCOS §11).
   * Preferred over replaying full history when the workflow needs context.
   */
  readonly summary: string;
  readonly semanticFingerprint: SemanticFingerprint;
  /**
   * Deterministic identifiers this workflow owns — order id, vendor id, request id.
   * Checked before any semantic matching during discovery (MCOS §15 Layer 2).
   */
  readonly importantEntities: Readonly<Record<string, string>>;
  /** Accumulated business data for the workflow, e.g. resolved location, business name. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly priority: number;
  readonly resumable: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly expiresAt: Date | null;
}

/**
 * The set of workflows belonging to a conversation, plus which one is currently in focus
 * (MCOS §7). Replaces a simple stack, because workflows are independent rather than nested.
 */
export interface WorkflowRegistry {
  readonly activeWorkflowId: string | null;
  readonly workflowInstances: readonly WorkflowInstance[];
}

export function isTerminal(status: WorkflowStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** True when the engine may legitimately continue executing this instance. */
export function canResume(instance: WorkflowInstance, now: Date = new Date()): boolean {
  if (!instance.resumable) return false;
  if (!RESUMABLE_STATUSES.includes(instance.status)) return false;
  if (instance.expiresAt !== null && instance.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

export function hasExpired(instance: WorkflowInstance, now: Date = new Date()): boolean {
  return instance.expiresAt !== null && instance.expiresAt.getTime() <= now.getTime();
}

export function findInstance(registry: WorkflowRegistry, workflowId: string): WorkflowInstance | undefined {
  return registry.workflowInstances.find((instance) => instance.id === workflowId);
}

export function activeInstance(registry: WorkflowRegistry): WorkflowInstance | undefined {
  if (registry.activeWorkflowId === null) return undefined;
  return findInstance(registry, registry.activeWorkflowId);
}

export function instancesByStatus(
  registry: WorkflowRegistry,
  status: WorkflowStatus,
): readonly WorkflowInstance[] {
  return registry.workflowInstances.filter((instance) => instance.status === status);
}

export function resumableInstances(
  registry: WorkflowRegistry,
  now: Date = new Date(),
): readonly WorkflowInstance[] {
  return registry.workflowInstances.filter((instance) => canResume(instance, now));
}

export const EMPTY_REGISTRY: WorkflowRegistry = {
  activeWorkflowId: null,
  workflowInstances: [],
};

export const EMPTY_FINGERPRINT: SemanticFingerprint = {
  intent: 'unknown',
  entities: [],
  keywords: [],
};
