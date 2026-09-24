import { assertionIdOf, type ObservationInput } from './evidence-model';
import { validateInterpretationInvariants } from './interpretation-invariants';
import {
  interpretCsreObservation,
  interpretGpcObservation,
  interpretStructuredInteraction,
  interpretWrsObservation,
  toEvidence,
} from './observation-interpreters';

const observation = (overrides: Partial<ObservationInput>): ObservationInput => ({
  observationId: 'obs:evt-1',
  observationType: 'CSRE_SEMANTIC_RESOLUTION',
  source: { component: 'CSRE', version: '5.4', eventId: 'evt-1', requestId: 'req_csre' },
  actor: null,
  channel: 'web',
  interaction: {
    conversationId: 'conv-1',
    turnId: 'turn-1',
    runId: 'turn:turn-1',
    workflowId: null,
    actionId: null,
    interactionId: null,
  },
  observedAt: new Date('2026-09-24T12:00:00Z'),
  context: { country: 'NG', region: 'Lagos' },
  payload: {},
  rawText: null,
  ...overrides,
});

describe('deterministic interpreters', () => {
  it('turns a CSRE semantic object into a Phrase → EXPRESSES → Concept observation preserving semantic_origin', () => {
    const items = interpretCsreObservation(
      observation({
        payload: {
          objectId: 'object_1',
          semanticObjectId: 'so-1',
          surfaceForm: 'iron sponge',
          canonicalForm: 'steel wool scouring pad',
          entityType: 'PRODUCT',
          commercialRelevance: 'DIRECT_PRODUCT',
          ambiguityPresent: false,
          semanticOrigin: {
            phrase: 'iron sponge',
            concept: 'steel wool scouring pad',
            market_concept_id: null,
            concept_status: 'PROPOSED',
            relationship: 'EXPRESSES',
            origin: 'CSRE',
            request_id: 'req_csre',
            semantic_confidence: 0.95,
          },
        },
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      assertion: {
        subject: 'phrase:ng:iron sponge',
        predicate: 'mkg:EXPRESSES',
        object: 'concept:proposed:steel wool scouring pad',
      },
      polarity: 'POSITIVE',
      strength: 0.95,
      independenceKey: 'CSRE_SEMANTIC_RESOLUTION:conv-1:iron sponge→steel wool scouring pad',
    });
    expect((items[0]!.upstream.semantic_origin as { request_id: string }).request_id).toBe('req_csre');
    const evidence = toEvidence(observation({}), items);
    expect(evidence[0]!.evidenceId).toBe('obs:evt-1#ev_1');
    expect(evidence[0]!.assertionId).toBe(assertionIdOf(items[0]!.assertion));
    expect(evidence[0]!.provenance).toMatchObject({
      sourceType: 'CSRE_SEMANTIC_RESOLUTION',
      component: 'CSRE',
      requestId: 'req_csre',
      turnId: 'turn-1',
    });
  });

  it('ignores non-commercial CSRE objects and NOT_APPLICABLE GPC mappings', () => {
    expect(
      interpretCsreObservation(
        observation({
          payload: {
            surfaceForm: 'my house',
            canonicalForm: 'house',
            commercialRelevance: 'NON_COMMERCIAL',
            semanticOrigin: { phrase: 'my house', concept: 'house' },
          },
        }),
      ),
    ).toEqual([]);
    expect(
      interpretGpcObservation(
        observation({
          observationType: 'GPC_MAPPING',
          payload: { state: 'NOT_APPLICABLE', concept: 'plumber', gpcCode: null },
        }),
      ),
    ).toEqual([]);
  });

  it('turns a GPC mapping into Concept → MAPPED_TO_GPC → gpc:<code> with mapping provenance', () => {
    const items = interpretGpcObservation(
      observation({
        observationType: 'GPC_MAPPING',
        source: { component: 'GPC_RESOLVER', version: '4.4', eventId: 'evt-2', requestId: 'req_gpc' },
        payload: {
          concept: 'wall socket',
          marketConceptId: null,
          state: 'MAPPED',
          gpcCode: '10005567',
          gpcLevel: 'BRICK',
          gpcTitle: 'Electrical Sockets',
          mappingConfidence: 0.88,
          gpcVersion: 'gs1:test',
          gpcMappingId: 'gm-1',
          csreRequestId: 'req_csre',
        },
      }),
    );
    expect(items[0]).toMatchObject({
      assertion: {
        subject: 'concept:proposed:wall socket',
        predicate: 'mkg:MAPPED_TO_GPC',
        object: 'gpc:10005567',
      },
      polarity: 'POSITIVE',
      strength: 0.88,
      independenceKey: 'GPC_MAPPING:wall socket→10005567:gs1:test',
    });
    expect(items[0]!.upstream).toMatchObject({
      gpc_resolver_request_id: 'req_gpc',
      gpc_code: '10005567',
      mapping_state: 'MAPPED',
      gpc_dataset_version: 'gs1:test',
    });
  });

  it('attributes WRS items to phrase → candidate concept assertions, positive for supports and negative for contradicts', () => {
    const request = {
      requestId: 'req_csre:wrs:1',
      consumer: { component: 'CSRE', version: '5.4', purpose: 'market_semantic_validation' },
      question: 'q',
      phrase: 'iron sponge',
      concept: null,
      marketConceptId: null,
      candidates: [
        { candidateId: 'cand_1', label: 'steel wool scouring pad' },
        { candidateId: 'cand_2', label: 'metal filter sponge' },
      ],
      relationshipTarget: null,
      country: 'NG',
    };
    const row = {
      evidenceId: 'req_csre:wrs:1#ev_1',
      claim: 'Nigerian retailers list iron sponge as steel wool',
      kind: 'OBSERVED',
      supports: ['cand_1'],
      contradicts: ['cand_2'],
      relationshipTarget: null,
      sourceId: 'src_1',
      sourceUrl: 'https://jumia.com.ng/iron-sponge?x=1',
      sourceTitle: 'Iron sponge',
      sourceType: 'retailer',
      geographicRelevance: 'HIGH',
      temporalRelevance: 'CURRENT',
      quality: 'MEDIUM',
      confidence: 0.9,
      evidence: { quote: 'iron sponge steel wool' },
    };
    const items = interpretWrsObservation(
      observation({ observationType: 'WRS_EXTERNAL_EVIDENCE' }),
      request,
      [row],
    );
    expect(items.map((item) => [item.assertion.object, item.polarity])).toEqual([
      ['concept:proposed:steel wool scouring pad', 'POSITIVE'],
      ['concept:proposed:metal filter sponge', 'NEGATIVE'],
    ]);
    expect(items[0]).toMatchObject({
      strength: 0.72,
      kind: 'DIRECT',
      sourceUrl: 'https://jumia.com.ng/iron-sponge?x=1',
      independenceKey: expect.stringContaining('jumia.com.ng/iron-sponge'),
    });
    expect(items[0]!.upstream).toMatchObject({
      wrs_request_id: 'req_csre:wrs:1',
      wrs_evidence_id: 'req_csre:wrs:1#ev_1',
      source_quality: 'MEDIUM',
    });
  });

  it('turns structured vendor and buyer interactions into SUPPLIES / REQUESTED evidence with shared context', () => {
    const vendor = interpretStructuredInteraction(
      observation({
        observationType: 'VENDOR_RESPONSE',
        actor: { id: 'v-1', role: 'VENDOR' },
        payload: {
          objects: [
            { label: 'hammer' },
            { label: 'nails' },
            { label: 'electrical materials', polarity: 'NEGATIVE' },
          ],
          functional_context: ['roofing'],
        },
      }),
    );
    expect(
      vendor
        .filter((item) => item.assertion.predicate === 'mkg:SUPPLIES')
        .map((item) => [item.objectLabel, item.polarity]),
    ).toEqual([
      ['hammer', 'POSITIVE'],
      ['nails', 'POSITIVE'],
      ['electrical materials', 'NEGATIVE'],
    ]);
    expect(vendor.filter((item) => item.assertion.predicate === 'mkg:USED_FOR')).toHaveLength(3);
    const buyer = interpretStructuredInteraction(
      observation({
        observationType: 'BUYER_REQUEST',
        actor: { id: 'b-1', role: 'BUYER' },
        payload: { objects: [{ label: 'dumbbells' }] },
      }),
    );
    expect(buyer[0]).toMatchObject({
      assertion: { subject: 'buyer:b-1', predicate: 'mkg:REQUESTED', object: 'concept:proposed:dumbbells' },
      polarity: 'POSITIVE',
    });
  });
});

describe('validateInterpretationInvariants', () => {
  const obs = observation({
    observationType: 'VENDOR_STATEMENT',
    actor: { id: 'v-1', role: 'VENDOR' },
    rawText: 'I sell hammer drills',
  });
  const item = (overrides: Record<string, unknown>) => ({
    evidence_id: 'ev_1',
    observation_id: 'obs:evt-1',
    assertion: { subject: 'vendor:v-1', predicate: 'mkg:SUPPLIES', object: 'concept:proposed:hammer drill' },
    polarity: 'POSITIVE',
    strength: 0.85,
    provenance: { source_type: 'VENDOR_STATEMENT', directness: 'DIRECT', quote: 'I sell hammer drills' },
    independence_key: 'k',
    claim: 'c',
    kind: 'DIRECT',
    subject_label: 'Vendor',
    object_label: 'hammer drill',
    supports: [],
    contradicts: [],
    ...overrides,
  });

  it('accepts a well-formed vendor capability item', () => {
    expect(
      validateInterpretationInvariants({ schema_version: '4.0', evidence: [item({})] }, obs, [], null),
    ).toEqual([]);
  });

  it('rejects wrong actor, buyer-as-supplier, unknown predicate, invented GPC and over-strength', () => {
    const buyer = observation({ observationType: 'BUYER_REQUEST', actor: { id: 'b-1', role: 'BUYER' } });
    const keywords = (payload: unknown, o: ObservationInput) =>
      validateInterpretationInvariants(payload, o, [], new Set(['10005567'])).map((v) => v.keyword);
    expect(
      keywords(
        {
          evidence: [
            item({
              assertion: { subject: 'vendor:other', predicate: 'mkg:SUPPLIES', object: 'concept:proposed:x' },
            }),
          ],
        },
        obs,
      ),
    ).toContain('actor_identity');
    expect(
      keywords(
        {
          evidence: [
            item({
              assertion: { subject: 'buyer:b-1', predicate: 'mkg:SUPPLIES', object: 'concept:proposed:x' },
            }),
          ],
        },
        buyer,
      ),
    ).toContain('demand_is_not_capability');
    expect(
      keywords(
        {
          evidence: [
            item({
              assertion: { subject: 'vendor:v-1', predicate: 'mkg:SELLS', object: 'concept:proposed:x' },
            }),
          ],
        },
        obs,
      ),
    ).toContain('mkg_vocabulary');
    expect(
      keywords(
        {
          evidence: [
            item({
              assertion: {
                subject: 'concept:proposed:x',
                predicate: 'mkg:MAPPED_TO_GPC',
                object: 'gpc:99999999',
              },
            }),
          ],
        },
        obs,
      ),
    ).toContain('no_invented_gpc');
    expect(keywords({ evidence: [item({ strength: 0.99 })] }, obs)).toContain('single_observation_cap');
  });
});
