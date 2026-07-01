import { parseSafeISO } from '../../src/utils/date-util';

describe('parseSafeISO', () => {
  test('returns NaN date for null/undefined/empty', () => {
    expect(parseSafeISO(null).getTime()).toBeNaN();
    expect(parseSafeISO(undefined).getTime()).toBeNaN();
    expect(parseSafeISO('').getTime()).toBeNaN();
  });

  test('parses ISO date strings', () => {
    const d = parseSafeISO('2024-03-15T10:30:00Z');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2); // March is 2 (0-indexed)
    expect(d.getDate()).toBe(15);
  });

  test('parses M/D/YYYY format', () => {
    const d = parseSafeISO('3/15/2024');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });

  test('parses MM/DD/YYYY format', () => {
    const d = parseSafeISO('12/25/2024');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(25);
  });

  test('falls back to native Date for other formats', () => {
    const d = parseSafeISO('2024-03-15');
    expect(d.getFullYear()).toBe(2024);
  });
});
