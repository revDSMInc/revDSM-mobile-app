import { isRetryableFailure, retryableFailures } from '../../src/utils/revrender-jobs';

const job = (over: any = {}) => ({ status: 'failed' as const, ...over });

describe('isRetryableFailure', () => {
  it('refuses a 4xx rejection - the same payload will be refused again', () => {
    // The incident: a local file:// path sent as an S3 key. Retrying resends it unchanged.
    expect(isRetryableFailure(job({ errorKind: 'rejected' }))).toBe(false);
  });

  it('refuses an expired session - signing in must come first', () => {
    expect(isRetryableFailure(job({ errorKind: 'auth' }))).toBe(false);
  });

  it('allows every transport / server kind', () => {
    ['timeout', 'network', 'busy', 'server', 'interrupted'].forEach((kind) => {
      expect(isRetryableFailure(job({ errorKind: kind }))).toBe(true);
    });
  });

  it('allows an unclassified failure - usually transport, and a wrong hide strands work', () => {
    expect(isRetryableFailure(job({}))).toBe(true);
    expect(isRetryableFailure(job({ errorKind: undefined }))).toBe(true);
  });

  it('is false for anything not failed', () => {
    expect(isRetryableFailure({ status: 'completed' } as any)).toBe(false);
    expect(isRetryableFailure({ status: 'running' } as any)).toBe(false);
    expect(isRetryableFailure({ status: 'pending' } as any)).toBe(false);
  });
});

describe('retryableFailures', () => {
  it('keeps only the jobs a Retry button could help', () => {
    const jobs = [
      job({ id: 1, errorKind: 'network' }),
      job({ id: 2, errorKind: 'rejected' }),
      job({ id: 3, errorKind: 'timeout' }),
      { id: 4, status: 'completed' as const },
    ];
    expect(retryableFailures(jobs as any).map((j: any) => j.id)).toEqual([1, 3]);
  });

  /**
   * The incident burst: 4 renders of one un-uploaded photo. The row must offer NO retry,
   * because 15 presses produced 60 server-side failures and could never have worked.
   */
  it('offers nothing for a burst that failed validation', () => {
    const burst = [1, 2, 3, 4].map((id) => job({ id, errorKind: 'rejected' }));
    expect(retryableFailures(burst as any)).toEqual([]);
  });
});

/**
 * The Tools tab crashed with "undefined is not a function" at the `retryableFailures` call.
 * The cause was a stale Metro bundle, not bad code - but a cosmetic button must never be able
 * to take down the whole screen, so the call site guards on `typeof`. These pin the contract
 * that guard depends on.
 */
describe('module surface (crash guard)', () => {
  it('exports both helpers as functions', () => {
    // A default/named export mix-up here is what "undefined is not a function" looks like.
    expect(typeof isRetryableFailure).toBe('function');
    expect(typeof retryableFailures).toBe('function');
  });

  it('survives the shapes a real job list actually contains', () => {
    // Jobs arrive from MMKV, so fields can be absent entirely.
    const messy = [
      { status: 'failed' },
      { status: 'failed', errorKind: undefined },
      { status: 'running' },
      { status: 'completed', errorKind: 'rejected' },
    ];
    expect(() => retryableFailures(messy as any)).not.toThrow();
    expect(retryableFailures(messy as any)).toHaveLength(2);
  });

  it('returns a NEW array and never mutates its input', () => {
    const jobs = [{ status: 'failed', errorKind: 'rejected' }] as any;
    const out = retryableFailures(jobs);
    expect(out).not.toBe(jobs);
    expect(jobs).toHaveLength(1);
  });
});
