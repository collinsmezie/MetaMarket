import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { AppConfigModule } from '../../src/config/config.module';
import { PrismaSemanticResolutionRepository } from '../../src/semantics/adapters/persistence/prisma-semantic-resolution.repository';
import type { NewSemanticResolutionRecord } from '../../src/semantics/ports/semantic-resolution.repository.port';

/** CSRE persistence against real Postgres: per-object rows, idempotency key uniqueness, prior-turn objects. */
describe('Semantic resolution persistence', () => {
  let prisma: PrismaService;
  let repo: PrismaSemanticResolutionRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [PrismaService, PrismaSemanticResolutionRepository],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    repo = moduleRef.get(PrismaSemanticResolutionRepository);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.semanticResolution.deleteMany();
  });

  afterAll(async () => {
    await prisma.semanticResolution.deleteMany();
    await prisma.$disconnect();
  });

  const object = (id: string, surface: string, canonical: string, requestId: string) => ({
    object_id: id,
    semantic_origin: {
      phrase: surface,
      concept: canonical,
      market_concept_id: null,
      concept_status: 'PROPOSED',
      relationship: 'EXPRESSES',
      origin: 'CSRE',
      request_id: requestId,
      semantic_confidence: 0.9,
    },
    surface_form: surface,
    canonical_form: canonical,
    entity_type: 'PRODUCT',
    definition: '',
    brand: id === 'object_2' ? 'Peak' : null,
    model: null,
    attributes: { pack: 'tin' },
    aliases: [],
    commercial_interpretation: {
      relevance: 'DIRECT_PRODUCT',
      commercial_offering: true,
      reason: '',
      confidence: 0.9,
    },
    confidence: { semantic_resolution: 0.9, commercial_relevance: 0.9 },
    ambiguity: { present: false, remaining_candidates: [] },
    functional_context: [],
    relationships: [],
  });

  const record = (
    conversationId: string,
    turnId: string,
    objects: Array<[string, string, string]>,
    status: NewSemanticResolutionRecord['status'] = 'SUCCESS',
  ): NewSemanticResolutionRecord => {
    const requestId = `req_${randomUUID()}`;
    return {
      requestId,
      idempotencyKey:
        status === 'SUCCESS'
          ? `csre:${conversationId}:${turnId}:0`
          : `csre:${conversationId}:${turnId}:0:failed:${requestId}`,
      conversationId,
      turnId,
      runId: `turn:${turnId}`,
      contextSnapshotId: 'snap',
      understandingRevision: 0,
      componentVersion: '5.4',
      promptId: 'csre.runtime.resolve',
      promptVersion: '5.4.3',
      schemaVersion: '5.0',
      policyVersion: 'csre-policy-1.0',
      status,
      resolutionStatus: status === 'SUCCESS' ? (objects.length > 1 ? 'COMPOSITE' : 'RESOLVED') : null,
      resolution:
        status === 'SUCCESS'
          ? {
              schema_version: '5.0',
              request_id: requestId,
              resolution_status: objects.length > 1 ? 'COMPOSITE' : 'RESOLVED',
              original_message: objects.map((o) => o[1]).join(' and '),
              objects: objects.map(([id, surface, canonical]) => object(id, surface, canonical, requestId)),
              context: {
                venues: [],
                regional_context: {
                  country: 'Nigeria',
                  region: null,
                  regional_terms: [],
                  regional_interpretation_used: false,
                },
                functional_context: [],
                location_context: null,
                qualifiers: [],
              },
              clarification: { required: false, question: null },
              evidence: [],
            }
          : null,
      objectCount: status === 'SUCCESS' ? objects.length : 0,
      canonicalForms: status === 'SUCCESS' ? objects.map((o) => o[2]) : [],
      entityTypes: status === 'SUCCESS' ? ['PRODUCT'] : [],
      clarificationRequired: false,
      promptExecutionId: null,
      modelProvider: 'openai',
      modelName: 'gpt-4o',
      latencyMs: 900,
      error: status === 'SUCCESS' ? null : { code: 'X', message: 'boom' },
    };
  };

  it('stores one row per object atomically, enforces the idempotency key and serves prior-turn objects', async () => {
    const conversationId = randomUUID();
    const turnA = randomUUID();
    const turnB = randomUUID();

    const saved = await repo.save(
      record(conversationId, turnA, [
        ['object_1', 'Indomie', 'instant noodles'],
        ['object_2', 'Peak milk', 'milk'],
      ]),
    );
    expect(saved.objects.map((o) => o.objectId)).toEqual(['object_1', 'object_2']);
    expect(saved.objects[1]!.brand).toBe('Peak');
    expect(saved.objects[0]!.semanticOrigin.request_id).toBe(saved.resolution.requestId);
    expect(saved.objects[0]!.object).toMatchObject({ attributes: { pack: 'tin' } });

    // Same turn + revision cannot be persisted twice as SUCCESS.
    await expect(
      repo.save(record(conversationId, turnA, [['object_1', 'Indomie', 'instant noodles']])),
    ).rejects.toThrow();

    // A failed attempt on turn B leaves no objects and does not surface as context.
    await repo.save(record(conversationId, turnB, [], 'TEMPORARY_FAILURE'));
    expect(await repo.objectsForRequest(saved.resolution.requestId)).toHaveLength(2);

    const prior = await repo.recentObjects(conversationId, turnB, 12);
    expect(prior.map((o) => [o.turnId, o.canonicalForm])).toEqual([
      [turnA, 'instant noodles'],
      [turnA, 'milk'],
    ]);
    // The current turn is excluded from its own prior state.
    expect(await repo.recentObjects(conversationId, turnA, 12)).toHaveLength(0);
  });
});
