import {
  extrasList as defaultExtrasList,
  extrasList50 as defaultExtrasList50,
  markups as defaultMarkups,
  pricing as defaultPricing,
} from './pricing-data';
import { paymentPlans as defaultPaymentPlans } from './payment-plans';

export const calculateMonthlyPayment = (principal: number, apr: number, months: number) => {
  if (months <= 0 || principal <= 0) return 0;
  if (apr === 0) return principal / months;
  const monthlyRate = apr / 12;
  return (
    (principal * (monthlyRate * (1 + monthlyRate) ** months)) / ((1 + monthlyRate) ** months - 1)
  );
};

export const calculateQuote = (
  inputs: any,
  extras: any,
  storyCount: string | number,
  markup: number | string,
  paymentPlan: string,
  discounts: any,
  pricing = defaultPricing,
  markups = defaultMarkups,
  paymentPlans = defaultPaymentPlans
) => {
  let base = 0;
  const breakdownResult: any = {};
  const breakdownWithNumberNotPrice: any = {};

  // All stories gutters (5", 6" and 7")
  const gutter5Val =
    (Number(inputs?.gutter5DsE) || 0) * (pricing?.gutters?.['5_inch_all_stories'] || 0);
  const gutter6Val =
    (Number(inputs?.gutter6Ft1) || 0) * (pricing?.gutters?.['6_inch_all_stories'] || 0);
  const gutter7Val =
    (Number(inputs?.gutter7DsE) || 0) * (pricing?.gutters?.['7_inch_all_stories'] || 0);
  breakdownResult.gutter5All = gutter5Val;
  breakdownResult.gutter6All = gutter6Val;
  breakdownResult.gutter7All = gutter7Val;
  breakdownWithNumberNotPrice.gutter5All = Number(inputs?.gutter5DsE) || 0;
  breakdownWithNumberNotPrice.gutter6All = Number(inputs?.gutter6Ft1) || 0;
  breakdownWithNumberNotPrice.gutter7All = Number(inputs?.gutter7DsE) || 0;

  // Versa Max (all stories)
  const versaMaxVal =
    (Number(inputs?.versaMaxFt1) || 0) * (pricing?.filters?.versa_max_all_stories || 0);
  breakdownResult.versaMax = versaMaxVal;
  breakdownWithNumberNotPrice.versaMax = Number(inputs?.versaMaxFt1) || 0;

  let versaMaxTotal = versaMaxVal;
  let guttersTotal = gutter5Val + gutter6Val + gutter7Val;

  // Per-story filters
  const sCount = Number(storyCount) || 0;
  for (let s = 1; s <= sCount; s += 1) {
    const v6Key = `versa6Ft${s}`;
    const v7Key = `versa7Ft${s}`;
    const fKey = `filter45Ft${s}`;

    const v6Val =
      (Number(inputs?.[v6Key]) || 0) * ((pricing?.filters?.versa_6 as any)?.[String(s)] || 0);
    const v7Val =
      (Number(inputs?.[v7Key]) || 0) * ((pricing?.filters?.versa_7 as any)?.[String(s)] || 0);
    const fVal =
      (Number(inputs?.[fKey]) || 0) * ((pricing?.filters?.filter_4_5 as any)?.[String(s)] || 0);

    breakdownResult[`versa6${s}`] = v6Val;
    breakdownWithNumberNotPrice[`versa6${s}`] = Number(inputs?.[v6Key]) || 0;
    breakdownResult[`versa7${s}`] = v7Val;
    breakdownWithNumberNotPrice[`versa7${s}`] = Number(inputs?.[v7Key]) || 0;
    breakdownResult[`filter${s}`] = fVal;
    breakdownWithNumberNotPrice[`filter${s}`] = Number(inputs?.[fKey]) || 0;

    base += v6Val + v7Val + fVal;
  }

  base += gutter5Val + gutter6Val + gutter7Val + versaMaxVal;
  breakdownResult.gutters = guttersTotal;

  // Use the provided extrasList or default
  const activeExtrasList =
    markup === 50 || markup === '50' ? defaultExtrasList50 : defaultExtrasList;

  breakdownResult.extras = activeExtrasList.reduce(
    (sum: number, e: any) => sum + (Number(extras?.[e.id]) || 0) * (e.price || 0),
    0
  );
  base += breakdownResult.extras;

  breakdownWithNumberNotPrice.extras = Number(extras?.extras) || 0;
  breakdownWithNumberNotPrice.screens = Number(inputs?.screens) || 0;
  breakdownWithNumberNotPrice.ckToInstallers = Number(inputs?.ckToInstallers) || 0;

  const markupMult = (markups as any)?.[markup as any] || 1;
  const afterMarkup = base * markupMult;

  let afterDiscounts = afterMarkup;
  if (discounts?.seniorVet) afterDiscounts *= 0.9;
  if (discounts?.preOrder) afterDiscounts *= 0.75;

  const plan = (paymentPlans as any)?.[paymentPlan];
  let final = afterDiscounts * (1 + (plan?.fee || 0));
  final += Number(inputs?.ckToInstallers) || 0;

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
      // Deferred interest plan
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
      // Regular financing plan
      monthlyPaymentResult = calculateMonthlyPayment(
        loanPrincipal,
        plan.apr || 0,
        plan.totalLoanMonths
      );
      planDurationResult = plan.displayMonths;
    }
  }

  const savingsAmountResult = afterMarkup - afterDiscounts;

  // Parity with web: Payment plan business rules/checks
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
