import type { Conversation } from '../models/conversation';
import { isContinuing, type ConversationRelationship, type IntentResult } from '../models/understanding';
import type { WorkflowInstance, WorkflowRegistry } from '../models/workflow-instance';
import { canResume, findInstance } from '../models/workflow-instance';
import type { EmbeddingProviderPort } from '../ports/outbound/embedding-provider.port';
import type { StageLoggerPort } from '../ports/outbound/stage-logger.port';
import type { WorkflowRepositoryPort } from '../ports/outbound/workflow-repository.port';
import { decodeActionPayload } from './action-payload';
import { rankByFingerprint } from './fingerprint-matching';
import type { WorkflowDefinitionRegistry } from './workflow-registry';

const COMPONENT = 'MCOS';
const STAGE = 'WorkflowManager';

/**
 * Minimum lexical overlap before a fingerprint match is trusted.
 *
 * Below this the platform prefers asking over guessing, because resuming the wrong
 * workflow is more confusing to a user than one clarifying question.
 */
const MIN_FINGERPRINT_SCORE = 0.5;

/** Minimum cosine similarity for embedding-based discovery (Layer 5). */
const MIN_EMBEDDING_SIMILARITY = 0.82;

/**
 * Gap below which two candidates are considered equally plausible, forcing clarification
 * rather than an arbitrary pick.
 */
const AMBIGUOUS_MARGIN = 0.08;

export type RoutingDecision =
  | { readonly action: 'resume'; readonly instance: WorkflowInstance; readonly via: DiscoveryLayer }
  | { readonly action: 'start'; readonly workflowType: string; readonly suspend: WorkflowInstance | null }
  | { readonly action: 'restart'; readonly instance: WorkflowInstance }
  | { readonly action: 'cancel'; readonly instance: WorkflowInstance }
  | { readonly action: 'clarify'; readonly candidates: readonly WorkflowInstance[] }
  /** Nothing can handle this turn; the caller degrades gracefully. */
  | { readonly action: 'unroutable'; readonly reason: string };

export const DISCOVERY_LAYERS = [
  'explicit_workflow_id',
  'deterministic_identifier',
  'entity_match',
  'semantic_fingerprint',
  'embedding_similarity',
  'active_workflow',
] as const;

export type DiscoveryLayer = (typeof DISCOVERY_LAYERS)[number];

export interface RoutingInput {
  readonly conversation: Conversation;
  readonly relationship: ConversationRelationship;
  readonly intent: IntentResult | null;
  readonly text: string;
  readonly interactivePayload: string | null;
  readonly now: Date;
}

/**
 * Decides *which* workflow should handle a turn (MCOS §5.5).
 *
 * It never executes workflow logic — that is the engine's job. Discovery is layered
 * (MCOS §15) and deliberately never relies on embeddings alone.
 */
export class WorkflowManager {
  constructor(
    private readonly definitions: WorkflowDefinitionRegistry,
    private readonly workflows: WorkflowRepositoryPort,
    private readonly logger: StageLoggerPort,
    /** Absent when no embedding provider is configured; Layer 5 is then skipped. */
    private readonly embeddings: EmbeddingProviderPort | null,
  ) {}

  async route(input: RoutingInput): Promise<RoutingDecision> {
    const registry = input.conversation.workflowRegistry;
    const decision = await this.decide(input, registry);

    this.logger.stage({
      component: COMPONENT,
      stage: STAGE,
      input: {
        relationship: input.relationship.relationship,
        intent: input.intent?.intent ?? null,
        activeWorkflowId: registry.activeWorkflowId,
        registrySize: registry.workflowInstances.length,
      },
      action: this.describeDecision(decision),
      output: decision,
    });

    return decision;
  }

  private describeDecision(decision: RoutingDecision): string {
    switch (decision.action) {
      case 'resume':
        return `Resuming workflow ${decision.instance.id} discovered via ${decision.via}`;
      case 'start':
        return decision.suspend === null
          ? `Starting a new ${decision.workflowType} workflow`
          : `Context drift: suspending ${decision.suspend.id} and starting a new ${decision.workflowType} workflow`;
      case 'restart':
        return `Restarting workflow ${decision.instance.id}`;
      case 'cancel':
        return `Cancelling workflow ${decision.instance.id}`;
      case 'clarify':
        return `Ambiguous between ${decision.candidates.length} workflows; asking the user`;
      case 'unroutable':
        return `Could not route the message: ${decision.reason}`;
    }
  }

  private async decide(input: RoutingInput, registry: WorkflowRegistry): Promise<RoutingDecision> {
    // ── Layer 1: an explicit workflow id echoed back by an interactive reply ──────────
    const explicit = this.resolveExplicit(input.interactivePayload, registry, input.now);
    if (explicit !== null) {
      return { action: 'resume', instance: explicit, via: 'explicit_workflow_id' };
    }

    const relationship = input.relationship.relationship;

    // Cancel and restart are user commands about a specific workflow, so resolve the target
    // first and only then act on it.
    if (relationship === 'cancel' || relationship === 'restart') {
      const target = await this.resolveTarget(input, registry);
      if (target === null) {
        return { action: 'unroutable', reason: `No workflow found to ${relationship}.` };
      }
      return relationship === 'cancel'
        ? { action: 'cancel', instance: target.instance }
        : { action: 'restart', instance: target.instance };
    }

    // Top-level greetings (Hi, Hello, Start, Menu) initiate a fresh Triage flow
    // when relationship is new or topic_shift or no active target is present.
    const isGreeting = /^(hi|hello|hey|good day|good morning|good evening|start|menu)$/i.test(
      input.text.trim(),
    );
    if (
      (isGreeting && relationship !== 'continuation' && relationship !== 'clarification') ||
      relationship === 'new' ||
      relationship === 'topic_shift'
    ) {
      return this.startNew(input, registry);
    }

    // Continuation, clarification, answer, correction, resume: find the workflow this
    // message belongs to.
    const target = await this.resolveTarget(input, registry);
    if (target !== null) {
      return { action: 'resume', instance: target.instance, via: target.via };
    }

    if (target === null && input.relationship.candidateWorkflowIds.length > 1) {
      const candidates = input.relationship.candidateWorkflowIds
        .map((id) => findInstance(registry, id))
        .filter((instance): instance is WorkflowInstance => instance !== undefined);

      if (candidates.length > 1) return { action: 'clarify', candidates };
    }

    // The continuity analyzer expected an existing workflow but none is resumable — treat
    // the message as a fresh objective rather than dropping it.
    return this.startNew(input, registry);
  }

  private resolveExplicit(
    interactivePayload: string | null,
    registry: WorkflowRegistry,
    now: Date,
  ): WorkflowInstance | null {
    if (interactivePayload === null) return null;

    const decoded = decodeActionPayload(interactivePayload);
    if (decoded === null) return null;

    const instance = findInstance(registry, decoded.workflowId);
    if (instance === undefined) return null;

    // A tap on a stale button (expired or completed workflow) must not silently resurrect it.
    return canResume(instance, now) ? instance : null;
  }

  /** Runs discovery layers 2–5, then falls back to the active workflow. */
  private async resolveTarget(
    input: RoutingInput,
    registry: WorkflowRegistry,
  ): Promise<{ instance: WorkflowInstance; via: DiscoveryLayer } | null> {
    const resumable = registry.workflowInstances.filter((instance) => canResume(instance, input.now));
    if (resumable.length === 0) return null;

    // ── Candidate Workflow IDs specified by continuity analysis ──────────────────────
    for (const candidateId of input.relationship.candidateWorkflowIds) {
      const candidate = findInstance(registry, candidateId);
      if (candidate !== undefined && canResume(candidate, input.now)) {
        return { instance: candidate, via: 'active_workflow' };
      }
    }

    // ── Layer 2: deterministic identifiers the user quoted (order id, request id) ─────
    const byIdentifier = await this.resolveByDeterministicIdentifier(input, resumable);
    if (byIdentifier !== null) return { instance: byIdentifier, via: 'deterministic_identifier' };

    // ── Layer 3: entity match against what each workflow is tracking ──────────────────
    const byEntity = this.resolveByEntity(input, resumable);
    if (byEntity !== null) return { instance: byEntity, via: 'entity_match' };

    // A single resumable workflow that the analyzer already pointed at needs no scoring.
    if (resumable.length === 1 && input.relationship.candidateWorkflowIds.length <= 1) {
      return { instance: resumable[0], via: 'active_workflow' };
    }

    // ── Layer 4: lexical semantic fingerprint ─────────────────────────────────────────
    const fingerprintMatches = rankByFingerprint(input.text, resumable, MIN_FINGERPRINT_SCORE);
    if (fingerprintMatches.length > 0) {
      const [best, runnerUp] = fingerprintMatches;
      const decisive = runnerUp === undefined || best.score - runnerUp.score > AMBIGUOUS_MARGIN;
      if (decisive) {
        const instance = findInstance(registry, best.workflowId);
        if (instance !== undefined) return { instance, via: 'semantic_fingerprint' };
      }
    }

    // ── Layer 5: embedding similarity ─────────────────────────────────────────────────
    const byEmbedding = await this.resolveByEmbedding(input, registry);
    if (byEmbedding !== null) return { instance: byEmbedding, via: 'embedding_similarity' };

    // Fall back to whatever is in focus when the analyzer read this as a continuing turn.
    const active = registry.activeWorkflowId;
    if (active !== null && isContinuing(input.relationship.relationship)) {
      const instance = findInstance(registry, active);
      if (instance !== undefined && canResume(instance, input.now)) {
        return { instance, via: 'active_workflow' };
      }
    }

    return null;
  }

  private async resolveByDeterministicIdentifier(
    input: RoutingInput,
    resumable: readonly WorkflowInstance[],
  ): Promise<WorkflowInstance | null> {
    const entities = input.intent?.entities ?? {};

    for (const [key, rawValue] of Object.entries(entities)) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];

      for (const value of values) {
        if (typeof value !== 'string' || value.length === 0) continue;

        const matches = await this.workflows.findByImportantEntity(input.conversation.id, key, value);

        const resumableMatch = matches.find((match) =>
          resumable.some((candidate) => candidate.id === match.id),
        );

        if (resumableMatch !== undefined) return resumableMatch;
      }
    }

    return null;
  }

  private resolveByEntity(
    input: RoutingInput,
    resumable: readonly WorkflowInstance[],
  ): WorkflowInstance | null {
    const entities = input.intent?.entities ?? {};
    const values = Object.values(entities)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((value) => value.toLowerCase());

    if (values.length === 0) return null;

    const matches = resumable.filter((instance) =>
      Object.values(instance.importantEntities).some((tracked) => values.includes(tracked.toLowerCase())),
    );

    // Only decisive when exactly one workflow claims the entity.
    return matches.length === 1 ? matches[0] : null;
  }

  private async resolveByEmbedding(
    input: RoutingInput,
    registry: WorkflowRegistry,
  ): Promise<WorkflowInstance | null> {
    if (this.embeddings === null) return null;
    if (input.text.trim().length === 0) return null;

    let matches;
    try {
      const embedding = await this.embeddings.embed(input.text);
      matches = await this.workflows.findSimilarByEmbedding({
        conversationId: input.conversation.id,
        embedding,
        limit: 3,
        minSimilarity: MIN_EMBEDDING_SIMILARITY,
      });
    } catch (error) {
      // Discovery must survive an embedding outage: degrade to the remaining layers.
      this.logger.stageFailed({
        component: COMPONENT,
        stage: `${STAGE}:EmbeddingSimilarity`,
        input: { conversationId: input.conversation.id },
        action: 'Embedding-based workflow discovery failed; falling back to remaining layers',
        error,
      });
      return null;
    }

    if (matches.length === 0) return null;

    const [best, runnerUp] = matches;
    if (runnerUp !== undefined && best.similarity - runnerUp.similarity <= AMBIGUOUS_MARGIN) {
      return null;
    }

    const instance = findInstance(registry, best.workflowId);
    if (instance === undefined || !canResume(instance, input.now)) return null;

    return instance;
  }

  /**
   * Chooses a workflow type for a new objective and decides whether the workflow currently
   * in focus must be suspended first (MCOS §16 — never destroy unfinished work).
   */
  private startNew(input: RoutingInput, registry: WorkflowRegistry): RoutingDecision {
    const intent = input.intent?.intent;
    const isGreeting = /^(hi|hello|hey|good day|good morning|good evening|start|menu)$/i.test(
      input.text.trim(),
    );

    let workflowType = intent !== undefined ? this.definitions.resolveByIntent(intent) : null;
    if (workflowType === null) {
      if (isGreeting || intent === undefined || intent === 'unknown') {
        workflowType = this.definitions.has('Triage') ? 'Triage' : null;
      }
    }

    if (workflowType === null) {
      return { action: 'unroutable', reason: `No workflow registered for intent: ${intent}` };
    }

    const active =
      registry.activeWorkflowId === null ? null : (findInstance(registry, registry.activeWorkflowId) ?? null);

    const suspend =
      active !== null && canResume(active, input.now) && active.status === 'active' ? active : null;

    return { action: 'start', workflowType, suspend };
  }
}
