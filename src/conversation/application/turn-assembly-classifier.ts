import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import { DEFAULT_MODEL_POLICY, type PromptDefinition } from '../../platform/prompt-runtime/prompt-definition';
import { PromptExecutor } from '../../platform/prompt-runtime/prompt-executor';
import { loadPromptFile, PromptRegistry } from '../../platform/prompt-runtime/prompt-registry';
import p1Schema from '../schemas/mcos-p1-turn-assembly-1.0.json';

/**
 * P1 — bounded model-assisted turn-boundary classifier (MCOS TDR §34A.2, §5A.6).
 *
 * Consulted only when deterministic signals are inconclusive and the classifier is enabled by
 * configuration. Its output is a typed recommendation; durable turn state is mutated only by the
 * repository's compare-and-set protocol. A failed or low-confidence classification never becomes
 * a silent decision: the caller falls back to the deterministic default.
 */

export const P1_PROMPT_ID = 'mcos.p1.turn-assembly';
export const P1_PROMPT_VERSION = '1.0.0';
export const P1_SCHEMA_ID = 'mcos-p1-turn-assembly-1.0';

export interface P1Decision {
  readonly decision: 'SAME_TURN' | 'NEW_TURN';
  readonly confidence: number;
  readonly reason: string;
  readonly relationship: 'CONTINUATION' | 'CORRECTION' | 'CANCELLATION' | 'TOPIC_SWITCH' | 'NONE';
}

const MIN_CONFIDENCE = 0.6;

@Injectable()
export class TurnAssemblyClassifier {
  private definition: PromptDefinition | null = null;

  constructor(
    private readonly prompts: PromptRegistry,
    private readonly schemas: SchemaRegistry,
    private readonly executor: PromptExecutor,
  ) {}

  /** Registers the P1 contract; idempotent so tests and modules can call it freely. */
  register(): PromptDefinition {
    if (this.definition !== null) return this.definition;
    this.schemas.register(p1Schema as Record<string, unknown>, { version: '1.0' });
    this.definition = this.prompts.register({
      id: P1_PROMPT_ID,
      version: P1_PROMPT_VERSION,
      component: 'MCOS',
      schemaId: P1_SCHEMA_ID,
      system: loadPromptFile(join(__dirname, '..', 'prompts', 'mcos.p1.turn-assembly.md')),
      sections: ['conversation-context', 'unsealed-messages', 'user-content'],
      modelPolicy: { ...DEFAULT_MODEL_POLICY, maxOutputTokens: 200 },
      description: 'Decides whether a new transport message joins the currently open logical turn.',
    });
    return this.definition;
  }

  /**
   * Returns the classifier's decision when it is confident, or null when the caller should use
   * the deterministic default (MCOS §5A.3.3 step 6 applies to *its* confidence, not to outages).
   */
  async classify(params: {
    readonly unsealedMessages: readonly string[];
    readonly newMessage: string;
    readonly channel: string;
    readonly activeWorkflowTypes: readonly string[];
  }): Promise<P1Decision | null> {
    const definition = this.register();

    const outcome = await this.executor.execute<P1Decision>({
      definition,
      sections: [
        {
          name: 'conversation-context',
          content: { channel: params.channel, active_workflows: params.activeWorkflowTypes },
        },
        { name: 'unsealed-messages', content: params.unsealedMessages },
        { name: 'user-content', content: params.newMessage },
      ],
      task: 'Decide whether the newest message belongs to the same logical turn as the unsealed messages.',
      decisionSummary: (output) => {
        const decision = output as P1Decision;
        return {
          decision: decision.decision,
          relationship: decision.relationship,
          confidence: decision.confidence,
        };
      },
    });

    if (outcome.status !== 'SUCCESS') return null;
    if (outcome.data.confidence < MIN_CONFIDENCE) return null;
    return outcome.data;
  }
}
