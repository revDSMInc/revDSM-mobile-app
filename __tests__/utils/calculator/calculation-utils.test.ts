import { calculateQuote, calculateMonthlyPayment } from '../../../src/utils/calculator/calculation-utils';
import { pricing, markups, extrasList } from '../../../src/utils/calculator/pricing-data';
import { paymentPlans } from '../../../src/utils/calculator/payment-plans';

describe('calculateMonthlyPayment', () => {
  test('returns 0 for zero principal', () => {
    expect(calculateMonthlyPayment(0, 0.05, 12)).toBe(0);
  });

  test('returns 0 for zero months', () => {
    expect(calculateMonthlyPayment(1000, 0.05, 0)).toBe(0);
  });

  test('returns principal/months for 0% APR', () => {
    expect(calculateMonthlyPayment(1200, 0, 12)).toBe(100);
  });

  test('calculates correctly for standard loan', () => {
    const result = calculateMonthlyPayment(10000, 0.05, 12);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(10000);
  });
});

describe('calculateQuote', () => {
  const baseInputs = {
    gutter6Ft1: 45,
    versaMaxFt1: 225,
    versa6Ft1: 80,
    extraLabor: 23,
  };
  const baseExtras = { wedges: 60, extraLabor: 23 };

  test('returns object with finalPrice for 50% markup, 0% fee plan', () => {
    const result = calculateQuote(baseInputs, baseExtras, 1, 50, 'check', {}, pricing, markups, paymentPlans, {});
    expect(result).toHaveProperty('finalPrice');
    expect(result).toHaveProperty('baseRetailTotal');
    expect(result).toHaveProperty('breakdown');
    expect(result.finalPrice).toBeGreaterThan(0);
  });

  test('returns correct baseRetailTotal for 50% markup with check', () => {
    const resultGutter6 = 45 * 24.0;
    const resultVersaMax = 225 * 50.0;
    const resultVersa6 = 80 * 40.0;
    const extrasTotal = 60 * 3.5 + 23 * 80.0;
    const expectedBase = resultGutter6 + resultVersaMax + resultVersa6 + extrasTotal;

    const result = calculateQuote(baseInputs, baseExtras, 1, 50, 'check', {}, pricing, markups, paymentPlans, {});
    expect(result.baseRetailTotal).toBeCloseTo(expectedBase);
  });

  test('returns correct baseRetailTotal for base inputs', () => {
    const result = calculateQuote(baseInputs, baseExtras, 1, 100, 'check', {}, pricing, markups, paymentPlans, {});
    const expected = 45 * 24.0 + 225 * 50.0 + 80 * 40.0 + 60 * 3.5 + 23 * 80.0;
    expect(result.baseRetailTotal).toBeCloseTo(expected);
  });

  test('adds bank fee for card-based payment methods', () => {
    const resultCheck = calculateQuote(baseInputs, baseExtras, 1, 100, 'check', {}, pricing, markups, paymentPlans, {});
    const resultCard = calculateQuote(baseInputs, baseExtras, 1, 100, 'mcVisaDscvr', {}, pricing, markups, paymentPlans, {});
    const fee = paymentPlans.mcVisaDscvr.fee;
    const expectedCardFinal = resultCheck.totalAfterDiscounts * (1 + fee) + 0;
    expect(resultCard.finalPrice).toBeCloseTo(expectedCardFinal, 0);
  });

  test('includes ckToInstallers in finalPrice and breakdown', () => {
    const inputsWithCk = { ...baseInputs, ckToInstallers: '20' };
    const result = calculateQuote(inputsWithCk, baseExtras, 1, 50, 'check', {}, pricing, markups, paymentPlans, {});
    const resultWithout = calculateQuote(baseInputs, baseExtras, 1, 50, 'check', {}, pricing, markups, paymentPlans, {});
    expect(result.finalPrice).toBeCloseTo(resultWithout.finalPrice + 20, 0);
  });

  test('handles empty inputs gracefully', () => {
    const result = calculateQuote(null as any, null as any, 0, 50, 'check', {}, pricing, markups, paymentPlans, {});
    expect(result.finalPrice).toBe(0);
    expect(result.jobMinimumStatus).toBe('No items');
  });

  test('applies seniorVet discount (10% off)', () => {
    const result = calculateQuote(baseInputs, baseExtras, 1, 100, 'check', { seniorVet: true }, pricing, markups, paymentPlans, {});
    const resultNoDiscount = calculateQuote(baseInputs, baseExtras, 1, 100, 'check', {}, pricing, markups, paymentPlans, {});
    expect(result.totalAfterDiscounts).toBeCloseTo(resultNoDiscount.totalAfterDiscounts * 0.9, 0);
  });

  test('applies preOrder discount (25% off)', () => {
    const result = calculateQuote(baseInputs, baseExtras, 1, 100, 'check', { preOrder: true }, pricing, markups, paymentPlans, {});
    const resultNoDiscount = calculateQuote(baseInputs, baseExtras, 1, 100, 'check', {}, pricing, markups, paymentPlans, {});
    expect(result.totalAfterDiscounts).toBeCloseTo(resultNoDiscount.totalAfterDiscounts * 0.75, 0);
  });

  test('applies both seniorVet and preOrder discounts', () => {
    const result = calculateQuote(baseInputs, baseExtras, 1, 100, 'check', { seniorVet: true, preOrder: true }, pricing, markups, paymentPlans, {});
    const resultNoDiscount = calculateQuote(baseInputs, baseExtras, 1, 100, 'check', {}, pricing, markups, paymentPlans, {});
    expect(result.totalAfterDiscounts).toBeCloseTo(resultNoDiscount.totalAfterDiscounts * 0.9 * 0.75, 0);
  });

  test('handles verticalInputs without double counting', () => {
    const verticals = { rfShngl3Tab: '10' };
    const result = calculateQuote(baseInputs, baseExtras, 1, 50, 'check', {}, pricing, markups, paymentPlans, verticals);
    const resultNoVert = calculateQuote(baseInputs, baseExtras, 1, 50, 'check', {}, pricing, markups, paymentPlans, {});
    expect(result.baseRetailTotal).toBeGreaterThan(resultNoVert.baseRetailTotal);
    expect(result.breakdown.rfShngl3Tab).toBeDefined();
  });

  test('applies job minimum of $200', () => {
    const minimal = { gutter5DsE: 1 };
    const result = calculateQuote(minimal, {}, 1, 50, 'check', {}, pricing, markups, paymentPlans, {});
    expect(result.jobMinimumStatus).toBe('Applied');
    expect(result.finalPrice).toBe(200);
  });

  test('generates breakdown and breakdownWithNumberNotPrice', () => {
    const result = calculateQuote(baseInputs, baseExtras, 1, 50, 'check', {}, pricing, markups, paymentPlans, {});
    expect(result.breakdown).toHaveProperty('gutter6All');
    expect(result.breakdown).toHaveProperty('versaMax');
    expect(result.breakdownWithNumberNotPrice).toHaveProperty('gutter6All');
    expect(result.breakdownWithNumberNotPrice).toHaveProperty('versaMax');
  });

  test('handles financing plan with deferred months (e.g. greensky2511)', () => {
    const result = calculateQuote(baseInputs, baseExtras, 1, 100, 'greensky2511', {}, pricing, markups, paymentPlans, {});
    expect(result.showDeferredScenarios).toBe(true);
    expect(result.deferredScenarios).toHaveProperty('scenario1');
    expect(result.deferredScenarios).toHaveProperty('scenario2');
  });

  test('handles regular financing plan (non-deferred)', () => {
    const result = calculateQuote(baseInputs, baseExtras, 1, 100, 'greensky1599', {}, pricing, markups, paymentPlans, {});
    expect(result.monthlyPayment).toBeGreaterThan(0);
    expect(result.planDuration).toBeTruthy();
  });

  test('warns when Wells Fargo High plan used below $7500', () => {
    const smallInputs = { gutter5DsE: 1 };
    const result = calculateQuote(smallInputs, {}, 1, 100, 'wf3672', {}, pricing, markups, paymentPlans, {});
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain('minimum');
  });

  test('does not warn when Wells Fargo High plan above $7500', () => {
    const bigInputs = { gutter5DsE: 500 };
    const result = calculateQuote(bigInputs, {}, 1, 100, 'wf3672', {}, pricing, markups, paymentPlans, {});
    if (result.finalPrice >= 7500) {
      expect(result.warnings.length).toBe(0);
    }
  });
});
