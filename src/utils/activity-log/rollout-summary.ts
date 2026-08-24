import { logEvent } from '../../services/api/LoggerService';
import { calculateResultUtil } from '../calculator/calculation-results-util';
import { pricing, extrasList, extrasList50 } from '../calculator/pricing-data';
import { paymentPlans } from '../calculator/payment-plans';
import { consumeRolloutConfirmedTimestamp } from './rollout-confirmed-at';

const NON_PAYMENT_PLAN_METHODS = ['check', 'mcVisaDscvr', 'amex', 'lowes_ach', 'lowes_cc'];

const isPaymentPlanMethod = (method: string) => method && !NON_PAYMENT_PLAN_METHODS.includes(method);

const calculateDelta = (current: number, previous: number) => {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return 0;
  const pct = ((current - previous) / previous) * 100;
  return Number.isFinite(pct) ? Number(pct.toFixed(1)) : 0;
};

/**
 * COST / PAR / RETAIL for one calculator.
 *
 * ⚠️ `calculateResultUtil` is the LEGACY calculator: it prices the hardcoded
 * `gutter5DsE` / `versa6Ft1` / … columns. A DYNAMIC calculator stores nothing there —
 * its quantities live in `entries` and are priced from the company's schema — so every
 * dynamic job came back with the same floored tiers, which put all of them in the
 * `atRetail` bucket and logged `resultedJobCost/Par/Retail` that no screen agrees with.
 *
 * Web has no such problem: its `calculateTiers` passes `schemas: schema`, so the same
 * function prices a dynamic calculator. Mobile's port is not schema-aware, so the
 * dynamic caller opts into the tiers the calculator ALREADY carries — `totals` is the
 * pure tier sum the deal center computed and persisted (`computeTotals`), i.e. the same
 * numbers the rollout tiles are derived from.
 *
 * Opt-in, never inferred: the classic flow's calculators can carry a `totals` object
 * too, and there the legacy computation IS the right one.
 */
const calculateTiers = (calculator: any, isLowesLead: boolean, preferStoredTotals = false) => {
  if (preferStoredTotals) {
    const t = calculator?.totals;
    if (t && (Number(t.cost) || Number(t.par) || Number(t.retail))) {
      return {
        cost: Math.round(Number(t.cost) || 0),
        par: Math.round(Number(t.par) || 0),
        retail: Math.round(Number(t.retail) || 0),
      };
    }
  }
  const tier = (markupKey: string) =>
    Math.round(
      calculateResultUtil({
        details: calculator,
        markupKey,
        pricing,
        extrasList,
        extrasList50,
        paymentPlans,
        paymentMethod: 'check',
        hideScreens: true,
        isLowesLead,
      })
    ) || 0;

  return { cost: tier('50'), par: tier('65'), retail: tier('100') };
};

export const logRolloutAndDropSummary = async (opts: {
  userId: string;
  leadId: string;
  allCalculators: any[];
  selectedCalculator: any;
  leadData: any;
  isLowesLead?: boolean;
  /** Dynamic deal center: take each calculator's tiers from its stored `totals`
   *  instead of the legacy column pricing. See `calculateTiers`. */
  preferStoredTotals?: boolean;
}) => {
  const { userId, leadId, allCalculators, selectedCalculator, leadData, isLowesLead, preferStoredTotals } = opts;
  if (!userId || !selectedCalculator) return;

  const noOfRollouts = allCalculators?.length || 0;
  const noOfDropsOnResultedJob = selectedCalculator?.dropPrice?.length || 0;
  const totalDropsAllJobs =
    allCalculators?.reduce((sum, calc) => sum + (calc.dropPrice?.length || 0), 0) || 0;

  const aggregatedValues =
    allCalculators?.reduce(
      (acc, calc) => ({
        totalRetail: acc.totalRetail + (parseFloat(String(calc.price)) || 0),
        totalCost:
          acc.totalCost +
          (parseFloat(String(calc.cost)) || calculateTiers(calc, !!isLowesLead, preferStoredTotals).cost),
      }),
      { totalRetail: 0, totalCost: 0 }
    ) || { totalRetail: 0, totalCost: 0 };

  const jobCategories = allCalculators?.reduce(
    (acc, calc) => {
      const price = parseFloat(String(calc.price)) || 0;
      const { par, retail } = calculateTiers(calc, !!isLowesLead, preferStoredTotals);
      if (price < par) acc.atCost += 1;
      else if (price >= par && price < retail) acc.atPar += 1;
      else acc.atRetail += 1;
      return acc;
    },
    { atCost: 0, atPar: 0, atRetail: 0 }
  ) || { atCost: 0, atPar: 0, atRetail: 0 };

  const totalJobs = allCalculators?.length || 0;
  const jobCategoryPercentages = {
    atCost: totalJobs > 0 ? Number(((jobCategories.atCost / totalJobs) * 100).toFixed(1)) : 0,
    atPar: totalJobs > 0 ? Number(((jobCategories.atPar / totalJobs) * 100).toFixed(1)) : 0,
    atRetail: totalJobs > 0 ? Number(((jobCategories.atRetail / totalJobs) * 100).toFixed(1)) : 0,
  };

  const dropDeltas: any[] = [];
  if (selectedCalculator?.dropPrice?.length > 0) {
    const originalPrice = parseFloat(String(selectedCalculator.price)) || 0;
    let previousPrice = originalPrice;
    selectedCalculator.dropPrice.forEach((dropObj: any, index: number) => {
      const currentDropPrice = parseFloat(String(dropObj.dropedPrice ?? dropObj.price)) || 0;
      dropDeltas.push({
        dropNumber: index + 1,
        dropPrice: currentDropPrice,
        dropStatus: dropObj.status || '',
        dropPaymentMethod: dropObj.paymentMethod || '',
        deltaFromPrevious: `${calculateDelta(currentDropPrice, previousPrice)}%`,
        deltaFromOriginal: `${calculateDelta(currentDropPrice, originalPrice)}%`,
      });
      previousPrice = currentDropPrice;
    });
  }

  const resultedPrice = parseFloat(String(leadData?.originalContractPrice || leadData?.lastPriceQuoted || 0));
  const rolloutPrice = parseFloat(String(selectedCalculator?.price)) || 0;
  const deltaFromRolloutToResult = calculateDelta(resultedPrice, rolloutPrice);
  const resultedJobTiers = calculateTiers(selectedCalculator, !!isLowesLead, preferStoredTotals);

  const paymentPlanSequence: string[] = [];
  const rolloutMethod = selectedCalculator?.paymentMethod || selectedCalculator?.inputs?.paymentPlan || '';
  if (isPaymentPlanMethod(rolloutMethod)) paymentPlanSequence.push(rolloutMethod);

  if (selectedCalculator?.dropPrice) {
    selectedCalculator.dropPrice.forEach((drop: any) => {
      const dropMethod = drop.paymentMethod || '';
      if (isPaymentPlanMethod(dropMethod) && dropMethod !== paymentPlanSequence[paymentPlanSequence.length - 1]) {
        paymentPlanSequence.push(dropMethod);
      }
    });
  }

  const confirmedTs =
    consumeRolloutConfirmedTimestamp(leadId, selectedCalculator._id) ||
    selectedCalculator?.confirmedAt ||
    selectedCalculator?.createdAt;
  const resultedLeadTime = new Date(leadData?.timestamp || Date.now());
  const confirmedRolloutsTime = confirmedTs ? new Date(confirmedTs) : null;
  const demoDurationMs = confirmedRolloutsTime
    ? resultedLeadTime.getTime() - confirmedRolloutsTime.getTime()
    : 0;

  await logEvent('rollout_and_drop_summary', {
    user_id: userId,
    created_by: userId,
    module_type: 'rollout_and_drop',
    meta: {
      calculatorId: selectedCalculator._id,
      appointmentId: selectedCalculator.appointmentId,
      leadId,
      noOfRollouts,
      noOfDropsOnResultedJob,
      noOfDropsAllJobs: totalDropsAllJobs,
      noOfJobsAtCost: jobCategories.atCost,
      noOfJobsAtPar: jobCategories.atPar,
      noOfJobsAtRetail: jobCategories.atRetail,
      percentageJobsAtCost: `${jobCategoryPercentages.atCost}%`,
      percentageJobsAtPar: `${jobCategoryPercentages.atPar}%`,
      percentageJobsAtRetail: `${jobCategoryPercentages.atRetail}%`,
      aggregatedRetailPrice: aggregatedValues.totalRetail,
      aggregatedCostPrice: aggregatedValues.totalCost,
      resultedJobCost: resultedJobTiers.cost,
      resultedJobPar: resultedJobTiers.par,
      resultedJobRetail: resultedJobTiers.retail,
      resultedJobPrice: rolloutPrice,
      rolloutPaymentMethod: rolloutMethod,
      resultedPaymentMethod: leadData?.balancePaymentMethod || leadData?.paymentMethod || '',
      dropDeltas,
      deltaFromRolloutToResult: `${deltaFromRolloutToResult}%`,
      paymentPlansOnResultedJob: paymentPlanSequence.length,
      paymentPlansList: paymentPlanSequence,
      demoDurationMinutes: Math.floor(demoDurationMs / (1000 * 60)),
      demoDurationHours: (demoDurationMs / (1000 * 60 * 60)).toFixed(2),
      resultStatus: leadData?.result || 'Unknown',
      action: 'job_builder_submitted_with_rollout_drop_summary',
    },
  });
};
