import { Inject, Injectable } from '@nestjs/common';
import { FIELD_ACCEPT_THRESHOLD, type OnboardingFields } from '../../domain/models/vendor';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { onboardingExtractionJsonSchema, onboardingExtractionSchema } from './schemas';

const COMPONENT = 'MCOS';
const STAGE = 'OnboardingExtraction';

export interface ExtractionResult {
  readonly fields: Partial<OnboardingFields>;
  /** True when the state was deduced from the city and therefore needs confirming. */
  readonly stateInferredFromCity: boolean;
  /**
   * The deduced state, held out of {@link fields} so it is proposed to the vendor rather than
   * silently recorded — "That's Warri in Delta State, right?" (Vendor-Onboarding.md Step 3).
   */
  readonly inferredState: string | null;
  readonly stateConfidence: number;
  /** Set when the message reads as a yes/no answer to something the platform proposed. */
  readonly confirmation: 'yes' | 'no' | null;
  readonly reasoning: string;
}

/**
 * Extracts every onboarding field present in a message (MCOS Refinement #11).
 *
 * "Each incoming message SHALL be analyzed for every unresolved workflow field, not only the
 * field corresponding to the most recently asked question." A vendor answering "What do you
 * sell?" with "I sell plumbing materials, my shop is Emeka Plumbing and I'm in Aba" has
 * answered three questions, and asking the other two would waste the goodwill this platform
 * depends on.
 */
@Injectable()
export class OnboardingExtractionService {
  constructor(
    @Inject(LLM_PROVIDER_SERVICE) private readonly llm: LlmService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  async extract(params: {
    message: string;
    /** What the platform just asked, so a bare "yes" can be interpreted. */
    pendingQuestion: string | null;
    known: OnboardingFields;
  }): Promise<ExtractionResult> {
    const startedAt = Date.now();

    try {
      const result = await this.llm.complete(
        {
          operation: 'onboarding_extraction',
          schemaName: 'OnboardingExtraction',
          schema: onboardingExtractionJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: this.buildPrompt(params) },
          ],
        },
        (value) => onboardingExtractionSchema.parse(value),
      );

      const data = result.data;

      // Only values the model is actually confident about are accepted. A guessed business
      // name silently recorded as fact is worse than one more question.
      const fields: Partial<OnboardingFields> = {
        ...(data.capabilityStatement.trim().length > 0
          ? { capabilityStatement: data.capabilityStatement.trim() }
          : {}),
        ...(data.businessName.trim().length > 0 && data.businessNameConfidence >= FIELD_ACCEPT_THRESHOLD
          ? { businessName: data.businessName.trim() }
          : {}),
        ...(data.city.trim().length > 0 && data.cityConfidence >= FIELD_ACCEPT_THRESHOLD
          ? { city: data.city.trim() }
          : {}),
        // The state is held back when it was merely inferred: the workflow confirms it
        // conversationally ("That's Warri in Delta State, right?") before recording it.
        ...(data.state.trim().length > 0 &&
        !data.stateInferredFromCity &&
        data.stateConfidence >= FIELD_ACCEPT_THRESHOLD
          ? { state: data.state.trim() }
          : {}),
      };

      const extraction: ExtractionResult = {
        fields,
        stateInferredFromCity: data.stateInferredFromCity,
        inferredState: data.stateInferredFromCity && data.state.trim().length > 0 ? data.state.trim() : null,
        stateConfidence: data.stateConfidence,
        confirmation:
          data.isConfirmation && data.confirmationValue !== 'none' ? data.confirmationValue : null,
        reasoning: data.reasoning,
      };

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { message: params.message, pendingQuestion: params.pendingQuestion },
        action: `Extracted ${Object.keys(fields).length} onboarding field(s) from a single message via ${result.provider}`,
        output: {
          fields,
          stateInferredFromCity: data.stateInferredFromCity,
          confirmation: extraction.confirmation,
        },
        durationMs: Date.now() - startedAt,
      });

      return extraction;
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { message: params.message },
        action: 'Extraction failed; the workflow will ask rather than assume',
        error,
        durationMs: Date.now() - startedAt,
      });

      // Extracting nothing is safe: the workflow falls back to asking, which is slower but
      // never records something the vendor did not say.
      return {
        fields: {},
        stateInferredFromCity: false,
        inferredState: null,
        stateConfidence: 0,
        confirmation: this.literalConfirmation(params.message),
        reasoning: 'Extraction unavailable.',
      };
    }
  }

  /**
   * Last-resort yes/no detection when the model is unavailable.
   *
   * Deliberately narrow — only unmistakable single-word answers — so a failure cannot produce
   * a false confirmation of something the vendor never agreed to.
   */
  private literalConfirmation(message: string): 'yes' | 'no' | null {
    const normalized = message
      .trim()
      .toLowerCase()
      .replace(/[^a-z\s]/g, '');

    if (/^(yes|yeah|yep|correct|right|na so|exactly|true|ok|okay)$/.test(normalized)) return 'yes';
    if (/^(no|nope|wrong|not correct|nah)$/.test(normalized)) return 'no';

    return null;
  }

  private buildPrompt(params: {
    message: string;
    pendingQuestion: string | null;
    known: OnboardingFields;
  }): string {
    const known = Object.entries(params.known)
      .filter(([, value]) => value !== null)
      .map(([key, value]) => `- ${key}: ${String(value)}`);

    return [
      'ALREADY KNOWN (do not re-extract unless the vendor is correcting it):',
      known.length > 0 ? known.join('\n') : '- nothing yet',
      '',
      `QUESTION THE PLATFORM JUST ASKED: ${params.pendingQuestion ?? '(none)'}`,
      '',
      `VENDOR MESSAGE: ${params.message}`,
    ].join('\n');
  }
}

const SYSTEM_PROMPT = `You extract business-onboarding details from messages sent by sellers in Nigeria over WhatsApp.

Extract EVERY field present in the message, not only the one that was asked about. A vendor
often volunteers several things at once:

  "I sell plumbing materials. My shop is called Emeka Plumbing and I'm in Aba."
    -> capabilityStatement: "I sell plumbing materials"
    -> businessName: "Emeka Plumbing"
    -> city: "Aba"
    -> state: "Abia"  (deduced from the city, so stateInferredFromCity = true)

Rules:
- capabilityStatement is what they sell or do, in their own words. Do not rewrite it.
- businessName is a shop or trading name. "I'm Chinedu" is a person's name, not a business
  name — leave businessName empty and set its confidence to 0. Only treat a personal name as a
  business name if they present it as one ("my business is Chinedu Electricals").
- If they name a well-known Nigerian city, you may deduce the state, but you MUST set
  stateInferredFromCity = true. Only set it false when they stated the state themselves.
  Well-known examples: Aba -> Abia, Warri -> Delta, Yaba/Ikeja/Lekki -> Lagos,
  Benin City -> Edo, Onitsha/Nnewi -> Anambra, Kano -> Kano, Ibadan -> Oyo, Enugu -> Enugu,
  Port Harcourt -> Rivers, Jos -> Plateau, Kaduna -> Kaduna, Abeokuta -> Ogun.
- Set isConfirmation true only when the message is answering a yes/no question the platform
  asked. "Yes", "na so", "that's right" -> yes. "No", "wrong" -> no.
- Confidence must be honest. When unsure, return a low confidence and let the platform ask.
- Never invent a value to fill a field. An empty string is the correct answer when the vendor
  did not say it.`;
