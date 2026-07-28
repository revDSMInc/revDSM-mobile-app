import { compactPlanLabel, DealPlan } from '../../../src/screens/DynamicDealCenter/hooks/useDealPricing';

// The Investment Center "Monthly" shortlist / program-card terms label. Web parity
// (`investment-panel.js` `formatPlanTerms`): the APR is ALWAYS surfaced — a
// deferred-interest / 0% plan reads "0% APR" rather than omitting the rate — so the
// customer always sees the APR next to the $/mo.

const mkPlan = (over: Partial<DealPlan>): DealPlan => ({
  key: '',
  label: '',
  type: 'financing',
  fee: 0,
  pf: 0,
  duration: 0,
  apr: 0,
  minPrice: 0,
  ...over,
});

describe('compactPlanLabel — APR is always shown', () => {
  test('fixed-rate plan shows its APR', () => {
    const plans = {
      wf1599: mkPlan({ key: 'wf1599', label: '1599 (Fixed Rate of 9.99% APR for 180 Months)', apr: 0.0999, provider: 'Wells Fargo' }),
    };
    expect(compactPlanLabel(plans, 'wf1599')).toBe('WF1599, 9.99% APR, 180M');
  });

  test('deferred-interest / 0% plan shows "0% APR" instead of dropping it', () => {
    const plans = {
      greensky2511: mkPlan({ key: 'greensky2511', label: '2511 (6 Months 0% Interest No Payments)', apr: 0, provider: 'GreenSky' }),
    };
    // Was "GS2511, 6M" (APR omitted) — now the 0% rate is explicit.
    expect(compactPlanLabel(plans, 'greensky2511')).toBe('GS2511, 0% APR, 6M');
  });

  test('APR stored as a whole percent is not double-scaled', () => {
    const plans = {
      gs2521: mkPlan({ key: 'gs2521', label: '2521 (12 Months)', apr: 5.75, provider: 'GreenSky', duration: 12 }),
    };
    expect(compactPlanLabel(plans, 'gs2521')).toBe('GS2521, 5.75% APR, 12M');
  });
});
