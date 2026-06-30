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

const calculateTiers = (calculator: any, isLowesLead: boolean) => {
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
}) => {
  const { userId, leadId, allCalculators, selectedCalculator, leadData, isLowesLead } = opts;
  if (!userId || !selectedCalculator) return;

  const noOfRollouts = allCalculators?.length || 0;
  const noOfDropsOnResultedJob = selectedCalculator?.dropPrice?.length || 0;
  const totalDropsAllJobs =
    allCalculators?.reduce((sum, calc) => sum + (calc.dropPrice?.length || 0), 0) || 0;

  const aggregatedValues =
    allCalculators?.reduce(
      (acc, calc) => ({
        totalRetail: acc.totalRetail + (parseFloat(String(calc.price)) || 0),
        totalCost: acc.totalCost + (parseFloat(String(calc.cost)) || calculateTiers(calc, !!isLowesLead).cost),
      }),
      { totalRetail: 0, totalCost: 0 }
    ) || { totalRetail: 0, totalCost: 0 };

  const jobCategories = allCalculators?.reduce(
    (acc, calc) => {
      const price = parseFloat(String(calc.price)) || 0;
      const { par, retail } = calculateTiers(calc, !!isLowesLead);
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
  const resultedJobTiers = calculateTiers(selectedCalculator, !!isLowesLead);

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
