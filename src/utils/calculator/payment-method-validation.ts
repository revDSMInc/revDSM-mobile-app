import { paymentPlans } from './payment-plans';

export const WF_HIGH_MIN_PRICE = 7500;

export const WELLS_FARGO_HIGH_KEYS = [
  'wf3672',
  'wf3667',
  'wf3668',
  'wf3669',
  'wf3670',
  'wf3671',
];

export const getMinimumPriceForMethod = (paymentMethod: string): number => {
  const plan = paymentPlans[paymentMethod];
  return plan?.minPrice || 0;
};

export const validatePriceForPaymentMethod = (
  price: number,
  paymentMethod: string
): { isValid: boolean; minPrice: number; message: string } => {
  const minPrice = getMinimumPriceForMethod(paymentMethod);

  if (minPrice === 0) {
    return { isValid: true, minPrice: 0, message: '' };
  }

  const numericPrice = Number(price);
  const isValid = numericPrice >= minPrice;

  return {
    isValid,
    minPrice,
    message: isValid
      ? ''
      : `This payment plan requires a minimum price of $${minPrice.toLocaleString()}. Current price: $${numericPrice.toLocaleString()}.`,
  };
};

export const isLowesPaymentMethod = (paymentMethod: string): boolean =>
  paymentMethod?.startsWith('lowes_') || false;
