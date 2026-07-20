// ─── dynamic-log-parity.test.ts ──────────────────────────────────────────────
// Golden parity test for the DYNAMIC-flow activity-log events (deal center,
// rollout, job builder). Each helper is invoked and the payload it hands to
// `logEvent(type, payload)` is asserted against the EXACT web shape:
//   - event type (1st arg)          — web `logEvent('<type>', …)`
//   - payload.module_type
//   - payload.meta.action
//   - every documented web meta key + value
//
// Web sources of truth (file:line):
//   calculator_created / _rename / _duplicated / auto_rename / view_all / build_job
//     → src/sections/deal-center/components/utils/tab-action-utils.js,
//       src/sections/deal-center/context/DealCenterContext.js,
//       src/sections/deal-center/components/TabbedCalculator.js,
//       src/sections/job/components/result-lead-modal.js
//   payment method inherited → tab-action-utils.js:78 / :225
//   section cleared          → src/sections/lf-calculator/view/lf-calculator-view.js
//   rollout_and_drop_summary → src/sections/deal-center/utils/rollout-drop-summary-log.js
//
// NOTE on known mobile-only extras (not web deviations, additive metadata):
//   - calculator_created carries `resetCycle: 0` and an optional `leadId`.
//   These are asserted as PRESENT-OR-ABSENT tolerant; the web-required keys are
//   asserted exactly. If a core field/type/action drifts, this test fails.
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('../../../src/services/api/LoggerService', () => ({
  logEvent: jest.fn(() => Promise.resolve()),
}));

import { logEvent } from '../../../src/services/api/LoggerService';
import {
  logCalculatorCreated,
  logCalculatorFieldEntry,
  logSectionCleared,
  logCalculatorRename,
  logCalculatorAutoRenamed,
  logCalculatorViewed,
  logViewAllCalculators,
  logBuildJobInitiated,
} from '../../../src/utils/activity-log/calculator-log';
import { logPaymentMethodInherited } from '../../../src/utils/activity-log/rollout-log-meta';
import { logRolloutAndDropSummary } from '../../../src/utils/activity-log/rollout-summary';

const mockLogEvent = logEvent as jest.Mock;

/** Return the single [type, payload] captured by the last helper call. */
function captured(): { type: string; payload: any } {
  expect(mockLogEvent).toHaveBeenCalledTimes(1);
  const [type, payload] = mockLogEvent.mock.calls[0];
  return { type, payload };
}

beforeEach(() => mockLogEvent.mockClear());

describe('dynamic-flow activity-log parity with web', () => {
  // ── CALCULATOR ─────────────────────────────────────────────────────────────
  test('calculator_created → create / calculator (tab-action-utils.js:62)', async () => {
    await logCalculatorCreated({
      userId: 'u1', calculatorId: 'c1', appointmentId: 'a1',
      calculatorTitle: 'G+LF', calculatorPosition: 2, leadId: 'l1',
    });
    const { type, payload } = captured();
    expect(type).toBe('create');
    expect(payload.module_type).toBe('calculator');
    expect(payload.user_id).toBe('u1');
    expect(payload.created_by).toBe('u1');
    expect(payload.meta.action).toBe('calculator_created');
    expect(payload.meta.calculatorId).toBe('c1');
    expect(payload.meta.appointmentId).toBe('a1');
    expect(payload.meta.calculatorTitle).toBe('G+LF');
    expect(payload.meta.calculatorPosition).toBe(2);
    // Web parity: every calculator log carries `resetCycle: 0` (verified against
    // the live web DB records).
    expect(payload.meta.resetCycle).toBe(0);
  });

  test('first calculator → action "Created new calculator tab"', async () => {
    await logCalculatorCreated({
      userId: 'u1', calculatorId: 'c1', appointmentId: 'a1',
      calculatorTitle: '1', isFirstCalculator: true,
    });
    expect(captured().payload.meta.action).toBe('Created new calculator tab');
  });

  test('calculator field changed → change / calculator_field_entry (DealCenterContext.js:355)', async () => {
    await logCalculatorFieldEntry({
      userId: 'u1', calculatorId: 'c1', appointmentId: 'a1', calculatorTitle: 'G',
      fieldLabel: 'Gutter 5" DS/E', fieldValue: 40, fieldCategory: 'gutters',
      oldValue: 0, newValue: 40, leadId: 'l1',
    });
    const { type, payload } = captured();
    expect(type).toBe('change');
    expect(payload.module_type).toBe('calculator_field_entry');
    expect(payload.meta.action).toBe('calculator field changed');
    expect(payload.meta.fieldLabel).toBe('Gutter 5" DS/E');
    expect(payload.meta.oldValue).toBe(0);
    expect(payload.meta.newValue).toBe(40);
    expect(payload.meta.fieldCategory).toBe('gutters');
  });

  test('section cleared → change / calculator_field_entry (lf-calculator-view.js)', async () => {
    await logSectionCleared({
      userId: 'u1', calculatorId: 'c1', appointmentId: 'a1', calculatorTitle: 'G',
      fieldName: 'Gutters', fieldLabel: 'Gutters', fieldCategory: 'gutters',
    });
    const { type, payload } = captured();
    expect(type).toBe('change');
    expect(payload.module_type).toBe('calculator_field_entry');
    expect(payload.meta.action).toBe('section cleared');
    expect(payload.meta.fieldValue).toBe('cleared');
    expect(payload.meta.fieldCategory).toBe('gutters');
  });

  test('calculator_rename → rename / calculator (tab-action-utils.js:126)', async () => {
    await logCalculatorRename({
      userId: 'u1', calculatorId: 'c1', appointmentId: 'a1',
      previousCalculatorTitle: 'G', newCalculatorTitle: 'G+LF',
    });
    const { type, payload } = captured();
    expect(type).toBe('rename');
    expect(payload.module_type).toBe('calculator');
    expect(payload.meta.action).toBe('calculator_rename');
    expect(payload.meta.previousCalculatorTitle).toBe('G');
    expect(payload.meta.newCalculatorTitle).toBe('G+LF');
  });

  test('calculator_auto_renamed → auto_rename / calculator (DealCenterContext.js:280)', async () => {
    await logCalculatorAutoRenamed({
      userId: 'u1', calculatorId: 'c1', appointmentId: 'a1', calculatorTitle: 'G+LF', leadId: 'l1',
    });
    const { type, payload } = captured();
    expect(type).toBe('auto_rename');
    expect(payload.module_type).toBe('calculator');
    expect(payload.meta.action).toBe('calculator_auto_renamed');
    expect(payload.meta.calculatorId).toBe('c1');
    expect(payload.meta.calculatorTitle).toBe('G+LF');
    expect(payload.meta.resetCycle).toBe(0); // web DB parity
  });

  test('calculator viewed → view / calculator (DealCenterContext.js:493)', async () => {
    await logCalculatorViewed({
      userId: 'u1', calculatorId: 'c1', appointmentId: 'a1', calculatorTitle: '2', leadId: 'l1',
    });
    const { type, payload } = captured();
    expect(type).toBe('view');
    expect(payload.module_type).toBe('calculator');
    expect(payload.meta.action).toBe('calculator viewed');
    expect(payload.meta.calculatorId).toBe('c1');
    expect(payload.meta.appointmentId).toBe('a1');
    expect(payload.meta.calculatorTitle).toBe('2');
    expect(payload.meta.resetCycle).toBe(0); // web DB parity
  });

  test('view_all_calculators → click / view_all_calculators (TabbedCalculator.js:667)', async () => {
    await logViewAllCalculators('u1');
    const { type, payload } = captured();
    expect(type).toBe('click');
    expect(payload.module_type).toBe('view_all_calculators');
    expect(payload.meta.action).toBe('view_all_calculators');
  });

  test('build_job_initiated → click / job_builder (result-lead-modal.js:1748)', async () => {
    await logBuildJobInitiated({
      userId: 'u1', leadId: 'l1', result: 'sale',
      calculatorId: 'c1', appointmentId: 'a1', calculatorType: 'dynamic',
    });
    const { type, payload } = captured();
    expect(type).toBe('click');
    expect(payload.module_type).toBe('job_builder');
    expect(payload.meta.action).toBe('build_job_initiated');
    expect(payload.meta.draft).toBe(true);
    expect(payload.meta.leadId).toBe('l1');
    expect(payload.meta.result).toBe('sale');
    expect(payload.meta.calculatorId).toBe('c1');
    expect(payload.meta.appointmentId).toBe('a1');
    expect(payload.meta.calculatorType).toBe('dynamic');
  });

  // ── PAYMENT-METHOD INHERITANCE ───────────────────────────────────────────────
  test('payment method inherited (default) → change / rollout_and_drop (tab-action-utils.js:78)', async () => {
    await logPaymentMethodInherited({
      userId: 'u1', calculatorId: 'c2', appointmentId: 'a1', calculatorTitle: '2',
      fromCalculator: null, toCalculator: 'c2', paymentMethod: 'greensky_84',
      inheritanceSource: 'default payment method', leadId: 'l1',
    });
    const { type, payload } = captured();
    expect(type).toBe('change');
    expect(payload.module_type).toBe('rollout_and_drop');
    expect(payload.meta.action).toBe('payment method inherited');
    expect(payload.meta.inheritanceSource).toBe('default payment method');
    expect(payload.meta.fromCalculator).toBeNull();
    expect(payload.meta.toCalculator).toBe('c2');
    expect(payload.meta.paymentMethod).toBe('greensky_84');
  });

  test('payment method inherited (duplication) → carries source/new titles (tab-action-utils.js:225)', async () => {
    await logPaymentMethodInherited({
      userId: 'u1', calculatorId: 'c3', appointmentId: 'a1', calculatorTitle: '3',
      fromCalculator: 'c1', toCalculator: 'c3', paymentMethod: 'greensky_84',
      inheritanceSource: 'calculator duplication',
      sourceCalculatorTitle: 'G+LF', newCalculatorTitle: '3', leadId: 'l1',
    });
    const { payload } = captured();
    expect(payload.meta.inheritanceSource).toBe('calculator duplication');
    expect(payload.meta.fromCalculator).toBe('c1');
    expect(payload.meta.sourceCalculatorTitle).toBe('G+LF');
    expect(payload.meta.newCalculatorTitle).toBe('3');
  });

  // ── ROLLOUT SUMMARY ──────────────────────────────────────────────────────────
  test('rollout_and_drop_summary → event/module/action + full meta (rollout-drop-summary-log.js:156)', async () => {
    await logRolloutAndDropSummary({
      userId: 'u1', leadId: 'l1',
      allCalculators: [{ _id: 'c1', price: 12000, appointmentId: 'a1', dropPrice: [] }],
      selectedCalculator: { _id: 'c1', price: 12000, appointmentId: 'a1', dropPrice: [], paymentMethod: 'check' },
      leadData: { originalContractPrice: 12000, result: 'Sale', paymentMethod: 'check' },
      isLowesLead: false,
    });
    const { type, payload } = captured();
    expect(type).toBe('rollout_and_drop_summary');
    expect(payload.module_type).toBe('rollout_and_drop');
    expect(payload.meta.action).toBe('job_builder_submitted_with_rollout_drop_summary');
    // The web meta key set — assert every documented key is present.
    const webMetaKeys = [
      'calculatorId', 'appointmentId', 'leadId', 'noOfRollouts', 'noOfDropsOnResultedJob',
      'noOfDropsAllJobs', 'noOfJobsAtCost', 'noOfJobsAtPar', 'noOfJobsAtRetail',
      'percentageJobsAtCost', 'percentageJobsAtPar', 'percentageJobsAtRetail',
      'aggregatedRetailPrice', 'aggregatedCostPrice', 'resultedJobCost', 'resultedJobPar',
      'resultedJobRetail', 'resultedJobPrice', 'rolloutPaymentMethod', 'resultedPaymentMethod',
      'dropDeltas', 'deltaFromRolloutToResult', 'paymentPlansOnResultedJob', 'paymentPlansList',
      'demoDurationMinutes', 'demoDurationHours', 'resultStatus', 'action',
    ];
    webMetaKeys.forEach((k) => expect(payload.meta).toHaveProperty(k));
    expect(payload.meta.noOfRollouts).toBe(1);
    expect(payload.meta.resultStatus).toBe('Sale');
  });
});
