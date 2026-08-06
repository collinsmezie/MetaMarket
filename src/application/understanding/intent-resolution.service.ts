import { Inject, Injectable } from '@nestjs/common';
import type { Conversation } from '../../domain/models/conversation';
import type { IntentResult } from '../../domain/models/understanding';
import { UNKNOWN_INTENT } from '../../domain/models/understanding';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { intentJsonSchema, intentSchema } from './schemas';

const COMPONENT = 'MCOS';
const STAGE = 'IntentResolution';

/**
 * Detects what the user wants and extracts the entities they mentioned (MCOS §5.6).
 *
 * Contains no taxonomy or GS1 reasoning — that belongs to Semantic Resolution. Keeping the
 * split means intent stays stable while the marketplace ontology evolves underneath it.
 */
@Injectable()
export class IntentResolutionService {
  constructor(
    @Inject(LLM_PROVIDER_SERVICE) private readonly llm: LlmService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    /** Intents the deployment can actually route, injected so the prompt cannot drift. */
    private readonly supportedIntents: readonly string[],
  ) {}

  async resolve(params: { conversation: Conversation; text: string }): Promise<IntentResult> {
    const startedAt = Date.now();

    if (params.text.trim().length === 0) {
      // Nothing readable arrived — a media-only message whose processing produced no text.
      return { intent: UNKNOWN_INTENT, confidence: 0, entities: {}, language: 'en' };
    }

    try {
      const result = await this.llm.complete(
        {
          operation: 'intent_resolution',
          schemaName: 'IntentResult',
          schema: intentJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: this.systemPrompt() },
            { role: 'user', content: this.buildPrompt(params.conversation, params.text) },
          ],
        },
        (value) => intentSchema.parse(value),
      );

      const entities: Record<string, string> = {};
      for (const entity of result.data.entities) {
        if (entity.value.trim().length > 0) entities[entity.name] = entity.value;
      }

      const intent: IntentResult = {
        intent: result.data.intent,
        confidence: result.data.confidence,
        entities,
        language: result.data.language,
        ...(result.data.command.length > 0 ? { command: result.data.command } : {}),
      };

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { message: params.text },
        action: `Detected intent [${intent.intent}] via ${result.provider}`,
        output: intent,
        durationMs: Date.now() - startedAt,
      });

      return intent;
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { message: params.text },
        action: 'Intent resolution failed across all providers; returning unknown intent',
        error,
        durationMs: Date.now() - startedAt,
      });

      // Returning `unknown` rather than throwing lets the caller emit the fallback envelope
      // instead of dropping the user's message.
      return { intent: UNKNOWN_INTENT, confidence: 0, entities: {}, language: 'en' };
    }
  }

  private systemPrompt(): string {
    return `You extract intent and entities from marketplace messages sent by buyers and sellers in informal African markets, mostly over WhatsApp.

Supported intents (choose exactly one, or "unknown"):
${this.supportedIntents.map((intent) => `- ${intent}`).join('\n')}

Rules:
- Extract only what the user actually said. Never infer a product, quantity or place that is not present.
- Messages mix English, Nigerian Pidgin and local terms. "I wan buy hammer" is a product search.
- Common entity names: product, service, quantity, location, city, state, business_name, brand, budget, order_id, vendor_id.
- A message can carry entities for several steps at once ("I sell wire, my shop is Divine Electricals in Aba"). Extract all of them.
- Set command only for explicit control words: cancel, restart, help, stop. Otherwise return an empty string.
- Set confidence honestly; a low score is better than a confident wrong intent.`;
  }

  private buildPrompt(conversation: Conversation, text: string): string {
    const history = conversation.history
      .slice(-4)
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join('\n');

    return [
      'RECENT CONVERSATION:',
      history.length > 0 ? history : '(no prior turns)',
      '',
      'MESSAGE TO CLASSIFY:',
      text,
    ].join('\n');
  }
}
