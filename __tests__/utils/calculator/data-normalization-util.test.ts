import { normalizeCalculatorData } from '../../../src/utils/calculator/data-normalization-util';

describe('normalizeCalculatorData', () => {
  test('returns empty objects for null/undefined details', () => {
    const result = normalizeCalculatorData(null);
    expect(result).toEqual({ inputs: {}, extras: {}, flat: {} });

    const result2 = normalizeCalculatorData(undefined);
    expect(result2).toEqual({ inputs: {}, extras: {}, flat: {} });
  });

  test('normalizes flat input object with inputs in details.inputs', () => {
    const flat = {
      gutter5DsE: '100',
      gutter6Ft1: '50',
      versa6Ft1: '30',
      extraLabor: '10',
      screens: '5',
      ckToInstallers: '20',
    };
    const result = normalizeCalculatorData(flat);
    expect(result.inputs.gutter5DsE).toBe('100');
    expect(result.inputs.gutter6Ft1).toBe('50');
    expect(result.inputs.versa6Ft1).toBe('30');
    expect(result.inputs.screens).toBe('5');
    expect(result.inputs.ckToInstallers).toBe('20');
  });

  test('normalizes nested (inputs + extras) format', () => {
    const nested = {
      inputs: {
        gutter5DsE: '100',
        gutter6Ft1: '50',
        versa6Ft1: '30',
        extraLabor: '10',
        paymentPlan: 'check',
      },
      extras: {
        wedges: '20',
        straps: '10',
      },
    };
    const result = normalizeCalculatorData(nested);
    expect(result.inputs.gutter5DsE).toBe('100');
    expect(result.inputs.gutter6Ft1).toBe('50');
    expect(result.flat.wedges).toBe('20');
    expect(result.flat.straps).toBe('10');
  });

  test('extras field excludes gutter7DsE', () => {
    const data = {
      gutter5DsE: '100',
      gutter7DsE: '50',
      wedges: '20',
      straps: '10',
    };
    const result = normalizeCalculatorData(data);
    expect(result.extras.gutter7DsE).toBeUndefined();
    expect(result.inputs.gutter7DsE).toBe('50');
  });

  test('handles vertical items by placing them in verticals result', () => {
    const data = {
      gutter6Ft1: '45',
      versa6Ft1: '30',
      rfShngl3Tab: '10',
      winSH_VinylStd: '5',
    };
    const result = normalizeCalculatorData(data);
    expect(result.verticals.rfShngl3Tab).toBe('10');
    expect(result.verticals.winSH_VinylStd).toBe('5');
  });

  test('handles empty string values as empty strings (not null)', () => {
    const data = {
      gutter5DsE: '',
      gutter6Ft1: '50',
      versa6Ft1: '',
    };
    const result = normalizeCalculatorData(data);
    expect(result.inputs.gutter5DsE).toBe('');
    expect(result.inputs.gutter6Ft1).toBe('50');
    expect(result.inputs.versa6Ft1).toBe('');
  });

  test('returns flat output with all original fields', () => {
    const data = {
      gutter6Ft1: '50',
      wedges: '10',
      extraLabor: '5',
    };
    const result = normalizeCalculatorData(data);
    expect(result.flat.gutter6Ft1).toBe('50');
    expect(result.flat.wedges).toBe('10');
    expect(result.flat.extraLabor).toBe('5');
  });
});
