import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useDynamicJobBuilderSession } from './useDynamicJobBuilderSession';
import { DynamicTabRenderer } from '../../widgets/components/dynamic-job-builder/DynamicTabRenderer';
import { ProgressTracker } from '../../widgets/components/dynamic-job-builder/ProgressTracker';
import { VerticalTabBar } from '../../widgets/components/dynamic-job-builder/VerticalTabBar';
import { FlashMessage } from '../../config/message';
import { LeadService } from '../../services/api/leads';
import { useDynamicJobBuilderActivityLog } from './hooks/useDynamicJobBuilderActivityLog';
import { isTabComplete } from '../../utils/dynamic-job-builder/engine/tab-validation';
import {
  serializeDynamicJobStateForStorage,
  deserializeDynamicJobStateFromStorage,
} from '../../utils/dynamic-job-builder/engine/dynamic-job-state-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';

interface DynamicJobBuilderScreenProps {
  navigation?: NativeStackNavigationProp<any>;
  initialConfig?: any;
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
  onJobComplete?: (config: any, state: any) => void;
  onGoBack?: () => void;
  // --- Deal-edit flow (web PortalDynamicJobBuilderModal) ----------------------
  // 'edit' rewires this screen to the PortalJobBuilder: it skips the calculator
  // outcome GET (parent supplies `initialJobState`), saves via
  // upsertPortalJobBuilder instead of the outcome PUT, and does NOT re-run the
  // /job-builder POST on complete (editing doesn't re-create the job).
  mode?: 'new' | 'edit';
  // Pre-deserialized job state for edit mode (parent loaded + deserialized it).
  initialJobState?: any;
  // Web `portalUnrestrictedEdit`: unlock every tab, show all fields/sections
  // (applyConditions off). Defaults to true in edit mode.
  portalUnrestrictedEdit?: boolean;
  // Web `hideAllocationTrackers`: hide the pinned footage/allocation trackers.
  // Defaults to true in edit mode.
  hideAllocationTrackers?: boolean;
  appointmentId?: string;
  // --- Embedded (4-step deal-edit wizard, step "Job Build") -------------------
  // When true this renders as the wizard's inner build step (web `<DynamicJobBuilder
  // embedded editMode>`): its own header + close are hidden (the wizard supplies
  // them), its auto-save/submit are suppressed (the wizard owns the single addendum
  // submit at the end), edited state streams out via `onStateChange`, the finalize
  // button becomes "Next · Price" (`onEditComplete`), and Back from the first tab
  // calls `onEditBack` (→ the wizard's Install Date step).
  embedded?: boolean;
  onStateChange?: (jobState: any) => void;
  onEditComplete?: (jobState: any) => void;
  onEditBack?: () => void;
}

function DynamicJobBuilderInner({
  navigation,
  initialConfig,
  dealCenterData,
  calculatorResultData,
  leadId,
  onJobComplete,
  onGoBack,
  mode = 'new',
  initialJobState: initialJobStateProp,
  portalUnrestrictedEdit: portalUnrestrictedEditProp,
  hideAllocationTrackers: hideAllocationTrackersProp,
  appointmentId,
  embedded = false,
  onStateChange,
  onEditComplete,
  onEditBack,
}: DynamicJobBuilderScreenProps) {
  const isEdit = mode === 'edit';
  // In edit mode both flags default ON (web parity); callers can still override.
  const portalUnrestrictedEdit = portalUnrestrictedEditProp ?? isEdit;
  const hideAllocationTrackers = hideAllocationTrackersProp ?? isEdit;
  const insets = useSafeAreaInsets();
  const verticalList = useMemo(
    () => initialConfig?.verticals || [],
    [initialConfig]
  );
  const { colors, isDark } = useTheme();

  // Fetch saved job state on mount via the calculator-scoped outcome endpoint
  // (web parity: GET /lead/v1/{leadId}/outcome/{calculatorId}). Web stores the
  // SERIALIZED job state at outcome.jobBuilder.dynamicJobState (storage keys);
  // we unwrap + deserialize it back to runtime ids below so already-set data
  // displays. Documents live under `leadOutcomeDocuments`. 404 = fresh start.
  const calcId = (calculatorResultData as any)?.calculatorId;
  const { data: outcomeData, isFetched: isOutcomeFetched } = useQuery({
    queryKey: ['leadOutcome', leadId, calcId],
    queryFn: async () => {
      try {
        const res = await LeadService.getLeadOutcomeByCalculator(leadId!, calcId);
        const body = res.data;
        // Unwrap exactly like web's extractCalculatorOutcome
        // (calculator-outcome-api.js): data.outcome ?? outcome ?? data ?? body.
        const outcome =
          body?.data?.outcome ?? body?.outcome ?? body?.data ?? body;

        // Web contract (JobBuilderContext.loadCalculatorDraft): the serialized
        // dynamic state lives at outcome.jobBuilder.dynamicJobState. Tolerate older
        // mobile saves that stored the raw runtime state directly under jobBuilder.
        const savedState =
          outcome?.jobBuilder?.dynamicJobState ??
          outcome?.dynamicJobState ??
          outcome?.jobBuilder ??
          null;

        // Deserialize storage-keys → runtime ids with the SAME config web used to
        // serialize (deserializeDynamicJobStateFromStorage). Idempotent for legacy
        // raw saves — keys without the `__` storage marker pass through unchanged —
        // so both web-written and old-mobile-written state rehydrate correctly.
        const jobState =
          savedState && typeof savedState === 'object'
            ? deserializeDynamicJobStateFromStorage(savedState, initialConfig)
            : undefined;

        // Resolve documents independently so a doc error doesn't wipe jobState
        const docs = outcome?.leadOutcomeDocuments;
        let resolvedDocuments: { agreements: any[]; orderSheets: any[] } = { agreements: [], orderSheets: [] };
        try {
          if (docs) {
            const all = [
              ...((docs.agreements || []) as any[]).map((d) => ({ ...d, _group: 'agreement' })),
              ...((docs.orderSheets || []) as any[]).map((d) => ({ ...d, _group: 'orderSheet' })),
            ];
            const paths = all
              .map((d) => ({ filePath: d.filePath, bucketName: d.bucketName }))
              .filter((p) => p.filePath && p.bucketName);
            if (all.length) {
              let urls: any[] = [];
              if (paths.length) {
                try {
                  const urlRes = await LeadService.getSecureUrls(paths);
                  urls = (urlRes.data?.data || urlRes.data || []) as any[];
                } catch (e) {
                  console.warn('[DynamicJobBuilder] secure URL resolution failed:', e);
                }
              }
              const mapped = all.map((d) => {
                const u = urls.find((x) => x.filePath === d.filePath);
                const type = d.documentType || d._group;
                return {
                  uri: u?.secureUrl || u?.url || d.filePath,
                  name: d.name || (type === 'agreement' ? 'Agreement' : 'Order Sheet'),
                  serverId: d._id,
                  filePath: d.filePath,
                  bucketName: d.bucketName,
                  contentType: d.fileData?.contentType,
                  isNew: false,
                  documentType: type,
                };
              });
              resolvedDocuments = {
                agreements: mapped.filter((m) => m.documentType === 'agreement'),
                orderSheets: mapped.filter((m) => m.documentType === 'orderSheet'),
              };
            }
          }
        } catch (e) {
          console.warn('[DynamicJobBuilder] doc resolution failed:', e);
        }

        // If the calculator-scoped outcome didn't echo the S3 doc rows, fall back to
        // the lead-scoped download endpoint (web dynamic-reopen parity) so uploaded
        // agreements/order-sheets still display. Returns base64 per doc.
        if (!resolvedDocuments.agreements.length && !resolvedDocuments.orderSheets.length) {
          try {
            const dl = await LeadService.downloadOutcomeDocuments(leadId!);
            const dd = dl.data?.data || dl.data || {};
            const mapDl = (arr: any[], type: 'agreement' | 'orderSheet') =>
              (arr || []).map((d: any) => ({
                uri: d.base64Data
                  ? `data:${d.fileData?.contentType || 'application/pdf'};base64,${d.base64Data}`
                  : d.filePath,
                name: d.name || (type === 'agreement' ? 'Agreement' : 'Order Sheet'),
                serverId: d._id,
                contentType: d.fileData?.contentType || 'application/pdf',
                isNew: false,
                documentType: type,
              }));
            const a = mapDl(dd.agreements, 'agreement');
            const o = mapDl(dd.orderSheets, 'orderSheet');
            if (a.length || o.length) resolvedDocuments = { agreements: a, orderSheets: o };
          } catch (e) {
            console.warn('[DynamicJobBuilder] downloadOutcomeDocuments fallback failed:', e);
          }
        }

        return { initialJobState: jobState, resolvedDocuments };
      } catch {
        return { initialJobState: undefined, resolvedDocuments: { agreements: [], orderSheets: [] } };
      }
    },
    // Edit mode supplies the (already-deserialized) state from the PortalJobBuilder
    // via `initialJobStateProp`, so the calculator-outcome GET is skipped entirely.
    enabled: Boolean(leadId && calcId) && !isEdit,
    staleTime: 30_000,
  });

  const session = useDynamicJobBuilderSession({
    initialConfig,
    dealCenterData,
    initialJobState: isEdit ? initialJobStateProp : outcomeData?.initialJobState,
  });

  const { jobState, updateTabState, updateRootState, clearRootState, lockedTabIdsByVertical } = session;

  // Embedded (wizard step 1): stream the edited job state up so the wizard can
  // price the delta (Job Price step), diff it (Review step), and submit it. The
  // callback is held in a ref so an inline parent handler doesn't re-fire the
  // effect every render — it fires only when jobState actually changes.
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

  // Server-hydrated agreement / order-sheet docs (secure URLs), mirrored from the
  // lead outcome. Local drafts live on jobState.agreements / .orderSheets.
  const [resolvedDocuments, setResolvedDocuments] = useState<{ agreements: any[]; orderSheets: any[] }>({
    agreements: [],
    orderSheets: [],
  });
  // Blocks the debounced auto-save while a document upload is mid-flight so we
  // don't race the outcome PUT (mirrors normal JB's isDocUploadingRef).
  const isDocUploadingRef = useRef(false);

  // Hydrate previously-saved (server) documents into the display state once the
  // outcome + secure URLs resolve — so a reopened job shows its agreement/order
  // sheet. commitUploaded appends freshly-uploaded ones on top of these.
  useEffect(() => {
    if (outcomeData?.resolvedDocuments) {
      setResolvedDocuments(outcomeData.resolvedDocuments);
    }
  }, [outcomeData?.resolvedDocuments]);

  // Sale vs demo drives which cards render and the completion gate (web parity:
  // isSale = result.toLowerCase() === 'sale'; demo = any non-sale).
  const resultType = (calculatorResultData?.resultType || '').toString().toLowerCase();
  const isSale = resultType === 'sale';
  const isDemo = Boolean(resultType) && !isSale;

  // --- Activity logging (web parity: use-dynamic-job-builder-activity-log) -----
  const configId = initialConfig?.configId || initialConfig?._id || null;
  const loggedAutoFieldTabsRef = useRef<Set<string>>(new Set());
  const activityLog = useDynamicJobBuilderActivityLog({
    enabled: Boolean(leadId),
    leadId,
    jobId: leadId,
    calculatorId: (calculatorResultData as any)?.calculatorId,
    calculatorType: 'dynamic',
    result: (calculatorResultData as any)?.resultType || (calculatorResultData as any)?.result,
    dealCenterData,
    configId,
    verticals: verticalList,
    markAutoFieldsLoggedTab: (tabKey: string) => {
      loggedAutoFieldTabsRef.current.add(tabKey);
    },
  });

  // job_builder_opened — fires once when user + leadId are ready (idempotent).
  useEffect(() => {
    activityLog.logOpened();
  }, [activityLog]);

  // Defer auto-save until the initial outcome fetch completes (web parity).
  // Without this guard, the auto-save fires with empty/default state before the
  // GET populates the session, overwriting saved server data.
  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    // Edit mode skips the outcome fetch, so release the auto-save gate immediately
    // (the initial state is already present via initialJobStateProp).
    if ((isOutcomeFetched || isEdit) && !initialFetchDoneRef.current) {
      initialFetchDoneRef.current = true;
    }
  }, [isOutcomeFetched, isEdit]);

  useEffect(() => {
    if (!leadId || !initialFetchDoneRef.current) return;
    // Embedded in the 4-step edit wizard: the wizard owns persistence (it submits a
    // single addendum draft at the end), so the builder must NOT auto-save/upsert.
    if (embedded) return;

    const timer = setTimeout(async () => {
      // Skip while a document upload is in flight — that upload PUTs the outcome
      // itself; auto-saving here would race it and can clobber the new files.
      if (isDocUploadingRef.current) return;
      // New flow requires a calculator id (outcome is calculator-scoped). Edit mode
      // saves to the lead-scoped PortalJobBuilder and does not need one.
      if (!calcId && !isEdit) return;
      try {
        // Never resend agreements/orderSheets here: they're uploaded separately as
        // base64 PDFs (and rehydrated from leadOutcomeDocuments); echoing them back
        // trips the backend's "agreements[i].file required" validation. scheduleTime
        // still rides along (root passthrough); everything else is the job state.
        const { agreements: _a, orderSheets: _o, ...stateNoDocs } = (jobState || {}) as any;
        // Web shape (JobBuilderContext.buildSavePayload → updateCalculatorJobBuilderOutcome):
        // the SERIALIZED job state is nested under jobBuilder.dynamicJobState so web
        // and mobile store/read it identically. serializeDynamicJobStateForStorage
        // maps runtime ids → stable storage keys (buildStorageKey / `__`).
        const dynamicJobState = serializeDynamicJobStateForStorage(
          stateNoDocs,
          initialConfig,
          dealCenterData
        );
        const configId = (initialConfig as any)?.id || null;

        if (isEdit) {
          // Edit flow (web PortalDynamicJobBuilderModal.handleComplete shape, draft):
          // PUT /lead/v1/{leadId}/portal-job-builder/upsert with the serialized state.
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
          // Web parity (ResultLeadModal.handleUpdateJobBuilder): include the
          // outcome fields (oneLeg, result, reason, explain, contract price, etc.)
          // in the auto-save so they persist even if the user never completes the
          // job builder. Without this, a partially-filled outcome is lost on close.
          const rd = (calculatorResultData || {}) as any;
          await LeadService.updateLeadOutcomeByCalculator(leadId, calcId, {
            selectedCalculatorId: calcId,
            oneLeg: rd.oneLeg,
            result: rd.resultType === 'sale' ? 'Sale' : rd.resultType === 'demo' ? 'Demo' : undefined,
            reason: rd.demoReason,
            explain: rd.reasonExplanation,
            lastPriceQuoted: rd.contractPrice,
            originalContractPrice: rd.contractPrice,
            downPayment: rd.downPayment,
            paymentMethod: rd.downPaymentMethod,
            balancePaymentMethod: rd.balancePaymentMethod,
            balance: rd.balance,
            jobBuilder: {
              dynamicJobState,
              configId,
              configSnapshotId: configId || 'dynamic',
              calculatorType: 'dynamic',
              status: 'draft',
            },
          });
        }
      } catch (error) {
        console.warn('[DynamicJobBuilder] Auto-save failed:', error);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [leadId, jobState, calcId, initialConfig, dealCenterData, isEdit, appointmentId, calculatorResultData, embedded]);

  // Web parity (dynamic-job-builder.js:111-121): once a non-sale result exists,
  // any lingering install appointment is cleared from root state.
  useEffect(() => {
    if (isDemo && jobState?.scheduleTime) {
      clearRootState('scheduleTime');
    }
  }, [isDemo, jobState?.scheduleTime, clearRootState]);

  const selectedVertical = useMemo(
    () => verticalList.find((v: any) => v.id === selectedVerticalId) || verticalList[0],
    [verticalList, selectedVerticalId]
  );

  const currentVerticalLockedTabIds = useMemo(() => {
    // Web `portalUnrestrictedEdit`: every tab is unlocked so the user can freely
    // revise any product in the deal (dynamic-job-builder.js lockedTabIds = []).
    if (portalUnrestrictedEdit) return [];
    return selectedVertical ? lockedTabIdsByVertical[selectedVertical.id] || [] : [];
  }, [selectedVertical, lockedTabIdsByVertical, portalUnrestrictedEdit]);

  const tabs = useMemo(() => selectedVertical?.tabs || [], [selectedVertical]);

  const availableTabs = useMemo(() => {
    const res = tabs.filter((t: any) => !currentVerticalLockedTabIds.includes(t.id));
    console.log(`[JobBuilder] Available tabs for ${selectedVerticalId}:`, res.map((t: any) => t.id), 'Locked tabs:', currentVerticalLockedTabIds);
    return res;
  }, [tabs, currentVerticalLockedTabIds, selectedVerticalId]);

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

  useEffect(() => {
    if (!selectedTabId) {
      if (nonSummaryTabs.length > 0) {
        setSelectedTabId(nonSummaryTabs[0].id);
      } else if (summaryTab) {
        // All product tabs are locked — fall back to the summary tab so the
        // screen isn't blank. This can happen when dealCenterData has no
        // calculator entries yet (e.g. no dcField keys are satisfied).
        setSelectedTabId(summaryTab.id);
      }
    }
  }, [nonSummaryTabs, summaryTab, selectedTabId]);

  // step_viewed + auto-populated + baseline seed on each tab activation. Must be
  // defined BEFORE the field-change effect so the baseline is seeded first on a
  // tab switch (then the change effect diffs against it → no spurious log).
  const firstTabActivatedRef = useRef(false);
  useEffect(() => {
    if (!currentTab || currentTab.isSummary || !selectedVerticalId) return;
    const isFirst = !firstTabActivatedRef.current;
    firstTabActivatedRef.current = true;
    activityLog.handleTabActivated({
      verticalId: selectedVerticalId,
      tab: currentTab,
      stepNumber: currentTabIndex + 1,
      isTabLogged: (k: string) => loggedAutoFieldTabsRef.current.has(k),
      isFirstTabAfterOpen: isFirst,
      tabState: jobState?.[selectedVerticalId]?.[currentTab.id] || {},
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTab?.id, selectedVerticalId]);

  // Field-change tracking — debounced 'change' logs for the active tab.
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

  // In unrestricted edit, conditions are off (web effectiveApplyConditions=false):
  // all fields/sections show and tab-completion isn't gated by dealCenter rules.
  const applyConditions = !portalUnrestrictedEdit;
  const validationCtx = useMemo(() => ({
    dealCenterData: dealCenterData || {},
    applyConditions,
    products: initialConfig?.products || [],
  }), [dealCenterData, initialConfig, applyConditions]);

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

  const canComplete = useMemo(() => {
    // Unrestricted edit never blocks saving (web effectiveApplyConditions=false):
    // the user is revising an already-resulted deal, not completing a fresh one.
    if (portalUnrestrictedEdit) return true;
    if (!areAllTabsComplete) return false;
    // Web parity (dynamic-job-builder.js isAppointmentSchedulingComplete): a sale
    // requires the install appointment; a demo / unknown result needs nothing
    // beyond tab completion. The agreement/order-sheet are NOT gated by web.
    if (isSale) return isAppointmentSet;
    return true;
  }, [portalUnrestrictedEdit, areAllTabsComplete, isSale, isAppointmentSet]);

  const canProceed = useMemo(() => {
    if (portalUnrestrictedEdit) return true;
    if (currentTabIndex === nonSummaryTabs.length) {
      return canComplete;
    }
    return isCurrentTabComplete;
  }, [portalUnrestrictedEdit, currentTabIndex, nonSummaryTabs.length, canComplete, isCurrentTabComplete]);

  const handleVerticalSelect = useCallback((verticalId: string) => {
    setSelectedVerticalId(verticalId);
    setSelectedTabId('');
  }, []);

  const handleTabStateChange = useCallback(
    (tabStateOrUpdater: any) => {
      if (!selectedVertical?.id || !currentTab?.id) return;
      // Pass the updater straight through — updateTabState resolves it inside the
      // setter against React's latest state, so batched edits chain instead of
      // clobbering (web parity). No `jobState` in deps → no stale snapshot.
      updateTabState(selectedVertical.id, currentTab.id, tabStateOrUpdater);
    },
    [selectedVertical, currentTab, updateTabState]
  );

  const handleGoToTab = useCallback(
    (index: number) => {
      if (index >= 0 && index < allNonSummaryTabs.length) {
        const tab = allNonSummaryTabs[index];
        if (tab && !currentVerticalLockedTabIds.includes(tab.id)) {
          setSelectedTabId(tab.id);
        }
      } else if (index === allNonSummaryTabs.length && summaryTab) {
        setSelectedTabId(summaryTab.id);
      }
    },
    [allNonSummaryTabs, currentVerticalLockedTabIds, summaryTab]
  );

  const handleNext = useCallback(() => {
    if (!canProceed) return;
    const nextIdx = currentTabIndex + 1;
    const toTab = nextIdx < nonSummaryTabs.length ? nonSummaryTabs[nextIdx] : summaryTab;
    if (toTab) {
      activityLog.logNavigate({
        fromTab: currentTab,
        toTab,
        fromStep: currentTabIndex + 1,
        toStep: nextIdx + 1,
        direction: 'forward',
        verticalId: selectedVerticalId,
      });
      setSelectedTabId(toTab.id);
    }
  }, [currentTabIndex, nonSummaryTabs, summaryTab, canProceed, currentTab, selectedVerticalId, activityLog]);

  const handleBack = useCallback(() => {
    const prevIdx = currentTabIndex - 1;
    if (prevIdx >= 0) {
      const toTab = nonSummaryTabs[prevIdx];
      activityLog.logNavigate({
        fromTab: currentTab,
        toTab,
        fromStep: currentTabIndex + 1,
        toStep: prevIdx + 1,
        direction: 'backward',
        verticalId: selectedVerticalId,
      });
      setSelectedTabId(toTab.id);
    }
  }, [currentTabIndex, nonSummaryTabs, currentTab, selectedVerticalId, activityLog]);

  const handleComplete = useCallback(async () => {
    if (!canComplete) return;
    try {
      setIsSaving(true);

      activityLog.logSubmit(jobState);

      // scheduleTime rides inside jobBuilder (web parity); installDate/timeWindow
      // are also surfaced flat. Agreements/order-sheets are NOT re-sent here — they
      // were already uploaded to the outcome as base64 PDFs; echoing them back would
      // trip the backend's "file required" validation. Strip them from jobBuilder.
      const { agreements: _a, orderSheets: _o, ...jobBuilderNoDocs } = (jobState || {}) as any;

      // Serialize once (runtime ids → storage keys) — reused by both the outcome
      // finalize PUT and the /job-builder POST so both persist the identical state.
      const dynamicJobState = serializeDynamicJobStateForStorage(
        jobBuilderNoDocs,
        initialConfig,
        dealCenterData
      );
      const configId = (initialConfig as any)?.id || null;
      const jobBuilderWrapper = {
        dynamicJobState,
        configId,
        configSnapshotId: configId || 'dynamic',
        calculatorType: 'dynamic',
        status: 'submitted',
      };

      // EDIT FLOW (web PortalDynamicJobBuilderModal.handleComplete): editing a saved
      // deal only upserts the PortalJobBuilder (status:'submitted'). It does NOT
      // finalize the calculator outcome and does NOT re-run the /job-builder POST —
      // the job already exists; we're only updating its products. Then bounce back.
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

      // Finalize the calculator outcome in the SAME web shape as the autosave, but
      // status:'submitted' (web parity: TabbedCalculator writes the outcome on
      // complete). This is what a reopen (GET /outcome/{calcId}) rehydrates from, so
      // a submitted deal shows its already-set data. Best-effort — a failure here
      // must not block the /job-builder finalize below.
      // Web parity (ResultLeadModal.handleUpdateJobBuilder): include the outcome
      // fields (oneLeg, result, reason, explain, contract price, etc.) so they
      // persist in the calculator-scoped outcome for rehydration on reopen.
      if (leadId && calcId) {
        try {
          const rd = (calculatorResultData || {}) as any;
          await LeadService.updateLeadOutcomeByCalculator(leadId, calcId, {
            selectedCalculatorId: calcId,
            oneLeg: rd.oneLeg,
            result: isSale ? 'Sale' : 'Demo',
            reason: rd.demoReason,
            explain: rd.reasonExplanation,
            lastPriceQuoted: rd.contractPrice,
            originalContractPrice: rd.contractPrice,
            downPayment: rd.downPayment,
            paymentMethod: rd.downPaymentMethod,
            balancePaymentMethod: rd.balancePaymentMethod,
            balance: rd.balance,
            jobBuilder: jobBuilderWrapper,
          });
        } catch (e) {
          console.warn('[DynamicJobBuilder] outcome finalize failed:', e);
        }
      }

      // Re-send the agreements/order-sheets (uploaded eagerly to the outcome) as
      // top-level base64 in the /job-builder POST so it populates the
      // JobBuilderDocument collection — that is what LeadCenter's contract details
      // reads (lead.jobBuilderDocuments → resolvedDocuments). Without this, a
      // dynamic-resulted lead shows NO agreement there (the outcome/LeadOutcomeDocument
      // store the summary reads from is separate). Mirrors the normal JB complete.
      let agreementsPayload: any[] = [];
      let orderSheetsPayload: any[] = [];
      if (leadId) {
        try {
          const dl = await LeadService.downloadOutcomeDocuments(leadId);
          const dd = dl.data?.data || dl.data || {};
          const toDocPayload = (arr: any[], type: 'agreement' | 'orderSheet') =>
            (arr || [])
              .filter((d: any) => d?.base64Data)
              .map((d: any) => {
                const ct = d.fileData?.contentType || 'application/pdf';
                const file = String(d.base64Data).startsWith('data:')
                  ? d.base64Data
                  : `data:${ct};base64,${d.base64Data}`;
                return { name: d.name || '', file, type };
              });
          agreementsPayload = toDocPayload(dd.agreements, 'agreement');
          orderSheetsPayload = toDocPayload(dd.orderSheets, 'orderSheet');
        } catch (e) {
          console.warn('[DynamicJobBuilder] prefetch outcome docs failed:', e);
        }
      }

      // POST /lead/v1/{leadId}/job-builder REQUIRES top-level `leadData` AND
      // `jobState` (web TabbedCalculator payload). The previous
      // `{ jobBuilder, ...resultData }` shape 400'd with
      // "Both leadData and jobState are required in the request body".
      const rd = (calculatorResultData || {}) as any;
      const result = isSale ? 'Sale' : 'Demo';
      // Web parity: the outcome uses `paymentMethod` for the down payment method
      // (not `downPaymentMethod` as in the result modal's state). Map them here so
      // the spread of `...rd` doesn't send the wrong key name.
      const { downPaymentMethod: _dpm, ...rdWithoutDpm } = rd;
      const payload = {
        leadData: {
          ...rdWithoutDpm,
          paymentMethod: rd.downPaymentMethod,
          result,
          status: result,
          jobBuilder: jobBuilderWrapper,
          calculatorId: calcId || rd.calculatorId || null,
          selectedCalculatorId: calcId || rd.calculatorId || null,
          selectedAppointmentId: rd.selectedAppointmentId || leadId,
          appointmentId: rd.appointmentId || leadId,
          installDate: jobState?.scheduleTime?.date,
          timeWindow: jobState?.scheduleTime?.timeWindow,
          originalContractPrice: rd.contractPrice ?? rd.originalContractPrice,
          lastPriceQuoted: rd.contractPrice ?? rd.lastPriceQuoted,
        },
        jobState: dynamicJobState,
        agreements: agreementsPayload,
        orderSheets: orderSheetsPayload,
        isDynamic: true,
        configId,
        configSnapshotId: configId || 'dynamic',
      };

      if (leadId) {
        await LeadService.submitJobBuilder(leadId, payload);
      }

      // Web parity (TabbedCalculator.js ~L872-917): mirror the outcome fields +
      // agreements/order-sheets to PUT /lead/v1/{leadId}/outcome so the
      // LeadOutcome collection is populated (the source read by
      // downloadOutcomeDocuments and rendered in ContractDetails). Without this,
      // the outcome fields (oneLeg, result, reason, explain, contract price, etc.)
      // and uploaded documents are only in the JobBuilderDocument collection and
      // invisible to the LeadOutcome-based views.
      if (leadId) {
        try {
          const outcomePayload: Record<string, any> = {
            ...rdWithoutDpm,
            paymentMethod: rd.downPaymentMethod,
            result,
            status: result,
            selectedCalculatorId: calcId || rd.calculatorId || null,
            selectedAppointmentId: rd.selectedAppointmentId || leadId,
            jobBuilder: jobBuilderWrapper,
          };
          if (agreementsPayload.length > 0) outcomePayload.agreements = agreementsPayload;
          if (orderSheetsPayload.length > 0) outcomePayload.orderSheets = orderSheetsPayload;
          await LeadService.updateLeadOutcome(leadId, outcomePayload);
        } catch (e) {
          console.warn('[DynamicJobBuilder] outcome mirror save failed:', e);
        }
      }

      if (onJobComplete) {
        onJobComplete(initialConfig, jobState);
      }
    } catch (error) {
      console.error('[DynamicJobBuilder] Completion failed:', error);
      Alert.alert('Error', 'Failed to complete the job. Please check your connection.');
    } finally {
      setIsSaving(false);
    }
  }, [jobState, initialConfig, calculatorResultData, leadId, calcId, dealCenterData, isSale, onJobComplete, canComplete, activityLog, isEdit, appointmentId]);

  // Persist a generated/scanned agreement or order-sheet. Web parity
  // (TabbedCalculator outcomePayload): the base64 PDFs go at the TOP LEVEL of the
  // outcome PUT — that is what upserts the LeadOutcomeDocument S3 rows (the display
  // source, read back via downloadOutcomeDocuments / leadOutcomeDocuments). We also
  // send the SERIALIZED jobBuilder.dynamicJobState + Sale context so the field state
  // and result aren't clobbered. Docs are sale-only, so result/status are 'Sale'
  // (matches the working normal JB SummarySection payload). Returns true on success.
  const handleUploadDocs = useCallback(
    async (cat: 'agreement' | 'orderSheet', payloads: any[]) => {
      if (!leadId || !payloads?.length) return false;
      try {
        const rootKey = cat === 'agreement' ? 'agreements' : 'orderSheets';
        const { agreements: _a, orderSheets: _o, ...stateNoDocs } = (jobState || {}) as any;
        const dynamicJobState = serializeDynamicJobStateForStorage(
          stateNoDocs,
          initialConfig,
          dealCenterData
        );
        const rd = (calculatorResultData || {}) as any;
        await LeadService.updateLeadOutcome(leadId, {
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
        });
        return true;
      } catch (e) {
        console.warn('[DynamicJobBuilder] doc upload failed:', e);
        return false;
      }
    },
    [leadId, calcId, jobState, initialConfig, dealCenterData, calculatorResultData]
  );

  const isLastStep = currentTabIndex === nonSummaryTabs.length;
  const isFirstStep = currentTabIndex <= 0;
  // Embedded (wizard) finalize point: the summary tab when present, else the last
  // product tab. Reaching it turns the primary button into "Next · Price".
  const isFinalBuildStep = summaryTab
    ? isLastStep
    : nonSummaryTabs.length > 0 && currentTabIndex >= nonSummaryTabs.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flex: 1 }}>
        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 8,
            paddingBottom: 24,
            borderBottomWidth: 1,
            borderBottomColor: '#E2E8F0',
            backgroundColor: '#fff',
          }}
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
              lockedTabIds={currentVerticalLockedTabIds}
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
          />
        </View>

        {/* The renderer owns its own scroll now (fixed footage tracker + inner
            ScrollView, like the normal JB sections); the summary tab scrolls itself.
            So there is no outer ScrollView here — that keeps the tracker pinned. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1, backgroundColor: '#F8FAFC' }}
        >
          {currentTab ? (
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
              verticalId={selectedVertical?.id}
              verticalColor={selectedVertical?.color || '#22c55e'}
              products={initialConfig?.products || []}
              schemas={initialConfig?.schemas || []}
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
            />
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ color: '#94A3B8', fontSize: 14 }}>
                Select a tab to begin
              </Text>
            </View>
          )}
        </KeyboardAvoidingView>

        <View
          style={{
            paddingHorizontal: 24,
            paddingTop: 12,
            paddingBottom: Math.max(insets.bottom, 16),
            borderTopWidth: 1,
            borderTopColor: '#E2E8F0',
            backgroundColor: '#fff',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              gap: 12,
              justifyContent: 'space-between',
            }}
          >
            {!isFirstStep ? (
              <TouchableOpacity
                onPress={handleBack}
                style={{
                  padding: 6,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  width: 80
                }}
              >
                <Text style={{ fontWeight: '600', fontSize: 12, color: colors.text }}>
                  Back
                </Text>
              </TouchableOpacity>
            ) : embedded ? (
              // First build tab: Back returns to the wizard's Install Date step.
              <TouchableOpacity
                onPress={() => onEditBack?.()}
                style={{
                  padding: 6,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  width: 80
                }}
              >
                <Text style={{ fontWeight: '600', fontSize: 12, color: colors.text }}>
                  Back
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 80 }} />
            )}

            {embedded ? (
              // Wizard: advance to the Job Price step once the build is finalized,
              // otherwise page through the build tabs. No submit happens here.
              isFinalBuildStep ? (
                <TouchableOpacity
                  onPress={() => onEditComplete?.(jobState)}
                  style={{
                    paddingHorizontal: 24,
                    paddingVertical: 10,
                    borderRadius: 12,
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
                    padding: 6,
                    flexDirection: 'row',
                    borderRadius: 8,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: canProceed ? '#000000' : '#CBD5E1',
                    opacity: canProceed ? 1 : 0.8,
                    width: 80
                  }}
                >
                  <Text style={{ fontWeight: '600', fontSize: 12, color: 'white' }}>Next</Text>
                </TouchableOpacity>
              )
            ) : isLastStep && summaryTab ? (
              <TouchableOpacity
                onPress={handleComplete}
                disabled={isSaving || !canComplete}
                style={{
                  paddingHorizontal: 24,
                  paddingVertical: 10,
                  borderRadius: 12,
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
                  padding: 6,
                  flexDirection: 'row',
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: canProceed ? '#000000' : '#CBD5E1',
                  opacity: canProceed ? 1 : 0.8,
                  width: 80
                }}
              >
                <Text style={{ fontWeight: '600', fontSize: 12, color: 'white' }}>
                  Next
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

export function DynamicJobBuilderScreen(props: DynamicJobBuilderScreenProps) {
  return <DynamicJobBuilderInner {...props} />;
}
