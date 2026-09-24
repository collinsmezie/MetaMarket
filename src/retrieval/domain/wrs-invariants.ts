import type { CollectedSource, EvidenceCandidate } from './wrs-evidence';

/**
 * Semantic invariants over a schema-valid WRS wire response (WRS TDR v4.4 §5, §15, §18.3, §19.2,
 * §19.4, §20.6). JSON Schema checks shape; these enforce provenance against what was actually
 * retrieved:
 *
 *  - every evidence item cites a collected source (`source_id`) and carries that source's URL
 *    (no fabricated provenance); `sources[]` lists only collected sources;
 *  - evidence ids are unique; findings/contradictions reference existing evidence;
 *  - `supports` / `contradicts` reference supplied candidate ids or requested fields;
 *  - an INFERENCE is never presented as OBSERVED without a quote-bearing source (§5);
 *  - `status` agrees with the evidence: no evidence ⇒ NO_RELIABLE_EVIDENCE (or ERROR), evidence ⇒
 *    SUCCESS or PARTIAL (§20.6 "NO_RELIABLE_EVIDENCE … MUST NOT be converted into a fabricated fact").
 */

export interface InvariantViolation {
  readonly path: string;
  readonly keyword: string;
  readonly message: string;
  readonly params: Readonly<Record<string, unknown>>;
}

interface WireEvidence {
  evidence_id: string;
  source_id: string;
  source_url: string | null;
  supports: string[];
  contradicts: string[];
  kind: string;
  quote: string | null;
}

interface WireResponse {
  status: string;
  evidence: WireEvidence[];
  findings: { evidence_ids: string[]; supports: string[]; contradicts: string[] }[];
  contradictions: { evidence_ids: string[] }[];
  sources: { source_id: string }[];
}

export function validateWrsInvariants(
  payload: unknown,
  collected: readonly CollectedSource[],
  candidates: readonly EvidenceCandidate[],
  requestedFields: readonly string[],
): InvariantViolation[] {
  const response = payload as WireResponse;
  const violations: InvariantViolation[] = [];
  const sourcesById = new Map(collected.map((source) => [source.sourceId, source]));
  const targets = new Set<string>([
    ...candidates.map((candidate) => candidate.candidateId),
    ...requestedFields,
  ]);
  const evidenceIds = new Set<string>();

  (response.evidence ?? []).forEach((item, index) => {
    const base = `/evidence/${index}`;
    if (evidenceIds.has(item.evidence_id))
      violations.push(
        violation(`${base}/evidence_id`, 'unique_evidence_id', `Duplicate evidence_id "${item.evidence_id}"`),
      );
    evidenceIds.add(item.evidence_id);

    const source = sourcesById.get(item.source_id);
    if (source === undefined) {
      violations.push(
        violation(
          `${base}/source_id`,
          'provenance_from_collected_sources',
          `source_id "${item.source_id}" was not retrieved; cite only the supplied sources`,
          { collected: [...sourcesById.keys()] },
        ),
      );
    } else if (item.source_url !== null && item.source_url !== source.url) {
      violations.push(
        violation(
          `${base}/source_url`,
          'provenance_from_collected_sources',
          `source_url must be the retrieved URL ${JSON.stringify(source.url)}`,
        ),
      );
    }
    for (const ref of [...(item.supports ?? []), ...(item.contradicts ?? [])]) {
      if (targets.size > 0 && !targets.has(ref)) {
        violations.push(
          violation(
            `${base}/supports`,
            'reference_supplied_targets',
            `"${ref}" is not a supplied candidate id or requested field`,
            { allowed: [...targets] },
          ),
        );
      }
    }
    if (item.kind === 'OBSERVED' && (item.quote === null || item.quote.trim().length === 0)) {
      violations.push(
        violation(
          `${base}/kind`,
          'observed_requires_quote',
          'OBSERVED evidence must carry a short supporting quote from the source; otherwise label it INFERENCE or CROSS_SOURCE',
        ),
      );
    }
  });

  (response.sources ?? []).forEach((source, index) => {
    if (!sourcesById.has(source.source_id)) {
      violations.push(
        violation(
          `/sources/${index}/source_id`,
          'provenance_from_collected_sources',
          `source "${source.source_id}" was not retrieved`,
        ),
      );
    }
  });

  (response.findings ?? []).forEach((finding, index) => {
    for (const id of finding.evidence_ids ?? []) {
      if (!evidenceIds.has(id))
        violations.push(
          violation(
            `/findings/${index}/evidence_ids`,
            'dangling_evidence_reference',
            `Finding references unknown evidence "${id}"`,
          ),
        );
    }
  });
  (response.contradictions ?? []).forEach((contradiction, index) => {
    for (const id of contradiction.evidence_ids ?? []) {
      if (!evidenceIds.has(id))
        violations.push(
          violation(
            `/contradictions/${index}/evidence_ids`,
            'dangling_evidence_reference',
            `Contradiction references unknown evidence "${id}"`,
          ),
        );
    }
  });

  const count = (response.evidence ?? []).length;
  if (count === 0 && (response.status === 'SUCCESS' || response.status === 'PARTIAL')) {
    violations.push(
      violation(
        '/status',
        'status_matches_evidence',
        'No evidence was extracted: status must be NO_RELIABLE_EVIDENCE (never certainty without evidence)',
      ),
    );
  }
  if (count > 0 && response.status === 'NO_RELIABLE_EVIDENCE') {
    violations.push(
      violation(
        '/status',
        'status_matches_evidence',
        'Evidence was extracted: status must be SUCCESS or PARTIAL',
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
