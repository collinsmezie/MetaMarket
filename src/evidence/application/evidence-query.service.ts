import { Inject, Injectable } from '@nestjs/common';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import {
  conceptId,
  countryCode,
  EVIDENCE_RESPONSE_SCHEMA_ID,
  EVIDENCE_WIRE_SCHEMA_VERSION,
  phraseId,
  type Assertion,
  assertionIdOf,
} from '../domain/evidence-model';
import type {
  EvidenceQueryPort,
  EvidenceQueryRequest,
  EvidenceQueryResponse,
} from '../ports/evidence-query.port';
import {
  EVIDENCE_STORE,
  type AssertionRecord,
  type EvidenceRecord,
  type EvidenceStorePort,
  type KnowledgeRecord,
} from '../ports/evidence-store.port';

const EVIDENCE_LIMIT_PER_ASSERTION = 25;
type Wire = Record<string, unknown>;

/**
 * Evidence read path (Evidence TDR §29–§31, §50.1–§50.2). Resolves the request's phrases,
 * concepts, candidate interpretations and relationship target to assertion nodes, then returns
 * the evidence, current beliefs (insights), knowledge and contradictions attached to them —
 * with provenance, never a verdict. Knowledge is returned as knowledge, not as fresh evidence
 * (§38, §54.3).
 */
@Injectable()
export class EvidenceQueryService implements EvidenceQueryPort {
  constructor(
    @Inject(EVIDENCE_STORE) private readonly store: EvidenceStorePort,
    private readonly schemas: SchemaRegistry,
  ) {}

  async retrieve(request: EvidenceQueryRequest): Promise<EvidenceQueryResponse> {
    const country = countryCode({
      country:
        (request.context.country_code as string | undefined) ??
        (request.context.country as string | undefined) ??
        null,
    });
    const nodes = new Set<string>();
    for (const object of request.objects) {
      if (object.surfaceForm.length > 0) {
        nodes.add(phraseId(object.surfaceForm, country));
        // The surface form may itself be the concept label (buyer demand, vendor capability).
        nodes.add(conceptId(null, object.surfaceForm));
      }
      if (object.marketConceptId !== null) nodes.add(conceptId(object.marketConceptId, object.surfaceForm));
    }
    if (request.semanticTarget !== null) {
      nodes.add(phraseId(request.semanticTarget.phrase, country));
      if (request.semanticTarget.concept !== null) nodes.add(conceptId(null, request.semanticTarget.concept));
    }
    for (const candidate of request.candidateInterpretations) nodes.add(conceptId(null, candidate));
    const targetAssertion: Assertion | null =
      request.relationshipTarget !== null &&
      request.relationshipTarget.subjectId &&
      request.relationshipTarget.predicate &&
      request.relationshipTarget.objectId
        ? {
            subject: request.relationshipTarget.subjectId,
            predicate: request.relationshipTarget.predicate,
            object: request.relationshipTarget.objectId,
          }
        : null;

    const byId = new Map<string, AssertionRecord>();
    for (const node of nodes)
      for (const assertion of await this.store.assertionsForNode(node, null))
        byId.set(assertion.assertionId, assertion);
    if (targetAssertion !== null) {
      const found = await this.store.findAssertion(assertionIdOf(targetAssertion));
      if (found !== null) byId.set(found.assertionId, found);
    }
    const assertions = [...byId.values()];
    const evidence: EvidenceRecord[] = [];
    for (const assertion of assertions)
      evidence.push(
        ...(await this.store.evidenceForAssertion(assertion.assertionId)).slice(
          -EVIDENCE_LIMIT_PER_ASSERTION,
        ),
      );
    const knowledge = await this.store.knowledgeForAssertions(
      assertions.map((assertion) => assertion.assertionId),
    );

    const wire = this.envelope(request, assertions, evidence, knowledge);
    const check = this.schemas.validate(EVIDENCE_RESPONSE_SCHEMA_ID, wire);
    if (!check.valid)
      throw new Error(
        `EVIDENCE_RESPONSE_CONTRACT_VIOLATION: ${check.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
      );
    return {
      requestId: request.requestId,
      status: wire.status as EvidenceQueryResponse['status'],
      response: wire,
    };
  }

  private envelope(
    request: EvidenceQueryRequest,
    assertions: readonly AssertionRecord[],
    evidence: readonly EvidenceRecord[],
    knowledge: readonly KnowledgeRecord[],
  ): Wire {
    const independent = new Set(evidence.map((item) => item.independenceKey)).size;
    const contradictions = assertions.filter(
      (assertion) =>
        assertion.counts.POSITIVE > 0 && assertion.counts.NEGATIVE + assertion.counts.CONTRADICTORY > 0,
    );
    const status =
      evidence.length === 0 && knowledge.length === 0
        ? 'NO_RELIABLE_EVIDENCE'
        : assertions.some((assertion) => assertion.requiresMoreEvidence)
          ? 'PARTIAL'
          : 'SUCCESS';
    return {
      schema_version: EVIDENCE_WIRE_SCHEMA_VERSION,
      request_id: request.requestId,
      status,
      evidence: evidence.map(evidenceWire),
      knowledge: knowledge.map((item) => ({
        knowledge_id: item.knowledgeId,
        type: item.type,
        claim: item.claim,
        scope: item.scope,
        confidence: item.confidence,
        state: item.state,
        supported_by: item.supportedBy,
        contradicted_by: item.contradictedBy,
        last_validated_at: item.lastValidatedAt?.toISOString() ?? null,
      })),
      insights: assertions.map((assertion) => ({
        assertion_id: assertion.assertionId,
        subject: assertion.assertion.subject,
        predicate: assertion.assertion.predicate,
        object: assertion.assertion.object,
        subject_label: assertion.subjectLabel,
        object_label: assertion.objectLabel,
        belief: assertion.belief,
        direction: assertion.direction,
        state: assertion.state,
        evidence_count: assertion.evidenceCount,
        independent_source_count: assertion.independentSourceCount,
        requires_more_evidence: assertion.requiresMoreEvidence,
      })),
      contradictions: contradictions.map((assertion) => ({
        assertion_id: assertion.assertionId,
        supporting_evidence_ids: evidence
          .filter(
            (item) =>
              item.assertionId === assertion.assertionId &&
              (item.polarity === 'POSITIVE' || item.polarity === 'NEUTRAL'),
          )
          .map((item) => item.evidenceId),
        contradictory_evidence_ids: evidence
          .filter(
            (item) =>
              item.assertionId === assertion.assertionId &&
              (item.polarity === 'NEGATIVE' || item.polarity === 'CONTRADICTORY'),
          )
          .map((item) => item.evidenceId),
        current_belief: assertion.belief,
      })),
      provenance: dedupeProvenance(evidence),
      relationship_targets: assertions.map((assertion) => ({
        assertion_id: assertion.assertionId,
        subject_id: assertion.assertion.subject,
        predicate: assertion.assertion.predicate,
        object_id: assertion.assertion.object,
      })),
      quality: {
        evidence_count: evidence.length,
        independent_source_count: independent,
        knowledge_count: knowledge.length,
        contradiction_count: contradictions.length,
      },
    };
  }
}

export function evidenceWire(item: EvidenceRecord): Wire {
  return {
    evidence_id: item.evidenceId,
    claim: item.claim,
    supports: item.supports,
    contradicts: item.contradicts,
    relationship_target: {
      subject_id: item.assertion.subject,
      predicate: item.assertion.predicate,
      object_id: item.assertion.object,
      assertion_id: item.assertionId,
    },
    provenance: {
      source_type: item.provenance.sourceType,
      source_id: item.provenance.sourceId,
      source_url: item.provenance.sourceUrl,
      component: item.provenance.component,
      component_version: item.provenance.componentVersion,
      request_id: item.provenance.requestId,
      turn_id: item.provenance.turnId,
      actor_id: item.provenance.actorId,
      channel: item.provenance.channel,
      directness: item.provenance.directness,
      quote: item.provenance.quote,
      upstream: item.provenance.upstream,
    },
    confidence: item.strength,
    observation_id: item.observationId,
    assertion: item.assertion,
    polarity: item.polarity,
    strength: item.strength,
    independence_key: item.independenceKey,
    observed_at: item.observedAt.toISOString(),
  };
}

function dedupeProvenance(evidence: readonly EvidenceRecord[]): Wire[] {
  const seen = new Map<string, Wire>();
  for (const item of evidence) {
    const key = `${item.provenance.sourceType}:${item.provenance.component}:${item.provenance.requestId ?? ''}:${item.provenance.sourceUrl ?? item.provenance.sourceId ?? ''}`;
    if (!seen.has(key)) {
      seen.set(key, {
        source_type: item.provenance.sourceType,
        component: item.provenance.component,
        component_version: item.provenance.componentVersion,
        request_id: item.provenance.requestId,
        source_url: item.provenance.sourceUrl,
        actor_id: item.provenance.actorId,
        observation_ids: [item.observationId],
      });
    } else {
      const entry = seen.get(key)!;
      const ids = entry.observation_ids as string[];
      if (!ids.includes(item.observationId)) ids.push(item.observationId);
    }
  }
  return [...seen.values()];
}
