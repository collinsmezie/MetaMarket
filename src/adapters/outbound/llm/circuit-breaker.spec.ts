import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  let clock: number;
  const advance = (ms: number) => {
    clock += ms;
  };

  const build = () => new CircuitBreaker({ failureThreshold: 3, resetMs: 1_000 }, () => clock);

  beforeEach(() => {
    clock = 0;
  });

  it('stays closed while failures remain below the threshold', () => {
    const breaker = build();

    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.state).toBe('closed');
    expect(breaker.allowRequest()).toBe(true);
  });

  it('opens once the threshold is reached and rejects requests', () => {
    const breaker = build();

    for (let i = 0; i < 3; i += 1) breaker.recordFailure();

    expect(breaker.state).toBe('open');
    expect(breaker.allowRequest()).toBe(false);
  });

  it('resets the failure count on success so intermittent errors do not trip it', () => {
    const breaker = build();

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.state).toBe('closed');
  });

  it('half-opens after the cooldown and admits exactly one probe', () => {
    const breaker = build();
    for (let i = 0; i < 3; i += 1) breaker.recordFailure();

    advance(1_000);

    expect(breaker.state).toBe('half_open');
    // First caller becomes the probe; concurrent callers must not also hit the provider.
    expect(breaker.allowRequest()).toBe(true);
    expect(breaker.allowRequest()).toBe(false);
  });

  it('closes fully when the probe succeeds', () => {
    const breaker = build();
    for (let i = 0; i < 3; i += 1) breaker.recordFailure();
    advance(1_000);
    breaker.allowRequest();

    breaker.recordSuccess();

    expect(breaker.state).toBe('closed');
    expect(breaker.allowRequest()).toBe(true);
  });

  it('restarts the cooldown when the probe fails', () => {
    const breaker = build();
    for (let i = 0; i < 3; i += 1) breaker.recordFailure();
    advance(1_000);
    breaker.allowRequest();

    breaker.recordFailure();

    expect(breaker.state).toBe('open');
    advance(999);
    expect(breaker.state).toBe('open');
    advance(1);
    expect(breaker.state).toBe('half_open');
  });
});
