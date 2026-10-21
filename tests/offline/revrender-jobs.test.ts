import {
  classifyPollFailure,
  classifyRenderSubmitError,
  extractBatchId,
  interpretBatch,
  jobsToPoll,
  queueCounts,
  reviveJobs,
  summarizeFinish,
  batchProgress,
  MAX_POLL_REJECTIONS,
} from '../../src/utils/revrender-jobs';

describe('classifyRenderSubmitError', () => {
  it('a timeout is AMBIGUOUS - the server may have accepted it', () => {
    const r = classifyRenderSubmitError({ code: 'ECONNABORTED', message: 'timeout of 120000ms exceeded' });
    expect(r.kind).toBe('timeout');
    expect(r.ambiguous).toBe(true);
    expect(r.message).toMatch(/charged twice/);
  });
  it('no answer at all is a network error', () => {
    const r = classifyRenderSubmitError({ message: 'Network Error', code: 'ERR_NETWORK' });
    expect(r.kind).toBe('network');
    expect(r.message).toMatch(/Network error/);
  });
  it('a 503 keeps the server wording and is "busy"', () => {
    const r = classifyRenderSubmitError({ httpStatus: 503, error: JSON.stringify({ error: { message: 'High demand' } }) });
    expect(r).toMatchObject({ kind: 'busy', message: 'High demand' });
  });
  it('a 400 is a rejection with the server text', () => {
    expect(classifyRenderSubmitError({ httpStatus: 400, message: 'payloads required' })).toMatchObject({ kind: 'rejected', message: 'payloads required' });
  });
  it('a 401 is auth, never a render fault', () => {
    expect(classifyRenderSubmitError({ httpStatus: 401 }).kind).toBe('auth');
  });
});

describe('batch parsing', () => {
  it('finds the batch id in every envelope', () => {
    expect(extractBatchId({ batch: { batchId: 'a' } })).toBe('a');
    expect(extractBatchId({ data: { batch: { batchId: 'b' } } })).toBe('b');
    expect(extractBatchId({ batchId: 'c' })).toBe('c');
    expect(extractBatchId({})).toBeNull();
  });
  it('done / failed / running', () => {
    expect(interpretBatch({ batch: { status: 'completed', total: 1, succeeded: 1 } }).state).toBe('done');
    const f = interpretBatch({ batch: { status: 'done', total: 2, succeeded: 1, failed: 1, jobs: [{ status: 'failed', error: 'boom', viewLabel: 'Front' }] } });
    expect(f).toMatchObject({ state: 'failed', message: 'Front: boom' });
    expect(interpretBatch({ status: 'cancelled' }).state).toBe('failed');
    expect(interpretBatch({ batch: { status: 'running', total: 4, succeeded: 1, failed: 0 } }).state).toBe('running');
  });
  it('progress only exists for a multi-render batch, and never reaches 100 before done', () => {
    expect(batchProgress(interpretBatch({ batch: { status: 'running', total: 1 } }))).toBeNull();
    expect(batchProgress(interpretBatch({ batch: { status: 'running', total: 4, succeeded: 3 } }))).toBe(75);
    expect(batchProgress({ state: 'running', total: 2, finished: 2 })).toBe(99);
  });
});

describe('queue rules', () => {
  const job = (o: any) => ({ id: 1, status: 'running', payload: {}, progress: 0, ...o });

  it('a restored job with a batchId resumes; one without is interrupted + ambiguous', () => {
    const out = reviveJobs([job({ id: 1, batchId: 'b1' }), job({ id: 2 }), job({ id: 3, status: 'completed' }), job({ id: 4, status: 'failed', error: 'x' })] as any);
    expect(out.map((j) => j.id)).toEqual([1, 2, 4]);
    expect(out[1]).toMatchObject({ status: 'failed', errorKind: 'interrupted', ambiguous: true });
    expect(jobsToPoll(out).map((j) => j.id)).toEqual([1]);
  });
  it('counts are honest and a failed queue does not say "finished"', () => {
    expect(queueCounts([job({ status: 'completed' }), job({}), job({ waiting: true })] as any)).toMatchObject({ total: 3, done: 1, active: 2, waiting: true, label: '1 of 3 done' });
    expect(summarizeFinish(0, 6)).toMatchObject({ tone: 'error' });
    expect(summarizeFinish(0, 6).message).not.toMatch(/ready|finished/);
    expect(summarizeFinish(4, 2)).toMatchObject({ tone: 'warning', message: '4 of 6 renders finished. 2 need retrying.' });
    expect(summarizeFinish(2, 0).tone).toBe('success');
  });
  it('poll failures: transport and 401 wait, other answers are tolerated a few times then fail', () => {
    expect(classifyPollFailure({ message: 'Network Error', code: 'ERR_NETWORK' }, 0)).toBe('wait');
    expect(classifyPollFailure({ httpStatus: 401 }, 99)).toBe('wait');
    expect(classifyPollFailure({ httpStatus: 404 }, 0)).toBe('retry-later');
    expect(classifyPollFailure({ httpStatus: 500 }, MAX_POLL_REJECTIONS - 1)).toBe('fail');
  });
});

import { estimateJobProgress, queueProgress } from '../../src/utils/revrender-jobs';

describe('live progress estimate', () => {
  const run = (o: any = {}) => ({ id: 1, status: 'running', payload: {}, progress: 0, startedAt: 1000, ...o });
  it('moves with time, never reaches 100 before the server says done', () => {
    const a = estimateJobProgress(run() as any, 1000 + 5_000);
    const b = estimateJobProgress(run() as any, 1000 + 40_000);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(estimateJobProgress(run() as any, 1000 + 10 * 60_000)).toBeLessThan(100);
    expect(estimateJobProgress(run({ status: 'completed' }) as any, 0)).toBe(100);
  });
  it('is frozen while waiting for signal and never below the server value', () => {
    const waiting = run({ waiting: true, waitingAt: 1000 + 10_000 });
    expect(estimateJobProgress(waiting as any, 1000 + 10_000)).toBe(estimateJobProgress(waiting as any, 1000 + 90_000));
    expect(estimateJobProgress(run({ progress: 75 }) as any, 1001)).toBe(75);
  });
  it('queue bar averages the counted jobs and ignores failed ones', () => {
    expect(queueProgress([run({ status: 'completed' }), run({ status: 'failed' })] as any, 5000)).toBe(100);
    expect(queueProgress([], 0)).toBe(0);
  });
});
