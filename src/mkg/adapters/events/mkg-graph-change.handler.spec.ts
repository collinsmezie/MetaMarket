import { PlatformEvents } from '../../../platform/events/domain-event';
import { MkgGraphChangeHandler } from './mkg-graph-change.handler';
import { MKG_PREDICATES } from '../../domain/mkg-vocabulary';

describe('MkgGraphChangeHandler', () => {
  let handler: MkgGraphChangeHandler;
  let mockMkgWrite: any;

  beforeEach(() => {
    mockMkgWrite = {
      applyGraphChange: jest.fn().mockResolvedValue({
        success: true,
        operation: 'ADD',
        newState: 'ACTIVE',
        idempotencyKey: 'test_hash',
      }),
    };
    handler = new MkgGraphChangeHandler(mockMkgWrite);
  });

  it('ignores events that are not PlatformEvents.GraphChangeDecided', async () => {
    await handler.handle({
      eventId: 'ev_1',
      eventType: 'some.other.event',
      producer: 'test',
      timestamp: new Date(),
      payload: {},
    } as any);

    expect(mockMkgWrite.applyGraphChange).not.toHaveBeenCalled();
  });

  it('parses GraphChangeDecided event and invokes MkgWritePort.applyGraphChange', async () => {
    const event = {
      eventId: 'ev_1',
      eventType: PlatformEvents.GraphChangeDecided,
      eventVersion: '1.0',
      producer: 'evidence',
      timestamp: new Date(),
      correlationId: 'corr_123',
      payload: {
        decisionId: 'dec_100',
        operation: 'ADD' as const,
        subjectId: 'phrase:hot flask',
        predicate: MKG_PREDICATES.EXPRESSES,
        objectId: 'concept:vacuum_flask',
        beliefScore: 0.92,
        evidenceIds: ['ev_assertion_1'],
        policyVersion: '1.0',
      },
    };

    await handler.handle(event);

    expect(mockMkgWrite.applyGraphChange).toHaveBeenCalledWith(
      expect.objectContaining({
        decisionId: 'dec_100',
        operation: 'ADD',
        subjectId: 'phrase:hot flask',
        predicate: MKG_PREDICATES.EXPRESSES,
        objectId: 'concept:vacuum_flask',
        beliefScore: 0.92,
        evidenceIds: ['ev_assertion_1'],
        correlationId: 'corr_123',
      }),
    );
  });
});
