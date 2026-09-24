import { NON_GPC_ENTITY_TYPES, type GpcCandidate } from './gpc-mapping';

/**
 * Semantic invariants over a schema-valid GPC Resolver wire response (GPC Resolver TDR v4.4
 * §5, §14.1, §17, §20–§21, §93.4, §93.6, §94.4, §95.4–§95.5). JSON Schema checks shape; these
 * enforce sovereignty and provenance against the *input*:
 *
 *  - exactly one result per input object, same ids, `semantic_origin` and `source_trace` copied
 *    through, and `source_trace.csre_request_id == semantic_origin.request_id` (§95.4);
 *  - a MAPPED `gpc_code` names a *supplied* candidate for that object, with that candidate's
 *    level and title (§93.4 "reject fabricated codes", §94.4 rules 1 and 3);
 *  - diagnostic candidates name supplied candidates only;
 *  - entity types the product taxonomy cannot represent end NOT_APPLICABLE (§14.1, §17);
 *  - a category/subcategory referent never maps to a BRICK (§14.4, §15 "false precision is worse
 *    than a defensible broader mapping", §17);
 *  - MAPPED with no candidate supplied is impossible; AMBIGUOUS needs ≥2 diagnostic candidates;
 *  - cited `evidence_ids` were supplied.
 *
 * A violation is a typed failure for the runtime's single bounded repair; a code is never
 * patched in by the runtime.
 */

export interface InvariantViolation {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface WireOrigin {
  phrase: string;
  concept: string;
  market_concept_id: string | null;
  concept_status: string;
  relationship: string;
  origin: string;
  request_id: string;
  semantic_confidence: number;
}

interface WireTrace {
  csre_request_id: string;
  enrichment_request_id: string | null;
  wrs_evidence_ids: string[];
  evidence_system_ids: string[];
}

interface InputObject {
  object_id: string;
  semantic_origin: WireOrigin;
  source_trace: WireTrace;
  entity_type: string;
}

interface WireResult {
  object_id: string;
  semantic_origin: WireOrigin;
  source_trace: WireTrace;
  mapping: {
    state: string;
    gpc_code: string | null;
    gpc_level: string | null;
    gpc_title: string | null;
    evidence_ids: string[];
  };
  diagnostic_candidates: { gpc_code: string; level: string; title: string }[];
}

interface WireResponse {
  objects: WireResult[];
}

/** Referents whose specificity is a family of products, not a product (§17). */
const CATEGORY_ENTITY_TYPES: ReadonlySet<string> = new Set(['PRODUCT_CATEGORY', 'PRODUCT_SUBCATEGORY']);

const ORIGIN_FIELDS: readonly (keyof WireOrigin)[] = [
  'phrase',
  'concept',
  'market_concept_id',
  'concept_status',
  'relationship',
  'origin',
  'request_id',
];

export function validateGpcInvariants(
  payload: unknown,
  inputs: readonly Readonly<Record<string, unknown>>[],
  candidates: readonly GpcCandidate[],
  suppliedEvidenceIds: ReadonlySet<string>,
): InvariantViolation[] {
  const response = payload as WireResponse;
  const violations: InvariantViolation[] = [];
  const results = response.objects ?? [];
  const inputsById = new Map((inputs as unknown as InputObject[]).map((input) => [input.object_id, input]));
  const candidatesByObject = new Map<string, Map<string, GpcCandidate>>();
  for (const candidate of candidates) {
    const map = candidatesByObject.get(candidate.forObjectId) ?? new Map<string, GpcCandidate>();
    map.set(candidate.gpcCode, candidate);
    candidatesByObject.set(candidate.forObjectId, map);
  }

  const seen = new Set<string>();
  results.forEach((result, index) => {
    const base = `/objects/${index}`;
    if (seen.has(result.object_id))
      violations.push(
        violation(`${base}/object_id`, 'unique_object_id', `Duplicate object_id "${result.object_id}"`),
      );
    seen.add(result.object_id);

    const input = inputsById.get(result.object_id);
    if (input === undefined) {
      violations.push(
        violation(`${base}/object_id`, 'unknown_object', `"${result.object_id}" is not an input object`, {
          inputs: [...inputsById.keys()],
        }),
      );
      return;
    }

    for (const field of ORIGIN_FIELDS) {
      if (result.semantic_origin?.[field] !== input.semantic_origin[field]) {
        violations.push(
          violation(
            `${base}/semantic_origin/${field}`,
            'semantic_origin_preserved',
            `semantic_origin.${field} must equal the CSRE value ${JSON.stringify(input.semantic_origin[field])}`,
          ),
        );
      }
    }
    if (
      Math.abs(
        Number(result.semantic_origin?.semantic_confidence) -
          Number(input.semantic_origin.semantic_confidence),
      ) > 1e-6
    ) {
      violations.push(
        violation(
          `${base}/semantic_origin/semantic_confidence`,
          'semantic_origin_preserved',
          'semantic_confidence must equal the CSRE value',
        ),
      );
    }

    const trace = result.source_trace;
    if (
      trace?.csre_request_id !== input.source_trace.csre_request_id ||
      trace?.csre_request_id !== input.semantic_origin.request_id
    ) {
      violations.push(
        violation(
          `${base}/source_trace/csre_request_id`,
          'source_trace_preserved',
          `csre_request_id must equal semantic_origin.request_id "${input.semantic_origin.request_id}"`,
        ),
      );
    }
    if ((trace?.enrichment_request_id ?? null) !== (input.source_trace.enrichment_request_id ?? null)) {
      violations.push(
        violation(
          `${base}/source_trace/enrichment_request_id`,
          'source_trace_preserved',
          `enrichment_request_id must equal ${JSON.stringify(input.source_trace.enrichment_request_id ?? null)}`,
        ),
      );
    }

    const mapping = result.mapping;
    const objectCandidates = candidatesByObject.get(result.object_id) ?? new Map<string, GpcCandidate>();

    if (NON_GPC_ENTITY_TYPES.has(input.entity_type) && mapping.state !== 'NOT_APPLICABLE') {
      violations.push(
        violation(
          `${base}/mapping/state`,
          'non_product_not_applicable',
          `entity_type ${input.entity_type} cannot be represented by the product taxonomy; use NOT_APPLICABLE with null code`,
        ),
      );
    }

    if (mapping.state === 'MAPPED') {
      const candidate = mapping.gpc_code === null ? undefined : objectCandidates.get(mapping.gpc_code);
      if (candidate === undefined) {
        violations.push(
          violation(
            `${base}/mapping/gpc_code`,
            'code_from_supplied_candidates',
            `gpc_code ${JSON.stringify(mapping.gpc_code)} is not one of the supplied candidates for ${result.object_id}; never invent codes`,
            {
              supplied: [...objectCandidates.keys()],
            },
          ),
        );
      } else {
        if (mapping.gpc_level !== candidate.level) {
          violations.push(
            violation(
              `${base}/mapping/gpc_level`,
              'code_from_supplied_candidates',
              `gpc_level must be the candidate's level "${candidate.level}"`,
            ),
          );
        }
        if (mapping.gpc_title !== candidate.title) {
          violations.push(
            violation(
              `${base}/mapping/gpc_title`,
              'code_from_supplied_candidates',
              `gpc_title must be the candidate's exact title ${JSON.stringify(candidate.title)}`,
            ),
          );
        }
      }
    }
    if (
      mapping.state === 'MAPPED' &&
      CATEGORY_ENTITY_TYPES.has(input.entity_type) &&
      mapping.gpc_level === 'BRICK'
    ) {
      violations.push(
        violation(
          `${base}/mapping/gpc_level`,
          'no_false_precision',
          `${input.entity_type} referents map at CLASS, FAMILY or SEGMENT level, never a product BRICK; choose the deepest defensible broader candidate`,
        ),
      );
    }
    if (mapping.state === 'AMBIGUOUS' && (result.diagnostic_candidates ?? []).length < 2) {
      violations.push(
        violation(
          `${base}/diagnostic_candidates`,
          'ambiguity_has_competitors',
          'AMBIGUOUS requires at least two diagnostic candidates',
        ),
      );
    }
    (result.diagnostic_candidates ?? []).forEach((candidate, cIndex) => {
      const known = objectCandidates.get(candidate.gpc_code);
      if (known === undefined) {
        violations.push(
          violation(
            `${base}/diagnostic_candidates/${cIndex}/gpc_code`,
            'code_from_supplied_candidates',
            `diagnostic candidate ${candidate.gpc_code} was not supplied for ${result.object_id}`,
          ),
        );
      } else if (known.level !== candidate.level || known.title !== candidate.title) {
        violations.push(
          violation(
            `${base}/diagnostic_candidates/${cIndex}`,
            'code_from_supplied_candidates',
            `diagnostic candidate ${candidate.gpc_code} must carry its supplied level/title`,
          ),
        );
      }
    });
    (mapping.evidence_ids ?? []).forEach((id, eIndex) => {
      if (!suppliedEvidenceIds.has(id)) {
        violations.push(
          violation(
            `${base}/mapping/evidence_ids/${eIndex}`,
            'evidence_lineage',
            `evidence_id "${id}" was not supplied`,
          ),
        );
      }
    });
  });

  for (const objectId of inputsById.keys()) {
    if (!seen.has(objectId))
      violations.push(
        violation('/objects', 'every_object_resolved', `Input object "${objectId}" has no mapping result`),
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
