/**
 * Execution trace contract (Overarching TDR §26, §28; Directive §26, §49.4, §49.9).
 *
 * A trace answers "why did the system produce this answer?" without hidden reasoning. Every
 * orchestration run, every specialist step, every prompt execution and every persisted decision
 * is recorded against the same `runId`, so the dev inspection API can reconstruct the turn.
 *
 * Domain and application code depend on this port; the Prisma adapter is the only writer of the
 * `orchestration_runs` / `trace_steps` / `prompt_executions` tables.
 */

export const TRACE_RECORDER = Symbol('TraceRecorder');

export type RunStatus = 'ACTIVE' | 'WAITING_USER' | 'COMPLETED' | 'PARTIAL' | 'FAILED';

export type TraceStepStatus = 'STARTED' | 'SUCCESS' | 'PARTIAL' | 'BLOCKED' | 'ERROR' | 'SKIPPED';

export interface RunStart {
  readonly runId: string;
  readonly conversationId: string;
  readonly turnId: string;
  readonly correlationId: string;
  /** Message ids that formed the logical turn. */
  readonly messageIds: readonly string[];
  readonly channel: string;
  readonly startedAt: Date;
}

export interface RunCompletion {
  readonly runId: string;
  readonly status: Exclude<RunStatus, 'ACTIVE'>;
  readonly completedAt: Date;
  /** Final user-facing artefact(s), stored for inspection — never chain-of-thought. */
  readonly finalResponse: unknown | null;
  readonly error: { code: string; message: string } | null;
}

export interface TraceStepStart {
  readonly runId: string;
  readonly requestId: string;
  readonly parentRequestId: string | null;
  readonly correlationId: string;
  readonly conversationId: string | null;
  readonly turnId: string | null;
  readonly component: string;
  readonly componentVersion: string;
  /** Stage/node name, e.g. `understand.idce`, `plan`, `execute.action:a2`. */
  readonly stage: string;
  readonly schemaVersion: string | null;
  readonly startedAt: Date;
  /** Bounded, sanitised view of the input — a reference or summary, not a payload dump. */
  readonly inputSummary: unknown;
}

export interface TraceStepFinish {
  readonly requestId: string;
  readonly status: Exclude<TraceStepStatus, 'STARTED'>;
  readonly completedAt: Date;
  /** Decision summary + reason codes + confidence (Overarching §26.3). */
  readonly decision: unknown;
  readonly outputSummary: unknown;
  /** Ids of rows this step wrote, so the trace links to durable state. */
  readonly persistedRecordIds: readonly string[];
  readonly promptExecutionIds: readonly string[];
  readonly retryCount: number;
  readonly error: { code: string; message: string; retryable: boolean } | null;
}

export type PromptExecutionStatus = 'SUCCESS' | 'SCHEMA_FAILURE' | 'PROVIDER_FAILURE' | 'POLICY_FAILURE';

/** One model invocation, recorded regardless of outcome (Overarching §7.2). */
export interface PromptExecutionRecord {
  readonly id: string;
  readonly requestId: string;
  readonly parentRequestId: string | null;
  readonly correlationId: string;
  readonly conversationId: string | null;
  readonly turnId: string | null;
  readonly runId: string | null;
  readonly component: string;
  readonly componentVersion: string;
  readonly promptId: string;
  readonly promptVersion: string;
  readonly schemaId: string | null;
  readonly schemaVersion: string | null;
  readonly modelProvider: string | null;
  readonly modelName: string | null;
  readonly inputHash: string;
  readonly input: unknown;
  readonly output: unknown | null;
  readonly rawOutput: string | null;
  readonly status: PromptExecutionStatus;
  readonly validationErrors: readonly unknown[];
  readonly repairAttempts: number;
  readonly providerAttempts: number;
  readonly failedProviders: readonly string[];
  readonly latencyMs: number;
  readonly usage: { inputTokens: number; outputTokens: number } | null;
  readonly decisionSummary: unknown | null;
  /** True when this execution shared one model call with another contract (Directive §49.3). */
  readonly sharedInvocation: boolean;
  readonly createdAt: Date;
}

export interface TraceRecorderPort {
  startRun(run: RunStart): Promise<void>;
  completeRun(completion: RunCompletion): Promise<void>;
  startStep(step: TraceStepStart): Promise<void>;
  finishStep(step: TraceStepFinish): Promise<void>;
  recordPromptExecution(execution: PromptExecutionRecord): Promise<void>;
}
