import { paymentPlans } from './payment-plans';

export interface CommissionDetails {
  amount: number;
  details: {
    endPrice: number;
    bankFee: number;
    bankFeeAmount: number;
    afterBankFee: number;
    afterDeduction: number;
    commissionRate: number;
    threshold: string;
    baseCommission: number;
    overageCommission: number;
    paymentMethod: string;
    paymentMethodLabel: string;
  };
}

export function calculateCommission(endPrice: number, paymentMethod: string): CommissionDetails {
  if (!endPrice || !paymentMethod || endPrice <= 0) {
    return {
      amount: 0,
      details: {
        endPrice: 0,
        bankFee: 0,
        bankFeeAmount: 0,
        afterBankFee: 0,
        afterDeduction: 0,
        commissionRate: 0,
        threshold: 'none',
        baseCommission: 0,
        overageCommission: 0,
        paymentMethod,
        paymentMethodLabel: '',
      },
    };
  }

  const plan = paymentPlans[paymentMethod];
  const bankFeeRate = plan?.fee || 0;

  const afterBankFee = endPrice * (1 - bankFeeRate);
  const afterDeduction = Math.max(0, afterBankFee - 500);

  const THRESHOLD_130_RETAIL = 5102;
  const THRESHOLD_100_RETAIL = 4046;
  const THRESHOLD_65_RETAIL = 2814; // PAR threshold
  const THRESHOLD_50_RETAIL = 2023;
  const THRESHOLD_40_RETAIL = 1619;

  let commissionAmount = 0;
  let commissionRate = 0;
  let threshold = 'none';
  let baseCommission = 0;
  let overageCommission = 0;

  if (endPrice >= THRESHOLD_130_RETAIL) {
    threshold = '130% retail';
    commissionRate = 0.24;
    commissionAmount = afterDeduction * commissionRate;
    baseCommission = commissionAmount;
  } else if (endPrice >= THRESHOLD_100_RETAIL) {
    threshold = '100% retail';
    commissionRate = 0.20;
    commissionAmount = afterDeduction * commissionRate;
    baseCommission = commissionAmount;
  } else if (endPrice >= THRESHOLD_65_RETAIL) {
    threshold = '65% retail (PAR)';
    commissionRate = 0.08;
    baseCommission = afterDeduction * 0.08;
    const overage = endPrice - THRESHOLD_65_RETAIL;
    overageCommission = overage * 0.40;
    commissionAmount = baseCommission + overageCommission;
  } else if (endPrice >= THRESHOLD_50_RETAIL) {
    threshold = '50% retail';
    commissionRate = 0.05;
    commissionAmount = afterDeduction * commissionRate;
    baseCommission = commissionAmount;
  } else if (endPrice >= THRESHOLD_40_RETAIL) {
    threshold = '40% retail';
    commissionRate = 0.02;
    commissionAmount = afterDeduction * commissionRate;
    baseCommission = commissionAmount;
  } else {
    threshold = 'below 40% retail';
    commissionRate = 0.01;
    commissionAmount = afterDeduction * commissionRate;
    baseCommission = commissionAmount;
  }

  commissionAmount = Math.round(commissionAmount * 100) / 100;
  baseCommission = Math.round(baseCommission * 100) / 100;
  overageCommission = Math.round(overageCommission * 100) / 100;

  return {
    amount: commissionAmount,
    details: {
      endPrice: Math.round(endPrice * 100) / 100,
      bankFee: bankFeeRate,
      bankFeeAmount: Math.round((endPrice * bankFeeRate) * 100) / 100,
      afterBankFee: Math.round(afterBankFee * 100) / 100,
      afterDeduction: Math.round(afterDeduction * 100) / 100,
      commissionRate,
      threshold,
      baseCommission,
      overageCommission,
      paymentMethod,
      paymentMethodLabel: plan?.label || paymentMethod,
    },
  };
}
