import { sanitizeForLog } from './stage-logger';

describe('sanitizeForLog', () => {
  it('redacts credential-bearing keys at any nesting depth', () => {
    const sanitized = sanitizeForLog({
      phoneNumberId: '123',
      provider: { accessToken: 'EAAG-secret', config: { app_secret: 'shhh' } },
      Authorization: 'Bearer abc',
    });

    expect(sanitized).toEqual({
      phoneNumberId: '123',
      provider: { accessToken: '[redacted]', config: { app_secret: '[redacted]' } },
      Authorization: '[redacted]',
    });
  });

  it('reports buffer size instead of logging media bytes', () => {
    expect(sanitizeForLog({ audio: Buffer.alloc(2048) })).toEqual({ audio: '[Buffer 2048 bytes]' });
  });

  it('truncates long strings and says how much was dropped', () => {
    const sanitized = sanitizeForLog('x'.repeat(2_500)) as string;

    expect(sanitized).toHaveLength(2_000 + '… [truncated 500 chars]'.length);
    expect(sanitized.endsWith('… [truncated 500 chars]')).toBe(true);
  });

  it('caps long arrays with a count of the remainder', () => {
    const sanitized = sanitizeForLog(Array.from({ length: 30 }, (_, index) => index)) as unknown[];

    expect(sanitized).toHaveLength(26);
    expect(sanitized[25]).toBe('… 5 more');
  });

  it('terminates on cyclic structures rather than recursing forever', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic.self = cyclic;

    // The guard is depth-based, so this must return rather than overflow the stack.
    expect(() => sanitizeForLog(cyclic)).not.toThrow();
    expect(JSON.stringify(sanitizeForLog(cyclic))).toContain('max depth');
  });

  it('serialises errors with their message and name', () => {
    const sanitized = sanitizeForLog(new TypeError('bad payload')) as Record<string, unknown>;

    expect(sanitized.name).toBe('TypeError');
    expect(sanitized.message).toBe('bad payload');
  });

  it('renders dates as ISO strings so logs are comparable', () => {
    expect(sanitizeForLog(new Date('2026-08-06T10:15:00.123Z'))).toBe('2026-08-06T10:15:00.123Z');
  });
});
