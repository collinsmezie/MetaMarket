import { Test } from '@nestjs/testing';
import { PrismaConversationRepository } from '../../src/adapters/outbound/persistence/prisma-conversation.repository';
import { PrismaWorkflowRepository } from '../../src/adapters/outbound/persistence/prisma-workflow.repository';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { RedisDistributedLockAdapter } from '../../src/adapters/outbound/persistence/redis-distributed-lock.adapter';
import { RedisService } from '../../src/adapters/outbound/persistence/redis.service';
import { AppConfigService } from '../../src/config/app-config.service';
import { AppConfigModule } from '../../src/config/config.module';
import { conversationLockKey } from '../../src/domain/ports/outbound/distributed-lock.port';

/**
 * Integration tests against the real Postgres and Redis from docker-compose
 * (Execution.md §4.2).
 *
 * The behaviours under test — concurrent upserts, pgvector similarity ordering, fencing
 * tokens — are properties of the datastores, not of our code alone. An in-memory fake would
 * pass while production still raced.
 */

describe('Persistence integration', () => {
  let prisma: PrismaService;
  let redis: RedisService;
  let conversations: PrismaConversationRepository;
  let workflows: PrismaWorkflowRepository;
  let locks: RedisDistributedLockAdapter;
  let dimension: number;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
      providers: [
        PrismaService,
        RedisService,
        PrismaConversationRepository,
        PrismaWorkflowRepository,
        RedisDistributedLockAdapter,
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    redis = moduleRef.get(RedisService);
    conversations = moduleRef.get(PrismaConversationRepository);
    workflows = moduleRef.get(PrismaWorkflowRepository);
    locks = moduleRef.get(RedisDistributedLockAdapter);
    dimension = moduleRef.get(AppConfigService).embeddingDimension;

    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await redis.client.quit();
  });

  beforeEach(async () => {
    // Cascades clear history, workflows, messages and artifacts.
    await prisma.conversation.deleteMany();
    await prisma.outboxEvent.deleteMany();
  });

  const vector = (seed: number): number[] =>
    Array.from({ length: dimension }, (_, index) => (index === seed ? 1 : 0));

  describe('conversations', () => {
    it('creates one conversation per user and returns it on subsequent lookups', async () => {
      const first = await conversations.findOrCreateByUser({ userId: '+2348011111111', channel: 'whatsapp' });
      const second = await conversations.findOrCreateByUser({ userId: '+2348011111111', channel: 'sms' });

      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      // Same conversation across channels — that is what makes continuity cross-channel.
      expect(second.conversation.id).toBe(first.conversation.id);
    });

    it('survives two concurrent first messages from the same user', async () => {
      // Two pods receiving the user's first message simultaneously must not create two
      // conversations; the unique index arbitrates and the loser reads the winner's row.
      const [a, b] = await Promise.all([
        conversations.findOrCreateByUser({ userId: '+2348099999999', channel: 'whatsapp' }),
        conversations.findOrCreateByUser({ userId: '+2348099999999', channel: 'whatsapp' }),
      ]);

      expect(a.conversation.id).toBe(b.conversation.id);
      expect(await prisma.conversation.count({ where: { userId: '+2348099999999' } })).toBe(1);
    });

    it('returns recent history oldest-first within the requested window', async () => {
      const { conversation } = await conversations.findOrCreateByUser({
        userId: '+2348012345678',
        channel: 'whatsapp',
      });

      for (let index = 0; index < 5; index += 1) {
        await conversations.appendHistory(conversation.id, {
          id: `00000000-0000-4000-8000-00000000000${index}`,
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `turn ${index}`,
          channel: 'whatsapp',
          timestamp: new Date(Date.now() + index * 1_000),
        });
      }

      const recent = await conversations.loadRecentHistory(conversation.id, 3);

      expect(recent.map((entry) => entry.content)).toEqual(['turn 2', 'turn 3', 'turn 4']);
    });

    it('persists memory facts and reloads them with confidence intact', async () => {
      const { conversation } = await conversations.findOrCreateByUser({
        userId: '+2348055555555',
        channel: 'whatsapp',
      });

      await conversations.updateMemory(conversation.id, {
        summary: 'Vendor in Aba selling electrical materials.',
        facts: {
          'location.city': { value: 'Aba', confidence: 0.95, source: 'user_stated', updatedAt: new Date() },
          'location.state': { value: 'Abia', confidence: 0.7, source: 'ai_inferred', updatedAt: new Date() },
        },
      });

      const reloaded = await conversations.findById(conversation.id);

      expect(reloaded?.memory.summary).toContain('Aba');
      expect(reloaded?.memory.facts['location.city'].value).toBe('Aba');
      expect(reloaded?.memory.facts['location.state'].confidence).toBeCloseTo(0.7);
    });
  });

  describe('workflows', () => {
    const seedConversation = async () =>
      (await conversations.findOrCreateByUser({ userId: '+2348012345678', channel: 'whatsapp' }))
        .conversation;

    it('creates an instance and loads it through the registry', async () => {
      const conversation = await seedConversation();

      const created = await workflows.create({
        id: '11111111-1111-4111-8111-111111111111',
        conversationId: conversation.id,
        workflowType: 'Triage',
        initialState: 'Classify',
        summary: 'looking for a hammer',
        semanticFingerprint: { intent: 'buyer_product_search', entities: ['hammer'], keywords: ['hammer'] },
        importantEntities: { product: 'hammer' },
        data: {},
        priority: 0,
        resumable: true,
        expiresAt: null,
        fingerprintEmbedding: null,
      });

      await workflows.setActiveWorkflow(conversation.id, created.id);
      const registry = await workflows.loadRegistry(conversation.id);

      expect(registry.activeWorkflowId).toBe(created.id);
      expect(registry.workflowInstances).toHaveLength(1);
      expect(registry.workflowInstances[0].semanticFingerprint.entities).toEqual(['hammer']);
    });

    it('writes the state change and its audit record in the same transaction', async () => {
      const conversation = await seedConversation();
      const created = await workflows.create({
        id: '22222222-2222-4222-8222-222222222222',
        conversationId: conversation.id,
        workflowType: 'Triage',
        initialState: 'Classify',
        summary: '',
        semanticFingerprint: { intent: 'unknown', entities: [], keywords: [] },
        importantEntities: {},
        data: {},
        priority: 0,
        resumable: true,
        expiresAt: null,
        fingerprintEmbedding: null,
      });

      await workflows.update(
        created.id,
        { currentState: 'Complete', status: 'completed' },
        {
          workflowId: created.id,
          fromState: 'Classify',
          toState: 'Complete',
          trigger: 'continuation',
          at: new Date(),
        },
      );

      const history = await workflows.transitionHistory(created.id);

      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ fromState: 'Classify', toState: 'Complete' });
    });

    it('finds workflows by a deterministic identifier without matching other keys', async () => {
      const conversation = await seedConversation();

      await workflows.create({
        id: '33333333-3333-4333-8333-333333333333',
        conversationId: conversation.id,
        workflowType: 'Triage',
        initialState: 'Classify',
        summary: '',
        semanticFingerprint: { intent: 'unknown', entities: [], keywords: [] },
        importantEntities: { order_id: 'ORD-991' },
        data: {},
        priority: 0,
        resumable: true,
        expiresAt: null,
        fingerprintEmbedding: null,
      });

      expect(await workflows.findByImportantEntity(conversation.id, 'order_id', 'ORD-991')).toHaveLength(1);
      // Right value, wrong key: must not match.
      expect(await workflows.findByImportantEntity(conversation.id, 'vendor_id', 'ORD-991')).toHaveLength(0);
    });

    it('ranks workflows by pgvector cosine similarity', async () => {
      const conversation = await seedConversation();

      await workflows.create({
        id: '44444444-4444-4444-8444-444444444444',
        conversationId: conversation.id,
        workflowType: 'Triage',
        initialState: 'Classify',
        summary: 'near',
        semanticFingerprint: { intent: 'unknown', entities: [], keywords: [] },
        importantEntities: {},
        data: {},
        priority: 0,
        resumable: true,
        expiresAt: null,
        fingerprintEmbedding: vector(0),
      });

      await workflows.create({
        id: '55555555-5555-4555-8555-555555555555',
        conversationId: conversation.id,
        workflowType: 'Triage',
        initialState: 'Classify',
        summary: 'far',
        semanticFingerprint: { intent: 'unknown', entities: [], keywords: [] },
        importantEntities: {},
        data: {},
        priority: 0,
        resumable: true,
        expiresAt: null,
        fingerprintEmbedding: vector(1),
      });

      const matches = await workflows.findSimilarByEmbedding({
        conversationId: conversation.id,
        embedding: vector(0),
        limit: 5,
        minSimilarity: 0.5,
      });

      // Only the identical vector clears the threshold; the orthogonal one scores 0.
      expect(matches).toHaveLength(1);
      expect(matches[0].workflowId).toBe('44444444-4444-4444-8444-444444444444');
      expect(matches[0].similarity).toBeCloseTo(1, 5);
    });

    it('rejects an embedding whose dimension does not match the schema', async () => {
      const conversation = await seedConversation();

      await expect(
        workflows.create({
          id: '66666666-6666-4666-8666-666666666666',
          conversationId: conversation.id,
          workflowType: 'Triage',
          initialState: 'Classify',
          summary: '',
          semanticFingerprint: { intent: 'unknown', entities: [], keywords: [] },
          importantEntities: {},
          data: {},
          priority: 0,
          resumable: true,
          expiresAt: null,
          // A model swap without a migration must fail loudly, not store a broken vector.
          fingerprintEmbedding: [1, 2, 3],
        }),
      ).rejects.toThrow(/dimensions/);
    });

    it('finds only live workflows that are past their expiry', async () => {
      const conversation = await seedConversation();
      const past = new Date(Date.now() - 60_000);
      const future = new Date(Date.now() + 60_000);

      const base = {
        conversationId: conversation.id,
        workflowType: 'Triage',
        initialState: 'Classify',
        summary: '',
        semanticFingerprint: { intent: 'unknown', entities: [], keywords: [] },
        importantEntities: {},
        data: {},
        priority: 0,
        resumable: true,
        fingerprintEmbedding: null,
      };

      await workflows.create({ ...base, id: '77777777-7777-4777-8777-777777777777', expiresAt: past });
      await workflows.create({ ...base, id: '88888888-8888-4888-8888-888888888888', expiresAt: future });
      const completed = await workflows.create({
        ...base,
        id: '99999999-9999-4999-8999-999999999999',
        expiresAt: past,
      });
      await workflows.update(completed.id, { status: 'completed' });

      const expired = await workflows.findExpired(new Date(), 10);

      // Only the live, past-expiry instance: a completed workflow needs no sweeping.
      expect(expired.map((instance) => instance.id)).toEqual(['77777777-7777-4777-8777-777777777777']);
    });
  });

  describe('distributed locking', () => {
    const key = conversationLockKey('lock-test-conversation');

    afterEach(async () => {
      await redis.client.del(key);
    });

    it('grants the lock to one caller and refuses the other', async () => {
      const first = await locks.acquire(key, 5_000, 0);
      const second = await locks.acquire(key, 5_000, 0);

      expect(first).not.toBeNull();
      // This is the guarantee that makes horizontal scaling safe (MCOS §20).
      expect(second).toBeNull();
    });

    it('allows a waiting caller through once the holder releases', async () => {
      const first = await locks.acquire(key, 5_000, 0);
      expect(first).not.toBeNull();

      const waiting = locks.acquire(key, 5_000, 2_000);
      await locks.release(first!);

      expect(await waiting).not.toBeNull();
    });

    it('does not let a stale holder release a lock someone else now owns', async () => {
      // The fencing token exists for exactly this: a slow worker whose lock expired must not
      // release the lock a different worker has since taken.
      const stale = await locks.acquire(key, 200, 0);
      expect(stale).not.toBeNull();

      await new Promise((resolve) => setTimeout(resolve, 400));

      const fresh = await locks.acquire(key, 5_000, 0);
      expect(fresh).not.toBeNull();

      await locks.release(stale!);

      // The fresh holder still owns it.
      expect(await redis.client.get(key)).toBe(fresh!.token);
    });

    it('extends only a lock the caller still holds', async () => {
      const handle = await locks.acquire(key, 500, 0);
      expect(handle).not.toBeNull();

      expect(await locks.extend(handle!, 5_000)).not.toBeNull();

      await redis.client.del(key);
      expect(await locks.extend(handle!, 5_000)).toBeNull();
    });
  });
});
