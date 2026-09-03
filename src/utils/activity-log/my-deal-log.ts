import { logEvent } from '../../services/api/LoggerService';

/**
 * My Deals — deal-edit (addendum) activity logging (`module_type: 'my_deal'`).
 *
 * RN parity with web `src/sections/deal/components/use-deal-edit-activity-log.js`.
 * The deal-edit wizard — reached from **My Deals → a resulted deal → Edit ✏️** — is the
 * ONLY surface the web logs under `my_deal`, deliberately kept apart from the original
 * `job_builder` build so an addendum edit is queryable on its own.
 *
 * Most of the wizard's events (`step_viewed`, `step_navigation`, `field_changed`) come
 * from the embedded job builder, which `useDynamicJobBuilderActivityLog` emits under
 * `my_deal` when run in edit mode (module retargeted + the `DEAL_EDIT_META` stamp).
 * This helper covers the events that live OUTSIDE that embedded builder, all of them
 * fired by the 4-step wrapper (`DynamicDealEditScreen`):
 *
 *   - the final `addendum_submitted` (web `logAddendumSubmitted`);
 *   - the **Install Date step**, which left no trace at all. Its committed date is
 *     logged as two ordinary `field_changed` rows, exactly as web does it
 *     (`logInstallDateChange`), so the portal renders them beside every other edited
 *     field. Its DECISIONS — Modify Install Date, picking a day, No Change — Skip
 *     and Cancel Job — are mobile-only: web does not log them, and they are what the
 *     timeline could not previously show, because skipping the step and never opening
 *     it look identical once the wizard closes.
 *
 * Fire-and-forget (mirrors the other activity-log helpers).
 */

export const MY_DEAL_MODULE = 'my_deal';

/**
 * Stamped on every `my_deal` event so a deal-edit is distinguishable from the original
 * build without changing the log shape (web `DEAL_EDIT_META` + `baseMeta.isDynamic`).
 */
export const DEAL_EDIT_META = {
  isDealEdit: true,
  editSource: 'deal_addendum',
  isDynamic: true,
} as const;

/** Identifies the deal an event belongs to. */
export interface DealEditLogTarget {
  userId: string;
  leadId?: string;
  jobBuilderId?: string;
  calculatorId?: string;
  result?: any;
}

/**
 * The meta every `my_deal` event carries.
 *
 * Shared so a new event cannot drift from `addendum_submitted`: the portal scopes this
 * module by `leadId` + `calculatorId`, so an event that spells either of them
 * differently simply never appears on the deal.
 */
const dealEditMeta = (o: DealEditLogTarget, action: string, extra?: Record<string, unknown>) => ({
  draft: true,
  ...(o.leadId ? { leadId: o.leadId } : {}),
  jobBuilderId: o.jobBuilderId || o.leadId,
  ...(o.calculatorId ? { calculatorId: o.calculatorId } : {}),
  calculatorType: 'dynamic',
  ...(o.result !== undefined && o.result !== null ? { result: o.result } : {}),
  action,
  ...(extra || {}),
  ...DEAL_EDIT_META,
});

/**
 * Step 0 of the wizard, in the shape web stamps on every screen-scoped event
 * (`buildScreenMeta`), so these rows sit on the timeline beside the builder's own.
 */
const INSTALL_DATE_SCREEN = {
  stepNumber: 1,
  stepCategory: 'install_date',
  fieldCategory: 'install_date',
  categoryDisplayName: 'Install Date',
  stepName: 'Install Date',
  tabId: 'install_date',
  tabLabel: 'Install Date',
  isDynamic: true,
} as const;

/** The addendum draft was submitted for customer signature (web `addendum_submitted`). */
export const logDealAddendumSubmitted = async (o: {
  userId: string;
  leadId?: string;
  jobBuilderId?: string;
  calculatorId?: string;
  result?: any;
  summary?: Record<string, unknown>;
}) => {
  if (!o.userId) return;
  await logEvent('submit', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MY_DEAL_MODULE,
    meta: dealEditMeta(o, 'addendum_submitted', o.summary),
  });
};

/**
 * Step 2 of the wizard, in the same shape.
 */
const JOB_PRICE_SCREEN = {
  stepNumber: 3,
  stepCategory: 'job_price',
  fieldCategory: 'job_price',
  categoryDisplayName: 'Job Price',
  stepName: 'Job Price',
  tabId: 'job_price',
  tabLabel: 'Job Price',
  isDynamic: true,
} as const;

/**
 * One event from a wizard screen.
 *
 * `actionType` follows this module's existing vocabulary rather than inventing one:
 * `view` opened something, `navigate` moved the rep on, `change` edited a value,
 * `submit` changed the deal on the server. The `action` name is what the portal reads.
 */
const logDealScreenEvent = async (
  actionType: 'view' | 'navigate' | 'change' | 'submit',
  action: string,
  screen: Record<string, unknown>,
  o: DealEditLogTarget & { summary?: Record<string, unknown> }
) => {
  if (!o.userId) return;
  await logEvent(actionType, {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MY_DEAL_MODULE,
    meta: dealEditMeta(o, action, { ...screen, ...(o.summary || {}) }),
  });
};

const logInstallDateEvent = (
  actionType: 'view' | 'navigate' | 'change' | 'submit',
  action: string,
  o: DealEditLogTarget & { summary?: Record<string, unknown> }
) => logDealScreenEvent(actionType, action, INSTALL_DATE_SCREEN, o);

/** "Modify Install Date" — the calendar was opened. */
export const logDealInstallDateModifyOpened = (
  o: DealEditLogTarget & { currentDate?: string | null; currentTimeWindow?: string }
) =>
  logInstallDateEvent('view', 'install_date_modify_opened', {
    ...o,
    summary: {
      currentInstallDate: o.currentDate || 'TBD',
      currentTimeWindow: o.currentTimeWindow || 'TBD',
    },
  });

/**
 * "No Change — Skip" — the rep moved on without touching the date.
 *
 * WARNING This is not the same as never opening the step, and that difference is the
 * reason it is logged: it records that the install date WAS reviewed and deliberately
 * left alone, which is what an addendum with no schedule row otherwise leaves ambiguous.
 */
export const logDealInstallDateUnchanged = (
  o: DealEditLogTarget & { currentDate?: string | null; currentTimeWindow?: string }
) =>
  logInstallDateEvent('navigate', 'install_date_unchanged', {
    ...o,
    summary: {
      currentInstallDate: o.currentDate || 'TBD',
      currentTimeWindow: o.currentTimeWindow || 'TBD',
    },
  });

/** Both offered windows were declined, so the rep was sent back to the calendar. */
export const logDealInstallWindowsDeclined = (
  o: DealEditLogTarget & { proposedDate?: string | null; declinedWindows?: string[] }
) =>
  logInstallDateEvent('navigate', 'install_date_windows_declined', {
    ...o,
    summary: {
      ...(o.proposedDate ? { proposedInstallDate: o.proposedDate } : {}),
      ...(o.declinedWindows?.length ? { declinedTimeWindows: o.declinedWindows } : {}),
    },
  });

/**
 * A day was picked on the calendar.
 *
 * WARNING NOT a commit: the rep still has to press "Use <date>" and then confirm a
 * window, and either of those can be abandoned. It carries its own action rather
 * than `field_changed` for exactly that reason - the timeline can show which dates
 * a rep considered without any of them reading as the date the job moved to.
 */
export const logDealInstallDateSelected = (
  o: DealEditLogTarget & {
    selectedDate?: string | null;
    currentDate?: string | null;
    currentTimeWindow?: string | null;
  }
) =>
  logInstallDateEvent('change', 'install_date_selected', {
    ...o,
    summary: {
      selectedInstallDate: o.selectedDate || 'TBD',
      currentInstallDate: o.currentDate || 'TBD',
      currentTimeWindow: o.currentTimeWindow || 'TBD',
    },
  });

/**
 * The install date was committed — either a confirmed window or TBD.
 *
 * WARNING Two rows, not one: web emits the date and the time window as separate
 * `field_changed` events (`logInstallDateChange`), which is what lets the portal render
 * them with every other edited field instead of as a bespoke schedule event. A value
 * that did not actually move is skipped, exactly as web's `logScreenFieldChange` does.
 *
 * WARNING Logged at the moment of the commit, never by diffing state on a timer. The
 * rep commits this in one action, and a debounce only opens a window for a re-render to
 * re-seed the value and coalesce the change away — web documents the same reasoning.
 */
export const logDealInstallDateChanged = async (
  o: DealEditLogTarget & {
    oldDate?: string | null;
    newDate?: string | null;
    oldTimeWindow?: string | null;
    newTimeWindow?: string | null;
  }
) => {
  if (!o.userId) return;

  const rows = [
    {
      fieldName: 'installDate',
      fieldLabel: 'Install Date',
      oldValue: o.oldDate || 'TBD',
      newValue: o.newDate || 'TBD',
    },
    {
      fieldName: 'installTimeWindow',
      fieldLabel: 'Install Time Window',
      oldValue: o.oldTimeWindow || 'TBD',
      newValue: o.newTimeWindow || 'TBD',
    },
  ].filter((row) => row.oldValue !== row.newValue);

  for (const row of rows) {
    await logInstallDateEvent('change', 'field_changed', {
      ...o,
      summary: {
        ...row,
        sectionId: INSTALL_DATE_SCREEN.stepCategory,
        sectionLabel: INSTALL_DATE_SCREEN.categoryDisplayName,
        fieldValue: row.newValue,
        locked: false,
        autoSelected: false,
      },
    });
  }
};

/**
 * "Cancel Job", once confirmed and accepted by the server.
 *
 * `submit`, not `navigate`: this is the one button on the step that changes the deal
 * on the server, and it ends the wizard without an addendum — so without this row the
 * timeline shows a rep opening the edit and nothing else.
 */
export const logDealJobCancelled = (
  o: DealEditLogTarget & { currentDate?: string | null; currentTimeWindow?: string }
) =>
  logInstallDateEvent('submit', 'job_cancelled', {
    ...o,
    summary: {
      cancelledFromStep: 'install_date',
      currentInstallDate: o.currentDate || 'TBD',
      currentTimeWindow: o.currentTimeWindow || 'TBD',
    },
  });

/**
 * One value the rep moved on the Job Price step.
 *
 * WARNING Emitted from a DEBOUNCED diff of the screen, exactly as web does it
 * (`trackScreenValues`), not from each keystroke: a contract price typed digit by
 * digit is one decision, and logging every intermediate figure would bury the one
 * the rep settled on. The rules for what counts as a change live in
 * `utils/activity-log/screen-value-diff.ts` - the first snapshot of a screen is the
 * BASELINE and reports nothing, and a value edited back to where it started is not
 * a change.
 *
 * The same `field_changed` action the Install Date step and the embedded builder
 * use, so the portal renders all three the same way.
 */
export const logDealPriceFieldChanged = (
  o: DealEditLogTarget & {
    fieldName: string;
    fieldLabel?: string;
    oldValue?: string | null;
    newValue?: string | null;
    extra?: Record<string, unknown>;
  }
) =>
  logDealScreenEvent('change', 'field_changed', JOB_PRICE_SCREEN, {
    ...o,
    summary: {
      fieldName: o.fieldName,
      fieldLabel: o.fieldLabel || o.fieldName,
      sectionId: JOB_PRICE_SCREEN.stepCategory,
      sectionLabel: JOB_PRICE_SCREEN.categoryDisplayName,
      oldValue: o.oldValue ?? '',
      newValue: o.newValue ?? '',
      fieldValue: o.newValue ?? '',
      locked: false,
      autoSelected: false,
      ...(o.extra || {}),
    },
  });

/**
 * "Auto Adjust" - the rep let the wizard re-price the job to the markup the
 * original sat at.
 *
 * WARNING Its own action, not `field_changed`. The contract price it writes is
 * ALSO reported by the debounced diff a moment later, and the two rows say
 * different things: this one records that the rep asked for the price rather than
 * typing it, which is the difference between a deliberate figure and a derived one.
 */
export const logDealPriceAutoAdjusted = (
  o: DealEditLogTarget & {
    oldValue?: string | null;
    newValue?: string | null;
    oldMarkup?: string | null;
    markup?: string | null;
  }
) =>
  logDealScreenEvent('change', 'price_auto_adjusted', JOB_PRICE_SCREEN, {
    ...o,
    summary: {
      fieldName: 'contractPrice',
      fieldLabel: 'Contract Price',
      oldValue: o.oldValue ?? '',
      newValue: o.newValue ?? '',
      ...(o.oldMarkup ? { oldMarkup: o.oldMarkup } : {}),
      ...(o.markup ? { markup: o.markup } : {}),
    },
  });

/**
 * The rep moved between wizard steps (web `logNavigate` / `step_navigation`).
 *
 * Carries `direction`, so a rep who went Back to fix a price is distinguishable
 * from one who walked straight through - and the price rows that follow a `back`
 * are readable as a correction rather than a fresh decision.
 */
export const logDealStepNavigation = (
  o: DealEditLogTarget & {
    fromStep: number;
    fromStepName: string;
    toStep: number;
    toStepName: string;
    direction?: 'forward' | 'back';
  }
) =>
  logDealScreenEvent('navigate', 'step_navigation', {}, {
    ...o,
    summary: {
      fromStep: o.fromStep,
      fromStepName: o.fromStepName,
      toStep: o.toStep,
      toStepName: o.toStepName,
      direction: o.direction || (o.toStep > o.fromStep ? 'forward' : 'back'),
      isDynamic: true,
    },
  });
