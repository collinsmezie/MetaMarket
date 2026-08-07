import { createHmac } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as express from 'express';
import request from 'supertest';
import { PrismaService } from '../../src/adapters/outbound/persistence/prisma.service';
import { AppModule } from '../../src/app.module';
import type { Channel } from '../../src/domain/models/channel';
import type { Response } from '../../src/domain/models/response';
import {
  CHANNEL_NOTIFIER_REGISTRY,
  type ChannelNotifierPort,
  type ChannelNotifierRegistryPort,
  type DeliveryResult,
  type DeliveryTarget,
} from '../../src/domain/ports/outbound/channel-notifier.port';
import {
  EMBEDDING_PROVIDER,
  type EmbeddingProviderPort,
} from '../../src/domain/ports/outbound/embedding-provider.port';
import {
  LLM_PROVIDER_SERVICE,
  type LlmService,
  type StructuredRequest,
  type StructuredResult,
} from '../../src/domain/ports/outbound/llm-provider.port';
import {
  MEDIA_PROCESSING_QUEUE,
  type MediaProcessingJob,
  type MediaProcessingQueuePort,
} from '../../src/domain/ports/outbound/media.port';

/**
 * End-to-end Conversation OS test: a real Meta webhook payload in, a composed response out,
 * with state persisted in Postgres and the turn serialised by the Redis lock
 * (Execution.md §4.2).
 *
 * Faked at the edges only — the LLM, the outbound channel and the media queue. Everything
 * between the HTTP request and the database is the production code path.
 */

const APP_SECRET = 'test-app-secret';

/** Captures outbound replies instead of messaging a real phone number. */
class CapturingNotifier implements ChannelNotifierPort {
  readonly sent: { target: DeliveryTarget; response: Response }[] = [];
  readonly channel: Channel = 'whatsapp';

  async send(target: DeliveryTarget, response: Response): Promise<DeliveryResult> {
    this.sent.push({ target, response });
    return { delivered: true, providerMessageId: `wamid.out.${this.sent.length}`, messageCount: 1 };
  }

  lastText(): string {
    return this.sent[this.sent.length - 1]?.response.text ?? '';
  }
}

class CapturingRegistry implements ChannelNotifierRegistryPort {
  constructor(readonly notifier: CapturingNotifier) {}

  forChannel(): ChannelNotifierPort {
    return this.notifier;
  }

  supports(): boolean {
    return true;
  }

  registeredChannels(): readonly Channel[] {
    return ['whatsapp'];
  }
}

/**
 * Scripted LLM.
 *
 * Returns a fixed answer per operation so assertions are about the platform's routing and
 * state machine, not a model's judgement on a given day.
 */
class ScriptedLlm implements LlmService {
  intent = 'buyer_product_search';
  relationship = 'new';
  readonly operations: string[] = [];
  failOperations = new Set<string>();

  async complete<T>(req: StructuredRequest, validate: (value: unknown) => T): Promise<StructuredResult<T>> {
    this.operations.push(req.operation);

    if (this.failOperations.has(req.operation)) {
      throw new Error(`Scripted failure for ${req.operation}`);
    }

    const payload = this.payloadFor(req.operation);

    return {
      data: validate(payload),
      provider: 'openai',
      model: 'scripted',
      latencyMs: 1,
      failedProviders: [],
    };
  }

  private payloadFor(operation: string): unknown {
    switch (operation) {
      case 'continuity_analysis':
        return {
          relationship: this.relationship,
          confidence: 0.9,
          candidateWorkflowIds: [],
          reasoning: 'scripted',
        };
      case 'intent_resolution':
        return {
          intent: this.intent,
          confidence: 0.95,
          entities: [{ name: 'product', value: 'artist brush' }],
          language: 'en',
          command: '',
        };
      case 'semantic_resolution':
        return {
          products: [{ raw: 'artist brush', normalized: 'Artist Brush', aliases: ['paint brush'] }],
          services: [],
          categoryName: 'Artist Painting Brushes',
          ambiguity: false,
          ambiguityScore: 0.1,
          modifiers: [],
          constraints: [],
          brands: [],
        };
      case 'demand_understanding':
        return {
          mode: 'item',
          products: ['artist brush'],
          services: [],
          businessTypes: [],
          quantities: [],
          modifiers: [],
          constraints: [],
          brands: [],
          location: '',
          ambiguityType: 'none',
          ambiguityScore: 0.1,
          ambiguityOptions: [],
          inferredItem: '',
          inferredItemConfidence: 0,
          reasoning: 'scripted',
        };

      case 'semantic_expansion':
        return {
          missions: ['painting'],
          capabilities: [{ name: 'Art Materials', confidence: 0.9 }],
          inventoryAffinities: [{ name: 'Bookstores', confidence: 0.4 }],
          inferredProducts: [],
          reasoning: 'scripted',
        };

      case 'capability_ranking':
        // No taxonomy is seeded in this suite, so there is nothing to rank.
        return { selections: [] };

      default:
        throw new Error(`Unscripted LLM operation "${operation}"`);
    }
  }
}

class StubEmbeddings implements EmbeddingProviderPort {
  readonly model = 'stub';
  readonly dimension = 1536;

  async embed(): Promise<readonly number[]> {
    return Array.from({ length: this.dimension }, () => 0.01);
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map(() => this.embed()));
  }
}

class CapturingMediaQueue implements MediaProcessingQueuePort {
  readonly jobs: MediaProcessingJob[] = [];

  async enqueue(job: MediaProcessingJob): Promise<void> {
    this.jobs.push(job);
  }
}

function textWebhook(from: string, body: string, id: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
              contacts: [{ wa_id: from, profile: { name: 'Emeka' } }],
              messages: [{ from, id, timestamp: '1785412800', type: 'text', text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

function voiceWebhook(from: string, mediaId: string, id: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              messages: [
                {
                  from,
                  id,
                  timestamp: '1785412800',
                  type: 'audio',
                  audio: { id: mediaId, mime_type: 'audio/ogg; codecs=opus', voice: true },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('WhatsApp pipeline integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let notifier: CapturingNotifier;
  let llm: ScriptedLlm;
  let mediaQueue: CapturingMediaQueue;

  const post = (body: unknown) => {
    const raw = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;

    // Sent as a string rather than a Buffer: superagent overrides Content-Type to binary for
    // Buffer bodies, which would stop express.json from parsing and capturing rawBody.
    return request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(raw.toString('utf8'));
  };

  /** The controller dispatches processing detached from the response; wait for it to land. */
  const waitForReply = async (expected: number) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (notifier.sent.length >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Expected ${expected} outbound message(s), saw ${notifier.sent.length}`);
  };

  /**
   * Polls the outbox until `eventType` has been recorded *and* marked published, then returns
   * every recorded event.
   *
   * Waiting only for the row to appear is not enough: the publisher writes the row first and
   * marks it delivered immediately after, so a poll on existence alone can read the row
   * mid-write and see a null `publishedAt`.
   */
  const waitForEvent = async (eventType: string) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const events = await prisma.outboxEvent.findMany({ orderBy: { occurredAt: 'asc' } });

      const settled =
        events.some((event) => event.eventType === eventType) &&
        events.every((event) => event.publishedAt !== null);

      if (settled) return events;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`Outbox never settled with a published "${eventType}" event`);
  };

  beforeAll(async () => {
    notifier = new CapturingNotifier();
    llm = new ScriptedLlm();
    mediaQueue = new CapturingMediaQueue();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER_SERVICE)
      .useValue(llm)
      .overrideProvider(CHANNEL_NOTIFIER_REGISTRY)
      .useValue(new CapturingRegistry(notifier))
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(new StubEmbeddings())
      .overrideProvider(MEDIA_PROCESSING_QUEUE)
      .useValue(mediaQueue)
      .compile();

    // Mirrors main.ts exactly, including `bodyParser: false` — without it Nest's parser
    // consumes the stream first and `rawBody` is never captured, so signature checks fail.
    app = moduleRef.createNestApplication({ bodyParser: false });

    app.use(
      express.json({
        verify: (req: express.Request & { rawBody?: Buffer }, _res, buffer: Buffer) => {
          req.rawBody = Buffer.from(buffer);
        },
      }),
    );

    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Closing the app runs OnModuleDestroy, which already quits the Redis client.
    await app.close();
  });

  beforeEach(async () => {
    await prisma.conversation.deleteMany();
    await prisma.outboxEvent.deleteMany();
    notifier.sent.length = 0;
    llm.operations.length = 0;
    llm.intent = 'buyer_product_search';
    llm.relationship = 'new';
    llm.failOperations.clear();
    mediaQueue.jobs.length = 0;
  });

  it('rejects a webhook with an invalid signature', async () => {
    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', 'sha256=deadbeef')
      .send(Buffer.from(JSON.stringify(textWebhook('2348012345678', 'hello', 'wamid.bad'))))
      .expect(403);

    expect(notifier.sent).toHaveLength(0);
  });

  it('answers the Meta verification handshake with the challenge', async () => {
    await request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '31415' })
      .expect(200)
      .expect('31415');
  });

  it('rejects the verification handshake when the token is wrong', async () => {
    await request(app.getHttpServer())
      .get('/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '31415' })
      .expect(403);
  });

  it('drives a text message through the full pipeline and replies', async () => {
    await post(textWebhook('2348012345678', 'I need artist brush', 'wamid.text.1')).expect(200);
    await waitForReply(1);

    // Case B ordering (MCOS §14). Continuity is absent because a conversation with no open
    // workflows can only be `new` — the analyzer answers that deterministically rather than
    // spending an LLM call on it. Buyer intent then reaches the CME, which BuyerSearch owns.
    expect(llm.operations.slice(0, 2)).toEqual(['intent_resolution', 'semantic_resolution']);
    expect(llm.operations).toContain('demand_understanding');

    // This suite covers the Conversation OS pipeline, not marketplace content: no taxonomy or
    // vendors are seeded here, so the correct outcome is an honest "nothing found" reply rather
    // than a vendor list. Marketplace behaviour is covered by the CME and loop suites.
    expect(notifier.lastText().length).toBeGreaterThan(0);
    expect(notifier.lastText()).toMatch(/No vendor|could not work out/i);

    const conversation = await prisma.conversation.findUnique({ where: { userId: '+2348012345678' } });
    expect(conversation).not.toBeNull();

    const workflows = await prisma.workflowInstance.findMany({
      where: { conversationId: conversation!.id },
    });
    expect(workflows).toHaveLength(1);
    // Buyer intent routes to BuyerSearch, which outranks Triage by policy priority.
    expect(workflows[0].workflowType).toBe('BuyerSearch');
    expect(workflows[0].status).toBe('completed');

    const history = await prisma.historyEntry.findMany({ where: { conversationId: conversation!.id } });
    expect(history.map((entry) => entry.role)).toEqual(['user', 'assistant']);
  });

  it('records the turn as domain events in the outbox', async () => {
    await post(textWebhook('2348012345678', 'I need artist brush', 'wamid.text.2')).expect(200);
    await waitForReply(1);

    // `message.sent` is published just after the notifier returns, so the reply landing is
    // not proof the event has been written yet. Wait for the terminal event rather than
    // racing it.
    const events = await waitForEvent('conversation.message.sent');
    const types = events.map((event) => event.eventType);

    expect(types).toContain('conversation.message.received');
    expect(types).toContain('workflow.started');
    expect(types).toContain('conversation.message.sent');
    // The outbox exists so evidence survives a crash; every event must be marked delivered.
    expect(events.every((event) => event.publishedAt !== null)).toBe(true);
  });

  it('ignores a duplicated webhook delivery instead of running the turn twice', async () => {
    const payload = textWebhook('2348012345678', 'I need artist brush', 'wamid.duplicate');

    await post(payload).expect(200);
    await waitForReply(1);
    await post(payload).expect(200);

    // Give the second delivery time to do the wrong thing, if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(notifier.sent).toHaveLength(1);
    const workflows = await prisma.workflowInstance.findMany();
    expect(workflows).toHaveLength(1);
  });

  it('queues media work instead of blocking the webhook on transcription', async () => {
    await post(voiceWebhook('2348012345678', 'media_456', 'wamid.voice.1')).expect(200);

    for (let attempt = 0; attempt < 60 && mediaQueue.jobs.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(mediaQueue.jobs).toHaveLength(1);
    expect(mediaQueue.jobs[0].part.mediaId).toBe('media_456');
    expect(mediaQueue.jobs[0].totalMediaParts).toBe(1);
    // Nothing is sent yet: the reply waits for the transcript.
    expect(notifier.sent).toHaveLength(0);
  });

  it('resumes an existing workflow rather than starting a second one', async () => {
    llm.intent = 'unknown';
    await post(textWebhook('2348012345678', 'hello there', 'wamid.turn.1')).expect(200);
    await waitForReply(1);

    // Triage asked which side the user is on; the reply continues that workflow.
    llm.relationship = 'answer';
    await post(textWebhook('2348012345678', 'I want to buy', 'wamid.turn.2')).expect(200);
    await waitForReply(2);

    const workflows = await prisma.workflowInstance.findMany();
    expect(workflows).toHaveLength(1);
    expect(workflows[0].status).toBe('completed');
    // Triage still handles the unknown-intent path and hands the buyer onward.
    expect(notifier.lastText().length).toBeGreaterThan(0);
  });

  it('returns the fallback envelope when a message carries no readable content', async () => {
    // A bare location share: real, and the platform genuinely has no text to reason about.
    const locationOnly = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '2348012345678',
                    id: 'wamid.loc.only',
                    timestamp: '1785412800',
                    type: 'location',
                    location: { latitude: 5.1167, longitude: 7.3667 },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    await post(locationOnly).expect(200);
    await waitForReply(1);

    const response = notifier.sent[0].response;
    // Execution.md §2.5: no silent failure, no generic greeting loop — a guiding message.
    expect(response.metadata?.fallback).toBe(true);
    expect(response.text).toContain('I need a hammer');
  });

  it('still answers when intent resolution fails across every provider', async () => {
    llm.failOperations.add('intent_resolution');

    await post(textWebhook('2348012345678', 'zzzz', 'wamid.fail.1')).expect(200);
    await waitForReply(1);

    // Intent degrades to `unknown`, which Triage claims, so the user gets a real question
    // rather than silence or a fallback envelope.
    expect(notifier.lastText()).toContain('buy');
    const workflows = await prisma.workflowInstance.findMany();
    expect(workflows[0].currentState).toBe('AwaitDetail');
  });

  it('keeps one conversation per user across channels', async () => {
    await post(textWebhook('2348012345678', 'I need artist brush', 'wamid.a')).expect(200);
    await waitForReply(1);

    llm.relationship = 'new';
    llm.intent = 'vendor_onboarding';
    await post(textWebhook('2348012345678', 'I sell electrical materials', 'wamid.b')).expect(200);
    await waitForReply(2);

    expect(await prisma.conversation.count()).toBe(1);
  });

  it('processes a batch of messages from different users independently', async () => {
    const batch = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    from: '2348011111111',
                    id: 'wamid.b1',
                    timestamp: '1785412800',
                    type: 'text',
                    text: { body: 'I need artist brush' },
                  },
                  {
                    from: '2348022222222',
                    id: 'wamid.b2',
                    timestamp: '1785412801',
                    type: 'text',
                    text: { body: 'I need artist brush' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    await post(batch).expect(200);
    await waitForReply(2);

    expect(await prisma.conversation.count()).toBe(2);
  });
});
