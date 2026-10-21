import { logEvent } from '../../services/api/LoggerService';
import { paymentPlans } from '../calculator/payment-plans';
import { getCalculationResult } from '../calculator/calculator-calculation';
import { sanitizeCalculatorLogTitle } from './job-builder-auto-log';

export const stripZeroMarkup = (val?: number | string): number | string | undefined =>
  typeof val === 'string' ? val.replace(/\s*[+-]\s*0+\s*%\s*$/, '').trim() : val;

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
  const percentageOfRollout = stripZeroMarkup(
    calculateMarkupLabel(Number(fieldValue) || 0, costPrice, parPrice, retailPrice)
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

export const logRolloutChange = async (opts: {
  userId: string;
  leadId?: string;
  calculator: { id?: string; _id?: string; title?: string; appointmentId?: string };
  tiers: { cost: number; par: number; retail: number };
  percentageOfRollout?: number | string;
  change: Record<string, any>;
}) => {
  if (!opts.userId) return;
  const { fieldValue, oldValue, newValue, oldPercentageOfRollout, ...restChange } = opts.change;
  await logEvent('change', {
    user_id: opts.userId,
    created_by: opts.userId,
    module_type: 'rollout_and_drop',
    meta: {
      calculatorId: opts.calculator._id || opts.calculator.id,
      appointmentId: opts.calculator.appointmentId,
      calculatorTitle: opts.calculator.title,
      fieldValue,
      oldValue: oldValue ?? '',
      newValue: newValue ?? fieldValue,
      costPrice: Math.round(opts.tiers.cost || 0),
      parPrice: Math.round(opts.tiers.par || 0),
      retailPrice: Math.round(opts.tiers.retail || 0),
      ...(opts.percentageOfRollout !== undefined && { percentageOfRollout: stripZeroMarkup(opts.percentageOfRollout) }),
      ...(oldPercentageOfRollout !== undefined && { oldPercentageOfRollout: stripZeroMarkup(oldPercentageOfRollout) }),
      ...(opts.leadId && { leadId: opts.leadId }),
      ...restChange,
    },
  });
};

/**
 * Ticket 1308 - Forever Record must say WHICH In-Home Pre Order discount was used (15/20/25%).
 *
 * Two moments, mirroring the payment-method rules:
 *  - `seeded`  : the value in force when the rollout is confirmed (the rep never touched the
 *                chips, so the default applies). Fired once, from the Confirm Rollouts handler.
 *  - `changed` : the rep picked a different chip. Carries old -> new.
 *
 * `isDefault` records whether the value came from the rep's saved default (the toggle) rather
 * than the company default, because "15%" alone does not say which of the two it was.
 *
 * WARNING `fieldCategory` is ALWAYS 'rollout', before and after the rollout is confirmed. The
 * payment-method logger next door flips to 'drop' once confirmed, and that switch was copied
 * here by mistake - the discount is a property of the rollout itself, not of a drop, and the
 * portal groups it under Rollout & Drop either way. Do not re-add the flip.
 */
export const logPreOrderDiscount = async (opts: {
  userId: string;
  leadId?: string;
  calculator: { id?: string; _id?: string; title?: string; appointmentId?: string };
  tiers: { cost: number; par: number; retail: number };
  endPrice: number;
  discountPercentage: number;
  oldDiscountPercentage?: number | null;
  isDefault?: boolean;
}) => {
  if (!opts.userId || !opts.discountPercentage) return;
  const seeded = opts.oldDiscountPercentage == null;
  await logRolloutChange({
    userId: opts.userId,
    leadId: opts.leadId,
    calculator: opts.calculator,
    tiers: opts.tiers,
    percentageOfRollout: calculateMarkupLabel(
      opts.endPrice,
      opts.tiers.cost,
      opts.tiers.par,
      opts.tiers.retail
    ),
    change: {
      fieldName: 'preOrderDiscount',
      fieldLabel: 'In Home Pre Order Discount',
      fieldValue: opts.discountPercentage,
      fieldCategory: 'rollout',
      oldValue: seeded ? '' : `${opts.oldDiscountPercentage}%`,
      newValue: `${opts.discountPercentage}%`,
      preOrderDiscount: opts.discountPercentage,
      ...(seeded ? {} : { oldPreOrderDiscount: opts.oldDiscountPercentage }),
      ...(opts.isDefault !== undefined ? { isDefaultDiscount: opts.isDefault } : {}),
      /**
       * The portal renders 'inherited' off `inheritanceSource`, the same key
       * `logPaymentMethodInherited` sets - which is why 'Inherited Payment Method - CK' shows and
       * the discount line did not, even though `isDefaultDiscount: true` was already in the meta.
       * A boolean says the value EQUALS the rep's default; this says WHERE it came from, which is
       * what the Forever Record is reporting.
       *
       * ⚠️ Only on the SEEDED log. A rep who taps a chip has chosen explicitly, so a changed
       * discount is never inherited - even when the number they picked happens to equal their
       * default. `seeded` is exactly that distinction (`oldDiscountPercentage == null`).
       */
      ...(seeded && opts.isDefault ? { inheritanceSource: 'default pre order discount' } : {}),
      action: seeded
        ? 'in home pre order discount applied'
        : 'in home pre order discount changed',
    },
  });
};
