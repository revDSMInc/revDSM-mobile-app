import { logEvent } from '../../services/api/LoggerService';
import { paymentPlans } from '../calculator/payment-plans';
import { getCalculationResult } from '../calculator/calculator-calculation';
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
  isLowesLead?: boolean;
  [key: string]: any;
}

export const getCalculatorTitle = (calc: any) => calc?.name || calc?.title || '';

const resolveTierPrices = (
  calculator: any,
  tierPrices?: { costPrice: number; parPrice: number; retailPrice: number },
  isLowesLead?: boolean
) => {
  if (tierPrices) return tierPrices;
  const tierOpts = { isLowesLead };
  return {
    costPrice: Math.round(getCalculationResult(calculator, '50', 'check', tierOpts)) || 0,
    parPrice: Math.round(getCalculationResult(calculator, '65', 'check', tierOpts)) || 0,
    retailPrice: Math.round(getCalculationResult(calculator, '100', 'check', tierOpts)) || 0,
  };
};

/** Mirrors web ViewAllCalculators fireRolloutLog — tier prices computed inline when omitted */
export const fireRolloutLog = async (
  userId: string,
  calculator: any,
  change: RolloutLogChange,
  leadId?: string,
  tierPrices?: { costPrice: number; parPrice: number; retailPrice: number }
) => {
  if (!userId || !calculator) return;

  const { isLowesLead, ...changeRest } = change;
  const { costPrice, parPrice, retailPrice } = resolveTierPrices(
    calculator,
    tierPrices,
    isLowesLead
  );
  const fieldValue = changeRest.newValue ?? changeRest.fieldValue;
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
      fieldLabel: changeRest.fieldLabel,
      fieldValue: changeRest.fieldValue,
      fieldCategory: changeRest.fieldCategory,
      oldValue: changeRest.oldValue ?? '',
      newValue: changeRest.newValue ?? changeRest.fieldValue,
      action: changeRest.action,
      costPrice,
      parPrice,
      retailPrice,
      percentageOfRollout,
      leadId,
      ...Object.fromEntries(
        Object.entries(changeRest).filter(
          ([k]) =>
            ![
              'fieldLabel',
              'fieldValue',
              'fieldCategory',
              'oldValue',
              'newValue',
              'action',
              'isLowesLead',
            ].includes(k)
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
  const meta: Record<string, any> = {
    calculatorId: opts.calculatorId,
    appointmentId: opts.appointmentId,
    calculatorTitle: sanitizeCalculatorLogTitle(opts.calculatorTitle),
    fromCalculator: opts.fromCalculator ?? null,
    toCalculator: opts.toCalculator,
    paymentMethod: opts.paymentMethod,
    action: 'payment method inherited',
    inheritanceSource: opts.inheritanceSource,
  };

  if (opts.sourceCalculatorTitle) {
    meta.sourceCalculatorTitle = sanitizeCalculatorLogTitle(opts.sourceCalculatorTitle);
  }
  if (opts.newCalculatorTitle) {
    meta.newCalculatorTitle = sanitizeCalculatorLogTitle(opts.newCalculatorTitle);
  }
  if (opts.leadId) {
    meta.leadId = opts.leadId;
  }

  await logEvent('change', {
    user_id: opts.userId,
    created_by: opts.userId,
    module_type: 'rollout_and_drop',
    meta,
  });
};

export const getPaymentPlanLabel = (key: string) => paymentPlans[key]?.label || key;
