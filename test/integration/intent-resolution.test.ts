import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { AppConfigModule } from '../../src/config/config.module';
import { PrismaIntentResolutionRepository } from '../../src/intent/adapters/persistence/prisma-intent-resolution.repository';
import type { NewIntentResolutionRecord } from '../../src/intent/ports/intent-resolution.repository.port';

/** IDCE persistence against real Postgres: idempotency key uniqueness, prior-intent context, camel view. */
describe('Intent resolution persistence', () => {
  let prisma: PrismaService;
  let repo: PrismaIntentResolutionRepository;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [PrismaService, PrismaIntentResolutionRepository],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    repo = moduleRef.get(PrismaIntentResolutionRepository);
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.intentResolution.deleteMany();
  });

  afterAll(async () => {
    await prisma.intentResolution.deleteMany();
    await prisma.$disconnect();
  });

  const wire = (type: string, objectIds: string[]) => ({
    resolution_status: 'RESOLVED',
    intents: [
      {
        intent_id: 'i1',
        type,
        role: 'PRIMARY',
        status: 'RESOLVED',
        confidence: 0.9,
        explicitness: 'EXPLICIT',
        priority: 0.9,
        scope: { type: 'OBJECT', object_ids: objectIds, workflow_ids: [], conversation_scope: false },
        evidence: { explicit: true, implicit: false, context_used: false, signals: [] },
        dependencies: [],
        related_intents: [],
        constraints: [],
        source_spans: ['x'],
        routing_hints: [],
      },
    ],
    relations: [],
    clarification: null,
    unresolved: [],
    context_used: {
      conversation_history: false,
      active_workflows: false,
      semantic_objects: false,
      location: false,
      venue: false,
    },
    model_metadata: { prompt_version: '1.6.1', schema_version: '1.0' },
  });

  const record = (
    conversationId: string,
    turnId: string,
    type: string,
    objectIds: string[] = [],
  ): NewIntentResolutionRecord => ({
    requestId: `req_${randomUUID()}`,
    idempotencyKey: `idce:${conversationId}:${turnId}:0`,
    conversationId,
    turnId,
    runId: `turn:${turnId}`,
    contextSnapshotId: 'snap',
    understandingRevision: 0,
    componentVersion: '1.6',
    promptId: 'idce.master.discover',
    promptVersion: '1.6.1',
    schemaVersion: '1.0',
    policyVersion: 'idce-policy-1.0',
    status: 'SUCCESS',
    resolutionStatus: 'RESOLVED',
    resolution: wire(type, objectIds),
    primaryIntentType: type,
    intentTypes: [type],
    clarificationRequired: false,
    promptExecutionId: null,
    modelProvider: 'openai',
    modelName: 'gpt-4o',
    latencyMs: 1200,
    error: null,
  });

  it('persists once per idempotency key and exposes prior intent state for the next turn', async () => {
    const conversationId = randomUUID();
    const turnA = randomUUID();
    const turnB = randomUUID();

    await repo.save(record(conversationId, turnA, 'FIND_PRODUCT', ['object_1']));
    await expect(repo.save(record(conversationId, turnA, 'FIND_PRODUCT'))).rejects.toThrow();

    const prior = await repo.priorIntentState(conversationId, turnB, 5);
    expect(prior).toEqual([
      { turnId: turnA, intentId: 'i1', type: 'FIND_PRODUCT', status: 'RESOLVED', objectIds: ['object_1'] },
    ]);

    // The current turn is excluded from its own prior state.
    await repo.save(record(conversationId, turnB, 'PRICE_INQUIRY'));
    expect((await repo.priorIntentState(conversationId, turnB, 5)).map((entry) => entry.turnId)).toEqual([
      turnA,
    ]);

    const camel = await repo.latestResolutionForTurn(turnB);
    expect(camel!.intents[0]!.type).toBe('PRICE_INQUIRY');
    expect(camel!.modelMetadata.promptVersion).toBe('1.6.1');
  });
});
