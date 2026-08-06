import type { WorkflowServices } from '../../domain/workflows/workflow-definition';

export const WORKFLOW_SERVICES = Symbol('WorkflowServices');

/**
 * The business services workflow state handlers may call.
 *
 * Passed to handlers explicitly rather than injected into them, so the capabilities a
 * workflow can reach are visible in one place and a workflow stays unit-testable with
 * fakes. Later phases register the CDE, CME and Evidence services here without any change
 * to the engine.
 */
export type WorkflowServiceRegistry = WorkflowServices;
