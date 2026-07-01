import {
  LOWES_FINANCING_KEYS,
  LOWES_BASIC_KEYS,
  LOWES_ALL_KEYS,
  STANDARD_BASIC_KEYS,
  isPlanBelowMinPrice,
  getBelowMinMessage,
  getDefaultPaymentMethod,
  getRolloutPaymentCategories,
  getDropAddPlanCategories,
  getOutcomeDownPaymentMethods,
  validatePlanSelection,
} from '../../../src/utils/calculator/lowes-payment-util';

describe('constants', () => {
  test('LOWES_FINANCING_KEYS has 5 plans', () => {
    expect(LOWES_FINANCING_KEYS.length).toBe(5);
  });

  test('LOWES_BASIC_KEYS has 2 plans', () => {
    expect(LOWES_BASIC_KEYS.length).toBe(2);
  });

  test('LOWES_ALL_KEYS combines basic and financing', () => {
    expect(LOWES_ALL_KEYS.length).toBe(LOWES_BASIC_KEYS.length + LOWES_FINANCING_KEYS.length);
  });

  test('STANDARD_BASIC_KEYS has 3 plans', () => {
    expect(STANDARD_BASIC_KEYS.length).toBe(3);
    expect(STANDARD_BASIC_KEYS).toContain('check');
    expect(STANDARD_BASIC_KEYS).toContain('mcVisaDscvr');
    expect(STANDARD_BASIC_KEYS).toContain('amex');
  });
});

describe('isPlanBelowMinPrice', () => {
  test('returns false when price >= minPrice for Lowe\'s 6m plan', () => {
    expect(isPlanBelowMinPrice('lowes_6m', 299)).toBe(false);
    expect(isPlanBelowMinPrice('lowes_6m', 500)).toBe(false);
  });

  test('returns true when price < minPrice', () => {
    expect(isPlanBelowMinPrice('lowes_6m', 298)).toBe(true);
    expect(isPlanBelowMinPrice('lowes_36m', 999)).toBe(true);
  });

  test('returns false for plans without minPrice', () => {
    expect(isPlanBelowMinPrice('check', 100)).toBe(false);
    expect(isPlanBelowMinPrice('greensky2511', 50)).toBe(false);
  });

  test('returns false for zero or negative price', () => {
    expect(isPlanBelowMinPrice('lowes_6m', 0)).toBe(false);
    expect(isPlanBelowMinPrice('lowes_6m', -1)).toBe(false);
  });

  test('returns false for non-existent plan', () => {
    expect(isPlanBelowMinPrice('non_existent', 100)).toBe(false);
  });
});

describe('getBelowMinMessage', () => {
  test('returns message for price below minPrice', () => {
    const msg = getBelowMinMessage('lowes_6m', 100);
    expect(msg).toContain('$299');
    expect(msg).toContain('$100');
  });

  test('returns empty string for plans without minPrice', () => {
    expect(getBelowMinMessage('check', 100)).toBe('');
  });

  test('returns message for zero price', () => {
    const msg = getBelowMinMessage('lowes_6m', 0);
    expect(msg).toContain('minimum');
  });
});

describe('getDefaultPaymentMethod', () => {
  test('returns lowes_ach for Lowe\'s lead without existing', () => {
    expect(getDefaultPaymentMethod(true)).toBe('lowes_ach');
  });

  test('keeps existing method for Lowe\'s lead (except "check")', () => {
    expect(getDefaultPaymentMethod(true, 'mcVisaDscvr')).toBe('mcVisaDscvr');
    expect(getDefaultPaymentMethod(true, 'lowes_ach')).toBe('lowes_ach');
    expect(getDefaultPaymentMethod(true, 'check')).toBe('lowes_ach');
  });

  test('returns existing method or "check" for non-Lowe\'s lead', () => {
    expect(getDefaultPaymentMethod(false)).toBe('check');
    expect(getDefaultPaymentMethod(false, 'amex')).toBe('amex');
  });
});

describe('getRolloutPaymentCategories', () => {
  test('returns Lowe\'s categories for Lowe\'s lead', () => {
    const cats = getRolloutPaymentCategories(true);
    expect(cats.length).toBe(2);
    expect(cats[0].plans).toEqual([...LOWES_BASIC_KEYS]);
    expect(cats[1].plans).toEqual([...LOWES_FINANCING_KEYS]);
  });

  test('returns standard categories for non-Lowe\'s lead', () => {
    const cats = getRolloutPaymentCategories(false);
    expect(cats.length).toBe(5);
    expect(cats[0].plans).toEqual([...STANDARD_BASIC_KEYS]);
    expect(cats[1].title).toBe('GreenSky Plans');
    expect(cats[2].title).toBe('Wells Fargo Plans');
    expect(cats[3].title).toBe('Wells Fargo High (>$7,500)');
    expect(cats[4].title).toBe('Concora Credit');
  });
});

describe('getDropAddPlanCategories', () => {
  test('returns Lowe\'s financing only for Lowe\'s lead', () => {
    const cats = getDropAddPlanCategories(true);
    expect(cats.length).toBe(1);
    expect(cats[0].plans).toEqual([...LOWES_FINANCING_KEYS]);
  });

  test('returns all categories except Basic Options for non-Lowe\'s lead', () => {
    const cats = getDropAddPlanCategories(false);
    expect(cats.every((c) => c.title !== 'Basic Options')).toBe(true);
    expect(cats.length).toBe(4);
  });
});

describe('getOutcomeDownPaymentMethods', () => {
  test('returns Lowe\'s ACH/CC for Lowe\'s lead', () => {
    const methods = getOutcomeDownPaymentMethods(true);
    expect(methods).toEqual([
      { label: 'ACH (4% Fee)', value: 'lowes_ach' },
      { label: 'CC (4% Fee)', value: 'lowes_cc' },
    ]);
  });

  test('returns standard down payment methods for non-Lowe\'s lead', () => {
    const methods = getOutcomeDownPaymentMethods(false);
    expect(methods.length).toBe(3);
    expect(methods[0].value).toBe('check');
    expect(methods[1].value).toBe('mcVisaDscvr');
    expect(methods[2].value).toBe('amex');
  });
});

describe('validatePlanSelection', () => {
  test('returns ok=true when price meets plan minPrice', () => {
    const result = validatePlanSelection('lowes_6m', 500);
    expect(result.ok).toBe(true);
    expect(result.message).toBe('');
  });

  test('returns ok=false with message when price below minPrice', () => {
    const result = validatePlanSelection('lowes_6m', 100);
    expect(result.ok).toBe(false);
    expect(result.message).toBeTruthy();
  });

  test('returns ok=true for plans without minPrice', () => {
    const result = validatePlanSelection('check', 100);
    expect(result.ok).toBe(true);
  });
});
