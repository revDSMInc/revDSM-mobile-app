import { getTierResults, getCalculationResult } from '../../../src/utils/calculator/calculator-calculation';

describe('getTierResults', () => {
  const baseNested = {
    inputs: {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      extraLabor: '23',
      paymentPlan: 'check',
    },
    extras: { wedges: '60', extraLabor: '23' },
  };

  test('returns price50, price65, price100', () => {
    const result = getTierResults(baseNested, { selectedPaymentMethod: 'check' });
    expect(result).toHaveProperty('price50');
    expect(result).toHaveProperty('price65');
    expect(result).toHaveProperty('price100');
    expect(result.price50).toBeGreaterThan(0);
    expect(result.price100).toBeGreaterThan(0);
  });

  test('price50 < price65 < price100', () => {
    const result = getTierResults(baseNested, { selectedPaymentMethod: 'check' });
    expect(result.price50).toBeLessThan(result.price65);
    expect(result.price65).toBeLessThan(result.price100);
  });

  test('returns costAtCheck, parAtCheck, retailAtCheck', () => {
    const result = getTierResults(baseNested, { selectedPaymentMethod: 'check' });
    expect(result).toHaveProperty('costAtCheck');
    expect(result).toHaveProperty('parAtCheck');
    expect(result).toHaveProperty('retailAtCheck');
  });

  test('returns total as the final price', () => {
    const result = getTierResults(baseNested, { selectedPaymentMethod: 'check' });
    expect(result).toHaveProperty('total');
    expect(result.total).toBeGreaterThan(0);
  });

  test('handles flat details object', () => {
    const flat = {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      wedges: '60',
      extraLabor: '23',
      paymentMethod: 'check',
    };
    const result = getTierResults(flat);
    expect(result.price50).toBeGreaterThan(0);
    expect(result.price100).toBeGreaterThan(0);
  });

  test('handles empty/invalid details', () => {
    const result = getTierResults(null as any);
    expect(result.price50).toBe(0);
    expect(result.price65).toBe(0);
    expect(result.price100).toBe(0);
    expect(result.total).toBe(0);
  });

  test('includes ckToInstallers in total but not in tier prices', () => {
    const resultWithout = getTierResults(baseNested, { selectedPaymentMethod: 'check' });
    const resultWith = getTierResults(baseNested, { selectedPaymentMethod: 'check', ckToInstallers: 50 });
    expect(resultWith.price50).toBe(resultWithout.price50);
    expect(resultWith.total).toBeGreaterThan(resultWith.price100);
  });

  test('handles Lowe\'s specific payment method', () => {
    const lowesFlat = {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      wedges: '60',
    };
    const result = getTierResults(lowesFlat, { selectedPaymentMethod: 'lowes_ach', isLowesLead: true });
    expect(result.price50).toBeGreaterThan(0);
    expect(result.price100).toBeGreaterThan(0);
  });
});

describe('getCalculationResult', () => {
  test('returns a number for valid flat details', () => {
    const flat = {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      wedges: '60',
      extraLabor: '23',
      paymentMethod: 'check',
    };
    const result = getCalculationResult(flat, '50', 'check');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  test('returns different values for different markup keys', () => {
    const flat = {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      wedges: '60',
      extraLabor: '23',
      paymentMethod: 'check',
    };
    const price50 = getCalculationResult(flat, '50', 'check');
    const price100 = getCalculationResult(flat, '100', 'check');
    expect(price50).toBeLessThan(price100);
  });

  test('applies card fee payment method', () => {
    const flat = {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      wedges: '60',
      extraLabor: '23',
      paymentMethod: 'check',
    };
    const resultCheck = getCalculationResult(flat, '100', 'check');
    const resultAmex = getCalculationResult(flat, '100', 'amex');
    expect(resultAmex).toBeGreaterThan(resultCheck);
  });

  test('handles nested details format', () => {
    const nested = {
      inputs: {
        gutter6Ft1: '45',
        versaMaxFt1: '225',
        versa6Ft1: '80',
        extraLabor: '23',
        paymentPlan: 'check',
      },
      extras: { wedges: '60', extraLabor: '23' },
    };
    const result = getCalculationResult(nested, '50', 'check');
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  test('returns 0 for null/undefined details', () => {
    expect(getCalculationResult(null as any, '50', 'check')).toBe(0);
    expect(getCalculationResult(undefined as any, '50', 'check')).toBe(0);
  });

  test('returns 0 for empty details', () => {
    expect(getCalculationResult({} as any, '50', 'check')).toBe(0);
  });
});
