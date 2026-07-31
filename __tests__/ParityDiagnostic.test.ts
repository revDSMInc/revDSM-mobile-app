/**
 * Parity diagnostic — pins the mobile engine to the web-golden constants
 * (8575 / 18080) and verifies the deltas the web engine produces for
 * ckToInstallers / versa6Ft3 / snake_case pollution. The expected numbers are
 * the web source-of-truth values (see fixtures/parity-golden.json); this suite
 * asserts the MOBILE engine reproduces them with no web-repo dependency.
 */
import { calculateResultUtil as mobileCalc } from '../src/utils/calculator/calculation-results-util';
import { pricing, extrasList, extrasList50 } from '../src/utils/calculator/pricing-data';
import { paymentPlans } from '../src/utils/calculator/payment-plans';
import { getTierResults } from '../src/utils/calculator/calculator-calculation';

const calc = (details: any, mk: string, ck = 0) =>
  Math.round(
    mobileCalc({
      details,
      markupKey: mk,
      pricing,
      extrasList,
      extrasList50,
      paymentPlans,
      paymentMethod: 'check',
      ckToInstallers: ck,
    }),
  );

describe('Parity diagnostic (mobile vs web golden constants)', () => {
  const baseFlat = {
    gutter6Ft1: '45',
    versaMaxFt1: '225',
    versa6Ft1: '80',
    wedges: '60',
    extraLabor: '23',
    paymentMethod: 'check',
  };

  test('baseline matches web 8575 / 18080', () => {
    expect(calc(baseFlat, '50')).toBe(8575);
    expect(calc(baseFlat, '100')).toBe(18080);
  });

  test('ckToInstallers on tiers explains +29 cost only', () => {
    expect(calc(baseFlat, '50', 29)).toBe(8575 + 29);
    expect(calc(baseFlat, '100', 29)).toBe(18080 + 29);
  });

  test('versa6Ft3=2 explains +29 cost and +88 retail', () => {
    const withFt3 = { ...baseFlat, versa6Ft3: '2' };
    expect(calc(withFt3, '50') - calc(baseFlat, '50')).toBe(29);
    expect(calc(withFt3, '100') - calc(baseFlat, '100')).toBe(88);
  });

  test('getTierResults must not pass ckToInstallers into displayed tiers', () => {
    const nested = {
      inputs: { ...baseFlat, paymentPlan: 'check', ckToInstallers: '29' },
      extras: { wedges: '60', extraLabor: '23' },
    };
    const tiers = getTierResults(nested, { selectedPaymentMethod: 'check', ckToInstallers: 0 });
    expect(Math.round(tiers.price50)).toBe(8575);
    expect(Math.round(tiers.price100)).toBe(18080);
  });

  test('legacy API snake_case fields must not override canonical empty values', () => {
    const pollutedApiRecord = {
      gutter6Ft1: '45',
      versaMaxFt1: '225',
      versa6Ft1: '80',
      versa6Ft3: 0,
      versa_6_footage_3: '2',
      wedges: '60',
      extraLabor: '23',
      paymentMethod: 'check',
    };
    expect(calc(pollutedApiRecord, '50')).toBe(8575);
    expect(calc(pollutedApiRecord, '100')).toBe(18080);
  });
});
