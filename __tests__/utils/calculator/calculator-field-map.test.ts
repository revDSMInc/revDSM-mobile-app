import { mapCalculatorNumericField, toWebFlatCalculator } from '../../../src/utils/calculator/calculator-field-map';

describe('mapCalculatorNumericField', () => {
  test('returns empty string for 0', () => {
    expect(mapCalculatorNumericField({ key: 0 }, 'key')).toBe('');
  });

  test('returns empty string for null/undefined', () => {
    expect(mapCalculatorNumericField({ key: null }, 'key')).toBe('');
    expect(mapCalculatorNumericField({ key: undefined }, 'key')).toBe('');
    expect(mapCalculatorNumericField({ key: '' }, 'key')).toBe('');
  });

  test('returns string for valid number', () => {
    expect(mapCalculatorNumericField({ key: 42 }, 'key')).toBe('42');
    expect(mapCalculatorNumericField({ key: 0.5 }, 'key')).toBe('0.5');
  });

  test('returns empty string for missing key', () => {
    expect(mapCalculatorNumericField({}, 'key')).toBe('');
  });
});

describe('toWebFlatCalculator', () => {
  test('returns empty object for null/undefined', () => {
    expect(toWebFlatCalculator(null)).toEqual({});
    expect(toWebFlatCalculator(undefined)).toEqual({});
  });

  test('returns flat object as-is when no inputs/extras', () => {
    const flat = { gutter6Ft1: '45', versa6Ft1: '30' };
    expect(toWebFlatCalculator(flat)).toEqual(flat);
  });

  test('spreads inputs and extras into flat object', () => {
    const nested = {
      inputs: { gutter6Ft1: '45', paymentPlan: 'check' },
      extras: { wedges: '60' },
      _id: 'calc-1',
      name: 'Job 1',
    };
    const result = toWebFlatCalculator(nested);
    expect(result.gutter6Ft1).toBe('45');
    expect(result.wedges).toBe('60');
    expect(result.paymentMethod).toBe('check');
    expect(result._id).toBeUndefined();
    expect(result.name).toBeUndefined();
    expect(result.inputs).toBeUndefined();
    expect(result.extras).toBeUndefined();
  });

  test('sets paymentMethod from inputs.paymentPlan', () => {
    const nested = {
      inputs: { gutter6Ft1: '45', paymentPlan: 'amex' },
      extras: {},
    };
    const result = toWebFlatCalculator(nested);
    expect(result.paymentMethod).toBe('amex');
  });

  test('keeps top-level non-meta fields', () => {
    const nested = {
      inputs: { gutter6Ft1: '45' },
      extras: {},
      rfShngl3Tab: '10',
      winSH_VinylStd: '5',
    };
    const result = toWebFlatCalculator(nested);
    expect(result.rfShngl3Tab).toBe('10');
    expect(result.winSH_VinylStd).toBe('5');
  });
});
