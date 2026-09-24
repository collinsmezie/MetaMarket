/**
 * Performance metrics derived from a run's persisted trace (Directive §49.4; MCOS §65.6).
 *
 * Nothing here is estimated. LLM call count, sequential depth and parallel width are computed
 * from the recorded start/end instants of prompt executions, so any consolidation decision is
 * backed by measured traces rather than assumed multiplication of latencies.
 */

export interface TimedInterval {
  readonly startedAt: Date;
  readonly completedAt: Date;
}

export interface RunMetrics {
  readonly llmCallCount: number;
  /** Longest chain of non-overlapping LLM calls (critical path length in calls). */
  readonly sequentialLlmDepth: number;
  /** Maximum number of LLM calls in flight at the same instant. */
  readonly parallelLlmWidth: number;
  readonly llmLatencyMs: { p50: number; p95: number; p99: number; max: number; total: number };
  readonly totalTurnLatencyMs: number | null;
  readonly retryCount: number;
  readonly schemaRepairCount: number;
  readonly specialistFailureCount: number;
  readonly stepCount: number;
}

export function percentile(sortedAscending: readonly number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAscending.length) - 1;
  return sortedAscending[Math.min(Math.max(rank, 0), sortedAscending.length - 1)] ?? 0;
}

/** Maximum number of intervals overlapping at any instant (sweep line). */
export function maxConcurrency(intervals: readonly TimedInterval[]): number {
  if (intervals.length === 0) return 0;
  const events: Array<{ at: number; delta: number }> = [];
  for (const interval of intervals) {
    events.push({ at: interval.startedAt.getTime(), delta: 1 });
    events.push({ at: interval.completedAt.getTime(), delta: -1 });
  }
  // Ends sort before starts at the same instant so back-to-back calls are not counted as parallel.
  events.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let max = 0;
  for (const event of events) {
    current += event.delta;
    if (current > max) max = current;
  }
  return max;
}

/**
 * Length of the longest chain of intervals where each starts after the previous finished.
 * This is the sequential LLM depth: how many model calls the turn had to wait for in series.
 */
export function longestSequentialChain(intervals: readonly TimedInterval[]): number {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
  const chainEndingAt: number[] = new Array<number>(sorted.length).fill(1);
  let best = 1;
  for (let i = 0; i < sorted.length; i += 1) {
    const current = sorted[i];
    if (current === undefined) continue;
    for (let j = 0; j < i; j += 1) {
      const earlier = sorted[j];
      if (earlier === undefined) continue;
      if (earlier.completedAt.getTime() <= current.startedAt.getTime()) {
        const candidate = (chainEndingAt[j] ?? 1) + 1;
        if (candidate > (chainEndingAt[i] ?? 1)) chainEndingAt[i] = candidate;
      }
    }
    if ((chainEndingAt[i] ?? 1) > best) best = chainEndingAt[i] ?? 1;
  }
  return best;
}

export interface MetricsInput {
  readonly run: { startedAt: Date; completedAt: Date | null };
  readonly promptExecutions: readonly {
    readonly latencyMs: number;
    readonly createdAt: Date;
    readonly repairAttempts: number;
    readonly providerAttempts: number;
    readonly status: string;
  }[];
  readonly steps: readonly { readonly status: string; readonly retryCount: number }[];
}

export function computeRunMetrics(input: MetricsInput): RunMetrics {
  // `createdAt` is recorded when the execution finished, so the interval is [createdAt - latency, createdAt].
  const intervals: TimedInterval[] = input.promptExecutions.map((execution) => ({
    startedAt: new Date(execution.createdAt.getTime() - execution.latencyMs),
    completedAt: execution.createdAt,
  }));

  const latencies = input.promptExecutions.map((execution) => execution.latencyMs).sort((a, b) => a - b);

  return {
    llmCallCount: input.promptExecutions.length,
    sequentialLlmDepth: longestSequentialChain(intervals),
    parallelLlmWidth: maxConcurrency(intervals),
    llmLatencyMs: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      p99: percentile(latencies, 99),
      max: latencies.length === 0 ? 0 : (latencies[latencies.length - 1] ?? 0),
      total: latencies.reduce((sum, value) => sum + value, 0),
    },
    totalTurnLatencyMs:
      input.run.completedAt === null ? null : input.run.completedAt.getTime() - input.run.startedAt.getTime(),
    retryCount:
      input.promptExecutions.reduce(
        (sum, execution) => sum + Math.max(0, execution.providerAttempts - 1),
        0,
      ) + input.steps.reduce((sum, step) => sum + step.retryCount, 0),
    schemaRepairCount: input.promptExecutions.reduce((sum, execution) => sum + execution.repairAttempts, 0),
    specialistFailureCount: input.steps.filter((step) => step.status === 'ERROR' || step.status === 'BLOCKED')
      .length,
    stepCount: input.steps.length,
  };
}
