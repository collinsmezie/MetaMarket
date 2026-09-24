import {
  ACTOR_PREDICATES,
  actorId,
  MKG_PREDICATES,
  type ObservationInput,
  POLARITIES,
  VENDOR_ONLY_PREDICATES,
} from './evidence-model';

/**
 * Semantic invariants over a schema-valid `evidence-interpretation-v4` output (Evidence TDR §5,
 * §9, §10, §32, §53.4, §54.4). JSON Schema checks shape; these enforce what the model may claim:
 *
 *  - `observation_id` is the observation being interpreted; evidence ids unique;
 *  - predicates come from the MKG vocabulary; ids use the typed prefixes; no invented GPC codes;
 *  - actor predicates name the observing actor; a BUYER never yields SUPPLIES/IN_STOCK
 *    (`buyer demand ≠ vendor capability`), a VENDOR never yields REQUESTED-as-capability;
 *  - a single free-text observation never exceeds strength 0.9;
 *  - `supports`/`contradicts` reference supplied candidate ids.
 */

export interface InvariantViolation {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface WireItem {
  evidence_id: string;
  observation_id: string;
  assertion: { subject: string; predicate: string; object: string };
  polarity: string;
  strength: number;
  supports?: string[];
  contradicts?: string[];
}

const ID_PATTERN = /^(phrase|concept|gpc|vendor|buyer|actor|system|context|venue|location):.+/;

export function validateInterpretationInvariants(
  payload: unknown,
  observation: ObservationInput,
  candidateIds: readonly string[],
  knownGpcCodes: ReadonlySet<string> | null,
): InvariantViolation[] {
  const items = ((payload as { evidence?: WireItem[] }).evidence ?? []) as WireItem[];
  const violations: InvariantViolation[] = [];
  const seen = new Set<string>();
  const actor = observation.actor === null ? null : actorId(observation.actor.role, observation.actor.id);
  const candidates = new Set(candidateIds);

  items.forEach((item, index) => {
    const base = `/evidence/${index}`;
    if (item.observation_id !== observation.observationId)
      violations.push(
        violation(
          `${base}/observation_id`,
          'observation_identity',
          `observation_id must be "${observation.observationId}"`,
        ),
      );
    if (seen.has(item.evidence_id))
      violations.push(
        violation(`${base}/evidence_id`, 'unique_evidence_id', `Duplicate evidence_id "${item.evidence_id}"`),
      );
    seen.add(item.evidence_id);

    const { subject, predicate, object } = item.assertion;
    if (!(MKG_PREDICATES as readonly string[]).includes(predicate))
      violations.push(
        violation(`${base}/assertion/predicate`, 'mkg_vocabulary', `"${predicate}" is not an MKG predicate`, {
          allowed: MKG_PREDICATES,
        }),
      );
    for (const [field, id] of [
      ['subject', subject],
      ['object', object],
    ] as const) {
      if (!ID_PATTERN.test(id))
        violations.push(
          violation(
            `${base}/assertion/${field}`,
            'typed_identifier',
            `"${id}" must use a typed prefix (phrase:, concept:, gpc:, vendor:, buyer:, context:, venue:, location:)`,
          ),
        );
      if (id.startsWith('gpc:') && knownGpcCodes !== null && !knownGpcCodes.has(id.slice(4)))
        violations.push(
          violation(
            `${base}/assertion/${field}`,
            'no_invented_gpc',
            `GPC code "${id.slice(4)}" was not supplied by the observation`,
          ),
        );
    }
    if (ACTOR_PREDICATES.has(predicate)) {
      if (actor === null)
        violations.push(
          violation(
            `${base}/assertion/predicate`,
            'actor_required',
            `${predicate} needs an observing actor; this observation has none`,
          ),
        );
      else if (subject !== actor)
        violations.push(
          violation(
            `${base}/assertion/subject`,
            'actor_identity',
            `${predicate} must be asserted about the observing actor "${actor}", not "${subject}"`,
          ),
        );
      if (VENDOR_ONLY_PREDICATES.has(predicate) && observation.actor?.role === 'BUYER')
        violations.push(
          violation(
            `${base}/assertion/predicate`,
            'demand_is_not_capability',
            `A buyer observation cannot yield ${predicate}: buyer demand is mkg:REQUESTED, never vendor capability`,
          ),
        );
      if (
        predicate === 'mkg:REQUESTED' &&
        observation.actor?.role === 'VENDOR' &&
        observation.observationType !== 'VENDOR_CLARIFICATION'
      )
        violations.push(
          violation(
            `${base}/assertion/predicate`,
            'vendor_demand',
            `A vendor statement about what they sell is mkg:SUPPLIES, not mkg:REQUESTED`,
          ),
        );
    }
    if (!(POLARITIES as readonly string[]).includes(item.polarity))
      violations.push(
        violation(`${base}/polarity`, 'polarity_enum', `Polarity must be one of ${POLARITIES.join('|')}`),
      );
    if (item.strength > 0.9)
      violations.push(
        violation(
          `${base}/strength`,
          'single_observation_cap',
          'A single free-text observation never establishes more than 0.9',
        ),
      );
    for (const ref of [...(item.supports ?? []), ...(item.contradicts ?? [])]) {
      if (candidates.size > 0 && !candidates.has(ref))
        violations.push(
          violation(
            `${base}/supports`,
            'reference_supplied_candidates',
            `"${ref}" is not a supplied candidate id`,
            { allowed: [...candidates] },
          ),
        );
    }
  });
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
