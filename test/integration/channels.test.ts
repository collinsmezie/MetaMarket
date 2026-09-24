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
import { EMBEDDING_PROVIDER } from '../../src/domain/ports/outbound/embedding-provider.port';
import { LLM_PROVIDER_SERVICE } from '../../src/domain/ports/outbound/llm-provider.port';
import {
  MEDIA_PROCESSING_QUEUE,
  type MediaProcessingJob,
  type MediaProcessingQueuePort,
} from '../../src/domain/ports/outbound/media.port';
import { UnavailableSearchProvider } from '../../src/retrieval/adapters/search/tavily-search-provider.adapter';
import { SEARCH_PROVIDER } from '../../src/retrieval/ports/search-provider.port';
import type { ChaosTurn } from '../harness/chaos-transcript';
import { OracleLlm, StubEmbeddings } from '../harness/conversation-harness';

/**
 * Channel integration: both channel adapters against the rebuilt runtime (MCOS v4.4 §4, §5A,
 * §18.2, §24; ADR-001).
 *
 * A real Meta webhook payload or a real web client request goes in; the message is persisted
 * and deduplicated, assembled into a logical turn, executed by the LangGraph orchestrator and
 * answered through durable delivery on the channel it came from. Only the edges are faked: the
 * model (scripted oracle), the outbound notifier (captured per channel), embeddings, the media
 * queue and web search. Everything between HTTP and the database is the production path.
 */

const APP_SECRET = 'test-app-secret';

/** Captures outbound replies for every channel instead of messaging a phone or a browser. */
class CapturingNotifier implements ChannelNotifierPort {
  readonly sent: { target: DeliveryTarget; response: Response }[] = [];
  readonly typing: DeliveryTarget[] = [];
  constructor(readonly channel: Channel) {}

  async send(target: DeliveryTarget, response: Response): Promise<DeliveryResult> {
    this.sent.push({ target, response });
    return { delivered: true, providerMessageId: `out.${this.sent.length}`, messageCount: 1 };
  }

  async indicateTyping(target: DeliveryTarget): Promise<void> {
    this.typing.push(target);
  }

  texts(): string[] {
    return this.sent.map((entry) => entry.response.text ?? '');
  }
}

class CapturingRegistry implements ChannelNotifierRegistryPort {
  constructor(private readonly notifiers: Readonly<Record<string, CapturingNotifier>>) {}
  forChannel(channel: Channel): ChannelNotifierPort {
    const notifier = this.notifiers[channel];
    if (notifier === undefined) throw new Error(`No capturing notifier for ${channel}`);
    return notifier;
  }
  supports(channel: Channel): boolean {
    return channel in this.notifiers;
  }
  registeredChannels(): readonly Channel[] {
    return Object.keys(this.notifiers) as Channel[];
  }
}

class CapturingMediaQueue implements MediaProcessingQueuePort {
  readonly jobs: MediaProcessingJob[] = [];
  async enqueue(job: MediaProcessingJob): Promise<void> {
    this.jobs.push(job);
  }
}

const META_VALUE = {
  messaging_product: 'whatsapp',
  metadata: { display_phone_number: '15550783881', phone_number_id: '106540352242922' },
};

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
              ...META_VALUE,
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
              ...META_VALUE,
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

/** The oracle's view of a buyer looking for a plumber: one FIND_VENDOR intent, one SERVICE object. */
const PLUMBER_TURN: ChaosTurn = {
  label: 'plumber',
  text: 'I need a plumber in Warri',
  segments: [
    {
      text: 'I need a plumber in Warri',
      intentType: 'FIND_VENDOR',
      continuity: 'NEW_WORKFLOW',
      objects: [{ surface: 'plumber', canonical: 'plumber', entityType: 'SERVICE' }],
      objective: 'BuyerSearch',
    },
  ],
  primaryContinuity: 'NEW_WORKFLOW',
  replyMustContain: ['plumber'],
};

describe('Channel adapters against the rebuilt runtime', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let llm: OracleLlm;
  let mediaQueue: CapturingMediaQueue;
  const whatsapp = new CapturingNotifier('whatsapp');
  const web = new CapturingNotifier('web');

  const postWebhook = (body: unknown, signature: string | null = 'valid') => {
    const raw = Buffer.from(JSON.stringify(body));
    const header =
      signature === 'valid'
        ? `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`
        : signature;
    let req = request(app.getHttpServer()).post('/webhooks/whatsapp').set('Content-Type', 'application/json');
    if (header !== null) req = req.set('x-hub-signature-256', header);
    // A string body keeps express.json parsing (and capturing rawBody); a Buffer would be sent as binary.
    return req.send(raw.toString('utf8'));
  };

  const postWeb = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/channels/web/messages').send(body);

  const waitForReplies = async (notifier: CapturingNotifier, expected: number) => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (notifier.sent.length >= expected) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (notifier.sent.length < expected)
      throw new Error(`Expected ${expected} ${notifier.channel} reply(ies), saw ${notifier.sent.length}`);
    await waitForTurnsSettled();
  };

  const waitForTurnsSettled = async () => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const open = await prisma.logicalTurn.count({
        where: { status: { in: ['OPEN', 'SEALED', 'ENQUEUED', 'PROCESSING'] } },
      });
      if (open === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Logical turns did not settle');
  };

  beforeAll(async () => {
    llm = new OracleLlm();
    mediaQueue = new CapturingMediaQueue();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SEARCH_PROVIDER)
      .useValue(new UnavailableSearchProvider())
      .overrideProvider(LLM_PROVIDER_SERVICE)
      .useValue(llm)
      .overrideProvider(CHANNEL_NOTIFIER_REGISTRY)
      .useValue(new CapturingRegistry({ whatsapp, web }))
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(new StubEmbeddings())
      .overrideProvider(MEDIA_PROCESSING_QUEUE)
      .useValue(mediaQueue)
      .compile();

    // Mirrors main.ts: `bodyParser: false` plus raw-body capture, or signature checks fail.
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
    await waitForTurnsSettled().catch(() => undefined);
    await app.close();
  });

  beforeEach(async () => {
    await prisma.turnQueueEntry.deleteMany();
    await prisma.pendingClarification.deleteMany();
    await prisma.logicalTurn.deleteMany();
    await prisma.orchestrationRun.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.outboxEvent.deleteMany();
    whatsapp.sent.length = 0;
    whatsapp.typing.length = 0;
    web.sent.length = 0;
    llm.operations.length = 0;
    llm.turn = PLUMBER_TURN;
    mediaQueue.jobs.length = 0;
  });

  describe('WhatsApp adapter', () => {
    it('rejects an unsigned or mis-signed webhook and never processes it', async () => {
      await postWebhook(textWebhook('2348011110000', 'hello', 'wamid.sig.1'), null).expect(403);
      await postWebhook(textWebhook('2348011110000', 'hello', 'wamid.sig.2'), 'sha256=deadbeef').expect(403);
      expect(await prisma.conversation.count()).toBe(0);
    });

    it('answers the Meta verification handshake only with the configured token', async () => {
      const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
      await request(app.getHttpServer())
        .get('/webhooks/whatsapp')
        .query({ 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': 'challenge-42' })
        .expect(200)
        .expect('challenge-42');
      await request(app.getHttpServer())
        .get('/webhooks/whatsapp')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': `${verifyToken}-wrong`,
          'hub.challenge': 'challenge-42',
        })
        .expect(403);
    });

    it('drives a text message through ingestion, turn assembly and the orchestrator, and replies on WhatsApp', async () => {
      await postWebhook(textWebhook('2348012345678', PLUMBER_TURN.text, 'wamid.text.1'))
        .expect(200)
        .expect({ received: true });
      await waitForReplies(whatsapp, 1);

      const reply = whatsapp.sent[0]!;
      expect(reply.target.channel).toBe('whatsapp');
      // Addresses are normalised to E.164 at ingestion; the notifier receives the canonical form.
      expect(reply.target.address).toBe('+2348012345678');
      expect(reply.response.text?.toLowerCase()).toContain('plumber');

      // The mechanism (MCOS §13, §65.3): exactly one IDCE and one CSRE call per logical turn,
      // no legacy utterance segmentation.
      expect(llm.operations.filter((op) => op.startsWith('idce.master.discover@'))).toHaveLength(1);
      expect(llm.operations.filter((op) => op.startsWith('csre.runtime.resolve@'))).toHaveLength(1);
      expect(llm.operations).not.toContain('utterance_segmentation');

      const turns = await prisma.logicalTurn.findMany();
      expect(turns).toHaveLength(1);
      expect(turns[0]!.status).toBe('COMMITTED');
      const conversation = await prisma.conversation.findFirstOrThrow();
      expect(conversation.lastChannel).toBe('whatsapp');
    });

    it('records the turn as correlated platform events in the outbox', async () => {
      await postWebhook(textWebhook('2348012345678', PLUMBER_TURN.text, 'wamid.events.1')).expect(200);
      await waitForReplies(whatsapp, 1);
      const events = await prisma.outboxEvent.findMany({ orderBy: { occurredAt: 'asc' } });
      const types = events.map((event) => event.eventType);
      for (const expected of [
        'MessageReceived',
        'LogicalTurnCreated',
        'LogicalTurnSealed',
        'IntentResolved',
        'SemanticObjectResolved',
        'LogicalTurnCommitted',
      ]) {
        expect(types).toContain(expected);
      }
      // Learning events (Evidence, outbox consumer) are asynchronous and may still be draining for
      // earlier conversations; the turn's own events must all be correlated to this conversation.
      const conversation = await prisma.conversation.findFirstOrThrow();
      const turnEvents = events.filter((event) =>
        [
          'MessageReceived',
          'LogicalTurnCreated',
          'LogicalTurnSealed',
          'IntentResolved',
          'SemanticObjectResolved',
          'LogicalTurnCommitted',
        ].includes(event.eventType),
      );
      expect(turnEvents.length).toBeGreaterThanOrEqual(6);
      expect(turnEvents.every((event) => event.conversationId === conversation.id)).toBe(true);
      expect(turnEvents.every((event) => event.correlationId !== null)).toBe(true);
    });

    it('treats a redelivered webhook as a recorded no-op: one turn, one reply', async () => {
      const payload = textWebhook('2348012345678', PLUMBER_TURN.text, 'wamid.dup.1');
      await postWebhook(payload).expect(200);
      await postWebhook(payload).expect(200);
      await waitForReplies(whatsapp, 1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(whatsapp.sent).toHaveLength(1);
      expect(await prisma.logicalTurn.count()).toBe(1);
      expect(llm.operations.filter((op) => op.startsWith('idce.master.discover@'))).toHaveLength(1);
    });

    it('queues media work instead of blocking the webhook on transcription', async () => {
      await postWebhook(voiceWebhook('2348012345678', 'media-123', 'wamid.voice.1')).expect(200);
      for (let attempt = 0; attempt < 100 && mediaQueue.jobs.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(mediaQueue.jobs).toHaveLength(1);
      expect(mediaQueue.jobs[0]!.part.type).toBe('audio');
      // No transcript yet ⇒ nothing was assembled, nothing was asked of the model.
      expect(await prisma.logicalTurn.count()).toBe(0);
      expect(llm.operations).toHaveLength(0);
    });
  });

  describe('Web adapter', () => {
    it('accepts a web message (202), runs the same turn pipeline and replies on the web channel', async () => {
      const accepted = await postWeb({
        sessionId: 'sess-web-1',
        text: PLUMBER_TURN.text,
        clientMessageId: 'c1',
      }).expect(202);
      expect(accepted.body).toMatchObject({ accepted: true });
      await waitForReplies(web, 1);

      const reply = web.sent[0]!;
      expect(reply.target.channel).toBe('web');
      expect(reply.target.conversationId).toBe(accepted.body.conversationId);
      expect(llm.operations).toEqual(
        expect.arrayContaining([expect.stringMatching(/^csre\.runtime\.resolve@/)]),
      );
      expect({ text: reply.response.text?.toLowerCase(), operations: llm.operations }).toMatchObject({
        text: expect.stringContaining('plumber'),
      });
      expect(whatsapp.sent).toHaveLength(0);
      expect(llm.operations.filter((op) => op.startsWith('idce.master.discover@'))).toHaveLength(1);

      const history = await request(app.getHttpServer())
        .get('/channels/web/history')
        .query({ sessionId: 'sess-web-1' })
        .expect(200);
      expect(history.body.conversationId).toBe(accepted.body.conversationId);
      expect(history.body.history.map((entry: { role: string }) => entry.role)).toEqual([
        'user',
        'assistant',
      ]);
    });

    it('deduplicates on clientMessageId so a retried submit cannot run the turn twice', async () => {
      const body = { sessionId: 'sess-web-2', text: PLUMBER_TURN.text, clientMessageId: 'retry-1' };
      await postWeb(body).expect(202);
      await postWeb(body).expect(202);
      await waitForReplies(web, 1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(web.sent).toHaveLength(1);
      expect(await prisma.logicalTurn.count()).toBe(1);
    });

    it('rejects a message with neither text nor an action payload', async () => {
      await postWeb({ sessionId: 'sess-web-3', clientMessageId: 'x' }).expect(400);
      await postWeb({ text: 'no session' }).expect(400);
    });

    it('keeps one conversation per user across channels when the web client supplies the phone', async () => {
      await postWebhook(textWebhook('2348099990000', PLUMBER_TURN.text, 'wamid.cross.1')).expect(200);
      await waitForReplies(whatsapp, 1);
      llm.turn = {
        ...PLUMBER_TURN,
        text: 'any update on the plumber?',
        segments: [
          { ...PLUMBER_TURN.segments[0]!, text: 'any update on the plumber?', continuity: 'CONTINUATION' },
        ],
        primaryContinuity: 'CONTINUATION',
      };
      const accepted = await postWeb({
        sessionId: 'sess-cross',
        phone: '+234 809 999 0000',
        text: 'any update on the plumber?',
        clientMessageId: 'c1',
      }).expect(202);
      await waitForReplies(web, 1);
      expect(await prisma.conversation.count()).toBe(1);
      const conversation = await prisma.conversation.findFirstOrThrow();
      expect(accepted.body.conversationId).toBe(conversation.id);
      expect(conversation.lastChannel).toBe('web');
    });
  });
});
