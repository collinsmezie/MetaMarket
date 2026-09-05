import type { Artifact } from '../../models/artifact';
import type { IncomingMessage } from '../../models/incoming-message';
import type { Response } from '../../models/response';

/**
 * The conversation core: what turns a message into a reply.
 *
 * This port exists because there are two implementations under comparison
 * (Conversation-Core-Comparison TDR §6) — MCOS's own deterministic pipeline, and a LangGraph
 * supervisor graph. Everything on either side of it is shared: channel adapters, ingestion,
 * the conversation lock, persistence, capability services, outbound delivery.
 *
 * Drawing the seam here is what makes the comparison honest. The two cores are swapped by one
 * binding in the composition root, so a difference in behaviour cannot come from a difference
 * in how messages arrive or how replies are sent.
 */

export const CONVERSATION_CORE = Symbol('ConversationCore');

export interface ConversationTurnInput {
  readonly message: IncomingMessage;
  readonly artifacts: readonly Artifact[];
  /** Flattened text for this turn; empty when the message carried no readable content. */
  readonly text: string;
  /** Payload from a tapped button or selected list row, when the turn was interactive. */
  readonly interactivePayload: string | null;
}

export interface ConversationTurnResult {
  readonly response: Response;
  /** The workflow that owned the turn, or null when no workflow did. */
  readonly workflowId: string | null;
}

export interface ConversationCorePort {
  /**
   * Runs one turn end to end, including delivering the reply.
   *
   * Called with the conversation lock already held, so an implementation may assume it is the
   * only writer for this conversation.
   */
  handleTurn(input: ConversationTurnInput): Promise<ConversationTurnResult>;

  /**
   * Delivers a response outside the turn flow — when the lock could not be taken, and the user
   * still has to be told something.
   */
  deliver(message: IncomingMessage, response: Response, workflowId: string | null): Promise<void>;
}
