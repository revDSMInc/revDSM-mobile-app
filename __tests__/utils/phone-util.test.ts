import { formatUSPhoneNumber, getRawPhoneNumber } from '../../src/utils/phone-util';

describe('formatUSPhoneNumber', () => {
  test('returns empty string for empty input', () => {
    expect(formatUSPhoneNumber('')).toBe('');
  });

  test('formats full 10-digit number', () => {
    expect(formatUSPhoneNumber('5551234567')).toBe('+1 (555) 123-4567');
  });

  test('strips leading 1', () => {
    expect(formatUSPhoneNumber('15551234567')).toBe('+1 (555) 123-4567');
  });

  test('formats partial area code', () => {
    expect(formatUSPhoneNumber('555')).toBe('+1 (555');
  });

  test('formats area code + partial prefix', () => {
    expect(formatUSPhoneNumber('555123')).toBe('+1 (555) 123');
  });

  test('strips non-digit characters', () => {
    expect(formatUSPhoneNumber('(555) 123-4567')).toBe('+1 (555) 123-4567');
  });
});

describe('getRawPhoneNumber', () => {
  test('returns digits with 1 prefix when missing', () => {
    expect(getRawPhoneNumber('+1 (555) 123-4567')).toBe('15551234567');
  });

  test('preserves existing 1 prefix', () => {
    expect(getRawPhoneNumber('15551234567')).toBe('15551234567');
  });

  test('strips all non-digit characters', () => {
    expect(getRawPhoneNumber('555-123-4567')).toBe('15551234567');
  });

  test('returns empty string for empty input', () => {
    expect(getRawPhoneNumber('')).toBe('');
  });
});
