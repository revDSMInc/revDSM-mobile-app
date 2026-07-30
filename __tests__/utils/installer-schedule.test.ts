import { isFutureDatedJob } from '../../src/utils/installer-schedule';
import type { InstallerJob } from '../../src/config/types/installer';

const jobOn = (leadDate?: string): InstallerJob =>
  ({ _id: 'job-1', leadDate } as InstallerJob);

/** Local-time ISO, so the assertions don't move with the machine's timezone. */
const localIso = (y: number, m: number, d: number, h = 9): string =>
  new Date(y, m - 1, d, h).toISOString();

describe('isFutureDatedJob', () => {
  const now = new Date(2026, 6, 30, 14, 0); // 30 Jul 2026, 2pm local

  test('today opens — even when the arrival window has already passed', () => {
    // 8am today, asked at 2pm. The window is over; the job is still today's.
    expect(isFutureDatedJob(jobOn(localIso(2026, 7, 30, 8)), now)).toBe(false);
  });

  test('later today opens', () => {
    expect(isFutureDatedJob(jobOn(localIso(2026, 7, 30, 20)), now)).toBe(false);
  });

  test('yesterday opens', () => {
    expect(isFutureDatedJob(jobOn(localIso(2026, 7, 29)), now)).toBe(false);
  });

  test('a month ago opens', () => {
    expect(isFutureDatedJob(jobOn(localIso(2026, 6, 30)), now)).toBe(false);
  });

  test('tomorrow is refused', () => {
    expect(isFutureDatedJob(jobOn(localIso(2026, 7, 31)), now)).toBe(true);
  });

  test('next month is refused', () => {
    expect(isFutureDatedJob(jobOn(localIso(2026, 8, 15)), now)).toBe(true);
  });

  test('the very start of tomorrow is already future', () => {
    expect(isFutureDatedJob(jobOn(localIso(2026, 7, 31, 0)), now)).toBe(true);
  });

  test('the very start of today is not', () => {
    expect(isFutureDatedJob(jobOn(localIso(2026, 7, 30, 0)), now)).toBe(false);
  });

  // A data gap must never lock a crew out of work they may be standing at.
  test('no date does not block', () => {
    expect(isFutureDatedJob(jobOn(undefined), now)).toBe(false);
  });

  test('an unparseable date does not block', () => {
    expect(isFutureDatedJob(jobOn('not a date'), now)).toBe(false);
  });

  test('no job does not block', () => {
    expect(isFutureDatedJob(null, now)).toBe(false);
    expect(isFutureDatedJob(undefined, now)).toBe(false);
  });

  test('an offset-bearing API date resolves to its local calendar day', () => {
    // The shape `my-jobs` actually sends. Parsed to the device's zone, then compared by
    // calendar day — the same day the crew is working in.
    const sameDay = new Date(2026, 6, 30, 9).toISOString();
    expect(isFutureDatedJob(jobOn(sameDay), now)).toBe(false);
  });
});
