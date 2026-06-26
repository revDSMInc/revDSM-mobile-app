import { logEvent } from '../../services/api/LoggerService';
import { paymentPlans } from '../calculator/payment-plans';
import { sanitizeCalculatorLogTitle } from './job-builder-auto-log';

export const calculateMarkupLabel = (
  endPrice: number,
  price50: number,
  price65: number,
  price100: number
): string => {
  const numericPrice = Number(endPrice);
  if (isNaN(numericPrice) || numericPrice < 0) return '';

  const cost = Math.round(price50) || 0;
  const par = Math.round(price65) || 0;
  const retail = Math.round(price100) || 0;

  let anchor = cost;
  let label = 'COST';

  if (numericPrice >= retail) {
    anchor = retail;
    label = 'RETAIL';
  } else if (numericPrice >= par) {
    anchor = par;
    label = 'PAR';
  } else if (numericPrice >= cost) {
    anchor = cost;
    label = 'COST';
  }

  if (!anchor || anchor === 0) return '';

  const percent = Math.round(((numericPrice - anchor) / anchor) * 100);
  if (percent === 0) return label;
  return `${label} + ${percent}%`;
};

export interface RolloutLogChange {
  fieldName?: string;
  fieldLabel?: string;
  fieldValue?: any;
  fieldCategory?: string;
  oldValue?: any;
  newValue?: any;
  action: string;
  [key: string]: any;
}

export const getCalculatorTitle = (calc: any) => calc?.name || calc?.title || '';

export const fireRolloutLog = async (
  userId: string,
  calculator: any,
  change: RolloutLogChange,
  leadId?: string,
  tierPrices?: { costPrice: number; parPrice: number; retailPrice: number }
) => {
  if (!userId || !calculator) return;

  const costPrice = tierPrices?.costPrice ?? 0;
  const parPrice = tierPrices?.parPrice ?? 0;
  const retailPrice = tierPrices?.retailPrice ?? 0;
  const fieldValue = change.newValue ?? change.fieldValue;
  const percentageOfRollout = calculateMarkupLabel(
    Number(fieldValue) || 0,
    costPrice,
    parPrice,
    retailPrice
  );

  await logEvent('change', {
    user_id: userId,
    created_by: userId,
    module_type: 'rollout_and_drop',
    meta: {
      calculatorId: calculator._id,
      appointmentId: calculator.appointmentId,
      calculatorTitle: getCalculatorTitle(calculator),
      fieldLabel: change.fieldLabel,
      fieldValue: change.fieldValue,
      fieldCategory: change.fieldCategory,
      oldValue: change.oldValue ?? '',
      newValue: change.newValue ?? change.fieldValue,
      action: change.action,
      costPrice,
      parPrice,
      retailPrice,
      percentageOfRollout,
      leadId,
      ...Object.fromEntries(
        Object.entries(change).filter(
          ([k]) => !['fieldLabel', 'fieldValue', 'fieldCategory', 'oldValue', 'newValue', 'action'].includes(k)
        )
      ),
    },
  });
};

export const logPaymentMethodInherited = async (opts: {
  userId: string;
  calculatorId: string;
  appointmentId: string;
  calculatorTitle: string;
  paymentMethod: string;
  inheritanceSource: string;
  fromCalculator?: string | null;
  toCalculator: string;
  sourceCalculatorTitle?: string;
  newCalculatorTitle?: string;
  leadId?: string;
}) => {
  await logEvent('change', {
    user_id: opts.userId,
    created_by: opts.userId,
    module_type: 'rollout_and_drop',
    meta: {
      calculatorId: opts.calculatorId,
      appointmentId: opts.appointmentId,
      calculatorTitle: sanitizeCalculatorLogTitle(opts.calculatorTitle),
      fromCalculator: opts.fromCalculator ?? null,
      toCalculator: opts.toCalculator,
      paymentMethod: opts.paymentMethod,
      action: 'payment method inherited',
      inheritanceSource: opts.inheritanceSource,
      sourceCalculatorTitle: opts.sourceCalculatorTitle
        ? sanitizeCalculatorLogTitle(opts.sourceCalculatorTitle)
        : undefined,
      newCalculatorTitle: opts.newCalculatorTitle
        ? sanitizeCalculatorLogTitle(opts.newCalculatorTitle)
        : undefined,
      leadId: opts.leadId,
    },
  });
};

export const logCalculatorDuplicatedRolloutGroup = async (opts: {
  userId: string;
  calculatorId: string;
  appointmentId: string;
  calculatorTitle: string;
  sourceCalculatorId: string;
  sourceCalculatorTitle: string;
  leadId?: string;
}) => {
  await logEvent('change', {
    user_id: opts.userId,
    created_by: opts.userId,
    module_type: 'rollout_and_drop',
    meta: {
      calculatorId: opts.calculatorId,
      appointmentId: opts.appointmentId,
      calculatorTitle: sanitizeCalculatorLogTitle(opts.calculatorTitle),
      sourceCalculatorId: opts.sourceCalculatorId,
      sourceCalculatorTitle: sanitizeCalculatorLogTitle(opts.sourceCalculatorTitle),
      newCalculatorTitle: sanitizeCalculatorLogTitle(opts.calculatorTitle),
      action: 'calculator_duplicated',
      leadId: opts.leadId,
    },
  });
};

export const getPaymentPlanLabel = (key: string) => paymentPlans[key]?.label || key;
