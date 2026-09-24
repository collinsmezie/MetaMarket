import type { Action, Response } from '../../domain/models/response';
import type { ActionExecutionResult, PlannedAction, ResponseArtifact, SuggestedAction } from './action-plan';

/**
 * Response planning and deterministic composition (MCOS TDR §26A–§28).
 *
 * Responses are generated from action outcomes, never from the raw message. Ordering: primary
 * objective first, tightly dependent results next, secondary independent results, then
 * limitations/failures, then nudges. The composer merges artifacts into one canonical response
 * and validates the envelope before delivery.
 */

export function artifactsFromResult(
  result: ActionExecutionResult,
  action: PlannedAction | null,
  isPrimary: boolean,
): ResponseArtifact[] {
  if (result.responseArtifacts.length > 0) {
    return result.responseArtifacts.map((artifact) => ({
      ...artifact,
      priority: isPrimary ? Math.max(artifact.priority, 0.9) : artifact.priority,
    }));
  }
  if (result.status === 'FAILED') {
    return [
      {
        actionId: result.actionId,
        relevance: 0.4,
        priority: 0.2,
        text: `I couldn't complete ${describeAction(action)} just now. Please try again in a moment.`,
        actions: [],
        media: undefined,
        metadata: { limitation: true, code: result.error?.code ?? 'ACTION_FAILED' },
        audience: 'USER',
        dependencies: [],
        status: 'READY',
      },
    ];
  }
  return [];
}

export function artifactFromResponse(
  actionId: string,
  response: Response,
  priority: number,
  extra: Record<string, unknown> = {},
): ResponseArtifact {
  return {
    actionId,
    relevance: 1,
    priority,
    text: response.text ?? '',
    actions: (response.actions ?? []).map(toSuggestedAction),
    media: response.media,
    metadata: { ...(response.metadata ?? {}), ...extra },
    audience: 'USER',
    dependencies: [],
    status: 'READY',
  };
}

function describeAction(action: PlannedAction | null): string {
  if (action === null || action.workflowType === null) return 'that';
  switch (action.workflowType) {
    case 'BuyerSearch':
      return 'the vendor search';
    case 'VendorOnboarding':
      return 'your business listing';
    case 'CreditRecharge':
      return 'the credit recharge';
    case 'PlatformInfo':
      return 'that question';
    default:
      return 'that';
  }
}

/** §28 ordering. Stable for equal keys so workflow emission order survives. */
export function orderArtifacts(artifacts: readonly ResponseArtifact[]): ResponseArtifact[] {
  return [...artifacts]
    .map((artifact, index) => ({ artifact, index }))
    .sort((a, b) => {
      const limitationA = a.artifact.metadata.limitation === true ? 1 : 0;
      const limitationB = b.artifact.metadata.limitation === true ? 1 : 0;
      if (limitationA !== limitationB) return limitationA - limitationB;
      if (b.artifact.priority !== a.artifact.priority) return b.artifact.priority - a.artifact.priority;
      if (b.artifact.relevance !== a.artifact.relevance) return b.artifact.relevance - a.artifact.relevance;
      return a.index - b.index;
    })
    .map((entry) => entry.artifact);
}

/**
 * Deterministic composition of ordered artifacts into one canonical response: texts joined,
 * media concatenated, later actions winning on payload collision (the newest state's affordances
 * are the ones that still make sense to tap).
 */
export function composeArtifacts(artifacts: readonly ResponseArtifact[], text?: string): Response | null {
  const meaningful = artifacts.filter(
    (artifact) =>
      artifact.text.trim().length > 0 || artifact.actions.length > 0 || (artifact.media?.length ?? 0) > 0,
  );
  if (meaningful.length === 0 && (text === undefined || text.trim().length === 0)) return null;

  const joined =
    text !== undefined && text.trim().length > 0
      ? text.trim()
      : meaningful
          .map((artifact) => artifact.text.trim())
          .filter((value) => value.length > 0)
          .join('\n\n');
  const media = meaningful.flatMap((artifact) => [...(artifact.media ?? [])]);
  const actionsByPayload = new Map<string, Action>();
  for (const artifact of meaningful) {
    for (const action of artifact.actions) actionsByPayload.set(action.payload, toResponseAction(action));
  }
  const metadata = meaningful.reduce<Record<string, unknown>>(
    (acc, artifact) => ({ ...acc, ...artifact.metadata }),
    {},
  );

  return {
    ...(joined.length > 0 ? { text: joined } : {}),
    ...(media.length > 0 ? { media } : {}),
    ...(actionsByPayload.size > 0 ? { actions: [...actionsByPayload.values()] } : {}),
    metadata,
  };
}

/** The envelope the Delivery Engine accepts (§26A): non-empty text or at least one affordance. */
export function isDeliverable(response: Response | null): response is Response {
  if (response === null) return false;
  return (
    (response.text !== undefined && response.text.trim().length > 0) ||
    (response.actions !== undefined && response.actions.length > 0) ||
    (response.media !== undefined && response.media.length > 0)
  );
}

export function toSuggestedAction(action: Action): SuggestedAction {
  return {
    type: action.type,
    title: action.title,
    payload: action.payload,
    ...(action.description !== undefined ? { description: action.description } : {}),
  };
}

export function toResponseAction(action: SuggestedAction): Action {
  return {
    type: action.type,
    title: action.title,
    payload: action.payload,
    ...(action.description !== undefined ? { description: action.description } : {}),
  };
}
