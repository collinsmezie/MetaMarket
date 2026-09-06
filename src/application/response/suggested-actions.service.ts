import { Inject, Injectable } from '@nestjs/common';
import type { Conversation } from '../../domain/models/conversation';
import type { Action, Response } from '../../domain/models/response';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { encodeReplayPayload } from '../../domain/workflows/action-payload';
import { suggestedActionsJsonSchema, suggestedActionsSchema } from '../understanding/schemas';

const COMPONENT = 'MCOS';
const STAGE = 'SuggestedActions';

/**
 * Ceiling on suggested options.
 *
 * Four is what a WhatsApp list message can show without scrolling and more than a person wants
 * to weigh mid-conversation. A menu is not help.
 */
const MAX_OPTIONS = 4;

/** WhatsApp rejects button titles over 20 characters outright. */
const MAX_LABEL_CHARS = 20;

/**
 * Offers the user their likely next steps as tappable options.
 *
 * Deliberately additive and deliberately powerless. A workflow that already declares its own
 * actions is left alone — those carry workflow ids and resume deterministically, and second
 * -guessing them with model output would replace a certainty with a guess. Where a reply offers
 * nothing, these are appended, and each one is only words: tapping it replays the label as user
 * text through the ordinary pipeline (MCOS §15), so the model cannot invent an option the
 * platform is unable to route.
 *
 * Failure is silent by design. A reply without options is the product as it was last week; a
 * turn that fails because the option generator was unavailable is a regression.
 */
@Injectable()
export class SuggestedActionsService {
  constructor(
    @Inject(LLM_PROVIDER_SERVICE) private readonly llm: LlmService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  async augment(params: {
    conversation: Conversation;
    response: Response;
    /** The user's message this reply answers, for context the history may not have yet. */
    userText: string;
  }): Promise<Response> {
    const { response } = params;

    // A workflow that offered its own affordances has said what the user may do next, with
    // payloads that route home exactly. Nothing to add.
    if (response.actions !== undefined && response.actions.length > 0) return response;

    const text = response.text?.trim() ?? '';
    if (text.length === 0) return response;

    const startedAt = Date.now();

    try {
      const result = await this.llm.complete(
        {
          operation: 'suggested_actions',
          schemaName: 'SuggestedActions',
          schema: suggestedActionsJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: this.buildPrompt(params.conversation, params.userText, text) },
          ],
        },
        (value) => suggestedActionsSchema.parse(value),
      );

      const actions = this.toActions(result.data.options);

      if (actions.length === 0) return response;

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { reply: text.slice(0, 120) },
        action: `Offered ${actions.length} suggested option(s) via ${result.provider}`,
        output: { options: actions.map((option) => option.title) },
        durationMs: Date.now() - startedAt,
      });

      return { ...response, actions };
    } catch (error) {
      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { reply: text.slice(0, 120) },
        action: 'Could not generate suggested options; sending the reply without them',
        error,
        durationMs: Date.now() - startedAt,
      });

      return response;
    }
  }

  private toActions(options: readonly { label: string }[]): readonly Action[] {
    const seen = new Set<string>();
    const actions: Action[] = [];

    for (const option of options) {
      const title = option.label.trim().slice(0, MAX_LABEL_CHARS);
      const key = title.toLowerCase();

      // A duplicate label would render as two identical buttons whose payloads collide, and the
      // composer keys actions by payload — so the second would silently replace the first.
      if (title.length === 0 || seen.has(key)) continue;

      seen.add(key);
      actions.push({ type: 'suggestion', title, payload: encodeReplayPayload(title) });

      if (actions.length === MAX_OPTIONS) break;
    }

    return actions;
  }

  private buildPrompt(conversation: Conversation, userText: string, reply: string): string {
    const history = conversation.history
      .slice(-4)
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join('\n');

    return [
      'RECENT CONVERSATION:',
      history.length > 0 ? history : '(no prior turns)',
      '',
      'THE USER JUST SAID:',
      userText,
      '',
      'THE ASSISTANT IS ABOUT TO REPLY:',
      reply,
      '',
      'What are the most likely next things the user will want to say?',
    ].join('\n');
  }
}

const SYSTEM_PROMPT = `You suggest the next things a user is likely to say, so a marketplace assistant can offer them as tappable options. Users are buyers and sellers in informal African markets, on WhatsApp and the web, writing in mixed English and Nigerian Pidgin.

Return the options as the USER would say them, not as instructions to the user. "Yes" not "Confirm your answer". "Show more sellers" not "The user wants more sellers".

Rules:
- At most 4 options. Fewer is better. Return NONE when the reply needs no options.
- Each label must be at most 20 characters.
- If the assistant asked a yes/no question, offer "Yes" and "No".
- If the assistant asked an open question with likely answers, offer the two or three most likely — for a location, real nearby places; for a category, real options.
- Always offer a way out when the user is mid-task: "Cancel".
- Never offer an option that contradicts the reply, and never invent a fact. If the assistant did not mention delivery, do not offer "Arrange delivery".
- Never offer something the user has already answered in the recent conversation.
- Do not offer options for a reply that is purely informational and ends the exchange.`;
