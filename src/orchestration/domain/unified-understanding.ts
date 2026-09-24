import type { IDCEResolution, DiscoveredIntent } from '../../intent/domain/idce-resolution';
import type { CSREResolution, SemanticObject } from '../../semantics/domain/csre-resolution';
import { CONTROL_INTENTS, PLATFORM_REPLY_INTENTS, capabilityForIntent } from './capability-catalogue';
import type { ContinuityDecision } from './continuity-decision';

/**
 * Unified turn understanding (MCOS TDR §13–§14, §25, §63.6).
 *
 * The join of IDCE (objectives), CSRE (referents), continuity and the deterministic
 * reference resolver into one validated state. Nothing routes on a partial understanding.
 */

export interface IntentObjectBinding {
  readonly intentId: string;
  /** CSRE request-local object ids of the current turn bound to this intent. */
  readonly objectIds: readonly string[];
  readonly via: 'IDCE_SCOPE' | 'SPAN_OVERLAP' | 'SINGLE_INTENT' | 'PRIMARY_FALLBACK';
}

export interface UnresolvedIssue {
  readonly issueKey: string;
  readonly source: 'IDCE' | 'CSRE' | 'PLAN';
  readonly kind: 'INTENT' | 'REFERENT' | 'MISSING_INFORMATION' | 'UNSUPPORTED';
  readonly description: string;
  readonly question: string | null;
  readonly targetIntentIds: readonly string[];
  readonly targetObjectIds: readonly string[];
  readonly blocking: boolean;
}

export interface UnderstandingState {
  readonly idce: IDCEResolution | null;
  readonly csre: CSREResolution | null;
  readonly idceRequestId: string | null;
  readonly csreRequestId: string | null;
  readonly idceError: { code: string; message: string } | null;
  readonly csreError: { code: string; message: string } | null;
  readonly continuity: ContinuityDecision | null;
  readonly bindings: readonly IntentObjectBinding[];
  readonly unresolved: readonly UnresolvedIssue[];
  readonly ready: boolean;
}

export const EMPTY_UNDERSTANDING: UnderstandingState = {
  idce: null,
  csre: null,
  idceRequestId: null,
  csreRequestId: null,
  idceError: null,
  csreError: null,
  continuity: null,
  bindings: [],
  unresolved: [],
  ready: false,
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Deterministic relationship/reference resolver (MCOS §12.1). IDCE and CSRE run in parallel, so
 * an intent's `scope.object_ids` can only name objects from earlier turns; current-turn objects
 * are bound by source-span overlap, with a single intent taking every object and unbound objects
 * falling to the PRIMARY intent.
 */
export function bindObjectsToIntents(
  intents: readonly DiscoveredIntent[],
  objects: readonly SemanticObject[],
): IntentObjectBinding[] {
  if (intents.length === 0) return [];
  if (intents.length === 1) {
    return [
      {
        intentId: intents[0]!.intentId,
        objectIds: objects.map((object) => object.objectId),
        via: 'SINGLE_INTENT',
      },
    ];
  }

  const bound = new Map<string, Set<string>>(intents.map((intent) => [intent.intentId, new Set<string>()]));
  const claimed = new Set<string>();

  for (const object of objects) {
    const surface = normalize(object.surfaceForm);
    const owners = intents.filter((intent) =>
      intent.sourceSpans.some((span) => {
        const normalizedSpan = normalize(span);
        return normalizedSpan.includes(surface) || surface.includes(normalizedSpan);
      }),
    );
    for (const owner of owners) {
      bound.get(owner.intentId)!.add(object.objectId);
      claimed.add(object.objectId);
    }
  }

  const primary = intents.find((intent) => intent.role === 'PRIMARY') ?? intents[0]!;
  for (const object of objects) {
    if (!claimed.has(object.objectId)) bound.get(primary.intentId)!.add(object.objectId);
  }

  return intents.map((intent) => ({
    intentId: intent.intentId,
    objectIds: [...bound.get(intent.intentId)!],
    via:
      intent.intentId === primary.intentId && objects.some((object) => !claimed.has(object.objectId))
        ? 'PRIMARY_FALLBACK'
        : 'SPAN_OVERLAP',
  }));
}

/** Semantic-object-dependent intents cannot proceed on a referent CSRE could not resolve. */
const REFERENT_DEPENDENT_INTENTS: ReadonlySet<string> = new Set([
  'BUY',
  'FIND_PRODUCT',
  'FIND_VENDOR',
  'FIND_SERVICE',
  'SEARCH',
  'REQUEST_QUOTE',
  'PLACE_ORDER',
  'PRICE_INQUIRY',
  'AVAILABILITY_INQUIRY',
  'PRODUCT_INFORMATION',
  'COMPARE',
  'ALTERNATIVES',
  'SUBSTITUTE',
]);

/**
 * Collects the unresolved issues a clarification gate must weigh (§25, §25A.1): specialist
 * recommendations, referents that stayed ambiguous/unresolved for referent-dependent intents,
 * and intents no capability serves.
 */
export function collectUnresolvedIssues(
  idce: IDCEResolution | null,
  csre: CSREResolution | null,
  bindings: readonly IntentObjectBinding[],
): UnresolvedIssue[] {
  const issues: UnresolvedIssue[] = [];

  if (idce?.clarification?.required === true) {
    const clarification = idce.clarification;
    issues.push({
      issueKey: `intent:${clarification.targetIntentIds.join('+') || 'turn'}:${clarification.reason}`,
      source: 'IDCE',
      kind: clarification.reason === 'MISSING_REQUIRED_INFORMATION' ? 'MISSING_INFORMATION' : 'INTENT',
      description: clarification.expectedResolution ?? clarification.reason,
      question: clarification.question,
      targetIntentIds: clarification.targetIntentIds,
      targetObjectIds: [],
      blocking: clarification.blocking,
    });
  }

  if (csre !== null) {
    const objectsById = new Map(csre.objects.map((object) => [object.objectId, object]));
    for (const binding of bindings) {
      const intent = idce?.intents.find((candidate) => candidate.intentId === binding.intentId);
      if (intent === undefined || !REFERENT_DEPENDENT_INTENTS.has(intent.type)) continue;
      for (const objectId of binding.objectIds) {
        const object = objectsById.get(objectId);
        if (object === undefined) continue;
        if (object.ambiguity.present || object.confidence.semanticResolution < 0.5) {
          issues.push({
            issueKey: `object:${normalize(object.surfaceForm)}:referent`,
            source: 'CSRE',
            kind: 'REFERENT',
            description: `"${object.surfaceForm}" could mean ${object.ambiguity.remainingCandidates.map((candidate) => candidate.meaning).join(' or ') || 'several things'}`,
            question: csre.clarification.required ? csre.clarification.question : null,
            targetIntentIds: [binding.intentId],
            targetObjectIds: [objectId],
            blocking: true,
          });
        }
      }
    }
    if (csre.clarification.required && !issues.some((issue) => issue.source === 'CSRE')) {
      issues.push({
        issueKey: `turn:referent:${normalize(csre.originalMessage).slice(0, 40)}`,
        source: 'CSRE',
        kind: 'REFERENT',
        description: 'CSRE recommends clarifying the referent',
        question: csre.clarification.question,
        targetIntentIds: bindings.map((binding) => binding.intentId),
        targetObjectIds: csre.objects.map((object) => object.objectId),
        blocking: true,
      });
    }
  }

  for (const intent of idce?.intents ?? []) {
    if (
      capabilityForIntent(intent.type) === null &&
      !PLATFORM_REPLY_INTENTS.has(intent.type) &&
      !CONTROL_INTENTS.has(intent.type)
    ) {
      issues.push({
        issueKey: `intent:${intent.intentId}:unsupported`,
        source: 'PLAN',
        kind: 'UNSUPPORTED',
        description: `No workflow capability serves ${intent.type}`,
        question: null,
        targetIntentIds: [intent.intentId],
        targetObjectIds: [],
        blocking: false,
      });
    }
  }

  return issues;
}
