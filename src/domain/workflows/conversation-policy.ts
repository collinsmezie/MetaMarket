import type { WorkflowInstance } from '../models/workflow-instance';
import { hasExpired } from '../models/workflow-instance';
import type { WorkflowDefinition } from './workflow-definition';

/**
 * Conversation Policy Engine (MCOS §5.11).
 *
 * Answers operational questions — may this workflow be interrupted? has it gone stale? are
 * there too many suspended workflows? — and keeps those answers out of the execution path,
 * so policy can change without touching workflow logic.
 */

export interface PolicyLimits {
  /** Idle ceiling applied to workflows whose definition sets no expiry of its own. */
  readonly defaultIdleExpiryMs: number;
  /**
   * Cap on suspended workflows per conversation. Beyond it the oldest are archived, so a
   * user who abandons searches daily does not accumulate unbounded state.
   */
  readonly maxSuspendedWorkflows: number;
}

export interface InterruptionDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

export class ConversationPolicyEngine {
  constructor(private readonly limits: PolicyLimits) {}

  /**
   * Whether the active workflow may be pushed aside for a new topic (MCOS §16).
   *
   * Non-interruptible workflows exist for steps that must not be abandoned halfway, such as
   * a payment confirmation.
   */
  canInterrupt(_instance: WorkflowInstance, definition: WorkflowDefinition): InterruptionDecision {
    if (!definition.policy.interruptible) {
      return {
        allowed: false,
        reason: `Workflow type "${definition.type}" is declared non-interruptible.`,
      };
    }

    return { allowed: true, reason: 'Workflow is interruptible.' };
  }

  /** Absolute expiry for a new or resumed instance, or null when it should never expire. */
  expiryFor(definition: WorkflowDefinition, from: Date): Date | null {
    const idleMs = definition.policy.idleExpiryMs ?? this.limits.defaultIdleExpiryMs;
    if (idleMs <= 0) return null;
    return new Date(from.getTime() + idleMs);
  }

  isExpired(instance: WorkflowInstance, now: Date): boolean {
    return hasExpired(instance, now);
  }

  /**
   * Suspended workflows to archive because the conversation holds too many.
   *
   * Oldest-updated first, so the ones the user is most likely to have forgotten go first.
   */
  suspendedToArchive(suspended: readonly WorkflowInstance[]): readonly WorkflowInstance[] {
    if (suspended.length <= this.limits.maxSuspendedWorkflows) return [];

    const byAge = [...suspended].sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    return byAge.slice(0, suspended.length - this.limits.maxSuspendedWorkflows);
  }

  /**
   * Whether a second instance of the same workflow type may run concurrently.
   *
   * Several simultaneous product searches are expected (MCOS §17); two concurrent vendor
   * onboardings for one user are not.
   */
  canStartConcurrentInstance(definition: WorkflowDefinition, existing: readonly WorkflowInstance[]): boolean {
    if (definition.policy.allowConcurrentInstances) return true;

    return !existing.some(
      (instance) =>
        instance.workflowType === definition.type &&
        (instance.status === 'active' || instance.status === 'suspended'),
    );
  }
}
