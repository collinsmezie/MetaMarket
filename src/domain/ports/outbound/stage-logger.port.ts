/**
 * Structured stage logging contract (Execution.md §3).
 *
 * Every pipeline stage records its input, the transformation it applied, and its output.
 * Defined as a port so the domain can log without importing a logging framework, and so
 * tests can assert on the trace a turn produced.
 */

export const STAGE_LOGGER = Symbol('StageLogger');

export interface StageLog {
  /** Component name, e.g. `MCOS`, `CME`, `CDE`. */
  readonly component: string;
  /** Stage name, e.g. `MediaProcessingService`, `DemandUnderstandingStage`. */
  readonly stage: string;
  readonly input: unknown;
  /** One-line description of the logic applied. */
  readonly action: string;
  readonly output: unknown;
  /** Correlates every stage of one turn. */
  readonly correlationId?: string;
  readonly durationMs?: number;
}

export interface StageLoggerPort {
  stage(log: StageLog): void;

  /**
   * Records a stage that failed.
   *
   * Separate from {@link stage} so failures are never rendered as successful output — a
   * silent failure is explicitly disallowed (Execution.md §2.5).
   */
  stageFailed(log: Omit<StageLog, 'output'> & { readonly error: unknown }): void;

  /** Returns a logger that stamps every entry with `correlationId`. */
  withCorrelation(correlationId: string): StageLoggerPort;
}
