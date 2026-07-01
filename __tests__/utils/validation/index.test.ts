import { validateEmail, validatePassword, validateName } from '../../../src/utils/validation';

describe('validateEmail', () => {
  test('returns true for valid email', () => {
    expect(validateEmail('user@example.com')).toBe(true);
    expect(validateEmail('test.user@domain.co')).toBe(true);
  });

  test('returns false for invalid email', () => {
    expect(validateEmail('not-an-email')).toBe(false);
    expect(validateEmail('@domain.com')).toBe(false);
    expect(validateEmail('user@')).toBe(false);
    expect(validateEmail('')).toBe(false);
  });
});

describe('validatePassword', () => {
  test('returns true for strong password', () => {
    expect(validatePassword('Passw0rd!')).toBe(true);
    expect(validatePassword('Str0ng!Pass')).toBe(true);
  });

  test('returns false for weak password', () => {
    expect(validatePassword('password')).toBe(false);
    expect(validatePassword('PASSWORD1')).toBe(false);
    expect(validatePassword('Pass1!')).toBe(false);
    expect(validatePassword('')).toBe(false);
  });
});

describe('validateName', () => {
  test('returns true for valid names', () => {
    expect(validateName('John')).toBe(true);
    expect(validateName("O'Brien")).toBe(true);
    expect(validateName('Jean-Claude')).toBe(true);
  });

  test('returns false for invalid names', () => {
    expect(validateName('Will iam')).toBe(false);
    expect(validateName('')).toBe(false);
    expect(validateName('123')).toBe(false);
  });
});
