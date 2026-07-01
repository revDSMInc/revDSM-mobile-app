import { calculateResultUtil } from '../../../src/utils/calculator/calculation-results-util';
import { pricing, extrasList, extrasList50 } from '../../../src/utils/calculator/pricing-data';
import { paymentPlans } from '../../../src/utils/calculator/payment-plans';

describe('calculateResultUtil', () => {
  const baseCtx = { pricing, extrasList, extrasList50, paymentPlans };

  const baseFlat = {
    gutter6Ft1: '45',
    versaMaxFt1: '225',
    versa6Ft1: '80',
    wedges: '60',
    extraLabor: '23',
    paymentMethod: 'check',
  };

  test('returns number for 50% markup, check payment', () => {
    const result = calculateResultUtil({
      details: baseFlat,
      markupKey: '50',
      ...baseCtx,
      paymentMethod: 'check',
    });
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  test('returns number for 100% markup, check payment', () => {
    const result = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'check',
    });
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  test('applies card fee correctly (fee / (1-fee) formula)', () => {
    const resultCheck = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'check',
    });
    const resultCard = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'mcVisaDscvr',
    });
    const fee = paymentPlans.mcVisaDscvr.fee;
    const expectedCard = resultCheck / (1 - fee);
    expect(resultCard).toBeCloseTo(expectedCard, 0);
  });

  test('includes ckToInstallers parameter', () => {
    const resultNoCk = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'check',
    });
    const resultWithCk = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'check',
      ckToInstallers: 29,
    });
    expect(resultWithCk).toBeCloseTo(resultNoCk + 29, 0);
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
    const result = calculateResultUtil({
      details: nested,
      markupKey: '50',
      ...baseCtx,
      paymentMethod: 'check',
    });
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
  });

  test('handles null/undefined details', () => {
    expect(calculateResultUtil({ details: null, markupKey: '50', ...baseCtx, paymentMethod: 'check' })).toBe(0);
    expect(calculateResultUtil({ details: undefined, markupKey: '50', ...baseCtx, paymentMethod: 'check' })).toBe(0);
  });

  test('applies finance plan bank fee using divided-by-(1-fee) formula', () => {
    const resultCheck = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'check',
    });
    const resultFinance = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'wf4103',
    });
    const fee = paymentPlans.wf4103.fee;
    const expectedFinance = resultCheck / (1 - fee);
    expect(resultFinance).toBeCloseTo(expectedFinance, 0);
  });

  test('applies seniorVet discount', () => {
    const resultNoDiscount = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'check',
    });
    const resultDiscount = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'check',
      discounts: { seniorVet: true },
    });
    expect(resultDiscount).toBeCloseTo(resultNoDiscount * 0.9, 0);
  });

  test('applies preOrder discount', () => {
    const resultNoDiscount = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'check',
    });
    const resultDiscount = calculateResultUtil({
      details: baseFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'check',
      discounts: { preOrder: true },
    });
    expect(resultDiscount).toBeCloseTo(resultNoDiscount * 0.75, 0);
  });

  test('handles Lowe\'s lead without admin fee', () => {
    const lowesFlat = {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      wedges: '60',
      extraLabor: '23',
    };
    const resultStandard = calculateResultUtil({
      details: lowesFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'check',
    });
    const resultLowes = calculateResultUtil({
      details: lowesFlat,
      markupKey: '100',
      ...baseCtx,
      paymentMethod: 'lowes_ach',
      isLowesLead: true,
    });
    const lowesFee = paymentPlans.lowes_ach.fee;
    const expectedLowes = (resultStandard - 500) / (1 - lowesFee);
    expect(resultLowes).toBeCloseTo(expectedLowes, 0);
  });

  test('handles empty flat details', () => {
    const result = calculateResultUtil({
      details: {},
      markupKey: '50',
      ...baseCtx,
      paymentMethod: 'check',
    });
    expect(result).toBe(0);
  });
});
