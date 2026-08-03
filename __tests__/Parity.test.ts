/**
 * Calculator parity: the MOBILE lf-calculator engine must match the WEB engine.
 *
 * The web-expected values live in fixtures/parity-golden.json, generated from the
 * web source of truth by __tests__/_generators/parity-golden.gen.ts. This keeps
 * the test portable (no dependency on the web repo being present at test time).
 * Regenerate the golden with:
 *   GEN_GOLDEN=1 WEB_REPO=/path/to/mhalt-revDSM-sales-frontend \
 *     node ./node_modules/.bin/jest __tests__/_generators/parity-golden.gen.ts
 */
import { calculateResultUtil as mobileCalcResult } from '../src/utils/calculator/calculation-results-util';
import { pricing, extrasList, extrasList50 } from '../src/utils/calculator/pricing-data';
import { paymentPlans } from '../src/utils/calculator/payment-plans';
import { PARITY_CASES } from './fixtures/parity-cases';
import golden from './fixtures/parity-golden.json';

const mobile = (details: any, c: { markupKey: string; paymentMethod: string; isLowesLead?: boolean; ckToInstallers?: number }) =>
  Math.round(
    mobileCalcResult({
      details,
      markupKey: c.markupKey,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod: c.paymentMethod,
      isLowesLead: c.isLowesLead ?? false,
      ckToInstallers: c.ckToInstallers ?? 0,
    }),
  );

describe('Calculator Parity Tests (mobile vs web golden)', () => {
  test.each(PARITY_CASES.map((c) => [c.key, c]))('%s — flat details matches web golden', (_key, c: any) => {
    const expected = (golden as Record<string, number>)[c.key];
    expect(expected).toBeDefined();
    expect(mobile(c.details, c)).toBe(expected);
  });

  test.each(PARITY_CASES.filter((c) => c.mobileNested).map((c) => [c.key, c]))(
    '%s — nested { inputs, extras } shape matches the same web golden',
    (_key, c: any) => {
      const expected = (golden as Record<string, number>)[c.key];
      expect(mobile(c.mobileNested, c)).toBe(expected);
    },
  );

  test('golden covers exactly the shared parity cases', () => {
    expect(Object.keys(golden as object).sort()).toEqual(PARITY_CASES.map((c) => c.key).sort());
  });

  test('nested baseline pins the historical 8575 / 18080 constants', () => {
    expect((golden as Record<string, number>)['nested#50']).toBe(8575);
    expect((golden as Record<string, number>)['nested#100']).toBe(18080);
  });

  test('tier prices reflect selected payment plan bank fee', () => {
    const active = {
      inputs: { gutter6Ft1: '45', versaMaxFt1: '225', versa6Ft1: '80', paymentPlan: 'mcVisaDscvr' },
      extras: { wedges: '60' },
    };
    const withCheck = mobile(active, { markupKey: '100', paymentMethod: 'check' });
    const withCard = mobile(active, { markupKey: '100', paymentMethod: 'mcVisaDscvr' });
    expect(withCard).toBeGreaterThan(withCheck);
  });
});
