import type { WorkflowDefinition, WorkflowStateDefinition } from './workflow-definition';
import {
  UnknownWorkflowStateError,
  UnknownWorkflowTypeError,
  validateDefinition,
} from './workflow-definition';

/**
 * Catalogue of the workflow definitions this deployment knows how to run.
 *
 * Definitions register themselves here at boot; the Workflow Manager and Engine only ever
 * look workflows up by type. That indirection is what lets a new business capability ship
 * without touching the conversation platform (MCOS §24).
 */
export class WorkflowDefinitionRegistry {
  private readonly definitions = new Map<string, WorkflowDefinition>();
  /** intent → workflow types that declare it, ordered by descending policy priority. */
  private readonly intentIndex = new Map<string, string[]>();

  register(definition: WorkflowDefinition): void {
    // Fail at boot on an inconsistent machine rather than mid-conversation.
    validateDefinition(definition);

    if (this.definitions.has(definition.type)) {
      throw new Error(`Workflow type "${definition.type}" is already registered.`);
    }

    this.definitions.set(definition.type, definition);

    for (const intent of definition.startingIntents) {
      const types = this.intentIndex.get(intent) ?? [];
      types.push(definition.type);
      types.sort((a, b) => this.priorityOf(b) - this.priorityOf(a));
      this.intentIndex.set(intent, types);
    }
  }

  private priorityOf(workflowType: string): number {
    return this.definitions.get(workflowType)?.policy.priority ?? 0;
  }

  has(workflowType: string): boolean {
    return this.definitions.has(workflowType);
  }

  get(workflowType: string): WorkflowDefinition {
    const definition = this.definitions.get(workflowType);
    if (definition === undefined) {
      throw new UnknownWorkflowTypeError(workflowType);
    }
    return definition;
  }

  /** Resolves the state definition, or throws if the persisted state no longer exists. */
  getState(workflowType: string, stateName: string): WorkflowStateDefinition {
    const definition = this.get(workflowType);
    const state = definition.states.find((candidate) => candidate.name === stateName);
    if (state === undefined) {
      throw new UnknownWorkflowStateError(workflowType, stateName);
    }
    return state;
  }

  /**
   * Workflow type that should handle `intent`, highest priority first.
   * Returns null when no workflow claims the intent — the caller must then degrade
   * gracefully rather than inventing a workflow.
   */
  resolveByIntent(intent: string): string | null {
    const types = this.intentIndex.get(intent);
    return types === undefined || types.length === 0 ? null : types[0];
  }

  allTypes(): readonly string[] {
    return [...this.definitions.keys()];
  }

  all(): readonly WorkflowDefinition[] {
    return [...this.definitions.values()];
  }
}
