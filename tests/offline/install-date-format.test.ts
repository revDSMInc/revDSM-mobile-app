import {
  formatInstallDateForDisplay,
  isTbdInstallDate,
} from '../../src/screens/DynamicDealCenter/utils/install-date-format';

/**
 * The job builder and the My Deals edit wizard share one "Scheduled Appointment" card but seed it
 * from different places, which put a raw ISO string on screen in the edit wizard
 * (`2026-10-27T03:00:00-04:00` where the job builder read `11/2/2026`).
 */
describe('formatInstallDateForDisplay', () => {
  it('formats the ISO string the server stores', () => {
    expect(formatInstallDateForDisplay('2026-10-27T03:00:00-04:00')).toBe('10/27/2026');
    expect(formatInstallDateForDisplay('2026-11-02T12:00:00.000Z')).toBe('11/2/2026');
  });

  it('keeps a date the job builder already formatted', () => {
    expect(formatInstallDateForDisplay('11/2/2026')).toBe('11/2/2026');
    expect(formatInstallDateForDisplay('1/5/2027')).toBe('1/5/2027');
  });

  it('strips leading zeros so both screens read identically', () => {
    expect(formatInstallDateForDisplay('01/05/2027')).toBe('1/5/2027');
    expect(formatInstallDateForDisplay('2027-01-05T00:00:00Z')).toBe('1/5/2027');
  });

  /**
   * ⚠️ The whole reason this is text-parsed. `new Date('2026-10-27T03:00:00-04:00').getDate()`
   * is 26 for any runtime west of UTC-3 - and this date reaches a signed agreement.
   */
  it('keeps the calendar day the server recorded, whatever the device timezone', () => {
    expect(formatInstallDateForDisplay('2026-10-27T03:00:00-04:00')).toBe('10/27/2026');
    expect(formatInstallDateForDisplay('2026-10-27T00:30:00+05:00')).toBe('10/27/2026');
    expect(formatInstallDateForDisplay('2026-01-01T23:59:59-08:00')).toBe('1/1/2026');
    expect(formatInstallDateForDisplay('2026-12-31T00:00:00+14:00')).toBe('12/31/2026');
  });

  it('does not shift a year or month boundary', () => {
    expect(formatInstallDateForDisplay('2027-01-01T02:00:00-05:00')).toBe('1/1/2027');
    expect(formatInstallDateForDisplay('2026-03-01T01:00:00-05:00')).toBe('3/1/2026');
  });

  it('passes TBD through', () => {
    expect(formatInstallDateForDisplay('TBD')).toBe('TBD');
  });

  it('returns empty for no date, so a caller can branch once', () => {
    expect(formatInstallDateForDisplay('')).toBe('');
    expect(formatInstallDateForDisplay(null)).toBe('');
    expect(formatInstallDateForDisplay(undefined)).toBe('');
    expect(formatInstallDateForDisplay('   ')).toBe('');
  });

  it('hands back an unrecognised value rather than inventing a date', () => {
    expect(formatInstallDateForDisplay('next Tuesday')).toBe('next Tuesday');
  });

  it('is idempotent - formatting twice changes nothing', () => {
    ['2026-10-27T03:00:00-04:00', '11/2/2026', 'TBD', ''].forEach((v) => {
      const once = formatInstallDateForDisplay(v);
      expect(formatInstallDateForDisplay(once)).toBe(once);
    });
  });
});

describe('isTbdInstallDate', () => {
  it('detects TBD and nothing else', () => {
    expect(isTbdInstallDate('TBD')).toBe(true);
    expect(isTbdInstallDate(' TBD ')).toBe(true);
    expect(isTbdInstallDate('11/2/2026')).toBe(false);
    expect(isTbdInstallDate('')).toBe(false);
    expect(isTbdInstallDate(null)).toBe(false);
  });
});
