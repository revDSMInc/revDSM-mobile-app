import {
  extrasList as defaultExtrasList,
  extrasList50 as defaultExtrasList50,
  markups as defaultMarkups,
  pricing as defaultPricing,
} from './pricing-data';
import { paymentPlans as defaultPaymentPlans } from './payment-plans';
import { getVerticalItemRetail } from './verticals-data';

export const calculateMonthlyPayment = (principal: number, apr: number, months: number) => {
  if (months <= 0 || principal <= 0) return 0;
  if (apr === 0) return principal / months;
  const monthlyRate = apr / 12;
  return (
    (principal * (monthlyRate * (1 + monthlyRate) ** months)) / ((1 + monthlyRate) ** months - 1)
  );
};

const LEGACY_FIELD_IDS = new Set([
  'gutter5DsE', 'gutter6Ft1', 'gutter7DsE',
  'versaMaxFt1',
  'versa6Ft1', 'versa6Ft2', 'versa6Ft3',
  'versa7Ft1', 'versa7Ft2', 'versa7Ft3',
  'filter45Ft1', 'filter45Ft2', 'filter45Ft3',
  'screens', 'ckToInstallers',
  ...defaultExtrasList.map((e) => e.id),
]);

export const calculateQuote = (
  inputs: any,
  extras: any,
  storyCount: string | number,
  markup: number | string,
  paymentPlan: string,
  discounts: any,
  pricing = defaultPricing,
  markups = defaultMarkups,
  paymentPlans = defaultPaymentPlans,
  verticalInputs: any = {},
  skipAdminFee = false
) => {
  let base = 0;
  const breakdownResult: any = {};
  const breakdownWithNumberNotPrice: any = {};

  const mergedInputs = { ...inputs };
  const mergedExtras = { ...extras };
  if (verticalInputs && typeof verticalInputs === 'object') {
    Object.entries(verticalInputs).forEach(([id, val]) => {
      if (LEGACY_FIELD_IDS.has(id)) {
        const v = val === '' || val === null || val === undefined ? '' : Number(val);
        mergedInputs[id] = v;
        mergedExtras[id] = v;
      }
    });
  }

  const gutter5Val =
    (Number(mergedInputs?.gutter5DsE) || 0) * (pricing?.gutters?.['5_inch_all_stories'] || 0);
  const gutter6Val =
    (Number(mergedInputs?.gutter6Ft1) || 0) * (pricing?.gutters?.['6_inch_all_stories'] || 0);
  const gutter7Val =
    (Number(mergedInputs?.gutter7DsE) || 0) * (pricing?.gutters?.['7_inch_all_stories'] || 0);
  breakdownResult.gutter5All = gutter5Val;
  breakdownResult.gutter6All = gutter6Val;
  breakdownResult.gutter7All = gutter7Val;
  breakdownWithNumberNotPrice.gutter5All = Number(mergedInputs?.gutter5DsE) || 0;
  breakdownWithNumberNotPrice.gutter6All = Number(mergedInputs?.gutter6Ft1) || 0;
  breakdownWithNumberNotPrice.gutter7All = Number(mergedInputs?.gutter7DsE) || 0;

  const versaMaxVal =
    (Number(mergedInputs?.versaMaxFt1) || 0) * (pricing?.filters?.versa_max_all_stories || 0);
  breakdownResult.versaMax = versaMaxVal;
  breakdownWithNumberNotPrice.versaMax = Number(mergedInputs?.versaMaxFt1) || 0;

  let versaMaxTotal = versaMaxVal;
  let guttersTotal = gutter5Val + gutter6Val + gutter7Val;

  const sCount = Number(storyCount) || 0;
  for (let s = 1; s <= sCount; s += 1) {
    const v6Key = `versa6Ft${s}`;
    const v7Key = `versa7Ft${s}`;
    const fKey = `filter45Ft${s}`;

    const v6Val =
      (Number(mergedInputs?.[v6Key]) || 0) * ((pricing?.filters?.versa_6 as any)?.[String(s)] || 0);
    const v7Val =
      (Number(mergedInputs?.[v7Key]) || 0) * ((pricing?.filters?.versa_7 as any)?.[String(s)] || 0);
    const fVal =
      (Number(mergedInputs?.[fKey]) || 0) * ((pricing?.filters?.filter_4_5 as any)?.[String(s)] || 0);

    breakdownResult[`versa6${s}`] = v6Val;
    breakdownWithNumberNotPrice[`versa6${s}`] = Number(mergedInputs?.[v6Key]) || 0;
    breakdownResult[`versa7${s}`] = v7Val;
    breakdownWithNumberNotPrice[`versa7${s}`] = Number(mergedInputs?.[v7Key]) || 0;
    breakdownResult[`filter${s}`] = fVal;
    breakdownWithNumberNotPrice[`filter${s}`] = Number(mergedInputs?.[fKey]) || 0;

    base += v6Val + v7Val + fVal;
  }

  base += gutter5Val + gutter6Val + gutter7Val + versaMaxVal;
  breakdownResult.gutters = guttersTotal;

  breakdownResult.extras = defaultExtrasList.reduce(
    (sum: number, e: any) => sum + (Number(mergedExtras?.[e.id]) || 0) * (e.price || 0),
    0
  );
  base += breakdownResult.extras;

  let verticalTotal = 0;
  if (verticalInputs && typeof verticalInputs === 'object') {
    Object.entries(verticalInputs).forEach(([id, qty]) => {
      if (LEGACY_FIELD_IDS.has(id)) return;
      const numQty = Number(qty) || 0;
      if (numQty > 0) {
        const retailPrice = getVerticalItemRetail(id);
        const lineTotal = numQty * retailPrice;
        verticalTotal += lineTotal;
        breakdownResult[id] = lineTotal;
        breakdownWithNumberNotPrice[id] = numQty;
      }
    });
  }
  base += verticalTotal;

  breakdownWithNumberNotPrice.extras = Number(mergedExtras?.extras) || Number(extras?.extras) || 0;
  breakdownWithNumberNotPrice.screens = Number(mergedInputs?.screens) || Number(inputs?.screens) || 0;
  breakdownWithNumberNotPrice.ckToInstallers = Number(mergedInputs?.ckToInstallers) || Number(inputs?.ckToInstallers) || 0;

  const markupMult = (markups as any)?.[markup as any] || 1;
  const afterMarkup = base * markupMult;

  let afterDiscounts = afterMarkup;
  if (discounts?.seniorVet) afterDiscounts *= 0.9;
  if (discounts?.preOrder) afterDiscounts *= 0.75;

  const plan = (paymentPlans as any)?.[paymentPlan];
  let final = skipAdminFee ? afterDiscounts : afterDiscounts * (1 + (plan?.fee || 0));
  final += Number(mergedInputs?.ckToInstallers) || Number(inputs?.ckToInstallers) || 0;

  let jobMinimumStatusResult = 'N/A';
  if (final < 200 && base > 0) {
    jobMinimumStatusResult = `Applied`;
    final = 200;
  } else if (base === 0) {
    jobMinimumStatusResult = 'No items';
  } else {
    jobMinimumStatusResult = 'Met';
  }

  let monthlyPaymentResult = 0;
  let planDurationResult = 'N/A';
  let deferredScenariosResult = null;
  let showDeferredScenariosResult = false;

  if (plan?.type === 'financing') {
    const loanPrincipal = afterDiscounts * (1 + (plan.pf || 0));

    if (plan.deferredMonths && plan.deferredMonths > 0) {
      const monthlyRateAfterDeferred = (plan.aprAfterDeferred || 0) / 12;
      const deferredInterest =
        loanPrincipal * ((1 + monthlyRateAfterDeferred) ** plan.deferredMonths - 1);
      const balanceAfterDeferred = loanPrincipal + deferredInterest;
      const remainingMonths = plan.totalLoanMonths - plan.deferredMonths;

      let monthlyPaymentAfterDeferred = 0;
      if (remainingMonths > 0) {
        monthlyPaymentAfterDeferred = calculateMonthlyPayment(
          balanceAfterDeferred,
          plan.aprAfterDeferred || 0,
          remainingMonths
        );
      }

      const totalPostPromoPayments = monthlyPaymentAfterDeferred * remainingMonths;

      deferredScenariosResult = {
        scenario1: {
          totalPaidDuringPromo: afterDiscounts,
          balanceAtEndPromo: 0,
          interestCharged: 0,
          loanStatus: 'The loan is closed and paid in full. There are no further obligations.',
          totalAmountPaid: afterDiscounts,
        },
        scenario2: {
          totalPaidDuringPromo: 0,
          balanceAtEndPromo: balanceAfterDeferred,
          interestCharged: deferredInterest,
          remainingMonths,
          monthlyPaymentAfterDeferred,
          loanStatus: `The loan is still open. The new balance is $${balanceAfterDeferred.toFixed(
            2
          )} (original principal + deferred interest). The borrower is now required to make monthly payments of $${monthlyPaymentAfterDeferred.toFixed(
            2
          )} at ${((plan.aprAfterDeferred || 0) * 100).toFixed(
            2
          )}% APR for the remaining ${remainingMonths} months.`,
          totalAmountPaid: totalPostPromoPayments,
        },
      };

      showDeferredScenariosResult = true;
      monthlyPaymentResult = 0; // $0 during promo period
      planDurationResult = plan.displayMonths;
    } else {
      monthlyPaymentResult = calculateMonthlyPayment(
        loanPrincipal,
        plan.apr || 0,
        plan.totalLoanMonths
      );
      planDurationResult = plan.displayMonths;
    }
  }

  const savingsAmountResult = afterMarkup - afterDiscounts;

  const warnings: string[] = [];
  const wellsFargoHighKeys = ['wf3672', 'wf3667', 'wf3668', 'wf3669', 'wf3670', 'wf3671'];
  if (wellsFargoHighKeys.includes(paymentPlan) && final < 7500) {
    warnings.push('Wells Fargo High plans require a minimum job total of $7,500.');
  }

  return {
    baseRetailTotal: base,
    totalAfterMarkup: afterMarkup,
    totalAfterDiscounts: afterDiscounts,
    finalPrice: final,
    breakdown: breakdownResult,
    breakdownWithNumberNotPrice: breakdownWithNumberNotPrice,
    monthlyPayment: monthlyPaymentResult,
    planDuration: planDurationResult,
    jobMinimumStatus: jobMinimumStatusResult,
    savingsAmount: savingsAmountResult,
    deferredScenarios: deferredScenariosResult,
    showDeferredScenarios: showDeferredScenariosResult,
    warnings,
  };
};
