import { Injectable } from '@nestjs/common';
import { join } from 'node:path';
import { AppConfigService } from '../../config/app-config.service';
import { SchemaRegistry } from '../../platform/contracts/schema-registry';
import { DEFAULT_MODEL_POLICY, type PromptDefinition } from '../../platform/prompt-runtime/prompt-definition';
import {
  PromptExecutor,
  type PromptOutcome,
  type PromptSection,
} from '../../platform/prompt-runtime/prompt-executor';
import { loadPromptFile, PromptRegistry } from '../../platform/prompt-runtime/prompt-registry';
import {
  CONTINUITY_KINDS,
  type ContinuityDecision,
  type ContinuityKind,
} from '../domain/continuity-decision';
import p2Schema from '../schemas/mcos-p2-continuity-1.0.json';
import p3Schema from '../schemas/mcos-p3-action-plan-1.0.json';
import p4Schema from '../schemas/mcos-p4-clarification-1.0.json';
import p5Schema from '../schemas/mcos-p5-response-plan-1.0.json';
import p6Schema from '../schemas/mcos-p6-naturalized-response-1.0.json';

/**
 * The orchestration prompt set P2–P6 (MCOS TDR §34A): versioned, schema-bound, executed through
 * the shared prompt runtime (one bounded repair, typed failures), fed only explicitly labelled
 * DATA sections. The graph decides when each is invoked (§34A.10); a failed prompt is a typed
 * `null` here and a deterministic fallback in the graph (§44), never an inferred decision.
 */

export const P2 = { id: 'mcos.p2.continuity', version: '1.0.0', schemaId: 'mcos-p2-continuity-1.0' } as const;
export const P3 = {
  id: 'mcos.p3.plan-builder',
  version: '1.0.0',
  schemaId: 'mcos-p3-action-plan-1.0',
} as const;
export const P4 = {
  id: 'mcos.p4.clarification',
  version: '1.0.0',
  schemaId: 'mcos-p4-clarification-1.0',
} as const;
export const P5 = {
  id: 'mcos.p5.response-planner',
  version: '1.0.0',
  schemaId: 'mcos-p5-response-plan-1.0',
} as const;
export const P6 = {
  id: 'mcos.p6.naturalizer',
  version: '1.0.0',
  schemaId: 'mcos-p6-naturalized-response-1.0',
} as const;

export interface P4Decision {
  readonly required: boolean;
  readonly targetActionIds: readonly string[];
  readonly question: string | null;
  readonly reason: string;
  readonly expectedResolution: string | null;
}

export interface P5Artifact {
  readonly actionId: string;
  readonly relevance: number;
  readonly priority: number;
  readonly text: string;
  readonly status: 'READY' | 'BLOCKED';
  readonly dependencies: readonly string[];
}

type Wire = Record<string, unknown>;

@Injectable()
export class OrchestrationPrompts {
  private definitions: Record<string, PromptDefinition> | null = null;

  constructor(
    private readonly prompts: PromptRegistry,
    private readonly schemas: SchemaRegistry,
    private readonly executor: PromptExecutor,
    private readonly config: AppConfigService,
  ) {}

  register(): Record<string, PromptDefinition> {
    if (this.definitions !== null) return this.definitions;
    for (const schema of [p2Schema, p3Schema, p4Schema, p5Schema, p6Schema]) {
      this.schemas.register(schema as Record<string, unknown>, { version: '1.0' });
    }
    const model = this.config.specialistModel;
    const define = (
      spec: { id: string; version: string; schemaId: string },
      file: string,
      sections: string[],
      maxOutputTokens: number,
      description: string,
    ): PromptDefinition =>
      this.prompts.register({
        id: spec.id,
        version: spec.version,
        component: 'LANGGRAPH',
        schemaId: spec.schemaId,
        system: loadPromptFile(join(__dirname, '..', 'prompts', file)),
        sections,
        modelPolicy: { ...DEFAULT_MODEL_POLICY, model, maxOutputTokens },
        description,
      });

    this.definitions = {
      [P2.id]: define(
        P2,
        'mcos.p2.continuity.md',
        ['conversation-context', 'workflows', 'semantic-results', 'user-content'],
        600,
        'Relates the logical turn to active and suspended workflows.',
      ),
      [P3.id]: define(
        P3,
        'mcos.p3.plan-builder.md',
        ['system-policy', 'capabilities', 'workflows', 'semantic-results', 'continuity', 'user-content'],
        2_000,
        'Proposes the execution plan for a validated understanding.',
      ),
      [P4.id]: define(
        P4,
        'mcos.p4.clarification.md',
        ['system-policy', 'candidate-issues', 'plan', 'conversation-context', 'user-content'],
        400,
        'Selects and writes at most one clarification question.',
      ),
      [P5.id]: define(
        P5,
        'mcos.p5.response-planner.md',
        ['system-policy', 'action-results', 'pending-clarification', 'user-content'],
        2_000,
        'Orders and trims action results into response artifacts.',
      ),
      [P6.id]: define(
        P6,
        'mcos.p6.naturalizer.md',
        ['channel-profile', 'artifacts', 'conversation-context'],
        1_500,
        'Naturalises ordered artifacts into one user-facing message.',
      ),
    };
    return this.definitions;
  }

  /** P2 — continuity, or null when the prompt failed (caller falls back deterministically). */
  async continuity(sections: readonly PromptSection[]): Promise<ContinuityDecision | null> {
    const outcome = await this.run(
      P2.id,
      sections,
      'Determine how the current logical turn relates to the active and suspended workflows.',
    );
    if (outcome.status !== 'SUCCESS') return null;
    const wire = outcome.data;
    const kinds = new Set<string>(CONTINUITY_KINDS);
    const primary = String(wire.primary_relationship);
    if (!kinds.has(primary)) return null;
    return {
      primary: primary as ContinuityKind,
      relationships: ((wire.turn_relationships as Wire[]) ?? []).map((relationship) => ({
        relationship: String(relationship.relationship) as ContinuityKind,
        intentIds: ((relationship.intent_ids as unknown[]) ?? []).map(String),
        workflowIds: ((relationship.workflow_ids as unknown[]) ?? []).map(String),
      })),
      confidence: Number(wire.confidence ?? 0),
      reason: String(wire.reason ?? ''),
      source: 'P2',
    };
  }

  /** P3 — raw plan wire (validated by the caller against the catalogue), or null. */
  async plan(sections: readonly PromptSection[]): Promise<Wire | null> {
    const outcome = await this.run(
      P3.id,
      sections,
      'Propose the execution plan for this logical turn as schema-valid JSON.',
    );
    return outcome.status === 'SUCCESS' ? outcome.data : null;
  }

  async clarification(sections: readonly PromptSection[]): Promise<P4Decision | null> {
    const outcome = await this.run(
      P4.id,
      sections,
      'Choose at most one clarification question for this logical turn.',
    );
    if (outcome.status !== 'SUCCESS') return null;
    const wire = outcome.data;
    return {
      required: wire.required === true,
      targetActionIds: ((wire.target_action_ids as unknown[]) ?? []).map(String),
      question: (wire.question as string | null) ?? null,
      reason: String(wire.reason ?? ''),
      expectedResolution: (wire.expected_resolution as string | null) ?? null,
    };
  }

  async responsePlan(sections: readonly PromptSection[]): Promise<readonly P5Artifact[] | null> {
    const outcome = await this.run(
      P5.id,
      sections,
      'Build the response plan from the completed action results.',
    );
    if (outcome.status !== 'SUCCESS') return null;
    return ((outcome.data.artifacts as Wire[]) ?? []).map((artifact) => ({
      actionId: String(artifact.action_id),
      relevance: Number(artifact.relevance ?? 0.5),
      priority: Number(artifact.priority ?? 0.5),
      text: String(artifact.text ?? ''),
      status: artifact.status === 'BLOCKED' ? 'BLOCKED' : 'READY',
      dependencies: ((artifact.dependencies as unknown[]) ?? []).map(String),
    }));
  }

  async naturalize(sections: readonly PromptSection[]): Promise<string | null> {
    const outcome = await this.run(
      P6.id,
      sections,
      'Rewrite the ordered artifacts into one natural user-facing message, preserving every fact.',
    );
    if (outcome.status !== 'SUCCESS') return null;
    const message = String(outcome.data.message ?? '').trim();
    return message.length > 0 ? message : null;
  }

  private async run(
    id: string,
    sections: readonly PromptSection[],
    task: string,
  ): Promise<PromptOutcome<Wire>> {
    const definition = this.register()[id]!;
    return this.executor.execute<Wire>({
      definition,
      sections,
      task,
      decisionSummary: (output) => summarizeFor(id, output as Wire),
    });
  }
}

function summarizeFor(id: string, wire: Wire): unknown {
  switch (id) {
    case P2.id:
      return {
        primary_relationship: wire.primary_relationship,
        confidence: wire.confidence,
        relationships: ((wire.turn_relationships as unknown[]) ?? []).length,
      };
    case P3.id:
      return {
        status: wire.status,
        actions: ((wire.actions as Wire[]) ?? []).map((action) => ({
          action_id: action.action_id,
          intent_id: action.intent_id,
          workflow_type: action.workflow_type,
          operation: action.operation,
          status: action.status,
          dependencies: action.dependencies,
        })),
      };
    case P4.id:
      return { required: wire.required, target_action_ids: wire.target_action_ids, question: wire.question };
    case P5.id:
      return {
        artifacts: ((wire.artifacts as Wire[]) ?? []).map((artifact) => ({
          action_id: artifact.action_id,
          priority: artifact.priority,
          status: artifact.status,
          chars: String(artifact.text ?? '').length,
        })),
      };
    case P6.id:
      return { chars: String(wire.message ?? '').length };
    default:
      return null;
  }
}
