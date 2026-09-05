import { Inject, Injectable } from '@nestjs/common';
import type { Conversation } from '../../domain/models/conversation';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { segmentationJsonSchema, segmentationSchema } from './schemas';

const COMPONENT = 'MCOS';
const STAGE = 'UtteranceSegmentation';

/**
 * Upper bound on segments per turn.
 *
 * Three is already an unusual message. Without a cap, one runaway split would multiply every
 * downstream stage — continuity, intent, routing, execution — by however many parts the model
 * invented, and answer a single message with a wall of text.
 */
const MAX_SEGMENTS = 3;

/**
 * Length below which a message is assumed to carry one request.
 *
 * Short replies are the overwhelming majority of turns in a WhatsApp trade conversation — "yes",
 * "Aba", "KYB", "how much?" — and none of them can carry two objectives.
 */
const SHORT_MESSAGE_CHARS = 48;

/**
 * Markers that a message may carry more than one request.
 *
 * Sentence terminators, and the connectives traders actually use to bolt a second request onto
 * the first. Deliberately over-inclusive: a false positive costs one LLM call that returns a
 * single segment, while a false negative silently drops half of what the user asked for.
 */
const MULTI_REQUEST_MARKERS =
  /[.?!;]|\b(also|and also|by the way|another thing|plus|then again|meanwhile|abeg also|one more)\b/i;

export interface UtteranceSegment {
  /** Text this segment contributes, self-contained enough to route on its own. */
  readonly text: string;
  readonly summary: string;
  /** Position in the original message, so replies can be composed in the order asked. */
  readonly index: number;
}

/**
 * Splits a message into the objectives it carries (Conversation-Core-Comparison TDR §4.5).
 *
 * This is the stage the platform was missing. Everything downstream — continuity, intent,
 * routing — was already capable of handling two objectives; it was only ever handed one.
 *
 * The deterministic fast path matters as much as the LLM one. Most turns are a short answer to
 * a question the platform just asked, and spending a model call to be told "one segment" would
 * add latency and cost to the most common case in the product.
 */
@Injectable()
export class UtteranceSegmentationService {
  constructor(
    @Inject(LLM_PROVIDER_SERVICE) private readonly llm: LlmService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  async segment(params: {
    conversation: Conversation;
    text: string;
    /** A tapped button is one objective by construction, so segmentation is skipped. */
    interactivePayload: string | null;
  }): Promise<readonly UtteranceSegment[]> {
    const startedAt = Date.now();
    const text = params.text.trim();

    const whole: readonly UtteranceSegment[] = [{ text, summary: text.slice(0, 40), index: 0 }];

    const skipReason = this.reasonToSkip(text, params.interactivePayload);

    if (skipReason !== null) {
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { message: text },
        action: `Treated the message as a single request without an LLM call: ${skipReason}`,
        output: { segments: 1 },
        durationMs: Date.now() - startedAt,
      });

      return whole;
    }

    try {
      const result = await this.llm.complete(
        {
          operation: 'utterance_segmentation',
          schemaName: 'UtteranceSegmentation',
          schema: segmentationJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: this.buildPrompt(params.conversation, text) },
          ],
        },
        (value) => segmentationSchema.parse(value),
      );

      const segments = result.data.segments
        .map((segment, index) => ({
          text: segment.text.trim(),
          summary: segment.summary.trim(),
          index,
        }))
        .filter((segment) => segment.text.length > 0)
        .slice(0, MAX_SEGMENTS);

      // A split that produced nothing usable is worse than no split: fall back to the whole
      // message rather than dropping the turn.
      if (segments.length === 0) return whole;

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { message: text },
        action:
          segments.length === 1
            ? `Confirmed a single request via ${result.provider}`
            : `Split the message into ${segments.length} requests via ${result.provider}`,
        output: { segments: segments.map((segment) => segment.summary), reasoning: result.data.reasoning },
        durationMs: Date.now() - startedAt,
      });

      return segments;
    } catch (error) {
      // Segmentation is an enhancement, not a gate. Degrading to one segment is exactly the
      // behaviour the platform had before this stage existed, which is a safe floor.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { message: text },
        action: 'Segmentation failed; treating the message as a single request',
        error,
        durationMs: Date.now() - startedAt,
      });

      return whole;
    }
  }

  /** Why this message needs no model call, or null when it must be examined. */
  private reasonToSkip(text: string, interactivePayload: string | null): string | null {
    if (interactivePayload !== null) return 'the user tapped an action, which names one objective';
    if (text.length === 0) return 'the message carries no readable text';
    if (text.length <= SHORT_MESSAGE_CHARS && !MULTI_REQUEST_MARKERS.test(text)) {
      return 'the message is short and carries no marker of a second request';
    }
    if (!MULTI_REQUEST_MARKERS.test(text)) return 'the message carries no marker of a second request';

    return null;
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
      'MESSAGE TO SPLIT:',
      text,
    ].join('\n');
  }
}

const SYSTEM_PROMPT = `You split a single marketplace message into the separate requests it contains. Users are buyers and sellers in informal African markets, writing on WhatsApp in mixed English, Nigerian Pidgin and local terms.

You do NOT decide what the user wants — a later step does that. You only decide how many distinct requests the message carries, and which words belong to each.

Rules:
- Most messages carry exactly ONE request. Return one segment unless a second is clearly present.
- Split when the user answers a pending question AND raises something new: "Yes, KYB. Also who sells engine oil near Alaba?" is two segments — "Yes, KYB" and "who sells engine oil near Alaba?".
- Split when two unrelated requests are bolted together: "add brake pads to my shop and how much do you charge?".
- Do NOT split a single request that merely lists several items: "I sell brake pads, shock absorbers and engine oil" is ONE segment.
- Do NOT split a request from its own qualifiers: "I need engine oil, the 5 litre one, urgently" is ONE segment.
- Do NOT split politeness, greetings or filler into their own segment. Attach them to the request they accompany, or drop them.
- Keep the user's own words. Rewrite only as much as a part needs to stand alone — usually nothing.
- Preserve the order the user said things.
- Never invent a request the user did not make. Two segments where there was one is as damaging as one where there were two.`;
