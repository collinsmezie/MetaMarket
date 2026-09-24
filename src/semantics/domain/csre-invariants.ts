import { CSRE_ENTITY_TYPES, CSRE_RESOLUTION_STATUSES } from './csre-resolution';

/**
 * Semantic invariants over a schema-valid CSRE wire resolution (CSRE TDR v5.4 §3.1A, §10, §14A,
 * §15, §20, §26, §27.3, §29.3). JSON Schema checks shape; these checks enforce meaning:
 *
 *  - object ids are unique; every relationship endpoint names an object in this response;
 *  - `entity_type` belongs to the §15 vocabulary;
 *  - `surface_form` is a span of the message (never a paraphrase — §20 rule 6, §26 rule 1) and
 *    `semantic_origin.phrase` is that same span;
 *  - `concept_status` KNOWN ⇔ a `market_concept_id` is present (§25.3);
 *  - `resolution_status` agrees with the object count (§10): ≥2 objects ⇒ COMPOSITE, 0 objects
 *    ⇒ UNRESOLVED | NON_REFERENTIAL, 1 object ⇒ RESOLVED | AMBIGUOUS | UNRESOLVED;
 *  - a venue expression is context, never an object (§14A, §20 rule 9);
 *  - `ambiguity.present` ⇔ remaining candidates listed;
 *  - `clarification.required` ⇔ exactly one question (§20 rule 12).
 *
 * A violation is a typed failure for the runtime's single bounded repair; meaning is never
 * patched in by code (§27.3).
 */

export interface InvariantViolation {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface WireObject {
  object_id: string;
  surface_form: string;
  entity_type: string;
  semantic_origin: {
    phrase: string;
    concept: string;
    market_concept_id: string | null;
    concept_status: string;
  };
  ambiguity: { present: boolean; remaining_candidates: unknown[] };
  relationships: { type: string; objects: string[] }[];
  definition?: string;
  confidence?: { semantic_resolution?: number; commercial_relevance?: number };
}

interface WireResolution {
  resolution_status: string;
  original_message: string;
  objects: WireObject[];
  context: { venues: { expression: string }[] };
  clarification: { required: boolean; question: string | null };
}

const ENTITY_TYPES = new Set<string>(CSRE_ENTITY_TYPES);

/** Hedging language that signals the model does not actually know the referent. */
const HEDGED_DEFINITION =
  /\b(?:likely|possibly|probably|perhaps|unclear|unknown|uncertain|may (?:be|refer)|might (?:be|refer)|could (?:be|refer)|appears to be|seems to be|referred to as|not (?:a )?(?:well[- ])?known)\b/i;
/** Matches CSRE's evidence-path threshold: at or below this the object is routed to evidence/clarification. */
const EVIDENCE_CONFIDENCE_CEILING = 0.6;

/** Whitespace-insensitive, case-insensitive containment: spans must come from the message. */
export function isSpanOf(message: string, span: string): boolean {
  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const haystack = normalize(message);
  const needle = normalize(span);
  return needle.length > 0 && haystack.includes(needle);
}

export function validateCsreInvariants(payload: unknown, message: string): InvariantViolation[] {
  const resolution = payload as WireResolution;
  const violations: InvariantViolation[] = [];
  const ids = new Set<string>();
  const objects = resolution.objects ?? [];

  objects.forEach((object, index) => {
    const base = `/objects/${index}`;
    if (ids.has(object.object_id)) {
      violations.push(
        violation(`${base}/object_id`, 'unique_object_id', `Duplicate object_id "${object.object_id}"`),
      );
    }
    ids.add(object.object_id);

    if (!ENTITY_TYPES.has(object.entity_type)) {
      violations.push(
        violation(
          `${base}/entity_type`,
          'entity_type_vocabulary',
          `"${object.entity_type}" is not a CSRE entity type; use one of ${[...ENTITY_TYPES].join(', ')}`,
          { allowed: [...ENTITY_TYPES] },
        ),
      );
    }

    if (!isSpanOf(message, object.surface_form)) {
      violations.push(
        violation(
          `${base}/surface_form`,
          'surface_form_span',
          `surface_form "${object.surface_form}" is not a span of the user message; copy the exact words the user wrote`,
        ),
      );
    }

    const origin = object.semantic_origin;
    if (origin.phrase !== object.surface_form) {
      violations.push(
        violation(
          `${base}/semantic_origin/phrase`,
          'phrase_is_surface_form',
          `semantic_origin.phrase must equal surface_form ("${object.surface_form}")`,
        ),
      );
    }
    if (origin.concept_status === 'KNOWN' && origin.market_concept_id === null) {
      violations.push(
        violation(
          `${base}/semantic_origin/concept_status`,
          'known_concept_has_id',
          'concept_status KNOWN requires a market_concept_id from the supplied known concepts; otherwise use PROPOSED',
        ),
      );
    }
    if (origin.concept_status === 'PROPOSED' && origin.market_concept_id !== null) {
      violations.push(
        violation(
          `${base}/semantic_origin/market_concept_id`,
          'proposed_concept_has_no_id',
          'concept_status PROPOSED requires market_concept_id null',
        ),
      );
    }

    const candidates = object.ambiguity?.remaining_candidates ?? [];
    if (object.ambiguity?.present === true && candidates.length === 0) {
      violations.push(
        violation(
          `${base}/ambiguity`,
          'ambiguity_has_candidates',
          'ambiguity.present requires remaining_candidates',
        ),
      );
    }
    if (object.ambiguity?.present === false && candidates.length > 0) {
      violations.push(
        violation(
          `${base}/ambiguity/remaining_candidates`,
          'no_candidates_without_ambiguity',
          'remaining_candidates must be empty when ambiguity.present is false',
        ),
      );
    }
  });

  objects.forEach((object, index) => {
    (object.relationships ?? []).forEach((relationship, rIndex) => {
      relationship.objects.forEach((target) => {
        if (!ids.has(target)) {
          violations.push(
            violation(
              `/objects/${index}/relationships/${rIndex}/objects`,
              'dangling_relationship',
              `Relationship "${relationship.type}" references unknown object "${target}"`,
            ),
          );
        }
      });
    });
  });

  const normalize = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();
  const venueExpressions = new Set(
    (resolution.context?.venues ?? []).map((venue) => normalize(venue.expression)),
  );
  objects.forEach((object, index) => {
    if (venueExpressions.has(normalize(object.surface_form))) {
      violations.push(
        violation(
          `/objects/${index}`,
          'venue_is_not_object',
          `"${object.surface_form}" is a venue constraint; keep it in context.venues and remove it from objects`,
        ),
      );
    }
  });

  // Echoing an unfamiliar word back as a "product" with a hedged definition is false precision
  // (CSRE §5 "never certainty without evidence"): the referent is not established, so the object
  // must be marked ambiguous at ≤ 0.6 semantic confidence — which is what routes it to the
  // evidence path (WRS) or a clarification instead of a fabricated marketplace object.
  objects.forEach((object, index) => {
    const hedge = HEDGED_DEFINITION.exec(String(object.definition ?? ''));
    if (hedge === null) return;
    const semantic = Number(object.confidence?.semantic_resolution ?? 0);
    if (object.ambiguity?.present !== true || semantic > EVIDENCE_CONFIDENCE_CEILING) {
      violations.push(
        violation(
          `/objects/${index}/confidence/semantic_resolution`,
          'unfamiliar_term_false_precision',
          `The definition of "${object.surface_form}" hedges ("${hedge[0]}"), so the referent is not established: set ambiguity.present true with the plausible kinds of thing it could be as remaining_candidates and semantic_resolution ≤ ${EVIDENCE_CONFIDENCE_CEILING}; or state a definite meaning without hedging`,
          { hedge: hedge[0], semantic_resolution: semantic },
        ),
      );
    }
  });

  const status = resolution.resolution_status;
  const allowed: readonly string[] =
    objects.length >= 2
      ? ['COMPOSITE']
      : objects.length === 0
        ? ['UNRESOLVED', 'NON_REFERENTIAL']
        : ['RESOLVED', 'AMBIGUOUS', 'UNRESOLVED'];
  if (
    CSRE_RESOLUTION_STATUSES.includes(status as (typeof CSRE_RESOLUTION_STATUSES)[number]) &&
    !allowed.includes(status)
  ) {
    violations.push(
      violation(
        '/resolution_status',
        'status_matches_object_count',
        `With ${objects.length} object(s) resolution_status must be one of ${allowed.join(' | ')}`,
        { allowed, objectCount: objects.length },
      ),
    );
  }

  const clarification = resolution.clarification;
  if (
    clarification.required &&
    (clarification.question === null || clarification.question.trim().length === 0)
  ) {
    violations.push(
      violation(
        '/clarification/question',
        'clarification_consistency',
        'clarification.required needs exactly one question',
      ),
    );
  }
  if (!clarification.required && clarification.question !== null) {
    violations.push(
      violation(
        '/clarification/question',
        'clarification_consistency',
        'question must be null when clarification is not required',
      ),
    );
  }

  return violations;
}

function violation(
  path: string,
  keyword: string,
  message: string,
  params: Record<string, unknown> = {},
): InvariantViolation {
  return { path, keyword, message, params };
}
