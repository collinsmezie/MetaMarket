import type { WrsServiceRequest } from './wrs-evidence';

/**
 * Deterministic query planning (WRS TDR v4.4 §6 steps 1–3, §7). Queries are derived from the
 * consumer's question, the candidates and the geographic context — never from model memory —
 * so a retrieval is reproducible from its persisted request.
 */
export interface PlannedQuery {
  readonly query: string;
  readonly purpose: 'QUESTION' | 'LOCALITY' | 'CANDIDATE' | 'REQUESTED_FIELD';
  readonly country: string | null;
}

const NOISE = /[\s"“”'`]+/g;

export function planQueries(request: WrsServiceRequest, maxQueries: number): PlannedQuery[] {
  const context = request.context;
  const locality = localityOf(context);
  const country = countryOf(context);
  const subject = subjectOf(request);
  const planned: PlannedQuery[] = [];
  const seen = new Set<string>();
  const push = (query: string, purpose: PlannedQuery['purpose']) => {
    const text = query.replace(NOISE, ' ').trim();
    const key = text.toLowerCase();
    if (text.length === 0 || seen.has(key) || planned.length >= maxQueries) return;
    seen.add(key);
    planned.push({ query: text, purpose, country });
  };

  push(request.question, 'QUESTION');
  if (locality !== null) push(`${subject} ${locality}`, 'LOCALITY');
  for (const candidate of request.candidates) {
    push(`${subject} ${candidate.label}${locality === null ? '' : ` ${locality}`}`, 'CANDIDATE');
  }
  for (const field of request.requestedFields) {
    push(`${subject} ${field.replace(/[_-]+/g, ' ')}`, 'REQUESTED_FIELD');
  }
  return planned;
}

/** The phrase/concept the question is about, when the consumer named it; else the question itself. */
function subjectOf(request: WrsServiceRequest): string {
  const context = request.context;
  for (const key of ['phrase', 'surface_form', 'concept', 'canonical_form', 'subject']) {
    const value = context[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return request.question;
}

function localityOf(context: Readonly<Record<string, unknown>>): string | null {
  for (const key of ['geographic_context', 'locality', 'location', 'region', 'market']) {
    const value = context[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  const locations = context.locations;
  if (Array.isArray(locations) && locations.length > 0) {
    const first = locations[0] as Record<string, unknown> | string;
    return typeof first === 'string' ? first : String(first.value ?? '') || null;
  }
  return null;
}

function countryOf(context: Readonly<Record<string, unknown>>): string | null {
  const value = context.country_code ?? context.country;
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value.trim()) ? value.trim().toUpperCase() : null;
}
