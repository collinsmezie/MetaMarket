import { Inject, Injectable } from '@nestjs/common';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  businessUnderstandingJsonSchema,
  businessUnderstandingSchema,
  type BusinessUnderstandingOutput,
} from './schemas';

const COMPONENT = 'CDE';
const STAGE = 'BusinessUnderstanding';

/**
 * Conversation Understanding + Market Language + Semantic Compression + Prototype Generation
 * (CDE §22, Stages 2–4).
 *
 * Turns a vendor's sentence into business meaning: what kind of shop this is, what such shops
 * typically carry, and how much the statement actually told us.
 *
 * The essential move is expansion, not classification. "I sell household items" is not a
 * category to record — it is a seed from which hypotheses grow (CDE "Why this matters"). The
 * archetype carries prior knowledge about what such shops stock, so a five-word sentence
 * yields dozens of signals rather than one label.
 */
@Injectable()
export class BusinessUnderstandingService {
  constructor(
    @Inject(LLM_PROVIDER_SERVICE) private readonly llm: LlmService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  async understand(params: {
    statement: string;
    /** Earlier vendor turns, so a clarification is read against what prompted it. */
    priorStatements?: readonly string[];
  }): Promise<BusinessUnderstandingOutput> {
    const startedAt = Date.now();

    try {
      const result = await this.llm.complete(
        {
          operation: 'business_understanding',
          schemaName: 'BusinessUnderstanding',
          schema: businessUnderstandingJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: this.buildPrompt(params.statement, params.priorStatements ?? []) },
          ],
        },
        (value) => businessUnderstandingSchema.parse(value),
      );

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { statement: params.statement },
        action: `Expanded the statement into a business archetype and capability hypotheses via ${result.provider}`,
        output: {
          expressionType: result.data.expressionType,
          informationDensity: result.data.informationDensity,
          archetype: result.data.businessArchetype,
          products: result.data.products.length,
          services: result.data.services.length,
          ambiguityScore: result.data.ambiguityScore,
        },
        durationMs: Date.now() - startedAt,
      });

      return result.data;
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { statement: params.statement },
        action: 'Business understanding failed; treating the statement as its own single hypothesis',
        error,
        durationMs: Date.now() - startedAt,
      });

      // Degrade to the vendor's literal words rather than losing the turn. One weak
      // hypothesis is still a starting point the marketplace can refine later.
      return {
        expressionType: 'mixed',
        informationDensity: 'low',
        businessArchetype: '',
        archetypeConfidence: 0,
        products: [{ term: params.statement.trim(), stated: true, confidence: 0.5 }],
        services: [],
        brands: [],
        ambiguityScore: 0.5,
        clarificationQuestion: '',
        reasoning: 'Understanding unavailable; using the raw statement.',
      };
    }
  }

  private buildPrompt(statement: string, priorStatements: readonly string[]): string {
    const prior =
      priorStatements.length > 0
        ? ['EARLIER IN THIS CONVERSATION:', ...priorStatements.map((line) => `- ${line}`), ''].join('\n')
        : '';

    return `${prior}VENDOR SAID:\n${statement}`;
  }
}

const SYSTEM_PROMPT = `You interpret how sellers in informal African markets — especially Nigeria — describe their businesses, for a marketplace that matches buyers to vendors over WhatsApp.

Your job is EXPANSION, not classification. Sellers compress enormously: "I run a building materials shop" stands for cement, blocks, roofing sheets, nails, paint, tiles, tools and adhesives. Recover what they left unsaid.

Levels of commercial literacy you will encounter, all describing similar businesses:
  "We distribute low-voltage electrical protection equipment."   (expert)
  "We sell electrical materials."                                 (experienced trader)
  "Electric things."                                              (informal)
  "The things electricians buy."                                  (describes by customer)

Local market vocabulary (Nigerian trade context):
  provisions        -> rice, beans, oil, sugar, milk, tinned goods, beverages, detergents
  building materials-> cement, blocks, roofing sheets, nails, rods, paint, tiles
  electrical things -> wires, cables, switches, sockets, breakers, bulbs, conduits
  phone accessories -> chargers, cables, cases, screen protectors, power banks
  provisions store / kiosk -> everyday household consumables
  spare parts / auto parts -> vehicle spare parts, brake pads, filters, engine oil, automotive batteries, wipers (STRICTLY AUTOMOTIVE COMPONENTS ONLY)
  chemist / patent medicine -> OTC drugs, first aid, plasters, vitamins, basic healthcare items
  boutique / okrika  -> clothing, footwear, fashion accessories, bags
  cold room / frozen foods -> frozen fish, chicken, turkey, sausages

The lists above are illustrations, not a closed set. ANY named trade domain works the same way:

  "I sell sport materials"  -> archetype "sports goods shop"
                               implies footballs, jerseys, boots, tracksuits, gym equipment,
                               whistles, shin guards, sports bags
  "I sell cosmetics"        -> archetype "beauty and cosmetics shop"
                               implies creams, soaps, perfumes, makeup, hair products
  "I do POP work"           -> archetype "ceiling and interior finishing contractor"
                               implies POP cement, ceiling design, screeding, cornices

Rules:
- STRICT DOMAIN BOUNDARIES: Implied products MUST stay strictly within the core commercial domain of the stated archetype. Never jump across domains (e.g., an auto parts shop implies automotive replacement components/maintenance accessories, NOT video games, computing consoles, or clothing).
- STRIP THE CARRIER PHRASE. "I sell sport materials" contains the term "sport materials", not
  "I sell sport materials". Never return the vendor's whole sentence as a product term.
- If the vendor names ANY commercial domain, businessArchetype MUST be non-empty and you MUST
  produce implied products for it. Returning an empty archetype and no implied items for a
  named domain is a failure: expansion is the entire job.
- Mark a product or service "stated: true" ONLY if the vendor actually named it. Everything
  the archetype implies is "stated: false" with lower confidence. Never blur the two.
- Confidence must fall as you move away from what was said. An implied item should rarely
  exceed 0.6.
- informationDensity measures whether there is a domain to expand, NOT how many words were used:
    very_low : no domain at all — "we sell things", "anything", "market items", "goods".
    low      : a domain so broad it barely narrows anything — "I sell products for people".
    medium   : ANY named trade or category — "electrical things", "sport materials",
               "provisions", "cosmetics", "building materials". These are short but genuinely
               informative, and they are the NORMAL case for this market.
    high     : a domain plus specifics — "electrical materials, mostly wiring and breakers".
    very_high: an explicit product or brand list.
  A two-word answer naming a real trade is medium, never very_low.
- ambiguityScore is high only when the ambiguity would lead to a genuinely different set of
  buyers — not merely because the statement is short.
- clarificationQuestion is for statements with NOTHING to expand. If you produced an archetype
  and implied products, you already understood the vendor: return an empty string. Asking
  "what kind of X do you sell?" after successfully expanding X wastes the one question the
  platform is allowed and annoys a busy trader.
- Never ask the vendor to list everything they sell.`;
