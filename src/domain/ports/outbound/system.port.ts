/**
 * Ambient system dependencies, injected rather than called directly.
 *
 * Time and identifier generation are the two things that make otherwise-pure domain logic
 * untestable. Behind ports, a workflow's expiry arithmetic and a fingerprint's id become
 * deterministic in tests.
 */

export const CLOCK = Symbol('Clock');
export const ID_GENERATOR = Symbol('IdGenerator');

export interface ClockPort {
  now(): Date;
}

export interface IdGeneratorPort {
  /** Opaque unique id. */
  uuid(): string;

  /**
   * Prefixed, human-readable id, e.g. `buyer_search_a1b2c3`.
   * Used for workflow and request ids that appear in logs and support conversations.
   */
  prefixed(prefix: string): string;
}

export class SystemClock implements ClockPort {
  now(): Date {
    return new Date();
  }
}

/** Fixed clock for tests; advance it explicitly to exercise expiry and timeout rules. */
export class FixedClock implements ClockPort {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}
