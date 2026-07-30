import { logEvent } from '../../services/api/LoggerService';

/**
 * Investment Center — activity logging (Forever Record).
 *
 * A NEW grouped category (`module_type: 'investment_center'`, see
 * `constants/activity-log.constants.ts` → INVESTMENT_CENTER_MODULE) so the portal
 * timeline shows every in-home-presentation action under ONE heading rather than
 * scattered across the calculator/rollout modules:
 *   - entering the center                         → logInvestmentCenterOpened
 *   - a priced calculator becoming active         → logInvestmentCalculatorViewed
 *   - opting IN to In-Home / 1-Year               → logInvestmentOptIn
 *   - cancelling / opting OUT of a program        → logInvestmentOptOut
 *   - adding a financing plan to the shortlist    → logInvestmentPlanAdded
 *   - removing a financing plan                   → logInvestmentPlanRemoved
 *   - choosing a payment method / plan            → logInvestmentPaymentMethodSelected
 *   - editing a program's down payment            → logInvestmentDownPaymentChanged
 *
 * There is no web counterpart yet — the mobile Investment Center is the first surface
 * to log these, so the vocabulary is introduced here. Every event reuses a verb from
 * LOG_ACTIONS, shares the one module, and carries the calculator it happened on
 * (calculatorId/title) + the lead. Fire-and-forget (mirrors `calculator-log.ts`).
 */

const MODULE = 'investment_center';

type ProgramKey = 'inhome' | 'oneyear';

const programLabel = (p: ProgramKey) => (p === 'inhome' ? 'In-Home Pre Order' : '1 Year Program');

interface Base {
  userId: string;
  leadId?: string;
  calculatorId?: string;
  calculatorTitle?: string;
}

/** Shared meta shape — the calculator + lead the event belongs to, plus the specifics. */
const baseMeta = (o: Base, extra: Record<string, unknown>) => ({
  ...(o.calculatorId ? { calculatorId: o.calculatorId } : {}),
  ...(o.calculatorTitle ? { calculatorTitle: o.calculatorTitle } : {}),
  ...(o.leadId ? { leadId: o.leadId } : {}),
  ...extra,
});

/** Rep entered the Investment Center for this lead (fired once per screen open). */
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

/** A priced calculator's presentation became active (once per calculator per session). */
export const logInvestmentCalculatorViewed = async (o: Base) => {
  if (!o.userId || !o.calculatorId) return;
  await logEvent('view', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, { action: 'investment_calculator_viewed' }),
  });
};

/** Customer opted INTO a program (In-Home Pre-Order or the 1-Year Program). */
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

/**
 * Customer opted OUT of / cancelled a program selection. `cancelledBeforeConfirm`
 * marks a pending In-Home opt-in dismissed at the confirmation modal (never committed)
 * vs. reverting an already-active selection.
 */
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

/** A financing plan was added to the In-Home Monthly shortlist. */
export const logInvestmentPlanAdded = async (
  o: Base & { planKey: string; planLabel?: string; monthly?: number; isFinancing?: boolean },
) => {
  if (!o.userId || !o.planKey) return;
  await logEvent('add', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_plan_added',
      paymentPlan: o.planKey,
      ...(o.planLabel ? { planLabel: o.planLabel } : {}),
      ...(o.monthly ? { monthlyPayment: o.monthly } : {}),
      // Mirror the `investment_payment_method_selected` meta shape so the portal
      // reads one consistent schema (an added plan is always a financing plan).
      ...(o.isFinancing !== undefined ? { isFinancing: o.isFinancing } : {}),
    }),
  });
};

/** A financing plan was removed from the In-Home Monthly shortlist. */
export const logInvestmentPlanRemoved = async (o: Base & { planKey: string; planLabel?: string }) => {
  if (!o.userId || !o.planKey) return;
  await logEvent('delete', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_plan_removed',
      paymentPlan: o.planKey,
      ...(o.planLabel ? { planLabel: o.planLabel } : {}),
    }),
  });
};

/** The shared payment method / plan selection changed (a CK/CC/AMEX badge or a plan). */
export const logInvestmentPaymentMethodSelected = async (
  o: Base & { method: string; methodLabel?: string; isFinancing?: boolean; monthly?: number },
) => {
  if (!o.userId || !o.method) return;
  // A financing plan selected via the Monthly checkbox is logged with the SAME field
  // names as `investment_plan_added` — paymentPlan / planLabel / monthlyPayment — so the
  // portal reads one consistent schema for "a financing plan was chosen", however it was
  // chosen. A basic cash/card method (CK/CC/AMEX badge) has no plan/monthly, so it keeps
  // paymentMethod / methodLabel.
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

/** A program's down payment was set / changed during the presentation. */
export const logInvestmentDownPaymentChanged = async (
  o: Base & { program: ProgramKey; amount: number },
) => {
  if (!o.userId) return;
  await logEvent('change', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MODULE,
    meta: baseMeta(o, {
      action: 'investment_down_payment_changed',
      program: o.program,
      programLabel: programLabel(o.program),
      downPayment: o.amount,
    }),
  });
};
