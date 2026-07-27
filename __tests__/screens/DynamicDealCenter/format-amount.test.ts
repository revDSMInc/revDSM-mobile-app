import { formatAmountInput, stripAmount } from '../../../src/screens/DynamicDealCenter/utils/format-amount';

describe('formatAmountInput', () => {
  it('groups thousands with commas', () => {
    expect(formatAmountInput('195000')).toBe('195,000');
    expect(formatAmountInput('1234567')).toBe('1,234,567');
  });

  it('leaves values under 1000 untouched', () => {
    expect(formatAmountInput('200')).toBe('200');
    expect(formatAmountInput('999')).toBe('999');
    expect(formatAmountInput('1000')).toBe('1,000');
  });

  it('handles the empty string', () => {
    expect(formatAmountInput('')).toBe('');
  });

  it('keeps a trailing decimal point so decimals can still be typed', () => {
    expect(formatAmountInput('195000.')).toBe('195,000.');
    expect(formatAmountInput('195000.5')).toBe('195,000.5');
    expect(formatAmountInput('1234567.25')).toBe('1,234,567.25');
  });

  it('does not group the decimal part', () => {
    expect(formatAmountInput('1000.12345')).toBe('1,000.12345');
  });

  it('leaves a stray second decimal point alone (parseFloat behaviour is unchanged)', () => {
    expect(formatAmountInput('1000.2.3')).toBe('1,000.2.3');
    expect(parseFloat(stripAmount(formatAmountInput('1000.2.3')))).toBe(1000.2);
  });
});

describe('stripAmount', () => {
  it('removes the commas that formatAmountInput adds', () => {
    expect(stripAmount('195,000')).toBe('195000');
    expect(stripAmount('1,234,567.25')).toBe('1234567.25');
  });

  it('removes any other non-numeric character', () => {
    expect(stripAmount('$195,000')).toBe('195000');
    expect(stripAmount('abc')).toBe('');
  });
});

describe('round trip', () => {
  // The inputs hold the raw string and parse it for every validation/save path,
  // so formatting must never alter the underlying value.
  it.each(['', '0', '200', '195000', '1234567', '195000.', '195000.5', '1000.12345'])(
    'stripAmount(formatAmountInput(%p)) returns the input unchanged',
    (raw) => {
      expect(stripAmount(formatAmountInput(raw))).toBe(raw);
    }
  );

  it('preserves the parsed number through a format/strip cycle', () => {
    expect(parseFloat(stripAmount(formatAmountInput('195000')))).toBe(195000);
  });

  it('re-formats correctly as digits are appended one at a time', () => {
    // Simulates typing 195000: each keystroke re-enters onChangeText with the
    // previously formatted text plus the new digit.
    let raw = '';
    const typed: string[] = [];
    for (const digit of '195000') {
      raw = stripAmount(formatAmountInput(raw) + digit);
      typed.push(formatAmountInput(raw));
    }
    expect(typed).toEqual(['1', '19', '195', '1,950', '19,500', '195,000']);
  });

  it('re-formats correctly when a digit is backspaced away', () => {
    // '195,000' with the last digit deleted -> '195,00' -> raw '19500'
    expect(formatAmountInput(stripAmount('195,00'))).toBe('19,500');
  });
});
