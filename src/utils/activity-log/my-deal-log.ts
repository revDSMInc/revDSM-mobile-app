import { logEvent } from '../../services/api/LoggerService';

export const MY_DEAL_MODULE = 'my_deal';

export const DEAL_EDIT_META = {
  isDealEdit: true,
  editSource: 'deal_addendum',
  isDynamic: true,
} as const;

export interface DealEditLogTarget {
  userId: string;
  leadId?: string;
  jobBuilderId?: string;
  calculatorId?: string;
  configId?: string | null;
  result?: any;
}

const dealEditMeta = (o: DealEditLogTarget, action: string, extra?: Record<string, unknown>) => ({
  draft: true,
  ...(o.leadId ? { leadId: o.leadId } : {}),
  jobBuilderId: o.jobBuilderId || o.leadId,
  ...(o.calculatorId ? { calculatorId: o.calculatorId } : {}),
  calculatorType: 'dynamic',
  ...(o.result !== undefined && o.result !== null ? { result: o.result } : {}),
  action,
  ...(extra || {}),
  ...(o.configId !== undefined ? { configId: o.configId } : {}),
  ...DEAL_EDIT_META,
});

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

export const logDealReviewFieldChanged = (o: DealEditLogTarget & ScreenFieldChange) =>
  logFieldChangedOn(ADDENDUM_REVIEW_SCREEN, o);

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

const SCREEN_BY_STEP: Record<number, Record<string, unknown>> = {
  0: INSTALL_DATE_SCREEN,
  2: JOB_PRICE_SCREEN,
  3: ADDENDUM_REVIEW_SCREEN,
};

export const logDealStepViewed = (o: DealEditLogTarget & { step: number }) => {
  const screen = SCREEN_BY_STEP[o.step];
  if (!screen) return Promise.resolve();
  return logDealScreenEvent('view', 'step_viewed', screen, o);
};
