import { RequestContextStore, runIdForTurn } from './request-context';

describe('RequestContextStore', () => {
  it('is empty outside any scope and propagates through awaited and detached async work', async () => {
    expect(RequestContextStore.current()).toBeNull();

    let detached: string | null = null;

    await RequestContextStore.root({ correlationId: 'corr_test' }, async () => {
      expect(RequestContextStore.current()?.correlationId).toBe('corr_test');

      // A promise created inside the scope but not awaited still sees the context.
      void Promise.resolve().then(() => {
        detached = RequestContextStore.current()?.correlationId ?? null;
      });

      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(RequestContextStore.current()?.correlationId).toBe('corr_test');
    });

    await new Promise((resolve) => setTimeout(resolve, 1));
    expect(detached).toBe('corr_test');
    expect(RequestContextStore.current()).toBeNull();
  });

  it('child scopes mint a new requestId, keep the correlation and record the parent', () => {
    RequestContextStore.root({ correlationId: 'corr_1', requestId: 'req_root' }, () => {
      RequestContextStore.child({ component: 'IDCE' }, () => {
        const context = RequestContextStore.current();
        expect(context?.correlationId).toBe('corr_1');
        expect(context?.parentRequestId).toBe('req_root');
        expect(context?.requestId).not.toBe('req_root');
        expect(context?.component).toBe('IDCE');
      });
      expect(RequestContextStore.current()?.requestId).toBe('req_root');
    });
  });

  it('extend enriches without changing the requestId; resume rebuilds from a snapshot', () => {
    RequestContextStore.root({ correlationId: 'corr_2', requestId: 'req_a' }, () => {
      RequestContextStore.extend({ turnId: 't1', runId: runIdForTurn('t1') }, () => {
        const context = RequestContextStore.current();
        expect(context?.requestId).toBe('req_a');
        expect(context?.runId).toBe('turn:t1');

        const snapshot = RequestContextStore.snapshot();
        RequestContextStore.resume({ ...snapshot, component: 'WORKER' }, () => {
          expect(RequestContextStore.current()?.turnId).toBe('t1');
          expect(RequestContextStore.current()?.component).toBe('WORKER');
        });
      });
    });
  });
});
