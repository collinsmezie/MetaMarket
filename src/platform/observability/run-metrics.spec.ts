import { computeRunMetrics, longestSequentialChain, maxConcurrency, percentile } from './run-metrics';

const at = (ms: number) => new Date(1_700_000_000_000 + ms);

describe('run metrics', () => {
  it('measures parallel width and sequential depth from recorded intervals', () => {
    // IDCE and CSRE in parallel (0–100, 0–120), then plan (130–160), then compose (170–200).
    const intervals = [
      { startedAt: at(0), completedAt: at(100) },
      { startedAt: at(0), completedAt: at(120) },
      { startedAt: at(130), completedAt: at(160) },
      { startedAt: at(170), completedAt: at(200) },
    ];
    expect(maxConcurrency(intervals)).toBe(2);
    expect(longestSequentialChain(intervals)).toBe(3);
  });

  it('treats back-to-back calls as sequential, not parallel', () => {
    const intervals = [
      { startedAt: at(0), completedAt: at(50) },
      { startedAt: at(50), completedAt: at(90) },
    ];
    expect(maxConcurrency(intervals)).toBe(1);
    expect(longestSequentialChain(intervals)).toBe(2);
  });

  it('computes percentiles and totals', () => {
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
    expect(percentile([], 50)).toBe(0);

    const metrics = computeRunMetrics({
      run: { startedAt: at(0), completedAt: at(500) },
      promptExecutions: [
        { latencyMs: 100, createdAt: at(100), repairAttempts: 1, providerAttempts: 2, status: 'SUCCESS' },
        { latencyMs: 120, createdAt: at(120), repairAttempts: 0, providerAttempts: 1, status: 'SUCCESS' },
        {
          latencyMs: 30,
          createdAt: at(160),
          repairAttempts: 0,
          providerAttempts: 1,
          status: 'SCHEMA_FAILURE',
        },
      ],
      steps: [
        { status: 'SUCCESS', retryCount: 0 },
        { status: 'ERROR', retryCount: 1 },
      ],
    });

    expect(metrics.llmCallCount).toBe(3);
    expect(metrics.parallelLlmWidth).toBe(2);
    expect(metrics.sequentialLlmDepth).toBe(2);
    expect(metrics.totalTurnLatencyMs).toBe(500);
    expect(metrics.retryCount).toBe(2);
    expect(metrics.schemaRepairCount).toBe(1);
    expect(metrics.specialistFailureCount).toBe(1);
    expect(metrics.llmLatencyMs.total).toBe(250);
    expect(metrics.llmLatencyMs.max).toBe(120);
  });
});
