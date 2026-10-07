import { logEvent } from '../../services/api/LoggerService';

const MODULE = 'investment_center';

type ProgramKey = 'inhome' | 'oneyear';

export type DisplayProgramKey = ProgramKey | 'msrp';

const PROGRAM_LABELS: Record<DisplayProgramKey, string> = {
  inhome: 'In-Home Pre Order',
  oneyear: '1 Year Program',
  msrp: 'MSRP',
};

const programLabel = (p: DisplayProgramKey) => PROGRAM_LABELS[p] || String(p);

interface Base {
  userId: string;
  leadId?: string;
  calculatorId?: string;
  calculatorTitle?: string;
  visitId?: string;
}

const baseMeta = (o: Base, extra: Record<string, unknown>) => ({
  ...(o.calculatorId ? { calculatorId: o.calculatorId } : {}),
  ...(o.calculatorTitle ? { calculatorTitle: o.calculatorTitle } : {}),
  ...(o.leadId ? { leadId: o.leadId } : {}),
  ...(o.visitId ? { visitId: o.visitId } : {}),
  ...extra,
});

export const logInvestmentCenterOpened = async (o: Base & { calculatorCount?: number }) => {
  if (!o.userId) return;
  await logEvent('view', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_center_opened',
      ...(o.calculatorCount !== undefined ? { calculatorCount: o.calculatorCount } : {}),
    }),
  });
};

export interface ProgramBaseline {
  price?: number;
  monthly?: number;
  planLabel?: string;
}

export interface ScopeBaseline {
  msrp?: ProgramBaseline;
  oneYear?: ProgramBaseline;
  inHome?: ProgramBaseline;
}

export const logInvestmentCalculatorViewed = async (
  o: Base & { baseline?: ScopeBaseline },
) => {
  if (!o.userId || !o.calculatorId) return;
  await logEvent('view', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_calculator_viewed',
      ...(o.baseline ? { baseline: o.baseline } : {}),
    }),
  });
};

export const logInvestmentConsentPortalOpened = async (o: Base) => {
  if (!o.userId) return;
  await logEvent('view', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, { action: 'consent portal opened' }),
  });
};

export const logInvestmentConsentFormSubmitted = async (o: {
  userId: string;
  formType?: string;
  customerName?: string;
  email?: string;
  phoneNumber?: string;
  leadId?: string;
  repName?: string;
}) => {
  if (!o.userId) return;
  await logEvent('submit', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: {
      formType: o.formType,
      customerName: o.customerName,
      email: o.email,
      phoneNumber: o.phoneNumber,
      leadId: o.leadId,
      repName: o.repName,
      action: o.formType === 'digital' ? 'digital_consent_form_submitted' : 'paper_consent_form_submitted',
    },
  });
};

export const logInvestmentConsentFormCreated = async (o: {
  userId: string;
  formType?: string;
  leadId?: string;
  formattedAddress?: string;
  filename?: string;
}) => {
  if (!o.userId) return;
  await logEvent('create', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: {
      formType: o.formType,
      leadId: o.leadId,
      formattedAddress: o.formattedAddress || '',
      filename: o.filename,
    },
  });
};

export const logInvestmentOptIn = async (
  o: Base & {
    program: ProgramKey;
    price?: number;
    monthly?: number;
    planKey?: string;
    downPayment?: number;
  },
) => {
  if (!o.userId) return;
  await logEvent('select', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_opt_in',
      program: o.program,
      programLabel: programLabel(o.program),
      ...(o.price !== undefined ? { price: o.price } : {}),
      ...(o.monthly ? { monthlyPayment: o.monthly } : {}),
      ...(o.planKey ? { paymentPlan: o.planKey } : {}),
      ...(o.downPayment ? { downPayment: o.downPayment } : {}),
    }),
  });
};

export const logInvestmentOptOut = async (
  o: Base & { program: ProgramKey; cancelledBeforeConfirm?: boolean },
) => {
  if (!o.userId) return;
  await logEvent('reset', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_opt_out',
      program: o.program,
      programLabel: programLabel(o.program),
      ...(o.cancelledBeforeConfirm ? { cancelledBeforeConfirm: true } : {}),
    }),
  });
};

export const logInvestmentPlanAdded = async (
  o: Base & {
    planKey: string;
    planLabel?: string;
    monthly?: number;
    isFinancing?: boolean;
    program?: ProgramKey;
  },
) => {
  if (!o.userId || !o.planKey) return;
  await logEvent('add', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_plan_added',
      paymentPlan: o.planKey,
      ...(o.program ? { program: o.program, programLabel: programLabel(o.program) } : {}),
      ...(o.planLabel ? { planLabel: o.planLabel } : {}),
      ...(o.monthly ? { monthlyPayment: o.monthly } : {}),
      ...(o.isFinancing !== undefined ? { isFinancing: o.isFinancing } : {}),
    }),
  });
};

export const logInvestmentPlanRemoved = async (
  o: Base & { planKey: string; planLabel?: string; program?: ProgramKey },
) => {
  if (!o.userId || !o.planKey) return;
  await logEvent('delete', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_plan_removed',
      paymentPlan: o.planKey,
      ...(o.program ? { program: o.program, programLabel: programLabel(o.program) } : {}),
      ...(o.planLabel ? { planLabel: o.planLabel } : {}),
    }),
  });
};

export const logInvestmentPaymentMethodSelected = async (
  o: Base & { method: string; methodLabel?: string; isFinancing?: boolean; monthly?: number },
) => {
  if (!o.userId || !o.method) return;
  const planFields = o.isFinancing
    ? {
        paymentPlan: o.method,
        ...(o.methodLabel ? { planLabel: o.methodLabel } : {}),
        ...(o.monthly ? { monthlyPayment: o.monthly } : {}),
      }
    : {
        paymentMethod: o.method,
        ...(o.methodLabel ? { methodLabel: o.methodLabel } : {}),
      };
  await logEvent('select', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_payment_method_selected',
      ...planFields,
      ...(o.isFinancing !== undefined ? { isFinancing: o.isFinancing } : {}),
    }),
  });
};

export interface PlanMonthlyChange {
  planId: string;
  planLabel?: string;
  old?: number;
  new?: number;
}

export const logInvestmentDownPaymentChanged = async (
  o: Base & {
    program: ProgramKey;
    amount: number;
    selection?: { key: string; label?: string; isFinancing: boolean; monthly?: number };
    planMonthlies?: PlanMonthlyChange[];
    previousAmount?: number;
  },
) => {
  if (!o.userId) return;
  const sel = o.selection;
  const selectionFields =
    sel && sel.key
      ? sel.isFinancing
        ? {
            paymentPlan: sel.key,
            ...(sel.label ? { planLabel: sel.label } : {}),
            ...(sel.monthly ? { monthlyPayment: sel.monthly } : {}),
          }
        : {
            paymentMethod: sel.key,
            ...(sel.label ? { methodLabel: sel.label } : {}),
          }
      : {};
  await logEvent('change', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_down_payment_changed',
      program: o.program,
      programLabel: programLabel(o.program),
      downPayment: o.amount,
      ...selectionFields,
      ...(sel ? { isFinancing: sel.isFinancing } : {}),
      ...(o.planMonthlies && o.planMonthlies.length ? { planMonthlies: o.planMonthlies } : {}),
      ...(o.previousAmount !== undefined ? { previousDownPayment: o.previousAmount } : {}),
    }),
  });
};

export const logInvestmentProgramEnlarged = async (
  o: Base & { program: DisplayProgramKey; price?: number },
) => {
  if (!o.userId) return;
  await logEvent('view', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_program_enlarged',
      program: o.program,
      programLabel: programLabel(o.program),
      ...(o.price !== undefined ? { price: o.price } : {}),
    }),
  });
};

export const logInvestmentProgramMinimized = async (
  o: Base & { program: DisplayProgramKey; price?: number; enlargedSeconds?: number },
) => {
  if (!o.userId) return;
  await logEvent('view', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_program_minimized',
      program: o.program,
      programLabel: programLabel(o.program),
      ...(o.price !== undefined ? { price: o.price } : {}),
      ...(o.enlargedSeconds !== undefined ? { enlargedSeconds: o.enlargedSeconds } : {}),
    }),
  });
};

export const logInvestmentPriceSecured = async (
  o: Base & { program: ProgramKey; price?: number; monthly?: number; planKey?: string },
) => {
  if (!o.userId) return;
  await logEvent('select', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_price_secured',
      program: o.program,
      programLabel: programLabel(o.program),
      ...(o.price !== undefined ? { price: o.price } : {}),
      ...(o.monthly ? { monthlyPayment: o.monthly } : {}),
      ...(o.planKey ? { paymentPlan: o.planKey } : {}),
    }),
  });
};

export const logInvestmentCalculatorLeft = async (o: Base) => {
  if (!o.userId) return;
  await logEvent('view', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, { action: 'investment_calculator_left' }),
  });
};
