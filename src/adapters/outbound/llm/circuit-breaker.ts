/**
 * Per-provider circuit breaker (Execution.md §2.4).
 *
 * When a provider is down, continuing to call it wastes the caller's latency budget on
 * requests that are certain to fail. Opening the circuit skips straight to the next
 * provider, and a single probe after the cooldown decides whether it has recovered.
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Consecutive failures that trip the circuit. */
  readonly failureThreshold: number;
  /** How long to stay open before allowing one probe request. */
  readonly resetMs: number;
}

export class CircuitBreaker {
  private consecutiveFailures = 0;
  private openedAt: number | null = null;
  /** True while a half-open probe is in flight, so only one request is let through. */
  private probeInFlight = false;

  constructor(
    private readonly options: CircuitBreakerOptions,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get state(): CircuitState {
    if (this.openedAt === null) return 'closed';
    return this.now() - this.openedAt >= this.options.resetMs ? 'half_open' : 'open';
  }

  /**
   * Whether a request may proceed.
   *
   * In `half_open` exactly one probe is admitted; further callers are rejected until the
   * probe reports back, so a recovering provider is not immediately re-flooded.
   */
  allowRequest(): boolean {
    const state = this.state;
    if (state === 'closed') return true;
    if (state === 'open') return false;

    if (this.probeInFlight) return false;
    this.probeInFlight = true;
    return true;
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.openedAt = null;
    this.probeInFlight = false;
  }

  recordFailure(): void {
    this.probeInFlight = false;
    this.consecutiveFailures += 1;

    if (this.consecutiveFailures >= this.options.failureThreshold) {
      // Restart the cooldown: a failed probe means the provider is still unhealthy.
      this.openedAt = this.now();
    }
  }

  /** Diagnostic snapshot for health endpoints and stage logs. */
  snapshot(): { state: CircuitState; consecutiveFailures: number; openedAt: number | null } {
    return { state: this.state, consecutiveFailures: this.consecutiveFailures, openedAt: this.openedAt };
  }
}
