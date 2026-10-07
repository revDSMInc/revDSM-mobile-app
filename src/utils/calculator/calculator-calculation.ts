import { calculateResultUtil } from './calculation-results-util';
import { pricing, extrasList, extrasList50 } from './pricing-data';
import { paymentPlans } from './payment-plans';

export const getCalculationResult = (
  details: any,
  markupKey: string,
  paymentMethod: string,
  options: {
    isLowesLead?: boolean;
    discounts?: any;
    ckToInstallers?: number;
  } = {}
) =>
  calculateResultUtil({
    details,
    markupKey,
    pricing,
    extrasList,
    extrasList50,
    paymentPlans,
    paymentMethod,
    isLowesLead: options.isLowesLead,
    discounts: options.discounts,
    ckToInstallers: options.ckToInstallers ?? 0,
  });

export const getTierResults = (
  details: any,
  options: {
    selectedPaymentMethod?: string;
    markupKey?: string;
    isLowesLead?: boolean;
    discounts?: any;
    ckToInstallers?: number;
  } = {}
) => {
  const plan = options.selectedPaymentMethod || details?.inputs?.paymentPlan || 'check';
  const markupKey = options.markupKey || details?.inputs?.markup || '100';
  const tierOpts = { isLowesLead: options.isLowesLead, discounts: options.discounts };

  const price50 = getCalculationResult(details, '50', plan, tierOpts);
  const price65 = getCalculationResult(details, '65', plan, tierOpts);
  const price100 = getCalculationResult(details, '100', plan, tierOpts);

  const costAtCheck = getCalculationResult(details, '50', 'check', tierOpts);
  const parAtCheck = getCalculationResult(details, '65', 'check', tierOpts);
  const retailAtCheck = getCalculationResult(details, '100', 'check', tierOpts);

  const total = getCalculationResult(details, markupKey, plan, {
    ...tierOpts,
    ckToInstallers: options.ckToInstallers ?? 0,
  });

  return {
    price50,
    price65,
    price100,
    costAtCheck,
    parAtCheck,
    retailAtCheck,
    total,
  };
};
