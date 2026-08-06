import type { SemanticFingerprint, WorkflowInstance } from '../models/workflow-instance';

/**
 * Lexical fingerprint matching — Layer 4 of workflow discovery (MCOS §15).
 *
 * Deliberately cheap and deterministic: it runs before embedding similarity so that the
 * common case ("hammer" matching the workflow whose fingerprint mentions hammer) costs no
 * API call and always produces the same answer.
 */

/** Words carrying no discriminating signal for workflow discovery. */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'can',
  'do',
  'for',
  'get',
  'has',
  'have',
  'i',
  'in',
  'is',
  'it',
  'me',
  'my',
  'need',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'want',
  'was',
  'we',
  'what',
  'with',
  'you',
  'your',
]);

export interface FingerprintMatch {
  readonly workflowId: string;
  /** Overlap score in [0,1]. */
  readonly score: number;
  /** Terms that matched, surfaced so a clarification question can quote them back. */
  readonly matchedTerms: readonly string[];
}

export function tokenize(text: string): readonly string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/** Flattens a fingerprint into a comparable term set. */
export function fingerprintTerms(fingerprint: SemanticFingerprint): ReadonlySet<string> {
  const terms = new Set<string>();

  const sources = [
    ...fingerprint.entities,
    ...fingerprint.keywords,
    ...(fingerprint.category !== undefined ? [fingerprint.category] : []),
  ];

  for (const source of sources) {
    for (const token of tokenize(source)) terms.add(token);
  }

  return terms;
}

/**
 * Scores a message against one workflow's fingerprint.
 *
 * Uses overlap relative to the *message* rather than Jaccard similarity: a short message
 * ("hammer") should score highly against a rich fingerprint, which symmetric measures
 * penalise.
 */
export function scoreAgainstFingerprint(
  text: string,
  fingerprint: SemanticFingerprint,
): { score: number; matchedTerms: readonly string[] } {
  const messageTerms = tokenize(text);
  if (messageTerms.length === 0) return { score: 0, matchedTerms: [] };

  const terms = fingerprintTerms(fingerprint);
  const matched = [...new Set(messageTerms.filter((token) => terms.has(token)))];

  return { score: matched.length / new Set(messageTerms).size, matchedTerms: matched };
}

/** Ranks candidate workflows by lexical fingerprint overlap, best first. */
export function rankByFingerprint(
  text: string,
  candidates: readonly WorkflowInstance[],
  minScore: number,
): readonly FingerprintMatch[] {
  return candidates
    .map((instance) => {
      const { score, matchedTerms } = scoreAgainstFingerprint(text, instance.semanticFingerprint);
      return { workflowId: instance.id, score, matchedTerms };
    })
    .filter((match) => match.score >= minScore)
    .sort((a, b) => b.score - a.score);
}
