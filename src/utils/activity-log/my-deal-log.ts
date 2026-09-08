import { logEvent } from '../../services/api/LoggerService';

/**
 * My Deals — deal-edit (addendum) activity logging (`module_type: 'my_deal'`).
 *
 * RN parity with web `src/sections/deal/components/use-deal-edit-activity-log.js`.
 * The deal-edit wizard — reached from **My Deals → a resulted deal → Edit ✏️** — is the
 * ONLY surface logged under this module, deliberately kept apart from the original
 * `job_builder` build so an addendum edit is queryable on its own.
 *
 * Most of the wizard's events (`step_viewed`, `field_changed`) come
 * from the embedded job builder, which `useDynamicJobBuilderActivityLog` emits under
 * this module when run in edit mode — it imports `MY_DEAL_MODULE` and `DEAL_EDIT_META`
 * from here rather than repeating them, so the two surfaces cannot spell the flow
 * differently.
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

/**
 * The module every My Deals deal-edit row is filed under.
 *
 * WARNING This is the ONLY place the name is written. The embedded job builder
 * imports it (see `useDynamicJobBuilderActivityLog`) instead of carrying its own
 * literal — a wizard whose wrapper and whose builder file under two different
 * modules would split one edit across two timelines, and neither would be whole.
 *
 * WARNING SINGULAR, and it was briefly renamed to the plural before the portal
 * capture (`my-deals-section-logs.txt`) settled it. That capture shows the portal
 * GROUPING these rows under `moduleType: "my_deals"` with
 * `entityId: "install_date" | "job_price" | "addendum_review"` — while every ROW
 * inside those groups carries `moduleType: "my_deal"`. The plural is the grouping
 * label the portal DERIVES from these rows; send it on the row itself and the row
 * no longer matches the group it is meant to land in.
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
  /** The HUMAN lead id the portal shows (`lead.leadId`), not the mongo `_id`. */
  jobBuilderId?: string;
  calculatorId?: string;
  /** The job-builder config the edit was made against — on every row in the capture. */
  configId?: string | null;
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
  // After the screen block, which carries no config of its own.
  ...(o.configId !== undefined ? { configId: o.configId } : {}),
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

/**
 * The addendum draft was submitted for customer signature (web `addendum_submitted`).
 *
 * WARNING It carries the ADDENDUM REVIEW screen meta. It is fired by the wrapper
 * rather than by a screen, so it looked screen-less — but the portal files it in the
 * Addendum Review group beside that step's own rows, and a row with no screen fields
 * lands in no group at all.
 */
export const logDealAddendumSubmitted = async (o: DealEditLogTarget & {
  summary?: Record<string, unknown>;
}) => {
  if (!o.userId) return;
  await logEvent('submit', {
    user_id: o.userId,
    created_by: o.userId,
    module_type: MY_DEAL_MODULE,
    meta: dealEditMeta(o, 'addendum_submitted', {
      ...ADDENDUM_REVIEW_SCREEN,
      ...(o.summary || {}),
    }),
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
 * Step 3 of the wizard, in the same shape.
 *
 * WARNING The screen is titled "Review & Submit" in the app, but every DISPLAY field
 * here reads "Addendum Review" — that is what the portal capture carries for this
 * step (`categoryDisplayName` / `stepName` / `tabLabel` / `sectionLabel`). These are
 * the timeline's labels, not the app's.
 */
const ADDENDUM_REVIEW_SCREEN = {
  stepNumber: 4,
  stepCategory: 'addendum_review',
  fieldCategory: 'addendum_review',
  categoryDisplayName: 'Addendum Review',
  stepName: 'Addendum Review',
  tabId: 'addendum_review',
  tabLabel: 'Addendum Review',
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
 *
 * WARNING A `view`, not a `navigate`. The portal capture carries no `navigate` rows
 * at all for this module, and they were reported as noise on the timeline. The
 * ACTION name is what the portal reads, so nothing is lost by moving the verb.
 */
export const logDealInstallDateUnchanged = (
  o: DealEditLogTarget & { currentDate?: string | null; currentTimeWindow?: string }
) =>
  logInstallDateEvent('view', 'install_date_unchanged', {
    ...o,
    summary: {
      currentInstallDate: o.currentDate || 'TBD',
      currentTimeWindow: o.currentTimeWindow || 'TBD',
    },
  });

/**
 * Both offered windows were declined, so the rep was sent back to the calendar.
 *
 * WARNING A `view` for the same reason as above: this module emits no `navigate`.
 */
export const logDealInstallWindowsDeclined = (
  o: DealEditLogTarget & { proposedDate?: string | null; declinedWindows?: string[] }
) =>
  logInstallDateEvent('view', 'install_date_windows_declined', {
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
interface ScreenFieldChange {
  fieldName: string;
  fieldLabel?: string;
  oldValue?: string | null;
  newValue?: string | null;
  extra?: Record<string, unknown>;
}

const logFieldChangedOn = (
  screen: typeof JOB_PRICE_SCREEN | typeof ADDENDUM_REVIEW_SCREEN,
  o: DealEditLogTarget & ScreenFieldChange
) =>
  logDealScreenEvent('change', 'field_changed', screen, {
    ...o,
    summary: {
      fieldName: o.fieldName,
      fieldLabel: o.fieldLabel || o.fieldName,
      sectionId: screen.stepCategory,
      sectionLabel: screen.categoryDisplayName,
      oldValue: o.oldValue ?? '',
      newValue: o.newValue ?? '',
      fieldValue: o.newValue ?? '',
      locked: false,
      autoSelected: false,
      ...(o.extra || {}),
    },
  });

export const logDealPriceFieldChanged = (o: DealEditLogTarget & ScreenFieldChange) =>
  logFieldChangedOn(JOB_PRICE_SCREEN, o);

/**
 * One value the rep moved on the Review & Submit step - the note, the phone the
 * addendum is texted to, or the optional email.
 *
 * WARNING These are FREE TEXT, so they are debounced through the same diff as the
 * price fields (`utils/activity-log/screen-value-diff.ts`): a phone number typed
 * digit by digit is one decision, and a row per keystroke would bury the number the
 * rep settled on - as well as filing nine incomplete phone numbers on the deal.
 *
 * WARNING The phone and the email are the CUSTOMER's contact details, and this puts
 * them on the activity timeline. Web already logs the phone on this screen
 * (`trackScreenValues` › `customerPhone`); the email is mobile's own addition, asked
 * for so a rep can be shown where an addendum was actually sent.
 */
export const logDealReviewFieldChanged = (o: DealEditLogTarget & ScreenFieldChange) =>
  logFieldChangedOn(ADDENDUM_REVIEW_SCREEN, o);

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
 * The screen behind each wizard step, by step index.
 *
 * WARNING Job Build (index 1) is deliberately absent. The embedded builder logs a
 * `step_viewed` per TAB it opens (Gutter, LeafFilter, …), so a wizard-level row for
 * that step would only add a duplicate parent entry above them — web skips it for
 * the same reason.
 */
const SCREEN_BY_STEP: Record<number, Record<string, unknown>> = {
  0: INSTALL_DATE_SCREEN,
  2: JOB_PRICE_SCREEN,
  3: ADDENDUM_REVIEW_SCREEN,
};

/**
 * The rep landed on a wizard screen (web `logScreenViewed`).
 *
 * WARNING Without this the FIRST row of an edit described the embedded builder`s
 * first tab — "Gutter" — while the rep was looking at Install Date, because the
 * builder is kept mounted from the start so its edits survive navigation. The
 * wizard now says which screen it actually opened on, and the builder is silent
 * until the rep reaches it (`activityLoggingEnabled` on DynamicJobBuilderScreen).
 */
export const logDealStepViewed = (o: DealEditLogTarget & { step: number }) => {
  const screen = SCREEN_BY_STEP[o.step];
  if (!screen) return Promise.resolve();
  return logDealScreenEvent('view', 'step_viewed', screen, o);
};

/**
 * NOTE There is deliberately no `step_navigation` here, and this module emits no
 * `navigate` rows at all.
 *
 * A row per step move was reported as noise, and the portal capture
 * (`my-deals-section-logs.txt`) bears that out: across all five groups it holds
 * `view`, `change`, `submit`, `add` and `signature` rows and not one `navigate`.
 * Which step the rep was on is already carried by every row that matters - each
 * one names its own screen (`stepNumber` / `stepCategory` / `stepName`) - and
 * `step_viewed` marks each screen the rep lands on, so the movement between them
 * is readable without a row of its own.
 */
