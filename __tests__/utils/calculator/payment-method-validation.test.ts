import { validatePriceForPaymentMethod } from '../../../src/utils/calculator/payment-method-validation';
import { paymentPlans } from '../../../src/utils/calculator/payment-plans';

describe('validatePriceForPaymentMethod', () => {
  test('returns isValid=true for check with any price', () => {
    const result = validatePriceForPaymentMethod(1000, 'check');
    expect(result.isValid).toBe(true);
    expect(result.message).toBe('');
  });

  test('returns isValid=true for mcVisaDscvr with any price', () => {
    const result = validatePriceForPaymentMethod(500, 'mcVisaDscvr');
    expect(result.isValid).toBe(true);
  });

  test('returns isValid=true for amex with any price', () => {
    const result = validatePriceForPaymentMethod(2000, 'amex');
    expect(result.isValid).toBe(true);
  });

  test('returns isValid=true for price >= minPrice on financing plan', () => {
    const planKey = 'lowes_84m';
    const plan = paymentPlans[planKey];
    if (plan?.minPrice) {
      const result = validatePriceForPaymentMethod(plan.minPrice, planKey);
      expect(result.isValid).toBe(true);
      expect(result.message).toBe('');
    }
  });

  test('returns isValid=false with message for price < minPrice on financing plan', () => {
    const planKey = 'lowes_84m';
    const plan = paymentPlans[planKey];
    if (plan?.minPrice && plan.minPrice > 0) {
      const result = validatePriceForPaymentMethod(plan.minPrice - 1, planKey);
      expect(result.isValid).toBe(false);
      expect(result.message).toContain('minimum');
    }
  });

  test('returns isValid=true for 0 minPrice plans', () => {
    const result = validatePriceForPaymentMethod(100, 'greensky2511');
    expect(result.isValid).toBe(true);
  });

  test('returns isValid=true for GS plan without minPrice', () => {
    const result = validatePriceForPaymentMethod(500, 'greensky1599');
    expect(result.isValid).toBe(true);
  });

  test('returns isValid=true for price exactly at minPrice boundary', () => {
    const planKey = 'lowes_36m';
    const plan = paymentPlans[planKey];
    if (plan?.minPrice) {
      const result = validatePriceForPaymentMethod(plan.minPrice, planKey);
      expect(result.isValid).toBe(true);
    }
  });

  test('returns isValid=true for price above minPrice', () => {
    const planKey = 'lowes_60m';
    const plan = paymentPlans[planKey];
    if (plan?.minPrice) {
      const result = validatePriceForPaymentMethod(plan.minPrice * 2, planKey);
      expect(result.isValid).toBe(true);
    }
  });

  test('handles zero price', () => {
    const planKey = 'lowes_84m';
    const plan = paymentPlans[planKey];
    if (plan?.minPrice) {
      const result = validatePriceForPaymentMethod(0, planKey);
      expect(result.isValid).toBe(false);
    }
  });

  test('handles negative price', () => {
    const planKey = 'lowes_84m';
    const plan = paymentPlans[planKey];
    if (plan?.minPrice) {
      const result = validatePriceForPaymentMethod(-100, planKey);
      expect(result.isValid).toBe(false);
    }
  });

  test('validates all Lowe\'s financing plans', () => {
    const lowesFinKeys = ['lowes_6m', 'lowes_36m', 'lowes_60m', 'lowes_84m', 'lowes_120m'];
    lowesFinKeys.forEach((key) => {
      const plan = paymentPlans[key];
      if (plan?.minPrice) {
        const below = validatePriceForPaymentMethod(plan.minPrice - 1, key);
        expect(below.isValid).toBe(false);
        const at = validatePriceForPaymentMethod(plan.minPrice, key);
        expect(at.isValid).toBe(true);
      }
    });
  });

  test('handles non-existent plan key by treating it as valid (minPrice=0)', () => {
    const result = validatePriceForPaymentMethod(1000, 'non_existent_plan');
    expect(result.isValid).toBe(true);
    expect(result.minPrice).toBe(0);
  });
});
