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

Local market vocabulary:
  provisions        -> rice, beans, oil, sugar, milk, tinned goods, beverages
  building materials-> cement, blocks, roofing sheets, nails, rods, paint, tiles
  electrical things -> wires, cables, switches, sockets, breakers, bulbs, conduits
  phone accessories -> chargers, cables, cases, screen protectors, power banks
  provisions store / kiosk -> everyday household consumables
  spare parts       -> vehicle or machine components, depending on context

Rules:
- Mark a product or service "stated: true" ONLY if the vendor actually named it. Everything
  the archetype implies is "stated: false" with lower confidence. Never blur the two.
- Confidence must fall as you move away from what was said. An implied item should rarely
  exceed 0.6.
- informationDensity: "We sell things" is very_low. "We sell electrical things" is medium.
  "We stock Schneider breakers, armoured cable, MCCBs and conduit fittings" is very_high.
- ambiguityScore is high only when the ambiguity would lead to a genuinely different set of
  buyers — not merely because the statement is short.
- clarificationQuestion must be answerable in a few words and phrased the way a trader speaks.
  Prefer "What do customers usually come to buy from you?" over "Which category best describes
  your business?". Return an empty string when asking would not be worth the interruption.
- Never ask the vendor to list everything they sell.`;
