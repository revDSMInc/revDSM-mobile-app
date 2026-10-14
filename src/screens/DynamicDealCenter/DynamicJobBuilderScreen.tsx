import { useKeyboardState } from 'react-native-keyboard-controller';
import { useNumPadActive } from '../../widgets/common/keyboard/NumPad';
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  Animated,
} from 'react-native';
import { useCollapsingHeader } from '../../hooks/useCollapsingHeader';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useDynamicJobBuilderSession } from './useDynamicJobBuilderSession';
import { DynamicTabRenderer } from '../../widgets/components/dynamic-job-builder/DynamicTabRenderer';
import { EmptyStepGate } from '../../widgets/components/dynamic-job-builder/EmptyStepGate';
import { stateHasContent, collectLockedFieldIds } from '../../utils/dynamic-job-builder/engine/empty-step-gate';
import { ProgressTracker } from '../../widgets/components/dynamic-job-builder/ProgressTracker';
import { VerticalTabBar } from '../../widgets/components/dynamic-job-builder/VerticalTabBar';
import { FlashMessage } from '../../config/message';
import { LeadService } from '../../services/api/leads';
import { isOnline } from '../../services/connectivity';
import {
  addOfflineJobDocument,
  completeOfflineJobBuilder,
  ensureOfflineWorkForLead,
  findOfflineWorkForLead,
  saveOfflineJobBuilderDraft,
} from '../../services/offlineLeadStore';
import { isClientId } from '../../utils/offline-lead-work';
import { useDynamicJobBuilderActivityLog } from './hooks/useDynamicJobBuilderActivityLog';
import { buildCalculatorOutcomePayload } from './utils/build-outcome-payload';
import {
  isMissingOutcome,
  loadResolvedOutcomeDocuments,
  fetchOutcomeDocumentRows,
  resolveOutcomeDocRows,
  dropUnnamedAgreements,
} from './utils/outcome-documents';
import { buildDocumentPayloads } from './utils/document-payloads';
import {
  buildCalculatorDocument,
  buildJobSubmitPayload,
  buildSubmitLeadData,
  extractCalculatorDocument,
} from './utils/job-submit-payload';
import { canCompleteJobBuilder, finalizeBlockedReason as computeFinalizeBlockedReason } from './utils/finalize-gate';
import { useAuth } from '../../hooks/useAuth';
import { logRolloutAndDropSummary } from '../../utils/activity-log/rollout-summary';
import JobService from '../../services/api/JobService';
import { calculateCommission } from '../../utils/calculator/commission-utils';
import { fetchCommissionConfig } from '../../hooks/useCommissionConfig';
import { buildJobNumber } from '../../utils/office-initials';
import { queryClient } from '../../services/api/queryClient';
import { isTabComplete } from '../../utils/dynamic-job-builder/engine/tab-validation';
import { buildInitialJobState } from '../../utils/dynamic-job-builder/engine/preview-compute';
import {
  serializeDynamicJobStateForStorage,
  deserializeDynamicJobStateFromStorage,
  hydrateJobStateForPersistence,
} from '../../utils/dynamic-job-builder/engine/dynamic-job-state-storage';
import {
  extractCalculatorOutcome,
  extractSavedJobBuildState,
  offlineSavedJobBuildState,
  resolveJobBuildSource,
} from './utils/saved-job-build';
import Reanimated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';

const capitalizeResult = (v: any) => {
  const s = String(v ?? '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
};

interface DynamicJobBuilderScreenProps {
  navigation?: NativeStackNavigationProp<any>;
  initialConfig?: any;
  calculatorSchemas?: any[];
  dealCenterData?: any;
  calculatorResultData?: {
    resultType?: 'sale' | 'demo';
    contractPrice?: number;
    downPayment?: number;
    balance?: number;
    oneLeg?: string;
    demoReason?: string;
    versatile?: boolean;
    pineapple?: boolean;
  };
  leadId?: string;
  lead?: any;
  onJobComplete?: (config: any, state: any) => void;
  onGoBack?: () => void;
  mode?: 'new' | 'edit';
  startFresh?: boolean;
  initialJobState?: any;
  portalUnrestrictedEdit?: boolean;
  hideAllocationTrackers?: boolean;
  openOnSummary?: boolean;
  appointmentId?: string;
  embedded?: boolean;
  activityLoggingEnabled?: boolean;
  scheduleTimeOverride?: { date?: string | null; timeWindow?: string } | null;
  rawDocsOverride?: { agreements?: any[]; orderSheets?: any[] } | null;
  allCalculators?: any[];
  onStateChange?: (jobState: any) => void;
  onEditComplete?: (jobState: any) => void;
  onEditBack?: () => void;
}

function normalizeScheduleTimeForSubmit(scheduleTime: any): any {
  if (!scheduleTime || typeof scheduleTime !== 'object') return scheduleTime;
  const { date } = scheduleTime;
  if (!date || date === 'TBD') return scheduleTime;

  const str = String(date);
  let iso = str;
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, mm, dd, yyyy] = mdy;
    iso = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0, 0).toISOString();
  } else {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) iso = parsed.toISOString();
  }

  const { reason: _reason, ...rest } = scheduleTime;
  return { ...rest, date: iso };
}

function DynamicJobBuilderInner({
  navigation,
  initialConfig,
  calculatorSchemas,
  dealCenterData,
  calculatorResultData,
  leadId,
  lead,
  onJobComplete,
  onGoBack,
  mode = 'new',
  startFresh = false,
  initialJobState: initialJobStateProp,
  portalUnrestrictedEdit: portalUnrestrictedEditProp,
  hideAllocationTrackers: hideAllocationTrackersProp,
  openOnSummary = false,
  appointmentId,
  embedded = false,
  activityLoggingEnabled = true,
  scheduleTimeOverride,
  allCalculators,
  onStateChange,
  onEditComplete,
  onEditBack,
}: DynamicJobBuilderScreenProps) {
  const isEdit = mode === 'edit';
  const portalUnrestrictedEdit = portalUnrestrictedEditProp ?? isEdit;
  const hideAllocationTrackers = hideAllocationTrackersProp ?? isEdit;
  const insets = useSafeAreaInsets();
  const numPadActive = useNumPadActive();
  const systemKeyboardUp = useKeyboardState((st) => st.isVisible);
  const keyboardUp = numPadActive || systemKeyboardUp;
  const verticalList = useMemo(
    () => initialConfig?.verticals || [],
    [initialConfig]
  );
  const { colors, isDark } = useTheme();
  const { user: authUser } = useAuth();

  const calcId = (calculatorResultData as any)?.calculatorId;
  const { data: outcomeData, isFetched: isOutcomeFetched } = useQuery({
    queryKey: ['leadOutcome', leadId, calcId, startFresh],
    queryFn: async () => {
      const applySaved = (saved: any) =>
        saved && typeof saved === 'object' && !startFresh
          ? deserializeDynamicJobStateFromStorage(saved, initialConfig)
          : undefined;

      const work = findOfflineWorkForLead(lead || { _id: leadId });
      const stored = offlineSavedJobBuildState(work);
      const offline = !isOnline() || isClientId(leadId) || isClientId(calcId);
      if (resolveJobBuildSource({ work, offline }) === 'device') {
        return { initialJobState: applySaved(stored), outcomeExists: false };
      }

      try {
        const res = await LeadService.getLeadOutcomeByCalculator(leadId!, calcId);
        const outcome = extractCalculatorOutcome(res.data);
        const savedState = extractSavedJobBuildState(outcome);

        return { initialJobState: applySaved(savedState), outcomeExists: true };
      } catch (e) {
        return { initialJobState: applySaved(stored), outcomeExists: !isMissingOutcome(e) };
      }
    },
    enabled: Boolean(leadId && calcId) && !isEdit,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  const { data: resolvedDocumentsData } = useQuery({
    queryKey: ['leadOutcomeDocs', leadId, calcId],
    queryFn: () => loadResolvedOutcomeDocuments(leadId, calcId),
    enabled:
      Boolean(leadId && calcId) && !isEdit && isOutcomeFetched && outcomeData?.outcomeExists !== false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  const { data: editDocsData } = useQuery({
    queryKey: ['editOutcomeDocs', leadId],
    queryFn: async () => {
      const empty = { agreements: [] as any[], orderSheets: [] as any[] };
      try {
        const res = await LeadService.downloadOutcomeDocuments(leadId!);
        const body: any = res?.data;
        const docs = body?.data ?? body ?? {};
        const toDisplay = (arr: any, group: 'agreement' | 'orderSheet') =>
          (Array.isArray(arr) ? arr : [])
            .map((d: any) => {
              const ct = d?.fileData?.contentType || 'application/pdf';
              const raw = d?.base64Data;
              const dataUri = raw
                ? String(raw).startsWith('data:')
                  ? raw
                  : `data:${ct};base64,${raw}`
                : undefined;
              const url = dataUri || d?.secureUrl || d?.url || undefined;
              if (!url) return null;
              return {
                uri: url,
                name: d?.name || (group === 'agreement' ? 'Agreement' : 'Order Sheet'),
                serverId: d?._id,
                contentType: ct,
                isNew: false,
                documentType: group,
              };
            })
            .filter(Boolean);
        return {
          agreements: toDisplay(dropUnnamedAgreements(docs.agreements), 'agreement'),
          orderSheets: toDisplay(docs.orderSheets, 'orderSheet'),
        };
      } catch (e) {
        console.warn('[DynamicJobBuilder] edit-mode doc download failed:', e);
        return empty;
      }
    },
    enabled: Boolean(leadId) && isEdit,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  const hydratedInitialJobState = useMemo(() => {
    if (isEdit) return initialJobStateProp;
    const ds = outcomeData?.initialJobState;
    if (!ds || typeof ds !== 'object') return undefined;
    if (!initialConfig) return ds;
    return hydrateJobStateForPersistence(ds, initialConfig, dealCenterData || {});
  }, [isEdit, initialJobStateProp, outcomeData?.initialJobState, initialConfig, dealCenterData]);

  const session = useDynamicJobBuilderSession({
    initialConfig,
    dealCenterData,
    initialJobState: hydratedInitialJobState,
    draftToken: isEdit ? undefined : `${leadId || ''}:${calcId || ''}`,
    draftSettled: isEdit ? undefined : isOutcomeFetched,
  });

  const { jobState, updateTabState, updateRootState, clearRootState, lockedTabIdsByVertical } = session;

  const verticalHasUnlockedSteps = useMemo(() => {
    const map: Record<string, boolean> = {};
    verticalList.forEach((v: any) => {
      if (portalUnrestrictedEdit) {
        map[v.id] = true;
        return;
      }
      const locked = new Set(lockedTabIdsByVertical[v.id] || []);
      map[v.id] = (v.tabs || []).some((t: any) => !t.isSummary && !locked.has(t.id));
    });
    return map;
  }, [verticalList, lockedTabIdsByVertical, portalUnrestrictedEdit]);

  const lockedVerticalIds = useMemo(
    () => verticalList.filter((v: any) => !verticalHasUnlockedSteps[v.id]).map((v: any) => v.id),
    [verticalList, verticalHasUnlockedSteps]
  );

  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  useEffect(() => {
    if (embedded) onStateChangeRef.current?.(jobState);
  }, [embedded, jobState]);

  const [selectedVerticalId, setSelectedVerticalId] = useState(
    verticalList[0]?.id || ''
  );
  const [selectedTabId, setSelectedTabId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [resolvedDocuments, setResolvedDocuments] = useState<{ agreements: any[]; orderSheets: any[] }>({
    agreements: [],
    orderSheets: [],
  });
  const isDocUploadingRef = useRef(false);

  const jobStateRef = useRef(jobState);
  jobStateRef.current = jobState;

  const worksOffline = useCallback(
    () => !isOnline() || isClientId(leadId) || isClientId(calcId),
    [leadId, calcId]
  );

  const offlineWorkId = useCallback((): string | null => {
    const work = ensureOfflineWorkForLead(lead || { _id: leadId });
    return work?.clientId || null;
  }, [lead, leadId]);

  useEffect(() => {
    if (!leadId || !lead) return;
    if (queryClient.getQueryData(['lead', leadId]) !== undefined) return;
    queryClient.setQueryData(['lead', leadId], lead);
  }, [leadId, lead]);

  useEffect(() => {
    if (resolvedDocumentsData) {
      setResolvedDocuments(resolvedDocumentsData);
    }
  }, [resolvedDocumentsData]);

  useEffect(() => {
    if (editDocsData) {
      setResolvedDocuments(editDocsData);
    }
  }, [editDocsData]);

  const resultType = (calculatorResultData?.resultType || '').toString().toLowerCase();
  const isSale = resultType === 'sale';
  const isDemo = Boolean(resultType) && !isSale;

  const configId = (initialConfig as any)?.id || null;
  const loggedAutoFieldTabsRef = useRef<Set<string>>(new Set());
  const activityLog = useDynamicJobBuilderActivityLog({
    enabled: Boolean(leadId) && activityLoggingEnabled,
    leadId,
    jobId: (lead as any)?.leadId || (lead as any)?.jobNumber || leadId,
    calculatorId: (calculatorResultData as any)?.calculatorId,
    calculatorType: 'dynamic',
    result: capitalizeResult(
      (calculatorResultData as any)?.resultType || (calculatorResultData as any)?.result
    ),
    dealCenterData,
    configId,
    verticals: verticalList,
    isDealEdit: isEdit,
    markAutoFieldsLoggedTab: (tabKey: string) => {
      loggedAutoFieldTabsRef.current.add(tabKey);
    },
  });

  useEffect(() => {
    activityLog.logOpened();
  }, [activityLog]);

  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    if ((isOutcomeFetched || isEdit) && !initialFetchDoneRef.current) {
      initialFetchDoneRef.current = true;
    }
  }, [isOutcomeFetched, isEdit]);

  const saveInFlightRef = useRef(false);
  const needsFollowUpRef = useRef(false);
  const autoSaveDirtyRef = useRef(false);
  const isCompletingRef = useRef(false);

  const lfCalcDocRef = useRef<{ id: string; doc: any; fromServer: boolean } | null>(null);
  const resolveLfCalculatorDoc = useCallback(
    async (targetCalcId: string | null, rd: any, opts: { force?: boolean } = {}) => {
      if (!targetCalcId) return { doc: null as any, fromServer: false };
      if (!opts.force && lfCalcDocRef.current?.id === targetCalcId) {
        return { doc: lfCalcDocRef.current.doc, fromServer: lfCalcDocRef.current.fromServer };
      }
      let serverDoc: any = null;
      try {
        serverDoc = extractCalculatorDocument((await LeadService.getCalculator(targetCalcId))?.data);
      } catch (e: any) {
        console.warn('[DynamicJobBuilder] could not read the calculator:', e?.message || e);
      }
      const doc = buildCalculatorDocument(serverDoc, rd?.LFCalculator, {
        calculatorId: targetCalcId,
        appointmentId: rd?.selectedAppointmentId || rd?.appointmentId || null,
        leadId,
        enteredBy: (authUser as any)?._id || (authUser as any)?.id || null,
      });
      lfCalcDocRef.current = { id: targetCalcId, doc, fromServer: Boolean(serverDoc) };
      return { doc, fromServer: Boolean(serverDoc) };
    },
    [leadId, authUser]
  );

  const performAutoSave = useCallback(async () => {
    if (!leadId || !initialFetchDoneRef.current || embedded) return;
    if (isCompletingRef.current) return;
    if (isDocUploadingRef.current) return;
    if (!calcId && !isEdit) return;
    if (saveInFlightRef.current) {
      needsFollowUpRef.current = true;
      return;
    }
    saveInFlightRef.current = true;
    autoSaveDirtyRef.current = false;
    try {
      const dynamicJobState = serializeDynamicJobStateForStorage(
        jobStateRef.current || {},
        initialConfig,
        dealCenterData
      );
      const configId = (initialConfig as any)?.id || null;
      const autoFieldsLogged = Array.from(loggedAutoFieldTabsRef.current);

      if (isEdit) {
        const rd = (calculatorResultData || {}) as any;
        await LeadService.upsertPortalJobBuilder(leadId, {
          isDynamic: true,
          dynamicJobState,
          configId,
          configSnapshotId: configId || 'dynamic',
          calculatorId: calcId || rd.calculatorId || null,
          appointmentId: appointmentId || rd.appointmentId || null,
          status: 'draft',
        });
      } else {
        const rd = (calculatorResultData || {}) as any;
        const offline = worksOffline();
        const { doc: autoSaveLfDoc } = offline
          ? { doc: null as any }
          : await resolveLfCalculatorDoc(calcId, rd);
        const outcomePayload = buildCalculatorOutcomePayload({
          rd: autoSaveLfDoc ? { ...rd, LFCalculator: autoSaveLfDoc } : rd,
          calcId,
          fallbackAppointmentId: appointmentId || leadId,
          jobBuilder: {
            dynamicJobState,
            configId,
            configSnapshotId: configId || 'dynamic',
            calculatorType: 'dynamic',
            autoFieldsLogged,
            status: 'draft',
          },
        });

        if (offline) {
          const workId = offlineWorkId();
          if (workId) {
            saveOfflineJobBuilderDraft(workId, outcomePayload, calcId || undefined);
          }
        } else {
          await LeadService.updateLeadOutcomeByCalculator(leadId, calcId, outcomePayload);
        }
      }
    } catch (error) {
      console.warn('[DynamicJobBuilder] Auto-save failed:', error);
    } finally {
      saveInFlightRef.current = false;
      if (needsFollowUpRef.current) {
        needsFollowUpRef.current = false;
        void performAutoSaveRef.current();
      }
    }
  }, [leadId, calcId, initialConfig, dealCenterData, isEdit, appointmentId, calculatorResultData, embedded, resolveLfCalculatorDoc, worksOffline, offlineWorkId]);

  const performAutoSaveRef = useRef(performAutoSave);
  performAutoSaveRef.current = performAutoSave;

  useEffect(() => {
    if (!leadId || !initialFetchDoneRef.current || embedded) return;
    autoSaveDirtyRef.current = true;
    const timer = setTimeout(() => void performAutoSaveRef.current(), 2000);
    return () => clearTimeout(timer);
  }, [jobState, leadId, calcId, initialConfig, dealCenterData, isEdit, appointmentId, calculatorResultData, embedded]);

  useEffect(
    () => () => {
      if (autoSaveDirtyRef.current) void performAutoSaveRef.current();
    },
    [],
  );

  useEffect(() => {
    if (isDemo && jobState?.scheduleTime) {
      clearRootState('scheduleTime');
    }
  }, [isDemo, jobState?.scheduleTime, clearRootState]);

  const overrideDate = scheduleTimeOverride?.date;
  const overrideWindow = scheduleTimeOverride?.timeWindow;
  useEffect(() => {
    if (isDemo || !overrideDate) return;
    const current = jobState?.scheduleTime;
    if (current?.date === overrideDate && (current?.timeWindow || '') === (overrideWindow || '')) {
      return;
    }
    updateRootState('scheduleTime', {
      ...(current || {}),
      date: overrideDate,
      timeWindow: overrideWindow || '',
    });
  }, [isDemo, overrideDate, overrideWindow, jobState?.scheduleTime, updateRootState]);

  const selectedVertical = useMemo(
    () => verticalList.find((v: any) => v.id === selectedVerticalId) || verticalList[0],
    [verticalList, selectedVerticalId]
  );

  useEffect(() => {
    if (verticalList.length <= 1) return;
    if (verticalHasUnlockedSteps[selectedVerticalId]) return;
    const target = verticalList.find((v: any) => verticalHasUnlockedSteps[v.id]);
    if (!target || target.id === selectedVerticalId) return;
    setSelectedVerticalId(target.id);
    setSelectedTabId('');
  }, [verticalList, selectedVerticalId, verticalHasUnlockedSteps]);

  const currentVerticalLockedTabIds = useMemo(() => {
    if (portalUnrestrictedEdit) return [];
    return selectedVertical ? lockedTabIdsByVertical[selectedVertical.id] || [] : [];
  }, [selectedVertical, lockedTabIdsByVertical, portalUnrestrictedEdit]);

  const tabs = useMemo(() => selectedVertical?.tabs || [], [selectedVertical]);

  const availableTabs = useMemo(() => {
    const res = tabs.filter((t: any) => !currentVerticalLockedTabIds.includes(t.id));
    console.log(`[JobBuilder] Available tabs for ${selectedVerticalId}:`, res.map((t: any) => t.id), 'Locked tabs:', currentVerticalLockedTabIds);
    return res;
  }, [tabs, currentVerticalLockedTabIds, selectedVerticalId]);

  const logStepNumberOf = useCallback(
    (tab: any) => {
      const all = selectedVertical?.tabs || [];
      const idx = all.findIndex((t: any) => t.id === tab?.id);
      return Math.max(1, idx + 1);
    },
    [selectedVertical]
  );

  const allNonSummaryTabs = useMemo(
    () => (selectedVertical?.tabs || []).filter((t: any) => !t.isSummary),
    [selectedVertical]
  );

  const nonSummaryTabs = useMemo(
    () => availableTabs.filter((t: any) => !t.isSummary),
    [availableTabs]
  );

  const summaryTab = useMemo(
    () => availableTabs.find((t: any) => t.isSummary),
    [availableTabs]
  );

  const openedOnSummaryRef = useRef(false);
  const summaryPinnedRef = useRef(false);
  useEffect(() => {
    if (!openOnSummary || openedOnSummaryRef.current) return;
    if (!summaryTab) return;
    openedOnSummaryRef.current = true;
    summaryPinnedRef.current = true;
    setSelectedTabId(summaryTab.id);
  }, [openOnSummary, summaryTab]);

  const currentTabIndex = useMemo(() => {
    if (!selectedTabId) return -1;
    if (selectedTabId === 'summary' || (summaryTab && selectedTabId === summaryTab.id)) {
      return nonSummaryTabs.length;
    }
    return nonSummaryTabs.findIndex((t: any) => t.id === selectedTabId);
  }, [selectedTabId, nonSummaryTabs, summaryTab]);

  const currentTab = useMemo(() => {
    if (selectedTabId) {
      return availableTabs.find((t: any) => t.id === selectedTabId) || null;
    }
    return null;
  }, [availableTabs, selectedTabId]);

  const autoSummaryRef = useRef(false);
  useEffect(() => {
    if (summaryPinnedRef.current) {
      if (summaryTab && selectedTabId === summaryTab.id) summaryPinnedRef.current = false;
      return;
    }
    if (nonSummaryTabs.length > 0) {
      if (!selectedTabId || (autoSummaryRef.current && summaryTab && selectedTabId === summaryTab.id)) {
        autoSummaryRef.current = false;
        setSelectedTabId(nonSummaryTabs[0].id);
      }
    } else if (!selectedTabId && summaryTab) {
      autoSummaryRef.current = true;
      setSelectedTabId(summaryTab.id);
    }
  }, [nonSummaryTabs, summaryTab, selectedTabId]);

  const firstTabActivatedRef = useRef(false);
  useEffect(() => {
    if (!currentTab || currentTab.isSummary || !selectedVerticalId) return;
    const isFirst = !firstTabActivatedRef.current;
    firstTabActivatedRef.current = true;
    activityLog.handleTabActivated({
      verticalId: selectedVerticalId,
      tab: currentTab,
      stepNumber: logStepNumberOf(currentTab),
      isTabLogged: (k: string) => loggedAutoFieldTabsRef.current.has(k),
      isFirstTabAfterOpen: isFirst,
      tabState: jobState?.[selectedVerticalId]?.[currentTab.id] || {},
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab?.id, selectedVerticalId]);

  const activeTabState = jobState?.[selectedVerticalId]?.[currentTab?.id || ''];
  useEffect(() => {
    if (!currentTab || currentTab.isSummary || !selectedVerticalId) return;
    activityLog.trackTabStateChanges({
      verticalId: selectedVerticalId,
      tab: currentTab,
      tabState: activeTabState || {},
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabState]);

  const applyConditions = !portalUnrestrictedEdit;
  const validationCtx = useMemo(() => ({
    dealCenterData: dealCenterData || {},
    applyConditions,
    products: initialConfig?.products || [],
    editMode: isEdit,
  }), [dealCenterData, initialConfig, applyConditions, isEdit]);

  const tabCompletionById = useMemo(() => {
    const verticalState = jobState?.[selectedVerticalId] || {};
    const map: Record<string, boolean> = {};
    availableTabs.forEach((tab: any) => {
      if (tab.isSummary) {
        map[tab.id] = true;
        return;
      }
      map[tab.id] = isTabComplete(tab, verticalState[tab.id] || {}, validationCtx);
    });
    return map;
  }, [availableTabs, jobState, selectedVerticalId, validationCtx]);

  const tabProgress = useMemo(() => {
    return allNonSummaryTabs.map((tab: any) => {
      const isLocked = currentVerticalLockedTabIds?.includes(tab.id) || false;
      const isActive = tab.id === currentTab?.id;
      const isComplete = tabCompletionById[tab.id] || false;

      return {
        id: tab.id,
        label: tab.label || tab.id,
        complete: isComplete && !isLocked,
        active: isActive,
        locked: isLocked,
      };
    });
  }, [allNonSummaryTabs, currentVerticalLockedTabIds, currentTab, tabCompletionById]);

  const isCurrentTabComplete = useMemo(() => {
    if (!currentTab) return false;
    return tabCompletionById[currentTab.id] || false;
  }, [currentTab, tabCompletionById]);

  const areAllTabsComplete = useMemo(() => {
    return nonSummaryTabs.every((t: any) => tabCompletionById[t.id]);
  }, [nonSummaryTabs, tabCompletionById]);

  const isAppointmentSet = Boolean(jobState?.scheduleTime?.date);

  const hasAgreementDoc = useMemo(() => {
    const local = ((jobState?.agreements || []) as any[]).some((d) => d?.files && d.files.length > 0);
    return local || (resolvedDocuments.agreements?.length || 0) > 0;
  }, [jobState?.agreements, resolvedDocuments.agreements]);
  const hasOrderSheetDoc = useMemo(() => {
    const local = ((jobState?.orderSheets || []) as any[]).some((d) => d?.files && d.files.length > 0);
    return local || (resolvedDocuments.orderSheets?.length || 0) > 0;
  }, [jobState?.orderSheets, resolvedDocuments.orderSheets]);
  const gateInput = useMemo(
    () => ({ portalUnrestrictedEdit, areAllTabsComplete, isSale, isDemo, isAppointmentSet, hasAgreementDoc, hasOrderSheetDoc }),
    [portalUnrestrictedEdit, areAllTabsComplete, isSale, isDemo, isAppointmentSet, hasAgreementDoc, hasOrderSheetDoc],
  );
  const canComplete = useMemo(() => canCompleteJobBuilder(gateInput), [gateInput]);
  const finalizeBlockedReason = useMemo(() => computeFinalizeBlockedReason(gateInput), [gateInput]);

  const canProceed = useMemo(() => {
    if (portalUnrestrictedEdit) return true;
    if (currentTabIndex === nonSummaryTabs.length) {
      return canComplete;
    }
    return isCurrentTabComplete;
  }, [portalUnrestrictedEdit, currentTabIndex, nonSummaryTabs.length, canComplete, isCurrentTabComplete]);

  const lockedFieldIds = useMemo(() => collectLockedFieldIds(initialConfig), [initialConfig]);
  const [gateDismissed, setGateDismissed] = useState<Set<string>>(() => new Set());
  const showEmptyGate = useMemo(() => {
    if (!isEdit || !currentTab || currentTab.isSummary) return false;
    if (currentVerticalLockedTabIds.includes(currentTab.id)) return false;
    if (gateDismissed.has(currentTab.id)) return false;
    const tabState = jobState?.[selectedVertical?.id]?.[currentTab.id] || {};
    return !stateHasContent(tabState, lockedFieldIds);
  }, [isEdit, currentTab, currentVerticalLockedTabIds, gateDismissed, jobState, selectedVertical, lockedFieldIds]);
  const dismissGate = useCallback(() => {
    if (!currentTab) return;
    setGateDismissed((prev) => {
      const next = new Set(prev);
      next.add(currentTab.id);
      return next;
    });
  }, [currentTab]);

  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const showClearButton =
    isEdit &&
    !!currentTab &&
    !currentTab.isSummary &&
    !currentVerticalLockedTabIds.includes(currentTab.id) &&
    !showEmptyGate;
  const handleClearTab = useCallback(() => {
    if (!selectedVertical?.id || !currentTab?.id) {
      setClearConfirmOpen(false);
      return;
    }
    const fresh = buildInitialJobState(initialConfig, dealCenterData);
    const freshTabState =
      fresh?.[selectedVertical.id]?.[currentTab.id] || { colorValues: {}, sectionFields: {} };
    updateTabState(selectedVertical.id, currentTab.id, freshTabState);
    setGateDismissed((prev) => {
      const next = new Set(prev);
      next.add(currentTab.id);
      return next;
    });
    setClearConfirmOpen(false);
  }, [selectedVertical, currentTab, initialConfig, dealCenterData, updateTabState]);

  const showSkipAll =
    isEdit && !!summaryTab && !!currentTab && currentTab.id !== summaryTab.id;
  const handleSkipAll = useCallback(() => {
    if (summaryTab?.id) setSelectedTabId(summaryTab.id);
  }, [summaryTab]);

  const handleVerticalSelect = useCallback((verticalId: string) => {
    setSelectedVerticalId(verticalId);
    setSelectedTabId('');
  }, []);

  const handleTabStateChange = useCallback(
    (tabStateOrUpdater: any) => {
      if (!selectedVertical?.id || !currentTab?.id) return;
      updateTabState(selectedVertical.id, currentTab.id, tabStateOrUpdater);
    },
    [selectedVertical, currentTab, updateTabState]
  );

  const currentStepIndex = useMemo(() => {
    if (!currentTab) return -1;
    if (summaryTab && currentTab.id === summaryTab.id) return allNonSummaryTabs.length;
    return allNonSummaryTabs.findIndex((t: any) => t.id === currentTab.id);
  }, [allNonSummaryTabs, summaryTab, currentTab]);

  const handleGoToTab = useCallback(
    (index: number) => {
      if (!portalUnrestrictedEdit && currentStepIndex >= 0 && index > currentStepIndex) {
        if (!canProceed) return;
        for (let i = currentStepIndex + 1; i < index; i += 1) {
          const skipped = allNonSummaryTabs[i];
          if (!skipped) continue;
          if (currentVerticalLockedTabIds.includes(skipped.id)) continue;
          if (!tabCompletionById[skipped.id]) return;
        }
      }

      if (index >= 0 && index < allNonSummaryTabs.length) {
        const tab = allNonSummaryTabs[index];
        if (tab && !currentVerticalLockedTabIds.includes(tab.id)) {
          setSelectedTabId(tab.id);
        }
      } else if (index === allNonSummaryTabs.length && summaryTab) {
        setSelectedTabId(summaryTab.id);
      }
    },
    [
      allNonSummaryTabs,
      currentVerticalLockedTabIds,
      summaryTab,
      portalUnrestrictedEdit,
      currentStepIndex,
      canProceed,
      tabCompletionById,
    ]
  );

  const handleNext = useCallback(() => {
    if (!canProceed) return;
    const nextIdx = currentTabIndex + 1;
    const toTab = nextIdx < nonSummaryTabs.length ? nonSummaryTabs[nextIdx] : summaryTab;
    if (toTab) {
      activityLog.logNavigate({
        fromTab: currentTab,
        toTab,
        fromStep: logStepNumberOf(currentTab),
        toStep: logStepNumberOf(toTab),
        direction: 'next',
        verticalId: selectedVerticalId,
      });
      setSelectedTabId(toTab.id);
    }
  }, [currentTabIndex, nonSummaryTabs, summaryTab, canProceed, currentTab, selectedVerticalId, activityLog, logStepNumberOf]);

  const handleBack = useCallback(() => {
    const prevIdx = currentTabIndex - 1;
    if (prevIdx >= 0) {
      const toTab = nonSummaryTabs[prevIdx];
      activityLog.logNavigate({
        fromTab: currentTab,
        toTab,
        fromStep: logStepNumberOf(currentTab),
        toStep: logStepNumberOf(toTab),
        direction: 'back',
        verticalId: selectedVerticalId,
      });
      setSelectedTabId(toTab.id);
    }
  }, [currentTabIndex, nonSummaryTabs, currentTab, selectedVerticalId, activityLog, logStepNumberOf]);

  const handleComplete = useCallback(async () => {
    if (!canComplete) return;
    try {
      isCompletingRef.current = true;
      setIsSaving(true);

      activityLog.logSubmit(jobState);

      if (!isEdit) try {
        const rdForSummary = (calculatorResultData || {}) as any;
        const rawCalc = rdForSummary.LFCalculator && Object.keys(rdForSummary.LFCalculator).length
          ? rdForSummary.LFCalculator
          : null;
        const selectedCalc = rawCalc
          ? {
              ...rawCalc,
              _id: rawCalc._id || rawCalc.id,
              appointmentId: rawCalc.appointmentId || appointmentId || rdForSummary.selectedAppointmentId,
            }
          : null;
        const uid = authUser?._id || authUser?.id;
        const summaryCalcs = Array.isArray(allCalculators) && allCalculators.length
          ? allCalculators.map((c: any) =>
              selectedCalc && String(c?._id || c?.id) === String(selectedCalc._id)
                ? { ...c, ...selectedCalc }
                : c
            )
          : selectedCalc
            ? [selectedCalc]
            : [];
        if (uid && leadId && selectedCalc) {
          logRolloutAndDropSummary({
            userId: uid,
            leadId,
            allCalculators: summaryCalcs,
            selectedCalculator: selectedCalc,
            leadData: {
              ...rdForSummary,
              ...buildSubmitLeadData({
                resultData: rdForSummary,
                result: isSale ? 'Sale' : 'Demo',
                calculatorDocument: selectedCalc,
                selectedCalculatorId: selectedCalc._id,
              }),
            },
            preferStoredTotals: true,
            isLowesLead: Boolean((initialConfig as any)?.lowesLead) || Boolean(rdForSummary?.isLowesLead),
          }).catch((e) => console.warn('[DynamicJobBuilder] rollout summary log failed:', e));
        }
      } catch (e) {
        console.warn('[DynamicJobBuilder] rollout summary log failed:', e);
      }

      const dynamicJobState = serializeDynamicJobStateForStorage(
        jobState || {},
        initialConfig,
        dealCenterData
      );
      if (dynamicJobState?.scheduleTime) {
        dynamicJobState.scheduleTime = normalizeScheduleTimeForSubmit(dynamicJobState.scheduleTime);
      }
      const configId = (initialConfig as any)?.id || null;
      const jobBuilderWrapper = {
        dynamicJobState,
        configId,
        configSnapshotId: configId || 'dynamic',
        calculatorType: 'dynamic',
        status: 'submitted',
      };

      if (isEdit) {
        const rd = (calculatorResultData || {}) as any;
        if (leadId) {
          await LeadService.upsertPortalJobBuilder(leadId, {
            isDynamic: true,
            dynamicJobState,
            configId,
            configSnapshotId: configId || 'dynamic',
            calculatorId: calcId || rd.calculatorId || null,
            appointmentId: appointmentId || rd.appointmentId || null,
            status: 'submitted',
          });
        }
        FlashMessage.success('Deal Updated', 'Products saved successfully');
        if (onJobComplete) {
          onJobComplete(initialConfig, jobState);
        }
        return;
      }

      const submitOffline = worksOffline();
      const documentPayloads = submitOffline
        ? { agreements: [], orderSheets: [] }
        : await buildDocumentPayloads({
            agreements: jobState?.agreements,
            orderSheets: jobState?.orderSheets,
            leadId,
            isSale,
            includeSystemGenerated: true,
          });

      const rd = (calculatorResultData || {}) as any;
      const result = isSale ? 'Sale' : 'Demo';
      const submitCalculatorId = calcId || rd.calculatorId || null;

      const { doc: lfCalculatorDoc, fromServer: lfFromServer } = submitOffline
        ? {
            doc: buildCalculatorDocument(null, rd?.LFCalculator, {
              calculatorId: submitCalculatorId,
              appointmentId: rd?.selectedAppointmentId || rd?.appointmentId || appointmentId || null,
              leadId,
              enteredBy: (authUser as any)?._id || (authUser as any)?.id || null,
            }),
            fromServer: false,
          }
        : await resolveLfCalculatorDoc(submitCalculatorId, rd, { force: true });

      const leadDataPayload = buildSubmitLeadData({
        resultData: rd,
        result,
        calculatorDocument: lfCalculatorDoc,
        selectedCalculatorId: submitCalculatorId,
        selectedAppointmentId: rd.selectedAppointmentId || leadId,
        jobBuilder: jobBuilderWrapper,
      });

      const payload = buildJobSubmitPayload({
        leadData: leadDataPayload,
        jobState: dynamicJobState,
        configId,
        agreements: documentPayloads.agreements,
        orderSheets: documentPayloads.orderSheets,
      });

      console.log(
        '[COMPLETE JOB] leadData calculator:',
        lfCalculatorDoc?._id
          ? `_id=${lfCalculatorDoc._id} title=${lfCalculatorDoc.title} entries=${
              (lfCalculatorDoc.entries || []).length
            } source=${lfFromServer ? 'server' : 'local tab'}`
          : 'NONE — no calculator id resolved and no local tab'
      );

      console.log(
        `[COMPLETE JOB PAYLOAD] POST /lead/v1/${leadId}/job-builder\n` +
          JSON.stringify(
            {
              ...payload,
              agreements: documentPayloads.agreements.map((d) => ({ ...d, file: `<base64 ${d.file.length} chars>` })),
              orderSheets: documentPayloads.orderSheets.map((d) => ({ ...d, file: `<base64 ${d.file.length} chars>` })),
            },
            null,
            2
          )
      );

      if (leadId && !submitOffline) {
        await LeadService.submitJobBuilder(leadId, payload);
      }

      const outcomeCalcId = calcId || rd.calculatorId || null;
      if (leadId && outcomeCalcId) {
        try {
          const rdWithoutDpm = Object.fromEntries(
            Object.entries(rd).filter(([k]) => k !== 'downPaymentMethod' && k !== 'LFCalculator')
          );
          const outcomePayload: Record<string, any> = {
            ...rdWithoutDpm,
            paymentMethod: rd.downPaymentMethod,
            result,
            status: result,
            selectedCalculatorId: outcomeCalcId,
            selectedAppointmentId: rd.selectedAppointmentId || leadId,
            jobBuilder: jobBuilderWrapper,
            ...(lfCalculatorDoc && { LFCalculator: lfCalculatorDoc }),
          };
          console.log(
            `[COMPLETE JOB — OUTCOME MIRROR PAYLOAD] PUT /lead/v1/${leadId}/outcome\n` +
              JSON.stringify(outcomePayload, null, 2)
          );
          if (submitOffline) {
            const workId = offlineWorkId();
            if (workId) {
              completeOfflineJobBuilder(workId, payload as any, outcomePayload);
            }
          } else {
            await LeadService.updateLeadOutcomeByCalculator(leadId, outcomeCalcId, outcomePayload);
          }
        } catch (e) {
          console.warn('[DynamicJobBuilder] outcome mirror save failed:', e);
        }
      }

      if (isSale && leadId && !submitOffline) {
        try {
          const scheduleTime: any = (jobState as any)?.scheduleTime || {};
          const isTBD = !scheduleTime.date || scheduleTime.date === 'TBD';

          const rawPrice =
            parseFloat(String(rd.contractPrice ?? rd.originalContractPrice ?? 0).replace(/,/g, '')) ||
            0;
          const pmMethod = rd.balancePaymentMethod || rd.downPaymentMethod || rd.paymentMethod || '';

          const retailPrice = Number((lfCalculatorDoc as any)?.totals?.retail) || 0;

          const downPaymentAmt = parseFloat(String(rd.downPayment ?? 0).replace(/,/g, '')) || 0;
          const payments = [
            { amount: downPaymentAmt, method: rd.downPaymentMethod || rd.paymentMethod || pmMethod },
            { amount: Math.max(0, rawPrice - downPaymentAmt), method: pmMethod },
          ];

          const commissionConfig = await fetchCommissionConfig(queryClient);

          const commissionResult = calculateCommission(rawPrice, pmMethod, {
            config: commissionConfig,
            retailPrice,
            payments,
            adminFeeOverride: lead?.lowesLead === true ? 0 : null,
          });

          await JobService.createJob({
            jobNumber: buildJobNumber(lead?.assignedRepDetails || {}, lead?.leadId || leadId),
            salesPrice: rawPrice,
            paymentMethod: pmMethod,
            installDate: isTBD ? null : scheduleTime.date || null,
            soldDate: new Date().toISOString(),
            toBeDetermined: isTBD,
            commission: commissionResult.amount,
            retailPrice,
            commissionTierId: commissionResult.details.tierId,
            commissionConfigUpdatedAt: commissionResult.details.configUpdatedAt,
            appointmentId: (lfCalculatorDoc as any)?.appointmentId || appointmentId || undefined,
            calculatorId: submitCalculatorId || undefined,
            leadId,
            isManual: false,
          } as any);
        } catch (jobTrackerError: any) {
          console.warn(
            '[DynamicJobBuilder] job tracker auto-add failed:',
            jobTrackerError?.message || jobTrackerError
          );
        }
      }

      if (leadId && !submitOffline) {
        LeadService.updateLeadTimelineProgress(leadId, {
          salesProcess: 'completed',
          leadResulted: 'completed',
          jobBuild: 'complete',
        }).catch((e) => console.warn('[DynamicJobBuilder] timeline progress complete failed:', e));
      }

      if (submitOffline) {
        FlashMessage.success(
          'Job completed',
          "Saved on your device — it'll upload when you're back online."
        );
      }

      if (onJobComplete) {
        onJobComplete(initialConfig, jobState);
      }
    } catch (error) {
      console.error('[DynamicJobBuilder] Completion failed:', error);
      isCompletingRef.current = false;
      Alert.alert('Error', 'Failed to complete the job. Please check your connection.');
    } finally {
      setIsSaving(false);
    }
  }, [jobState, initialConfig, calculatorResultData, leadId, calcId, dealCenterData, isSale, onJobComplete, canComplete, activityLog, isEdit, appointmentId, authUser, resolveLfCalculatorDoc, allCalculators, lead, worksOffline, offlineWorkId]);

  const handleUploadDocs = useCallback(
    async (cat: 'agreement' | 'orderSheet', payloads: any[]) => {
      if (!leadId || !payloads?.length) return null;

      if (worksOffline()) {
        const workId = offlineWorkId();
        if (!workId) return null;
        const queued = [];
        for (const p of payloads) {
          const doc = await addOfflineJobDocument(workId, cat, {
            uri: p.uri || p.file,
            contentType: p.contentType || 'application/pdf',
            extension: cat === 'agreement' ? 'pdf' : 'pdf',
          });
          if (doc) {
            queued.push({
              name: doc.name,
              uri: doc.uri,
              contentType: doc.contentType,
              documentType: cat,
              isNew: false,
              pendingUpload: true,
            });
          }
        }
        return queued;
      }

      try {
        const rootKey = cat === 'agreement' ? 'agreements' : 'orderSheets';
        const dynamicJobState = serializeDynamicJobStateForStorage(
          jobState || {},
          initialConfig,
          dealCenterData
        );
        const rd = (calculatorResultData || {}) as any;
        const docSubmitPayload = {
          result: 'Sale',
          status: 'Sale',
          selectedCalculatorId: calcId || rd.calculatorId || null,
          jobBuilder: {
            dynamicJobState,
            configId: (initialConfig as any)?.id || null,
            configSnapshotId: (initialConfig as any)?.id || 'dynamic',
            calculatorType: 'dynamic',
            status: 'draft',
          },
          [rootKey]: payloads,
        };
        console.log(
          `[DOC SUBMIT PAYLOAD] ${cat} → PUT /lead/v1/${leadId}/outcome/${calcId}\n` +
            JSON.stringify(
              {
                ...docSubmitPayload,
                [rootKey]: payloads.map((d: any) => ({
                  ...d,
                  file: `<base64 ${d.file?.length ?? 0} chars>`,
                })),
              },
              null,
              2
            )
        );
        await LeadService.updateLeadOutcomeByCalculator(leadId, calcId, docSubmitPayload);

        const rows = await fetchOutcomeDocumentRows(leadId, calcId);
        const resolved = await resolveOutcomeDocRows(rows);
        return resolved[rootKey] || [];
      } catch (e) {
        console.warn('[DynamicJobBuilder] doc upload failed:', e);
        return null;
      }
    },
    [leadId, calcId, jobState, initialConfig, dealCenterData, calculatorResultData, worksOffline, offlineWorkId]
  );

  const handleRefreshDocs = useCallback(
    async (cat: 'agreement' | 'orderSheet') => {
      if (!leadId || !calcId) return null;
      if (worksOffline()) return null;
      const rows = await fetchOutcomeDocumentRows(leadId, calcId);
      const resolved = await resolveOutcomeDocRows(rows);
      return resolved[cat === 'agreement' ? 'agreements' : 'orderSheets'] || [];
    },
    [leadId, calcId, worksOffline]
  );

  const collapsingHeader = useCollapsingHeader(true, currentTab?.id);

  // ⚠️ iOS: submitting an agreement / order sheet re-renders the summary, which can land back at the
  // top WITHOUT a scroll event, leaving the header half-collapsed (faded, "blurred"). Any job-state
  // change while on the summary re-opens it; scrolling re-collapses it as normal.
  const resetCollapsingHeader = collapsingHeader.reset;
  useEffect(() => {
    if (summaryTab?.id && currentTab?.id === summaryTab.id) resetCollapsingHeader();
  }, [jobState, summaryTab?.id, currentTab?.id, resetCollapsingHeader]);

  const isLastStep = currentTabIndex === nonSummaryTabs.length;
  const isFirstStep = currentTabIndex <= 0;
  const isFinalBuildStep = summaryTab
    ? isLastStep
    : nonSummaryTabs.length > 0 && currentTabIndex >= nonSummaryTabs.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flex: 1 }}>
      {/* Clips the header as it slides up. The header + the pinned trackers are OVERLAYS on top of the
          list, which never moves: see `useCollapsingHeader` for why (shaking while a finger is down). */}
      <View style={{ flex: 1, overflow: 'hidden' }}>

        {/* The renderer owns its own scroll now (fixed footage tracker + inner
            ScrollView, like the normal JB sections); the summary tab scrolls itself.
            So there is no outer ScrollView here — that keeps the tracker pinned.
            Keyboard avoidance is handled by each inner ScrollView via
            `automaticallyAdjustKeyboardInsets` (iOS) + Android `adjustResize`, so
            the focused input scrolls above the keyboard. A padding-based
            KeyboardAvoidingView here would instead just shrink the ScrollView above
            the keyboard, leaving a low field below the fold and hidden (this ticket). */}
        <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
          {currentTab && showEmptyGate ? (
            <View style={{ flex: 1, paddingTop: collapsingHeader.topInset }}>
            <EmptyStepGate
              stepLabel={currentTab.label || 'this step'}
              onAddDetails={dismissGate}
              onSkip={handleNext}
            />
            </View>
          ) : currentTab ? (
            <DynamicTabRenderer
              key={currentTab.id}
              tab={currentTab}
              vertical={selectedVertical}
              tabState={jobState?.[selectedVertical?.id]?.[currentTab.id] || {}}
              verticalState={jobState?.[selectedVertical?.id] || {}}
              lockedTabIds={currentVerticalLockedTabIds}
              onStateChange={handleTabStateChange}
              dealCenterData={dealCenterData}
              readOnly={false}
              applyConditions={applyConditions}
              hideAllocationTrackers={hideAllocationTrackers}
              collapsingScrollProps={collapsingHeader.scrollProps}
              collapsingUnderHeaderStyle={collapsingHeader.underHeaderStyle}
              collapsingTrackerStyle={collapsingHeader.trackerStyle}
              collapsingTopInset={collapsingHeader.topInset}
              verticalId={selectedVertical?.id}
              verticalColor={selectedVertical?.color || '#22c55e'}
              products={initialConfig?.products || []}
              schemas={calculatorSchemas || initialConfig?.schemas || []}
              editMode={isEdit}
              repDetails={authUser}
              leadId={leadId}
              calculatorResultData={calculatorResultData}
              customerName={dealCenterData?.customerName || dealCenterData?.customer?.name || ''}
              isSale={isSale}
              isDemo={isDemo}
              scheduleTime={jobState?.scheduleTime}
              agreements={jobState?.agreements || []}
              orderSheets={jobState?.orderSheets || []}
              rootJobState={jobState}
              onUpdateRootState={updateRootState}
              resolvedDocuments={resolvedDocuments}
              setResolvedDocuments={setResolvedDocuments}
              isDocUploadingRef={isDocUploadingRef}
              onUploadDocs={handleUploadDocs}
              onRefreshDocs={handleRefreshDocs}
            />
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ color: '#94A3B8', fontSize: 14 }}>
                Select a tab to begin
              </Text>
            </View>
          )}
        </View>
        <Reanimated.View
          onLayout={collapsingHeader.onHeaderLayout}
          style={[{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 60,
            paddingHorizontal: 24,
            paddingTop: 8,
            paddingBottom: 8,
            borderBottomWidth: 1,
            borderBottomColor: '#E2E8F0',
            backgroundColor: '#fff',
          }, collapsingHeader.headerStyle]}
        >
          {!embedded && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 0,
              }}
            >
              <Text style={{ fontSize: 18, fontWeight: '900', color: '#1C252E' }}>
                {isEdit ? 'Edit Deal' : 'Job Builder'}{isSaving ? '  • Saving...' : ''}
              </Text>
              <TouchableOpacity
                onPress={onGoBack || (() => navigation?.goBack())}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: '#F4F6F8',
                }}
              >
                <Icon name="close" size={20} color="#1C252E" />
              </TouchableOpacity>
            </View>
          )}

          {verticalList.length > 1 && (
            <VerticalTabBar
              verticals={verticalList}
              selectedVerticalId={selectedVerticalId}
              onVerticalChange={handleVerticalSelect}
              jobState={jobState}
              lockedVerticalIds={lockedVerticalIds}
            />
          )}

          <ProgressTracker
            steps={[
              ...tabProgress,
              ...(summaryTab
                ? [
                  {
                    id: summaryTab.id,
                    label: summaryTab.label || 'Summary',
                    active: isLastStep,
                    complete: areAllTabsComplete,
                    locked: false,
                  },
                ]
                : []),
            ]}
            activeStepId={currentTab?.id || ''}
            onStepPress={handleGoToTab}
            disableNavigation={isEdit}
          />
        </Reanimated.View>
      </View>

        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 12,
            // The home-indicator / nav-bar clearance is dead space while a keyboard or the
            // number pad is up (they sit between this bar and the screen edge).
            paddingBottom: keyboardUp ? 12 : insets.bottom + 16,
            borderTopWidth: 1,
            borderTopColor: '#E2E8F0',
            backgroundColor: '#fff',
          }}
        >
          {/* Why Complete is blocked (web `finalizeBlockedReason` tooltip parity). */}
          {isLastStep && summaryTab && !!finalizeBlockedReason && (
            <Text style={{ fontSize: 12, color: '#B45309', marginBottom: 8, textAlign: 'center' }}>
              {finalizeBlockedReason}
            </Text>
          )}
          <View
            style={{
              flexDirection: 'row',
              gap: 12,
              justifyContent: 'space-between',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {!isFirstStep ? (
              <TouchableOpacity
                onPress={handleBack}
                style={{
                  height: 38,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  width: 84
                }}
              >
                <Text style={{ fontWeight: '700', fontSize: 13, color: colors.text }}>
                  Back
                </Text>
              </TouchableOpacity>
            ) : embedded ? (
              <TouchableOpacity
                onPress={() => onEditBack?.()}
                style={{
                  height: 38,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  width: 84
                }}
              >
                <Text style={{ fontWeight: '700', fontSize: 13, color: colors.text }}>
                  Back
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 84 }} />
            )}
            {showClearButton && (
              <TouchableOpacity
                onPress={() => setClearConfirmOpen(true)}
                accessibilityLabel="Clear this step"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  backgroundColor: '#FEF2F2',
                  borderColor: '#FECACA',
                }}
              >
                <Icon name="restart" size={18} color="#EF4444" />
              </TouchableOpacity>
            )}
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {showSkipAll && (
              <TouchableOpacity
                onPress={handleSkipAll}
                accessibilityLabel="Skip to summary"
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  backgroundColor: '#EFF6FF',
                  borderColor: '#BFDBFE',
                }}
              >
                <Icon name="skip-forward" size={18} color="#2563EB" />
              </TouchableOpacity>
            )}
            {embedded ? (
              isFinalBuildStep ? (
                <TouchableOpacity
                  onPress={() => onEditComplete?.(jobState)}
                  style={{
                    paddingHorizontal: 24,
                    paddingVertical: 10,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                    backgroundColor: '#22C55E',
                  }}
                >
                  <Text style={{ fontWeight: '700', fontSize: 13, color: 'white', marginRight: 6 }}>
                    Next · Price
                  </Text>
                  <Icon name="arrow-right" size={16} color="white" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={handleNext}
                  disabled={!canProceed}
                  style={{
                    height: 38,
                    flexDirection: 'row',
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: canProceed ? '#000000' : '#CBD5E1',
                    opacity: canProceed ? 1 : 0.8,
                    width: 84
                  }}
                >
                  <Text style={{ fontWeight: '700', fontSize: 13, color: 'white' }}>Next</Text>
                </TouchableOpacity>
              )
            ) : isLastStep && summaryTab ? (
              <TouchableOpacity
                onPress={handleComplete}
                disabled={isSaving || !canComplete}
                style={{
                  paddingHorizontal: 24,
                  paddingVertical: 10,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  backgroundColor: canComplete ? '#22C55E' : '#CBD5E1',
                  opacity: isSaving ? 0.7 : 1,
                }}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                ) : (
                  <Icon name="check-all" size={18} color="white" style={{ marginRight: 8 }} />
                )}
                <Text
                  style={{
                    fontWeight: '700',
                    fontSize: 13,
                    color: 'white',
                  }}
                >
                  {isSaving ? 'Saving...' : isEdit ? 'Save Deal' : 'Complete Job'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleNext}
                disabled={!canProceed}
                style={{
                  height: 38,
                  flexDirection: 'row',
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: canProceed ? '#000000' : '#CBD5E1',
                  opacity: canProceed ? 1 : 0.8,
                  width: 84
                }}
              >
                <Text style={{ fontWeight: '700', fontSize: 13, color: 'white' }}>
                  Next
                </Text>
              </TouchableOpacity>
            )}
            </View>
          </View>
        </View>
      </View>

      {/* Clear-step confirmation (web `dynamic-job-builder.js` Dialog). */}
      <Modal
        visible={clearConfirmOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setClearConfirmOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setClearConfirmOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 360 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Icon name="alert" size={22} color="#F59E0B" />
              <Text style={{ fontSize: 17, fontWeight: '900', color: '#0F172A' }}>Clear this step?</Text>
            </View>
            <Text style={{ fontSize: 13, color: '#64748B', lineHeight: 19, marginBottom: 20 }}>
              This removes all selections and measurements on{' '}
              <Text style={{ fontWeight: '800', color: '#0F172A' }}>{currentTab?.label || 'this step'}</Text>. This can’t be undone.
            </Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity onPress={() => setClearConfirmOpen(false)} style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
                <Text style={{ fontWeight: '800', fontSize: 13, color: '#334155' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleClearTab}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EF4444', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 }}
              >
                <Icon name="restart" size={16} color="#fff" />
                <Text style={{ fontWeight: '800', fontSize: 13, color: '#fff' }}>Clear step</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

export function DynamicJobBuilderScreen(props: DynamicJobBuilderScreenProps) {
  return <DynamicJobBuilderInner {...props} />;
}
