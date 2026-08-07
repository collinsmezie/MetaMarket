import { Inject, Injectable } from '@nestjs/common';
import type { Conversation } from '../../domain/models/conversation';
import type { ConversationRelationship } from '../../domain/models/understanding';
import { NEW_CONVERSATION_RELATIONSHIP } from '../../domain/models/understanding';
import { canResume } from '../../domain/models/workflow-instance';
import { LLM_PROVIDER_SERVICE, type LlmService } from '../../domain/ports/outbound/llm-provider.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { decodeActionPayload } from '../../domain/workflows/action-payload';
import { resolveSystemAction } from '../../domain/workflows/system-actions';
import { continuityJsonSchema, continuitySchema } from './schemas';

const COMPONENT = 'MCOS';
const STAGE = 'ConversationContinuityAnalyzer';

/**
 * Determines how an incoming message relates to what came before (MCOS §5.4).
 *
 * Explicitly not intent classification. The cheap deterministic cases — no open workflows,
 * or a tapped button that names its workflow — are answered without an LLM call, both
 * because they are free and because they are exactly right.
 */
@Injectable()
export class ConversationContinuityAnalyzer {
  constructor(
    @Inject(LLM_PROVIDER_SERVICE) private readonly llm: LlmService,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
  ) {}

  async analyze(params: {
    conversation: Conversation;
    text: string;
    interactivePayload: string | null;
    now: Date;
  }): Promise<ConversationRelationship> {
    const startedAt = Date.now();
    const open = params.conversation.workflowRegistry.workflowInstances.filter((instance) =>
      canResume(instance, params.now),
    );

    const deterministic = this.resolveDeterministically(params.interactivePayload, open.length);

    if (deterministic !== null) {
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: {
          openWorkflows: open.length,
          hasInteractivePayload: params.interactivePayload !== null,
          message: params.text,
        },
        action: 'Resolved the relationship deterministically without an LLM call',
        output: deterministic,
        durationMs: Date.now() - startedAt,
      });
      return deterministic;
    }

    try {
      const result = await this.llm.complete(
        {
          operation: 'continuity_analysis',
          schemaName: 'ConversationRelationship',
          schema: continuityJsonSchema,
          temperature: 0,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: this.buildPrompt(params.conversation, params.text, open),
            },
          ],
        },
        (value) => continuitySchema.parse(value),
      );

      // Only ids that correspond to genuinely resumable workflows may pass through; a model
      // that invents or resurrects an id must not steer routing.
      const validIds = new Set(open.map((instance) => instance.id));
      const candidateWorkflowIds = result.data.candidateWorkflowIds.filter((id) => validIds.has(id));

      const relationship: ConversationRelationship = {
        relationship: result.data.relationship,
        confidence: result.data.confidence,
        candidateWorkflowIds,
        reasoning: result.data.reasoning,
      };

      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { openWorkflows: open.length, message: params.text },
        action: `Classified the message relationship via ${result.provider}`,
        output: relationship,
        durationMs: Date.now() - startedAt,
      });

      return relationship;
    } catch (error) {
      // Continuity is an optimisation, not a gate: treating an unclassifiable message as a
      // continuation of the single open workflow (or as new) keeps the turn moving.
      const fallback: ConversationRelationship =
        open.length === 1
          ? {
              relationship: 'continuation',
              confidence: 0.4,
              candidateWorkflowIds: [open[0].id],
              reasoning: 'Continuity analysis failed; defaulting to the only open workflow.',
            }
          : { ...NEW_CONVERSATION_RELATIONSHIP, confidence: 0.4 };

      this.logger.stageFailed({
        component: COMPONENT,
        stage: STAGE,
        input: { openWorkflows: open.length, message: params.text },
        action: `Continuity analysis failed; degrading to "${fallback.relationship}"`,
        error,
        durationMs: Date.now() - startedAt,
      });

      return fallback;
    }
  }

  /**
   * Handles the cases that need no reasoning at all.
   *
   * A tapped button carries the workflow it belongs to, and a conversation with nothing
   * open can only be starting something new.
   */
  private resolveDeterministically(
    interactivePayload: string | null,
    openCount: number,
  ): ConversationRelationship | null {
    // A system action names no instance, so it cannot be a continuation of one. Reading it as
    // one would send the turn looking for a workflow called "system", find none, and either
    // hijack an unrelated open workflow or fall through to the generic fallback envelope
    // (Konnet Credits Recharge TDR §25.7).
    if (resolveSystemAction(interactivePayload) !== null) {
      return {
        relationship: 'new',
        confidence: 1,
        candidateWorkflowIds: [],
        reasoning: 'The user tapped a platform-level action, which starts a new objective.',
      };
    }

    if (interactivePayload !== null) {
      const decoded = decodeActionPayload(interactivePayload);
      if (decoded !== null) {
        return {
          relationship: 'continuation',
          confidence: 1,
          candidateWorkflowIds: [decoded.workflowId],
          reasoning: 'The user tapped an interactive action that names its originating workflow.',
        };
      }
    }

    if (openCount === 0) return NEW_CONVERSATION_RELATIONSHIP;

    return null;
  }

  private buildPrompt(
    conversation: Conversation,
    text: string,
    open: readonly { id: string; workflowType: string; currentState: string; summary: string }[],
  ): string {
    const workflows = open
      .map(
        (instance, index) =>
          `${index + 1}. id=${instance.id}\n   type=${instance.workflowType}\n   state=${instance.currentState}\n   summary=${instance.summary || '(none yet)'}`,
      )
      .join('\n');

    const history = conversation.history
      .slice(-6)
      .map((entry) => `${entry.role}: ${entry.content}`)
      .join('\n');

    return [
      'OPEN WORKFLOWS:',
      workflows,
      '',
      'RECENT CONVERSATION:',
      history.length > 0 ? history : '(no prior turns)',
      '',
      'NEW MESSAGE:',
      text,
    ].join('\n');
  }
}

const SYSTEM_PROMPT = `You classify how a new message relates to an ongoing conversation in a marketplace assistant used by traders and buyers, often over WhatsApp.

You do NOT classify what the user wants (that is a separate step). You only decide the RELATIONSHIP:

- continuation: carries on the topic of an open workflow
- clarification: answers a clarifying question the assistant asked
- answer: supplies a specific value the assistant requested (a location, a name)
- correction: corrects something previously said ("no, I meant diesel")
- topic_shift: raises a different objective while a workflow is open
- resume: explicitly returns to an earlier workflow ("about that hammer")
- cancel: abandons a workflow ("forget it", "cancel")
- restart: wants to begin a workflow again from the start
- new: unrelated to any open workflow

Rules:
- Only return ids from the OPEN WORKFLOWS list. Never invent an id.
- Users write informally, in mixed English/Pidgin, with typos. Judge meaning, not grammar.
- A short reply like "yes", "Aba" or "the second one" is almost always an answer or clarification, not a new topic.
- If genuinely torn between two open workflows, list both ids so the platform can ask.
- Set confidence honestly. Low confidence is more useful than a confident guess.`;
