import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { AppConfigModule } from '../../src/config/config.module';
import { EMBEDDING_PROVIDER } from '../../src/domain/ports/outbound/embedding-provider.port';
import { PrismaEnrichmentRepository } from '../../src/enrichment/adapters/persistence/prisma-enrichment.repository';
import type { NewEnrichmentResolutionRecord } from '../../src/enrichment/ports/enrichment.repository.port';

/** Enrichment persistence against real Postgres + pgvector: per-object rows, three vectors, idempotency, latest-per-object. */
describe('Enrichment persistence', () => {
  let prisma: PrismaService;
  let repo: PrismaEnrichmentRepository;
  const DIMENSION = 1536;
  const vector = (seed: number) => Array.from({ length: DIMENSION }, (_, index) => (index === seed ? 1 : 0));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [
        PrismaService,
        PrismaEnrichmentRepository,
        {
          provide: EMBEDDING_PROVIDER,
          useValue: {
            model: 'test-embedding',
            dimension: DIMENSION,
            embed: async () => vector(0),
            embedBatch: async () => [],
          },
        },
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    repo = moduleRef.get(PrismaEnrichmentRepository);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.enrichmentResolution.deleteMany();
  });

  afterAll(async () => {
    await prisma.enrichmentResolution.deleteMany();
    await prisma.$disconnect();
  });

  const profile = (objectId: string, canonical: string, text: string) => ({
    object_id: objectId,
    semantic_origin: {
      phrase: canonical,
      concept: canonical,
      market_concept_id: null,
      concept_status: 'PROPOSED',
      relationship: 'EXPRESSES',
      origin: 'CSRE',
      request_id: 'req_csre',
      semantic_confidence: 0.9,
    },
    canonical_form: canonical,
    entity_type: 'PRODUCT',
    definition: `${canonical} definition`,
    embedding_representations: {
      canonical_embedding_text: text,
      functional_embedding_text: `${text} function`,
      taxonomy_embedding_text: `${text} taxonomy`,
      search_terms: [canonical],
      semantic_keywords: ['k'],
      negative_terms: ['n'],
    },
    evidence_required: false,
  });

  const record = (
    conversationId: string,
    turnId: string,
    csreRequestId: string,
  ): NewEnrichmentResolutionRecord => ({
    requestId: `req_${randomUUID()}`,
    idempotencyKey: `enrichment:${conversationId}:${turnId}:${csreRequestId}:SEMANTIC_SEARCH`,
    conversationId,
    turnId,
    runId: `turn:${turnId}`,
    contextSnapshotId: 'snap',
    sourceResolutionRequestId: csreRequestId,
    componentVersion: '4.4',
    promptId: 'enrichment.runtime.enrich',
    promptVersion: '4.4.0',
    schemaVersion: '4.0',
    policyVersion: 'enrichment-policy-1.0',
    downstreamPurpose: 'SEMANTIC_SEARCH',
    status: 'SUCCESS',
    enrichmentStatus: 'ENRICHED',
    resolution: { schema_version: '4.0' },
    objectCount: 2,
    evidenceRequired: false,
    promptExecutionId: null,
    modelProvider: 'openai',
    modelName: 'gpt-4o',
    latencyMs: 1200,
    error: null,
  });

  it('stores one profile per object with its three vectors, enforces the idempotency key and serves the latest profile per object', async () => {
    const conversationId = randomUUID();
    const turnId = randomUUID();
    const semanticObjectId = randomUUID();
    const csreRequestId = `req_${randomUUID()}`;

    const saved = await repo.save(record(conversationId, turnId, csreRequestId), [
      {
        objectId: 'object_1',
        semanticObjectId,
        profile: profile('object_1', 'hammer', 'hammer hand tool'),
        embeddings: {
          model: 'test-embedding',
          canonical: vector(1),
          functional: vector(2),
          taxonomy: vector(3),
        },
      },
      {
        objectId: 'object_2',
        semanticObjectId: null,
        profile: profile('object_2', 'nails', 'nails fastener'),
        embeddings: null,
      },
    ]);
    expect(saved.profiles.map((p) => [p.objectId, p.canonicalForm, p.embeddingModel])).toEqual([
      ['object_1', 'hammer', 'test-embedding'],
      ['object_2', 'nails', null],
    ]);

    const nearest = await prisma.$queryRaw<{ object_id: string; distance: number }[]>`
      SELECT object_id, (canonical_embedding <=> ${`[${vector(1).join(',')}]`}::vector) AS distance
      FROM enrichment_profiles WHERE canonical_embedding IS NOT NULL ORDER BY distance ASC LIMIT 1
    `;
    expect(nearest[0]?.object_id).toBe('object_1');
    expect(Number(nearest[0]?.distance)).toBeCloseTo(0, 5);

    await expect(repo.save(record(conversationId, turnId, csreRequestId), [])).rejects.toThrow();

    // A later enrichment of the same durable object wins the "latest" view.
    const later = await repo.save({ ...record(conversationId, randomUUID(), `req_${randomUUID()}`) }, [
      {
        objectId: 'object_1',
        semanticObjectId,
        profile: profile('object_1', 'hammer', 'hammer v2'),
        embeddings: null,
      },
    ]);
    const latest = await repo.latestProfilesForObjects([semanticObjectId]);
    expect(latest).toHaveLength(1);
    expect(latest[0]!.resolutionId).toBe(later.resolution.id);
    expect(latest[0]!.canonicalEmbeddingText).toBe('hammer v2');
  });
});
