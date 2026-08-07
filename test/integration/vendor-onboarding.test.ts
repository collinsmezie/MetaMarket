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
  TAXONOMY_REPOSITORY,
  type TaxonomyRepositoryPort,
} from '../../src/domain/ports/outbound/taxonomy-repository.port';

/**
 * A complete vendor onboarding conversation, end to end, against real Postgres.
 *
 * The LLM is scripted so the assertions are about the platform's behaviour — which questions
 * it asks, what it never re-asks, and what ends up in the Capability DNA — rather than about a
 * model's judgement on a given day. Everything from the webhook to the database is production
 * code.
 */

const APP_SECRET = 'test-app-secret';
const VENDOR_PHONE = '2348033333333';

class CapturingNotifier implements ChannelNotifierPort {
  readonly sent: Response[] = [];
  readonly channel: Channel = 'whatsapp';

  async send(_target: DeliveryTarget, response: Response): Promise<DeliveryResult> {
    this.sent.push(response);
    return { delivered: true, providerMessageId: `wamid.out.${this.sent.length}`, messageCount: 1 };
  }

  lastText(): string {
    return this.sent[this.sent.length - 1]?.text ?? '';
  }
}

class CapturingRegistry implements ChannelNotifierRegistryPort {
  constructor(private readonly notifier: CapturingNotifier) {}
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

/** Deterministic embeddings: identical text always yields an identical vector. */
class HashEmbeddings implements EmbeddingProviderPort {
  readonly model = 'test-hash';
  readonly dimension = 1536;

  async embed(text: string): Promise<readonly number[]> {
    const vector = new Array<number>(this.dimension).fill(0);
    for (let i = 0; i < text.length; i += 1) {
      vector[text.charCodeAt(i) % this.dimension] += 1;
    }
    const norm = Math.sqrt(vector.reduce((total, value) => total + value * value, 0)) || 1;
    return vector.map((value) => value / norm);
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  }
}

/** What the scripted model should return for each onboarding turn. */
interface Turn {
  capabilityStatement?: string;
  businessName?: string;
  city?: string;
  state?: string;
  stateInferredFromCity?: boolean;
  confirmation?: 'yes' | 'no';
}

class ScriptedLlm implements LlmService {
  turns: Turn[] = [];
  ambiguityScore = 0.1;
  clarificationQuestion = '';
  informationDensity: 'very_low' | 'low' | 'medium' | 'high' | 'very_high' = 'medium';
  readonly operations: string[] = [];

  async complete<T>(req: StructuredRequest, validate: (value: unknown) => T): Promise<StructuredResult<T>> {
    this.operations.push(req.operation);

    return {
      data: validate(this.payloadFor(req)),
      provider: 'openai',
      model: 'scripted',
      latencyMs: 1,
      failedProviders: [],
    };
  }

  private payloadFor(req: StructuredRequest): unknown {
    switch (req.operation) {
      case 'continuity_analysis':
        return { relationship: 'answer', confidence: 0.9, candidateWorkflowIds: [], reasoning: 'scripted' };

      case 'intent_resolution':
        return {
          intent: 'vendor_onboarding',
          confidence: 0.95,
          entities: [],
          language: 'en',
          command: '',
        };

      case 'onboarding_extraction': {
        const turn = this.turns.shift() ?? {};
        return {
          capabilityStatement: turn.capabilityStatement ?? '',
          businessName: turn.businessName ?? '',
          businessNameConfidence: turn.businessName !== undefined ? 0.95 : 0,
          city: turn.city ?? '',
          cityConfidence: turn.city !== undefined ? 0.95 : 0,
          state: turn.state ?? '',
          stateConfidence: turn.state !== undefined ? 0.9 : 0,
          stateInferredFromCity: turn.stateInferredFromCity ?? false,
          isConfirmation: turn.confirmation !== undefined,
          confirmationValue: turn.confirmation ?? 'none',
          reasoning: 'scripted',
        };
      }

      case 'business_understanding':
        return {
          expressionType: 'broad_capability_statement',
          informationDensity: this.informationDensity,
          businessArchetype: 'electrical materials shop',
          archetypeConfidence: 0.8,
          products: [
            { term: 'electrical wires', stated: true, confidence: 0.9 },
            { term: 'switches', stated: false, confidence: 0.5 },
          ],
          services: [],
          brands: [],
          ambiguityScore: this.ambiguityScore,
          clarificationQuestion: this.clarificationQuestion,
          reasoning: 'scripted',
        };

      case 'capability_ranking': {
        // Pick the first candidate offered, mimicking a well-behaved ranker.
        const firstCode = /^(\d+) \|/m.exec(req.messages.map((message) => message.content).join('\n'))?.[1];

        return {
          selections:
            firstCode === undefined ? [] : [{ code: firstCode, confidence: 0.85, reasoning: 'scripted' }],
        };
      }

      case 'service_capability_reasoning':
        return { primary: { canonicalName: 'Unused', description: '', confidence: 0.1 }, related: [] };

      default:
        throw new Error(`Unscripted operation "${req.operation}"`);
    }
  }
}

function textWebhook(body: string, id: string) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              contacts: [{ wa_id: VENDOR_PHONE, profile: { name: 'Emeka' } }],
              messages: [{ from: VENDOR_PHONE, id, timestamp: '1785412800', type: 'text', text: { body } }],
            },
          },
        ],
      },
    ],
  };
}

describe('Vendor onboarding integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let notifier: CapturingNotifier;
  let llm: ScriptedLlm;
  let taxonomy: TaxonomyRepositoryPort;

  let messageCounter = 0;

  const send = async (body: string) => {
    messageCounter += 1;
    const payload = textWebhook(body, `wamid.onboard.${messageCounter}`);
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;

    // The index of the turn's own reply. Onboarding now also triggers a system-initiated
    // welcome push once the grant lands (TDR §25.12), so "the last message sent" is no longer
    // the same thing as "the answer to this message".
    const before = notifier.sent.length;

    await request(app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(raw.toString('utf8'))
      .expect(200);

    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (notifier.sent.length > before) return notifier.sent[before].text ?? '';
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(`No reply to "${body}"`);
  };

  beforeAll(async () => {
    notifier = new CapturingNotifier();
    llm = new ScriptedLlm();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER_SERVICE)
      .useValue(llm)
      .overrideProvider(CHANNEL_NOTIFIER_REGISTRY)
      .useValue(new CapturingRegistry(notifier))
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(new HashEmbeddings())
      .compile();

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
    taxonomy = app.get<TaxonomyRepositoryPort>(TAXONOMY_REPOSITORY);

    // A minimal taxonomy so the Capability Resolver has real candidates to rank.
    await prisma.taxonomyNode.deleteMany();
    await taxonomy.upsertNodes([
      {
        code: '10005541',
        level: 4,
        title: 'Electrical Wires',
        definition: 'Wires and cables for electrical installation.',
        definitionExcludes: null,
        active: true,
        parentCode: null,
        segmentCode: '78000000',
        familyCode: null,
        classCode: null,
        brickCode: '10005541',
        embeddedText: 'Electrical Wires',
      },
    ]);
    await taxonomy.writeEmbeddings([
      { code: '10005541', embedding: await new HashEmbeddings().embed('Electrical Wires') },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.vendor.deleteMany();
    await prisma.conversation.deleteMany();
    await prisma.outboxEvent.deleteMany();
    await prisma.creditTransaction.deleteMany();
    await prisma.creditWallet.deleteMany();
    notifier.sent.length = 0;
    llm.operations.length = 0;
    llm.turns = [];
    llm.ambiguityScore = 0.1;
    llm.clarificationQuestion = '';
    llm.informationDensity = 'medium';
  });

  it('onboards a vendor who answers one question at a time', async () => {
    llm.turns = [
      // The opening message says nothing extractable, so the platform asks its first question.
      {},
      { capabilityStatement: 'I sell electrical materials' },
      { city: 'Aba', state: 'Abia', stateInferredFromCity: true },
      { confirmation: 'yes' },
      { businessName: 'Divine Electricals' },
    ];

    expect(await send('I want to register my business')).toContain('What do you sell');
    expect(await send('I sell electrical materials')).toContain('city');
    expect(await send('Aba')).toBe("That's Aba in Abia State, right?");
    expect(await send('yes')).toContain('business name');

    const done = await send('Divine Electricals');
    expect(done).toContain('Divine Electricals');
    expect(done).toContain('Abia');

    const vendor = await prisma.vendor.findUnique({ where: { userId: `+${VENDOR_PHONE}` } });
    expect(vendor).not.toBeNull();
    expect(vendor?.businessName).toBe('Divine Electricals');
    expect(vendor?.city).toBe('Aba');
    expect(vendor?.state).toBe('Abia');
    // Searchable the moment the profile exists (Vendor-Onboarding.md Step 5).
    expect(vendor?.status).toBe('active');
    expect(vendor?.onboardedAt).not.toBeNull();
  });

  it('never re-asks for something the vendor volunteered up front', async () => {
    // "I sell plumbing materials. My shop is called Emeka Plumbing and I'm in Aba."
    llm.turns = [
      {
        capabilityStatement: 'I sell plumbing materials',
        businessName: 'Emeka Plumbing',
        city: 'Aba',
        state: 'Abia',
        stateInferredFromCity: true,
      },
      { confirmation: 'yes' },
    ];

    const first = await send('I sell plumbing materials. My shop is Emeka Plumbing and I am in Aba');

    // The only outstanding item is confirming the inferred state.
    expect(first).toBe("That's Aba in Abia State, right?");

    const done = await send('yes');
    expect(done).toContain('Emeka Plumbing');

    const replies = notifier.sent.map((response) => response.text ?? '');
    expect(replies.some((text) => text.includes('What do you sell'))).toBe(false);
    expect(replies.some((text) => text.includes('business name'))).toBe(false);
  });

  it('builds a Capability DNA with immutable evidence behind it', async () => {
    llm.turns = [
      {},
      { capabilityStatement: 'I sell electrical materials' },
      { city: 'Aba', state: 'Abia', stateInferredFromCity: true },
      { confirmation: 'yes' },
      { businessName: 'Divine Electricals' },
    ];

    await send('register me');
    await send('I sell electrical materials');
    await send('Aba');
    await send('yes');
    await send('Divine Electricals');

    const vendor = await prisma.vendor.findUniqueOrThrow({ where: { userId: `+${VENDOR_PHONE}` } });

    const capabilities = await prisma.vendorCapability.findMany({ where: { vendorId: vendor.id } });
    expect(capabilities.length).toBeGreaterThan(0);

    const wires = capabilities.find((capability) => capability.capabilityId === '10005541');
    expect(wires).toBeDefined();
    // Stated outright, so it must not be recorded as merely inferred.
    expect(wires?.inferred).toBe(false);
    expect(wires?.confidence).toBeGreaterThan(0.5);

    const evidence = await prisma.capabilityEvidence.findMany({ where: { vendorId: vendor.id } });
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0].source).toBe('onboarding_statement');
    expect(evidence[0].originalText).toBe('I sell electrical materials');

    // The declared wording is kept alongside the resolved canonical capability.
    expect(vendor.declaredProducts).toContain('electrical wires');
    expect(vendor.conversationSummary).toContain('Electrical Wires');
  });

  it('does not clarify a broad but useful statement, however ambiguous it looks', async () => {
    // Regression guard for live-testing feedback: "I sell sport materials" was being answered
    // with "what kind of sport materials?". A named trade domain can be expanded, so the
    // platform proceeds instead of spending its one question.
    llm.ambiguityScore = 0.95;
    llm.clarificationQuestion = 'What kind of sport materials do you sell?';
    llm.informationDensity = 'medium';

    llm.turns = [{}, { capabilityStatement: 'I sell sport materials' }];

    await send('register me');
    const reply = await send('I sell sport materials');

    expect(reply).not.toContain('What kind of sport materials');
    expect(reply).toContain('city');
  });

  it('asks at most one clarification when the vendor says nothing expandable', async () => {
    llm.ambiguityScore = 0.9;
    llm.clarificationQuestion = 'Is it mainly house wiring, home electronics, or repair?';
    // Only contentless input earns the question.
    llm.informationDensity = 'very_low';

    llm.turns = [
      {},
      { capabilityStatement: 'I sell electrical things' },
      { capabilityStatement: 'just electrical' },
      { city: 'Aba', state: 'Abia', stateInferredFromCity: true },
    ];

    await send('register me');
    expect(await send('I sell electrical things')).toContain('house wiring');

    // Still vague, but the budget is spent — the platform moves on rather than nagging.
    const next = await send('just electrical');
    expect(next).not.toContain('house wiring');
    expect(next).toContain('city');
  });

  it('publishes seller.onboarded for the Evidence Service to consume', async () => {
    llm.turns = [
      {
        capabilityStatement: 'I sell electrical materials',
        businessName: 'Divine Electricals',
        city: 'Aba',
        state: 'Abia',
        stateInferredFromCity: true,
      },
      { confirmation: 'yes' },
    ];

    await send('I sell electrical materials, Divine Electricals in Aba');
    await send('yes');

    const onboarded = await prisma.outboxEvent.findFirst({ where: { eventType: 'seller.onboarded' } });

    expect(onboarded).not.toBeNull();
    expect(onboarded?.producer).toBe('CapabilityDiscoveryEngine');
    expect((onboarded?.payload as Record<string, unknown>).businessName).toBe('Divine Electricals');
  });

  it('keeps one vendor record even though onboarding spans many turns', async () => {
    llm.turns = [
      {},
      { capabilityStatement: 'I sell electrical materials' },
      { city: 'Aba', state: 'Abia', stateInferredFromCity: true },
      { confirmation: 'yes' },
      { businessName: 'Divine Electricals' },
    ];

    await send('register me');
    await send('I sell electrical materials');
    await send('Aba');
    await send('yes');
    await send('Divine Electricals');

    expect(await prisma.vendor.count()).toBe(1);
  });
});
