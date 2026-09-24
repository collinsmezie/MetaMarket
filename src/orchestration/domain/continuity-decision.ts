/**
 * Continuity decision model (MCOS TDR §15, §34A.3).
 *
 * How the current logical turn relates to active and suspended conversational work. Continuity
 * references workflow state but never mutates it. It is deterministic when there is nothing to
 * relate to, and model-assisted (P2) only when workflows exist and the relation is not obvious.
 */

export const CONTINUITY_KINDS = [
  'CONTINUATION',
  'RESUME',
  'NEW_WORKFLOW',
  'DIGRESSION',
  'WORKFLOW_SWITCH',
  'MULTI_WORKFLOW',
  'CORRECTION',
  'CANCELLATION',
  'NO_WORKFLOW_CONTEXT',
] as const;
export type ContinuityKind = (typeof CONTINUITY_KINDS)[number];

export interface TurnRelationship {
  readonly relationship: ContinuityKind;
  readonly intentIds: readonly string[];
  readonly workflowIds: readonly string[];
}

export interface ContinuityDecision {
  readonly primary: ContinuityKind;
  readonly relationships: readonly TurnRelationship[];
  readonly confidence: number;
  readonly reason: string;
  readonly source: 'DETERMINISTIC' | 'P2';
}

export interface ContinuityWorkflowView {
  readonly workflowId: string;
  readonly workflowType: string;
  readonly status: string;
  readonly resumable: boolean;
}

export interface ContinuityIntentView {
  readonly intentId: string;
  readonly type: string;
  readonly workflowIds: readonly string[];
}

const CANCEL_INTENTS = new Set(['CANCEL']);
const RESUME_INTENTS = new Set(['RESUME', 'CONTINUE_VENDOR_ONBOARDING']);
const CONTINUATION_INTENTS = new Set([
  'CONFIRM',
  'DENY',
  'CLARIFY',
  'ACKNOWLEDGE',
  'CORRECT',
  'REPEAT',
  'REPHRASE',
]);

/**
 * Continuity that needs no model: no workflow context, an explicit workflow reference, an answer
 * to the platform's own question, or a control intent with one obvious target. Returns null when
 * the relation must be analysed (P2).
 */
export function deterministicContinuity(input: {
  readonly active: readonly ContinuityWorkflowView[];
  readonly suspended: readonly ContinuityWorkflowView[];
  readonly intents: readonly ContinuityIntentView[];
  readonly answeringClarification: boolean;
  readonly explicitWorkflowId: string | null;
}): ContinuityDecision | null {
  const all = [...input.active, ...input.suspended];
  const intentIds = input.intents.map((intent) => intent.intentId);

  if (input.explicitWorkflowId !== null) {
    const target = all.find((workflow) => workflow.workflowId === input.explicitWorkflowId);
    if (target !== undefined) {
      const kind: ContinuityKind = target.status === 'suspended' ? 'RESUME' : 'CONTINUATION';
      return decision(
        kind,
        [{ relationship: kind, intentIds, workflowIds: [target.workflowId] }],
        1,
        'Interactive payload names the workflow instance',
        'DETERMINISTIC',
      );
    }
  }

  if (all.length === 0) {
    return decision(
      'NO_WORKFLOW_CONTEXT',
      [{ relationship: 'NO_WORKFLOW_CONTEXT', intentIds, workflowIds: [] }],
      1,
      'No active or suspended workflow exists',
      'DETERMINISTIC',
    );
  }

  const focused = input.active[0] ?? null;

  if (input.answeringClarification && focused !== null) {
    return decision(
      'CONTINUATION',
      [{ relationship: 'CONTINUATION', intentIds, workflowIds: [focused.workflowId] }],
      0.95,
      'The turn answers the pending clarification of the focused workflow',
      'DETERMINISTIC',
    );
  }

  if (input.intents.length === 1) {
    const [only] = input.intents;
    if (CANCEL_INTENTS.has(only.type) && focused !== null) {
      return decision(
        'CANCELLATION',
        [{ relationship: 'CANCELLATION', intentIds, workflowIds: [focused.workflowId] }],
        0.9,
        'Single CANCEL intent with one focused workflow',
        'DETERMINISTIC',
      );
    }
    if (RESUME_INTENTS.has(only.type)) {
      const target = input.suspended[0] ?? focused;
      if (target !== null) {
        return decision(
          'RESUME',
          [{ relationship: 'RESUME', intentIds, workflowIds: [target.workflowId] }],
          0.9,
          'Single RESUME-class intent with a resumable workflow',
          'DETERMINISTIC',
        );
      }
    }
    if (CONTINUATION_INTENTS.has(only.type) && focused !== null) {
      return decision(
        'CONTINUATION',
        [{ relationship: 'CONTINUATION', intentIds, workflowIds: [focused.workflowId] }],
        0.85,
        'Conversation-control intent continues the focused workflow',
        'DETERMINISTIC',
      );
    }
  }

  return null;
}

export function decision(
  primary: ContinuityKind,
  relationships: readonly TurnRelationship[],
  confidence: number,
  reason: string,
  source: ContinuityDecision['source'],
): ContinuityDecision {
  return { primary, relationships, confidence, reason, source };
}

/** Legacy `ConversationRelationship` kind for the workflow trigger (migration seam, MCOS §57). */
export function toLegacyRelationship(kind: ContinuityKind, answeringClarification: boolean): string {
  if (answeringClarification) return 'answer';
  switch (kind) {
    case 'CONTINUATION':
      return 'continuation';
    case 'RESUME':
      return 'resume';
    case 'CORRECTION':
      return 'correction';
    case 'CANCELLATION':
      return 'cancel';
    case 'DIGRESSION':
    case 'WORKFLOW_SWITCH':
      return 'topic_shift';
    case 'NEW_WORKFLOW':
    case 'MULTI_WORKFLOW':
    case 'NO_WORKFLOW_CONTEXT':
      return 'new';
  }
}
