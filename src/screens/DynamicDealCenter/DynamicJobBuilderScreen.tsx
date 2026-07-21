import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
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
import { buildCalculatorOutcomePayload } from './utils/build-outcome-payload';
import { canCompleteJobBuilder, finalizeBlockedReason as computeFinalizeBlockedReason } from './utils/finalize-gate';
import { useAuth } from '../../hooks/useAuth';
import { logRolloutAndDropSummary } from '../../utils/activity-log/rollout-summary';
import { isTabComplete } from '../../utils/dynamic-job-builder/engine/tab-validation';
import {
  serializeDynamicJobStateForStorage,
  deserializeDynamicJobStateFromStorage,
  hydrateJobStateForPersistence,
} from '../../utils/dynamic-job-builder/engine/dynamic-job-state-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';

interface DynamicJobBuilderScreenProps {
  navigation?: NativeStackNavigationProp<any>;
  initialConfig?: any;
  /**
   * System A calculator form schemas (`CalculatorSchema[]`, from
   * `/calculator-form-schemas/deal-center`). Web threads the same array through as
   * `schemas`; the summary tab uses each schema CATEGORY's colour for that tab's
   * card header. Distinct from `initialConfig`, which is the System B
   * job-builder config (verticals/products) and carries no schemas.
   */
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
  // The wizard's Install Date step owns the reschedule. This screen stays MOUNTED
  // across steps (it is only hidden), so `initialJobState` is read once and a date
  // picked afterwards would never reach the Summary tab's Scheduled Appointment
  // card. The wizard passes the live value here and it is synced into root state.
  scheduleTimeOverride?: { date?: string | null; timeWindow?: string } | null;
  /**
   * Edit mode only: the parent (DynamicDealEditScreen) already fetched the saved
   * outcome, so it hands the raw `leadOutcomeDocuments` here. The builder's own
   * outcome GET is skipped in edit mode, so without this the agreement/order-sheet
   * docs never resolve and the Contract Amendment summary shows no existing docs.
   */
  rawDocsOverride?: { agreements?: any[]; orderSheets?: any[] } | null;
  onStateChange?: (jobState: any) => void;
  onEditComplete?: (jobState: any) => void;
  onEditBack?: () => void;
}

function DynamicJobBuilderInner({
  navigation,
  initialConfig,
  calculatorSchemas,
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
  scheduleTimeOverride,
  rawDocsOverride,
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
  const { user: authUser } = useAuth();

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

        // Return the draft state IMMEDIATELY, handing the raw document rows to a
        // SEPARATE query (below) for secure-URL / download resolution. Previously
        // this queryFn awaited those slow doc calls — including a lead-scoped
        // `downloadOutcomeDocuments` that 404s when there are no saved docs — before
        // returning, so `initialJobState` (the draft) couldn't reach the session
        // until the whole doc chain settled. That is the "reopen shows empty, then
        // fills in a moment later" the rep sees. Draft hydration must not wait on docs.
        return { initialJobState: jobState, rawDocs: outcome?.leadOutcomeDocuments || null };
      } catch {
        return { initialJobState: undefined, rawDocs: null };
      }
    },
    // Edit mode supplies the (already-deserialized) state from the PortalJobBuilder
    // via `initialJobStateProp`, so the calculator-outcome GET is skipped entirely.
    enabled: Boolean(leadId && calcId) && !isEdit,
    // Web parity (JobBuilderContext.loadCalculatorDraft): the saved outcome is
    // fetched FRESH on every job-builder open — web calls the endpoint imperatively
    // each session, never from a cache. Here it MUST NOT be cached: after the rep
    // types a value the debounced PUT updates the server, but the React Query cache
    // for this (leadId, calcId) is not invalidated. A quick reopen within the old
    // 30s staleTime would then serve the STALE pre-edit result (often empty on the
    // first-ever open) → the reopened job builder showed nothing. `staleTime: 0` +
    // `refetchOnMount: 'always'` force a refetch on reopen, and `gcTime: 0` drops
    // the cache on close so the remount starts from a clean loading state (undefined
    // initialJobState) — the one-time apply guard in the session then waits for the
    // fresh value instead of latching onto a stale one.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  // Documents resolve in a SEPARATE, non-blocking query — this is the slow work
  // (secure-URL batch + the `downloadOutcomeDocuments` fallback that 404s when no
  // docs exist) that used to gate draft hydration. It runs only after the outcome
  // GET has landed (so `outcomeData.rawDocs` is available) and never delays the
  // draft. A doc failure leaves the previously-set documents untouched.
  // In edit mode the outcome GET is skipped, so fall back to the parent-supplied
  // raw docs (leadOutcomeDocuments) — this is what lets the amendment view show the
  // agreements/order sheets that were saved on the original deal.
  const rawDocs = outcomeData?.rawDocs || (isEdit ? rawDocsOverride : null);
  const { data: resolvedDocumentsData } = useQuery({
    queryKey: ['leadOutcomeDocs', leadId, calcId],
    queryFn: async () => {
      let resolvedDocuments: { agreements: any[]; orderSheets: any[] } = { agreements: [], orderSheets: [] };
      try {
        if (rawDocs) {
          const all = [
            ...((rawDocs.agreements || []) as any[]).map((d) => ({ ...d, _group: 'agreement' })),
            ...((rawDocs.orderSheets || []) as any[]).map((d) => ({ ...d, _group: 'orderSheet' })),
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

      // NOTE: web (JobBuilderContext.loadCalculatorDraft) does NOT fetch documents
      // at reopen — the draft load is a single outcome GET. `downloadOutcomeDocuments`
      // is a SUBMIT-only call on web (TabbedCalculator onClose 'complete', to pre-fetch
      // base64 for re-upload), never a reopen call. Mobile previously fell back to it
      // here whenever the outcome echoed no S3 doc rows, which 404s for every lead with
      // no saved docs and added a failing round-trip on each reopen — the delayed-draft
      // symptom the rep saw. Removed for web parity: with no echoed docs this query now
      // resolves instantly with no network call. Previously-uploaded docs still display
      // from the outcome's echoed `leadOutcomeDocuments` (resolved above); they are also
      // re-fetched at submit exactly like web.

      return resolvedDocuments;
    },
    // Runs once rawDocs are available: after the outcome GET lands (new flow), OR
    // in edit mode as soon as the parent hands down `rawDocsOverride`.
    enabled: Boolean(leadId && calcId) && (isOutcomeFetched || (isEdit && !!rawDocsOverride)),
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  // Web parity (JobBuilderContext.applyDraftState): the outcome GET returns the
  // DESERIALIZED saved state; before feeding it to the session we RE-HYDRATE it
  // against dealCenterData. LOCKED, dcField-driven fields (e.g. gutter Extras:
  // Wedges / Straps) are NOT stored meaningfully — they resolve from the calculator
  // — so deserialize alone leaves them blank on reopen. Re-hydrating re-resolves
  // them to their current calculator values while preserving every non-locked entry.
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
  });

  const { jobState, updateTabState, updateRootState, clearRootState, lockedTabIdsByVertical } = session;

  // Web parity (dynamic-job-builder.js `verticalHasUnlockedSteps`): a vertical is
  // "configured" for this deal when it has at least one non-summary tab that isn't
  // locked (its dealCenter-driven visibility passes). A vertical whose every step is
  // locked — only the auto Summary remains — is treated as locked so, in a
  // multi-product deal, only the configured Job Builder(s) can be opened. Edit mode
  // (`portalUnrestrictedEdit`) unlocks everything, matching web's `unlockAll`.
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
    if (resolvedDocumentsData) {
      setResolvedDocuments(resolvedDocumentsData);
    }
  }, [resolvedDocumentsData]);

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

  // Web parity (JobBuilderContext.flushSave, ported from System A's save engine):
  // a per-save in-flight guard + follow-up so two outcome PUTs never overlap and
  // the latest state is re-saved after an in-flight save resolves; a dirty ref
  // drives an unmount flush so an edit made in the 2s debounce window right before
  // navigating away is not dropped.
  const saveInFlightRef = useRef(false);
  const needsFollowUpRef = useRef(false);
  const autoSaveDirtyRef = useRef(false);
  // Set for the duration of handleComplete. Completing must NOT write the
  // calculator-scoped outcome (`PUT /outcome/{calcId}`) — that endpoint belongs to
  // the agreement/doc-save path only. Without this flag the debounced autosave (and
  // the unmount flush that fires when onJobComplete resets navigation) would issue a
  // second PUT to it moments after Complete Job, duplicating the outcome row.
  const isCompletingRef = useRef(false);

  const performAutoSave = useCallback(async () => {
    if (!leadId || !initialFetchDoneRef.current || embedded) return;
    if (isCompletingRef.current) return;
    // Skip while a document upload is in flight — that upload PUTs the outcome
    // itself; auto-saving here would race it and can clobber the new files.
    if (isDocUploadingRef.current) return;
    // New flow requires a calculator id (outcome is calculator-scoped). Edit mode
    // saves to the lead-scoped PortalJobBuilder and does not need one.
    if (!calcId && !isEdit) return;
    // In-flight guard: coalesce a concurrent request into a single follow-up.
    if (saveInFlightRef.current) {
      needsFollowUpRef.current = true;
      return;
    }
    saveInFlightRef.current = true;
    autoSaveDirtyRef.current = false;
    try {
      const { agreements: _a, orderSheets: _o, ...stateNoDocs } = (jobState || {}) as any;
      const dynamicJobState = serializeDynamicJobStateForStorage(stateNoDocs, initialConfig, dealCenterData);
      const configId = (initialConfig as any)?.id || null;
      // Web parity (JobBuilderContext.buildSavePayload): persist which sections
      // already had their auto-populated fields logged, so a reopen dedups them
      // instead of re-firing the activity events.
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
        await LeadService.updateLeadOutcomeByCalculator(
          leadId,
          calcId,
          buildCalculatorOutcomePayload({
            rd,
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
          }),
        );
      }
    } catch (error) {
      console.warn('[DynamicJobBuilder] Auto-save failed:', error);
    } finally {
      saveInFlightRef.current = false;
      // A save requested while this one was in flight → run one follow-up now.
      if (needsFollowUpRef.current) {
        needsFollowUpRef.current = false;
        void performAutoSave();
      }
    }
  }, [leadId, jobState, calcId, initialConfig, dealCenterData, isEdit, appointmentId, calculatorResultData, embedded]);

  // Keep the latest saver in a ref so the unmount flush calls the current closure.
  const performAutoSaveRef = useRef(performAutoSave);
  performAutoSaveRef.current = performAutoSave;

  useEffect(() => {
    if (!leadId || !initialFetchDoneRef.current || embedded) return;
    autoSaveDirtyRef.current = true;
    const timer = setTimeout(() => void performAutoSave(), 2000);
    return () => clearTimeout(timer);
  }, [performAutoSave, leadId, embedded]);

  // Unmount flush: if a debounced edit is still pending, persist it immediately so
  // a value changed then quickly navigated away from is not lost (web parity).
  useEffect(
    () => () => {
      if (autoSaveDirtyRef.current) void performAutoSaveRef.current();
    },
    [],
  );

  // Web parity (dynamic-job-builder.js:111-121): once a non-sale result exists,
  // any lingering install appointment is cleared from root state.
  useEffect(() => {
    if (isDemo && jobState?.scheduleTime) {
      clearRootState('scheduleTime');
    }
  }, [isDemo, jobState?.scheduleTime, clearRootState]);

  // Reschedules made in the wizard's Install Date step (this screen is mounted the
  // whole time) must reach root state so the Summary tab's Scheduled Appointment
  // card shows the newly picked date instead of the one saved on the deal. Demo
  // deals carry no install appointment, so leave the clear-effect above alone.
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

  // Web parity (dynamic-job-builder.js:225-245): if the initially-selected vertical
  // is fully locked (not configured for this deal), hand off to the first vertical
  // that HAS unlocked steps so the rep doesn't land on an un-openable product.
  useEffect(() => {
    if (verticalList.length <= 1) return;
    if (verticalHasUnlockedSteps[selectedVerticalId]) return;
    const target = verticalList.find((v: any) => verticalHasUnlockedSteps[v.id]);
    if (!target || target.id === selectedVerticalId) return;
    setSelectedVerticalId(target.id);
    setSelectedTabId('');
  }, [verticalList, selectedVerticalId, verticalHasUnlockedSteps]);

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

  // True only while the Summary tab is selected as a FALLBACK (no product tab was
  // available yet). Cleared the moment a product tab exists so we can correct back
  // to step 1 — the job builder must open on the first tab, not the summary.
  const autoSummaryRef = useRef(false);
  useEffect(() => {
    if (nonSummaryTabs.length > 0) {
      // Product tabs are available: open on the first one. Also correct a Summary
      // selection that was only a fallback picked before the tabs resolved (the
      // locks/dealCenterData settle a tick after mount) — otherwise the screen
      // stays stuck on the Summary even though step 1 is now navigable.
      if (!selectedTabId || (autoSummaryRef.current && summaryTab && selectedTabId === summaryTab.id)) {
        autoSummaryRef.current = false;
        setSelectedTabId(nonSummaryTabs[0].id);
      }
    } else if (!selectedTabId && summaryTab) {
      // Every product tab is locked — fall back to the summary tab so the screen
      // isn't blank (e.g. dealCenterData has no calculator entries yet). Flag it so
      // the branch above can promote to step 1 once a product tab appears.
      autoSummaryRef.current = true;
      setSelectedTabId(summaryTab.id);
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

  // Web parity (dynamic-job-builder.js:325-335 `isRequiredDocumentationComplete`):
  // a Sale requires a signed AGREEMENT, a Demo requires an ORDER SHEET. Web reads
  // `jobState.agreements[].files`; mobile also has server-hydrated `resolvedDocuments`,
  // so accept either a local draft doc OR a persisted one.
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
  // Web parity (dynamic-job-builder.js:500-504): a sale requires the install
  // appointment AND a signed agreement; a demo requires an order sheet. Logic lives
  // in the unit-tested `finalize-gate` module.
  const canComplete = useMemo(() => canCompleteJobBuilder(gateInput), [gateInput]);
  const finalizeBlockedReason = useMemo(() => computeFinalizeBlockedReason(gateInput), [gateInput]);

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

  // The current step's index in the STEPPER's own list (allNonSummaryTabs + summary).
  // NOTE: this is a different index space from `currentTabIndex`, which is relative
  // to `nonSummaryTabs` (available/unlocked only) — mixing them misaligns whenever a
  // vertical has locked tabs. `tabProgress` and `handleGoToTab` both use this space.
  const currentStepIndex = useMemo(() => {
    if (!currentTab) return -1;
    if (summaryTab && currentTab.id === summaryTab.id) return allNonSummaryTabs.length;
    return allNonSummaryTabs.findIndex((t: any) => t.id === currentTab.id);
  }, [allNonSummaryTabs, summaryTab, currentTab]);

  const handleGoToTab = useCallback(
    (index: number) => {
      // Web parity (dynamic-job-builder.js): the rep can't skip ahead past a step
      // with incomplete required fields. Web's ProgressTracker takes no click
      // handler at all — its stepper is display-only and Next (gated on
      // `canProceed`) is the only way forward. Mobile keeps the stepper tappable,
      // so it's gated by the SAME rule instead: backward is always allowed;
      // forward requires the current step to be complete AND every step jumped
      // over to be complete (locked steps aren't applicable, so they don't block).
      // Deal-edit mode moves freely — web parity ("the rep may move through every
      // step freely" in edit mode), which `canProceed` already reflects.
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
      isCompletingRef.current = true;
      setIsSaving(true);

      activityLog.logSubmit(jobState);

      // Web parity (TabbedCalculator.js:923 logRolloutDropSummaryOnSubmit): emit the
      // aggregate rollout/drop summary on the dynamic submit too — previously only the
      // regular JobBuilder fired it, so the dynamic flow logged job_builder_completed
      // without its companion rollout_and_drop_summary event.
      try {
        const rdForSummary = (calculatorResultData || {}) as any;
        const rawCalc = rdForSummary.LFCalculator && Object.keys(rdForSummary.LFCalculator).length
          ? rdForSummary.LFCalculator
          : null;
        // The summary reads `selectedCalculator._id` / `.appointmentId`, but the
        // in-memory CalcTab carries `id` (no `_id`). Without this map the summary log
        // ships `calculatorId: undefined`, so the portal can't group it under the
        // right calculator. Normalize to the backend shape.
        const selectedCalc = rawCalc
          ? {
              ...rawCalc,
              _id: rawCalc._id || rawCalc.id,
              appointmentId: rawCalc.appointmentId || appointmentId || rdForSummary.selectedAppointmentId,
            }
          : null;
        const uid = authUser?._id || authUser?.id;
        if (uid && leadId && selectedCalc) {
          await logRolloutAndDropSummary({
            userId: uid,
            leadId,
            allCalculators: [selectedCalc],
            selectedCalculator: selectedCalc,
            leadData: rdForSummary,
            isLowesLead: Boolean((initialConfig as any)?.lowesLead) || Boolean(rdForSummary?.isLowesLead),
          });
        }
      } catch (e) {
        console.warn('[DynamicJobBuilder] rollout summary log failed:', e);
      }

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

      // NOTE: the calculator-scoped outcome (`PUT /outcome/{calcId}`) is deliberately
      // NOT written here. That endpoint is owned by the agreement/doc-save path; the
      // debounced autosave has already persisted the identical `dynamicJobState` to
      // it, and finalizing through it again produced a duplicate outcome row per
      // completed job. The submitted state is persisted below by the /job-builder
      // POST and the lead-scoped outcome mirror, which a reopen also reads.

      // Documents are NOT sent with the /job-builder POST. handleUploadDocs already
      // uploaded the agreement/order-sheet to the outcome eagerly when it was signed,
      // and the backend files those outcome documents into JobBuilderDocument itself
      // (what the resulted contract reads via `lead.jobBuilderDocuments`). Re-sending
      // them here as an explicit top-level `agreements`/`orderSheets` array produced a
      // SECOND JobBuilderDocument row for the same PDF — the "two agreements submitted"
      // bug. The amendment (edit) view, which was the real gap, is fixed separately by
      // hydrating `resolvedDocuments` from the parent's outcome (`rawDocsOverride`),
      // not by re-uploading here.

      // POST /lead/v1/{leadId}/job-builder REQUIRES top-level `leadData` AND
      // `jobState` (web TabbedCalculator payload). The previous
      // `{ jobBuilder, ...resultData }` shape 400'd with
      // "Both leadData and jobState are required in the request body".
      const rd = (calculatorResultData || {}) as any;
      const result = isSale ? 'Sale' : 'Demo';
      // Web parity: the outcome uses `paymentMethod` for the down payment method
      // (not `downPaymentMethod` as in the result modal's state). Map them here so
      // the spread of `...rd` doesn't send the wrong key name.
      // Also strip `LFCalculator`: mobile attaches the in-memory `CalcTab` for the
      // local rollout/drop activity summary, but that tab lacks the backend
      // subdocument's required `createdBy`/`appointmentId` — spreading it into these
      // saves 500s the backend ("Validation failed: LFCalculator.createdBy is
      // required, ..."). Re-add only a full backend doc; otherwise omit (stored null).
      const { downPaymentMethod: _dpm, LFCalculator: _rawLF, ...rdWithoutDpm } = rd;
      const validLFCalculator =
        _rawLF && typeof _rawLF === 'object' && _rawLF.createdBy && _rawLF.appointmentId && _rawLF.title
          ? _rawLF
          : undefined;
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
          ...(validLFCalculator && { LFCalculator: validLFCalculator }),
        },
        jobState: dynamicJobState,
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
            ...(validLFCalculator && { LFCalculator: validLFCalculator }),
          };
          // Documents are deliberately NOT attached here. `agreementsPayload` /
          // `orderSheetsPayload` were just READ BACK from this very endpoint via
          // downloadOutcomeDocuments — they already exist as LeadOutcomeDocument
          // rows, uploaded eagerly by handleUploadDocs when the agreement was
          // signed. Re-sending them inserts a SECOND row for the same file, which
          // is why the lead dashboard listed each agreement twice. They still go to
          // the /job-builder POST above, which populates the separate
          // JobBuilderDocument collection. This mirror carries FIELDS only.
          await LeadService.updateLeadOutcome(leadId, outcomePayload);
        } catch (e) {
          console.warn('[DynamicJobBuilder] outcome mirror save failed:', e);
        }
      }

      // Web parity: mark the lead's timeline milestones complete now that the job is
      // built. The web static flow does this in two steps — result-lead-modal.js:3189
      // sets `leadResulted: "completed"` and job-builder-modal.js:2980 sets
      // `jobBuild: "complete"`. The dynamic deal-center flow only ever set
      // `leadResulted: "active"` on the Sale/Demo pick and never flipped it to
      // completed, so the PORTAL timeline kept showing the lead result "in progress".
      // Flip both (plus salesProcess) here so the portal renders the milestone as
      // Complete — the same statuses the mobile regular flow writes (useDealOutcome.ts).
      if (leadId) {
        try {
          await LeadService.updateLeadTimelineProgress(leadId, {
            salesProcess: 'completed',
            leadResulted: 'completed',
            jobBuild: 'complete',
          });
        } catch (e) {
          console.warn('[DynamicJobBuilder] timeline progress complete failed:', e);
        }
      }

      if (onJobComplete) {
        onJobComplete(initialConfig, jobState);
      }
    } catch (error) {
      console.error('[DynamicJobBuilder] Completion failed:', error);
      // Completion aborted — re-enable autosave so further edits are still persisted
      // and a retry behaves normally. On success the flag stays set: the screen is
      // navigating away and must not fire a trailing calculator-scoped PUT.
      isCompletingRef.current = false;
      Alert.alert('Error', 'Failed to complete the job. Please check your connection.');
    } finally {
      setIsSaving(false);
    }
  }, [jobState, initialConfig, calculatorResultData, leadId, calcId, dealCenterData, isSale, onJobComplete, canComplete, activityLog, isEdit, appointmentId, authUser]);

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
          />
        </View>

        {/* The renderer owns its own scroll now (fixed footage tracker + inner
            ScrollView, like the normal JB sections); the summary tab scrolls itself.
            So there is no outer ScrollView here — that keeps the tracker pinned.
            Keyboard avoidance is handled by each inner ScrollView via
            `automaticallyAdjustKeyboardInsets` (iOS) + Android `adjustResize`, so
            the focused input scrolls above the keyboard. A padding-based
            KeyboardAvoidingView here would instead just shrink the ScrollView above
            the keyboard, leaving a low field below the fold and hidden (this ticket). */}
        <View style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
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
              schemas={calculatorSchemas || initialConfig?.schemas || []}
              // Web `useDealEditMode()`: drops the Required gates when editing an
              // already-resulted deal.
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
            />
          ) : (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ color: '#94A3B8', fontSize: 14 }}>
                Select a tab to begin
              </Text>
            </View>
          )}
        </View>

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
