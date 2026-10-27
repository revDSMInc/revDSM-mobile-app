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
  it('a network failure retries; an ambiguous idempotent step retries; a guarded step re-reads first', () => {
    const w = work();
    expect(resolveStepDecision('never-sent', w, 'lead')).toBe('retry');
    expect(resolveStepDecision('ambiguous', w, 'outcome')).toBe('retry');
    expect(resolveStepDecision('ambiguous', w, 'documents')).toBe('retry-guarded');
    // ⚠️ Was 'needs-review'. The backend honours our idempotency key on POST lead/v1/create
    // (2026-10-16), so replaying a Self Gen returns the ORIGINAL lead instead of making a
    // second one — the create is now safe to retry rather than parking the rep's work.
    expect(resolveStepDecision('ambiguous', w, 'lead')).toBe('retry');
  });
  it('retry attempts still stop at 5', () => {
    const w = work({ attempts: 4 });
    expect(applyStepDecision(w, 'retry', 'x').status).toBe('needs-review');
  });
  it('steps still run in order', () => {
    expect(nextUploadStep(work())).toBe('lead');
    // ⚠️ Was 'unique-key' until the server began honouring the idempotency key.
    expect(stepReplaySafety('lead')).toBe('idempotent');
  });
});


/**
 * The 409 that reached the client as "Couldn't be uploaded" after an offline sync.
 * It only ever happened offline: online each calculator is created on its own against a server
 * that already knows the earlier ones, so the clash is caught in the UI before any request.
 */
describe('a 409 conflict is recoverable, not a rejection', () => {
  it('classifies 409 as duplicate rather than rejected', () => {
    expect(classifyCreateOutcome({ httpStatus: 409, message: 'title must be unique' })).toBe(
      'duplicate'
    );
    expect(classifyCreateOutcome({ response: { status: 409 } })).toBe('duplicate');
  });

  it('still treats other 4xx as a rejection', () => {
    expect(classifyCreateOutcome({ httpStatus: 400 })).toBe('rejected');
    expect(classifyCreateOutcome({ httpStatus: 422 })).toBe('rejected');
  });

  // The old behaviour: straight to a dead end on the first attempt, no adoption attempted.
  it('gives a guarded step a chance to adopt what is already there', () => {
    expect(resolveStepDecision('duplicate', work(), 'calculator')).toBe('retry-guarded');
    expect(resolveStepDecision('duplicate', work(), 'appointment')).toBe('retry-guarded');
    expect(stepReplaySafety('calculator')).toBe('guarded');
  });

  it('retries an idempotent step on a conflict', () => {
    expect(resolveStepDecision('duplicate', work(), 'calculatorState')).toBe('retry');
  });

  it('end to end: a 409 on the calculator step asks for a guarded retry', () => {
    expect(decideAfterStepError({ httpStatus: 409 }, work(), 'calculator')).toBe('retry-guarded');
  });

  // Unchanged: the lead step's own rules still decide, and a Self Gen still needs a human.
  it('leaves the lead step alone', () => {
    expect(resolveStepDecision('duplicate', work({ lead: { leadType: 'lfLead', lfLeadId: 'X' } as any }), 'lead')).toBe(
      'done'
    );
    expect(resolveStepDecision('duplicate', work(), 'lead')).toBe('needs-review');
  });

  // A conflict that adoption cannot resolve (two genuinely identical calculators) must not spin
  // forever - the attempt budget is what stops it.
  it('still gives up after the attempt budget, so a real clash is not an infinite loop', () => {
    let w = work({ attempts: 4 });
    w = applyStepDecision(w, 'retry-guarded', 'title must be unique');
    expect(w.status).toBe('needs-review');
  });
});
