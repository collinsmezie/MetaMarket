import {
  decideBoundary,
  isExplicitRetraction,
  type AssemblyLimits,
  type OpenTurnView,
} from './assembly-policy';

const limits: AssemblyLimits = { quietWindowMs: 2_500, maxAssemblyMs: 15_000, maxMessageCount: 8 };
const t0 = new Date('2026-09-12T10:00:00.000Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

function open(overrides: Partial<OpenTurnView> = {}): OpenTurnView {
  return {
    turnId: 't1',
    channel: 'whatsapp',
    revision: 3,
    messageCount: 1,
    firstMessageAt: t0,
    quietDeadlineAt: at(2_500),
    hardDeadlineAt: at(15_000),
    lastText: 'I need brake pads',
    ...overrides,
  };
}

const incoming = (
  text: string,
  ms: number,
  payload: string | null = null,
  channel: 'whatsapp' | 'web' = 'whatsapp',
) => ({
  channel,
  text,
  interactivePayload: payload,
  receivedAt: at(ms),
});

describe('turn assembly boundary policy (MCOS §5A)', () => {
  it('opens a new turn for the first message and arms the quiet window', () => {
    expect(decideBoundary(null, incoming('I need brake pads', 0), limits)).toEqual({
      action: 'OPEN_NEW',
      reason: 'FIRST_MESSAGE',
    });
  });

  it('coalesces additive continuation inside the quiet window and extends the deadline', () => {
    const decision = decideBoundary(open(), incoming('Toyota Camry', 1_000), limits);
    expect(decision.action).toBe('APPEND');
    if (decision.action === 'APPEND') expect(decision.newQuietDeadlineAt).toEqual(at(3_500));
  });

  it('treats a correction inside the window as the same turn ("Actually Honda" is not a retraction)', () => {
    expect(decideBoundary(open(), incoming('Actually Honda', 800), limits).action).toBe('APPEND');
    expect(decideBoundary(open(), incoming('sorry make that 20', 800), limits).action).toBe('APPEND');
    expect(isExplicitRetraction('Actually Honda')).toBe(false);
  });

  it('cancels a never-executed open turn on an explicit retraction and starts a superseding turn', () => {
    for (const text of [
      'Actually forget that',
      'forget it',
      'never mind',
      'Leave that',
      'abeg forget that, find me a plumber',
    ]) {
      const decision = decideBoundary(open(), incoming(text, 900), limits);
      expect(decision).toEqual({ action: 'CANCEL_OPEN_THEN_NEW', reason: 'EXPLICIT_RETRACTION' });
    }
  });

  it('seals immediately on an interactive payload, and seals any open turn first', () => {
    expect(decideBoundary(null, incoming('Yes', 0, 'mm|wf|resume'), limits)).toEqual({
      action: 'OPEN_NEW_SEALED',
      reason: 'INTERACTIVE_PAYLOAD',
    });
    expect(decideBoundary(open(), incoming('Yes', 500, 'mm|wf|resume'), limits)).toEqual({
      action: 'SEAL_OPEN_THEN_NEW',
      reason: 'INTERACTIVE_PAYLOAD',
      newTurnSealed: true,
    });
  });

  it('enforces the hard limits on elapsed time and message count', () => {
    expect(
      decideBoundary(
        open({ quietDeadlineAt: at(16_000), hardDeadlineAt: at(15_000) }),
        incoming('more', 15_000),
        limits,
      ),
    ).toEqual({
      action: 'SEAL_OPEN_THEN_NEW',
      reason: 'HARD_LIMIT',
      newTurnSealed: false,
    });
    expect(decideBoundary(open({ messageCount: 8 }), incoming('more', 100), limits)).toEqual({
      action: 'SEAL_OPEN_THEN_NEW',
      reason: 'HARD_LIMIT',
      newTurnSealed: false,
    });
  });

  it('draws a boundary when the quiet window already elapsed or the channel changed', () => {
    expect(decideBoundary(open(), incoming('near Warri', 2_600), limits).action).toBe('SEAL_OPEN_THEN_NEW');
    const channel = decideBoundary(open(), incoming('near Warri', 500, null, 'web'), limits);
    expect(channel).toEqual({
      action: 'SEAL_OPEN_THEN_NEW',
      reason: 'CHANNEL_BOUNDARY',
      newTurnSealed: false,
    });
  });

  it('consults the classifier only when enabled and the message looks like a topic switch', () => {
    expect(decideBoundary(open(), incoming('also how do I recharge my credits', 500), limits).action).toBe(
      'APPEND',
    );
    expect(
      decideBoundary(open(), incoming('also how do I recharge my credits', 500), limits, {
        classifierEnabled: true,
      }).action,
    ).toBe('UNCERTAIN');
    expect(
      decideBoundary(open(), incoming('Toyota Camry', 500), limits, { classifierEnabled: true }).action,
    ).toBe('APPEND');
  });

  it('never lets the quiet deadline exceed the hard deadline', () => {
    const decision = decideBoundary(open({ hardDeadlineAt: at(3_000) }), incoming('2018', 2_000), limits);
    expect(decision.action).toBe('APPEND');
    if (decision.action === 'APPEND') expect(decision.newQuietDeadlineAt).toEqual(at(3_000));
  });
});
