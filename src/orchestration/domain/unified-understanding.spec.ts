import type { DiscoveredIntent, IDCEResolution } from '../../intent/domain/idce-resolution';
import type { CSREResolution, SemanticObject } from '../../semantics/domain/csre-resolution';
import { bindObjectsToIntents, collectUnresolvedIssues } from './unified-understanding';

const intent = (
  id: string,
  type: string,
  spans: string[],
  role: DiscoveredIntent['role'] = 'SECONDARY',
): DiscoveredIntent => ({
  intentId: id,
  type: type as DiscoveredIntent['type'],
  role,
  status: 'RESOLVED',
  confidence: 0.9,
  explicitness: 'EXPLICIT',
  priority: 0.8,
  scope: { type: 'OBJECT', objectIds: [], workflowIds: [], conversationScope: false },
  evidence: { explicit: true, implicit: false, contextUsed: false, signals: [] },
  dependencies: [],
  relatedIntents: [],
  constraints: [],
  sourceSpans: spans,
  routingHints: [],
});

const object = (
  id: string,
  surface: string,
  canonical: string,
  semantic = 0.95,
  ambiguous = false,
): SemanticObject => ({
  objectId: id,
  semanticOrigin: {
    phrase: surface,
    concept: canonical,
    market_concept_id: null,
    concept_status: 'PROPOSED',
    relationship: 'EXPRESSES',
    origin: 'CSRE',
    request_id: 'req',
    semantic_confidence: semantic,
  },
  surfaceForm: surface,
  canonicalForm: canonical,
  entityType: 'PRODUCT',
  definition: '',
  brand: null,
  model: null,
  attributes: {},
  aliases: [],
  commercialInterpretation: {
    relevance: 'DIRECT_PRODUCT',
    commercialOffering: true,
    reason: '',
    confidence: 0.9,
  },
  confidence: { semanticResolution: semantic, commercialRelevance: 0.9 },
  ambiguity: {
    present: ambiguous,
    remainingCandidates: ambiguous
      ? [
          { meaning: 'water pump', entityType: 'PRODUCT', definition: '', plausibility: 0.5 },
          { meaning: 'fuel pump', entityType: 'PRODUCT', definition: '', plausibility: 0.4 },
        ]
      : [],
  },
  functionalContext: [],
  relationships: [],
});

const idce = (
  intents: DiscoveredIntent[],
  clarification: IDCEResolution['clarification'] = null,
): IDCEResolution => ({
  resolutionStatus: 'RESOLVED',
  intents,
  relations: [],
  clarification,
  unresolved: [],
  contextUsed: {
    conversationHistory: false,
    activeWorkflows: false,
    semanticObjects: false,
    location: false,
    venue: false,
  },
  modelMetadata: { promptVersion: '1.6.1', schemaVersion: '1.0' },
});

const csre = (objects: SemanticObject[], question: string | null = null): CSREResolution => ({
  schemaVersion: '5.0',
  requestId: 'req',
  resolutionStatus: objects.length > 1 ? 'COMPOSITE' : 'RESOLVED',
  originalMessage: '',
  objects,
  context: {
    venues: [],
    regionalContext: {
      country: 'Nigeria',
      region: null,
      regionalTerms: [],
      regionalInterpretationUsed: false,
    },
    functionalContext: [],
    locationContext: null,
    qualifiers: [],
  },
  clarification: { required: question !== null, question },
  evidence: [],
});

describe('bindObjectsToIntents', () => {
  it('binds by source-span overlap and gives unclaimed objects to the PRIMARY intent', () => {
    const intents = [
      intent('i1', 'FIND_SERVICE', ['Find a plumber'], 'PRIMARY'),
      intent('i2', 'BUY', ['buy PVC pipe']),
    ];
    const objects = [
      object('object_1', 'plumber', 'plumbing service'),
      object('object_2', 'PVC pipe', 'PVC pipe'),
      object('object_3', 'glue', 'adhesive'),
    ];
    expect(bindObjectsToIntents(intents, objects)).toEqual([
      { intentId: 'i1', objectIds: ['object_1', 'object_3'], via: 'PRIMARY_FALLBACK' },
      { intentId: 'i2', objectIds: ['object_2'], via: 'SPAN_OVERLAP' },
    ]);
  });

  it('gives a single intent every object', () => {
    expect(
      bindObjectsToIntents(
        [intent('i1', 'BUY', ['x'], 'PRIMARY')],
        [object('object_1', 'a', 'a'), object('object_2', 'b', 'b')],
      ),
    ).toEqual([{ intentId: 'i1', objectIds: ['object_1', 'object_2'], via: 'SINGLE_INTENT' }]);
  });
});

describe('collectUnresolvedIssues', () => {
  it('raises a blocking referent issue for an ambiguous object under a referent-dependent intent', () => {
    const intents = [intent('i1', 'FIND_PRODUCT', ['Find me a pump'], 'PRIMARY')];
    const objects = [object('object_1', 'pump', 'pump', 0.4, true)];
    const issues = collectUnresolvedIssues(
      idce(intents),
      csre(objects, 'Is the pump for water or fuel?'),
      bindObjectsToIntents(intents, objects),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      source: 'CSRE',
      kind: 'REFERENT',
      blocking: true,
      question: 'Is the pump for water or fuel?',
      issueKey: 'object:pump:referent',
      targetIntentIds: ['i1'],
      targetObjectIds: ['object_1'],
    });
  });

  it('carries the IDCE recommendation and flags intents no capability serves; a clear referent raises nothing', () => {
    const intents = [
      intent('i1', 'BUY', ['I need a generator'], 'PRIMARY'),
      intent('i2', 'PAUSE', ['hold on']),
    ];
    const clarification = {
      required: true,
      reason: 'MISSING_REQUIRED_INFORMATION' as const,
      targetIntentIds: ['i1'],
      question: 'Which generator size do you need?',
      blocking: false,
      expectedResolution: 'capacity',
    };
    const objects = [object('object_1', 'generator', 'generator')];
    const issues = collectUnresolvedIssues(
      idce(intents, clarification),
      csre(objects),
      bindObjectsToIntents(intents, objects),
    );
    expect(issues.map((issue) => issue.kind)).toEqual(['MISSING_INFORMATION']);
    expect(issues[0]!.question).toBe('Which generator size do you need?');

    expect(
      collectUnresolvedIssues(idce([intent('i1', 'BUY', ['x'], 'PRIMARY')]), csre(objects), [
        { intentId: 'i1', objectIds: ['object_1'], via: 'SINGLE_INTENT' },
      ]),
    ).toEqual([]);
  });
});
