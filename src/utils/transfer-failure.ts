/**
 * ONE rule for "what does this failed transfer mean", shared by every offline queue.
 *
 * Pure on purpose (the queues import react-native / blob-util and cannot be loaded under jest).
 *
 * Why it exists: on a real cellular link most failures are NOT an answer from the server about the
 * item - a socket dies mid-body, a gateway answers 502/504, a carrier proxy answers 403, a slow
 * uplink hits the timeout. The photo queue counted every one of those as a spent attempt, so five
 * bad minutes parked a perfectly good photo until the rep tapped Retry. Wi-Fi and flight mode never
 * produce them, which is why the same code looked fine in manual testing.
 *
 *   auth       401 - the session is gone, not the item. Keep it, pause, spend nothing.
 *   transport  no HTTP answer at all (timeout, reset, DNS, TLS, aborted). Keep it, back off.
 *   transient  an HTTP answer that says nothing about the item (408/425/429, 5xx incl. gateway
 *              errors, and 403 - a WAF / captive portal / carrier proxy answers 403 for a request
 *              our API never saw). Keep it, back off.
 *   rejected   our API looked at the item and refused it (400/404/413/415/422 ...). Counts as an
 *              attempt; only these may park an item on an attempt budget.
 *
 * ⚠️ `transport` and `transient` NEVER spend an attempt. They are bounded by TIME instead
 * (`TRANSIENT_GIVE_UP_MS`), because an endpoint that has answered 500 for a day is broken, not
 * slow - and the item is then PARKED (kept, visible, retryable), never deleted.
 */
import { httpStatusOf } from './network-error';

export type TransferFailure = 'auth' | 'transport' | 'transient' | 'rejected';

const TRANSIENT_STATUSES = new Set([403, 408, 425, 429]);

export const classifyTransferFailure = (err: unknown): TransferFailure => {
  const status = httpStatusOf(err);
  if (status === 401) return 'auth';
  // No HTTP answer at all. Even an error with no recognisable network wording is a transport
  // failure here: a queued transfer that died without an answer is undelivered, and calling it
  // `rejected` would spend attempts on something the server never judged.
  if (status === undefined) return 'transport';
  if (status >= 500) return 'transient';
  if (TRANSIENT_STATUSES.has(status)) return 'transient';
  return 'rejected';
};

/** Failures that say nothing about the item: they spend no attempt and wait. */
export const isFreeFailure = (kind: TransferFailure): boolean =>
  kind === 'transport' || kind === 'transient';

/** How long an item may keep failing "for free" before it is parked for the rep to look at. */
export const TRANSIENT_GIVE_UP_MS = 24 * 60 * 60 * 1000;

export const transientExpired = (since: number | undefined, now: number = Date.now()): boolean =>
  typeof since === 'number' && now - since >= TRANSIENT_GIVE_UP_MS;

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_CAP_MS = 2 * 60_000;

/**
 * 5 s, 10 s, 20 s, 40 s, 80 s, then 2 m, +-20% jitter so a fleet of phones that lost the same
 * tower does not retry in lockstep. `failures` is the number of free failures so far (>= 1).
 */
export const transientBackoffMs = (failures: number, random: () => number = Math.random): number => {
  const n = Math.max(1, Math.floor(failures || 1));
  const base = Math.min(BACKOFF_BASE_MS * 2 ** (n - 1), BACKOFF_CAP_MS);
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
};

export interface FreeFailureState {
  transientSince?: number;
  transientCount?: number;
  nextAttemptAt?: number;
  parkedAt?: string;
  lastError?: string;
}

/**
 * The state of an item after one free failure: due again after a backoff, or parked once it has
 * been failing for `TRANSIENT_GIVE_UP_MS`. Never touches the item's attempt counter.
 */
export const afterFreeFailure = <T extends FreeFailureState>(
  item: T,
  options: { error?: string; now?: number; random?: () => number } = {}
): T => {
  const now = options.now ?? Date.now();
  const transientSince = item.transientSince ?? now;
  const transientCount = (item.transientCount || 0) + 1;
  const base = { ...item, transientSince, transientCount, lastError: options.error ?? item.lastError };
  if (transientExpired(transientSince, now)) {
    return { ...base, parkedAt: new Date(now).toISOString(), nextAttemptAt: undefined };
  }
  return { ...base, nextAttemptAt: now + transientBackoffMs(transientCount, options.random) };
};

/** A successful pass, a manual retry or a reconnect: forget the failure streak and the wait. */
export const clearFreeFailure = <T extends FreeFailureState>(item: T): T => ({
  ...item,
  transientSince: undefined,
  transientCount: undefined,
  nextAttemptAt: undefined,
});

/** Make a waiting item due now (a real reconnect), without touching its failure history. */
export const makeDueNow = <T extends FreeFailureState>(item: T): T =>
  item.nextAttemptAt === undefined ? item : { ...item, nextAttemptAt: undefined };

/**
 * For the lead-sync and activity-log queues, whose budgets are "refusals", not "bad minutes":
 * did this failure leave the work UNDELIVERED rather than refused? True for no response at all,
 * 408/425/429 and any 5xx (a gateway error under load). Deliberately FALSE for 403: a genuine
 * permission refusal must still count so the work reaches `needs-review` instead of looping
 * forever, while a carrier-proxy 403 stays recoverable through that same visible state.
 */
export const leavesWorkUndelivered = (err: unknown): boolean => {
  const kind = classifyTransferFailure(err);
  if (kind === 'transport') return true;
  if (kind !== 'transient') return false;
  return httpStatusOf(err) !== 403;
};
