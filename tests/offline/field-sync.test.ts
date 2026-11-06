import {
  fieldTextFor,
  shouldAcceptExternalValue,
} from '../../src/screens/DynamicDealCenter/utils/field-sync';

/**
 * Client: *"I pressed the clear but current field in which i focused is not cleared, it is only
 * cleared when i focus out"*. The sync effect was guarded by `if (focused) return;`, so a focused
 * box ignored every incoming value - including the Clear.
 */
describe('shouldAcceptExternalValue', () => {
  it('an unfocused field always follows the parent', () => {
    expect(shouldAcceptExternalValue({ focused: false, incoming: 0, lastReported: 66 })).toBe(true);
    expect(shouldAcceptExternalValue({ focused: false, incoming: 66, lastReported: 66 })).toBe(true);
  });

  /** ⚠️ THE REPORTED BUG: Clear sets 0 while the rep is typing in that very box. */
  it('a FOCUSED field accepts Clear', () => {
    expect(shouldAcceptExternalValue({ focused: true, incoming: 0, lastReported: 66 })).toBe(true);
  });

  /**
   * ⚠️ ...but ignores the parent echoing its own keystroke, or `6.` would be rewritten to `6`
   * the moment the dot is typed.
   */
  it('a focused field ignores the echo of what it just reported', () => {
    expect(shouldAcceptExternalValue({ focused: true, incoming: 6, lastReported: 6 })).toBe(false);
  });

  /** A deliberately typed `0` is also an echo and must not be wiped. */
  it('does not wipe a typed zero', () => {
    expect(shouldAcceptExternalValue({ focused: true, incoming: 0, lastReported: 0 })).toBe(false);
  });

  it('accepts an external change to a different value while focused', () => {
    expect(shouldAcceptExternalValue({ focused: true, incoming: 12, lastReported: 66 })).toBe(true);
  });

  it('accepts anything when the field has never reported', () => {
    expect(shouldAcceptExternalValue({ focused: true, incoming: 5, lastReported: null })).toBe(true);
  });
});

describe('fieldTextFor', () => {
  it('shows nothing for zero, so the box reads blank rather than "0"', () => {
    expect(fieldTextFor(0)).toBe('');
  });

  it('shows the number when there is one', () => {
    expect(fieldTextFor(66)).toBe('66');
    expect(fieldTextFor(12.5)).toBe('12.5');
  });

  it('treats a negative as nothing', () => {
    expect(fieldTextFor(-1)).toBe('');
  });
});
