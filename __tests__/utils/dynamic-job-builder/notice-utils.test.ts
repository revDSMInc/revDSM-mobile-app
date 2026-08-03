import {
  normalizeFieldNotice,
  hasFieldNotice,
  resolveFieldNotice,
} from '../../../src/utils/dynamic-job-builder/engine/notice-utils';

// Web parity: `engine/notice-utils.js`. The LeafFilter Versa Max case is a
// dropdown whose notice fires when the value equals the triggerValue '< 2.5'.
const versaMaxNotice = {
  notice: {
    enabled: true,
    head: 'Important Notice',
    dealsDescription: "Ensure Agreement has Special Can't Guarantee Cleaning or Sealing Clause",
    triggerValue: '< 2.5',
  },
};

describe('normalizeFieldNotice', () => {
  test('null unless enabled', () => {
    expect(normalizeFieldNotice(null)).toBeNull();
    expect(normalizeFieldNotice({ enabled: false, head: 'x' })).toBeNull();
    expect(normalizeFieldNotice({ enabled: true, head: 'x' })).toEqual({
      enabled: true,
      head: 'x',
      dealsDescription: '',
      triggerValue: '',
    });
  });
});

describe('hasFieldNotice', () => {
  test('true only when notice.enabled', () => {
    expect(hasFieldNotice(versaMaxNotice)).toBe(true);
    expect(hasFieldNotice({ notice: { enabled: false } })).toBe(false);
    expect(hasFieldNotice({})).toBe(false);
  });
});

describe('resolveFieldNotice — the Versa Max + width < 2.5 trigger', () => {
  test('fires only when the value matches triggerValue', () => {
    expect(resolveFieldNotice(versaMaxNotice, '< 2.5')).toEqual({
      head: 'Important Notice',
      dealsDescription: "Ensure Agreement has Special Can't Guarantee Cleaning or Sealing Clause",
    });
  });
  test('does NOT fire for a non-matching width', () => {
    expect(resolveFieldNotice(versaMaxNotice, '2.5 - 3.4')).toBeNull();
    expect(resolveFieldNotice(versaMaxNotice, '')).toBeNull();
  });
  test('no triggerValue → any non-empty value fires', () => {
    const anyValue = { notice: { enabled: true, head: 'H', dealsDescription: 'D' } };
    expect(resolveFieldNotice(anyValue, 'anything')).toEqual({ head: 'H', dealsDescription: 'D' });
    expect(resolveFieldNotice(anyValue, '')).toBeNull();
  });
  test('array value matches when it includes the trigger', () => {
    expect(resolveFieldNotice(versaMaxNotice, ['< 2.5', 'other'])).not.toBeNull();
    expect(resolveFieldNotice(versaMaxNotice, ['other'])).toBeNull();
  });
  test('disabled or content-less notice never fires', () => {
    expect(resolveFieldNotice({ notice: { enabled: false, triggerValue: '< 2.5' } }, '< 2.5')).toBeNull();
    expect(resolveFieldNotice({ notice: { enabled: true } }, 'x')).toBeNull();
  });
});
