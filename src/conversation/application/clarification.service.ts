import { Inject, Injectable } from '@nestjs/common';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import {
  CLOCK,
  type ClockPort,
  ID_GENERATOR,
  type IdGeneratorPort,
} from '../../domain/ports/outbound/system.port';
import type { LogicalTurn } from '../domain/logical-turn';
import type { PendingClarification } from '../domain/pending-clarification';
import {
  ActiveClarificationExistsError,
  CLARIFICATION_REPOSITORY,
  type ClarificationRepositoryPort,
} from '../ports/clarification.repository.port';

const COMPONENT = 'MCOS';
const STAGE = 'Clarification';

/** How many times the same issue may be asked about before the orchestrator must stop (MCOS §25A.4). */
const MAX_ASKS_PER_ISSUE = 1;

export interface AskClarificationInput {
  readonly conversationId: string;
  readonly originatingTurnId: string;
  readonly question: string;
  readonly targetActionIds: readonly string[];
  readonly targetIntentIds: readonly string[];
  readonly blocking: boolean;
  readonly expectedResolution: string | null;
  readonly contextSnapshotId: string | null;
  readonly issueKey: string | null;
  readonly ttlMs: number | null;
}

export type AskClarificationResult =
  | { readonly outcome: 'CREATED'; readonly clarification: PendingClarification }
  | { readonly outcome: 'ALREADY_ACTIVE'; readonly clarification: PendingClarification }
  | { readonly outcome: 'LOOP_PREVENTED'; readonly previous: PendingClarification };

/**
 * Durable clarification lifecycle owned by MCOS (MCOS TDR §25A).
 *
 * Specialists recommend, LangGraph gates, MCOS persists and delivers. This service is the
 * persistence side: it mints the stable `clarificationId` before any delivery, enforces the
 * one-active-question invariant, binds the next turn to the open question, and refuses to ask
 * materially the same thing twice.
 */
@Injectable()
export class ClarificationService {
  constructor(
    @Inject(CLARIFICATION_REPOSITORY) private readonly clarifications: ClarificationRepositoryPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGeneratorPort,
  ) {}

  async ask(input: AskClarificationInput): Promise<AskClarificationResult> {
    if (input.issueKey !== null) {
      const history = await this.clarifications.historyForIssue(
        input.conversationId,
        input.issueKey,
        MAX_ASKS_PER_ISSUE,
      );
      const previous = history[0];
      if (previous !== undefined && history.length >= MAX_ASKS_PER_ISSUE) {
        this.logger.stage({
          component: COMPONENT,
          stage: STAGE,
          input: { conversationId: input.conversationId, issueKey: input.issueKey },
          action: 'Refused to ask about an issue the user was already asked about (no clarification loops)',
          output: { previousClarificationId: previous.clarificationId, previousStatus: previous.status },
        });
        return { outcome: 'LOOP_PREVENTED', previous };
      }
    }

    const askedAt = this.clock.now();
    try {
      const clarification = await this.clarifications.create({
        clarificationId: this.ids.uuid(),
        conversationId: input.conversationId,
        originatingTurnId: input.originatingTurnId,
        question: input.question,
        targetActionIds: input.targetActionIds,
        targetIntentIds: input.targetIntentIds,
        blocking: input.blocking,
        askedAt,
        expiresAt: input.ttlMs === null ? null : new Date(askedAt.getTime() + input.ttlMs),
        expectedResolution: input.expectedResolution,
        contextSnapshotId: input.contextSnapshotId,
        issueKey: input.issueKey,
      });
      return { outcome: 'CREATED', clarification };
    } catch (error) {
      if (error instanceof ActiveClarificationExistsError) {
        const active = await this.clarifications.findActive(input.conversationId);
        if (active !== null) return { outcome: 'ALREADY_ACTIVE', clarification: active };
      }
      throw error;
    }
  }

  /**
   * Binds a sealed turn to the conversation's open question (MCOS §25A.3). Deterministic: when
   * exactly one question is waiting, the next logical turn is its answer candidate. LangGraph
   * decides whether the answer actually resolves the issue.
   */
  async bindAnswer(turn: LogicalTurn): Promise<PendingClarification | null> {
    const active = await this.clarifications.findActive(turn.conversationId);
    if (active === null) return null;

    const updated = await this.clarifications.transition({
      clarificationId: active.clarificationId,
      expectedVersion: active.version,
      to: 'ANSWER_RECEIVED',
      at: this.clock.now(),
      answerMessageIds: turn.messageIds,
      answerTurnId: turn.turnId,
    });

    if (updated !== null) {
      this.logger.stage({
        component: COMPONENT,
        stage: STAGE,
        input: { clarificationId: active.clarificationId, turnId: turn.turnId },
        action: 'Bound the new logical turn to the pending clarification as its answer',
        output: { status: updated.status },
      });
    }

    return updated ?? active;
  }

  async resolve(clarification: PendingClarification): Promise<PendingClarification | null> {
    return this.clarifications.transition({
      clarificationId: clarification.clarificationId,
      expectedVersion: clarification.version,
      to: 'RESOLVED',
      at: this.clock.now(),
    });
  }

  /** The answer did not resolve the issue; the question stays open, attempt count incremented. */
  async reopen(clarification: PendingClarification): Promise<PendingClarification | null> {
    return this.clarifications.transition({
      clarificationId: clarification.clarificationId,
      expectedVersion: clarification.version,
      to: 'WAITING_FOR_USER',
      at: this.clock.now(),
    });
  }

  async supersede(clarification: PendingClarification): Promise<PendingClarification | null> {
    return this.clarifications.transition({
      clarificationId: clarification.clarificationId,
      expectedVersion: clarification.version,
      to: 'SUPERSEDED',
      at: this.clock.now(),
    });
  }

  findActive(conversationId: string): Promise<PendingClarification | null> {
    return this.clarifications.findActive(conversationId);
  }
}
