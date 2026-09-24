import { Inject, Injectable } from '@nestjs/common';
import type { RunnableConfig } from '@langchain/core/runnables';
import { AppConfigService } from '../../config/app-config.service';
import { ConversationDelivery } from '../../application/response/conversation-delivery.service';
import { ClarificationService } from '../../conversation/application/clarification.service';
import type { ConversationWorkingContext, TurnInputState } from '../../conversation/domain/turn-context';
import type { Conversation } from '../../domain/models/conversation';
import { FALLBACK_ENVELOPE, fallbackWithReason, type Response } from '../../domain/models/response';
import {
  OUTBOUND_MESSAGE_REPOSITORY,
  type OutboundMessageRepositoryPort,
} from '../../domain/ports/outbound/outbound-message-repository.port';
import { STAGE_LOGGER, type StageLoggerPort } from '../../domain/ports/outbound/stage-logger.port';
import { CLOCK, type ClockPort } from '../../domain/ports/outbound/system.port';
import {
  decodeActionPayload,
  decodeReplayPayload,
  encodeActionPayload,
} from '../../domain/workflows/action-payload';
import { resolveSystemAction } from '../../domain/workflows/system-actions';
import { WorkflowDefinitionRegistry } from '../../domain/workflows/workflow-registry';
import { IdceSpecialistAdapter } from '../../intent/application/idce-specialist.adapter';
import type { DiscoveredIntent } from '../../intent/domain/idce-resolution';
import { RequestContextStore } from '../../platform/correlation/request-context';
import { TRACE_RECORDER, type TraceRecorderPort } from '../../platform/observability/trace.port';
import { componentVersion } from '../../platform/registry/component-registry';
import { CsreSpecialistAdapter } from '../../semantics/application/csre-specialist.adapter';
import { EnrichmentAdapter } from '../../enrichment/application/enrichment.adapter';
import type { DownstreamPurpose, EnrichmentResolution } from '../../enrichment/domain/enrichment-resolution';
import { GpcResolverAdapter } from '../../taxonomy/application/gpc-resolver.adapter';
import type { GpcResolution } from '../../taxonomy/domain/gpc-mapping';
import type { SpecialistResponseEnvelope } from '../../platform/contracts/specialist-envelope';
import type { SemanticObject } from '../../semantics/domain/csre-resolution';
import {
  EMPTY_PLAN,
  planFromWire,
  validatePlan,
  type ActionExecutionResult,
  type ExecutionPlanState,
  type ExecutionState,
  type PlannedAction,
  type ResponseArtifact,
} from '../domain/action-plan';
import {
  CONTROL_INTENTS,
  PLATFORM_REPLY_INTENTS,
  capabilityForWorkflowType,
  describeCatalogue,
} from '../domain/capability-catalogue';
import { decision, deterministicContinuity, type ContinuityDecision } from '../domain/continuity-decision';
import {
  buildDeterministicPlan,
  canPlanDeterministically,
  type PlannerInput,
} from '../domain/deterministic-planner';
import {
  artifactFromResponse,
  artifactsFromResult,
  composeArtifacts,
  isDeliverable,
  orderArtifacts,
} from '../domain/response-plan';
import { isPlanSettled, nextBatch } from '../domain/scheduler-policy';
import {
  bindObjectsToIntents,
  collectUnresolvedIssues,
  type UnresolvedIssue,
} from '../domain/unified-understanding';
import { FAST_PATH, type FastPathPort } from '../ports/fast-path.port';
import { WORKFLOW_EXECUTION, type WorkflowExecutionPort } from '../ports/workflow-execution.port';
import {
  NO_FAST_PATH,
  RUN_CONTEXT_KEY,
  type ClarificationState,
  type ConversationGraphStateType as State,
  type ConversationGraphUpdate as Update,
  type SpecialistSlot,
} from './graph/conversation-graph.state';
import { OrchestrationPrompts } from './orchestration-prompts';

const COMPONENT = 'LANGGRAPH';
/** Locked business policy: a pending question stays answerable as long as a request stays open. */
const CLARIFICATION_TTL_MS = 48 * 60 * 60 * 1_000;
/** How long commit waits for background enrichment before leaving it to finish detached. */
const ENRICHMENT_SETTLE_MS = 20_000;
const GREETING_REPLY =
  'Hello! Welcome to MetaMarket. I connect you with trusted sellers across Nigeria.\n\nTell me what you\'re looking to buy, or say "I sell …" to list your business so buyers can find you.';
const THANKS_REPLY = "You're welcome! Let me know whenever you need to find something or list your business.";

/** Per-run objects that must not enter checkpointed state (MCOS §7.1 "non-serializable runtime objects"). */
export interface RunContext {
  readonly input: TurnInputState;
  readonly context: ConversationWorkingContext;
  readonly conversation: Conversation;
  readonly now: Date;
  /** Enrichment started after the understanding join (MCOS §38); awaited per taxonomy policy. */
  enrichment?: Promise<SpecialistResponseEnvelope<EnrichmentResolution> | null>;
  /** GPC mapping chained after enrichment (MCOS §38, §63.4): the downstream semantic chain. */
  gpc?: Promise<SpecialistResponseEnvelope<GpcResolution> | null>;
}

/**
 * Node handlers of the conversation orchestrator graph (MCOS TDR §10–§11).
 *
 * Every node is traced as a step of the turn's run (§49), returns a plain state update, and
 * mutates business state only through the workflow execution port (§22, §63.5). Model prompts
 * are invoked only where §34A.10 says they are needed; every one has a deterministic fallback
 * (§44).
 */
@Injectable()
export class ConversationGraphNodes {
  private readonly runs = new Map<string, RunContext>();

  constructor(
    private readonly idce: IdceSpecialistAdapter,
    private readonly csre: CsreSpecialistAdapter,
    private readonly enrichmentAdapter: EnrichmentAdapter,
    private readonly gpcAdapter: GpcResolverAdapter,
    private readonly prompts: OrchestrationPrompts,
    private readonly clarifications: ClarificationService,
    private readonly delivery: ConversationDelivery,
    private readonly definitions: WorkflowDefinitionRegistry,
    private readonly config: AppConfigService,
    @Inject(WORKFLOW_EXECUTION) private readonly workflows: WorkflowExecutionPort,
    @Inject(FAST_PATH) private readonly fastPathPort: FastPathPort,
    @Inject(OUTBOUND_MESSAGE_REPOSITORY) private readonly outbound: OutboundMessageRepositoryPort,
    @Inject(TRACE_RECORDER) private readonly traces: TraceRecorderPort,
    @Inject(STAGE_LOGGER) private readonly logger: StageLoggerPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  registerRun(key: string, run: RunContext): void {
    this.runs.set(key, run);
  }

  releaseRun(key: string): void {
    this.runs.delete(key);
  }

  private run(config: RunnableConfig): RunContext {
    const key = config.configurable?.[RUN_CONTEXT_KEY] as string | undefined;
    const run = key === undefined ? undefined : this.runs.get(key);
    if (run === undefined) throw new Error('Graph node invoked without its run context');
    return run;
  }

  // ── Nodes ────────────────────────────────────────────────────────────────────────────────────

  /** Resolves what the user effectively said: replayed suggestion labels and numbered option picks. */
  async ingest(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('ingest', state, async () => {
      const run = this.run(config);
      const payload =
        [...run.input.currentMessages].reverse().find((message) => message.interactivePayload !== null)
          ?.interactivePayload ?? null;
      let text = run.input.assembledText.trim();
      let effectivePayload = payload;

      const replayed = payload === null ? null : decodeReplayPayload(payload);
      if (replayed !== null) {
        if (text.length === 0) text = replayed;
        effectivePayload = null;
      }

      if (/^\d{1,2}[.)]?$/.test(text)) {
        const index = Number.parseInt(text, 10) - 1;
        const last = await this.outbound.latestForConversation(run.input.conversationId).catch(() => null);
        const option = (last?.response.actions ?? [])[index];
        if (option !== undefined) text = option.title;
      }

      return { update: { effectiveText: text, effectivePayload }, decision: { text, effectivePayload } };
    });
  }

  /** Deterministic fast paths (§30, §34A.10): empty input, vendor RFQ replies, tapped workflow/system actions. */
  async fastPath(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('fastPath', state, async () => {
      const run = this.run(config);
      const text = state.effectiveText;
      const payload = state.effectivePayload;

      if (text.length === 0 && payload === null) {
        return {
          update: {
            fastPath: { ...NO_FAST_PATH, kind: 'EMPTY_INPUT' },
            artifacts: [artifactFromResponse('fallback', fallbackWithReason('no_readable_content'), 0.5)],
            response: { composed: null, delivered: false, source: 'FALLBACK' },
          },
          decision: { kind: 'EMPTY_INPUT' },
        };
      }

      const vendorReply = await this.fastPathPort.tryHandle({
        conversationId: run.input.conversationId,
        userId: run.input.userId,
        text,
        interactivePayload: payload,
      });
      if (vendorReply !== null) {
        return {
          update: {
            fastPath: { ...NO_FAST_PATH, kind: 'VENDOR_RESPONSE' },
            response: { composed: vendorReply, delivered: false, source: 'FAST_PATH' },
          },
          decision: { kind: 'VENDOR_RESPONSE' },
        };
      }

      const system = resolveSystemAction(payload);
      if (system !== null) {
        const workflowType = this.definitions.resolveByIntent(system.intent);
        return {
          update: {
            fastPath: {
              kind: 'SYSTEM_ACTION',
              workflowId: null,
              workflowType,
              action: system.action,
              legacyIntent: system.intent,
            },
          },
          decision: { kind: 'SYSTEM_ACTION', action: system.action, workflowType },
        };
      }

      const decoded = payload === null ? null : decodeActionPayload(payload);
      if (decoded !== null) {
        const target = [...run.context.activeWorkflows, ...run.context.suspendedWorkflows].find(
          (workflow) => workflow.workflowId === decoded.workflowId && workflow.resumable,
        );
        if (target !== undefined) {
          return {
            update: {
              fastPath: {
                kind: 'WORKFLOW_ACTION',
                workflowId: target.workflowId,
                workflowType: target.workflowType,
                action: decoded.action,
                legacyIntent: null,
              },
            },
            decision: { kind: 'WORKFLOW_ACTION', workflowId: target.workflowId, action: decoded.action },
          };
        }
      }

      return { update: { fastPath: NO_FAST_PATH }, decision: { kind: 'NONE' } };
    });
  }

  async idceNode(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('idce', state, async () => {
      const run = this.run(config);
      const slot = await this.specialist(() => this.idce.discover(run.input, run.context));
      return {
        update: { idce: slot },
        decision: {
          status: slot.status,
          requestId: slot.requestId,
          intents: slot.output?.intents.map((intent) => intent.type) ?? [],
        },
      };
    });
  }

  async csreNode(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('csre', state, async () => {
      const run = this.run(config);
      const slot = await this.specialist(() => this.csre.resolve(run.input, run.context));
      return {
        update: { csre: slot },
        decision: {
          status: slot.status,
          requestId: slot.requestId,
          objects: slot.output?.objects.map((object) => object.canonicalForm) ?? [],
        },
      };
    });
  }

  /** §13 understanding join: continuity (deterministic or P2), reference bindings, unresolved issues. */
  async joinUnderstanding(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('joinUnderstanding', state, async () => {
      const run = this.run(config);
      const idce = state.idce.output;
      const csre = state.csre.output;
      const intents = idce?.intents ?? [];
      const objects = csre?.objects ?? [];
      const bindings = bindObjectsToIntents(intents, objects);

      const pending = run.context.pendingClarification;
      const answering =
        pending !== null &&
        pending.originatingTurnId !== run.input.turnId &&
        (pending.status === 'WAITING_FOR_USER' || pending.status === 'ANSWER_RECEIVED');

      const workflows = {
        active: run.context.activeWorkflows.map((workflow) => ({
          workflowId: workflow.workflowId,
          workflowType: workflow.workflowType,
          status: workflow.status,
          resumable: workflow.resumable,
        })),
        suspended: run.context.suspendedWorkflows.map((workflow) => ({
          workflowId: workflow.workflowId,
          workflowType: workflow.workflowType,
          status: workflow.status,
          resumable: workflow.resumable,
        })),
      };

      let continuity: ContinuityDecision | null = deterministicContinuity({
        ...workflows,
        intents: intents.map((intent) => ({
          intentId: intent.intentId,
          type: intent.type,
          workflowIds: intent.scope.workflowIds,
        })),
        answeringClarification: answering,
        explicitWorkflowId: null,
      });
      if (continuity === null) {
        continuity =
          (await this.prompts.continuity([
            {
              name: 'conversation-context',
              content: {
                recent_messages: run.context.recentMessages.slice(-8),
                previous_turn_summary: run.context.previousTurnSummary,
                pending_clarification:
                  pending === null ? null : { question: pending.question, status: pending.status },
              },
            },
            { name: 'workflows', content: workflows },
            {
              name: 'semantic-results',
              content: { intents: intents.map(intentView), objects: objects.map(objectView) },
            },
            { name: 'user-content', content: state.effectiveText },
          ])) ??
          decision(
            'NEW_WORKFLOW',
            [
              {
                relationship: 'NEW_WORKFLOW',
                intentIds: intents.map((intent) => intent.intentId),
                workflowIds: [],
              },
            ],
            0.5,
            'P2 unavailable; deterministic default',
            'DETERMINISTIC',
          );
      }

      let resolvedPrevious = false;
      if (answering && pending !== null) {
        await this.clarifications.resolve(pending).catch((error: unknown) =>
          this.logger.stageFailed({
            component: COMPONENT,
            stage: 'joinUnderstanding',
            input: { clarificationId: pending.clarificationId },
            action: 'Could not mark the answered clarification resolved',
            error,
          }),
        );
        resolvedPrevious = true;
      }

      const unresolved = collectUnresolvedIssues(idce, csre, bindings);
      const ready = idce !== null;

      // MCOS §38 / Enrichment §29.6: enrichment runs downstream of CSRE, in parallel with
      // planning and execution; the taxonomy policy of the planned capabilities decides whether
      // anything waits for it (final lock: MarketConcept-first discovery never blocks on GPC).
      const commercialObjects = objects.filter(
        (object) => object.commercialInterpretation.relevance !== 'NON_COMMERCIAL',
      );
      if (csre !== null && state.csre.requestId !== null && commercialObjects.length > 0 && ready) {
        const csreRequestId = state.csre.requestId;
        run.enrichment = this.enrichmentAdapter
          .enrich(run.input, csre, csreRequestId, purposeFor(intents))
          .catch((error: unknown) => {
            this.logger.stageFailed({
              component: COMPONENT,
              stage: 'enrichment',
              input: { turnId: run.input.turnId },
              action: 'Enrichment threw; turn continues without it',
              error,
            });
            return null;
          });
        // §63.4: the GPC Resolver receives the same object_id and exact semantic_origin, augmented
        // by the enrichment profile when it succeeded; a failed enrichment does not block mapping.
        run.gpc = run.enrichment
          .then((enriched) =>
            this.gpcAdapter.resolve(
              run.input,
              csre,
              csreRequestId,
              enriched !== null && enriched.status !== 'ERROR' && enriched.output !== null
                ? { requestId: enriched.requestId, resolution: enriched.output }
                : null,
            ),
          )
          .catch((error: unknown) => {
            this.logger.stageFailed({
              component: COMPONENT,
              stage: 'gpc',
              input: { turnId: run.input.turnId },
              action: 'GPC resolution threw; turn continues without it',
              error,
            });
            return null;
          });
      }
      return {
        update: {
          understanding: {
            idce,
            csre,
            idceRequestId: state.idce.requestId,
            csreRequestId: state.csre.requestId,
            idceError: state.idce.error,
            csreError: state.csre.error,
            continuity,
            bindings,
            unresolved,
            ready,
          },
          clarification: { ...NOT_NEEDED, resolvedPrevious },
        },
        decision: {
          ready,
          continuity: continuity.primary,
          continuity_source: continuity.source,
          bindings: bindings.map((binding) => ({
            intent: binding.intentId,
            objects: binding.objectIds,
            via: binding.via,
          })),
          unresolved: unresolved.map((issue) => issue.issueKey),
          answering,
        },
      };
    });
  }

  /** Understanding failed outright: one honest fallback, no guessed routing (§44, §63.6). */
  async triage(state: State): Promise<Update> {
    return this.step('triage', state, async () => {
      const reason = state.understanding.idceError?.code ?? 'understanding_failed';
      return {
        update: {
          artifacts: [artifactFromResponse('fallback', fallbackWithReason(reason), 0.5)],
          response: { composed: null, delivered: false, source: 'FALLBACK' },
          recovery: [
            ...state.recovery,
            {
              node: 'triage',
              code: reason,
              message: state.understanding.idceError?.message ?? 'IDCE returned no resolution',
            },
          ],
          lifecycle: { status: 'FAILED', nodes: [] },
        },
        decision: { reason },
      };
    });
  }

  /** §16 planning: fast-path plan, deterministic plan, or P3 validated against the catalogue. */
  async plan(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('plan', state, async () => {
      const run = this.run(config);
      const available = new Set(this.definitions.allTypes());
      const conversationId = run.input.conversationId;

      if (state.fastPath.kind === 'SYSTEM_ACTION' || state.fastPath.kind === 'WORKFLOW_ACTION') {
        const workflowType = state.fastPath.workflowType;
        const workflowId = state.fastPath.workflowId;
        const capability = workflowType === null ? null : capabilityForWorkflowType(workflowType);
        const plan: ExecutionPlanState = {
          actions:
            workflowType === null || capability === null
              ? []
              : [
                  {
                    actionId: 'a1',
                    intentId: 'fast-path',
                    workflowType,
                    operation: state.fastPath.kind === 'SYSTEM_ACTION' ? 'START' : 'CONTINUE',
                    scope: {
                      type: 'WORKFLOW',
                      objectIds: [],
                      workflowIds: workflowId === null ? [] : [workflowId],
                    },
                    dependencies: [],
                    concurrencyKey: `conversation:${conversationId}`,
                    stateConflictKeys: [
                      ...capability.conflictKeys({ conversationId, userId: run.input.userId, workflowId }),
                    ],
                    prerequisites: [],
                    priority: 1,
                    status: 'READY',
                    needsUser: false,
                  },
                ],
          edges: [],
          status: 'READY',
          source: 'FAST_PATH',
        };
        return { update: { plan }, decision: planSummary(plan) };
      }

      const understanding = state.understanding;
      const intents = understanding.idce?.intents ?? [];
      const needsUserIntentIds = new Set(
        understanding.unresolved
          .filter((issue) => issue.blocking && issue.kind !== 'UNSUPPORTED')
          .flatMap((issue) => issue.targetIntentIds),
      );
      const plannerInput: PlannerInput = {
        conversationId,
        userId: run.input.userId,
        intents,
        bindings: understanding.bindings,
        continuity: understanding.continuity,
        activeWorkflows: run.context.activeWorkflows,
        suspendedWorkflows: run.context.suspendedWorkflows,
        availableWorkflowTypes: available,
        needsUserIntentIds,
      };

      if (canPlanDeterministically(plannerInput)) {
        const plan = buildDeterministicPlan(plannerInput);
        return { update: { plan }, decision: planSummary(plan) };
      }

      const wire = await this.prompts.plan([
        {
          name: 'system-policy',
          content: {
            conversation_id: conversationId,
            user_id: run.input.userId,
            needs_user_intent_ids: [...needsUserIntentIds],
          },
        },
        {
          name: 'capabilities',
          content: describeCatalogue().filter((capability) =>
            available.has(String(capability.workflow_type)),
          ),
        },
        {
          name: 'workflows',
          content: { active: run.context.activeWorkflows, suspended: run.context.suspendedWorkflows },
        },
        {
          name: 'semantic-results',
          content: {
            intents: intents.map(intentView),
            objects: (understanding.csre?.objects ?? []).map(objectView),
            bindings: understanding.bindings,
            unresolved: understanding.unresolved,
          },
        },
        { name: 'continuity', content: understanding.continuity },
        { name: 'user-content', content: state.effectiveText },
      ]);
      if (wire !== null) {
        const proposed = planFromWire(wire, 'P3');
        const violations = validatePlan(
          proposed,
          new Set(intents.map((intent) => intent.intentId)),
          available,
        );
        if (violations.length === 0) {
          const plan = withConflictKeys(proposed, conversationId, run.input.userId);
          return { update: { plan }, decision: planSummary(plan) };
        }
        this.logger.stageFailed({
          component: COMPONENT,
          stage: 'plan',
          input: { violations: violations.slice(0, 5) },
          action: 'P3 plan failed deterministic validation; falling back to the deterministic planner',
          error: new Error('P3_PLAN_INVALID'),
        });
      }
      const plan = buildDeterministicPlan(plannerInput);
      return {
        update: { plan },
        decision: { ...(planSummary(plan) as Record<string, unknown>), fallback: true },
      };
    });
  }

  /** §25, §25A.1: at most one high-information question per turn; unrelated work still runs. */
  async clarifyGate(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('clarifyGate', state, async () => {
      const run = this.run(config);
      const base = state.clarification ?? NOT_NEEDED;
      const issues = state.understanding.unresolved.filter((issue) => issue.kind !== 'UNSUPPORTED');
      const needsUser = state.plan.actions.filter((action) => action.status === 'NEEDS_USER');
      if (issues.length === 0 && needsUser.length === 0) {
        return {
          update: { clarification: { ...base, outcome: 'NOT_NEEDED' } },
          decision: { outcome: 'NOT_NEEDED' },
        };
      }

      const candidates = [...issues].sort((a, b) => Number(b.blocking) - Number(a.blocking));
      const actionsFor = (issue: UnresolvedIssue) =>
        state.plan.actions
          .filter((action) => issue.targetIntentIds.includes(action.intentId))
          .map((action) => action.actionId);

      let chosen: {
        question: string;
        issue: UnresolvedIssue;
        targetActionIds: string[];
        expectedResolution: string | null;
        source: ClarificationState['source'];
      } | null = null;
      const withQuestion = candidates.filter((candidate) => candidate.question !== null);
      if (candidates.length === 1 && withQuestion.length === 1) {
        const issue = withQuestion[0]!;
        chosen = {
          question: issue.question!,
          issue,
          targetActionIds: actionsFor(issue),
          expectedResolution: issue.description,
          source: issue.source === 'CSRE' ? 'CSRE' : 'IDCE',
        };
      } else if (candidates.length > 0) {
        const selected = await this.prompts.clarification([
          { name: 'system-policy', content: { one_question_rule: true, channel: run.input.channel } },
          {
            name: 'candidate-issues',
            content: candidates.map((issue) => ({
              issue_key: issue.issueKey,
              source: issue.source,
              kind: issue.kind,
              description: issue.description,
              suggested_question: issue.question,
              target_action_ids: actionsFor(issue),
              blocking: issue.blocking,
            })),
          },
          {
            name: 'plan',
            content: state.plan.actions.map((action) => ({
              action_id: action.actionId,
              workflow_type: action.workflowType,
              operation: action.operation,
              status: action.status,
            })),
          },
          {
            name: 'conversation-context',
            content: {
              recent_messages: run.context.recentMessages.slice(-6),
              known_locations: run.context.locations,
            },
          },
          { name: 'user-content', content: state.effectiveText },
        ]);
        if (selected !== null && selected.required && selected.question !== null) {
          const issue =
            candidates.find((candidate) =>
              actionsFor(candidate).some((id) => selected.targetActionIds.includes(id)),
            ) ?? candidates[0]!;
          chosen = {
            question: selected.question,
            issue,
            targetActionIds:
              selected.targetActionIds.length > 0 ? [...selected.targetActionIds] : actionsFor(issue),
            expectedResolution: selected.expectedResolution,
            source: 'P4',
          };
        } else if (selected === null && withQuestion.length > 0) {
          const issue = withQuestion[0]!;
          chosen = {
            question: issue.question!,
            issue,
            targetActionIds: actionsFor(issue),
            expectedResolution: issue.description,
            source: issue.source === 'CSRE' ? 'CSRE' : 'IDCE',
          };
        }
      }

      if (chosen === null) {
        return {
          update: { clarification: { ...base, outcome: 'DECLINED' }, plan: releaseNeedsUser(state.plan) },
          decision: { outcome: 'DECLINED', candidates: candidates.length },
        };
      }

      const asked = await this.clarifications.ask({
        conversationId: run.input.conversationId,
        originatingTurnId: run.input.turnId,
        question: chosen.question,
        targetActionIds: chosen.targetActionIds,
        targetIntentIds: chosen.issue.targetIntentIds,
        blocking: chosen.issue.blocking,
        expectedResolution: chosen.expectedResolution,
        contextSnapshotId: run.input.contextSnapshotId,
        issueKey: chosen.issue.issueKey,
        ttlMs: CLARIFICATION_TTL_MS,
      });

      if (asked.outcome === 'LOOP_PREVENTED') {
        return {
          update: {
            clarification: {
              ...base,
              outcome: 'LOOP_PREVENTED',
              issueKey: chosen.issue.issueKey,
              source: chosen.source,
            },
            plan: releaseNeedsUser(state.plan),
          },
          decision: { outcome: 'LOOP_PREVENTED', issueKey: chosen.issue.issueKey },
        };
      }

      const clarification: ClarificationState = {
        ...base,
        clarificationId: asked.clarification.clarificationId,
        question: asked.clarification.question,
        issueKey: chosen.issue.issueKey,
        targetActionIds: chosen.targetActionIds,
        targetIntentIds: chosen.issue.targetIntentIds,
        blocking: chosen.issue.blocking,
        outcome: asked.outcome === 'CREATED' ? 'ASKED' : 'ALREADY_ACTIVE',
        source: chosen.source,
      };
      // Actions the question targets wait for the user; everything else still runs (§25A.2).
      const plan: ExecutionPlanState = {
        ...state.plan,
        actions: state.plan.actions.map((action) =>
          chosen!.targetActionIds.includes(action.actionId) || action.status === 'NEEDS_USER'
            ? { ...action, status: 'NEEDS_USER', needsUser: true }
            : action,
        ),
      };
      const artifacts =
        asked.outcome === 'CREATED'
          ? [
              ...state.artifacts,
              {
                actionId: 'clarification',
                relevance: 1,
                priority: 0.3,
                text: asked.clarification.question,
                actions: [],
                media: undefined,
                metadata: { clarificationId: asked.clarification.clarificationId, clarification: true },
                audience: 'USER' as const,
                dependencies: [],
                status: 'READY' as const,
              },
            ]
          : state.artifacts;
      return {
        update: { clarification, plan, artifacts },
        decision: {
          outcome: clarification.outcome,
          question: clarification.question,
          targetActionIds: chosen.targetActionIds,
          source: chosen.source,
        },
      };
    });
  }

  /** §17 scheduler step: the next batch of independent, non-conflicting READY actions. */
  async schedule(state: State): Promise<Update> {
    return this.step('schedule', state, async () => {
      const step = nextBatch(state.plan.actions, state.plan.edges, state.execution);
      const skippedResults: ActionExecutionResult[] = step.skipped.map((entry) => ({
        actionId: entry.action.actionId,
        status: 'SKIPPED',
        businessStateChanged: false,
        workflowId: null,
        workflowType: entry.action.workflowType,
        responseArtifacts: [],
        emittedEventTypes: [],
        evidenceReferences: [],
        blockingIssues: [{ code: 'SKIPPED', message: entry.reason, issueKey: null }],
        suspendedWorkflowIds: [],
        error: null,
      }));
      const execution: ExecutionState = {
        ...state.execution,
        runningActionIds: step.batch.map((action) => action.actionId),
        skippedActionIds: [
          ...state.execution.skippedActionIds,
          ...step.skipped.map((entry) => entry.action.actionId),
        ],
        results: [...state.execution.results, ...skippedResults],
      };
      return {
        update: {
          execution,
          plan: { ...state.plan, status: step.batch.length > 0 ? 'RUNNING' : state.plan.status },
        },
        decision: {
          batch: step.batch.map((action) => action.actionId),
          skipped: step.skipped.map((entry) => ({ action: entry.action.actionId, reason: entry.reason })),
        },
      };
    });
  }

  /** Executes the scheduled batch through the workflow boundary (§22); partial failure stays partial (§24). */
  async execute(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('execute', state, async () => {
      const run = this.run(config);
      // Taxonomy blocking policy (final lock): only a REQUIRED capability waits for enrichment.
      if (
        run.enrichment !== undefined &&
        state.plan.actions.some(
          (action) =>
            state.execution.runningActionIds.includes(action.actionId) &&
            action.workflowType !== null &&
            capabilityForWorkflowType(action.workflowType)?.taxonomyPolicy === 'REQUIRED',
        )
      ) {
        await run.enrichment;
        await run.gpc;
      }
      const running = state.plan.actions.filter((action) =>
        state.execution.runningActionIds.includes(action.actionId),
      );
      const intents = state.understanding.idce?.intents ?? [];
      const objects = state.understanding.csre?.objects ?? [];
      const answering = state.clarification?.resolvedPrevious === true;

      const results = await Promise.all(
        running.map((action) =>
          this.workflows.execute({
            action,
            turn: run.input,
            context: run.context,
            text: actionText(action, state, intents, objects),
            interactivePayload: state.effectivePayload,
            intents,
            objects,
            continuity: state.understanding.continuity,
            answeringClarification: answering,
            legacyIntentOverride:
              state.fastPath.kind === 'SYSTEM_ACTION' && action.actionId === 'a1'
                ? state.fastPath.legacyIntent
                : null,
            now: this.clock.now(),
          }),
        ),
      );

      const primaryIntentId = intents.find((intent) => intent.role === 'PRIMARY')?.intentId ?? null;
      const newArtifacts: ResponseArtifact[] = results.flatMap((result) => {
        const action = running.find((candidate) => candidate.actionId === result.actionId) ?? null;
        return artifactsFromResult(result, action, action?.intentId === primaryIntentId);
      });

      const execution: ExecutionState = {
        completedActionIds: [
          ...state.execution.completedActionIds,
          ...results
            .filter(
              (result) =>
                result.status === 'SUCCESS' || result.status === 'PARTIAL' || result.status === 'NEEDS_USER',
            )
            .map((result) => result.actionId),
        ],
        failedActionIds: [
          ...state.execution.failedActionIds,
          ...results
            .filter((result) => result.status === 'FAILED' || result.status === 'BLOCKED')
            .map((result) => result.actionId),
        ],
        skippedActionIds: state.execution.skippedActionIds,
        runningActionIds: [],
        results: [...state.execution.results, ...results],
      };
      const settled = isPlanSettled(state.plan.actions, execution);
      return {
        update: {
          execution,
          artifacts: [...state.artifacts, ...newArtifacts],
          plan: {
            ...state.plan,
            status: settled
              ? execution.failedActionIds.length === 0
                ? 'COMPLETED'
                : execution.completedActionIds.length > 0
                  ? 'PARTIAL'
                  : 'FAILED'
              : 'RUNNING',
          },
        },
        decision: {
          results: results.map((result) => ({
            action: result.actionId,
            status: result.status,
            workflowId: result.workflowId,
            workflowType: result.workflowType,
            artifacts: result.responseArtifacts.length,
          })),
          settled,
        },
      };
    });
  }

  /** §27–§28 response planning: platform replies, fallback, ordering; P5 for multi-result turns. */
  async responsePlan(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('responsePlan', state, async () => {
      const run = this.run(config);
      if (state.response.source === 'FAST_PATH') return { update: {}, decision: { source: 'FAST_PATH' } };

      const artifacts = [...state.artifacts];
      const intents = state.understanding.idce?.intents ?? [];
      if (state.plan.actions.length === 0 && artifacts.length === 0) {
        const reply = platformReply(intents);
        if (reply !== null) artifacts.push(artifactFromResponse('platform-reply', reply, 0.8));
      }
      if (artifacts.length === 0) {
        artifacts.push(artifactFromResponse('fallback', fallbackWithReason('no_response_produced'), 0.5));
      }

      // §16 suspension over destruction, §28 rule 5: a parked objective gets one unobtrusive way
      // back — deterministic text plus a button whose payload names the instance (Layer 1).
      const parked = [...new Set(state.execution.results.flatMap((result) => result.suspendedWorkflowIds))];
      for (const workflowId of parked) {
        const workflow = [...run.context.activeWorkflows, ...run.context.suspendedWorkflows].find(
          (candidate) => candidate.workflowId === workflowId,
        );
        if (workflow === undefined) continue;
        artifacts.push({
          actionId: `resume-nudge:${workflowId}`,
          relevance: 0.5,
          priority: 0.1,
          text: `I've kept your ${describeWorkflow(workflow.workflowType)} on hold — say *carry on* whenever you want to continue it.`,
          actions: [
            {
              type: 'button',
              title: 'Carry on',
              payload: encodeActionPayload({ workflowId, action: 'resume' }),
            },
          ],
          media: undefined,
          metadata: { resumeNudge: true, workflowId },
          audience: 'USER',
          dependencies: [],
          status: 'READY',
        });
      }

      let ordered = orderArtifacts(artifacts);
      let source: 'DETERMINISTIC' | 'P5_P6' = 'DETERMINISTIC';
      const textual = ordered.filter((artifact) => artifact.text.trim().length > 0);
      if (
        this.config.orchestrator.naturalizeResponses &&
        textual.length >= 2 &&
        state.fastPath.kind === 'NONE'
      ) {
        const planned = await this.prompts.responsePlan([
          {
            name: 'system-policy',
            content: {
              ordering: [
                'primary objective',
                'dependent results',
                'secondary results',
                'limitations',
                'clarification',
                'nudges',
              ],
            },
          },
          {
            name: 'action-results',
            content: ordered.map((artifact) => ({
              action_id: artifact.actionId,
              status: artifact.status,
              priority: artifact.priority,
              text: artifact.text,
              limitation: artifact.metadata.limitation === true,
              clarification: artifact.metadata.clarification === true,
            })),
          },
          {
            name: 'pending-clarification',
            content:
              state.clarification?.outcome === 'ASKED' ? { question: state.clarification.question } : null,
          },
          { name: 'user-content', content: state.effectiveText },
        ]);
        if (planned !== null && planned.length > 0) {
          const byId = new Map(ordered.map((artifact) => [artifact.actionId, artifact]));
          const reordered = planned
            .map((entry) => {
              const original = byId.get(entry.actionId);
              return original === undefined
                ? null
                : {
                    ...original,
                    text: entry.text.trim().length > 0 ? entry.text : original.text,
                    priority: entry.priority,
                    relevance: entry.relevance,
                  };
            })
            .filter((artifact): artifact is ResponseArtifact => artifact !== null);
          // Never drop a result the planner forgot to mention (§34A.6 "never hide a failed action").
          const mentioned = new Set(reordered.map((artifact) => artifact.actionId));
          ordered = [...reordered, ...ordered.filter((artifact) => !mentioned.has(artifact.actionId))];
          source = 'P5_P6';
        }
      }
      return {
        update: {
          artifacts: ordered,
          response: { ...state.response, source: state.response.source === 'FALLBACK' ? 'FALLBACK' : source },
        },
        decision: {
          artifacts: ordered.map((artifact) => ({
            action: artifact.actionId,
            priority: artifact.priority,
            chars: artifact.text.length,
          })),
          source,
        },
      };
    });
  }

  /** §26A composition: P6 naturalisation for multi-artifact turns, deterministic merge otherwise. */
  async compose(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('compose', state, async () => {
      const run = this.run(config);
      if (state.response.source === 'FAST_PATH' && state.response.composed !== null)
        return { update: {}, decision: { source: 'FAST_PATH' } };

      let text: string | undefined;
      let naturalizationRejected: string[] | null = null;
      if (state.response.source === 'P5_P6') {
        const message = await this.prompts.naturalize([
          {
            name: 'channel-profile',
            content: {
              channel: run.input.channel,
              max_chars: run.input.channel === 'whatsapp' ? 1_500 : 2_500,
              style: 'natural Nigerian English; Pidgin only if the user used it',
            },
          },
          {
            name: 'artifacts',
            content: state.artifacts.map((artifact) => ({
              action_id: artifact.actionId,
              text: artifact.text,
              limitation: artifact.metadata.limitation === true,
              clarification: artifact.metadata.clarification === true,
            })),
          },
          {
            name: 'conversation-context',
            content: {
              recent_messages: run.context.recentMessages.slice(-4),
              user_text: state.effectiveText,
            },
          },
        ]);
        if (message !== null) {
          const missing = missingFacts(message, state.artifacts);
          if (missing.length === 0) text = message;
          else naturalizationRejected = missing.slice(0, 8);
        }
      }

      const composed = composeArtifacts(state.artifacts, text);
      const workflowId = lastWorkflowId(state.execution.results);
      const response: Response | null = isDeliverable(composed)
        ? {
            ...composed,
            metadata: {
              ...composed.metadata,
              ...(workflowId !== null ? { workflowId } : {}),
              orchestrator: `langgraph-${componentVersion('LANGGRAPH')}`,
              turnId: state.turnId,
              planSource: state.plan.source,
              responseSource:
                text !== undefined
                  ? 'P5_P6'
                  : state.response.source === 'FALLBACK'
                    ? 'FALLBACK'
                    : 'DETERMINISTIC',
            },
          }
        : {
            ...FALLBACK_ENVELOPE,
            metadata: {
              ...FALLBACK_ENVELOPE.metadata,
              reason: 'compose_produced_nothing',
              turnId: state.turnId,
            },
          };

      return {
        update: {
          response: {
            ...state.response,
            composed: response,
            source:
              text !== undefined
                ? 'P5_P6'
                : state.response.source === 'FALLBACK'
                  ? 'FALLBACK'
                  : 'DETERMINISTIC',
          },
        },
        decision: {
          chars: response.text?.length ?? 0,
          actions: response.actions?.length ?? 0,
          naturalized: text !== undefined,
          naturalizationRejected,
        },
      };
    });
  }

  /** §46 durable delivery through the existing outbox path. */
  async deliver(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('deliver', state, async () => {
      const run = this.run(config);
      const response = state.response.composed;
      if (!isDeliverable(response))
        return { update: {}, decision: { delivered: false, reason: 'nothing_to_deliver' } };
      await this.delivery.send(run.conversation, response, lastWorkflowId(state.execution.results));
      return {
        update: { response: { ...state.response, delivered: true } },
        decision: { delivered: true, chars: response.text?.length ?? 0 },
      };
    });
  }

  /** §10 "COMMIT TURN OUTCOME": the durable status MCOS records. */
  async commit(state: State, config: RunnableConfig): Promise<Update> {
    return this.step('commit', state, async () => {
      const run = this.run(config);
      const enrichment = await this.settleEnrichment(run);
      const gpc = await this.settleSlot(run.gpc);
      const results = state.execution.results;
      const failed = results.filter((result) => result.status === 'FAILED').length;
      const succeeded = results.filter(
        (result) => result.status === 'SUCCESS' || result.status === 'PARTIAL',
      ).length;
      let status: State['lifecycle']['status'];
      if (state.lifecycle.status === 'FAILED') status = 'FAILED';
      else if (state.clarification?.outcome === 'ASKED' && state.clarification.blocking)
        status = 'WAITING_USER';
      else if (failed > 0 && succeeded > 0) status = 'PARTIAL';
      else if (failed > 0 && succeeded === 0 && state.plan.actions.length > 0) status = 'FAILED';
      else status = 'COMMITTED';
      return {
        update: { lifecycle: { status, nodes: [] }, enrichment, gpc },
        decision: {
          status,
          failed,
          succeeded,
          delivered: state.response.delivered,
          enrichment: enrichment.status,
          enrichmentRequestId: enrichment.requestId,
          gpc: gpc.status,
          gpcRequestId: gpc.requestId,
          gpcMappings:
            gpc.output?.objects.map(
              (object) =>
                `${object.objectId}=${object.mapping.state}${object.mapping.gpcCode ? `(${object.mapping.gpcCode})` : ''}`,
            ) ?? [],
        },
      };
    });
  }

  /** Generic bounded settle for a downstream specialist promise (see {@link settleEnrichment}). */
  private async settleSlot<T>(
    pending: Promise<SpecialistResponseEnvelope<T> | null> | undefined,
  ): Promise<SpecialistSlot<T>> {
    if (pending === undefined) return { status: 'SKIPPED', output: null, requestId: null, error: null };
    const timeout = new Promise<'TIMEOUT'>((resolve) =>
      setTimeout(() => resolve('TIMEOUT'), ENRICHMENT_SETTLE_MS),
    );
    const settled = await Promise.race([pending, timeout]);
    if (settled === 'TIMEOUT') return { status: 'PENDING', output: null, requestId: null, error: null };
    if (settled === null)
      return {
        status: 'ERROR',
        output: null,
        requestId: null,
        error: { code: 'SPECIALIST_THREW', message: 'Adapter threw' },
      };
    if (settled.status === 'ERROR' || settled.output === null) {
      return {
        status: 'ERROR',
        output: null,
        requestId: settled.requestId,
        error: settled.error ?? { code: 'SPECIALIST_ERROR', message: 'No output' },
      };
    }
    return { status: 'SUCCESS', output: settled.output, requestId: settled.requestId, error: null };
  }

  /** Waits briefly for background enrichment so the turn's trace and state record it; a slow run finishes detached. */
  private async settleEnrichment(run: RunContext): Promise<SpecialistSlot<EnrichmentResolution>> {
    if (run.enrichment === undefined)
      return { status: 'SKIPPED', output: null, requestId: null, error: null };
    const timeout = new Promise<'TIMEOUT'>((resolve) =>
      setTimeout(() => resolve('TIMEOUT'), ENRICHMENT_SETTLE_MS),
    );
    const settled = await Promise.race([run.enrichment, timeout]);
    if (settled === 'TIMEOUT') return { status: 'PENDING', output: null, requestId: null, error: null };
    if (settled === null) {
      return {
        status: 'ERROR',
        output: null,
        requestId: null,
        error: { code: 'ENRICHMENT_THREW', message: 'Enrichment adapter threw' },
      };
    }
    if (settled.status === 'ERROR' || settled.output === null) {
      return {
        status: 'ERROR',
        output: null,
        requestId: settled.requestId,
        error: settled.error ?? { code: 'ENRICHMENT_ERROR', message: 'No output' },
      };
    }
    return { status: 'SUCCESS', output: settled.output, requestId: settled.requestId, error: null };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────────────────────

  private async specialist<T>(
    invoke: () => Promise<{
      status: string;
      output: T | null;
      requestId: string;
      error: { code: string; message: string } | null;
    }>,
  ): Promise<SpecialistSlot<T>> {
    try {
      const envelope = await invoke();
      if (envelope.status === 'ERROR' || envelope.status === 'BLOCKED' || envelope.output === null) {
        return {
          status: 'ERROR',
          output: null,
          requestId: envelope.requestId,
          error: envelope.error ?? { code: 'SPECIALIST_ERROR', message: 'No output' },
        };
      }
      return {
        status: envelope.status === 'PARTIAL' ? 'PARTIAL' : 'SUCCESS',
        output: envelope.output,
        requestId: envelope.requestId,
        error: null,
      };
    } catch (error) {
      return {
        status: 'ERROR',
        output: null,
        requestId: null,
        error: { code: 'SPECIALIST_THREW', message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  /** Traces one node as a step of the run (§49) and contains its failure (§44). */
  private async step(
    node: string,
    state: State,
    work: () => Promise<{ update: Update; decision: unknown }>,
  ): Promise<Update> {
    const startedAt = this.clock.now();
    const current = RequestContextStore.current();
    // schedule/execute run once per scheduling round; each round is its own step.
    const round = node === 'schedule' || node === 'execute' ? `_r${state.execution.results.length}` : '';
    const requestId = `req_${node}_${state.turnId}${round}`;
    await this.traces.startStep({
      runId: state.runId,
      requestId,
      parentRequestId: current?.requestId ?? null,
      correlationId: current?.correlationId ?? `corr_${state.runId}`,
      conversationId: state.conversationId,
      turnId: state.turnId,
      component: COMPONENT,
      componentVersion: componentVersion('LANGGRAPH'),
      stage: node,
      schemaVersion: null,
      startedAt,
      inputSummary: { node },
    });
    try {
      const { update, decision: summary } = await work();
      await this.traces.finishStep({
        requestId,
        status: 'SUCCESS',
        completedAt: this.clock.now(),
        decision: summary,
        outputSummary: null,
        persistedRecordIds: [],
        promptExecutionIds: [],
        retryCount: 0,
        error: null,
      });
      return update;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.traces.finishStep({
        requestId,
        status: 'ERROR',
        completedAt: this.clock.now(),
        decision: null,
        outputSummary: null,
        persistedRecordIds: [],
        promptExecutionIds: [],
        retryCount: 0,
        error: { code: 'NODE_FAILED', message, retryable: false },
      });
      this.logger.stageFailed({
        component: COMPONENT,
        stage: node,
        input: { turnId: state.turnId },
        action: `Graph node "${node}" threw`,
        error,
      });
      throw error;
    }
  }
}

const NOT_NEEDED: ClarificationState = {
  clarificationId: null,
  question: null,
  issueKey: null,
  targetActionIds: [],
  targetIntentIds: [],
  blocking: false,
  outcome: 'NOT_NEEDED',
  source: 'NONE',
  resolvedPrevious: false,
};

function releaseNeedsUser(plan: ExecutionPlanState): ExecutionPlanState {
  return {
    ...plan,
    actions: plan.actions.map((action) =>
      action.status === 'NEEDS_USER' ? { ...action, status: 'READY', needsUser: false } : action,
    ),
    status: 'READY',
  };
}

function withConflictKeys(
  plan: ExecutionPlanState,
  conversationId: string,
  userId: string,
): ExecutionPlanState {
  return {
    ...plan,
    actions: plan.actions.map((action) => {
      const capability = action.workflowType === null ? null : capabilityForWorkflowType(action.workflowType);
      const declared =
        capability === null
          ? []
          : capability.conflictKeys({
              conversationId,
              userId,
              workflowId: action.scope.workflowIds[0] ?? null,
            });
      return { ...action, stateConflictKeys: [...new Set([...action.stateConflictKeys, ...declared])] };
    }),
  };
}

function planSummary(plan: ExecutionPlanState): unknown {
  return {
    source: plan.source,
    status: plan.status,
    actions: plan.actions.map((action) => ({
      action: action.actionId,
      intent: action.intentId,
      workflow: action.workflowType,
      operation: action.operation,
      status: action.status,
      dependencies: action.dependencies,
      objects: action.scope.objectIds,
      workflows: action.scope.workflowIds,
    })),
  };
}

/**
 * Action-scoped text (§56 phase 5: segments become trace metadata). A single action gets the
 * user's words verbatim; in a multi-action turn each START action gets its own objects (with
 * brand) plus a location constraint, and continuations get the full text.
 */
function actionText(
  action: PlannedAction,
  state: State,
  intents: readonly DiscoveredIntent[],
  objects: readonly SemanticObject[],
): string {
  if (state.plan.actions.length <= 1 || action.operation !== 'START') return state.effectiveText;
  const bound = objects.filter((object) => action.scope.objectIds.includes(object.objectId));
  if (bound.length === 0) {
    const intent = intents.find((candidate) => candidate.intentId === action.intentId);
    const spans = intent?.sourceSpans.filter((span) => span.trim().length > 0) ?? [];
    return spans.length > 0 ? spans.join(' ') : state.effectiveText;
  }
  const intent = intents.find((candidate) => candidate.intentId === action.intentId);
  const location = intent?.constraints.find(
    (constraint) => constraint.type.toUpperCase() === 'LOCATION' && typeof constraint.value === 'string',
  );
  const names = bound.map((object) =>
    [object.brand, object.canonicalForm]
      .filter((part): part is string => part !== null && part.length > 0)
      .join(' '),
  );
  return `${names.join(', ')}${location ? ` in ${String(location.value)}` : ''}`;
}

/** Enrichment §28.1 downstream purpose from the turn's objectives. */
function purposeFor(intents: readonly DiscoveredIntent[]): DownstreamPurpose {
  const types = new Set<string>(intents.map((intent) => intent.type));
  const vendor = [
    'SELL',
    'OFFER',
    'START_VENDOR_ONBOARDING',
    'CONTINUE_VENDOR_ONBOARDING',
    'UPDATE_INVENTORY',
    'UPDATE_CAPABILITY',
  ];
  const buyer = [
    'BUY',
    'FIND_PRODUCT',
    'FIND_VENDOR',
    'FIND_SERVICE',
    'SEARCH',
    'PRICE_INQUIRY',
    'AVAILABILITY_INQUIRY',
    'REQUEST_QUOTE',
    'COMPARE',
  ];
  if (vendor.some((type) => types.has(type))) return 'CAPABILITY_MATCHING';
  if (buyer.some((type) => types.has(type))) return 'SEMANTIC_SEARCH';
  return 'OTHER';
}

function describeWorkflow(workflowType: string): string {
  switch (workflowType) {
    case 'BuyerSearch':
      return 'search';
    case 'VendorOnboarding':
      return 'business listing';
    case 'CreditRecharge':
      return 'recharge';
    default:
      return 'earlier request';
  }
}

function platformReply(intents: readonly DiscoveredIntent[]): Response | null {
  const types = new Set(intents.map((intent) => intent.type));
  if (types.has('GREETING')) return { text: GREETING_REPLY, metadata: { platformReply: 'greeting' } };
  if (types.has('THANKS')) return { text: THANKS_REPLY, metadata: { platformReply: 'thanks' } };
  if (
    intents.length > 0 &&
    intents.every((intent) => PLATFORM_REPLY_INTENTS.has(intent.type) || CONTROL_INTENTS.has(intent.type))
  ) {
    return { text: GREETING_REPLY, metadata: { platformReply: 'steer' } };
  }
  return null;
}

/** P6 may rephrase but must keep every number and *bold* name the artifacts carried (§34A.7). */
function missingFacts(message: string, artifacts: readonly ResponseArtifact[]): string[] {
  const source = artifacts.map((artifact) => artifact.text).join('\n');
  const numbers = source.match(/\d[\d,.]*/g) ?? [];
  const bold = (source.match(/\*[^*\n]{2,60}\*/g) ?? []).map((name) => name.replace(/\*/g, ''));
  return [...new Set([...numbers, ...bold])].filter((token) => !message.includes(token));
}

function lastWorkflowId(results: readonly ActionExecutionResult[]): string | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    const result = results[index]!;
    if (
      result.workflowId !== null &&
      (result.status === 'SUCCESS' || result.status === 'PARTIAL' || result.status === 'NEEDS_USER')
    )
      return result.workflowId;
  }
  return null;
}

function intentView(intent: DiscoveredIntent) {
  return {
    intent_id: intent.intentId,
    type: intent.type,
    role: intent.role,
    status: intent.status,
    confidence: intent.confidence,
    scope: intent.scope,
    dependencies: intent.dependencies,
    constraints: intent.constraints,
    source_spans: intent.sourceSpans,
  };
}

function objectView(object: SemanticObject) {
  return {
    object_id: object.objectId,
    surface_form: object.surfaceForm,
    canonical_form: object.canonicalForm,
    entity_type: object.entityType,
    brand: object.brand,
    model: object.model,
    ambiguous: object.ambiguity.present,
    semantic_confidence: object.confidence.semanticResolution,
  };
}

export { EMPTY_PLAN };
