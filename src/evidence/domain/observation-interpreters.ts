import {
  type ActorRole,
  actorId,
  type Assertion,
  assertionIdOf,
  conceptId,
  contextId,
  countryCode,
  type EvidenceKind,
  evidenceIdOf,
  gpcId,
  nodeTypeOf,
  normalizeLabel,
  type NormalizedEvidence,
  normalizePolarity,
  type ObservationInput,
  phraseId,
  type Polarity,
  type Provenance,
  round3,
} from './evidence-model';

/**
 * Deterministic interpreters for *structured* observations (Evidence TDR §32A, §50.3–§50.6,
 * §52.1–§52.4). CSRE, GPC, WRS and Enrichment outputs are already schema-validated structured
 * facts, so no model call is needed to turn them into evidence — only a faithful, provenance-
 * preserving normalisation. Free-text vendor/buyer observations go through the interpretation
 * prompt instead.
 */

type Wire = Record<string, unknown>;

export interface InterpretedItem {
  readonly assertion: Assertion;
  readonly subjectLabel: string;
  readonly objectLabel: string;
  readonly polarity: Polarity;
  readonly strength: number;
  readonly kind: EvidenceKind;
  readonly claim: string;
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
  readonly independenceKey: string;
  readonly quote: string | null;
  readonly sourceId: string | null;
  readonly sourceUrl: string | null;
  readonly upstream: Readonly<Record<string, unknown>>;
  readonly sourcePayload: Readonly<Record<string, unknown>>;
  readonly validUntil?: Date | null;
}

const str = (value: unknown): string =>
  typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const optional = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** Wraps interpreted items as immutable evidence with §13 provenance. */
export function toEvidence(
  observation: ObservationInput,
  items: readonly InterpretedItem[],
): NormalizedEvidence[] {
  return items.map((item, index) => {
    const provenance: Provenance = {
      sourceType: observation.observationType,
      sourceId: item.sourceId,
      sourceUrl: item.sourceUrl,
      component: observation.source.component,
      componentVersion: observation.source.version,
      requestId: observation.source.requestId,
      turnId: observation.interaction.turnId,
      actorId: observation.actor === null ? null : actorId(observation.actor.role, observation.actor.id),
      actorRole: observation.actor?.role ?? null,
      channel: observation.channel,
      workflowId: observation.interaction.workflowId,
      interactionId: observation.interaction.interactionId ?? observation.interaction.conversationId,
      directness: item.kind,
      quote: item.quote,
      upstream: item.upstream,
    };
    return {
      evidenceId: evidenceIdOf(observation.observationId, index + 1),
      observationId: observation.observationId,
      assertion: item.assertion,
      assertionId: assertionIdOf(item.assertion),
      subjectType: nodeTypeOf(item.assertion.subject),
      objectType: nodeTypeOf(item.assertion.object),
      subjectLabel: item.subjectLabel,
      objectLabel: item.objectLabel,
      polarity: item.polarity,
      strength: round3(item.strength),
      kind: item.kind,
      claim: item.claim,
      supports: item.supports,
      contradicts: item.contradicts,
      provenance,
      independenceKey: item.independenceKey,
      observedAt: observation.observedAt,
      validFrom: observation.observedAt,
      validUntil: item.validUntil ?? null,
      context: { country: observation.context.country ?? 'NG', region: observation.context.region ?? null },
      sourcePayload: item.sourcePayload,
    };
  });
}

/**
 * §32A / §50.4 / §52.1 — CSRE semantic-origin observation: `Phrase → EXPRESSES → MarketConcept`.
 * The complete semantic_origin record is preserved verbatim; the object's ambiguity lowers
 * strength; a NON_REFERENTIAL/NON_COMMERCIAL object produces no market evidence.
 */
export function interpretCsreObservation(observation: ObservationInput): InterpretedItem[] {
  const payload = observation.payload;
  const origin = (payload.semanticOrigin ?? payload.semantic_origin ?? {}) as Wire;
  const phrase = str(origin.phrase ?? payload.surfaceForm);
  const concept = str(origin.concept ?? payload.canonicalForm);
  if (phrase.length === 0 || concept.length === 0) return [];
  const relevance = str(payload.commercialRelevance);
  if (relevance === 'NON_COMMERCIAL') return [];
  const country = countryCode(observation.context);
  const marketConceptId = optional(origin.market_concept_id);
  const confidence = num(origin.semantic_confidence, 0.5);
  const ambiguous = payload.ambiguityPresent === true;
  const subject = phraseId(phrase, country);
  const object = conceptId(marketConceptId, concept);
  const conversation =
    observation.interaction.conversationId ?? observation.source.requestId ?? observation.observationId;
  return [
    {
      assertion: { subject, predicate: 'mkg:EXPRESSES', object },
      subjectLabel: phrase,
      objectLabel: concept,
      polarity: 'POSITIVE',
      strength: Math.max(0, Math.min(1, ambiguous ? confidence * 0.5 : confidence)),
      kind: 'INFERRED',
      claim: `CSRE resolved the expression "${phrase}" to the market concept "${concept}" (${str(origin.concept_status) || 'PROPOSED'}, confidence ${confidence.toFixed(2)})`,
      supports: [],
      contradicts: [],
      // One conversation resolving the same phrase repeatedly is one observation of usage.
      independenceKey: `CSRE_SEMANTIC_RESOLUTION:${conversation}:${normalizeLabel(phrase)}→${normalizeLabel(concept)}`,
      quote: phrase,
      sourceId: str(payload.semanticObjectId) || null,
      sourceUrl: null,
      upstream: {
        semantic_origin: origin,
        csre_request_id: observation.source.requestId,
        object_id: payload.objectId ?? null,
        semantic_object_id: payload.semanticObjectId ?? null,
        entity_type: payload.entityType ?? null,
        commercial_relevance: relevance || null,
      },
      sourcePayload: payload,
    },
  ];
}

/**
 * §50.5 / §52.4 — GPC mapping fact: `MarketConcept → MAPPED_TO_GPC → GPC node`. Never vendor
 * capability. MAPPED → POSITIVE at mapping confidence; AMBIGUOUS/INSUFFICIENT → NEUTRAL toward the
 * diagnosed level when a code exists; NOT_APPLICABLE → nothing.
 */
export function interpretGpcObservation(observation: ObservationInput): InterpretedItem[] {
  const payload = observation.payload;
  const state = str(payload.state);
  const code = optional(payload.gpcCode);
  const concept = str(payload.concept);
  if (state === 'NOT_APPLICABLE' || code === null || concept.length === 0) return [];
  const marketConceptId = optional(payload.marketConceptId);
  const confidence = num(payload.mappingConfidence, 0.5);
  const title = str(payload.gpcTitle);
  const polarity: Polarity = state === 'MAPPED' ? 'POSITIVE' : 'NEUTRAL';
  return [
    {
      assertion: {
        subject: conceptId(marketConceptId, concept),
        predicate: 'mkg:MAPPED_TO_GPC',
        object: gpcId(code),
      },
      subjectLabel: concept,
      objectLabel: title.length > 0 ? `${title} [${code}]` : code,
      polarity,
      strength: Math.max(0, Math.min(1, confidence)),
      kind: 'INFERRED',
      claim: `GPC Resolver ${state === 'MAPPED' ? 'mapped' : `diagnosed (${state})`} "${concept}" onto GPC ${str(payload.gpcLevel)} ${code}${title ? ` (${title})` : ''} at ${confidence.toFixed(2)}`,
      supports: [],
      contradicts: [],
      // Re-running the same deterministic resolver on the same concept is not new corroboration.
      independenceKey: `GPC_MAPPING:${normalizeLabel(concept)}→${code}:${str(payload.gpcVersion)}`,
      quote: null,
      sourceId: str(payload.gpcMappingId) || null,
      sourceUrl: null,
      upstream: {
        gpc_resolver_request_id: observation.source.requestId,
        gpc_resolver_version: observation.source.version,
        gpc_dataset_version: payload.gpcVersion ?? null,
        market_concept_id: marketConceptId,
        gpc_code: code,
        gpc_level: payload.gpcLevel ?? null,
        mapping_state: state,
        mapping_confidence: confidence,
        evidence_ids: payload.evidenceIds ?? [],
        csre_request_id: payload.csreRequestId ?? null,
        enrichment_request_id: payload.enrichmentRequestId ?? null,
      },
      sourcePayload: payload,
    },
  ];
}

export interface WrsEvidenceRow {
  readonly evidenceId: string;
  readonly claim: string;
  readonly kind: string;
  readonly supports: readonly string[];
  readonly contradicts: readonly string[];
  readonly relationshipTarget: Readonly<Record<string, unknown>> | null;
  readonly sourceId: string;
  readonly sourceUrl: string | null;
  readonly sourceTitle: string | null;
  readonly sourceType: string;
  readonly geographicRelevance: string;
  readonly temporalRelevance: string;
  readonly quality: string;
  readonly confidence: number;
  readonly evidence: Readonly<Record<string, unknown>>;
}

export interface WrsRequestView {
  readonly requestId: string;
  readonly consumer: { component: string; version: string; purpose: string };
  readonly question: string;
  readonly phrase: string | null;
  readonly concept: string | null;
  readonly marketConceptId: string | null;
  readonly candidates: readonly { candidateId: string; label: string }[];
  readonly relationshipTarget: {
    subjectId: string | null;
    predicate: string | null;
    objectId: string | null;
  } | null;
  readonly country: string | null;
}

const QUALITY_FACTOR: Readonly<Record<string, number>> = { HIGH: 1, MEDIUM: 0.8, LOW: 0.5 };
const GEO_FACTOR: Readonly<Record<string, number>> = { HIGH: 1, MEDIUM: 0.85, LOW: 0.6, UNKNOWN: 0.7 };

/**
 * §50.6 / §52.3 — WRS external evidence. Each WRS item keeps its wrs request/evidence ids and source
 * metadata (never rephrased into a direct fact). The assertion comes from the request: candidate
 * support/contradiction on a phrase → `EXPRESSES` → candidate concept; an explicit relationship
 * target when the consumer supplied one; otherwise the concept the question was about.
 */
export function interpretWrsObservation(
  observation: ObservationInput,
  request: WrsRequestView,
  rows: readonly WrsEvidenceRow[],
): InterpretedItem[] {
  const country = countryCode({ country: request.country ?? observation.context.country });
  const labels = new Map(request.candidates.map((candidate) => [candidate.candidateId, candidate.label]));
  const items: InterpretedItem[] = [];
  for (const row of rows) {
    const kind: EvidenceKind =
      row.kind === 'OBSERVED' ? 'DIRECT' : row.kind === 'CROSS_SOURCE' ? 'CONTEXTUAL' : 'INFERRED';
    const strength = round3(
      row.confidence * (QUALITY_FACTOR[row.quality] ?? 0.7) * (GEO_FACTOR[row.geographicRelevance] ?? 0.7),
    );
    const host = hostOf(row.sourceUrl);
    const base = {
      strength,
      kind,
      claim: row.claim,
      supports: row.supports,
      contradicts: row.contradicts,
      // The same web source retrieved again is the same source (§39).
      independenceKey: `WRS_EXTERNAL_EVIDENCE:${host ?? row.sourceId}:${normalizeLabel(row.claim).slice(0, 80)}`,
      quote: optional((row.evidence as Wire).quote),
      sourceId: row.sourceId,
      sourceUrl: row.sourceUrl,
      upstream: {
        wrs_request_id: request.requestId,
        wrs_evidence_id: row.evidenceId,
        source_id: row.sourceId,
        source_url: row.sourceUrl,
        source_title: row.sourceTitle,
        source_type: row.sourceType,
        geographic_relevance: row.geographicRelevance,
        temporal_relevance: row.temporalRelevance,
        source_quality: row.quality,
        confidence: row.confidence,
        consumer: request.consumer,
      },
      sourcePayload: row.evidence,
    };
    const targets: Array<{
      assertion: Assertion;
      subjectLabel: string;
      objectLabel: string;
      polarity: Polarity;
    }> = [];
    if (request.phrase !== null) {
      for (const id of row.supports) {
        const label = labels.get(id);
        if (label !== undefined)
          targets.push({
            assertion: {
              subject: phraseId(request.phrase, country),
              predicate: 'mkg:EXPRESSES',
              object: conceptId(null, label),
            },
            subjectLabel: request.phrase,
            objectLabel: label,
            polarity: 'POSITIVE',
          });
      }
      for (const id of row.contradicts) {
        const label = labels.get(id);
        if (label !== undefined)
          targets.push({
            assertion: {
              subject: phraseId(request.phrase, country),
              predicate: 'mkg:EXPRESSES',
              object: conceptId(null, label),
            },
            subjectLabel: request.phrase,
            objectLabel: label,
            polarity: 'NEGATIVE',
          });
      }
    }
    const target = row.relationshipTarget ?? null;
    if (
      targets.length === 0 &&
      target !== null &&
      typeof target.subject_id === 'string' &&
      typeof target.predicate === 'string' &&
      typeof target.object_id === 'string'
    ) {
      targets.push({
        assertion: { subject: target.subject_id, predicate: target.predicate, object: target.object_id },
        subjectLabel: target.subject_id,
        objectLabel: target.object_id,
        polarity: row.contradicts.length > 0 && row.supports.length === 0 ? 'NEGATIVE' : 'POSITIVE',
      });
    }
    if (
      targets.length === 0 &&
      request.relationshipTarget !== null &&
      request.relationshipTarget.subjectId &&
      request.relationshipTarget.predicate &&
      request.relationshipTarget.objectId
    ) {
      targets.push({
        assertion: {
          subject: request.relationshipTarget.subjectId,
          predicate: request.relationshipTarget.predicate,
          object: request.relationshipTarget.objectId,
        },
        subjectLabel: request.relationshipTarget.subjectId,
        objectLabel: request.relationshipTarget.objectId,
        polarity: row.contradicts.length > 0 && row.supports.length === 0 ? 'NEGATIVE' : 'POSITIVE',
      });
    }
    if (targets.length === 0 && request.concept !== null && request.phrase !== null) {
      // Evidence about the concept itself without candidate attribution: contextual support for the consumer's own resolution.
      targets.push({
        assertion: {
          subject: phraseId(request.phrase, country),
          predicate: 'mkg:EXPRESSES',
          object: conceptId(request.marketConceptId, request.concept),
        },
        subjectLabel: request.phrase,
        objectLabel: request.concept,
        polarity: 'NEUTRAL',
      });
    }
    for (const entry of targets)
      items.push({ ...base, ...entry, kind: entry.polarity === 'NEUTRAL' ? 'CONTEXTUAL' : kind });
  }
  return items;
}

/**
 * Enrichment-derived terminology (§3.2 "Enrichment-derived knowledge", §29): synonyms and
 * aliases become weak `Concept → HAS_ALIAS → Phrase` evidence, model-derived (INFERRED), never
 * independent of the concept's own resolution (§38).
 */
export function interpretEnrichmentObservation(observation: ObservationInput): InterpretedItem[] {
  const payload = observation.payload;
  const profiles = Array.isArray(payload.profiles) ? (payload.profiles as Wire[]) : [];
  const country = countryCode(observation.context);
  const items: InterpretedItem[] = [];
  for (const profile of profiles) {
    const concept = str(profile.concept ?? profile.canonicalForm);
    if (concept.length === 0) continue;
    const marketConceptId = optional(profile.marketConceptId);
    const terminology = ((profile.profile as Wire | undefined)?.commercial_terminology ?? {}) as Wire;
    const aliases = new Set<string>();
    for (const key of ['synonyms', 'aliases', 'informal_terms', 'regional_terms']) {
      for (const alias of Array.isArray(terminology[key]) ? (terminology[key] as unknown[]) : []) {
        const text = str(alias).trim();
        if (text.length > 1 && normalizeLabel(text) !== normalizeLabel(concept)) aliases.add(text);
      }
    }
    for (const alias of [...aliases].slice(0, 8)) {
      items.push({
        assertion: {
          subject: conceptId(marketConceptId, concept),
          predicate: 'mkg:HAS_ALIAS',
          object: phraseId(alias, country),
        },
        subjectLabel: concept,
        objectLabel: alias,
        polarity: 'POSITIVE',
        strength: 0.3,
        kind: 'INFERRED',
        claim: `Enrichment lists "${alias}" as commercial terminology for "${concept}"`,
        supports: [],
        contradicts: [],
        independenceKey: `ENRICHMENT_INSIGHT:${normalizeLabel(concept)}→${normalizeLabel(alias)}`,
        quote: null,
        sourceId: str(profile.id) || null,
        sourceUrl: null,
        upstream: {
          enrichment_request_id: observation.source.requestId,
          enrichment_profile_id: profile.id ?? null,
          object_id: profile.objectId ?? null,
          market_concept_id: marketConceptId,
        },
        sourcePayload: { concept, alias, terminology },
      });
    }
  }
  return items;
}

/**
 * Structured vendor/buyer interaction observations (§11, §42, §54.4) submitted with explicit
 * objects — no model needed. Payload: `{ objects: [{ label, market_concept_id?, polarity?,
 * quote? }], functional_context?: [..], venue?: string }`. Buyer observations produce
 * `REQUESTED`; vendor observations produce `SUPPLIES` (NEGATIVE for rejections/"don't have").
 */
export function interpretStructuredInteraction(observation: ObservationInput): InterpretedItem[] {
  const payload = observation.payload;
  const objects = Array.isArray(payload.objects) ? (payload.objects as Wire[]) : [];
  if (observation.actor === null || objects.length === 0) return [];
  const role: ActorRole = observation.actor.role;
  const subject = actorId(role, observation.actor.id);
  const isVendor = role === 'VENDOR';
  const defaultPolarity: Polarity =
    observation.observationType === 'VENDOR_REJECTION' ? 'NEGATIVE' : 'POSITIVE';
  const defaultStrength =
    observation.observationType === 'FULFILLMENT_COMPLETED'
      ? 0.9
      : observation.observationType === 'VENDOR_CONFIRMATION' ||
          observation.observationType === 'VENDOR_REJECTION'
        ? 0.85
        : observation.observationType === 'BUYER_REQUEST'
          ? 0.7
          : 0.75;
  const interaction =
    observation.interaction.interactionId ??
    observation.interaction.conversationId ??
    observation.observationId;
  const items: InterpretedItem[] = [];
  const contexts = Array.isArray(payload.functional_context)
    ? (payload.functional_context as unknown[]).map(str).filter((c) => c.length > 0)
    : [];
  for (const object of objects) {
    const label = str(object.label ?? object.concept ?? object.canonical_form);
    if (label.length === 0) continue;
    const concept = conceptId(optional(object.market_concept_id), label);
    const polarity = object.polarity === undefined ? defaultPolarity : normalizePolarity(object.polarity);
    const predicate = isVendor
      ? observation.observationType === 'VENDOR_INVENTORY_UPDATE'
        ? polarity === 'NEGATIVE'
          ? 'mkg:OUT_OF_STOCK'
          : 'mkg:IN_STOCK'
        : 'mkg:SUPPLIES'
      : 'mkg:REQUESTED';
    const effectivePolarity: Polarity = predicate === 'mkg:OUT_OF_STOCK' ? 'POSITIVE' : polarity;
    items.push({
      assertion: { subject, predicate, object: concept },
      subjectLabel: str(payload.actor_label) || observation.actor.id,
      objectLabel: label,
      polarity: effectivePolarity,
      strength: num(object.strength, defaultStrength),
      kind: 'DIRECT',
      claim: isVendor
        ? `${observation.observationType.replace(/_/g, ' ').toLowerCase()}: vendor ${observation.actor.id} ${polarity === 'NEGATIVE' ? 'does not supply' : 'supplies'} "${label}"`
        : `${observation.observationType.replace(/_/g, ' ').toLowerCase()}: buyer ${observation.actor.id} requested "${label}"`,
      supports: [],
      contradicts: [],
      independenceKey: `${observation.observationType}:${subject}:${normalizeLabel(label)}:${interaction}`,
      quote: optional(object.quote) ?? optional(observation.rawText),
      sourceId: optional(observation.source.eventId),
      sourceUrl: null,
      upstream: { object, interaction: observation.interaction },
      sourcePayload: object,
      validUntil:
        predicate === 'mkg:IN_STOCK' || predicate === 'mkg:OUT_OF_STOCK'
          ? new Date(observation.observedAt.getTime() + 30 * 86_400_000)
          : null,
    });
    for (const context of contexts) {
      items.push({
        assertion: { subject: concept, predicate: 'mkg:USED_FOR', object: contextId(context) },
        subjectLabel: label,
        objectLabel: context,
        polarity: 'POSITIVE',
        strength: 0.4,
        kind: 'CONTEXTUAL',
        claim: `"${label}" was requested in the context of ${context}`,
        supports: [],
        contradicts: [],
        independenceKey: `${observation.observationType}:${normalizeLabel(label)}→${normalizeLabel(context)}:${interaction}`,
        quote: null,
        sourceId: optional(observation.source.eventId),
        sourceUrl: null,
        upstream: { interaction: observation.interaction },
        sourcePayload: { label, context },
      });
    }
  }
  return items;
}

function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}
