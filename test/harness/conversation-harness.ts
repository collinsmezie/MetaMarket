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
import { BUYER_SEARCH, type ChaosTurn } from './chaos-transcript';

/**
 * Replay harness for chaotic conversations (Conversation-Core-Comparison TDR §7).
 *
 * Boots the real application — real routing, real workflow engine, real Postgres — and fakes
 * only the three edges a test cannot own: the LLM, the outbound channel and the media queue.
 * The LLM is scripted from each turn's oracle, so the scorecard measures the conversation
 * core's orchestration rather than a model's judgement on a given day.
 *
 * Identical on both branches of the comparison. Only the core behind it changes.
 */

const APP_SECRET = 'test-app-secret';
const PHONE = '2348012345678';
const SESSION = 'sess_chaos_1';

export interface TurnScore {
  readonly label: string;
  readonly text: string;
  /** Everything the platform said this turn, joined. */
  readonly reply: string;
  /** LLM operations invoked, in order. The cost side of the comparison. */
  readonly llmOperations: readonly string[];
  readonly instances: readonly { type: string; status: string; state: string }[];
  readonly objectivesExpected: readonly string[];
  /** Expected objectives that have a workflow instance by the end of the turn. */
  readonly objectivesServed: readonly string[];
  readonly objectivesDropped: readonly string[];
  /** Required reply fragments that never appeared. */
  readonly replyMissing: readonly string[];
  readonly turnMs: number;
}

export interface Scorecard {
  readonly channel: Channel;
  readonly turns: readonly TurnScore[];
  readonly objectivesDropped: readonly string[];
  readonly llmCallCount: number;
}

/** Captures outbound replies for any channel instead of messaging a real recipient. */
class CapturingNotifier implements ChannelNotifierPort {
  readonly sent: { target: DeliveryTarget; response: Response }[] = [];

  constructor(readonly channel: Channel) {}

  async send(target: DeliveryTarget, response: Response): Promise<DeliveryResult> {
    this.sent.push({ target, response });
    return { delivered: true, providerMessageId: `out.${this.sent.length}`, messageCount: 1 };
  }

  async indicateTyping(): Promise<void> {
    // The indicator is best-effort and carries no assertion value here.
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
}

/**
 * An LLM that answers each turn correctly, by construction.
 *
 * `intent_resolution` can only return one intent, because that is all the schema allows — the
 * oracle does not get to cheat around a limitation the platform has. When a turn carries two
 * segments, this returns the first and the harness records what became of the second.
 */
class OracleLlm implements LlmService {
  turn: ChaosTurn | null = null;
  readonly operations: string[] = [];

  async complete<T>(req: StructuredRequest, validate: (value: unknown) => T): Promise<StructuredResult<T>> {
    this.operations.push(req.operation);

    return {
      data: validate(this.payloadFor(req.operation)),
      provider: 'openai',
      model: 'oracle',
      latencyMs: 1,
      failedProviders: [],
    };
  }

  private payloadFor(operation: string): unknown {
    const turn = this.turn;
    if (turn === null) throw new Error(`OracleLlm asked for "${operation}" with no turn set`);

    const primary = turn.segments[0];
    const search = turn.segments.find((segment) => segment.objective === BUYER_SEARCH);

    switch (operation) {
      case 'continuity_analysis':
        return {
          relationship: turn.relationship,
          confidence: 0.95,
          // Left empty deliberately: naming an id here would hand the platform the answer to
          // the discovery problem the harness is measuring.
          candidateWorkflowIds: [],
          reasoning: `oracle: ${turn.label}`,
        };

      case 'intent_resolution':
        return {
          intent: primary.intent,
          confidence: 0.95,
          entities: Object.entries(primary.entities).map(([name, value]) => ({ name, value })),
          language: 'en',
          command: '',
        };

      case 'onboarding_extraction':
        return {
          capabilityStatement: '',
          businessName: '',
          businessNameConfidence: 0,
          city: '',
          cityConfidence: 0,
          state: '',
          stateConfidence: 0,
          stateInferredFromCity: false,
          isConfirmation: false,
          confirmationValue: 'none',
          reasoning: 'oracle',
          ...turn.onboarding,
        };

      case 'semantic_resolution': {
        const product = search?.entities.product ?? '';
        return {
          products: product.length > 0 ? [{ raw: product, normalized: product, aliases: [] }] : [],
          services: [],
          categoryName: '',
          ambiguity: false,
          ambiguityScore: 0.1,
          modifiers: [],
          constraints: [],
          brands: [],
        };
      }

      case 'demand_understanding':
        return {
          mode: 'item',
          products: search?.entities.product !== undefined ? [search.entities.product] : [],
          services: [],
          businessTypes: [],
          quantities: [],
          modifiers: [],
          constraints: [],
          brands: [],
          location: search?.entities.location ?? '',
          ambiguityType: 'none',
          ambiguityScore: 0.1,
          ambiguityOptions: [],
          inferredItem: '',
          inferredItemConfidence: 0,
          reasoning: 'oracle',
        };

      case 'semantic_expansion':
        return {
          missions: [],
          capabilities: [],
          inventoryAffinities: [],
          inferredProducts: [],
          reasoning: 'oracle',
        };

      case 'business_understanding':
        return {
          missions: [],
          capabilities: [],
          inventoryAffinities: [],
          inferredProducts: [],
          reasoning: 'oracle',
        };

      case 'capability_ranking':
        // No taxonomy is seeded, so there is nothing to rank. Matching returning empty is the
        // correct outcome, not a failure — the harness scores routing, not match quality.
        return { selections: [] };

      case 'service_capability_reasoning':
        return { capabilities: [], reasoning: 'oracle' };

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

class DiscardingMediaQueue implements MediaProcessingQueuePort {
  async enqueue(_job: MediaProcessingJob): Promise<void> {
    // The transcript is text-only.
  }
}

export class ChaosHarness {
  private app!: INestApplication;
  private prisma!: PrismaService;
  private notifier!: CapturingNotifier;
  private llm!: OracleLlm;

  constructor(private readonly channel: Channel) {}

  async start(): Promise<void> {
    this.notifier = new CapturingNotifier(this.channel);
    this.llm = new OracleLlm();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LLM_PROVIDER_SERVICE)
      .useValue(this.llm)
      .overrideProvider(CHANNEL_NOTIFIER_REGISTRY)
      .useValue(new CapturingRegistry(this.notifier))
      .overrideProvider(EMBEDDING_PROVIDER)
      .useValue(new StubEmbeddings())
      .overrideProvider(MEDIA_PROCESSING_QUEUE)
      .useValue(new DiscardingMediaQueue())
      .compile();

    // Mirrors main.ts: without `bodyParser: false` plus this middleware, `rawBody` is never
    // captured and WhatsApp signature verification fails.
    this.app = moduleRef.createNestApplication({ bodyParser: false });
    this.app.use(
      express.json({
        verify: (req: express.Request & { rawBody?: Buffer }, _res, buffer: Buffer) => {
          req.rawBody = Buffer.from(buffer);
        },
      }),
    );

    await this.app.init();
    this.prisma = this.app.get(PrismaService);
  }

  async stop(): Promise<void> {
    await this.app.close();
  }

  async reset(): Promise<void> {
    await this.prisma.conversation.deleteMany();
    await this.prisma.outboxEvent.deleteMany();
    this.notifier.sent.length = 0;
    this.llm.operations.length = 0;
  }

  /** Replays a whole transcript and returns the scorecard. */
  async replay(transcript: readonly ChaosTurn[]): Promise<Scorecard> {
    const turns: TurnScore[] = [];

    for (const [index, turn] of transcript.entries()) {
      turns.push(await this.sendTurn(turn, index));
    }

    const objectivesDropped = [...new Set(turns.flatMap((score) => score.objectivesDropped))];

    return {
      channel: this.channel,
      turns,
      objectivesDropped,
      llmCallCount: turns.reduce((total, score) => total + score.llmOperations.length, 0),
    };
  }

  private async sendTurn(turn: ChaosTurn, index: number): Promise<TurnScore> {
    this.llm.turn = turn;

    const repliesBefore = this.notifier.sent.length;
    const operationsBefore = this.llm.operations.length;
    const startedAt = Date.now();

    await this.dispatch(turn.text, index);
    await this.waitForReply(repliesBefore + 1);

    const turnMs = Date.now() - startedAt;

    const reply = this.notifier.sent
      .slice(repliesBefore)
      .map((entry) => entry.response.text ?? '')
      .join('\n');

    const instances = (
      await this.prisma.workflowInstance.findMany({ orderBy: { createdAt: 'asc' } })
    ).map((row) => ({ type: row.workflowType, status: row.status, state: row.currentState }));

    const objectivesExpected = turn.segments.map((segment) => segment.objective);
    const present = new Set(instances.map((instance) => instance.type));
    const objectivesServed = objectivesExpected.filter((objective) => present.has(objective));

    return {
      label: turn.label,
      text: turn.text,
      reply,
      llmOperations: this.llm.operations.slice(operationsBefore),
      instances,
      objectivesExpected,
      objectivesServed,
      objectivesDropped: objectivesExpected.filter((objective) => !present.has(objective)),
      replyMissing: turn.replyMustContain.filter(
        (fragment) => !reply.toLowerCase().includes(fragment.toLowerCase()),
      ),
      turnMs,
    };
  }

  /** Sends one turn over whichever channel this harness is configured for. */
  private async dispatch(text: string, index: number): Promise<void> {
    if (this.channel === 'web') {
      await request(this.app.getHttpServer())
        .post('/channels/web/messages')
        .send({ sessionId: SESSION, phone: `+${PHONE}`, text, clientMessageId: `m${index}` })
        .expect(202);
      return;
    }

    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                contacts: [{ wa_id: PHONE, profile: { name: 'Emeka' } }],
                messages: [
                  {
                    from: PHONE,
                    id: `wamid.chaos.${index}`,
                    timestamp: '1785412800',
                    type: 'text',
                    text: { body: text },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const raw = Buffer.from(JSON.stringify(body));
    const signature = `sha256=${createHmac('sha256', APP_SECRET).update(raw).digest('hex')}`;

    await request(this.app.getHttpServer())
      .post('/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(raw.toString('utf8'))
      .expect(200);
  }

  /** Both inbound adapters process detached from the HTTP response; wait for the reply. */
  private async waitForReply(expected: number): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (this.notifier.sent.length >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Expected ${expected} outbound message(s), saw ${this.notifier.sent.length}`);
  }
}

/** Renders a scorecard as a table, so a replay run is readable in CI output. */
export function formatScorecard(scorecard: Scorecard): string {
  const lines = [`channel=${scorecard.channel}  llmCalls=${scorecard.llmCallCount}`];

  for (const turn of scorecard.turns) {
    lines.push(
      `  ${turn.label}`,
      `    served:  ${turn.objectivesServed.join(', ') || '(none)'}`,
      `    dropped: ${turn.objectivesDropped.join(', ') || '(none)'}`,
      `    missing reply fragments: ${turn.replyMissing.join(', ') || '(none)'}`,
      `    reply:   ${turn.reply.replace(/\s+/g, ' ').slice(0, 140)}`,
      `    llm: ${turn.llmOperations.join(' → ') || '(none)'}`,
      `    workflows: ${turn.instances.map((i) => `${i.type}:${i.status}@${i.state}`).join(', ') || '(none)'}`,
    );
  }

  return lines.join('\n');
}
