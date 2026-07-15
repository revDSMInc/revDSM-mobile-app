import { logEvent } from '../../services/api/LoggerService';
import { logPaymentMethodInherited } from './rollout-log-meta';

export const logCalculatorCreated = async (opts: {
  userId: string;
  calculatorId: string;
  appointmentId: string;
  calculatorTitle: string;
  isFirstCalculator?: boolean;
  calculatorPosition?: number;
  leadId?: string;
}) => {
  await logEvent('create', {
    user_id: opts.userId,
    created_by: opts.userId,
    module_type: 'calculator',
    meta: {
      calculatorId: opts.calculatorId,
      appointmentId: opts.appointmentId,
      calculatorTitle: opts.calculatorTitle,
      ...(opts.calculatorPosition !== undefined && { calculatorPosition: opts.calculatorPosition }),
      ...(opts.isFirstCalculator && { isFirstCalculator: true }),
      action: opts.isFirstCalculator ? 'Created new calculator tab' : 'calculator_created',
      ...(opts.leadId && { leadId: opts.leadId }),
      resetCycle: 0,
    },
  });
};


/**
 * Web parity (DealCenterContext.js:218-234): a `calculator_field_entry` change per
 * edited calculator field. Fired by the dynamic calculator save engine, which
 * previously emitted no calculator activity events at all.
 */
export const logCalculatorFieldEntry = async (opts: {
  userId: string;
  calculatorId: string;
  appointmentId?: string;
  calculatorTitle?: string;
  fieldLabel?: string;
  fieldValue?: any;
  fieldCategory?: string;
  oldValue?: any;
  newValue?: any;
  leadId?: string;
}) => {
  if (!opts.userId || !opts.calculatorId) return;
  await logEvent('change', {
    user_id: opts.userId,
    created_by: opts.userId,
    module_type: 'calculator_field_entry',
    meta: {
      calculatorId: opts.calculatorId,
      appointmentId: opts.appointmentId,
      calculatorTitle: opts.calculatorTitle,
      fieldLabel: opts.fieldLabel,
      fieldValue: opts.fieldValue,
      fieldCategory: opts.fieldCategory,
      oldValue: opts.oldValue ?? '',
      newValue: opts.newValue ?? opts.fieldValue,
      action: 'calculator field changed',
      ...(opts.leadId && { leadId: opts.leadId }),
    },
  });
};

export const logSectionCleared = async (opts: {
  userId: string;
  calculatorId: string;
  appointmentId?: string;
  calculatorTitle?: string;
  fieldName: string;
  fieldLabel: string;
  fieldCategory: string;
}) => {
  await logEvent('change', {
    user_id: opts.userId,
    created_by: opts.userId,
    module_type: 'calculator_field_entry',
    meta: {
      calculatorId: opts.calculatorId,
      appointmentId: opts.appointmentId,
      calculatorTitle: opts.calculatorTitle,
      fieldName: opts.fieldName,
      fieldValue: 'cleared',
      fieldLabel: opts.fieldLabel,
      fieldCategory: opts.fieldCategory,
      action: 'section cleared',
    },
  });
};

export const logCalculatorRename = async (opts: {
  userId: string;
  calculatorId: string;
  appointmentId: string;
  previousCalculatorTitle: string;
  newCalculatorTitle: string;
}) => {
  await logEvent('rename', {
    user_id: opts.userId,
    created_by: opts.userId,
    module_type: 'calculator',
    meta: {
      calculatorId: opts.calculatorId,
      appointmentId: opts.appointmentId,
      newCalculatorTitle: opts.newCalculatorTitle,
      previousCalculatorTitle: opts.previousCalculatorTitle,
      action: 'calculator_rename',
    },
  });
};

export const logViewAllCalculators = async (userId: string) => {
  await logEvent('click', {
    user_id: userId,
    created_by: userId,
    module_type: 'view_all_calculators',
    meta: { action: 'view_all_calculators' },
  });
};

export const logBuildJobInitiated = async (opts: {
  userId: string;
  leadId: string;
  result?: string;
  calculatorId?: string;
  appointmentId?: string;
  calculatorType?: string;
}) => {
  await logEvent('click', {
    user_id: opts.userId,
    created_by: opts.userId,
    module_type: 'job_builder',
    meta: {
      draft: true,
      leadId: opts.leadId,
      result: opts.result,
      calculatorId: opts.calculatorId,
      appointmentId: opts.appointmentId,
      calculatorType: opts.calculatorType || 'lf-calculator',
      action: 'build_job_initiated',
    },
  });
};

export { logPaymentMethodInherited };
