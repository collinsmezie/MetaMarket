import { PROVIDER_MESSAGE_ID_KEY } from '../../../domain/models/incoming-message';
import { mapWebMessage, type WebMessageBody } from './web-payload.mapper';

const AT = new Date('2026-09-05T10:00:00.000Z');

function map(body: WebMessageBody) {
  return mapWebMessage(body, AT);
}

describe('mapWebMessage', () => {
  it('maps a text message to a canonical message on the web channel', () => {
    const result = map({ sessionId: 'sess_1', text: 'I sell Toyota brake pads' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.channel).toBe('web');
    expect(result.message.timestamp).toEqual(AT);
    expect(result.message.parts).toEqual([{ type: 'text', text: 'I sell Toyota brake pads' }]);
    // The context manager resolves it; the adapter must not invent one.
    expect(result.message.conversationId).toBe('');
  });

  it('uses the phone number as identity so web and WhatsApp are one conversation', () => {
    const web = map({ sessionId: 'sess_1', phone: '+234 801 234 5678', text: 'hi' });

    expect(web.ok).toBe(true);
    if (!web.ok) return;

    expect(web.message.userId).toBe('+2348012345678');
  });

  it('falls back to a session identity that cannot be mistaken for a phone number', () => {
    const result = map({ sessionId: 'sess_1', text: 'hi' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.userId).toBe('web:sess_1');
  });

  it('scopes the dedup key by session so two visitors cannot collide', () => {
    const first = map({ sessionId: 'sess_1', clientMessageId: '1', text: 'hi' });
    const second = map({ sessionId: 'sess_2', clientMessageId: '1', text: 'hi' });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.message.metadata[PROVIDER_MESSAGE_ID_KEY]).toBe('web:sess_1:1');
    expect(second.message.metadata[PROVIDER_MESSAGE_ID_KEY]).toBe('web:sess_2:1');
  });

  it('maps a tapped action to an interactive reply part', () => {
    const result = map({ sessionId: 'sess_1', actionPayload: 'wf_123|confirm', actionTitle: 'Confirm' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.parts).toEqual([
      { type: 'button_reply', payload: 'wf_123|confirm', title: 'Confirm' },
    ]);
  });

  it('puts the action before the text so the deterministic route home is read first', () => {
    const result = map({ sessionId: 'sess_1', actionPayload: 'wf_123|yes', text: 'also engine oil' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.message.parts.map((part) => part.type)).toEqual(['button_reply', 'text']);
  });

  it('rejects a body with no session', () => {
    expect(map({ text: 'hi' })).toEqual({ ok: false, reason: 'sessionId is required.' });
    expect(map({ sessionId: '  ', text: 'hi' })).toEqual({ ok: false, reason: 'sessionId is required.' });
  });

  it('rejects a body with nothing to say', () => {
    expect(map({ sessionId: 'sess_1' })).toEqual({
      ok: false,
      reason: 'Provide either text or actionPayload.',
    });
    expect(map({ sessionId: 'sess_1', text: '   ' })).toEqual({
      ok: false,
      reason: 'Provide either text or actionPayload.',
    });
  });
});
