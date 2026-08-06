import { Inject, Injectable } from '@nestjs/common';
import type { IntentResult, SemanticRequest } from '../../domain/models/understanding';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { semanticJsonSchema, semanticSchema } from './schemas';

const COMPONENT = 'MCOS';
const STAGE = 'SemanticResolution';

/**
 * Turns extracted entities into marketplace meaning (MCOS §5.7).
 *
 * Normalises products, expands aliases and detects ambiguity.
 *
 * GS1 GPC resolution is a declared gap in this phase: the taxonomy file has not been
 * supplied, so `category.gpc` is left unset rather than guessed. A fabricated GPC code
 * would be worse than an absent one, because downstream retrieval would trust it.
 */
@Injectable()
export class SemanticResolutionService {
  constructor(
    @Inject(LLM_PROVIDER_SERVICE) private readonly llm: LlmService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  async resolve(params: { intent: IntentResult; text: string }): Promise<SemanticRequest> {
    const startedAt = Date.now();

    try {
      const result = await this.llm.complete(
        {
          operation: 'semantic_resolution',
          schemaName: 'SemanticRequest',
          schema: semanticJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: this.buildPrompt(params.intent, params.text) },
          ],
        },
        (value) => semanticSchema.parse(value),
      );

      const semantic: SemanticRequest = {
        intent: params.intent.intent,
        products: result.data.products,
        services: result.data.services,
        ...(result.data.categoryName.length > 0
          ? // No `gpc` field: the taxonomy is not yet seeded, and an invented code would be
            // treated as authoritative by candidate retrieval.
            { category: { name: result.data.categoryName } }
          : {}),
        ambiguity: result.data.ambiguity,
        ambiguityScore: result.data.ambiguityScore,
        modifiers: result.data.modifiers,
        constraints: result.data.constraints,
        brands: result.data.brands,
      };

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { intent: params.intent.intent, entities: params.intent.entities },
        action: `Normalized demand via ${result.provider}; GS1 GPC mapping pending taxonomy seed`,
        output: semantic,
        durationMs: Date.now() - startedAt,
      });

      return semantic;
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { intent: params.intent.intent, message: params.text },
        action: 'Semantic resolution failed; falling back to the raw extracted entities',
        error,
        durationMs: Date.now() - startedAt,
      });

      return this.fallbackFromEntities(params.intent);
    }
  }

  /**
   * Degrades to the entities intent resolution already extracted.
   *
   * The user said "hammer"; losing the whole turn because normalization failed would be a
   * worse outcome than searching on the raw term.
   */
  private fallbackFromEntities(intent: IntentResult): SemanticRequest {
    const asItems = (value: string | readonly string[] | undefined) => {
      if (value === undefined) return [];
      const values = Array.isArray(value) ? value : [value];
      return values
        .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
        .map((entry) => ({ raw: entry, normalized: entry, aliases: [] as string[] }));
    };

    return {
      intent: intent.intent,
      products: asItems(intent.entities.product),
      services: asItems(intent.entities.service),
      ambiguity: false,
      // Zero rather than a guess: the platform did not actually assess ambiguity here.
      ambiguityScore: 0,
      modifiers: [],
      constraints: [],
      brands: [],
    };
  }

  private buildPrompt(intent: IntentResult, text: string): string {
    const entities = Object.entries(intent.entities)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('\n');

    return [
      `INTENT: ${intent.intent}`,
      '',
      'EXTRACTED ENTITIES:',
      entities.length > 0 ? entities : '(none)',
      '',
      'ORIGINAL MESSAGE:',
      text,
    ].join('\n');
  }
}

const SYSTEM_PROMPT = `You normalise marketplace demand into standard commercial vocabulary for an informal-market platform in Nigeria.

For each product or service mentioned:
- raw: exactly what the user said
- normalized: the standard trade name ("hot flask" -> "Vacuum Flask", "singlet" -> "Vest")
- aliases: other names local buyers and sellers use for the same thing

Ambiguity:
- Set ambiguity true ONLY when the different meanings would lead to genuinely different shops.
  "Printer" is ambiguous (home printer / POS receipt printer / 3D printer) -> true.
  "Hammer" has variations but every hardware shop stocks it -> false.
- ambiguityScore is how confident you are that the ambiguity matters, 0 to 1.

Never invent modifiers, constraints or brands. If the user did not state a size, colour,
budget or brand, return an empty list. A missing modifier is information, not a gap to fill.

Local vocabulary matters: "provisions" means everyday groceries, "building materials" spans
cement, blocks, roofing and nails, "phone accessories" means chargers, cases and cables.`;
