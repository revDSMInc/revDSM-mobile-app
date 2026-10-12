import {
  MAX_INSTALLER_ATTEMPTS,
  MAX_PHOTO_ATTEMPTS,
  afterFailure,
  httpStatusOf,
  installerBackoffMs,
  isDue,
  isParked,
  isUnauthorizedError,
  rearmItem,
} from '../../src/utils/upload-retry-policy';

describe('installerBackoffMs', () => {
  it('doubles from 30s and caps at 15 minutes', () => {
    expect([1, 2, 3, 4, 5].map(installerBackoffMs)).toEqual([30_000, 60_000, 120_000, 240_000, 480_000]);
    expect(installerBackoffMs(6)).toBe(900_000);
    expect(installerBackoffMs(50)).toBe(900_000);
  });
  it('treats a missing or zero count as the first failure', () => {
    expect(installerBackoffMs(0)).toBe(30_000);
    expect(installerBackoffMs(NaN)).toBe(30_000);
  });
});

describe('isUnauthorizedError / httpStatusOf', () => {
  it('reads the status from an axios error, the api wrapper rejection, or a bare status', () => {
    expect(httpStatusOf({ response: { status: 401 } })).toBe(401);
    expect(httpStatusOf({ httpStatus: 503 })).toBe(503);
    expect(httpStatusOf({ status: 404 })).toBe(404);
    expect(httpStatusOf(new Error('x'))).toBeUndefined();
    expect(httpStatusOf(null)).toBeUndefined();
  });
  it('only a 401 is "the session is gone"', () => {
    expect(isUnauthorizedError({ httpStatus: 401 })).toBe(true);
    expect(isUnauthorizedError({ response: { status: 401 } })).toBe(true);
    expect(isUnauthorizedError({ httpStatus: 403 })).toBe(false);
    expect(isUnauthorizedError({ httpStatus: 500 })).toBe(false);
    expect(isUnauthorizedError(new Error('Network Error'))).toBe(false);
  });
});

describe('afterFailure', () => {
  const now = 1_000_000;

  it('counts the failure and schedules the next try', () => {
    const next = afterFailure({ attempts: 1 }, MAX_INSTALLER_ATTEMPTS, {
      now,
      error: 'boom',
      backoff: installerBackoffMs,
    });
    expect(next.attempts).toBe(2);
    expect(next.lastError).toBe('boom');
    expect(next.nextAttemptAt).toBe(now + 60_000);
    expect(isParked(next)).toBe(false);
  });

  it('PARKS at the cap instead of dropping, and clears the retry time', () => {
    const next = afterFailure({ attempts: MAX_INSTALLER_ATTEMPTS - 1, nextAttemptAt: 5 }, MAX_INSTALLER_ATTEMPTS, {
      now,
    });
    expect(next.attempts).toBe(MAX_INSTALLER_ATTEMPTS);
    expect(isParked(next)).toBe(true);
    expect(next.parkedAt).toBe(new Date(now).toISOString());
    expect(next.nextAttemptAt).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const item = { attempts: 0 };
    afterFailure(item, 3, { now });
    expect(item).toEqual({ attempts: 0 });
  });

  it('photos park at their own cap', () => {
    expect(isParked(afterFailure({ attempts: MAX_PHOTO_ATTEMPTS - 1 }, MAX_PHOTO_ATTEMPTS))).toBe(true);
    expect(isParked(afterFailure({ attempts: MAX_PHOTO_ATTEMPTS - 2 }, MAX_PHOTO_ATTEMPTS))).toBe(false);
  });
});

describe('isDue', () => {
  it('is due with no backoff, once the backoff has passed, and never while parked', () => {
    expect(isDue({})).toBe(true);
    expect(isDue({ nextAttemptAt: 2000 }, 1000)).toBe(false);
    expect(isDue({ nextAttemptAt: 2000 }, 2000)).toBe(true);
    expect(isDue({ parkedAt: 'x' })).toBe(false);
    expect(isDue(null)).toBe(false);
  });
});

describe('rearmItem', () => {
  it('returns a parked item to a clean, due state', () => {
    const next = rearmItem({ attempts: 8, parkedAt: 'x', nextAttemptAt: 99, lastError: 'e' });
    expect(next).toMatchObject({ attempts: 0, parkedAt: undefined, nextAttemptAt: undefined, lastError: undefined });
    expect(isDue(next)).toBe(true);
  });
});
