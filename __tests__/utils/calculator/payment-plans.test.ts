import { paymentPlans } from '../../../src/utils/calculator/payment-plans';

describe('paymentPlans data integrity', () => {
  test('all basic payment methods exist', () => {
    expect(paymentPlans).toHaveProperty('check');
    expect(paymentPlans).toHaveProperty('mcVisaDscvr');
    expect(paymentPlans).toHaveProperty('amex');
  });

  test('check has fee 0 and type cash', () => {
    expect(paymentPlans.check.fee).toBe(0);
    expect(paymentPlans.check.type).toBe('cash');
  });

  test('mcVisaDscvr has fee 0.03 and type card', () => {
    expect(paymentPlans.mcVisaDscvr.fee).toBe(0.03);
    expect(paymentPlans.mcVisaDscvr.type).toBe('card');
  });

  test('amex has fee 0.05 and type card', () => {
    expect(paymentPlans.amex.fee).toBe(0.05);
    expect(paymentPlans.amex.type).toBe('card');
  });

  test('all GreenSky plans exist', () => {
    const gsPlans = ['greensky2511', 'greensky2521', 'greensky2531', 'greensky1599', 'greensky1509', 'greensky2011'];
    gsPlans.forEach((key) => {
      expect(paymentPlans).toHaveProperty(key);
      expect(paymentPlans[key].type).toBe('financing');
    });
  });

  test('all Wells Fargo plans exist', () => {
    const wfPlans = ['wf1148', 'wf1019', 'wf1157', 'wf1197', 'wf2225', 'wf3198', 'wf1529', 'wf4073', 'wf4079', 'wf4091', 'wf4103', 'wf4115'];
    wfPlans.forEach((key) => {
      expect(paymentPlans).toHaveProperty(key);
    });
  });

  test('Wells Fargo high-value plans exist', () => {
    const highPlans = ['wf3672', 'wf3667', 'wf3668', 'wf3669', 'wf3670', 'wf3671'];
    highPlans.forEach((key) => {
      expect(paymentPlans).toHaveProperty(key);
      expect(paymentPlans[key].minPrice).toBe(7500);
    });
  });

  test('Concora Credit plan exists', () => {
    expect(paymentPlans).toHaveProperty('concora');
    expect(paymentPlans.concora.type).toBe('financing');
  });

  test('Lowe\'s plans exist', () => {
    const lowesPlans = ['lowes_ach', 'lowes_cc', 'lowes_6m', 'lowes_36m', 'lowes_60m', 'lowes_84m', 'lowes_120m'];
    lowesPlans.forEach((key) => {
      expect(paymentPlans).toHaveProperty(key);
    });
  });

  test('all financing plans have required fields', () => {
    Object.entries(paymentPlans).forEach(([key, plan]: [string, any]) => {
      expect(plan).toHaveProperty('fee');
      expect(plan).toHaveProperty('label');
      expect(plan).toHaveProperty('type');
      expect(typeof plan.fee).toBe('number');
      expect(typeof plan.label).toBe('string');
      expect(typeof plan.type).toBe('string');
      expect(plan.fee).toBeGreaterThanOrEqual(0);
      if (plan.type !== 'cash' && plan.type !== 'card') {
        expect(['cash', 'card', 'financing']).toContain(plan.type);
      }
    });
  });

  test('financing plans have totalLoanMonths', () => {
    Object.entries(paymentPlans).forEach(([key, plan]: [string, any]) => {
      if (plan.type === 'financing') {
        expect(plan).toHaveProperty('totalLoanMonths');
        expect(typeof plan.totalLoanMonths).toBe('number');
      }
    });
  });

  test('no duplicate plan keys', () => {
    const keys = Object.keys(paymentPlans);
    const unique = new Set(keys);
    expect(unique.size).toBe(keys.length);
  });

  test('Lowe\'s financing plans have correct min price notes', () => {
    expect(paymentPlans.lowes_6m.minPrice).toBe(299);
    expect(paymentPlans.lowes_36m.minPrice).toBe(1000);
    expect(paymentPlans.lowes_60m.minPrice).toBe(1500);
    expect(paymentPlans.lowes_84m.minPrice).toBe(2000);
    expect(paymentPlans.lowes_120m.minPrice).toBe(2500);
  });

  test('all plan fees are between 0 and 0.25 (0-25%)', () => {
    Object.values(paymentPlans).forEach((plan: any) => {
      expect(plan.fee).toBeGreaterThanOrEqual(0);
      expect(plan.fee).toBeLessThanOrEqual(0.25);
    });
  });
});
