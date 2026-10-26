/**
 * The revRender queue as a MODULE-LEVEL manager (docs/claude/offline.md, "revRender queue resilience").
 *
 * It used to live in `useLeadReports`' `handleStartRevRenders` closure, so leaving the Lead Center killed the poll, an app restart
 * left restored cards frozen forever, and a failed batch wiped the rep's queue. Here the queue outlives any screen:
 *
 *   submit  POST /rev-render/v1/batches          -> reply carries `batchId`  => PERSISTED at once, the render is the server's
 *                                                -> no reply (timeout / no signal) => the card FAILS with the real reason + Retry
 *   poll    GET  /rev-render/v1/batches/:batchId -> every 3 s; a transport failure only marks the card `waiting` (amber)
 *   resume  on screen mount, on reconnect, on foreground: every job with a `batchId` that is not terminal is polled again
 *
 * ⚠️ MMKV is written HERE, before listeners run - never from inside a React `setState` updater (an unmounted fiber never calls the
 * updater, which silently stopped persistence and let the queue vanish).
 * ⚠️ A failed job is KEPT (payload included) until the rep retries or dismisses it; only completed jobs are cleared.
 * ⚠️ Never auto-resubmit a submit that timed out: the server may have accepted it and a second POST bills twice.
 */
import { AppState } from 'react-native';
import { Storage } from '../utils/storage';
import { LeadService } from './api/leads';
import { queryClient } from './api/queryClient';
import { FlashMessage } from '../config/message';
import { onReconnect } from './connectivity';
import {
  batchProgress,
  classifyPollFailure,
  classifyRenderSubmitError,
  extractBatchId,
  extractBatchTotal,
  interpretBatch,
  isTerminal,
  jobsToPoll,
  reviveJobs,
  summarizeFinish,
  type RevRenderJob,
} from '../utils/revrender-jobs';

const POLL_MS = 3000;
const keyFor = (leadId: string) => `rev_render_jobs_${leadId}`;

const jobsByLead: Record<string, RevRenderJob[]> = {};
const loaded = new Set<string>();
const listeners: Record<string, Set<() => void>> = {};
const finishListeners: Record<string, Set<() => void>> = {};
/** `${leadId}:${jobId}` whose poll loop is running in THIS process. */
const polling = new Set<string>();
/** Jobs whose POST is in flight right now (so a resume does not mistake them for an interrupted submit). */
const submitting = new Set<string>();

const pollKey = (leadId: string, jobId: string | number) => `${leadId}:${jobId}`;

const read = (leadId: string): RevRenderJob[] => {
  if (!loaded.has(leadId)) {
    loaded.add(leadId);
    try {
      const raw = Storage.getItem(keyFor(leadId));
      jobsByLead[leadId] = reviveJobs(raw ? JSON.parse(raw) : []);
    } catch {
      jobsByLead[leadId] = [];
    }
    // `reviveJobs` may have dropped / failed entries: write the cleaned list back.
    persist(leadId, false);
  }
  return jobsByLead[leadId] || [];
};

const emit = (set: Set<() => void> | undefined) => {
  set?.forEach((fn) => {
    try {
      fn();
    } catch (e) {
      console.warn('[RevRenderJobs] listener failed', e);
    }
  });
};

/** Persist FIRST, then tell React. Deletes the key only when nothing is left. */
const persist = (leadId: string, notify = true) => {
  const jobs = jobsByLead[leadId] || [];
  try {
    if (jobs.length) Storage.setItem(keyFor(leadId), JSON.stringify(jobs));
    else Storage.removeItem(keyFor(leadId));
  } catch (e) {
    console.warn('[RevRenderJobs] could not save the queue', e);
  }
  if (notify) emit(listeners[leadId]);
};

const patch = (leadId: string, jobId: string | number, change: Partial<RevRenderJob> | ((j: RevRenderJob) => Partial<RevRenderJob>)) => {
  const jobs = read(leadId);
  const idx = jobs.findIndex((j) => String(j.id) === String(jobId));
  if (idx < 0) return;
  const delta = typeof change === 'function' ? change(jobs[idx]) : change;
  jobsByLead[leadId] = jobs.map((j, i) => (i === idx ? { ...j, ...delta } : j));
  persist(leadId);
};

export const getRevRenderJobs = (leadId: string): RevRenderJob[] => (leadId ? read(leadId) : []);

export const subscribeRevRenderJobs = (leadId: string, fn: () => void): (() => void) => {
  (listeners[leadId] ||= new Set()).add(fn);
  return () => listeners[leadId]?.delete(fn);
};

/** Fires when a queue settles (nothing left running) - the Lead Center re-reads the runs. */
export const onRevRenderFinished = (leadId: string, fn: () => void): (() => void) => {
  (finishListeners[leadId] ||= new Set()).add(fn);
  return () => finishListeners[leadId]?.delete(fn);
};

/** Clears the completed jobs, keeps the failed ones, tells the rep the real counts. Runs when nothing is left in flight. */
const maybeFinalize = (leadId: string) => {
  const jobs = read(leadId);
  if (!jobs.length || jobs.some((j) => !isTerminal(j))) return;
  const succeeded = jobs.filter((j) => j.status === 'completed').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  jobsByLead[leadId] = jobs.filter((j) => j.status === 'failed');
  persist(leadId);

  const summary = summarizeFinish(succeeded, failed);
  if (summary.tone === 'success') FlashMessage.success(summary.title, summary.message);
  else if (summary.tone === 'warning') FlashMessage.warning(summary.title, summary.message);
  else FlashMessage.error(summary.title, summary.message);

  queryClient.invalidateQueries({ queryKey: ['revrender-runs', leadId] });
  emit(finishListeners[leadId]);
};

// --- polling --------------------------------------------------------------------------------------------------------------
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const startPolling = (leadId: string, jobId: string | number) => {
  const key = pollKey(leadId, jobId);
  if (polling.has(key)) return;
  polling.add(key);
  void (async () => {
    let rejections = 0;
    try {
      for (;;) {
        await sleep(POLL_MS);
        const job = read(leadId).find((j) => String(j.id) === String(jobId));
        if (!job || !job.batchId || isTerminal(job)) return; // dismissed, or already settled

        try {
          const res = await LeadService.getRevRenderBatchStatus(job.batchId);
          rejections = 0;
          // Reached again: the time spent waiting does not count toward the estimate.
          if (job.waiting) {
            patch(leadId, jobId, (j) => ({
              waiting: false,
              waitingAt: undefined,
              startedAt: j.startedAt && j.waitingAt ? j.startedAt + (Date.now() - j.waitingAt) : j.startedAt,
            }));
          }

          const reading = interpretBatch(res.data);
          if (reading.state === 'done') {
            patch(leadId, jobId, { status: 'completed', progress: 100, waiting: false });
            maybeFinalize(leadId);
            return;
          }
          if (reading.state === 'failed') {
            patch(leadId, jobId, { status: 'failed', error: reading.message, errorKind: 'render', ambiguous: false, waiting: false });
            maybeFinalize(leadId);
            return;
          }
          const progress = batchProgress(reading);
          if (reading.total > 1 && (Number(job.total) || 1) !== reading.total) patch(leadId, jobId, { total: reading.total });
          if (progress !== null && progress > (job.progress || 0)) patch(leadId, jobId, { progress });
        } catch (err: any) {
          const verdict = classifyPollFailure(err, rejections);
          if (verdict === 'wait') {
            // ⚠️ The render runs on the SERVER; losing signal does not cancel it. Hold, mark waiting, keep looping.
            if (!job.waiting) patch(leadId, jobId, { waiting: true, waitingAt: Date.now() });
          } else if (verdict === 'fail') {
            const info = classifyRenderSubmitError(err);
            patch(leadId, jobId, { status: 'failed', error: info.message, errorKind: info.kind, ambiguous: true, waiting: false });
            maybeFinalize(leadId);
            return;
          } else {
            rejections += 1;
          }
        }
      }
    } finally {
      polling.delete(key);
    }
  })();
};

// --- submit ---------------------------------------------------------------------------------------------------------------
type SubmitOutcome = 'accepted' | 'failed';

const submitJob = async (leadId: string, jobId: string | number): Promise<SubmitOutcome> => {
  const job = read(leadId).find((j) => String(j.id) === String(jobId));
  if (!job) return 'failed';
  const key = pollKey(leadId, jobId);
  submitting.add(key);
  patch(leadId, jobId, {
    status: 'running',
    startedAt: Date.now(),
    waitingAt: undefined,
    progress: 0,
    batchId: undefined,
    total: undefined,
    waiting: false,
    error: undefined,
    errorKind: undefined,
    ambiguous: undefined,
  });
  try {
    const res = await LeadService.generateRevRender(job.payload);
    const batchId = extractBatchId(res.data);
    if (!batchId) {
      // An answer with no batch id: nothing to poll - treat it as done, as before.
      patch(leadId, jobId, { status: 'completed', progress: 100 });
      maybeFinalize(leadId);
      return 'accepted';
    }
    // ⚠️ Persisted BEFORE anything else: from here the render is the server's, whatever the phone does next.
    const total = extractBatchTotal(res.data);
    patch(leadId, jobId, { batchId, ...(total > 1 ? { total } : {}) });
    startPolling(leadId, jobId);
    return 'accepted';
  } catch (err: any) {
    const info = classifyRenderSubmitError(err);
    console.warn('[RevRenderJobs] submit failed:', info.kind, info.message);
    patch(leadId, jobId, {
      status: 'failed',
      error: info.message,
      errorKind: info.kind,
      ambiguous: info.ambiguous,
      attempts: (job.attempts || 0) + (job.error ? 1 : 0),
      waiting: false,
    });
    return 'failed';
  } finally {
    submitting.delete(key);
  }
};

const newJobId = () => `rr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

export interface StartRevRendersResult {
  accepted: number;
  failed: number;
  /** The first failure's explanation, for the caller's toast. */
  firstError?: string;
}

/**
 * Adds the renders to this lead's queue and submits them. Resolves once every POST has been ANSWERED or has failed - NOT when
 * the renders finish. Every job keeps its payload, so a failure never costs the rep their configuration.
 */
export const startRevRenders = async (leadId: string, payloads: any[]): Promise<StartRevRendersResult> => {
  if (!leadId || !payloads.length) return { accepted: 0, failed: 0 };
  const created: RevRenderJob[] = payloads.map((payload) => ({ id: newJobId(), status: 'pending', payload, progress: 0 }));
  jobsByLead[leadId] = [...read(leadId), ...created];
  persist(leadId);
  ensureLifecycle();

  FlashMessage.info(`Starting ${payloads.length} render generation(s)...`, 'RevRender');
  const outcomes = await Promise.all(created.map((j) => submitJob(leadId, j.id)));
  const failed = outcomes.filter((o) => o === 'failed').length;
  const result: StartRevRendersResult = { accepted: outcomes.length - failed, failed };
  if (failed) {
    const firstFailed = read(leadId).find((j) => created.some((c) => c.id === j.id) && j.status === 'failed');
    result.firstError = firstFailed?.error;
    FlashMessage.error(
      failed === outcomes.length ? 'RevRender not started' : `${failed} of ${outcomes.length} renders not started`,
      `${firstFailed?.error || 'Tap Retry on the render in the Tools tab.'}`
    );
  }
  maybeFinalize(leadId);
  return result;
};

/** Retry a failed render: re-submits the SAME payload (kept on the card). */
export const retryRevRender = async (leadId: string, jobId: string | number): Promise<void> => {
  const job = read(leadId).find((j) => String(j.id) === String(jobId));
  if (!job || job.status !== 'failed') return;
  ensureLifecycle();
  const outcome = await submitJob(leadId, jobId);
  if (outcome === 'failed') {
    const again = read(leadId).find((j) => String(j.id) === String(jobId));
    FlashMessage.error('RevRender not started', again?.error || 'Please try again.');
  }
  maybeFinalize(leadId);
};

/**
 * Retry EVERY failed render for this lead, reporting once.
 *
 * ⚠️ Not a loop over `retryRevRender` at the call site. That one raises its own
 * `FlashMessage.error` per job, so retrying a batch of five that fails again would stack five
 * identical toasts - the same pile-up the single collapsed row exists to remove. One summary,
 * like `startRevRenders` already does for a batch.
 */
export const retryAllRevRenders = async (leadId: string): Promise<void> => {
  const failed = read(leadId).filter((j) => j.status === 'failed');
  if (!failed.length) return;
  ensureLifecycle();
  const outcomes = await Promise.all(failed.map((j) => submitJob(leadId, j.id)));
  const stillFailed = outcomes.filter((o) => o === 'failed').length;
  if (stillFailed) {
    const first = read(leadId).find(
      (j) => failed.some((f) => f.id === j.id) && j.status === 'failed'
    );
    FlashMessage.error(
      stillFailed === outcomes.length
        ? 'RevRender not started'
        : `${stillFailed} of ${outcomes.length} renders not started`,
      first?.error || 'Please try again.'
    );
  }
  maybeFinalize(leadId);
};

/** Dismiss every failed render for this lead in one write. */
export const dismissAllRevRenders = (leadId: string): void => {
  const before = read(leadId);
  const next = before.filter((j) => j.status !== 'failed');
  if (next.length === before.length) return;
  jobsByLead[leadId] = next;
  persist(leadId);
};

export const dismissRevRender = (leadId: string, jobId: string | number): void => {
  jobsByLead[leadId] = read(leadId).filter((j) => String(j.id) !== String(jobId));
  persist(leadId);
};

/** Restarts the poll of every job that has a `batchId` and is not terminal. Safe to call any time (idempotent). */
export const resumeRevRenderJobs = (leadId: string): void => {
  if (!leadId) return;
  ensureLifecycle();
  const jobs = read(leadId);
  // A job with no batchId that is not mid-submit in THIS process was interrupted (app closed): fail it, ambiguous.
  const stale = jobs.filter((j) => !isTerminal(j) && !j.batchId && !submitting.has(pollKey(leadId, j.id)));
  if (stale.length) {
    const revived = reviveJobs(stale);
    jobsByLead[leadId] = jobs.map((j) => revived.find((r) => String(r.id) === String(j.id)) || j);
    persist(leadId);
  }
  jobsToPoll(read(leadId)).forEach((j) => startPolling(leadId, j.id));
};

let lifecycleStarted = false;
/** Resumes every loaded lead's polling on reconnect and on foreground. */
function ensureLifecycle() {
  if (lifecycleStarted) return;
  lifecycleStarted = true;
  const resumeAll = () => Array.from(loaded).forEach((id) => resumeRevRenderJobs(id));
  onReconnect(resumeAll);
  AppState.addEventListener('change', (next) => {
    if (next === 'active') resumeAll();
  });
}
