import { buildCalculatorOutcomePayload, normalizeResult } from '../../../src/screens/DynamicDealCenter/utils/build-outcome-payload';
import { markupLabel } from '../../../src/screens/DynamicDealCenter/utils/dynamic-rollout-pricing';

describe('normalizeResult', () => {
  test('maps sale/demo (either key) to Sale/Demo', () => {
    expect(normalizeResult({ resultType: 'sale' })).toBe('Sale');
    expect(normalizeResult({ resultType: 'demo' })).toBe('Demo');
    expect(normalizeResult({ result: 'Sale' })).toBe('Sale');
    expect(normalizeResult({})).toBeUndefined();
  });
});

describe('buildCalculatorOutcomePayload — web parity', () => {
  const jobBuilder = { status: 'submitted' };

  test('sale payload carries LFCalculator, selectedAppointmentId, balance method, down method as paymentMethod', () => {
    // A FULL backend calculator doc (createdBy + appointmentId + title) — only these
    // pass the outcome's required-field validation, so only these are forwarded.
    const calc = { appointmentId: 'appt-1', _id: 'calc-1', createdBy: 'user-1', title: 'G+LF', totals: { retail: 5000 } };
    const p = buildCalculatorOutcomePayload({
      rd: {
        resultType: 'sale',
        oneLeg: 'MR',
        contractPrice: 9000,
        downPayment: 1000,
        balance: 8000,
        downPaymentMethod: 'check',
        balancePaymentMethod: 'wf4103',
        LFCalculator: calc,
        selectedAppointmentId: 'appt-1',
        versatile: true,
        pineapple: false,
      },
      calcId: 'calc-1',
      jobBuilder,
      fallbackAppointmentId: 'lead-1',
    });
    expect(p.result).toBe('Sale');
    expect(p.LFCalculator).toBe(calc); // full backend doc is forwarded verbatim
    expect(p.selectedAppointmentId).toBe('appt-1');
    expect(p.paymentMethod).toBe('check'); // down-payment method → `paymentMethod`
    expect(p.balancePaymentMethod).toBe('wf4103');
    expect(p.originalContractPrice).toBe(9000);
    expect(p.versatile).toBe(true);
    expect(p.jobBuilder).toBe(jobBuilder);
  });

  test('demo persists lastPriceQuoted (previously dropped) from the explicit field', () => {
    const p = buildCalculatorOutcomePayload({
      rd: { resultType: 'demo', demoReason: 'Shop Around', lastPriceQuoted: 7500, contractPrice: undefined },
      calcId: 'calc-2',
      jobBuilder,
    });
    expect(p.result).toBe('Demo');
    expect(p.reason).toBe('Shop Around');
    expect(p.lastPriceQuoted).toBe(7500);
  });

  test('LFCalculator is OMITTED when absent (empty {} 500s the backend) and appt id falls back', () => {
    const p = buildCalculatorOutcomePayload({ rd: { resultType: 'sale' }, calcId: 'c', jobBuilder, fallbackAppointmentId: 'lead-9' });
    // Sending an empty/partial LFCalculator triggers the backend's required-field
    // validators (createdBy/appointmentId/title) → 500. It must be omitted entirely.
    expect(p.LFCalculator).toBeUndefined();
    expect('LFCalculator' in p).toBe(false);
    expect(p.selectedAppointmentId).toBe('lead-9');
  });

  test('a PARTIAL LFCalculator (local CalcTab: title but no createdBy) is omitted', () => {
    const p = buildCalculatorOutcomePayload({
      rd: { resultType: 'sale', LFCalculator: { title: 'G+LF', totals: { retail: 5000 } } },
      calcId: 'c',
      jobBuilder,
      fallbackAppointmentId: 'lead-9',
    });
    expect(p.LFCalculator).toBeUndefined();
  });

  test('appointment id prefers the calculator snapshot appointmentId', () => {
    const p = buildCalculatorOutcomePayload({
      rd: { resultType: 'demo', LFCalculator: { appointmentId: 'appt-77' } },
      calcId: 'c',
      jobBuilder,
      fallbackAppointmentId: 'lead-9',
    });
    expect(p.selectedAppointmentId).toBe('appt-77');
  });
});

describe('markupLabel (drop pricemarkup, web calculateMarkup parity)', () => {
  const totals = { cost: 3000, par: 4000, retail: 5000 };
  test('anchors on the highest tier the price clears', () => {
    expect(markupLabel(5000, totals)).toBe('RETAIL');
    expect(markupLabel(5500, totals)).toBe('RETAIL + 10%');
    expect(markupLabel(4200, totals)).toBe('PAR + 5%');
    expect(markupLabel(3000, totals)).toBe('COST');
  });
  test('empty calculator → no label', () => {
    expect(markupLabel(500, { cost: 0, par: 0, retail: 0 })).toBe('');
    expect(markupLabel(500, undefined)).toBe('');
  });
  test('$200-floored anchors on tiny jobs', () => {
    // retail floored to 200 → 300 is RETAIL + 50%
    expect(markupLabel(300, { cost: 20, par: 30, retail: 40 })).toBe('RETAIL + 50%');
  });
});
