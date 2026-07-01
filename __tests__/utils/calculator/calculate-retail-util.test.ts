import { calculateRetail } from '../../../src/utils/calculator/calculate-retail-util';
import { pricing, extrasList50 } from '../../../src/utils/calculator/pricing-data';

describe('calculateRetail', () => {
  const baseCtx = { pricing, extrasList50 };

  const baseInputs = {
    gutter5DsE: 45,
    gutter6Ft1: 45,
    gutter7DsE: 0,
    versaMaxFt1: 225,
    versa6Ft1: 80,
    versa6Ft2: 0,
    versa6Ft3: 0,
    versa7Ft1: 0,
    versa7Ft2: 0,
    versa7Ft3: 0,
    filter45Ft1: 0,
    filter45Ft2: 0,
    filter45Ft3: 0,
  };

  const baseExtras = { wedges: 60 };

  test('returns baseRetailTotal + adminFee for 100% markup', () => {
    const result = calculateRetail({
      markupKey: '100',
      baseRetailTotal: 10000,
      inputs: baseInputs,
      ...baseCtx,
      extras: baseExtras,
    });
    expect(result).toBe(10500);
  });

  test('returns (check100 - admin) * 0.65 + admin for 65% markup', () => {
    const result = calculateRetail({
      markupKey: '65',
      baseRetailTotal: 10000,
      inputs: baseInputs,
      ...baseCtx,
      extras: baseExtras,
    });
    const check100 = 10000 + 500;
    expect(result).toBeCloseTo((check100 - 500) * 0.65 + 500);
  });

  test('returns cost-based calculation for 50% markup', () => {
    const result = calculateRetail({
      markupKey: '50',
      baseRetailTotal: 10000,
      inputs: baseInputs,
      ...baseCtx,
      extras: baseExtras,
    });
    const gutterTotal = 45 * 11.5 + 45 * 12.0 + 0 * 16.0;
    const versaMaxTotal = 225 * 26.0;
    const v6Total = 80 * 14.5;
    const extrasTotal = 60 * 1.75;
    const expected = gutterTotal + versaMaxTotal + v6Total + extrasTotal;
    expect(result).toBeCloseTo(expected);
  });

  test('skips adminFee when isLowesLead is true for 100% markup', () => {
    const result = calculateRetail({
      markupKey: '100',
      baseRetailTotal: 10000,
      inputs: baseInputs,
      ...baseCtx,
      extras: baseExtras,
      isLowesLead: true,
    });
    expect(result).toBe(10000);
  });

  test('returns baseRetailTotal for unknown markupKey', () => {
    const result = calculateRetail({
      markupKey: 'unknown',
      baseRetailTotal: 5000,
      inputs: baseInputs,
      ...baseCtx,
      extras: baseExtras,
    });
    expect(result).toBe(5000);
  });

  test('handles versa6, versa7, and filter45 at multiple stories', () => {
    const multiStoryInputs = {
      ...baseInputs,
      versa6Ft1: 10,
      versa6Ft2: 20,
      versa6Ft3: 30,
      versa7Ft1: 5,
      versa7Ft2: 10,
      versa7Ft3: 15,
      filter45Ft1: 8,
      filter45Ft2: 12,
      filter45Ft3: 16,
    };
    const result = calculateRetail({
      markupKey: '50',
      baseRetailTotal: 10000,
      inputs: multiStoryInputs,
      ...baseCtx,
      extras: {},
    });
    const v6Total = 10 * 14.5 + 20 * 14.5 + 30 * 14.5;
    const v7Total = 5 * 14.5 + 10 * 14.5 + 15 * 14.5;
    const f45Total = 8 * 14.5 + 12 * 14.5 + 16 * 14.5;
    const expectedGutter = 45 * 11.5 + 45 * 12.0;
    const expectedVersaMax = 225 * 26.0;
    const expected = expectedGutter + expectedVersaMax + v6Total + v7Total + f45Total;
    expect(result).toBeCloseTo(expected);
  });

  test('includes vertical product items at cost', () => {
    const verticals = { rfShngl3Tab: '10', winSH_VinylStd: '3' };
    const result = calculateRetail({
      markupKey: '50',
      baseRetailTotal: 10000,
      inputs: baseInputs,
      ...baseCtx,
      extras: {},
      verticals,
    });
    const gutterTotal = 45 * 11.5 + 45 * 12.0;
    const versaMaxTotal = 225 * 26.0;
    const v6Total = 80 * 14.5;
    const verticalTotal = 10 * 52.5 + 3 * 325;
    const expected = gutterTotal + versaMaxTotal + v6Total + verticalTotal;
    expect(result).toBeCloseTo(expected);
  });

  test('returns 0 cost for empty inputs', () => {
    const result = calculateRetail({
      markupKey: '50',
      baseRetailTotal: 0,
      inputs: {},
      ...baseCtx,
      extras: {},
    });
    expect(result).toBe(0);
  });
});
