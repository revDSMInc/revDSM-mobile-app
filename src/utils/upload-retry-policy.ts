/**
 * Retry rules shared by the offline photo queue and the installer image queue.
 *
 * Pure on purpose: both queues import react-native / blob-util and cannot be loaded under jest.
 */

/** Attempts before a queued photo is PARKED (kept on the device, waiting for the rep). */
export const MAX_PHOTO_ATTEMPTS = 5;

/** Attempts before a queued installer image is parked. */
export const MAX_INSTALLER_ATTEMPTS = 8;

const INSTALLER_BACKOFF_BASE_MS = 30_000;
const INSTALLER_BACKOFF_CAP_MS = 15 * 60_000;

/** 30 s, 1 m, 2 m, 4 m, 8 m, then 15 m. `attempts` is the number of failures so far. */
export const installerBackoffMs = (attempts: number): number => {
  const n = Math.max(1, Math.floor(attempts || 1));
  return Math.min(INSTALLER_BACKOFF_BASE_MS * 2 ** (n - 1), INSTALLER_BACKOFF_CAP_MS);
};

/** The HTTP status carried by an axios error OR by the api wrapper's normalised rejection. */
export const httpStatusOf = (err: unknown): number | undefined => {
  const e = err as any;
  const s = e?.httpStatus ?? e?.response?.status ?? e?.status;
  return typeof s === 'number' ? s : undefined;
};

/**
 * ⚠️ A 401 means "the session is gone", never "this item is bad". It must not burn an attempt
 * (it used to drop a photo / fail a deal for something the rep cannot fix by retrying).
 */
export const isUnauthorizedError = (err: unknown): boolean => httpStatusOf(err) === 401;

export interface ParkableItem {
  parkedAt?: string;
  attempts?: number;
  nextAttemptAt?: number;
}

export const isParked = (item: ParkableItem | null | undefined): boolean => !!item?.parkedAt;

export const isDue = (item: ParkableItem | null | undefined, now: number = Date.now()): boolean =>
  !!item && !item.parkedAt && (item.nextAttemptAt ?? 0) <= now;

export const shouldPark = (attempts: number, max: number): boolean => attempts >= max;

/** The state of an item after one more failed attempt. */
export const afterFailure = <T extends ParkableItem>(
  item: T,
  max: number,
  options: { error?: string; now?: number; backoff?: (attempts: number) => number } = {}
): T & { attempts: number; lastError?: string } => {
  const now = options.now ?? Date.now();
  const attempts = (item.attempts || 0) + 1;
  const base = { ...item, attempts, lastError: options.error };
  if (shouldPark(attempts, max)) {
    return { ...base, parkedAt: new Date(now).toISOString(), nextAttemptAt: undefined };
  }
  return { ...base, nextAttemptAt: options.backoff ? now + options.backoff(attempts) : undefined };
};

/** A manual retry: back to a clean slate and due now. */
export const rearmItem = <T extends ParkableItem>(item: T): T & { attempts: number } => ({
  ...item,
  attempts: 0,
  parkedAt: undefined,
  nextAttemptAt: undefined,
  lastError: undefined,
});
