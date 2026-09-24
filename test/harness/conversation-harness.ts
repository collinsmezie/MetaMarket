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
import { UnavailableSearchProvider } from '../../src/retrieval/adapters/search/tavily-search-provider.adapter';
import { SEARCH_PROVIDER } from '../../src/retrieval/ports/search-provider.port';
import { BUYER_SEARCH, type ChaosTurn } from './chaos-transcript';

/**
 * Replay harness for chaotic conversations (Conversation-Core-Comparison TDR §7).
 *
 * Boots the real application — MCOS turn assembly, the LangGraph orchestrator, the deterministic
 * workflow engine, real Postgres — and fakes only the three edges a test cannot own: the LLM, the
 * outbound channel and the media queue. The LLM is scripted from each turn's oracle, so the
 * scorecard measures orchestration rather than a model's judgement on a given day.
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
 * It scripts the v1.3 specialists (IDCE intents, CSRE objects), the orchestration prompts the
 * graph may consult (P2 continuity, P5/P6 response planning — echoed faithfully) and the legacy
 * business services the current workflow definitions still call. Anything else is an error: an
 * unscripted call is a call the architecture was not supposed to make.
 */
export class OracleLlm implements LlmService {
  turn: ChaosTurn | null = null;
  readonly operations: string[] = [];

  async complete<T>(req: StructuredRequest, validate: (value: unknown) => T): Promise<StructuredResult<T>> {
    this.operations.push(req.operation);

    return {
      data: validate(this.payloadFor(req)),
      provider: 'openai',
      model: 'oracle',
      latencyMs: 1,
      failedProviders: [],
    };
  }

  /** The JSON content of one labelled `<section>` of the runtime prompt, when present. */
  private section(req: StructuredRequest, name: string): unknown {
    const prompt = req.messages
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n');
    const match = prompt.match(new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`));
    if (match === null) return null;
    try {
      return JSON.parse(match[1]!);
    } catch {
      return match[1];
    }
  }

  private payloadFor(req: StructuredRequest): unknown {
    const operation = req.operation;
    const turn = this.turn;
    if (turn === null) throw new Error(`OracleLlm asked for "${operation}" with no turn set`);

    const prompt = req.operation.split('@')[0]!;
    const search = turn.segments.find((segment) => segment.objective === BUYER_SEARCH);
    const product = search?.objects[0]?.canonical ?? '';
    const location = search?.constraints?.find((constraint) => constraint.type === 'LOCATION')?.value ?? '';

    switch (prompt) {
      case 'idce.master.discover':
        return {
          resolution_status: 'RESOLVED',
          intents: turn.segments.map((segment, index) => ({
            intent_id: `i${index + 1}`,
            type: segment.intentType,
            role: index === 0 ? 'PRIMARY' : 'SECONDARY',
            status: 'RESOLVED',
            confidence: 0.95,
            explicitness: 'EXPLICIT',
            priority: index === 0 ? 0.9 : 0.7,
            scope: { type: 'OBJECT', object_ids: [], workflow_ids: [], conversation_scope: false },
            evidence: { explicit: true, implicit: false, context_used: false, signals: ['oracle'] },
            dependencies: [],
            related_intents: [],
            constraints: (segment.constraints ?? []).map((constraint) => ({
              type: constraint.type,
              value: constraint.value,
              polarity: 'POSITIVE',
              source_span: constraint.value,
            })),
            source_spans: [segment.text],
            routing_hints: [],
          })),
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
          model_metadata: { prompt_version: 'oracle', schema_version: 'oracle' },
        };

      case 'csre.runtime.resolve': {
        const objects = turn.segments.flatMap((segment) => segment.objects);
        return {
          schema_version: '5.0',
          request_id: 'oracle',
          resolution_status:
            objects.length === 0 ? 'NON_REFERENTIAL' : objects.length === 1 ? 'RESOLVED' : 'COMPOSITE',
          original_message: turn.text,
          objects: objects.map((object, index) => ({
            object_id: `object_${index + 1}`,
            semantic_origin: {
              phrase: object.surface,
              concept: object.canonical,
              market_concept_id: null,
              concept_status: 'PROPOSED',
              relationship: 'EXPRESSES',
              origin: 'CSRE',
              request_id: 'oracle',
              semantic_confidence: 0.95,
            },
            surface_form: object.surface,
            canonical_form: object.canonical,
            entity_type: object.entityType,
            definition: `${object.canonical} (oracle)`,
            brand: object.brand ?? null,
            model: null,
            attributes: {},
            aliases: [],
            commercial_interpretation: {
              relevance: object.entityType === 'BRAND' ? 'COMMERCIAL_ENTITY' : 'DIRECT_PRODUCT',
              commercial_offering: true,
              reason: 'oracle',
              confidence: 0.9,
            },
            confidence: { semantic_resolution: 0.95, commercial_relevance: 0.9 },
            ambiguity: { present: false, remaining_candidates: [] },
            functional_context: [],
            relationships: [],
          })),
          context: {
            venues: [],
            regional_context: {
              country: 'Nigeria',
              region: null,
              regional_terms: [],
              regional_interpretation_used: false,
            },
            functional_context: [],
            location_context:
              location.length > 0 ? { expression: location, normalized: location, confidence: 0.9 } : null,
            qualifiers: [],
          },
          clarification: { required: false, question: null },
          evidence: [],
        };
      }

      case 'enrichment.runtime.enrich': {
        // Faithful, knowledge-free profiles: identity copied through, no evidence requested.
        const resolver = this.section(req, 'resolver-output') as {
          objects?: Record<string, unknown>[];
        } | null;
        const objects = resolver?.objects ?? [];
        return {
          schema_version: '4.0',
          request_id: 'oracle',
          enrichment_status: 'ENRICHED',
          source_resolution: { resolver_version: '5.4', resolution_request_id: 'oracle' },
          objects: objects.map((object) => ({
            object_id: object.object_id,
            semantic_origin: object.semantic_origin,
            canonical_form: object.canonical_form,
            entity_type: object.entity_type,
            definition: `${String(object.canonical_form)} (oracle definition)`,
            brand: (object.brand as string | null) ?? null,
            model: (object.model as string | null) ?? null,
            variant: null,
            attributes: {},
            functional_profile: { primary_function: null, secondary_functions: [], mechanism: null },
            use_cases: [],
            commercial_terminology: {
              synonyms: [],
              aliases: [],
              informal_terms: [],
              regional_terms: [],
              industry_terms: [],
            },
            taxonomy_semantics: {
              domain_hints: [],
              category_hints: [],
              subcategory_hints: [],
              object_family: [],
              taxonomy_vocabulary: [],
            },
            distinguishing_features: [],
            confusable_concepts: [],
            embedding_representations: {
              canonical_embedding_text: String(object.canonical_form),
              functional_embedding_text: '',
              taxonomy_embedding_text: '',
              search_terms: [String(object.canonical_form)],
              semantic_keywords: [],
              negative_terms: [],
            },
            evidence: [],
            confidence: { enrichment: 0.8, functional_profile: 0.5, taxonomy_semantics: 0.5 },
            evidence_required: false,
            evidence_request: null,
            resolution_concern: null,
          })),
          relationships: [],
          message_context: { functional_context: [], shared_constraints: [] },
        };
      }

      case 'gpc.runtime.resolve': {
        // Sovereign by construction: map each object to its first supplied candidate, or
        // NOT_APPLICABLE when retrieval supplied none.
        const objects = (this.section(req, 'csre-objects') as Record<string, unknown>[] | null) ?? [];
        const candidates = (this.section(req, 'gpc-candidates') as Record<string, unknown>[] | null) ?? [];
        const policy = (this.section(req, 'policy') as Record<string, unknown> | null) ?? {};
        return {
          schema_version: '4.0',
          request_id: String(policy.request_id ?? 'oracle'),
          resolver_version: String(policy.resolver_version ?? '4.4'),
          status: 'SUCCESS',
          objects: objects.map((object) => {
            const winner = candidates.find((candidate) => candidate.for_object_id === object.object_id);
            return {
              object_id: object.object_id,
              semantic_origin: object.semantic_origin,
              source_trace: object.source_trace,
              mapping: {
                state: winner === undefined ? 'INSUFFICIENT' : 'MAPPED',
                gpc_code: winner === undefined ? null : winner.gpc_code,
                gpc_level: winner === undefined ? null : winner.level,
                gpc_title: winner === undefined ? null : winner.title,
                mapping_confidence: winner === undefined ? 0 : 0.8,
                reason_codes: winner === undefined ? ['INSUFFICIENT_EVIDENCE'] : ['VECTOR_SUPPORT'],
                evidence_ids: [],
                gpc_version: String(policy.gpc_version ?? 'oracle'),
                resolver_version: String(policy.resolver_version ?? '4.4'),
              },
              diagnostic_candidates: [],
              diagnostics: { required_distinction: null, notes: ['oracle'] },
            };
          }),
          message_level: { relationships: [], shared_context: [] },
        };
      }

      case 'mcos.p2.continuity': {
        // Workflow ids come from the prompt's own data: naming them from the fixture would hand
        // the platform the answer to the discovery problem the harness measures.
        const workflows = this.section(req, 'workflows') as {
          active?: { workflowId: string; workflowType: string }[];
          suspended?: { workflowId: string; workflowType: string }[];
        } | null;
        const known = [...(workflows?.active ?? []), ...(workflows?.suspended ?? [])];
        return {
          turn_relationships: turn.segments.map((segment, index) => ({
            relationship: segment.continuity,
            intent_ids: [`i${index + 1}`],
            workflow_ids:
              segment.continuity === 'CONTINUATION' || segment.continuity === 'RESUME'
                ? known
                    .filter((workflow) => workflow.workflowType === segment.objective)
                    .map((workflow) => workflow.workflowId)
                : [],
          })),
          primary_relationship: turn.primaryContinuity,
          confidence: 0.95,
          reason: `oracle: ${turn.label}`,
        };
      }

      case 'mcos.p5.response-planner': {
        // Echo the results in their given order: the oracle never edits business text.
        const results =
          (this.section(req, 'action-results') as
            { action_id: string; status: string; priority: number }[] | null) ?? [];
        return {
          artifacts: results.map((result) => ({
            action_id: result.action_id,
            relevance: 1,
            priority: result.priority,
            text: '',
            actions: [],
            status: 'READY',
            dependencies: [],
          })),
        };
      }

      case 'mcos.p6.naturalizer': {
        const artifacts = (this.section(req, 'artifacts') as { text: string }[] | null) ?? [];
        return { message: artifacts.map((artifact) => artifact.text).join('\n\n') || 'Okay.', actions: [] };
      }

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

      case 'demand_understanding':
        return {
          mode: 'item',
          products: product.length > 0 ? [product] : [],
          services: [],
          businessTypes: [],
          quantities: [],
          modifiers: [],
          constraints: [],
          brands: [],
          location,
          ambiguityType: 'none',
          ambiguityScore: 0.1,
          ambiguityOptions: [],
          inferredItem: '',
          inferredItemConfidence: 0,
          reasoning: 'oracle',
        };

      case 'semantic_expansion':
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
        // correct outcome, not a failure — the harness scores orchestration, not match quality.
        return { selections: [] };

      case 'service_capability_reasoning':
        return { capabilities: [], reasoning: 'oracle' };

      default:
        throw new Error(`Unscripted LLM operation "${operation}"`);
    }
  }
}

export class StubEmbeddings implements EmbeddingProviderPort {
  readonly model = 'stub';
  readonly dimension = 1536;

  async embed(): Promise<readonly number[]> {
    return Array.from({ length: this.dimension }, () => 0.01);
  }

  async embedBatch(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return Promise.all(texts.map(() => this.embed()));
  }
}

export class DiscardingMediaQueue implements MediaProcessingQueuePort {
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
      .overrideProvider(SEARCH_PROVIDER)
      .useValue(new UnavailableSearchProvider())
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
    // MCOS runtime state first: a queue entry whose conversation vanished would otherwise be
    // claimed by the worker during the next replay and fail noisily.
    await this.prisma.turnQueueEntry.deleteMany();
    await this.prisma.pendingClarification.deleteMany();
    await this.prisma.logicalTurn.deleteMany();
    await this.prisma.orchestrationRun.deleteMany();
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
    // Delivery happens inside the graph; the turn commits (trace, events, queue entry) after it.
    // Wait for that too, so teardown never races a turn still finishing.
    await this.waitForTurnsSettled();

    const turnMs = Date.now() - startedAt;

    const reply = this.notifier.sent
      .slice(repliesBefore)
      .map((entry) => entry.response.text ?? '')
      .join('\n');

    const instances = (await this.prisma.workflowInstance.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (row) => ({ type: row.workflowType, status: row.status, state: row.currentState }),
    );

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

  private async waitForTurnsSettled(): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const open = await this.prisma.logicalTurn.count({
        where: { status: { in: ['OPEN', 'SEALED', 'ENQUEUED', 'PROCESSING'] } },
      });
      if (open === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Logical turns did not settle after the reply was delivered');
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
      `    reply:   ${turn.reply.replace(/\s+/g, ' ').slice(0, 320)}`,
      `    llm: ${turn.llmOperations.join(' → ') || '(none)'}`,
      `    workflows: ${turn.instances.map((i) => `${i.type}:${i.status}@${i.state}`).join(', ') || '(none)'}`,
    );
  }

  return lines.join('\n');
}
