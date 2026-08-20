import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
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
import { describeAgreementDelivery, AgreementSent } from '../../utils/agreement-delivery';
import { LeadService } from '../../services/api/leads';
import { useDynamicJobBuilderActivityLog } from './hooks/useDynamicJobBuilderActivityLog';
import { buildCalculatorOutcomePayload } from './utils/build-outcome-payload';
import {
  loadResolvedOutcomeDocuments,
  fetchOutcomeDocumentRows,
  fetchOutcomeDocumentRowsWithDelivery,
  pollAgreementDelivery,
  resolveOutcomeDocRows,
  dropUnnamedAgreements,
} from './utils/outcome-documents';
import { buildDocumentPayloads } from './utils/document-payloads';
import { canCompleteJobBuilder, finalizeBlockedReason as computeFinalizeBlockedReason } from './utils/finalize-gate';
import { useAuth } from '../../hooks/useAuth';
import { logRolloutAndDropSummary } from '../../utils/activity-log/rollout-summary';
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
} from './utils/saved-job-build';
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
  /**
   * Web `skipDraftState` (JobBuilderContext) / `jobBuilderData.startFresh`.
   *
   * REHASH only: the rep was offered the calculator's existing build and chose to
   * rebuild from scratch, so the saved outcome is still fetched (documents, and the
   * record the save writes back to) but its `dynamicJobState` is NOT applied.
   * Meaningless outside a rehash, where there is no prompt and reuse is the behaviour.
   */
  startFresh?: boolean;
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

/**
 * Normalize `scheduleTime` for the SUBMIT payload — web parity with
 * `appointment-scheduler.js`, which emits the raw calendar `Date` (→ ISO on the wire)
 * and never attaches a `reason` to a dated slot:
 *   - a dated appointment's `date` is kept in the display form (`M/d/yyyy`) on the
 *     in-memory state for the summary UI, but the payload sends it as an ISO datetime;
 *   - its `reason` (always null for a dated slot — that field is TBD-only) is dropped;
 *   - a `TBD` appointment is passed through unchanged (it legitimately carries a reason).
 * The calendar day is preserved: a bare `M/d/yyyy` is rebuilt at LOCAL noon (like web's
 * local `Date`), so `toISOString()` round-trips to the same day in the rep's timezone
 * instead of rolling back a day the way UTC-midnight would in negative-offset (US) zones.
 */
function normalizeScheduleTimeForSubmit(scheduleTime: any): any {
  if (!scheduleTime || typeof scheduleTime !== 'object') return scheduleTime;
  const { date } = scheduleTime;
  if (!date || date === 'TBD') return scheduleTime;

  const str = String(date);
  let iso = str;
  const mdy = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    const [, mm, dd, yyyy] = mdy;
    // Local noon → a ±12h margin so the UTC date-part stays on the picked day.
    iso = new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0, 0).toISOString();
  } else {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) iso = parsed.toISOString();
  }

  // Drop the (null) `reason` on a dated slot; keep customerName/timeWindow/etc.
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
  onJobComplete,
  onGoBack,
  mode = 'new',
  startFresh = false,
  initialJobState: initialJobStateProp,
  portalUnrestrictedEdit: portalUnrestrictedEditProp,
  hideAllocationTrackers: hideAllocationTrackersProp,
  appointmentId,
  embedded = false,
  scheduleTimeOverride,
  // `rawDocsOverride` (savedOutcome.jobBuilderDocuments) is intentionally NOT consumed:
  // it is not pruned when a rep deletes a document, so it would resurrect removed
  // agreements. Edit-mode docs come from `downloadOutcomeDocuments` (web parity).
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
    queryKey: ['leadOutcome', leadId, calcId, startFresh],
    queryFn: async () => {
      try {
        const res = await LeadService.getLeadOutcomeByCalculator(leadId!, calcId);
        // Unwrap + locate the saved state through the shared helper, so the rehash
        // "Use Existing / Start Fresh" pre-check keys off exactly the same rule.
        const outcome = extractCalculatorOutcome(res.data);
        const savedState = extractSavedJobBuildState(outcome);

        // Deserialize storage-keys → runtime ids with the SAME config web used to
        // serialize (deserializeDynamicJobStateFromStorage). Idempotent for legacy
        // raw saves — keys without the `__` storage marker pass through unchanged —
        // so both web-written and old-mobile-written state rehydrate correctly.
        //
        // `startFresh` (web `skipDraftState`) drops it: on a rehash the rep answered
        // "Start Fresh", so the outcome is still read — the documents query below and
        // the record we save back to stay linked — but the prior build is NOT applied.
        const jobState =
          savedState && typeof savedState === 'object' && !startFresh
            ? deserializeDynamicJobStateFromStorage(savedState, initialConfig)
            : undefined;

        // Return the draft state IMMEDIATELY. Documents are resolved by a SEPARATE
        // query (below) which re-reads this same endpoint — this one must not await
        // the signed-URL round-trip, or `initialJobState` (the draft) can't reach the
        // session until the whole doc chain settles. That is the "reopen shows empty,
        // then fills in a moment later" the rep sees.
        return { initialJobState: jobState };
      } catch {
        return { initialJobState: undefined };
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

  // Documents resolve in a SEPARATE, non-blocking query — resolving S3 refs to signed
  // URLs is the slow work that used to gate draft hydration, so it never delays the
  // draft and a doc failure leaves the previously-set documents untouched.
  //
  // Non-edit (create/reopen) path only: reads `leadOutcomeDocuments` from the
  // CALCULATOR-scoped outcome. Edit mode does NOT use this — it reads documents
  // lead-scoped via `downloadOutcomeDocuments` below (web parity, see that query).
  // Feeding the parent's `rawDocsOverride` (savedOutcome.jobBuilderDocuments) here
  // showed agreements the rep had already DELETED: that field is not pruned on delete,
  // whereas the outcome read reflects deletions.
  const { data: resolvedDocumentsData } = useQuery({
    queryKey: ['leadOutcomeDocs', leadId, calcId],
    queryFn: () => loadResolvedOutcomeDocuments(leadId, calcId),
    // Runs once the draft's outcome GET has landed, and NEVER in edit mode — edit
    // fetches docs lead-scoped via `editDocsData` below (web parity).
    enabled: Boolean(leadId && calcId) && !isEdit && isOutcomeFetched,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  // EDIT-mode documents — the previously-submitted agreement / order-sheet PDFs.
  //
  // Web parity (`dynamic-deal-edit-modal.js` lines 415, 483-524): the edit modal reads
  // documents with `downloadOutcomeDocuments(leadId)` — the LEAD-scoped endpoint that
  // returns each doc with its base64 body — and builds `{ agreements, orderSheets }`
  // display rows from it. This is the source of truth that REFLECTS DELETIONS: when a
  // rep removes an agreement, it disappears here (and on web), unlike the outcome's
  // `jobBuilderDocuments` mirror which is not pruned. Reading that mirror is what made
  // the mobile summary keep showing a deleted agreement. `leadId` is always present,
  // so this does not depend on a (possibly null) `calcId`.
  const { data: editDocsData } = useQuery({
    queryKey: ['editOutcomeDocs', leadId],
    queryFn: async () => {
      const empty = { agreements: [] as any[], orderSheets: [] as any[] };
      try {
        const res = await LeadService.downloadOutcomeDocuments(leadId!);
        const body: any = res?.data;
        const docs = body?.data ?? body ?? {};
        // Mirror web `toFile`: prefer the base64 body as a data-URI, else any URL.
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
          // Filtered on the RAW rows — `toDisplay` defaults the name below
          // (`d?.name || 'Agreement'`), which erases the only thing that marks the
          // backend's duplicate submit row. Order sheets are legitimately unnamed
          // here, so they are NOT filtered.
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
    // Web parity (`stateResetKey`): restore the saved draft ONCE per calculator
    // session, exactly like web's `beginSession` → `loadCalculatorDraft` → one
    // `setStateRestoreKey` bump. Keyed by (leadId, calcId) rather than the fetched
    // object so that:
    //   • the draft ALWAYS applies on first load, even if something wrote to job state
    //     while the outcome GET was still in flight (the blank-tab bug), and
    //   • later refetches of this same outcome (e.g. the invalidation after a document
    //     upload) do NOT restore over the rep's in-progress edits.
    // Edit mode keeps its existing behaviour — its state arrives as a prop.
    draftToken: isEdit ? undefined : `${leadId || ''}:${calcId || ''}`,
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

  // Edit mode: mirror the lead-scoped `downloadOutcomeDocuments` result into the
  // display state (web parity). Keyed separately from the non-edit path so exactly
  // one populates per mode, and this one reflects deletions.
  useEffect(() => {
    if (editDocsData) {
      setResolvedDocuments(editDocsData);
    }
  }, [editDocsData]);

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
    // Edit mode is reached only from My Deals (Deal Detail → Edit), so its wizard
    // events log under `module_type: 'my_deal'` (web deal-edit parity), not job_builder.
    isDealEdit: isEdit,
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
      // Documents ride ALONG WITH the draft — do NOT strip them.
      //
      // Web keeps its agreements / order sheets at `jobState.agreements` /
      // `.orderSheets` (`dynamic-job-builder.js#handleAgreementDocumentsChange` →
      // `makeJobBuilderDocsDurableForDraft`), and the storage serializer passes both
      // keys through verbatim (`ROOT_PASSTHROUGH_KEYS`). That draft copy is what the
      // summary renders (`existingAgreements={jobState?.agreements}`) — on web AND on
      // mobile. Stripping them here meant every 2s autosave OVERWROTE the saved draft
      // with a doc-less copy, so a web-attached agreement disappeared from the deal on
      // the next open, and a mobile-attached one was never visible to web at all.
      const dynamicJobState = serializeDynamicJobStateForStorage(jobState || {}, initialConfig, dealCenterData);
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

  // ─── Empty-step gate (My Deals / deal-edit only) — web dynamic-job-builder.js ──
  // In deal-edit, a step with no REP-entered data is surfaced with a soft
  // "Add details / Skip" prompt rather than dropping straight into a blank form.
  // Calculator-seeded (locked) values don't count as content — see `stateHasContent`.
  const lockedFieldIds = useMemo(() => collectLockedFieldIds(initialConfig), [initialConfig]);
  // Steps the rep chose to fill ("Add details") — so the gate doesn't reappear on
  // the same step after they open it. Per-session, cleared on unmount (web parity).
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

  // ─── Clear-step (reset current tab) — web `dynamic-job-builder.js` handleClearTab ──
  // A red reset button in the footer wipes every selection/measurement on the ACTIVE
  // tab back to its fresh initial state (deal-center-seeded locked fields kept, so
  // combinations/sections re-hydrate as blank editable rows), behind a confirm dialog.
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
    // Keep the empty-step gate suppressed so the rep lands on the blank editable form
    // right after clearing (not the "No details yet" prompt).
    setGateDismissed((prev) => {
      const next = new Set(prev);
      next.add(currentTab.id);
      return next;
    });
    setClearConfirmOpen(false);
  }, [selectedVertical, currentTab, initialConfig, dealCenterData, updateTabState]);

  // ─── Skip-all (jump straight to the Summary step) ─────────────────────────────
  // A footer icon that jumps from any build step directly to the final Summary tab,
  // bypassing the intermediate steps. Only in deal-edit (movement is unrestricted
  // there — `portalUnrestrictedEdit`), and only when a Summary tab exists and isn't
  // already the active step. Jumps by setting the tab directly (not `handleGoToTab`)
  // so no completion gate blocks it.
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

      // In edit mode both of these are job_builder-module events that would land in the
      // middle of a `my_deal` addendum edit. `logSubmit` is already suppressed in the
      // hook when editing, and the rollout/drop summary is skipped here — web's deal-edit
      // flow fires neither; the wrapper fires `addendum_submitted` instead.
      activityLog.logSubmit(jobState);

      // Web parity (TabbedCalculator.js:923 logRolloutDropSummaryOnSubmit): emit the
      // aggregate rollout/drop summary on the dynamic submit too — previously only the
      // regular JobBuilder fired it, so the dynamic flow logged job_builder_completed
      // without its companion rollout_and_drop_summary event.
      if (!isEdit) try {
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
          // ⚠️ NOT awaited — exact web parity. Web fires this without `await`
          // (TabbedCalculator.js:1103) and mobile used to block the ENTIRE submit on
          // it, as the very first step: a full activity-log round trip before the job
          // was even sent. Nothing reads the summary synchronously, so awaiting it
          // only added latency to "Complete Job".
          logRolloutAndDropSummary({
            userId: uid,
            leadId,
            allCalculators: [selectedCalc],
            selectedCalculator: selectedCalc,
            leadData: rdForSummary,
            isLowesLead: Boolean((initialConfig as any)?.lowesLead) || Boolean(rdForSummary?.isLowesLead),
          }).catch((e) => console.warn('[DynamicJobBuilder] rollout summary log failed:', e));
        }
      } catch (e) {
        console.warn('[DynamicJobBuilder] rollout summary log failed:', e);
      }

      // scheduleTime rides inside jobBuilder (web parity); installDate/timeWindow
      // are also surfaced flat. The agreement / order-sheet entries stay ON the
      // state: they are durable server REFERENCES (serverId + filePath, resolved by
      // handleUploadDocs), not base64 bodies, so nothing is re-uploaded and nothing
      // trips the backend's "file required" validation — they simply keep the
      // submitted record pointing at the documents, exactly like web's serialized
      // `jobState` does (`ROOT_PASSTHROUGH_KEYS`).
      // Serialize once (runtime ids → storage keys) — reused by both the outcome
      // finalize PUT and the /job-builder POST so both persist the identical state.
      const dynamicJobState = serializeDynamicJobStateForStorage(
        jobState || {},
        initialConfig,
        dealCenterData
      );
      // Send the appointment as an ISO datetime and without the dated-slot `reason:null`
      // (web parity). Reassigns a NEW object on the serialized copy only — the in-memory
      // `jobState.scheduleTime` keeps its display form for the summary UI.
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

      // Documents for the /job-builder POST — web parity (TabbedCalculator finalize).
      // Web converts every file on `jobState.agreements` / `.orderSheets` to a base64
      // PDF and submits them at the top level alongside the serialized jobState; mobile
      // now does the same (`buildDocumentPayloads`). Note this is the JobBuilderDocument
      // collection — the LeadOutcomeDocument rows were already created eagerly by
      // handleUploadDocs / the sign endpoint, which is why the outcome mirror below
      // still sends FIELDS ONLY.
      const documentPayloads = await buildDocumentPayloads({
        agreements: jobState?.agreements,
        orderSheets: jobState?.orderSheets,
        leadId,
        isSale,
        // Web parity: submit the signed agreement too (read from its local file://
        // copy) so the lead-scoped outcome write below populates jobBuilderDocuments.
        includeSystemGenerated: true,
      });

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
          // `POST /lead/v1/{leadId}/job-builder` reads the calculator from the
          // LOWERCASE `lfCalculator` key (LeadHandler.submitJobBuilder). The uppercase
          // `LFCalculator` the frontend historically sent is SILENTLY IGNORED, so the
          // calculator never landed on the submitted job. Send lowercase (what the
          // handler reads) and keep uppercase for any consumer still reading it.
          ...(validLFCalculator && {
            lfCalculator: validLFCalculator,
            LFCalculator: validLFCalculator,
          }),
        },
        jobState: dynamicJobState,
        isDynamic: true,
        configId,
        configSnapshotId: configId || 'dynamic',
        // Web parity (TabbedCalculator `action === 'complete'`): the submit carries the
        // documents at the TOP LEVEL as base64 PDFs — `{ name: '', file, type }` — next
        // to the serialized jobState, with BOTH keys always present. Built from
        // jobState.agreements / .orderSheets, and on a non-Sale result the agreements
        // are filed as order sheets (web's `data.leadData?.result === 'Sale'` branch).
        agreements: documentPayloads.agreements,
        orderSheets: documentPayloads.orderSheets,
      };

      // Full Complete-Job payload (POST /lead/v1/{leadId}/job-builder). The document
      // bodies are elided — stringifying multi-MB base64 for a log line is exactly the
      // kind of heap spike that used to crash Submit.
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
      // The outcome endpoint is calculator-scoped, so without an id there is nothing
      // to write to — skip rather than falling back to the removed lead-scoped route.
      const outcomeCalcId = calcId || rd.calculatorId || null;
      if (leadId && outcomeCalcId) {
        try {
          const outcomePayload: Record<string, any> = {
            ...rdWithoutDpm,
            paymentMethod: rd.downPaymentMethod,
            result,
            status: result,
            selectedCalculatorId: outcomeCalcId,
            selectedAppointmentId: rd.selectedAppointmentId || leadId,
            jobBuilder: jobBuilderWrapper,
            ...(validLFCalculator && { LFCalculator: validLFCalculator }),
            // ⚠️ The base64 agreements / order sheets are DELIBERATELY NOT ATTACHED here.
            // This is a considered divergence from web (TabbedCalculator.js L1073-1074),
            // because MOBILE FILES ITS DOCUMENTS EAGERLY and web does not:
            //
            //   • a scanned doc is filed the moment it is added, by `handleUploadDocs`
            //     (PUT /lead/v1/{id}/outcome/{calcId}) — "that is what creates the
            //     LeadOutcomeDocument rows";
            //   • a generated agreement is filed by the /sign endpoint, which writes its
            //     OWN LeadOutcomeDocument.
            //
            // So by submit time every document is ALREADY a LeadOutcomeDocument row, and
            // re-sending the bytes here did not "upsert by file" as the old comment
            // claimed — it filed a SECOND row. That is the duplicate agreement reported
            // earlier: same `fileData.size` and same `base64Data`, distinct `_id` and
            // `filePath`, and an EMPTY `name` — because `buildDocumentPayloads` sends
            // `name: ''`. The two rows in that trace are 35 s apart
            // (…851569 at sign time, …886943 at submit), which is this write.
            //
            // Dropping them fixes the duplicate at its source and removes a multi-MB
            // upload from "Complete Job" (the reporter's trace: 27 requests, 308 MB).
            //
            // ⚠️ Do NOT remove the CALL itself. It is the only write that persists the
            // outcome FIELDS — contract price, down payment, oneLeg, reason, explain,
            // payment methods, LFCalculator — to LeadOutcome; the eager calculator-scoped
            // PUT sends only { result, status, selectedCalculatorId, jobBuilder, docs }.
            // Those fields are what Contract Details renders.
          };
          // Fields only now — no document bodies to elide (see above).
          console.log(
            `[COMPLETE JOB — OUTCOME MIRROR PAYLOAD] PUT /lead/v1/${leadId}/outcome\n` +
              JSON.stringify(outcomePayload, null, 2)
          );
          // Calculator-scoped PUT /lead/v1/{leadId}/outcome/{calcId}. The bare
          // lead-scoped variant this used to call is DEPRECATED and 404s on device.
          await LeadService.updateLeadOutcomeByCalculator(leadId, outcomeCalcId, outcomePayload);
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
      //
      // ⚠️ NOT awaited. These are PORTAL milestone flags — nothing the rep is about to
      // see reads them, and this was the last blocking round trip before navigation,
      // so awaiting it delayed "Complete Job" for no user-visible benefit. Web makes
      // no equivalent call here at all. The request is not cancelled by navigating:
      // nothing aborts it and the JS context outlives this screen.
      if (leadId) {
        LeadService.updateLeadTimelineProgress(leadId, {
          salesProcess: 'completed',
          leadResulted: 'completed',
          jobBuild: 'complete',
        }).catch((e) => console.warn('[DynamicJobBuilder] timeline progress complete failed:', e));
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
  // (matches the working normal JB SummarySection payload). Resolves to the
  // category's documents as the server now holds them, or null if the save failed.
  const handleUploadDocs = useCallback(
    async (cat: 'agreement' | 'orderSheet', payloads: any[]) => {
      if (!leadId || !payloads?.length) return null;
      try {
        const rootKey = cat === 'agreement' ? 'agreements' : 'orderSheets';
        // The NEW base64 payloads go at the TOP LEVEL of this PUT — that is what
        // creates the LeadOutcomeDocument rows. The draft copy under
        // `jobBuilder.dynamicJobState` is serialized from the state as-is, documents
        // included, so this write never blanks the documents already recorded there
        // (see performAutoSave for why that matters).
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
        // Document-submit payload (PUT /lead/v1/{leadId}/outcome/{calcId}).
        //
        // ⚠️ The base64 PDF bodies are ELIDED, exactly as the Complete-Job and
        // outcome-mirror logs below already do. This one was missed, and it was the
        // single largest cost in an order-sheet upload: pretty-printing a multi-MB
        // base64 string and pushing it to the console took SECONDS on the JS thread
        // (far worse with DevTools attached, where the whole string crosses the CDP
        // bridge). Never stringify a document payload in full.
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

        // Re-sync from the server (web `DocumentUploadDialog.syncFromServer`): read
        // the lead's document rows back and resolve them to signed URLs. The caller
        // stores THESE in `jobState.<rootKey>` so the draft carries durable,
        // cross-platform references (serverId + filePath) instead of a device-local
        // `file://` path — which is what lets web render a mobile-attached agreement
        // and lets a later delete actually reach the server (it needs the serverId).
        const rows = await fetchOutcomeDocumentRows(leadId, calcId);
        const resolved = await resolveOutcomeDocRows(rows);
        return resolved[rootKey] || [];
      } catch (e) {
        console.warn('[DynamicJobBuilder] doc upload failed:', e);
        return null;
      }
    },
    [leadId, calcId, jobState, initialConfig, dealCenterData, calculatorResultData]
  );

  // Re-read the lead's stored documents WITHOUT uploading anything. Used after the
  // server-side agreement sign, which files its own LeadOutcomeDocument — adopting
  // that row is what keeps a generated agreement from being stored twice.
  // Tell the rep whether the customer actually RECEIVED their copy.
  //
  // Reported HERE rather than in `AgreementSignatureModal`, which is the obvious-looking
  // place and cannot do it: `/sign` returns the PDF as a BLOB, so that modal never sees a
  // JSON body. The outcome read below is the first response after signing that carries
  // the `agreementSent` block.
  //
  // ⚠️ `agreementSent` PERSISTS on the outcome record and describes the LAST send, so it
  // is only meaningful right after a signature. This is reachable from ONE place — the
  // adopt branch of `handleAgreementGenerated` via `onRefreshDocs` — which is what keeps
  // the notice tied to the signature rather than re-announcing an old failure.
  const notifyAgreementDelivery = useCallback(
    async (firstRead: AgreementSent | null) => {
      // The send and the document filing do NOT always land together, so a block that is
      // absent on the first read is not proof there was none — `pollAgreementDelivery`
      // spends up to two more cheap reads before giving up, and nothing at all when the
      // first read already had it.
      const sent = firstRead || (await pollAgreementDelivery(leadId, calcId));
      const notice = describeAgreementDelivery(sent);
      if (__DEV__) {
        // A missing notice used to be indistinguishable from "the code never ran" — the
        // same trap as the pitch-book list. Say which it was.
        console.log(
          `[agreementDelivery] lead=${leadId || '—'} calc=${calcId || '—'} ` +
            `block=${sent ? JSON.stringify(sent) : 'ABSENT'} ` +
            `notice=${notice ? `${notice.type}: ${notice.title}` : 'none'}`
        );
      }
      if (!notice) return;
      // Replaces the signature modal's own "Agreement signed successfully" — deliberately,
      // and the reason this title repeats that the agreement was signed. One banner, both
      // facts; a second `show()` would simply wipe the first. See `agreement-delivery.ts`.
      if (notice.type === 'warning') {
        FlashMessage.warning(notice.title, notice.description, notice.duration);
      } else {
        FlashMessage.success(notice.title, notice.description, notice.duration);
      }
    },
    [leadId, calcId]
  );

  const handleRefreshDocs = useCallback(
    async (cat: 'agreement' | 'orderSheet') => {
      if (!leadId || !calcId) {
        // Both are required by the calculator-scoped outcome route; without them there is
        // nothing to read, and this used to return in silence.
        if (__DEV__) {
          console.log(
            `[agreementDelivery] SKIPPED — leadId=${leadId || 'MISSING'} calcId=${calcId || 'MISSING'}`
          );
        }
        return null;
      }
      // Same read as before — it now ALSO hands back `agreementSent`, the SMS / email
      // result for the copy the customer was just sent. No extra request.
      const { rows, agreementSent } = await fetchOutcomeDocumentRowsWithDelivery(leadId, calcId);

      // NOT awaited: the retry can take a few seconds and the document adopt below must
      // not wait on a notification. Detached, so a failure here can never break signing.
      notifyAgreementDelivery(agreementSent).catch(() => {});

      const resolved = await resolveOutcomeDocRows(rows);
      return resolved[cat === 'agreement' ? 'agreements' : 'orderSheets'] || [];
    },
    [leadId, calcId, notifyAgreementDelivery]
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
            // Trimmed from 24 → 8: the stepper carried a tall empty white band below
            // the Gutters/LeafFilter/… pills before the content card. 8 keeps the
            // pills clear of the divider without the extra padding.
            paddingBottom: 8,
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
            // Deal-edit: the stepper is display-only (web parity) — the rep advances
            // only via the bottom Next button, not by tapping Gutters/LeafFilter/etc.
            disableNavigation={isEdit}
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
          {currentTab && showEmptyGate ? (
            // Deal-edit: this step has no rep-entered data. Prompt to add or skip
            // instead of showing a blank form (web dynamic-job-builder.js:749).
            <EmptyStepGate
              stepLabel={currentTab.label || 'this step'}
              onAddDetails={dismissGate}
              onSkip={handleNext}
            />
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
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
            {showClearButton && (
              <TouchableOpacity
                onPress={() => setClearConfirmOpen(true)}
                accessibilityLabel="Clear this step"
                style={{
                  width: 40,
                  height: 36,
                  borderRadius: 8,
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
                  width: 40,
                  height: 36,
                  borderRadius: 8,
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
