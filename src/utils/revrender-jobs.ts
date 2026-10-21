/**
 * revrender-jobs.ts - the rules of a revRender queue, pure and RN-free so they can be tested (docs/claude/offline.md,
 * "revRender queue resilience").
 *
 * The model, in one paragraph: a render is submitted with `POST /rev-render/v1/batches`. If the server ANSWERS, the reply carries
 * a `batchId` - from that moment the render runs on the server whatever the phone does, so the id is persisted and polled
 * (`GET /rev-render/v1/batches/:batchId`) until it is terminal. If the reply never arrives (transport failure, timeout) the
 * render is NOT known to exist: the card says so with the real reason, keeps its payload, and offers Retry.
 *
 * ⚠️ Keyed off the ERROR, never off `isOnline()` (utils/network-error.ts): a request that dies in a tunnel is the same event
 * whatever the connectivity model believed when it was sent.
 */
import { httpStatusOf, isNetworkError } from './network-error';

export type RenderStatus = 'pending' | 'running' | 'completed' | 'failed';

export type RenderErrorKind =
  /** The server took longer than the submit timeout: it MAY have accepted the render. */
  | 'timeout'
  /** No answer at all (dropped connection / no signal). */
  | 'network'
  /** 503 / 429: the render model is busy. */
  | 'busy'
  /** 401: the session is gone - not the render's fault. */
  | 'auth'
  /** 4xx: the server refused the request. */
  | 'rejected'
  /** 5xx. */
  | 'server'
  /** The batch was accepted and then FAILED on the server (model error, cancelled). */
  | 'render'
  /** The app was closed while the submit was in flight: nobody knows whether it landed. */
  | 'interrupted'
  | 'unknown';

export interface RevRenderJob {
  id: string | number;
  status: RenderStatus;
  payload: any;
  progress: number;
  /** Set the moment the POST is answered. From here the render is the SERVER's. */
  batchId?: string;
  /** Renders the batch produces (`batch.total`), when it says more than one. */
  total?: number;
  /** When the POST was sent (ms) - the clock the live estimate runs on. Shifted forward by any time spent waiting for signal. */
  startedAt?: number;
  /** When the poll first failed on transport (ms) - the estimate holds its value from here. */
  waitingAt?: number;
  /** A status poll died on transport: the render is very probably still running. */
  waiting?: boolean;
  error?: string;
  errorKind?: RenderErrorKind;
  /** The server may have accepted it (timeout / interrupted): check Tools before retrying, a retry can bill twice. */
  ambiguous?: boolean;
  /** Failed submits: how many times the rep retried. */
  attempts?: number;
}

export interface RenderErrorInfo {
  kind: RenderErrorKind;
  message: string;
  ambiguous: boolean;
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The server's own sentence, wherever the API wrapper put it (`{ message }`, `{ error: '{"error":{"message"}}' }`, ...). */
export const serverMessageOf = (err: any): string => {
  const parse = (raw: any): any => {
    if (typeof raw !== 'string') return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };
  const body = parse(err?.error);
  return (
    textOf(body?.error?.message) ||
    textOf(body?.message) ||
    (typeof body === 'string' ? textOf(body) : '') ||
    textOf(err?.response?.data?.message) ||
    textOf(err?.response?.data?.error?.message) ||
    textOf(err?.data?.message) ||
    textOf(err?.message)
  );
};

const isTimeout = (err: any): boolean =>
  err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || /timeout|timed out/i.test(textOf(err?.message));

export const NETWORK_RENDER_MESSAGE =
  'Network error - the app could not reach the server. Check your connection and tap Retry.';
export const TIMEOUT_RENDER_MESSAGE =
  "The server took too long to answer. We couldn't confirm this render started - check Tools before retrying so you aren't charged twice.";
export const INTERRUPTED_RENDER_MESSAGE =
  "The app was closed before we could confirm this render started - check Tools before retrying so you aren't charged twice.";
export const BUSY_RENDER_MESSAGE = 'The AI model is busy right now. Please try again in a few minutes.';

/** Why a SUBMIT (the POST) failed, in words a rep can act on. A server verdict keeps the server's own text. */
export const classifyRenderSubmitError = (err: unknown): RenderErrorInfo => {
  const status = httpStatusOf(err);
  const server = serverMessageOf(err);

  if (status === undefined) {
    if (isTimeout(err)) return { kind: 'timeout', message: TIMEOUT_RENDER_MESSAGE, ambiguous: true };
    if (isNetworkError(err)) return { kind: 'network', message: NETWORK_RENDER_MESSAGE, ambiguous: false };
    return { kind: 'unknown', message: server || 'The render could not be started.', ambiguous: false };
  }
  if (status === 401) {
    return { kind: 'auth', message: 'Your session expired. Sign in again, then tap Retry.', ambiguous: false };
  }
  if (status === 503 || status === 429) {
    return { kind: 'busy', message: server || BUSY_RENDER_MESSAGE, ambiguous: false };
  }
  if (status >= 500) {
    return { kind: 'server', message: server || 'The server had a problem starting this render. Tap Retry.', ambiguous: status === 504 };
  }
  return { kind: 'rejected', message: server || 'The server refused this render.', ambiguous: false };
};

/** The batch id out of the POST reply, whichever envelope the backend used. */
export const extractBatchId = (resData: any): string | null => {
  const id =
    resData?.batch?.batchId ||
    resData?.batchId ||
    resData?.id ||
    resData?.data?.batchId ||
    resData?.data?.batch?.batchId ||
    resData?.batch?.id;
  return id ? String(id) : null;
};

/** `batch.total` when the batch produces more than one render, else 0. */
export const extractBatchTotal = (resData: any): number =>
  Number(resData?.batch?.total ?? resData?.data?.batch?.total ?? resData?.total ?? 0) || 0;

/** The backend's own reason a batch failed (first failed job's error), prefixed with the view it belongs to. */
export const batchFailureMessage = (batch: any): string => {
  const failedJob = Array.isArray(batch?.jobs) ? batch.jobs.find((j: any) => j?.status === 'failed' && j?.error) : null;
  if (!failedJob) return batch?.message || 'Rendering failed or was cancelled';

  let backend: string | null = null;
  try {
    const parsed = typeof failedJob.error === 'string' ? JSON.parse(failedJob.error) : failedJob.error;
    backend = parsed?.error?.message || parsed?.message || null;
  } catch {
    backend = typeof failedJob.error === 'string' ? failedJob.error : null;
  }
  if (!backend) return batch?.message || 'Rendering failed or was cancelled';
  return failedJob.viewLabel ? `${failedJob.viewLabel}: ${backend}` : backend;
};

export interface BatchReading {
  state: 'running' | 'done' | 'failed';
  total: number;
  /** Renders the batch has finished (succeeded + failed) - 0 when it does not say. */
  finished: number;
  message?: string;
}

/**
 * What one `GET /rev-render/v1/batches/:id` reply means. The batch is ONE job per submitted payload, so `done` means every render
 * in it succeeded; ANY failed render makes the batch failed (the rep sees the backend's reason and can retry that render).
 */
export const interpretBatch = (raw: any): BatchReading => {
  const batch = raw?.batch || raw?.data?.batch || raw;
  const status = String(batch?.status || '').toLowerCase();
  const total = Number(batch?.total) || 1;
  const succeeded = Number(batch?.succeeded) || 0;
  const failed = Number(batch?.failed) || 0;
  const finished = succeeded + failed;

  const finishedStatus = status === 'done' || status === 'completed' || status === 'succeeded';
  const anySucceeded = status === 'completed' || status === 'succeeded' || succeeded > 0;

  if (finishedStatus && anySucceeded && !failed) return { state: 'done', total, finished: total };
  if (status === 'failed' || status === 'cancelled' || status === 'canceled' || (finishedStatus && failed > 0)) {
    return { state: 'failed', total, finished, message: batchFailureMessage(batch) };
  }
  return { state: 'running', total, finished };
};

/** Progress that a SERVER contact produced: only for a batch of several renders. Never invented from elapsed time. */
export const batchProgress = (reading: BatchReading): number | null => {
  if (reading.state !== 'running' || reading.total <= 1) return null;
  const pct = Math.round((reading.finished / reading.total) * 100);
  return Math.min(99, pct);
};

/** An average render takes about this long (ms); the live estimate eases toward ESTIMATE_CAP over it. */
const ESTIMATE_TAU_MS = 20_000;
const ESTIMATE_CAP = 92;

/**
 * The bar's value for one job, 0-100. An ESTIMATE that moves in real time: eased from the moment the POST was sent, capped at
 * 92 so it never claims "done" before the server says so, never below what the server reported (`progress`), and FROZEN while
 * the job is waiting for signal (amber) - a bar that keeps filling with no server contact is the lie the earlier pass removed.
 */
export const estimateJobProgress = (job: RevRenderJob, now: number = Date.now()): number => {
  if (job.status === 'completed') return 100;
  if (job.status !== 'running' || !job.startedAt) return Math.max(0, job.progress || 0);
  const until = job.waiting && job.waitingAt ? Math.min(now, job.waitingAt) : now;
  const elapsed = Math.max(0, until - job.startedAt);
  const eased = ESTIMATE_CAP * (1 - Math.exp(-elapsed / ESTIMATE_TAU_MS));
  return Math.min(ESTIMATE_CAP, Math.max(Math.round(eased), job.progress || 0));
};

/** The whole queue's bar: mean of every job still counted (failed ones are shown on their own card, not averaged in). */
export const queueProgress = (jobs: RevRenderJob[], now: number = Date.now()): number => {
  const counted = jobs.filter((j) => j.status !== 'failed');
  if (!counted.length) return 0;
  return Math.round(counted.reduce((sum, j) => sum + estimateJobProgress(j, now), 0) / counted.length);
};

export const isTerminal = (job: Pick<RevRenderJob, 'status'>): boolean => job.status === 'completed' || job.status === 'failed';

/** What the Lead Center shows over the queue: honest counts, never a percentage no server contact produced. */
export const queueCounts = (jobs: RevRenderJob[]) => {
  const active = jobs.filter((j) => !isTerminal(j));
  const done = jobs.filter((j) => j.status === 'completed').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;
  const waiting = active.some((j) => j.waiting);
  const total = jobs.length;
  return {
    total,
    active: active.length,
    done,
    failed,
    waiting,
    label: active.length ? `${done} of ${total} done` : '',
  };
};

/** The toast when a queue settles. Never "finished - check results" when nothing succeeded. */
export const summarizeFinish = (succeeded: number, failed: number): { title: string; message: string; tone: 'success' | 'warning' | 'error' } => {
  const total = succeeded + failed;
  if (!failed) {
    return { title: 'RevRender finished', message: `${succeeded} render${succeeded === 1 ? '' : 's'} ready - check results in the Tools tab.`, tone: 'success' };
  }
  if (!succeeded) {
    return {
      title: 'RevRender failed',
      message: `${failed === 1 ? 'The render' : `All ${failed} renders`} did not finish. Open the Tools tab to retry.`,
      tone: 'error',
    };
  }
  return { title: 'RevRender', message: `${succeeded} of ${total} renders finished. ${failed} need${failed === 1 ? 's' : ''} retrying.`, tone: 'warning' };
};

/**
 * A job read back from storage after the app was closed / the screen unmounted.
 *  - has a `batchId` and is not terminal -> RESUME polling (the render is the server's);
 *  - never got a `batchId` -> the submit was in flight when the app died: nobody knows -> failed, ambiguous, Retry;
 *  - completed -> dropped (already shown in the runs list); failed -> kept.
 */
export const reviveJobs = (saved: RevRenderJob[]): RevRenderJob[] =>
  (Array.isArray(saved) ? saved : [])
    .filter((j) => j && j.status !== 'completed')
    .map((j) => {
      if (j.status === 'failed' || j.batchId) return j;
      return { ...j, status: 'failed' as const, error: INTERRUPTED_RENDER_MESSAGE, errorKind: 'interrupted' as const, ambiguous: true, waiting: false };
    });

/** Jobs whose status must be polled. */
export const jobsToPoll = (jobs: RevRenderJob[]): RevRenderJob[] =>
  jobs.filter((j) => !!j.batchId && (j.status === 'running' || j.status === 'pending'));

/** A poll that failed on something the server ANSWERED. 404s/5xx are tolerated a few times before the job is failed. */
export const MAX_POLL_REJECTIONS = 8;

export type PollFailure = 'wait' | 'retry-later' | 'fail';

/** `wait`: transport / session - hold, never fail. `retry-later`: a server answer worth another tick. `fail`: give up. */
export const classifyPollFailure = (err: unknown, consecutiveRejections: number): PollFailure => {
  if (isNetworkError(err)) return 'wait';
  const status = httpStatusOf(err);
  if (status === 401) return 'wait';
  return consecutiveRejections + 1 >= MAX_POLL_REJECTIONS ? 'fail' : 'retry-later';
};
