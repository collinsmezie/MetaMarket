import { Inject, Injectable } from '@nestjs/common';
import type { AmbiguityType, DemandObject, SearchMode, SemanticExpansion } from '../../domain/models/demand';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { demandJsonSchema, demandSchema, expansionJsonSchema, expansionSchema } from './schemas';

const COMPONENT = 'CME';

/**
 * Demand Understanding and Semantic Expansion (CME §6, §8, §20).
 *
 * Two stages, kept separate because they answer different questions and fail differently. The
 * first reads what the customer said; the second reasons about what would satisfy them. If
 * expansion fails, the search still works on the literal request — degraded, not broken.
 */
@Injectable()
export class DemandUnderstandingService {
  constructor(
    @Inject(LLM_PROVIDER_SERVICE) private readonly llm: LlmService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  /**
   * Classifies the search mode and extracts structured demand.
   *
   * Extraction only — nothing is inferred here. A missing modifier is recorded as absent, since
   * inventing one would quietly exclude vendors the customer never ruled out (CME §6).
   */
  async understand(params: {
    query: string;
    /** Prior turns, so "the second one" or a clarification answer can be read in context. */
    history?: readonly string[];
  }): Promise<DemandObject> {
    const startedAt = Date.now();

    try {
      const result = await this.llm.complete(
        {
          operation: 'demand_understanding',
          schemaName: 'DemandObject',
          schema: demandJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: DEMAND_PROMPT },
            { role: 'user', content: this.buildPrompt(params.query, params.history ?? []) },
          ],
        },
        (value) => demandSchema.parse(value),
      );

      const data = result.data;

      // A descriptive search resolves to a concrete item before expansion, so the rest of the
      // pipeline sees a product rather than a paraphrase (CME §27.4).
      const products =
        data.mode === 'descriptive' && data.inferredItem.trim().length > 0
          ? [data.inferredItem.trim(), ...data.products]
          : data.products;

      const demand: DemandObject = {
        rawQuery: params.query,
        mode: data.mode as SearchMode,
        products: this.clean(products),
        services: this.clean(data.services),
        businessTypes: this.clean(data.businessTypes),
        quantities: this.clean(data.quantities),
        modifiers: this.clean(data.modifiers),
        constraints: this.clean(data.constraints),
        brands: this.clean(data.brands),
        location: data.location.trim().length > 0 ? data.location.trim() : null,
        ambiguityType: data.ambiguityType as AmbiguityType,
        ambiguityScore: data.ambiguityScore,
        ambiguityOptions: this.clean(data.ambiguityOptions),
      };

      this.logger.stage({
        component: COMPONENT,
        stage: 'DemandUnderstandingStage',
        input: { rawMessage: params.query },
        action: `Classified as ${demand.mode} search and extracted the demand object via ${result.provider}`,
        output: {
          products: demand.products,
          services: demand.services,
          businessTypes: demand.businessTypes,
          ambiguity: demand.ambiguityType,
          ambiguityScore: demand.ambiguityScore,
        },
        durationMs: Date.now() - startedAt,
      });

      return demand;
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: 'DemandUnderstandingStage',
        input: { rawMessage: params.query },
        action: 'Demand understanding failed; treating the raw query as a literal item search',
        error,
        durationMs: Date.now() - startedAt,
      });

      // The customer said something; searching for it literally beats losing the turn.
      return {
        rawQuery: params.query,
        mode: 'item',
        products: [params.query.trim()],
        services: [],
        businessTypes: [],
        quantities: [],
        modifiers: [],
        constraints: [],
        brands: [],
        location: null,
        ambiguityType: 'none',
        ambiguityScore: 0,
        ambiguityOptions: [],
      };
    }
  }

  /**
   * Builds the three reasoning graphs (CME §8).
   *
   * Independent by design: Mission asks what the customer is doing, Capability asks who normally
   * serves that, Inventory Affinity asks who else happens to stock it. The third is what lets a
   * general merchant surface for a hammer — the overlapping inventories the TDR is built around.
   */
  async expand(demand: DemandObject): Promise<SemanticExpansion> {
    const startedAt = Date.now();

    try {
      const result = await this.llm.complete(
        {
          operation: 'semantic_expansion',
          schemaName: 'SemanticExpansion',
          schema: expansionJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: EXPANSION_PROMPT },
            { role: 'user', content: this.buildExpansionPrompt(demand) },
          ],
        },
        (value) => expansionSchema.parse(value),
      );

      const expansion: SemanticExpansion = {
        missions: this.clean(result.data.missions),
        capabilities: result.data.capabilities.filter((entry) => entry.name.trim().length > 0),
        inventoryAffinities: result.data.inventoryAffinities.filter((entry) => entry.name.trim().length > 0),
        inferredProducts: this.clean(result.data.inferredProducts),
      };

      this.logger.stage({
        component: COMPONENT,
        stage: 'SemanticExpansion',
        input: { products: demand.products, mode: demand.mode },
        action: `Built mission, capability and inventory-affinity graphs via ${result.provider}`,
        output: {
          missions: expansion.missions,
          capabilities: expansion.capabilities.map((c) => `${c.name} ${c.confidence.toFixed(2)}`),
          inventoryAffinities: expansion.inventoryAffinities.map((c) => c.name),
          inferredProducts: expansion.inferredProducts,
        },
        durationMs: Date.now() - startedAt,
      });

      return expansion;
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: 'SemanticExpansion',
        input: { products: demand.products },
        action: 'Semantic expansion failed; retrieval will use the literal demand only',
        error,
        durationMs: Date.now() - startedAt,
      });

      // Losing expansion costs recall of overlapping vendors, not correctness.
      return { missions: [], capabilities: [], inventoryAffinities: [], inferredProducts: [] };
    }
  }

  private clean(values: readonly string[]): readonly string[] {
    return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
  }

  private buildPrompt(query: string, history: readonly string[]): string {
    const prior = history.length > 0 ? `RECENT CONVERSATION:\n${history.join('\n')}\n\n` : '';
    return `${prior}CUSTOMER SAID: ${query}`;
  }

  private buildExpansionPrompt(demand: DemandObject): string {
    return [
      `CUSTOMER REQUEST: ${demand.rawQuery}`,
      `SEARCH MODE: ${demand.mode}`,
      `PRODUCTS: ${demand.products.join(', ') || '(none named)'}`,
      `SERVICES: ${demand.services.join(', ') || '(none named)'}`,
      `BUSINESS TYPES: ${demand.businessTypes.join(', ') || '(none named)'}`,
      `MODIFIERS: ${demand.modifiers.join(', ') || '(none)'}`,
    ].join('\n');
  }
}

const DEMAND_PROMPT = `You interpret what a buyer in an informal African market — typically Nigeria — is asking for, over WhatsApp.

First decide HOW they are searching:
- item        : they name the thing.            "Hammer", "Rice", "iPhone charger"
- descriptive : they describe it without the name. "The thing used to tighten bolts"
- business    : they name a trade, not a product.  "Hardware store", "Mechanic", "Tailor"
- vibe        : an occasion, outcome or mood.      "Something for camping", "A classy wedding gift"

Then extract what is actually there. Extraction only — never infer:
- Record a modifier, quantity, brand or constraint ONLY if the customer stated it. An empty
  list is the correct answer. Inventing "small" or "cheap" would exclude shops they never ruled out.
- For descriptive searches, put the concrete item in inferredItem with an honest confidence.
  "The thing used to tighten bolts" -> "Wrench". Leave it empty for other modes.

Ambiguity — this decides whether we interrupt the customer with a question, so be strict:
- Set ambiguityType to none unless the different readings would send the buyer to genuinely
  DIFFERENT KINDS OF SHOP.
- "Printer" is ambiguous: home printer, POS receipt printer, 3D printer, large format. Different
  trades entirely -> polysemy, high score, list the options.
- "Generator" is ambiguous: petrol, diesel, solar, inverter -> polysemy.
- "Hammer" is NOT ambiguous. There are variants, but every hardware shop stocks one.
- "Bat" is homonymy: an animal or sporting goods.
- Only populate ambiguityOptions when you set a type other than none.

Nigerian market vocabulary: "provisions" = everyday groceries; "building materials" = cement,
blocks, roofing, nails, paint; "phone accessories" = chargers, cables, cases. Pidgin is common:
"I wan buy hammer" is an item search.`;

const EXPANSION_PROMPT = `You reason about who can satisfy a buyer's request in an informal African marketplace, producing three INDEPENDENT views.

1. missions — what is the customer actually trying to accomplish?
   "Hammer" -> build something, repair something, construction, DIY.

2. capabilities — which business capabilities NORMALLY satisfy this demand, with confidence?
   "Hammer" -> Hardware 0.98, Building Materials 0.94, Industrial Tools 0.8.

3. inventoryAffinities — which business types plausibly STOCK this even though it is not their
   specialty? This is the most valuable list, because it surfaces shops a category filter hides.
   "Hammer" -> General Merchandise, Agricultural Supplies, Electrical Supplies, Supermarket.
   "Artist brush" -> Bookstores, Educational Stores, Gift Shops.

4. inferredProducts — for vibe or mission-style requests, the concrete things they probably need.
   "Something for camping" -> tent, sleeping bag, torch, portable stove, cooler box.
   "I want to bake cake" -> flour, sugar, baking powder, cake tin, mixer.
   Leave empty when the customer already named the product.

Confidence must be honest and fall away from the obvious. Affinity entries should rarely exceed
0.6 — they are "might have it", not "specialises in it".`;
