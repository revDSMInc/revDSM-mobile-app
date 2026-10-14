import {
  applyStepDecision,
  createOfflineWork,
  decideAfterStepError,
  nextUploadStep,
  resolveStepDecision,
  stepReplaySafety,
  uploadableWork,
  type OfflineLeadWork,
} from '../../src/utils/offline-lead-work';
import { classifyCreateOutcome, resolveRetryDecision } from '../../src/utils/offline-lead-queue';

const work = (over: Partial<OfflineLeadWork> = {}): OfflineLeadWork => ({
  ...createOfflineWork({ customer: { firstName: 'A' } }, 'A'),
  ...over,
});

describe('classifyCreateOutcome', () => {
  it('maps a 401 to unauthorized, not rejected', () => {
    expect(classifyCreateOutcome({ httpStatus: 401, message: 'Unauthorized' })).toBe('unauthorized');
    expect(classifyCreateOutcome({ response: { status: 401 } })).toBe('unauthorized');
  });
  it('leaves the other classes alone', () => {
    expect(classifyCreateOutcome({ httpStatus: 400, message: 'bad' })).toBe('rejected');
    expect(classifyCreateOutcome({ httpStatus: 403, message: 'no' })).toBe('rejected');
    expect(classifyCreateOutcome({ httpStatus: 500, message: 'x' })).toBe('ambiguous');
    expect(classifyCreateOutcome({ httpStatus: 429, message: 'x' })).toBe('never-sent');
  });
});

describe('401 pauses work instead of failing it', () => {
  it('every step pauses on unauthorized, whatever its replay safety', () => {
    (['lead', 'appointment', 'calculator', 'documents', 'submit', 'consent', 'funding'] as const).forEach((step) => {
      expect(resolveStepDecision('unauthorized', work(), step)).toBe('pause');
    });
  });

  it('applyStepDecision(pause) keeps the work a draft and spends no attempt', () => {
    const w = work({ attempts: 2, status: 'uploading' });
    const next = applyStepDecision(w, 'pause', 'Unauthorized');
    expect(next.status).toBe('draft');
    expect(next.attempts).toBe(2);
    expect(next.lastError).toBe('Unauthorized');
    expect(uploadableWork([next])).toHaveLength(1);
  });

  it('a 401 on the last allowed attempt does not push the work to needs-review', () => {
    const w = work({ attempts: 4 });
    const next = applyStepDecision(w, decideAfterStepError({ httpStatus: 401 }, w, 'lead'));
    expect(next.status).toBe('draft');
    expect(next.attempts).toBe(4);
  });

  it('a genuine rejection still fails the work', () => {
    const w = work();
    const next = applyStepDecision(w, decideAfterStepError({ httpStatus: 422, message: 'bad' }, w, 'lead'));
    expect(next.status).toBe('failed');
  });

  it('the form-side create does not queue or call a 401 done', () => {
    expect(resolveRetryDecision('unauthorized', { leadType: 'selfGen' })).toBe('failed');
  });
});

describe('existing step rules are unchanged', () => {
  it('a network failure retries; an ambiguous idempotent step retries; an unguarded create needs review', () => {
    const w = work();
    expect(resolveStepDecision('never-sent', w, 'lead')).toBe('retry');
    expect(resolveStepDecision('ambiguous', w, 'outcome')).toBe('retry');
    expect(resolveStepDecision('ambiguous', w, 'documents')).toBe('retry-guarded');
    expect(resolveStepDecision('ambiguous', w, 'lead')).toBe('needs-review');
  });
  it('retry attempts still stop at 5', () => {
    const w = work({ attempts: 4 });
    expect(applyStepDecision(w, 'retry', 'x').status).toBe('needs-review');
  });
  it('steps still run in order', () => {
    expect(nextUploadStep(work())).toBe('lead');
    expect(stepReplaySafety('lead')).toBe('unique-key');
  });
});
