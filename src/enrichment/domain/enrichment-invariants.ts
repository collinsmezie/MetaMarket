/**
 * Semantic invariants over a schema-valid Enrichment wire resolution (Enrichment TDR v4.4 §10,
 * §22, §24.1, §26.1, §26.3, §27.3, §28.3, §29.2). JSON Schema checks shape; these enforce meaning
 * against the *input* objects:
 *
 *  - exactly one profile per input object, same `object_id`s (§22 rule 2);
 *  - `semantic_origin` copied through unchanged, `canonical_form`/`entity_type` unchanged
 *    (§24.1, §29.2 "no enrichment field may overwrite the CSRE semantic identity");
 *  - no fabricated brand/model: only the input's value or null (§10, §22 rule 9);
 *  - `evidence_required` ⇔ `evidence_request` present;
 *  - every referenced `evidence_id` was actually supplied (§27.3 lineage, §28.4);
 *  - `enrichment_status` agrees with the objects (EVIDENCE_REQUIRED ⇔ some object needs it).
 *
 * A violation is a typed failure for the runtime's single bounded repair; identity is never
 * patched in by code.
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

interface InputObject {
  object_id: string;
  semantic_origin: WireOrigin;
  canonical_form: string;
  entity_type: string;
  brand?: string | null;
  model?: string | null;
}

interface WireProfile extends InputObject {
  evidence_required: boolean;
  evidence_request: unknown | null;
  evidence: { evidence_id: string }[];
}

interface WireResolution {
  enrichment_status: string;
  objects: WireProfile[];
}

const ORIGIN_FIELDS: readonly (keyof WireOrigin)[] = [
  'phrase',
  'concept',
  'market_concept_id',
  'concept_status',
  'relationship',
  'origin',
  'request_id',
];

export function validateEnrichmentInvariants(
  payload: unknown,
  inputs: readonly Readonly<Record<string, unknown>>[],
  suppliedEvidenceIds: ReadonlySet<string>,
): InvariantViolation[] {
  const resolution = payload as WireResolution;
  const violations: InvariantViolation[] = [];
  const profiles = resolution.objects ?? [];
  const inputsById = new Map((inputs as unknown as InputObject[]).map((input) => [input.object_id, input]));

  const seen = new Set<string>();
  profiles.forEach((profile, index) => {
    const base = `/objects/${index}`;
    if (seen.has(profile.object_id)) {
      violations.push(
        violation(`${base}/object_id`, 'unique_object_id', `Duplicate object_id "${profile.object_id}"`),
      );
    }
    seen.add(profile.object_id);

    const input = inputsById.get(profile.object_id);
    if (input === undefined) {
      violations.push(
        violation(
          `${base}/object_id`,
          'unknown_object',
          `"${profile.object_id}" is not an input object; enrich only the supplied objects`,
          {
            inputs: [...inputsById.keys()],
          },
        ),
      );
      return;
    }

    for (const field of ORIGIN_FIELDS) {
      if (profile.semantic_origin?.[field] !== input.semantic_origin[field]) {
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
        Number(profile.semantic_origin?.semantic_confidence) -
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
    if (profile.canonical_form !== input.canonical_form) {
      violations.push(
        violation(
          `${base}/canonical_form`,
          'identity_preserved',
          `canonical_form must stay "${input.canonical_form}" (do not re-resolve)`,
        ),
      );
    }
    if (profile.entity_type !== input.entity_type) {
      violations.push(
        violation(
          `${base}/entity_type`,
          'identity_preserved',
          `entity_type must stay "${input.entity_type}"`,
        ),
      );
    }
    const inputBrand = input.brand ?? null;
    if (profile.brand !== null && profile.brand !== undefined && profile.brand !== inputBrand) {
      violations.push(
        violation(
          `${base}/brand`,
          'no_unsupported_specificity',
          `brand "${profile.brand}" is not in the CSRE input; use ${JSON.stringify(inputBrand)}`,
        ),
      );
    }
    const inputModel = input.model ?? null;
    if (profile.model !== null && profile.model !== undefined && profile.model !== inputModel) {
      violations.push(
        violation(
          `${base}/model`,
          'no_unsupported_specificity',
          `model "${profile.model}" is not in the CSRE input; use ${JSON.stringify(inputModel)}`,
        ),
      );
    }

    if (
      profile.evidence_required &&
      (profile.evidence_request === null || profile.evidence_request === undefined)
    ) {
      violations.push(
        violation(
          `${base}/evidence_request`,
          'evidence_request_consistency',
          'evidence_required needs an evidence_request',
        ),
      );
    }
    if (
      !profile.evidence_required &&
      profile.evidence_request !== null &&
      profile.evidence_request !== undefined
    ) {
      violations.push(
        violation(
          `${base}/evidence_request`,
          'evidence_request_consistency',
          'evidence_request must be null when evidence is not required',
        ),
      );
    }
    (profile.evidence ?? []).forEach((item, eIndex) => {
      if (!suppliedEvidenceIds.has(item.evidence_id)) {
        violations.push(
          violation(
            `${base}/evidence/${eIndex}/evidence_id`,
            'evidence_lineage',
            `evidence_id "${item.evidence_id}" was not supplied; cite only AVAILABLE EVIDENCE`,
            {
              supplied: [...suppliedEvidenceIds],
            },
          ),
        );
      }
    });
  });

  for (const objectId of inputsById.keys()) {
    if (!seen.has(objectId)) {
      violations.push(
        violation(
          '/objects',
          'every_object_enriched',
          `Input object "${objectId}" has no enrichment profile`,
        ),
      );
    }
  }

  const needsEvidence = profiles.some((profile) => profile.evidence_required);
  if (
    needsEvidence &&
    resolution.enrichment_status !== 'EVIDENCE_REQUIRED' &&
    resolution.enrichment_status !== 'BLOCKED'
  ) {
    violations.push(
      violation(
        '/enrichment_status',
        'status_consistency',
        'enrichment_status must be EVIDENCE_REQUIRED when any object requires evidence',
      ),
    );
  }
  if (!needsEvidence && resolution.enrichment_status === 'EVIDENCE_REQUIRED') {
    violations.push(
      violation(
        '/enrichment_status',
        'status_consistency',
        'EVIDENCE_REQUIRED without any object requiring evidence',
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
