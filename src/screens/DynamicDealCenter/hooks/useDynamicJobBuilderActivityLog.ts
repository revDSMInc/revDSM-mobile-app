import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { logEvent } from '../../../services/api/LoggerService';
import {
  buildDynamicTabLogKey,
  getDynamicAutoFieldEntriesForTab,
} from '../../../utils/dynamic-job-builder/engine/dynamic-auto-field-entries';
import {
  buildFieldChangeLogMeta,
  buildTabLogContextMeta,
  flattenTabStateValues,
  resolveFieldLogContext,
  resolveVerticalFromConfig,
  serializeValue,
} from '../../../utils/dynamic-job-builder/engine/dynamic-activity-log-utils';

const FIELD_LOG_DEBOUNCE_MS = 1000;

interface UseDynamicJobBuilderActivityLogArgs {
  enabled?: boolean;
  leadId?: string;
  jobId?: string;
  calculatorId?: string;
  calculatorType?: string;
  result?: any;
  dealCenterData?: any;
  markAutoFieldsLoggedTab?: (tabKey: string) => void | Promise<void>;
  flushSave?: () => void | Promise<void>;
  configId?: any;
  verticals?: any[];
  /**
   * Deal-EDIT (My Deals addendum) mode. When true the wizard's events log under
   * `module_type: 'my_deal'` (web `use-deal-edit-activity-log.js`) with an
   * `isDealEdit`/`editSource` stamp, and the events web's deal-edit hook deliberately
   * omits — `job_builder_opened`, `auto-populated`, `job_builder_completed` — are
   * suppressed (the wrapper `DynamicDealEditScreen` fires `addendum_submitted` instead).
   */
  isDealEdit?: boolean;
}

/**
 * RN port of web `use-dynamic-job-builder-activity-log.js`. Fires the full set of
 * dynamic job-builder analytics events with web-parity payloads:
 *   job_builder_opened (view) · step_viewed (view) · step_navigation (navigate) ·
 *   auto-populated (auto-populated) · field change (change, debounced 1s) ·
 *   job_builder_completed (submit).
 *
 * All payloads carry user_id/created_by (from useAuth), jobBuilderId, calculatorId,
 * calculatorType, result, configId, isDynamic — matching the web hook exactly.
 */
export function useDynamicJobBuilderActivityLog({
  enabled = false,
  leadId,
  jobId,
  calculatorId,
  calculatorType = 'dynamic',
  result,
  dealCenterData = {},
  markAutoFieldsLoggedTab,
  flushSave,
  configId = null,
  verticals = [],
  isDealEdit = false,
}: UseDynamicJobBuilderActivityLogArgs) {
  const { user } = useAuth();

  // Deal-edit (My Deals) events log under `my_deal` with the web DEAL_EDIT_META stamp;
  // the regular build logs under `job_builder`. Memoized so the derived values stay
  // stable across renders (they feed the callbacks' dependency arrays below).
  const { moduleType, dealEditStamp } = useMemo(
    () => ({
      moduleType: isDealEdit ? 'my_deal' : 'job_builder',
      dealEditStamp: isDealEdit
        ? { isDealEdit: true, editSource: 'deal_addendum', isDynamic: true }
        : {},
    }),
    [isDealEdit]
  );

  const openedRef = useRef(false);
  const initDoneRef = useRef(false);
  // One debounce timer PER field state-key (web parity). A single SHARED timer let a
  // later field change clear an earlier one still pending, so only the LAST key of a
  // multi-field diff survived — e.g. adding a combination and filling several fields
  // (or editing two fields within 1 s) logged only the last one and silently DROPPED
  // the rest, so previous-combination values were "cut" from the logs. Per-key timers
  // debounce each field independently so no change clobbers another.
  const fieldLogTimersRef = useRef<Map<string, any>>(new Map());
  const prevTabValuesRef = useRef<Record<string, any>>({});
  const prevTabKeyRef = useRef('');
  const dealCenterDataRef = useRef(dealCenterData);

  useEffect(() => {
    dealCenterDataRef.current = dealCenterData;
  }, [dealCenterData]);

  // Clear every pending per-field debounce timer (web parity `clearPendingFieldLogs`).
  const clearPendingFieldLogs = useCallback(() => {
    fieldLogTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    fieldLogTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!enabled) {
      openedRef.current = false;
      initDoneRef.current = false;
      prevTabValuesRef.current = {};
      prevTabKeyRef.current = '';
      clearPendingFieldLogs();
    }
  }, [enabled, clearPendingFieldLogs]);

  // Drop any still-pending field-log timers on unmount so they don't fire after the
  // screen is gone (and so nothing leaks across a remount).
  useEffect(() => () => clearPendingFieldLogs(), [clearPendingFieldLogs]);

  const logOpened = useCallback(() => {
    // Web's deal-edit hook deliberately emits NO "opened" event (the first
    // `step_viewed` marks the session start), so skip it in edit mode.
    if (!enabled || !user?._id || !leadId || openedRef.current || isDealEdit) return;
    openedRef.current = true;

    logEvent('view', {
      user_id: user._id,
      created_by: user._id,
      module_type: 'job_builder',
      meta: {
        draft: true,
        leadId,
        jobBuilderId: jobId || leadId,
        calculatorType,
        result,
        calculatorId,
        action: 'job_builder_opened',
        fieldCategory: 'job_builder',
        isDynamic: true,
        configId,
      },
    });
  }, [enabled, user?._id, leadId, jobId, calculatorType, result, calculatorId, configId, isDealEdit]);

  const logStepViewed = useCallback(
    ({ verticalId, tab, stepNumber }: any) => {
      if (!enabled || !user?._id || !leadId || !tab) return;

      const vertical = resolveVerticalFromConfig(verticals, verticalId);
      const tabMeta = buildTabLogContextMeta({ tab, vertical, verticalId, configId });

      logEvent('view', {
        user_id: user._id,
        created_by: user._id,
        module_type: moduleType,
        meta: {
          draft: true,
          leadId,
          jobBuilderId: jobId || leadId,
          calculatorId,
          calculatorType,
          result,
          stepNumber,
          stepCategory: tab.id,
          action: 'step_viewed',
          ...tabMeta,
          ...dealEditStamp,
        },
      });
    },
    [enabled, user?._id, leadId, jobId, calculatorId, calculatorType, result, configId, verticals, moduleType, dealEditStamp]
  );

  const logNavigate = useCallback(
    ({ fromTab, toTab, fromStep, toStep, direction, verticalId }: any) => {
      if (!enabled || !user?._id || !leadId || !toTab) return;

      const vertical = resolveVerticalFromConfig(verticals, verticalId);
      const toTabMeta = buildTabLogContextMeta({ tab: toTab, vertical, verticalId, configId });

      logEvent('navigate', {
        user_id: user._id,
        created_by: user._id,
        module_type: moduleType,
        meta: {
          draft: true,
          leadId,
          jobBuilderId: jobId || leadId,
          calculatorId,
          fromStep,
          fromStepName: fromTab?.label || fromTab?.id || `STEP_${fromStep}`,
          toStep,
          toStepName: toTab?.label || toTab?.id || `STEP_${toStep}`,
          direction,
          action: 'step_navigation',
          ...toTabMeta,
          ...dealEditStamp,
        },
      });
    },
    [enabled, user?._id, leadId, jobId, calculatorId, configId, verticals, moduleType, dealEditStamp]
  );

  const logAutoPopulatedForTab = useCallback(
    async ({ verticalId, tab, isTabLogged }: any) => {
      if (!enabled || !user?._id || !leadId || !tab || !verticalId) return false;
      // Web's deal-edit hook has no auto-populate pass — nothing is auto-populated when
      // editing an already-built job, so it would only re-log the original build's
      // locked fields. Skip it in edit mode.
      if (isDealEdit) return false;
      if (!initDoneRef.current) return false;

      const tabKey = buildDynamicTabLogKey(verticalId, tab.id);
      if (isTabLogged?.(tabKey)) return true;

      const entries = getDynamicAutoFieldEntriesForTab(tab, dealCenterDataRef.current);
      if (!entries.length) return false;

      const vertical = resolveVerticalFromConfig(verticals, verticalId);
      const tabMeta = buildTabLogContextMeta({ tab, vertical, verticalId, configId });

      const fireLog = (entry: any) =>
        logEvent('auto-populated', {
          user_id: user._id,
          created_by: user._id,
          module_type: 'job_builder',
          meta: {
            fieldName: entry.key,
            fieldLabel: entry.label,
            fieldValue: entry.value,
            fieldType: entry.fieldType || 'locked',
            section: tabKey,
            fieldCategory: tab.id,
            verticalId,
            tabId: tab.id,
            leadId,
            jobBuilderId: jobId || leadId,
            calculatorId,
            draft: true,
            isDynamic: true,
            ...tabMeta,
          },
        });

      try {
        await Promise.all(entries.map(fireLog));
        if (typeof markAutoFieldsLoggedTab === 'function') {
          await markAutoFieldsLoggedTab(tabKey);
        } else if (typeof flushSave === 'function') {
          await flushSave();
        }
        return true;
      } catch (error) {
        console.error('[DynamicJobBuilder] Auto-field logging failed:', error);
        return false;
      }
    },
    [enabled, user?._id, leadId, jobId, calculatorId, markAutoFieldsLoggedTab, flushSave, configId, verticals, isDealEdit]
  );

  const queueFieldChangeLog = useCallback(
    ({ verticalId, vertical, tab, stateKey, oldValue, newValue, context }: any) => {
      if (!enabled || !user?._id || !leadId || !stateKey || !context || context.skip) return;
      if (serializeValue(oldValue) === serializeValue(newValue)) return;

      // Debounce ONLY the same stateKey — a later change to THIS field re-arms this
      // field's own timer; changes to OTHER fields keep their independent timers, so a
      // multi-field diff (adding a combination, or editing several fields within 1 s)
      // logs EVERY field instead of only the last (web parity — the single-timer version
      // dropped the rest).
      const timers = fieldLogTimersRef.current;
      const pending = timers.get(stateKey);
      if (pending) clearTimeout(pending);

      const timerId = setTimeout(() => {
        timers.delete(stateKey);
        const fieldMeta = buildFieldChangeLogMeta({
          context,
          tab,
          vertical,
          verticalId,
          configId,
          stateKey,
          oldValue,
          newValue,
        });

        logEvent('change', {
          user_id: user._id,
          created_by: user._id,
          module_type: moduleType,
          meta: {
            leadId,
            jobBuilderId: jobId || leadId,
            calculatorId,
            ...fieldMeta,
            ...dealEditStamp,
          },
        });
      }, FIELD_LOG_DEBOUNCE_MS);

      timers.set(stateKey, timerId);
    },
    [enabled, user?._id, leadId, jobId, calculatorId, configId, moduleType, dealEditStamp]
  );

  const trackTabStateChanges = useCallback(
    ({ verticalId, tab, tabState }: any) => {
      if (!enabled || !tab || !initDoneRef.current) return;

      const tabKey = buildDynamicTabLogKey(verticalId, tab.id);
      const vertical = resolveVerticalFromConfig(verticals, verticalId);
      const nextValues = flattenTabStateValues(tab, tabState);

      // First snapshot on a tab is baseline only — do not log hydrated defaults.
      if (prevTabKeyRef.current !== tabKey) {
        prevTabKeyRef.current = tabKey;
        prevTabValuesRef.current = nextValues;
        return;
      }

      const prevValues = prevTabValuesRef.current;

      Object.keys({ ...prevValues, ...nextValues }).forEach((stateKey) => {
        const oldValue = prevValues[stateKey];
        const newValue = nextValues[stateKey];
        if (serializeValue(oldValue) === serializeValue(newValue)) return;

        const context = resolveFieldLogContext(stateKey, tab, tabState);
        if (context.skip) return;

        queueFieldChangeLog({
          verticalId,
          vertical,
          tab,
          stateKey,
          oldValue,
          newValue,
          context,
        });
      });

      prevTabValuesRef.current = nextValues;
    },
    [enabled, queueFieldChangeLog, verticals]
  );

  const seedTabStateBaseline = useCallback(({ verticalId, tab, tabState }: any) => {
    if (!tab) return;
    const tabKey = buildDynamicTabLogKey(verticalId, tab.id);
    prevTabKeyRef.current = tabKey;
    prevTabValuesRef.current = flattenTabStateValues(tab, tabState || {});
  }, []);

  const logSubmit = useCallback(
    (jobState: any) => {
      // In edit mode the embedded builder's "complete" is only the Job-Build step
      // saving its products — NOT the addendum submission. Web's deal-edit hook emits
      // no `job_builder_completed`; the wrapper fires `addendum_submitted` when the
      // draft is actually sent. Suppress it here.
      if (!enabled || !user?._id || !leadId || isDealEdit) return;

      const verticalSummaries: Record<string, any> = {};
      Object.entries(jobState || {}).forEach(([verticalId, verticalState]: any) => {
        if (verticalId === 'scheduleTime' || verticalId === 'agreements' || verticalId === 'orderSheets') {
          return;
        }
        verticalSummaries[verticalId] = {
          tabCount: Object.keys(verticalState || {}).length,
        };
      });

      logEvent('submit', {
        user_id: user._id,
        created_by: user._id,
        module_type: 'job_builder',
        meta: {
          leadId,
          jobBuilderId: jobId || leadId,
          calculatorId,
          calculatorType,
          result,
          fieldCategory: 'summary',
          action: 'job_builder_completed',
          scheduleTime: jobState?.scheduleTime || null,
          verticalSummaries,
          agreements: { count: (jobState?.agreements || []).length },
          orderSheets: { count: (jobState?.orderSheets || []).length },
          isDynamic: true,
          configId,
        },
      });
    },
    [enabled, user?._id, leadId, jobId, calculatorId, calculatorType, result, configId, isDealEdit]
  );

  const handleTabActivated = useCallback(
    async ({
      verticalId,
      tab,
      stepNumber,
      isTabLogged,
      isFirstTabAfterOpen = false,
      tabState,
    }: any) => {
      if (!enabled || !tab) return false;

      logStepViewed({ verticalId, tab, stepNumber });

      if (isFirstTabAfterOpen) {
        initDoneRef.current = true;
      }

      seedTabStateBaseline({ verticalId, tab, tabState });

      return logAutoPopulatedForTab({ verticalId, tab, isTabLogged });
    },
    [enabled, logStepViewed, logAutoPopulatedForTab, seedTabStateBaseline]
  );

  const markInitComplete = useCallback(() => {
    initDoneRef.current = true;
  }, []);

  return useMemo(
    () => ({
      logOpened,
      logNavigate,
      logSubmit,
      trackTabStateChanges,
      handleTabActivated,
      markInitComplete,
      seedTabStateBaseline,
      isLoggingEnabled: enabled,
    }),
    [
      enabled,
      logOpened,
      logNavigate,
      logSubmit,
      trackTabStateChanges,
      handleTabActivated,
      markInitComplete,
      seedTabStateBaseline,
    ]
  );
}
