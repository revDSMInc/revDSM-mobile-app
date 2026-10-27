import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  subMonths,
  addMonths,
  isSameDay,
  startOfToday,
} from 'date-fns';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useDynamicCalculatorSchemas } from '../hooks/useDynamicCalculatorSchemas';
import { useCalculatorSchema } from '../hooks/useCalculatorSchema';
import { useDealPricing } from '../hooks/useDealPricing';
import { DynamicJobBuilderScreen } from '../DynamicJobBuilderScreen';
import { buildDealCenterData } from '../utils/build-deal-center-data';
import { isDealEditLoading } from '../utils/deal-edit-gate';
import { extractDynamicJobState } from '../utils/enrich-job-builder-data';
import {
  serializeDynamicJobStateForStorage,
  deserializeDynamicJobStateFromStorage,
  hydrateJobStateForPersistence,
} from '../../../utils/dynamic-job-builder/engine/dynamic-job-state-storage';
import {
  clampToCostFloor,
  computeEditedTiers,
  resolveTierPaymentMethod,
  getMarkupInfo,
  parsePrice,
  type Tiers,
} from '../utils/dynamic-deal-pricing';
import {
  computeDynamicBuildChanges,
  groupComboRows,
  type BuildChangeKind,
  type ComboBlock,
} from '../utils/dynamic-deal-diff';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';
import { useAuth } from '../../../hooks/useAuth';
import { useIsOnline } from '../../../hooks/useIsOnline';
import {
  useInstallAvailability,
  useInstallCalendarAvailability,
  useOfferedWindows,
  windowInfo,
  windowNotice,
} from '../../../hooks/useInstallAvailability';
import { bookInstallSlot } from '../../../services/api/installAvailability';
import { formatInstallDateForDisplay } from '../utils/install-date-format';
import { readOfflineCache, writeOfflineCache } from '../../../utils/offline-query-cache';
import { addendumOfflineBlock } from '../../../utils/offline-addendum';
import {
  ensureOfflineWorkForLead,
  saveOfflineAddendum,
  saveOfflineAddendumRefund,
  saveOfflineFunding,
} from '../../../services/offlineLeadStore';
import { isOnline } from '../../../services/connectivity';
import {
  buildDealEditCache,
  dealEditCacheChanged,
  dealEditCacheName,
  dealEditOfflineState,
  type CachedDealEdit,
} from '../../../utils/offline-deal-edit';
import {
  logDealAddendumSubmitted,
  logDealInstallDateChanged,
  logDealInstallDateModifyOpened,
  logDealInstallDateSelected,
  logDealInstallDateUnchanged,
  logDealInstallWindowsDeclined,
  logDealJobCancelled,
  logDealPriceAutoAdjusted,
  logDealPriceFieldChanged,
  logDealReviewFieldChanged,
  logDealStepViewed,
} from '../../../utils/activity-log/my-deal-log';
import {
  diffScreenValues,
  snapshotScreenValues,
  type ScreenValueChange,
  type ScreenValues,
} from '../../../utils/activity-log/screen-value-diff';
import { formatLocalUSPhone, toE164USPhone } from '../../../utils/phone-util';
import { validateEmail } from '../../../utils/validation';
import { readLeadPhone, readLeadEmail } from '../../../utils/addendum-recipients';
import { toPayloadText } from '../utils/job-submit-payload';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { FUND } from './funding/funding-theme';
import { useRefundApproval } from '../hooks/useRefundApproval';
import { useRefundApprovers } from '../hooks/useRefundApprovers';
import { ConfirmDialog } from './ConfirmDialog';
import { UserPickerModal } from '../../../widgets/modals/UserPickerModal';
import { PaymentRowsGroup } from './funding/PaymentRowsGroup';
import { FundingView } from './funding/FundingView';
import { SendLinkModal } from './funding/SendLinkModal';
import { DropdownChoice } from './funding/DropdownChoice';
import { CoverageBar } from './funding/CoverageBar';
import { BlockerList } from './funding/BlockerList';
import { RefundApproverRow, RefundStatusRail } from './funding/RefundApprovalStatus';
import { useFunding } from '../hooks/useFunding';
import type {
  FundingChannel,
  FundingRecord,
  FundingRefundReason,
} from '../../../services/api/FundingService';
import {
  applyDecisionsToRows,
  assignedTotal,
  attemptLog,
  confirmBlockers,
  refundDueFor,
  isDownPaymentLocked,
  refundBlockers,
  refundableAmount,
  addendumReleasePlan,
  offlineFundingRecord,
  refundsOnJob,
  requiresRefundApproval,
  collectedTotal,
  pickableApprovers,
  REFUND_APPROVAL_WARNING,
  REFUND_REASON_LABELS,
  coverageOK,
  effectiveRowAmount,
  formatStamp,
  fundingBlockers,
  hasDecline,
  hydrateRowsFromRecord,
  inferPayMode,
  inferNoDownPayment,
  payStructureOf,
  isLocalArchive,
  MULTI_METHOD_ENABLED,
  needsAttentionRowId,
  newPaymentId,
  canRestoreEntry,
  findShelfEntry,
  findApprovedArchive,
  restoreRowPlan,
  withSettledRows,
  swapRowMethod,
  paymentAllocations,
  structureHint,
  structureLocked,
  toUpsertRows,
  type DecisionBanner,
  type PaymentKind,
  type PaymentRow,
  type PayMode,
  type PayStructure,
} from '../utils/funding';
import {
  logFundingEditPayments,
  logFundingLinkCopied,
  logFundingMethodSelected,
  logFundingOpened,
  logFundingRowAdded,
  logFundingRowRemoved,
  logFundingStructureChanged,
  resolveFundingSource,
} from '../../../utils/activity-log/funding-log';
import { NUMERIC_KEYBOARD } from '../../../utils/keyboard-type';

const STEP_LABELS = ['Install Date', 'Job Build', 'Job Price', 'Review & Submit'];

const PRICE_ATTENTION_HINT =
  'A lender decision changed what this job can fund — the balance no longer matches what was approved. Re-check the price and the split below.';

const fmtMoney = (n: any) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

const FIELD_LOG_DEBOUNCE_MS = 1000;

function useScreenChangeLog(
  active: boolean,
  values: ScreenValues,
  emit: ((change: ScreenValueChange) => void) | null
) {
  const snapshotRef = useRef<Record<string, string> | null>(null);
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const emitRef = useRef(emit);
  emitRef.current = emit;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const prev = snapshotRef.current;
    const current = valuesRef.current;
    snapshotRef.current = snapshotScreenValues(current);
    const send = emitRef.current;
    if (!send) return;
    diffScreenValues(prev, current).forEach(send);
  }, []);

  useEffect(() => {
    if (!active) {
      if (timerRef.current) flush();
      snapshotRef.current = null;
      return;
    }
    if (snapshotRef.current === null) {
      snapshotRef.current = snapshotScreenValues(values);
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, FIELD_LOG_DEBOUNCE_MS);
  }, [active, values, flush]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return flush;
}

const INSTALL_WINDOWS = [
  { period: 'Morning', value: '8:00 AM - 12:00 PM' },
  { period: 'Afternoon', value: '12:00 PM - 4:00 PM' },
];

interface DynamicDealEditScreenProps {
  navigation?: NativeStackNavigationProp<any>;
  route?: {
    params?: {
      lead?: any;
      calculatorResultData?: any;
      initialVerticalId?: string;
      mode?: 'new' | 'edit';
    };
  };
}

export function DynamicDealEditScreen({ navigation, route }: DynamicDealEditScreenProps) {
  const insets = useSafeAreaInsets();
  const lead = useMemo(() => route?.params?.lead || {}, [route?.params?.lead]);
  const calculatorResultData = route?.params?.calculatorResultData;
  const leadId = lead?._id || lead?.leadId || lead?.id;
  const { user } = useAuth();

  const {
    config: jobBuilderConfig,
    isConfigured: hasJobBuilderConfig,
    isLoading: isConfigLoading,
  } = useDynamicCalculatorSchemas();
  const { configuredSchemas, isLoading: isSchemasLoading, pricingConfig } = useCalculatorSchema();
  const pricing = useDealPricing(lead);

  const [step, setStep] = useState(0);
  const [editedJobState, setEditedJobState] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  const [scheduleTimeWindow, setScheduleTimeWindow] = useState('');
  const [dateStep, setDateStep] = useState<'intro' | 'calendar' | 'time' | 'success'>('intro');
  const [proposedDate, setProposedDate] = useState<Date | null>(null);
  const [proposedSlotIdx, setProposedSlotIdx] = useState(0);
  // "Yes" books the time (REVDSM-1300); a counter re-asks the scheduler when a time was just taken.
  const [installBooking, setInstallBooking] = useState(false);
  const [installAvailabilityRefresh, setInstallAvailabilityRefresh] = useState(0);
  // Windows this lead's "Yes" came back `taken` for, on the day being looked at. Cleared
  // whenever the day changes — a window full on Monday says nothing about Tuesday.
  const [failedInstallWindows, setFailedInstallWindows] = useState<string[]>([]);

  // What the scheduler says about the chosen day. Until it answers — or if it never
  // does — every window is offered exactly as before.
  const { availability: installAvailability, loading: installAvailabilityLoading } =
    useInstallAvailability(
      proposedDate ? format(proposedDate, 'yyyy-MM-dd') : null,
      lead?._id,
      dateStep === 'time',
      installAvailabilityRefresh,
    );
  const offeredInstallWindows = useOfferedWindows(INSTALL_WINDOWS, installAvailability);
  const currentInstallWindow =
    offeredInstallWindows[proposedSlotIdx] ?? offeredInstallWindows[0] ?? INSTALL_WINDOWS[0];
  const installWindowNotice = windowNotice(windowInfo(currentInstallWindow, installAvailability));

  const [contractPrice, setContractPrice] = useState(0);

  const [priceScreen, setPriceScreen] = useState<'price' | 'funding'>('price');
  const [payMode, setPayMode] = useState<PayMode>('split');
  const [noDown, setNoDown] = useState(false);
  const [structureNudge, setStructureNudge] = useState(false);
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [banners, setBanners] = useState<DecisionBanner[]>([]);
  const [priceUnlocked, setPriceUnlocked] = useState(false);

  const [refundAcknowledged, setRefundAcknowledged] = useState(false);
  const [refundMethod, setRefundMethod] = useState<'card' | 'check' | ''>('');
  const [refundReason, setRefundReason] = useState<FundingRefundReason | ''>('priceDrop');
  const [refundNote, setRefundNote] = useState('');
  const [approverId, setApproverId] = useState('');
  const [showApproverPicker, setShowApproverPicker] = useState(false);
  const [resultChoice, setResultChoice] = useState<'sale' | 'bank_decline'>('sale');
  const [linkTarget, setLinkTarget] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [isLoadingLink, setIsLoadingLink] = useState(false);

  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [note, setNote] = useState('');

  const seededRef = useRef(false);

  /**
   * The snapshot of this deal saved the last time it opened with a connection.
   *
   * ⚠️ Read ONCE, not per render. MMKV reads are synchronous and fast, but this screen
   * re-renders constantly and the payload is a whole job build.
   */
  const online = useIsOnline();
  const ownerId = user?._id || user?.id;
  const cacheName = dealEditCacheName(leadId);
  const cachedRef = useRef<CachedDealEdit | null | undefined>(undefined);
  if (cachedRef.current === undefined) {
    cachedRef.current = cacheName
      ? readOfflineCache<CachedDealEdit>(cacheName, { userId: ownerId || undefined })?.data ?? null
      : null;
  }
  const cachedEdit = cachedRef.current;
  const offlineState = dealEditOfflineState(online, false, cachedEdit);
  const usingCache = offlineState === 'ready';

  const editCalculatorId =
    calculatorResultData?.calculatorId ||
    lead?.selectedCalculatorId ||
    lead?.calculatorId ||
    lead?.jobBuilder?.calculatorId ||
    lead?.outcome?.selectedCalculatorId ||
    lead?.leadData?.selectedCalculatorId ||
    null;

  const { data: savedOutcome, isFetched: outcomeFetched } = useQuery({
    queryKey: ['dealEditOutcome', leadId, editCalculatorId],
    queryFn: async () => {
      // ⚠️ Served from the snapshot INSIDE the queryFn, never via `enabled: false` - a disabled
      // query keeps `isLoading` true forever in v5, which would hang the screen on a spinner.
      if (usingCache) return cachedEdit?.outcome ?? null;
      try {
        const res = editCalculatorId
          ? await LeadService.getLeadOutcomeByCalculator(leadId!, editCalculatorId)
          : null;
        const body = res?.data;
        return body?.data?.outcome ?? body?.outcome ?? body?.data ?? body ?? null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(leadId),
    staleTime: 30_000,
  });

  const { data: fetchedCalculator, isLoading: isCalculatorLoading } = useQuery({
    queryKey: ['dealEditCalculator', editCalculatorId],
    queryFn: async () => {
      if (usingCache) return cachedEdit?.calculator ?? null;
      try {
        const res = await LeadService.getCalculator(editCalculatorId!);
        const body = res.data;
        return body?.data?.calculator ?? body?.data ?? body?.calculator ?? body ?? null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(editCalculatorId),
    staleTime: 30_000,
  });

  const { data: portalRecord, isLoading: isPortalLoading } = useQuery({
    queryKey: ['dealEditPortalJobBuilder', leadId],
    // ⚠️ Caches the RAW response, because line ~380 reads `portalRecord?.portalJobBuilder` off
    // it. Unwrapping here would silently change the shape the screen seeds from.
    queryFn: async (): Promise<any> =>
      usingCache
        ? (cachedEdit?.portalJobBuilder as any) ?? null
        : leadId
          ? LeadService.getPortalJobBuilder(leadId)
          : null,
    enabled: Boolean(leadId),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const sched = lead?.jobBuilder?.scheduleTime || lead?.jobBuilderData?.scheduleTime || {};
    /**
     * ⚠️ NORMALISED TO `M/d/yyyy` AT THE SEED, not at each place it is shown.
     *
     * The server stores what `normalizeScheduleTimeForSubmit` sent it - an ISO string - so a
     * raw seed put `2026-10-27T03:00:00-04:00` on the "Scheduled Appointment" card where the
     * job builder reads `11/2/2026`. Same card component, different data.
     *
     * Doing it here means every downstream consumer (the card via `scheduleTimeOverride`, the
     * install-date step, `buildScheduleChanges`' string comparison, and the addendum payload)
     * sees the one shape the job builder uses, instead of each having to re-handle ISO.
     */
    setScheduleDate(formatInstallDateForDisplay(sched.date) || null);
    setScheduleTimeWindow(sched.timeWindow || '');
    setContractPrice(parsePrice(lead?.originalContractPrice));
    setCustomerPhone(formatLocalUSPhone(readLeadPhone(lead)));
    setCustomerEmail(readLeadEmail(lead));
    setNote(lead?.note != null ? String(lead.note) : '');
  }, [lead]);

  const savedDynamicJobState = useMemo(
    () =>
      savedOutcome?.jobBuilder?.dynamicJobState ||
      savedOutcome?.dynamicJobState ||
      lead?.jobBuilder?.dynamicJobState ||
      extractDynamicJobState(portalRecord?.portalJobBuilder) ||
      extractDynamicJobState(savedOutcome?.jobBuilder) ||
      extractDynamicJobState(lead?.jobBuilder) ||
      null,
    [savedOutcome, lead, portalRecord]
  );

  const calculatorData = useMemo(
    () =>
      (fetchedCalculator && Object.keys(fetchedCalculator).length ? fetchedCalculator : null) ||
      savedOutcome?.LFCalculator ||
      savedOutcome?.lfCalculator ||
      lead?.LFCalculator ||
      lead?.lfCalculator ||
      lead?.calculatorData ||
      {},
    [fetchedCalculator, savedOutcome, lead]
  );

  const dealCenterData = useMemo(
    () =>
      buildDealCenterData({
        entries: (calculatorData as any)?.entries || {},
        resultData: calculatorData || {},
        schemas: configuredSchemas,
        lead: lead || {},
      }),
    [calculatorData, configuredSchemas, lead]
  );

  const initialState = useMemo(() => {
    if (!jobBuilderConfig || !savedDynamicJobState) return null;
    try {
      const deserialized = deserializeDynamicJobStateFromStorage(savedDynamicJobState, jobBuilderConfig);
      return hydrateJobStateForPersistence(deserialized, jobBuilderConfig, dealCenterData, true);
    } catch (err) {
      console.warn('[DynamicDealEdit] deserialize failed:', err);
      return null;
    }
  }, [jobBuilderConfig, savedDynamicJobState, dealCenterData]);

  const builderInitialState = useMemo(
    () => (initialState ? JSON.parse(JSON.stringify(initialState)) : null),
    [initialState]
  );

  const effectiveJobState = editedJobState || initialState;

  const paymentOptions = useMemo(() => {
    const plans = pricing?.plans || {};
    const arr = Object.values(plans)
      .filter((p: any) => p && p.key)
      .map((p: any) => ({ key: p.key as string, label: (p.label || p.key) as string }));
    return arr.length
      ? arr
      : [
          { key: 'check', label: 'Check (0% Fee)' },
          { key: 'mcVisaDscvr', label: 'MC/VISA/DSCVR (3.00% Fee)' },
          { key: 'amex', label: 'AMEX (5.00% Fee)' },
        ];
  }, [pricing]);

  const downPaymentOptions = useMemo(() => {
    const basics = (pricing?.outcomeDownPaymentMethods || [])
      .filter((o: any) => o && o.value)
      .map((o: any) => ({ key: o.value as string, label: (o.label || o.value) as string }));
    return basics.length
      ? basics
      : [
          { key: 'check', label: 'Check (Bank Fee: 0%)' },
          { key: 'mcVisaDscvr', label: 'MC/VISA/DSCVR (Bank Fee: 3%)' },
          { key: 'amex', label: 'AMEX (Bank Fee: 5%)' },
        ];
  }, [pricing]);

  const coerceToPlanKey = useCallback(
    (stored: any, fallback = '') => {
      const s = String(stored || '').trim().toLowerCase();
      if (!s) return fallback;
      const byKey = paymentOptions.find((p) => p.key.toLowerCase() === s);
      if (byKey) return byKey.key;
      const byLabel = paymentOptions.find((p) => p.label.toLowerCase() === s);
      if (byLabel) return byLabel.key;
      const fuzzy = resolveTierPaymentMethod(stored);
      const byFuzzy = paymentOptions.find((p) => p.key === fuzzy);
      return byFuzzy ? byFuzzy.key : fallback;
    },
    [paymentOptions]
  );

  const toDownPaymentKey = useCallback(
    (stored: any) => {
      const key = stored ? coerceToPlanKey(stored, '') : '';
      return key && downPaymentOptions.some((o) => o.key === key) ? key : '';
    },
    [coerceToPlanKey, downPaymentOptions]
  );

  const fundingSource = resolveFundingSource({ lead, mode: 'edit' });
  const serverFunding = useFunding(leadId, lead?.companyId || user?.companyId, {
    userId: user?._id || user?.id,
    calculatorId: editCalculatorId || undefined,
    calculatorTitle: (calculatorData as any)?.title || undefined,
    source: fundingSource,
    customerId: lead?.customerDetails?._id || lead?.customerDetails?.id || undefined,
  });

  /**
   * The payment split held on the device while there is no signal.
   *
   * ⚠️ Offline `funding.record` is null and every `funding.payments` read (24 of them) returns
   * an empty list - so the Funding sub-screen renders blank and Confirm cannot advance. This
   * overlays the rows the rep just entered, the same way `ResultJobModal` does in the create
   * flow, so one shadow fixes every reader instead of 24 call sites.
   */
  const [offlineFunding, setOfflineFunding] = useState<FundingRecord | null>(null);
  const funding = useMemo(
    () =>
      offlineFunding
        ? { ...serverFunding, record: offlineFunding, payments: offlineFunding.payments }
        : serverFunding,
    [serverFunding, offlineFunding]
  );

  const fundingLog = useMemo(
    () => ({
      userId: user?._id || user?.id,
      leadId,
      calculatorId: editCalculatorId || undefined,
      calculatorTitle: (calculatorData as any)?.title || undefined,
      source: fundingSource,
    }),
    [user?._id, user?.id, leadId, editCalculatorId, calculatorData, fundingSource]
  );

  const contractNum = Number(contractPrice) || 0;

  const activeRows = useMemo(
    () => rows.filter((r) => (payMode === 'upfront' ? r.kind === 'up' : r.kind !== 'up')),
    [rows, payMode]
  );
  const upRows = useMemo(() => activeRows.filter((r) => r.kind === 'up'), [activeRows]);
  const downRows = useMemo(() => activeRows.filter((r) => r.kind === 'down'), [activeRows]);
  const balRows = useMemo(() => activeRows.filter((r) => r.kind === 'bal'), [activeRows]);
  const collectNowRows = useMemo(() => activeRows.filter((r) => r.kind !== 'bal'), [activeRows]);

  const downTotal = useMemo(
    () => collectNowRows.reduce((n, r) => n + effectiveRowAmount(r, activeRows, contractNum), 0),
    [collectNowRows, activeRows, contractNum]
  );
  const balanceTotal = useMemo(
    () => balRows.reduce((n, r) => n + effectiveRowAmount(r, activeRows, contractNum), 0),
    [balRows, activeRows, contractNum]
  );

  const primaryDownMethod = useMemo(
    () =>
      collectNowRows.find((r) => r.method && effectiveRowAmount(r, activeRows, contractNum) > 0)?.method ||
      collectNowRows.find((r) => r.method)?.method ||
      '',
    [collectNowRows, activeRows, contractNum]
  );
  const primaryBalanceMethod = useMemo(
    () =>
      balRows.find((r) => r.method && effectiveRowAmount(r, activeRows, contractNum) > 0)?.method ||
      balRows.find((r) => r.method)?.method ||
      '',
    [balRows, activeRows, contractNum]
  );

  const balanceMethodKey = coerceToPlanKey(primaryBalanceMethod, 'check');
  const downPaymentMethodKey = toDownPaymentKey(primaryDownMethod);

  const allocations = useMemo(
    () => paymentAllocations(activeRows, contractNum, pricing.plans),
    [activeRows, contractNum, pricing.plans]
  );

  const rowsSeededRef = useRef(false);
  useEffect(() => {
    if (rowsSeededRef.current) return;
    if (pricing.isLoading || !outcomeFetched) return;
    rowsSeededRef.current = true;

    const seededDown = parsePrice(lead?.downPayment);
    setRows([
      {
        pid: newPaymentId(),
        kind: 'down',
        amount: seededDown > 0 ? String(Math.round(seededDown)) : '',
        method: toDownPaymentKey(lead?.paymentMethod),
      },
      {
        pid: newPaymentId(),
        kind: 'bal',
        amount: '',
        method: coerceToPlanKey(lead?.balancePaymentMethod, ''),
        auto: true,
      },
    ]);

    setNoDown(false);
    let cancelled = false;
    funding.load().then((record) => {
      if (cancelled || !record) return;
      const saved = hydrateRowsFromRecord(record, pricing.plans);
      if (saved.length) {
        setRows(saved);
        setPayMode(inferPayMode(record));
        setNoDown(inferNoDownPayment(record));
      }
      if (record.result === 'bankDecline') setResultChoice('bank_decline');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pricing.isLoading, outcomeFetched]);

  const updateRow = useCallback((pid: string, patch: Partial<PaymentRow>) => {
    setRows((prev) => prev.map((r) => (r.pid === pid ? { ...r, ...patch } : r)));
  }, []);

  const removeRow = useCallback(
    (pid: string) => {
      const gone = rows.find((r) => r.pid === pid);
      if (gone) {
        logFundingRowRemoved({
          ...fundingLog,
          kind: gone.kind,
          amount: effectiveRowAmount(gone, activeRows, contractNum),
          method: gone.method || undefined,
          methodLabel: pricing.plans[gone.method]?.label || gone.methodLabel,
        });
      }
      setRows((prev) => prev.filter((r) => r.pid !== pid));
    },
    [rows, activeRows, contractNum, pricing.plans, fundingLog]
  );

  const addRow = useCallback(
    (kind: PaymentKind) => {
      logFundingRowAdded({
        ...fundingLog,
        kind,
        rowCount: activeRows.filter((r) => r.kind === kind).length + 1,
      });
      setRows((prev) => {
        const next = [...prev];
        let insertAt = next.length;
        for (let i = next.length - 1; i >= 0; i -= 1) {
          if (next[i].kind === kind) {
            insertAt = i + 1;
            break;
          }
        }
        next.splice(insertAt, 0, { pid: newPaymentId(), kind, amount: '', method: '' });
        return next;
      });
    },
    [activeRows, fundingLog]
  );

  const selectRowMethod = useCallback(
    (pid: string, key: string) => {
      const row = rows.find((r) => r.pid === pid);
      if (row && key && key !== row.method) {
        logFundingMethodSelected({
          ...fundingLog,
          kind: row.kind,
          method: key,
          methodLabel: pricing.plans[key]?.label,
          amount: effectiveRowAmount(row, activeRows, contractNum),
        });
      }
      const approved = row && key ? findApprovedArchive(row, key, pricing.plans) : undefined;
      if (approved && !isLocalArchive(approved) && canRestoreEntry(row!, approved)) {
        funding.restoreArchivedPlan(pid, approved.archivedId);
        return;
      }
      setRows((prev) => swapRowMethod(prev, pid, key, pricing.plans));
    },
    [rows, activeRows, contractNum, pricing.plans, fundingLog, funding]
  );

  const restorePlan = useCallback(
    (pid: string, archivedId: string) => {
      const row = rows.find((r) => r.pid === pid);
      const entry = findShelfEntry(rows, archivedId);
      if (entry && isLocalArchive(entry)) {
        setRows((prev) => restoreRowPlan(prev, pid, archivedId, pricing.plans));
        return;
      }
      funding.restoreArchivedPlan(pid, archivedId);
    },
    [rows, pricing.plans, funding]
  );

  const switchPayMode = useCallback(
    (next: PayMode, allowed: boolean) => {
      if (next === payMode) return;
      if (!allowed) {
        setStructureNudge(true);
        return;
      }
      setStructureNudge(false);
      logFundingStructureChanged({ ...fundingLog, from: payMode, to: next });
      setRows((prev) => {
        const wantUpfront = next === 'upfront';
        const already = prev.some((r) => (wantUpfront ? r.kind === 'up' : r.kind !== 'up'));
        if (already) return prev;
        return wantUpfront
          ? // Upfront means the whole contract now, so it opens holding all of it.
            [
              ...prev,
              {
                pid: newPaymentId(),
                kind: 'up' as PaymentKind,
                amount: contractNum > 0 ? String(Math.round(contractNum)) : '',
                method: '',
              },
            ]
          : [
              ...prev,
              { pid: newPaymentId(), kind: 'down' as PaymentKind, amount: '', method: '' },
              { pid: newPaymentId(), kind: 'bal' as PaymentKind, amount: '', method: '', auto: true },
            ];
      });
      setPayMode(next);
    },
    [payMode, contractNum, fundingLog]
  );

  const selectStructure = useCallback(
    (next: PayStructure, allowed: boolean) => {
      if (next === payStructureOf(payMode, noDown)) return;
      if (!allowed) {
        setStructureNudge(true);
        return;
      }
      if (next === 'upfront') {
        setNoDown(false);
        switchPayMode('upfront', true);
        return;
      }
      if (payMode === 'upfront') switchPayMode('split', true);
      setStructureNudge(false);
      if (next === 'none') setRows((prev) => prev.map((r) => (r.kind === 'down' ? { ...r, amount: '' } : r)));
      setNoDown(next === 'none');
    },
    [payMode, noDown, switchPayMode]
  );

  useEffect(() => {
    if (contractNum <= 0 || payMode === 'upfront') return;
    const hasAuto = activeRows.some((r) => r.auto);
    const gap = contractNum - assignedTotal(activeRows, contractNum);
    if (hasAuto || gap <= 0.01) return;
    const candidates = activeRows.filter((r) => r.kind === 'bal' && !r.decision);
    const target = candidates[candidates.length - 1];
    if (!target) return;
    if (parseFloat(target.amount || '0') > 0) return;
    updateRow(target.pid, { auto: true });
  }, [activeRows, contractNum, payMode, updateRow]);

  const needsRowId = useMemo(() => needsAttentionRowId(activeRows, banners, payMode), [activeRows, banners, payMode]);
  const structureIsLocked = useMemo(() => structureLocked(funding.payments), [funding.payments]);
  const totalAssigned = useMemo(() => assignedTotal(activeRows, contractNum), [activeRows, contractNum]);

  const decisionBanners = banners.map((b) => (
    <View
      key={b.id}
      style={{
        backgroundColor: b.tone === 'bad' ? FUND.RED_BG : FUND.AMBER_BG,
        borderRadius: 11,
        paddingHorizontal: 12,
        paddingVertical: 11,
        marginBottom: 12,
      }}
    >
      <Text style={{ fontSize: 12, fontWeight: '700', lineHeight: 17, color: b.tone === 'bad' ? FUND.RED_TEXT : FUND.AMBER_TEXT }}>
        {b.text}
      </Text>
    </View>
  ));

  const covered = useMemo(() => coverageOK(funding.payments, contractNum), [funding.payments, contractNum]);
  const localFundingBlockers = useMemo(
    () => fundingBlockers(funding.payments, contractNum, { setupBlocked: !!funding.paymentsSetupError }),
    [funding.payments, contractNum, funding.paymentsSetupError]
  );
  const fundingBlockerList = funding.serverBlockers ?? localFundingBlockers;
  const declineHappened = useMemo(() => hasDecline(funding.record), [funding.record]);
  const attempts = useMemo(() => attemptLog(funding.record), [funding.record]);
  const lastSyncedAt = useMemo(() => {
    const stamps = funding.payments.map((p) => p.syncedAt).filter(Boolean) as string[];
    if (!stamps.length) return null;
    return formatStamp(stamps.sort().slice(-1)[0]);
  }, [funding.payments]);
  const bankDeclined = resultChoice === 'bank_decline';

  useEffect(() => {
    if (!declineHappened && resultChoice === 'bank_decline') setResultChoice('sale');
  }, [declineHappened, resultChoice]);

  const linkPayment = useMemo(
    () => funding.payments.find((p) => p.pid === linkTarget) || null,
    [funding.payments, linkTarget]
  );

  const resolvePlanLabel = useCallback(
    (stored: any, fallbackKey = '') => {
      const key = coerceToPlanKey(stored, fallbackKey);
      if (!key) return '—';
      return paymentOptions.find((o) => o.key === key)?.label || key;
    },
    [coerceToPlanKey, paymentOptions]
  );

  const tierResult = useMemo(
    () =>
      computeEditedTiers({
        calculatorData,
        dealCenterData,
        config: jobBuilderConfig,
        originalJobState: initialState,
        editedJobState: effectiveJobState,
        schemas: configuredSchemas,
        paymentMethod: resolveTierPaymentMethod(balanceMethodKey),
        isLowesLead: lead?.lowesLead === true,
        originalContractPrice: lead?.originalContractPrice,
        pricingConfig,
      }),
    [calculatorData, dealCenterData, jobBuilderConfig, initialState, effectiveJobState, configuredSchemas, balanceMethodKey, lead, pricingConfig]
  );

  const customerName =
    `${lead?.customerDetails?.firstName || ''} ${lead?.customerDetails?.lastName || ''}`.trim() ||
    'Customer';
  const balance = balanceTotal;
  const newMarkup = getMarkupInfo(contractPrice, tierResult.next, undefined);
  const previousMarkup = getMarkupInfo(parsePrice(lead?.originalContractPrice), tierResult.previous, undefined);

  const parsedScheduleDate = useMemo(() => {
    if (!scheduleDate || scheduleDate === 'TBD') return null;
    const d = new Date(scheduleDate);
    return isNaN(d.getTime()) ? null : d;
  }, [scheduleDate]);
  const currentInstallDateText = useMemo(() => {
    if (!scheduleDate) return 'Not Scheduled';
    if (scheduleDate === 'TBD') return 'TBD';
    return parsedScheduleDate ? format(parsedScheduleDate, 'M/d/yy') : String(scheduleDate);
  }, [scheduleDate, parsedScheduleDate]);
  const currentInstallTimeText = scheduleTimeWindow || 'TBD';

  const buildChangeGroups = useMemo(
    () => (editedJobState ? computeDynamicBuildChanges(initialState, editedJobState, jobBuilderConfig) : []),
    [editedJobState, initialState, jobBuilderConfig]
  );
  const buildChanged = buildChangeGroups.some((g) => g.changes.length > 0);

  /**
   * ⚠️ BOTH SIDES GO THROUGH `formatInstallDateForDisplay`. `scheduleDate` is normalised to
   * `M/d/yyyy` when it is seeded, while the lead still holds the server's ISO string, so
   * comparing them raw would make `scheduleChanged` permanently true - every edit would look
   * like a reschedule, re-book the slot the lead already holds and raise a pointless addendum.
   */
  const scheduleChanged =
    !!scheduleDate &&
    (scheduleDate !== (formatInstallDateForDisplay(lead?.jobBuilder?.scheduleTime?.date) || null) ||
      scheduleTimeWindow !== (lead?.jobBuilder?.scheduleTime?.timeWindow || ''));
  const priceChanged = parsePrice(lead?.originalContractPrice) !== Number(contractPrice);
  const noteChanged = String(lead?.note ?? '') !== note;
  const downPaymentChanged = Math.round(parsePrice(lead?.downPayment)) !== Math.round(downTotal);

  const costFloor = Number(tierResult?.next?.cost) || 0;
  const contractPriceError =
    costFloor > 0 && (Number(contractPrice) || 0) < costFloor
      ? `Cannot be below the cost of ${fmtMoney(costFloor)}.`
      : '';
  const hasPriceError = Boolean(contractPriceError);

  const refundDue = useMemo(
    () => refundDueFor(contractNum, funding.payments),
    [contractNum, funding.payments]
  );
  const needsRefund = refundDue > 0;

  const downLocked = useMemo(
    () => isDownPaymentLocked(contractNum, funding.payments),
    [contractNum, funding.payments]
  );

  /**
   * ⚠️ WARMED on every online open, not only when a refund is due.
   *
   * `needsRefund` is `refundDue > 0`, which only becomes true AFTER the rep lowers the price -
   * so this used to fetch mid-session, on demand. Offline that is too late: there is no network
   * at the moment it is needed, and `refundBlockers` fails on `!approverId`, blocking every
   * refund. Fetching it at open (online) is one small, rarely-changing request that puts the
   * list in the snapshot before the rep needs it.
   */
  const approverFeed = useRefundApprovers(
    needsRefund || online,
    lead?.companyId || user?.companyId,
    usingCache ? ((cachedEdit?.approvers as any) ?? null) : null,
  );
  const approverOptions = useMemo(
    () => pickableApprovers(approverFeed.feed, user?._id || user?.id),
    [approverFeed.feed, user?._id, user?.id]
  );

  /**
   * Save the snapshot this screen will seed from when the rep reopens it with no signal.
   *
   * ⚠️ ONE write per open, never per render. MMKV rewrites its WHOLE store on every write, so a
   * per-render write here would tax every unrelated write in the app - including the Job
   * Builder's autosave. `dealEditCacheChanged` settles on object identity first, so reopening an
   * unchanged deal costs nothing at all.
   *
   * ⚠️ Skipped entirely while serving FROM the cache, or the screen would rewrite its own
   * snapshot with a copy of itself.
   */
  useEffect(() => {
    if (!online || usingCache || !cacheName) return;
    const next = buildDealEditCache({
      outcome: savedOutcome ?? null,
      calculator: fetchedCalculator ?? null,
      portalJobBuilder: portalRecord ?? null,
      approvers: approverFeed.feed ?? null,
      funding: funding.record ?? null,
    });
    if (!next || !dealEditCacheChanged(next, cachedRef.current)) return;
    cachedRef.current = next;
    writeOfflineCache<CachedDealEdit>(cacheName, next, ownerId || undefined);
  }, [
    online, usingCache, cacheName, ownerId,
    savedOutcome, fetchedCalculator, portalRecord, approverFeed.feed, funding.record,
  ]);

  const refundPromptRef = useRef(false);
  const [showRefundPrompt, setShowRefundPrompt] = useState(false);
  useEffect(() => {
    if (!needsRefund) {
      refundPromptRef.current = false;
      setShowRefundPrompt(false);
      if (refundAcknowledged) setRefundAcknowledged(false);
      return;
    }
    if (refundPromptRef.current || refundAcknowledged) return;
    refundPromptRef.current = true;
    setShowRefundPrompt(true);
  }, [needsRefund, refundAcknowledged]);

  const activeRefund = needsRefund && refundAcknowledged;

  const refundSourceRow = useMemo(() => {
    const withMoney = (funding.payments || [])
      .map((row) => ({ row, left: refundableAmount(row) }))
      .filter((x) => x.left > 0)
      .sort((a, b) => b.left - a.left);
    return withMoney[0]?.row || null;
  }, [funding.payments]);

  const jobRefund = useMemo(() => refundsOnJob(funding.payments)[0]?.refund || null, [funding.payments]);

  const refundApproval = useRefundApproval(leadId, jobRefund, lead?.companyId || user?.companyId);

  const approverLocked = jobRefund?.state === 'pendingApproval';

  const approverName = useMemo(
    () => approverOptions.find((a) => String(a.id) === String(approverId))?.name || '',
    [approverOptions, approverId]
  );

  useEffect(() => {
    if (!activeRefund || refundMethod) return;
    // ⚠️ Never seed `card` with no signal — the picker hides that option offline, so the rep
    // would be left with a pre-selected method they cannot see or change.
    setRefundMethod(refundSourceRow?.type === 'cc' && online ? 'card' : 'check');
  }, [activeRefund, refundMethod, refundSourceRow, online]);

  const refundGate = useMemo(() => {
    if (!activeRefund) return [];
    return refundBlockers({
      payment: refundSourceRow,
      amount: refundDue,
      method: refundMethod,
      reason: refundReason,
      approverId,
      approversConfigured: approverFeed.isConfigured,
    });
  }, [activeRefund, refundSourceRow, refundDue, refundMethod, refundReason, approverId, approverFeed.isConfigured]);


  const confirmGate = useMemo(
    () => [
      ...(contractPriceError ? [contractPriceError] : []),
      ...confirmBlockers(activeRows, contractNum, payMode, {
        refundDue: activeRefund ? refundDue : 0,
      }),
    ],
    [contractPriceError, activeRows, contractNum, payMode, activeRefund, refundDue]
  );

  const customerPhoneDigits = customerPhone.replace(/\D/g, '');
  const customerPhoneError =
    customerPhoneDigits.length === 0
      ? 'Phone number is required to send the addendum.'
      : customerPhoneDigits.length !== 10
        ? 'Enter a complete 10-digit phone number.'
        : '';

  const customerEmailTrimmed = customerEmail.trim();
  const customerEmailError =
    customerEmailTrimmed && !validateEmail(customerEmailTrimmed)
      ? 'Enter a valid email address (e.g. name@example.com).'
      : '';
  const downPaymentMethodChanged =
    toDownPaymentKey(lead?.paymentMethod) !== downPaymentMethodKey;
  const balanceMethodChanged =
    coerceToPlanKey(lead?.balancePaymentMethod, 'check') !== balanceMethodKey;

  const hasAnyChange =
    buildChanged ||
    scheduleChanged ||
    priceChanged ||
    noteChanged ||
    downPaymentChanged ||
    downPaymentMethodChanged ||
    balanceMethodChanged;

  const submitBlocked =
    isSubmitting ||
    !hasAnyChange ||
    hasPriceError ||
    isCalculatorLoading ||
    !!customerPhoneError ||
    !!customerEmailError ||
    refundGate.length > 0;

  const goFunding = useCallback(async () => {
    if (confirmGate.length) {
      FlashMessage.error('Not ready to confirm', confirmGate[0]);
      return;
    }
    const upsert = toUpsertRows(activeRows, contractNum, pricing.plans);

    // ⚠️ Offline this used to dead-end: `savePayments` refuses, `if (!res.ok) return` stops,
    // and the rep could never reach Review — which made the queued addendum unreachable by
    // the price-change route. The split is held on the device instead and uploads with the
    // addendum. Every row here is a cheque; `confirmGate` refuses a card or loan with no signal.
    if (!isOnline()) {
      const work = ensureOfflineWorkForLead(lead || { _id: leadId });
      if (!work?.clientId) {
        FlashMessage.error(
          'Not saved',
          'This payment split could not be saved on the device. Try again once you have signal.'
        );
        return;
      }
      saveOfflineFunding(work.clientId, {
        contractPrice: Math.round(contractNum),
        payments: upsert,
        payMode,
      });
      setOfflineFunding(
        offlineFundingRecord(String(leadId), contractNum, upsert, payMode)
      );
      logFundingOpened({
        ...fundingLog,
        contractPrice: Math.round(contractNum),
        paymentCount: upsert.length,
        payMode,
      });
      setPriceScreen('funding');
      return;
    }

    // ⚠️ `payments` is the COMPLETE list - a stored row left out is deleted. Keep every row the server will not let go.
    const res = await funding.savePayments(Math.round(contractNum), withSettledRows(upsert, funding.record), payMode);
    if (!res.ok) return;
    logFundingOpened({
      ...fundingLog,
      contractPrice: Math.round(contractNum),
      paymentCount: upsert.length,
      payMode,
    });
    setPriceScreen('funding');
  }, [confirmGate, activeRows, contractNum, pricing.plans, payMode, funding, fundingLog, lead, leadId]);

  const goPricing = useCallback(() => {
    const applied = applyDecisionsToRows(activeRows, funding.payments, contractNum, payMode);
    logFundingEditPayments({ ...fundingLog, reassigning: applied.banners.length > 0 });
    const inactive = rows.filter((r) => !activeRows.includes(r));
    setRows([...applied.rows, ...inactive]);
    setBanners(applied.banners);
    if (applied.banners.length) setPriceUnlocked(true);
    funding.clearServerBlockers();
    setStructureNudge(false);
    setPriceScreen('price');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, activeRows, funding, contractNum, payMode, fundingLog]);

  const openSendSheet = useCallback(
    async (pid: string) => {
      setLinkTarget(pid);
      setLinkUrl('');
      setIsLoadingLink(true);
      const res = await funding.fetchLink(pid);
      setLinkUrl(res.ok ? res.data?.url || '' : '');
      setIsLoadingLink(false);
    },
    [funding]
  );

  const handleSendLink = useCallback(
    async (channel: FundingChannel, destination?: string): Promise<boolean> => {
      if (!linkTarget) return false;
      const res = await funding.markLinkSent(linkTarget, channel, destination);
      if (res.ok && res.data?.reissued) {
        const fresh = await funding.fetchLink(linkTarget);
        setLinkUrl(fresh.ok ? fresh.data?.url || '' : '');
      }
      return res.ok;
    },
    [funding, linkTarget]
  );

  const handleSetFundingResult = useCallback(
    async (next: 'sale' | 'bank_decline') => {
      const res = await funding.setResult(next === 'bank_decline' ? 'bankDecline' : 'sale');
      if (res.ok) setResultChoice(next);
    },
    [funding]
  );

  const dealLogTarget = useMemo(() => {
    const userId = user?._id || user?.id;
    if (!userId || !leadId) return null;
    return {
      userId,
      leadId,
      jobBuilderId: lead?.leadId || leadId,
      ...(editCalculatorId ? { calculatorId: editCalculatorId } : {}),
      configId: savedOutcome?.jobBuilder?.configId || (jobBuilderConfig as any)?.id || null,
      result: lead?.result || 'Sale',
    };
  }, [user, leadId, editCalculatorId, lead?.result, lead?.leadId, savedOutcome, jobBuilderConfig]);

  const loggedSchedule = useCallback(
    () => ({
      currentDate: scheduleDate || 'TBD',
      currentTimeWindow: scheduleTimeWindow || 'TBD',
    }),
    [scheduleDate, scheduleTimeWindow]
  );

  const lastLoggedStepRef = useRef(-1);
  useEffect(() => {
    if (!dealLogTarget || step === 1) return;
    if (lastLoggedStepRef.current === step) return;
    lastLoggedStepRef.current = step;
    logDealStepViewed({ ...dealLogTarget, step });
  }, [step, dealLogTarget]);

  const [buildStepVisited, setBuildStepVisited] = useState(false);
  useEffect(() => {
    if (step === 1) setBuildStepVisited(true);
  }, [step]);


  const markupText = useCallback(
    (value: any) => {
      const info = getMarkupInfo(parsePrice(value), tierResult.next, undefined);
      if (!info?.text) return '';
      const pct = info.markupPct !== null && info.markupPct !== undefined
        ? ` ${info.markupPct > 0 ? '+' : ''}${info.markupPct}%`
        : '';
      return `${info.text}${pct}`;
    },
    [tierResult]
  );

  const priceScreenValues = useMemo(
    () => ({
      contractPrice: {
        label: 'Contract Price',
        value: fmtMoney(contractPrice),
        meta: (from: string, to: string) => ({ oldMarkup: markupText(from), markup: markupText(to) }),
      },
      downPayment: {
        label: 'Down Payment',
        value: fmtMoney(downTotal),
      },
      balance: {
        label: 'Balance',
        value: fmtMoney(balance),
      },
      paymentMethod: {
        label: 'Down Pmt Method',
        value: resolvePlanLabel(downPaymentMethodKey, ''),
      },
      balancePaymentMethod: {
        label: 'Balance Method',
        value: resolvePlanLabel(balanceMethodKey, ''),
      },
    }),
    [contractPrice, downTotal, balance, downPaymentMethodKey, balanceMethodKey, resolvePlanLabel, markupText]
  );

  const flushPriceChanges = useScreenChangeLog(
    step === 2,
    priceScreenValues,
    dealLogTarget
      ? (change) =>
          logDealPriceFieldChanged({
            ...dealLogTarget,
            fieldName: change.fieldName,
            fieldLabel: change.fieldLabel,
            oldValue: change.oldValue,
            newValue: change.newValue,
            extra: change.meta,
          })
      : null
  );

  const reviewScreenValues = useMemo(
    () => ({
      note: { label: 'Additional Notes', value: note },
      customerPhone: { label: 'Send Addendum To', value: customerPhone },
      customerEmail: { label: 'Email Address', value: customerEmail },
    }),
    [note, customerPhone, customerEmail]
  );

  const flushReviewChanges = useScreenChangeLog(
    step === 3,
    reviewScreenValues,
    dealLogTarget
      ? (change) =>
          logDealReviewFieldChanged({
            ...dealLogTarget,
            fieldName: change.fieldName,
            fieldLabel: change.fieldLabel,
            oldValue: change.oldValue,
            newValue: change.newValue,
            extra: change.meta,
          })
      : null
  );

  const handleInlineDateSelect = useCallback(
    (day: Date) => {
      const nextDate = format(day, 'M/d/yyyy');
      const already = proposedDate ? format(proposedDate, 'M/d/yyyy') === nextDate : false;
      if (dealLogTarget && !already) {
        logDealInstallDateSelected({
          ...dealLogTarget,
          selectedDate: nextDate,
          ...loggedSchedule(),
        });
      }
      setProposedDate(day);
      setProposedSlotIdx(0);
      // ⚠️ A new day must clear the failed windows, or a window that was full on the day just
      // looked at keeps showing "No crew available" on a day that may be wide open.
      setFailedInstallWindows([]);
    },
    [dealLogTarget, loggedSchedule, proposedDate]
  );

  const handleNextToReview = useCallback(() => {
    flushPriceChanges();
    setStep(3);
  }, [flushPriceChanges]);

  const handleOpenInstallCalendar = useCallback(() => {
    if (dealLogTarget) logDealInstallDateModifyOpened({ ...dealLogTarget, ...loggedSchedule() });
    setDateStep('calendar');
  }, [dealLogTarget, loggedSchedule]);

  const handleSkipInstallDate = useCallback(() => {
    if (dealLogTarget) logDealInstallDateUnchanged({ ...dealLogTarget, ...loggedSchedule() });
    setStep(1);
  }, [dealLogTarget, loggedSchedule]);

  const handleUseSelectedDate = useCallback(() => {
    if (!proposedDate) return;
    setDateStep('time');
  }, [proposedDate]);

  const handleSelectTbd = useCallback(() => {
    if (dealLogTarget) {
      logDealInstallDateChanged({
        ...dealLogTarget,
        oldDate: scheduleDate,
        oldTimeWindow: scheduleTimeWindow,
        newDate: 'TBD',
        newTimeWindow: '',
      });
    }
    setScheduleDate('TBD');
    setScheduleTimeWindow('');
    setProposedDate(null);
    setProposedSlotIdx(0);
    setFailedInstallWindows([]);
    setDateStep('success');
  }, [dealLogTarget, scheduleDate, scheduleTimeWindow]);

  const handleProposeNextSlot = useCallback(() => {
    if (proposedSlotIdx < offeredInstallWindows.length - 1) {
      setProposedSlotIdx(proposedSlotIdx + 1);
      return;
    }
    if (dealLogTarget) {
      logDealInstallWindowsDeclined({
        ...dealLogTarget,
        proposedDate: proposedDate ? format(proposedDate, 'M/d/yyyy') : undefined,
        declinedWindows: offeredInstallWindows.map((w) => w.value),
      });
    }
    setProposedSlotIdx(0);
    setDateStep('calendar');
  }, [proposedSlotIdx, proposedDate, dealLogTarget, offeredInstallWindows]);

  // The window "Yes" just found no crew for, and the other one if it has not failed too.
  // Mirrors `AppointmentSchedulerModal` (the job builder), deliberately.
  const noCrewForCurrentInstall = failedInstallWindows.includes(currentInstallWindow.value);
  const otherInstallWindowIdx = offeredInstallWindows.findIndex(
    (w, i) => i !== proposedSlotIdx && !failedInstallWindows.includes(w.value)
  );

  const handleTryOtherInstallWindow = useCallback(() => {
    if (otherInstallWindowIdx >= 0) setProposedSlotIdx(otherInstallWindowIdx);
  }, [otherInstallWindowIdx]);

  const handlePickAnotherInstallDate = useCallback(() => {
    // A new day is a clean slate: the windows that were full today may be free tomorrow.
    setFailedInstallWindows([]);
    setProposedSlotIdx(0);
    setDateStep('calendar');
  }, []);

  const handleAcceptProposedTime = useCallback(async () => {
    if (!proposedDate || installBooking) return;
    // First come, first served, as in the job builder: the server re-checks and holds the crew
    // as a draft right now, so a time someone else just took is caught here, not at submit.
    // Only `taken` stops the rep; offline or any other failure carries on as before.
    if (leadId) {
      setInstallBooking(true);
      const booked = await bookInstallSlot({
        leadId,
        date: format(proposedDate, 'yyyy-MM-dd'),
        timeWindow: currentInstallWindow.value,
        isSale: (lead?.result || 'Sale') === 'Sale',
      });
      setInstallBooking(false);
      if (booked.kind === 'taken') {
        // Say it ON the step, as the job builder does, instead of a flash that is gone in
        // seconds: the rep needs the two ways out (the other window, another date) in front
        // of them. Nothing was booked.
        setFailedInstallWindows((prev) =>
          prev.includes(currentInstallWindow.value) ? prev : [...prev, currentInstallWindow.value]
        );
        setInstallAvailabilityRefresh((n) => n + 1);
        return;
      }
    }
    const nextDate = format(proposedDate, 'M/d/yyyy');
    const nextWindow = currentInstallWindow.value;
    if (dealLogTarget) {
      logDealInstallDateChanged({
        ...dealLogTarget,
        oldDate: scheduleDate,
        oldTimeWindow: scheduleTimeWindow,
        newDate: nextDate,
        newTimeWindow: nextWindow,
      });
    }
    setScheduleDate(nextDate);
    setScheduleTimeWindow(nextWindow);
    setDateStep('success');
  }, [proposedDate, currentInstallWindow, dealLogTarget, scheduleDate, scheduleTimeWindow, installBooking, leadId, lead?.result]);

  const handleFinishInstallDate = useCallback(() => {
    setDateStep('intro');
    setProposedDate(null);
    setProposedSlotIdx(0);
    setFailedInstallWindows([]);
    setStep(1);
  }, []);

  const handleAutoAdjust = useCallback(() => {
    const { previous, next } = tierResult;
    const original = parsePrice(lead?.originalContractPrice) || contractPrice;
    const before = contractPrice;
    const logAdjusted = (value: number) => {
      if (!dealLogTarget) return;
      logDealPriceAutoAdjusted({
        ...dealLogTarget,
        oldValue: fmtMoney(before),
        newValue: fmtMoney(value),
        oldMarkup: markupText(before),
        markup: markupText(value),
      });
    };
    const info = getMarkupInfo(original, previous);
    const baseKey = info.baseKey;
    const prevBase = baseKey ? previous[baseKey] : 0;
    const nextBase = baseKey ? next[baseKey] : 0;
    let adjusted: number | null = null;
    if (baseKey && prevBase > 0 && nextBase > 0) {
      adjusted = Math.round(nextBase * (original / prevBase));
    } else if (previous.retail > 0 && next.retail > 0) {
      adjusted = Math.round(next.retail * (original / previous.retail));
    } else if (next.par > 0) {
      adjusted = Math.round(next.par * 1.1);
    }
    if (adjusted == null) return;

    const floor = Number(next?.cost) || 0;
    const { price: flooredPrice, clamped: wasClamped } = clampToCostFloor(adjusted, floor);
    adjusted = flooredPrice;

    setContractPrice(adjusted);
    logAdjusted(adjusted);

    if (wasClamped) {
      FlashMessage.info(
        'Adjusted to the cost floor',
        `The job's markup would have priced it below the ${fmtMoney(floor)} it costs to build, so the price was set to the floor instead.`
      );
    }

    if (!refundAcknowledged && requiresRefundApproval(adjusted, funding.payments)) {
      refundPromptRef.current = true;
      setShowRefundPrompt(true);
    }
  }, [tierResult, lead, contractPrice, funding.payments, refundAcknowledged, dealLogTarget, markupText]);

  const handleCancelJob = useCallback(async () => {
    if (!leadId) return;
    setIsSubmitting(true);
    try {
      await LeadService.cancelLead(leadId, lead);
      if (dealLogTarget) logDealJobCancelled({ ...dealLogTarget, ...loggedSchedule() });
      FlashMessage.success('Job Cancelled', 'This job was marked cancelled');
      setShowCancelConfirm(false);
      navigation?.goBack();
    } catch (err: any) {
      FlashMessage.error('Error', err?.response?.data?.message || 'Failed to cancel job');
    } finally {
      setIsSubmitting(false);
    }
  }, [leadId, lead, navigation, dealLogTarget, loggedSchedule]);

  const handleSubmit = useCallback(async () => {
    if (!leadId) return;
    flushReviewChanges();
    setIsSubmitting(true);
    try {
      const stateForSubmit = { ...(effectiveJobState || {}), agreements: [], orderSheets: [] };
      const persisted = jobBuilderConfig
        ? serializeDynamicJobStateForStorage(stateForSubmit, jobBuilderConfig, dealCenterData, true)
        : stateForSubmit;

      const existingSchedule =
        savedOutcome?.jobBuilder?.scheduleTime || lead?.jobBuilder?.scheduleTime || {};
      const scheduleTime = {
        ...existingSchedule,
        customerName: existingSchedule.customerName || customerName,
        ...(scheduleDate ? { date: scheduleDate, timeWindow: scheduleTimeWindow } : {}),
      };

      const configId = savedOutcome?.jobBuilder?.configId || (jobBuilderConfig as any)?.id || null;
      const configSnapshotId =
        savedOutcome?.jobBuilder?.configSnapshotId || (jobBuilderConfig as any)?.id || 'dynamic';

      const jobBuilder = {
        dynamicJobState: { ...persisted, scheduleTime },
        isDynamic: true,
        configId,
        configSnapshotId,
        calculatorType: 'dynamic',
        scheduleTime,
      };

      const lfCalculatorComplete = Boolean(
        calculatorData &&
          typeof calculatorData === 'object' &&
          (calculatorData as any).createdBy &&
          (calculatorData as any).appointmentId &&
          (calculatorData as any).title
      );

      const isSaleResult = (lead?.result || 'Sale') === 'Sale';

      const payload: any = {
        result: lead?.result || 'Sale',
        oneLeg: toPayloadText(savedOutcome?.oneLeg ?? lead?.oneLeg ?? 'No'),
        reason: toPayloadText(isSaleResult ? '' : (savedOutcome?.reason ?? lead?.reason)),
        explain: toPayloadText(isSaleResult ? '' : (savedOutcome?.explain ?? lead?.explain)),
        lastPriceQuoted: lead?.lastPriceQuoted || '',
        originalContractPrice: String(contractPrice),
        downPayment: String(Math.round(downTotal)),
        paymentMethod: downPaymentMethodKey || lead?.paymentMethod || '',
        balancePaymentMethod: balanceMethodKey || lead?.balancePaymentMethod || '',
        balance: String(Math.round(balance)),
        downPayments: allocations.downPayments,
        balancePayments: allocations.balancePayments,
        selectedCalculatorId:
          savedOutcome?.selectedCalculatorId ||
          lead?.selectedCalculatorId ||
          calculatorData?._id ||
          null,
        selectedAppointmentId:
          savedOutcome?.selectedAppointmentId ||
          lead?.selectedAppointmentId ||
          lead?.jobBuilder?.appointmentId ||
          null,
        jobBuilder,
        buildChangeSummary: buildChangeGroups,
        note,
        customerPhone: toE164USPhone(customerPhone || readLeadPhone(lead)),
        customerEmail: customerEmailTrimmed,
      };
      if (lfCalculatorComplete) payload.LFCalculator = calculatorData;

      const isDemo = (lead?.result || 'Sale') !== 'Sale';
      const collectInlineDocs = (group: any, type: string) =>
        (Array.isArray(group) ? group : [])
          .flatMap((g: any) => (Array.isArray(g?.files) ? g.files : [g]))
          .filter((f: any) => f && f.isNew && typeof (f.uri || f.base64 || f.file) === 'string' && String(f.uri || f.base64 || f.file).startsWith('data:'))
          .map((f: any) => ({ name: f.name || '', file: f.uri || f.base64 || f.file, type }));
      const newAgreements = collectInlineDocs(effectiveJobState?.agreements, isDemo ? 'orderSheet' : 'agreement');
      const newOrderSheets = collectInlineDocs(effectiveJobState?.orderSheets, 'orderSheet');
      const agreementsPayload = isDemo ? [] : newAgreements;
      const orderSheetsPayload = isDemo ? [...newAgreements, ...newOrderSheets] : newOrderSheets;
      if (agreementsPayload.length) payload.agreements = agreementsPayload;
      if (orderSheetsPayload.length) payload.orderSheets = orderSheetsPayload;

      // ── offline ────────────────────────────────────────────────────────────────────────
      // Queue the addendum instead of sending it. The release to the homeowner is a SEPARATE
      // queue step, so a refund addendum can never reach them ahead of its approval.
      if (!isOnline()) {
        const blocked = addendumOfflineBlock({
          online: false,
          hasRefund: !!activeRefund,
          refundMethod,
          newDocumentCount: agreementsPayload.length + orderSheetsPayload.length,
        });
        if (blocked) {
          FlashMessage.info(blocked.title, blocked.message);
          return;
        }
        const work = ensureOfflineWorkForLead(lead || { _id: leadId });
        if (!work?.clientId) {
          FlashMessage.error(
            'Not saved',
            'This addendum could not be saved on the device. Try again once you have signal.'
          );
          return;
        }
        // ⚠️ Documents are deliberately NOT carried — the gate above refuses an addendum that
        // has any, so `payload` here never holds base64.
        saveOfflineAddendum(work.clientId, {
          payload,
          contact: {
            customerEmail: customerEmailTrimmed,
            customerPhone: toE164USPhone(customerPhone || readLeadPhone(lead)),
          },
          hasRefund: !!activeRefund,
        });
        // ⚠️ A separate step, ordered AFTER the draft so it gets the real `draftId`. Cheque
        // only — the gate above refuses a card refund offline. The addendum is NOT released
        // by the device when this exists; the approver releases it server-side.
        if (activeRefund && refundSourceRow) {
          saveOfflineAddendumRefund(work.clientId, {
            pid: refundSourceRow.pid,
            amount: refundDue,
            reason: refundReason || 'priceDrop',
            ...(refundNote.trim() ? { note: refundNote.trim() } : {}),
            ...(approverId ? { assignedToUserId: approverId } : {}),
          });
        }
        FlashMessage.info(
          'Saved on this device',
          activeRefund
            ? 'The addendum and its refund upload when you have signal. The customer is sent it once the refund is approved.'
            : 'The addendum is sent to the customer automatically when you have signal.'
        );
        navigation?.goBack();
        return;
      }

      // REVDSM-1300: a changed install time is checked against crew availability and held for
      // the crew as a draft before the addendum goes out — the same booking the job builder
      // makes on "Yes". Only `taken` stops the submit; an error or an unreachable server
      // leaves the addendum exactly as it was before, and the server skips a lead that
      // already has a crew.
      if (scheduleChanged && scheduleDate && scheduleDate !== 'TBD') {
        const day = new Date(scheduleDate);
        if (!isNaN(day.getTime())) {
          const booked = await bookInstallSlot({
            leadId,
            date: format(day, 'yyyy-MM-dd'),
            timeWindow: scheduleTimeWindow,
            isSale: isSaleResult,
          });
          if (booked.kind === 'taken') {
            FlashMessage.error('Install time unavailable', booked.message);
            return;
          }
        }
      }

      const draftRes = await LeadService.submitJobBuilderDraft(leadId, payload);
      const b = draftRes?.data;
      const draftId = b?.data?.draft?._id || b?.draft?._id || b?.data?._id || b?._id;

      const release = addendumReleasePlan({
        refundAcknowledged: !!activeRefund,
        hasSourceRow: !!refundSourceRow,
        gateClear: refundGate.length === 0,
        draftId,
      });
      let refundRaised = false;

      if (release === 'hold-for-approval') {
        const res = await funding.requestRefund(refundSourceRow!.pid, {
          amount: refundDue,
          method: refundMethod || 'check',
          reason: (refundReason || 'priceDrop') as FundingRefundReason,
          ...(refundNote.trim() ? { note: refundNote.trim() } : {}),
          ...(approverId ? { assignedToUserId: approverId } : {}),
          draftId,
        });
        if (!res.ok) {
          FlashMessage.error(
            'Refund not raised — nothing was sent',
            res.error?.message ||
              'The refund request did not go through, so the addendum was NOT sent to the customer. Try submitting again.'
          );
          return;
        }
        refundRaised = true;
      } else if (release === 'abort') {
        FlashMessage.error(
          'Refund not raised — nothing was sent',
          'The app could not link the refund to this addendum, so nothing was sent to the customer. Submit again to try once more.'
        );
        return;
      }

      if (draftId && !refundRaised) {
        const formattedPhone = toE164USPhone(customerPhone || readLeadPhone(lead));
        try {
          await LeadService.sendDraftSubmitEmail(draftId, {
            customerEmail: customerEmailTrimmed,
            customerPhone: formattedPhone,
          });
        } catch (emailErr) {
          console.warn('[DynamicDealEdit] draft email failed:', emailErr);
        }
      }

      const logUserId = user?._id || user?.id;
      if (logUserId) {
        logDealAddendumSubmitted({
          ...(dealLogTarget || {}),
          userId: logUserId,
          leadId,
          calculatorId: editCalculatorId || undefined,
          result: lead?.result || 'Sale',
          summary: {
            ...(draftId ? { draftId } : {}),
            contractPrice: Number(contractPrice) || 0,
            downPayment: downTotal,
            buildChanged,
            scheduleChanged,
            priceChanged,
            noteChanged,
          },
        });
      }

      FlashMessage.success(
        refundRaised ? 'Sent for approval' : 'Addendum Submitted',
        refundRaised
          ? 'The customer will be asked to sign once the refund is approved.'
          : 'The customer has been notified to sign'
      );
      navigation?.goBack();
    } catch (err: any) {
      console.error('[DynamicDealEdit] submit failed:', err);
      FlashMessage.error('Error', err?.response?.data?.message || 'Failed to submit addendum');
    } finally {
      setIsSubmitting(false);
    }
  }, [
    dealLogTarget,
    flushReviewChanges,
    leadId,
    effectiveJobState,
    jobBuilderConfig,
    dealCenterData,
    savedOutcome,
    lead,
    customerName,
    scheduleDate,
    scheduleTimeWindow,
    contractPrice,
    downTotal,
    downPaymentMethodKey,
    balanceMethodKey,
    balance,
    allocations,
    calculatorData,
    buildChangeGroups,
    customerPhone,
    customerEmailTrimmed,
    note,
    navigation,
    user,
    editCalculatorId,
    buildChanged,
    scheduleChanged,
    priceChanged,
    noteChanged,
    activeRefund,
    refundSourceRow,
    refundDue,
    refundMethod,
    refundReason,
    refundNote,
    refundGate.length,
    approverId,
    funding,
  ]);

  const goBack = useCallback(() => {
    flushPriceChanges();
    flushReviewChanges();
    setStep((s) => Math.max(0, s - 1));
  }, [flushPriceChanges, flushReviewChanges]);

  const isLoading = isDealEditLoading({
    configLoading: isConfigLoading,
    schemasLoading: isSchemasLoading,
    outcomeFetched,
    calculatorLoading: isCalculatorLoading,
    portalLoading: isPortalLoading,
  });
  const builderReady = Boolean(jobBuilderConfig && initialState);
  const isDynamicDeal = Boolean(
    lead?.jobBuilder?.isDynamic || lead?.jobBuilder?.dynamicJobState || lead?.isDynamic || savedDynamicJobState
  );

  const Header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#E2E8F0',
      }}
    >
      <TouchableOpacity
        onPress={() => {
          if (step === 2 && priceScreen === 'funding') {
            goPricing();
            return;
          }
          if (step === 2 || step === 3) {
            goBack();
            return;
          }
          navigation?.goBack();
        }}
        style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
      >
        <Ionicons name="arrow-back" size={16} color="#637381" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A' }}>Edit Job Build</Text>
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', marginTop: 1 }}>
          {step === 2 && priceScreen === 'funding' ? 'Funding' : STEP_LABELS[step]} · {customerName}
        </Text>
      </View>
      {/* Persistent exit (web keeps an always-visible close in addition to the
          step-back arrow) — lets the rep leave the wizard from steps 2/3 without
          stepping all the way back. */}
      <TouchableOpacity
        onPress={() => navigation?.goBack()}
        style={{ width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="close" size={20} color="#94A3B8" />
      </TouchableOpacity>
    </View>
  );

  /**
   * No connection and no snapshot: the deal was never opened on this device.
   *
   * ⚠️ A REFUSAL, placed ABOVE the loading gate on purpose. Every query here resolves to `null`
   * offline rather than throwing, so without this the rep gets a half-seeded wizard with blank
   * prices and no way to tell a genuinely empty field from one that failed to load - on a screen
   * that prices a contract amendment.
   */
  if (offlineState === 'unavailable') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={[]}>
        {Header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Icon name="cloud-off-outline" size={40} color="#CBD5E1" />
          <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '800', color: '#475569', textAlign: 'center' }}>
            This deal isn’t saved on your device
          </Text>
          <Text style={{ marginTop: 6, fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
            Open it once with a connection and you’ll be able to edit it offline after that.
          </Text>
          <TouchableOpacity
            onPress={() => navigation?.goBack()}
            style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#22C55E' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={[]}>
        {Header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#22C55E" />
          <Text style={{ marginTop: 12, fontSize: 13, color: '#94A3B8' }}>Loading job builder…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!hasJobBuilderConfig || !isDynamicDeal || !builderReady) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={[]}>
        {Header}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Icon name="wrench-outline" size={40} color="#CBD5E1" />
          <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '800', color: '#475569', textAlign: 'center' }}>
            {!hasJobBuilderConfig ? 'Deal editing isn’t configured yet' : 'This deal can’t be edited here'}
          </Text>
          <Text style={{ marginTop: 6, fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
            {!hasJobBuilderConfig
              ? 'No job-builder configuration has been published for this company.'
              : 'This deal has no dynamic job-builder data to edit.'}
          </Text>
          <TouchableOpacity
            onPress={() => navigation?.goBack()}
            style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#22C55E' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#F8FAFC' }} edges={[]}>
      {Header}
      {/* Funding is a sub-screen of Job Price, not a fifth step — showing the tracker
          there would claim the rep had advanced. */}
      {!(step === 2 && priceScreen === 'funding') && <StepDots step={step} />}

      <View style={{ flex: 1 }}>
        {/* STEP 0 — Install Date */}
        {step === 0 && (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {dateStep === 'intro' ? (
              <View style={styles.dateCard}>
                <Text style={styles.dateCardTitle}>Edit Job Build</Text>
                <Text style={styles.dateCardSubtitle}>Install Date</Text>

                <View style={styles.currentInstallBox}>
                  <Text style={styles.currentInstallLabel}>Current Install Date</Text>
                  <Text style={styles.currentInstallDate}>{currentInstallDateText}</Text>
                  <Text style={styles.currentInstallTime}>{currentInstallTimeText}</Text>
                </View>

                <TouchableOpacity onPress={handleOpenInstallCalendar} style={styles.primaryBtn}>
                  <Text style={styles.primaryBtnText}>Modify Install Date</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={handleSkipInstallDate} style={styles.outlineBtn}>
                  <Text style={styles.outlineBtnText}>No Change — Skip</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setShowCancelConfirm(true)} style={styles.dangerBtn}>
                  <Text style={styles.dangerBtnText}>Cancel Job</Text>
                </TouchableOpacity>
              </View>
            ) : dateStep === 'calendar' ? (
              <View style={styles.dateCard}>
                <View style={styles.calendarHeader}>
                  <TouchableOpacity onPress={() => setDateStep('intro')} hitSlop={8} style={styles.calendarBackBtn}>
                    <Text style={styles.calendarBackText}>‹ Back</Text>
                  </TouchableOpacity>
                  <Text style={styles.calendarTitle}>Select Install Date</Text>
                  {/* Balances the Back button so the title stays centred. */}
                  <View style={styles.calendarBackBtn} />
                </View>

                <InstallDateCalendar
                  selectedDate={proposedDate || parsedScheduleDate}
                  onSelect={handleInlineDateSelect}
                  leadId={lead?._id}
                />

                <Text style={styles.calendarHint}>Sundays unavailable</Text>

                <View style={styles.calendarActions}>
                  <TouchableOpacity onPress={handleSelectTbd} style={styles.tbdBtn}>
                    <Text style={styles.tbdBtnText}>TBD</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleUseSelectedDate}
                    disabled={!proposedDate}
                    style={[styles.useDateBtn, !proposedDate && styles.useDateBtnDisabled]}
                  >
                    <Text style={[styles.useDateBtnText, !proposedDate && styles.useDateBtnTextDisabled]}>
                      {proposedDate ? `Use ${format(proposedDate, 'MMM d, yy')}` : 'Select a Date'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : dateStep === 'time' ? (
              <ProposedTimeCard
                date={proposedDate}
                slot={currentInstallWindow}
                loading={installAvailabilityLoading}
                noAvailability={!installAvailabilityLoading && offeredInstallWindows.length === 0}
                noCrewForWindow={noCrewForCurrentInstall}
                otherWindowLabel={
                  otherInstallWindowIdx >= 0
                    ? offeredInstallWindows[otherInstallWindowIdx]?.value ?? null
                    : null
                }
                notice={installWindowNotice}
                booking={installBooking}
                onNo={handleProposeNextSlot}
                onYes={handleAcceptProposedTime}
                onTryOtherWindow={handleTryOtherInstallWindow}
                onPickAnotherDate={handlePickAnotherInstallDate}
              />
            ) : (
              <View style={styles.dateCard}>
                <View
                  style={[
                    styles.successIcon,
                    scheduleDate === 'TBD' ? styles.successIconTbd : styles.successIconDone,
                  ]}
                >
                  <Icon name={scheduleDate === 'TBD' ? 'help' : 'check'} size={34} color="#fff" />
                </View>

                <Text style={styles.dateCardTitle}>
                  {scheduleDate === 'TBD' ? 'Install Date Set to TBD' : 'Install Date Updated'}
                </Text>

                {scheduleDate === 'TBD' ? (
                  <Text style={styles.successCaption}>Will be scheduled at a later time</Text>
                ) : (
                  <>
                    <Text style={styles.successDate}>
                      {proposedDate ? format(proposedDate, 'EEEE, MMMM d, yyyy') : currentInstallDateText}
                    </Text>
                    <Text style={styles.successCaption}>{scheduleTimeWindow}</Text>
                  </>
                )}

                <TouchableOpacity onPress={handleFinishInstallDate} style={styles.primaryBtn}>
                  <Text style={styles.primaryBtnText}>Done — Next →</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        )}

        {/* STEP 1 — Job Build (kept mounted to preserve edits; hidden off-step) */}
        <View style={{ flex: step === 1 ? 1 : 0, display: step === 1 ? 'flex' : 'none' }}>
          <DynamicJobBuilderScreen
            navigation={navigation}
            embedded
            mode="edit"
            activityLoggingEnabled={buildStepVisited}
            initialConfig={jobBuilderConfig ?? undefined}
            calculatorSchemas={configuredSchemas}
            initialJobState={builderInitialState}
            dealCenterData={dealCenterData}
            calculatorResultData={{
              ...(calculatorResultData || {}),
              resultType: String(lead?.result || 'Sale').toLowerCase() as any,
              calculatorId: editCalculatorId || savedOutcome?.selectedCalculatorId || null,
            }}
            leadId={leadId}
            appointmentId={calculatorResultData?.appointmentId || savedOutcome?.selectedAppointmentId}
            scheduleTimeOverride={
              scheduleDate ? { date: scheduleDate, timeWindow: scheduleTimeWindow } : null
            }
            rawDocsOverride={
              lead?.jobBuilderDocuments ||
              savedOutcome?.jobBuilderDocuments ||
              savedOutcome?.leadOutcomeDocuments ||
              null
            }
            onStateChange={setEditedJobState}
            onEditComplete={() => setStep(2)}
            onEditBack={() => setStep(0)}
          />
        </View>

        {/* STEP 2 — Job Price (pricing) then Funding.
            Two screens behind one wizard step, exactly as the Deal Center's Result
            Lead sheet is: the first answers "who is paying what", the second "how far
            has each of those payments actually got". Every control on both is the one
            the Deal Center already ships (funding/PaymentRowsGroup, SegmentedChoice,
            CoverageBar, FundingView, SendLinkModal, BlockerList) — there is no second
            implementation of any of it. */}
        {step === 2 && priceScreen === 'price' && (
          <KeyboardAwareScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            bottomOffset={24}
          >
            <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, padding: 16, marginBottom: 12 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 8 }}>PREVIOUS JOB BUILD</Text>
              <TierRow tiers={tierResult.previous} />
              <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 8 }}>Contract Price</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#0F172A' }}>{fmtMoney(parsePrice(lead?.originalContractPrice))}</Text>
                <View style={{ backgroundColor: '#E0F2FE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: '#0284C7', fontWeight: '800', fontSize: 11 }}>
                    {previousMarkup.text}
                    {previousMarkup.markupPct !== null
                      ? ` ${previousMarkup.markupPct > 0 ? '+' : ''}${previousMarkup.markupPct}%`
                      : ''}
                  </Text>
                </View>
              </View>
            </View>

            <View style={{ backgroundColor: '#fff', borderWidth: 2, borderColor: '#22C55E', borderRadius: 14, padding: 16, marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 11, fontWeight: '800', color: '#22C55E', letterSpacing: 0.5 }}>NEW JOB BUILD</Text>
                <TouchableOpacity
                  onPress={handleAutoAdjust}
                  style={{ backgroundColor: '#22C55E', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <Icon name="refresh" size={14} color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Auto Adjust</Text>
                </TouchableOpacity>
              </View>
              {!tierResult.changed && (
                <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 8 }}>
                  No priced quantity change detected from the build — set the contract price manually.
                </Text>
              )}
              <TierRow tiers={tierResult.next} highlight />

              <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginTop: 8, marginBottom: 4 }}>Contract Price</Text>
              {/* Always editable on this screen — an addendum exists to re-price the
                  job. AMBER is therefore not a lock, it is "this needs a second look":
                  a lender decision or a price move means the balance no longer matches
                  what was approved. */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderWidth: 1.5,
                  borderColor: contractPriceError ? '#DC2626' : priceUnlocked ? FUND.AMBER : '#CBD5E1',
                  backgroundColor: priceUnlocked && !contractPriceError ? FUND.AMBER_CARD_BG : '#fff',
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  marginBottom: contractPriceError ? 4 : 12,
                }}
              >
                <Text style={{ color: '#94A3B8', marginRight: 6, fontSize: 16 }}>$</Text>
                <TextInput
                  value={String(contractPrice)}
                  onChangeText={(t) => setContractPrice(parseFloat(t.replace(/[^0-9.]/g, '')) || 0)}
                  keyboardType={NUMERIC_KEYBOARD}
                  returnKeyType="done"
                  style={{ flex: 1, fontSize: 16, fontWeight: '800', color: '#0F172A', paddingVertical: 10 }}
                />
                {priceUnlocked && (
                  <View style={{ backgroundColor: FUND.AMBER_BG, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginRight: 6 }}>
                    <Text style={{ color: FUND.AMBER_TEXT, fontWeight: '800', fontSize: 9.5, letterSpacing: 0.4 }}>NEEDS ATTENTION</Text>
                  </View>
                )}
                <View style={{ backgroundColor: '#E0F2FE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: '#0284C7', fontWeight: '800', fontSize: 11 }}>
                    {newMarkup.text}
                    {newMarkup.markupPct !== null
                      ? ` ${newMarkup.markupPct > 0 ? '+' : ''}${newMarkup.markupPct}%`
                      : ''}
                  </Text>
                </View>
              </View>
              {!!contractPriceError && (
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#DC2626', marginBottom: 12 }}>
                  {contractPriceError}
                </Text>
              )}
              {priceUnlocked && !contractPriceError && (
                <Text style={{ fontSize: 11.5, fontWeight: '700', lineHeight: 16, marginBottom: 12, color: FUND.AMBER_TEXT }}>
                  {PRICE_ATTENTION_HINT}
                </Text>
              )}

              {/* PAYMENT — the contract and everything paying it.
                  ⚠️ Deliberately NOT the Result Lead sheet's recessed FUND.PANEL block.
                  The My Deals mockup puts a plain bold heading over free-standing
                  lines directly on this card, so the groups render `layout="plain"`
                  and the panel would be a second, competing container around them. */}
              <View style={{ marginTop: 4, marginBottom: 4 }}>
                {/* How the contract is being paid. Locked once a payment has started
                    — see switchPayMode. */}
                <DropdownChoice<PayStructure>
                  label="How is this being paid?"
                  value={payStructureOf(payMode, noDown)}
                  onSelect={selectStructure}
                  hint={structureHint(payMode, structureIsLocked, structureNudge, noDown)}
                  hintTone={structureIsLocked ? 'warn' : 'muted'}
                  options={[
                    { value: 'none', title: 'No Down Payment', disabled: structureIsLocked },
                    { value: 'split', title: 'Down Payment', disabled: structureIsLocked },
                    { value: 'upfront', title: 'Paid in Full Upfront', disabled: structureIsLocked },
                  ]}
                />

                {payMode === 'upfront' ? (
                  <>
                    {decisionBanners}
                    <PaymentRowsGroup
                      title="Upfront"
                      layout="plain"
                      onRestore={restorePlan}
                      total={downTotal}
                      rows={upRows}
                      allRows={activeRows}
                      price={contractNum}
                      plans={pricing.plans}
                      options={pricing.outcomeDownPaymentMethods}
                      needsRowId={needsRowId}
                      canAdd={MULTI_METHOD_ENABLED}
                      onChangeAmount={(id, t) => updateRow(id, { amount: t })}
                      onChangeMethod={selectRowMethod}
                      onRemove={removeRow}
                      onAdd={() => addRow('up')}
                      footer={
                        <>
                          {/* Upfront has no remainder row to hide a gap in, so this is
                              the only running total the rep gets. */}
                          <CoverageBar assigned={totalAssigned} target={contractNum} />
                          <Text style={{ fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 9, marginHorizontal: 4, color: FUND.MUTED }}>
                            Paid in full at the table, so there is no balance to finance. Lender plans are not offered here.
                          </Text>
                        </>
                      }
                    />
                  </>
                ) : (
                  <>
                    {/* ── the refund, where the rep is actually standing ──

                        ⚠️ This block used to live ONLY on the Review step, which is the
                        bug QA hit: the over-allocation gate below made Review
                        unreachable, so answering YES to the warning appeared to do
                        nothing at all. The money is over-collected HERE, so the
                        explanation belongs here too.

                        It carries the approval RAIL and the APPROVER, because both
                        answer the question the rep has the moment the price drops: what
                        happens now, and who has to say yes. The rest of the form —
                        method, reason and the note to the approver — stays on Review
                        beside "Send Addendum To", where the rep is already deciding
                        what the paperwork says and who receives it. */}
                    {activeRefund && (
                      <View style={{ backgroundColor: '#FFF1F2', borderWidth: 1.5, borderColor: '#FDA4AF', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, color: '#9F1239' }}>
                            REFUND DUE TO CUSTOMER
                          </Text>
                          <Text style={{ fontSize: 19, fontWeight: '800', color: '#BE123C' }}>−{fmtMoney(refundDue)}</Text>
                        </View>
                        <Text style={{ fontSize: 11.5, fontWeight: '600', color: '#BE123C', lineHeight: 17, marginTop: 6 }}>
                          {fmtMoney(collectedTotal(funding.payments))} has already been collected and the new
                          price is {fmtMoney(contractNum)}. The difference goes back to the customer.
                        </Text>

                        {/* ⚠️ **INFORMATION ONLY on this step — the approval PROCESS
                            lives on Review.** The status rail and the approver picker
                            used to be here as well; they were removed on request
                            because Review already carries both beside "Send Addendum
                            To", and two copies of one process on one wizard read as two
                            different things to do.

                            What stays is the half a rep needs *at the moment the price
                            drops*: how much goes back, and why. The rest — who signs it
                            off, where the request has got to — belongs where the rep is
                            deciding what the paperwork says.

                            ⚠️ Safe to drop the picker here ONLY because the approver is
                            still REQUIRED at Submit: `refundBlockers` pushes "Choose who
                            approves this refund" into `refundGate`, which gates
                            `submitBlocked` on Review. It does NOT gate this step's
                            Confirm, so removing it strands nobody. If that ever changes,
                            the picker has to come back here or Confirm becomes a dead
                            end with no control on screen to clear it. */}
                        <Text style={{ fontSize: 11.5, fontWeight: '700', color: '#9F1239', lineHeight: 17, marginTop: 10 }}>
                          Nothing has been sent yet. Tap{' '}
                          <Text style={{ fontWeight: '900' }}>Confirm</Text>, then{' '}
                          <Text style={{ fontWeight: '900' }}>Next · Review</Text> — you choose an approver and
                          send the refund there.
                        </Text>
                      </View>
                    )}

                    {/* The price is below what was collected but the rep has not agreed to
                        a refund, so the over-allocation blocker below still stands. Say
                        which two choices clear it, or the disabled Confirm is a puzzle. */}
                    {needsRefund && !refundAcknowledged && (
                      <View style={{ backgroundColor: FUND.AMBER_BG, borderWidth: 1.5, borderColor: FUND.AMBER_BORDER, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12 }}>
                        <Text style={{ fontSize: 12, fontWeight: '800', color: FUND.AMBER_TEXT, marginBottom: 4 }}>
                          This price needs a refund
                        </Text>
                        <Text style={{ fontSize: 11.5, fontWeight: '600', color: FUND.AMBER_TEXT, lineHeight: 17 }}>
                          {fmtMoney(collectedTotal(funding.payments))} has been collected, so {fmtMoney(refundDue)} would
                          have to go back. Either raise the contract price, or continue and send the refund
                          for approval.
                        </Text>
                        <TouchableOpacity
                          onPress={() => setShowRefundPrompt(true)}
                          style={{ alignSelf: 'flex-start', marginTop: 10, minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: FUND.AMBER }}
                        >
                          <Text style={{ fontSize: 12.5, fontWeight: '800', color: '#fff' }}>Continue with a refund</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {!noDown && (
                    <PaymentRowsGroup
                      title="Down Payment"
                      layout="plain"
                      onRestore={restorePlan}
                      total={downTotal}
                      rows={downRows}
                      allRows={activeRows}
                      price={contractNum}
                      plans={pricing.plans}
                      options={pricing.outcomeDownPaymentMethods}
                      needsRowId={needsRowId}
                      canAdd={MULTI_METHOD_ENABLED}
                      onChangeAmount={(id, t) => updateRow(id, { amount: t })}
                      onChangeMethod={selectRowMethod}
                      onRemove={removeRow}
                      onAdd={() => addRow('down')}
                    />
                    )}

                    {/* ⚠️ Why the collected line above cannot be edited. The LOCK itself
                        is not new — `isSettledRow` already freezes any charged or
                        collected row (amount read-only, no Swap, no Remove), which is
                        exactly Lance’s rule and is stricter in the right direction. What
                        was missing is the rep being told, so a frozen field reads as a
                        decision rather than a bug. */}
                    {downLocked && (
                      <Text style={{ fontSize: 11, color: '#94A3B8', lineHeight: 16, marginTop: -2, marginBottom: 8 }}>
                        The down payment has already been collected and cannot be changed. Adjust the
                        balance instead — or drop the contract price below it, which raises a refund.
                      </Text>
                    )}

                    {decisionBanners}

                    <PaymentRowsGroup
                      title="Balance"
                      layout="plain"
                      onRestore={restorePlan}
                      total={balanceTotal}
                      rows={balRows}
                      allRows={activeRows}
                      price={contractNum}
                      plans={pricing.plans}
                      categories={pricing.categories}
                      needsRowId={needsRowId}
                      canAdd={MULTI_METHOD_ENABLED}
                      onChangeAmount={(id, t) => updateRow(id, { amount: t })}
                      onChangeMethod={selectRowMethod}
                      onRemove={removeRow}
                      onAdd={() => addRow('bal')}
                    />
                  </>
                )}
              </View>

              {/* RESULT — locked to Sale until a lender actually declines. Once one
                  has, the only other honest outcome for this job becomes selectable,
                  and the switch goes through the SERVER, which refuses it without a
                  logged decline on the record. */}
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 6 }}>Result</Text>
              {declineHappened ? (
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => handleSetFundingResult('sale')}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: bankDeclined ? '#E5E7EB' : '#34D399', backgroundColor: bankDeclined ? '#fff' : '#ECFDF5' }}
                  >
                    <Text style={{ fontSize: 13.5, fontWeight: '700', color: bankDeclined ? '#6B7280' : '#047857' }}>Sale</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleSetFundingResult('bank_decline')}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: bankDeclined ? '#FDA4AF' : '#E5E7EB', backgroundColor: bankDeclined ? '#FFF1F2' : '#fff' }}
                  >
                    <Text style={{ fontSize: 13.5, fontWeight: '700', color: bankDeclined ? '#BE123C' : '#6B7280' }}>Bank Decline</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <View style={{ borderWidth: 1.5, borderColor: '#E5E7EB', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, backgroundColor: '#F9FAFB' }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827' }}>Sale</Text>
                  </View>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: FUND.MUTED, marginTop: 6 }}>
                    Locked to Sale unless a lender declines.
                  </Text>
                </>
              )}
            </View>
          </KeyboardAwareScrollView>
        )}

        {/* STEP 2b — Funding. Every callback is an ENDPOINT: nothing here ticks a
            step locally, the screen redraws from the record each one returns. */}
        {step === 2 && priceScreen === 'funding' && (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <FundingView
              payments={funding.payments}
              payMode={payMode}
              contractTotal={contractNum}
              covered={covered}
              bankDeclined={bankDeclined}
              log={attempts}
              lastSyncedAt={lastSyncedAt}
              syncingAll={funding.syncingAll}
              busyPid={funding.busyPid}
              paymentsSetupError={funding.paymentsSetupError}
              onSyncAll={funding.syncAll}
              onSyncOne={funding.syncPayment}
              onSendLink={openSendSheet}
              onMarkCollected={funding.markCheckCollected}
              onChargeCard={funding.chargeCard}
              onActivate={funding.activateLoan}
              onRecordDecision={funding.recordDecision}
              onReactivate={funding.reactivateLoan}
              refunds={refundsOnJob(funding.payments)}
              reminderFor={(r) =>
                r?.rid && jobRefund?.rid && String(r.rid) === String(jobRefund.rid)
                  ? {
                      reminder: refundApproval.reminder,
                      approverName: refundApproval.approverName || approverName,
                      onRemind: refundApproval.remind,
                      reminding: refundApproval.sending,
                    }
                  : null
              }
              onEditPayments={goPricing}
              onResultAsBankDecline={() => handleSetFundingResult('bank_decline')}
              onUndoBankDecline={() => handleSetFundingResult('sale')}
            />
          </ScrollView>
        )}

        {/* STEP 3 — Review & Submit */}
        {step === 3 && (
          <KeyboardAwareScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            bottomOffset={24}
          >
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 2 }}>Addendum Review</Text>
            <Text style={{ fontSize: 13, color: '#94A3B8', marginBottom: 14 }}>{customerName}</Text>

            {/* ⚠️ The diff's ORIGINAL side moves until the saved calculator lands.
                `initialState` is hydrated with `dealCenterData`, which is built from
                `calculatorData` — and that falls back to the outcome/lead copies
                (usually empty) while this query is in flight. Rendering the review
                then compares the edit against a PARTIALLY-hydrated original, so a
                previous value reads low (the ticket: an old grid total of 48 shown
                as 4). It self-corrected on any later re-render, which is exactly why
                it reproduced on an iPhone 7 and not on a fast simulator — the race is
                against the rep reaching this step.

                This is not cosmetic: `buildChangeGroups` is SUBMITTED as
                `buildChangeSummary`, so a stale diff would be written onto the
                addendum the customer signs. Hence a hold rather than a best-effort
                render, and Submit is disabled alongside it. */}
            {isCalculatorLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <ActivityIndicator size="small" color="#22C55E" />
                <Text style={{ fontWeight: '700', color: '#64748B', marginTop: 10 }}>Loading the saved build…</Text>
                <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>Comparing your changes against it.</Text>
              </View>
            ) : !hasAnyChange ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ fontWeight: '700', color: '#64748B' }}>No changes made</Text>
                <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>Go back and modify the build, schedule, or price.</Text>
              </View>
            ) : (
              <View style={{ marginBottom: 14 }}>
                {buildChangeGroups.map((group) => (
                  <View key={group.vertical} style={{ marginBottom: 10 }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: '#64748B', marginBottom: 4 }}>{group.vertical}</Text>
                    {groupComboRows(group.changes).map((entry, i) =>
                      entry.blocks ? (
                        <ComboSectionCard
                          key={`${entry.label}-${i}`}
                          label={entry.label}
                          blocks={entry.blocks}
                        />
                      ) : (
                        <ReviewRow
                          key={`${entry.change.field}-${i}`}
                          label={entry.change.field}
                          from={entry.change.from}
                          to={entry.change.to}
                          kind={entry.change.kind}
                        />
                      )
                    )}
                  </View>
                ))}
                {scheduleChanged && (
                  <ReviewRow
                    label="Install Date"
                    from={`${lead?.jobBuilder?.scheduleTime?.date || 'TBD'} ${lead?.jobBuilder?.scheduleTime?.timeWindow || ''}`.trim()}
                    to={`${scheduleDate} ${scheduleTimeWindow}`.trim()}
                  />
                )}
                {priceChanged && (
                  <ReviewRow label="Contract Price" from={fmtMoney(parsePrice(lead?.originalContractPrice))} to={fmtMoney(contractPrice)} />
                )}
                {downPaymentChanged && (
                  <ReviewRow label="Down Payment" from={fmtMoney(parsePrice(lead?.downPayment))} to={fmtMoney(downTotal)} />
                )}
                {downPaymentMethodChanged && (
                  <ReviewRow
                    label="Down Pmt Method"
                    from={resolvePlanLabel(lead?.paymentMethod, '')}
                    to={resolvePlanLabel(downPaymentMethodKey, '')}
                  />
                )}
                {balanceMethodChanged && (
                  <ReviewRow
                    label="Balance Method"
                    from={resolvePlanLabel(lead?.balancePaymentMethod, '')}
                    to={resolvePlanLabel(balanceMethodKey, '')}
                  />
                )}
              </View>
            )}

            <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, padding: 16, marginBottom: 14 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#0F172A', marginBottom: 2 }}>Additional Notes</Text>
              <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 8 }}>Shown to the customer on the addendum.</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Enter a note"
                placeholderTextColor="#94A3B8"
                multiline
                textAlignVertical="top"
                style={{ borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0F172A', minHeight: 72 }}
              />
            </View>

            <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, padding: 16 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#0F172A', marginBottom: 8 }}>Send Addendum To</Text>
              <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Phone Number</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: customerPhoneError ? '#DC2626' : '#CBD5E1', borderRadius: 10, paddingHorizontal: 12 }}>
                <Text style={{ color: '#94A3B8', marginRight: 4, fontSize: 14 }}>+1</Text>
                <TextInput
                  value={customerPhone}
                  onChangeText={(t) => setCustomerPhone(formatLocalUSPhone(t))}
                  keyboardType="phone-pad"
                  maxLength={12}
                  placeholder="443-878-4937"
                  placeholderTextColor="#94A3B8"
                  style={{ flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 10 }}
                />
              </View>
              {!!customerPhoneError && (
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#DC2626', marginTop: 6 }}>
                  {customerPhoneError}
                </Text>
              )}

              <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 14, marginBottom: 4 }}>
                Email Address <Text style={{ color: '#CBD5E1' }}>(optional)</Text>
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: customerEmailError ? '#DC2626' : '#CBD5E1', borderRadius: 10, paddingHorizontal: 12 }}>
                <Icon name="email-outline" size={16} color="#94A3B8" style={{ marginRight: 6 }} />
                <TextInput
                  value={customerEmail}
                  onChangeText={setCustomerEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  placeholder="name@example.com"
                  placeholderTextColor="#94A3B8"
                  style={{ flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 10 }}
                />
              </View>
              {!!customerEmailError && (
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#DC2626', marginTop: 6 }}>
                  {customerEmailError}
                </Text>
              )}
              <Text style={{ fontSize: 11, color: '#94A3B8', marginTop: 8, lineHeight: 15 }}>
                {customerEmailTrimmed
                  ? 'The addendum is texted and emailed to the customer.'
                  : 'The addendum is texted to the customer. Add an email to send a copy.'}
              </Text>
            </View>

            {/* ── the refund, and who has to approve it ──
                ⚠️ Rendered ONLY when money actually has to go back and the rep has
                answered YES to the warning. An ordinary addendum must not grow a
                mandatory field — install date, scope, materials and a price that
                goes UP all need no approval at all. */}
            {activeRefund && (
              <View style={{ backgroundColor: '#FFF1F2', borderWidth: 1.5, borderColor: '#FDA4AF', borderRadius: 14, padding: 16, marginTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, color: '#9F1239' }}>
                    REFUND DUE TO CUSTOMER
                  </Text>
                  <Text style={{ fontSize: 19, fontWeight: '800', color: '#BE123C' }}>−{fmtMoney(refundDue)}</Text>
                </View>
                <Text style={{ fontSize: 11.5, fontWeight: '600', color: '#BE123C', lineHeight: 17, marginTop: 6 }}>
                  The new price is below what has already been collected, so money has to go back.
                  An approver has to sign off before the customer sees this.
                </Text>

                {/* ⚠️ **The ONLY status rail in the wizard now.** The pricing step
                    carried a second copy until it was removed on request — Review is
                    where the request actually goes out, and the one thing worth reading
                    here is that approval is the SECOND of four steps rather than the end
                    of it. It is also the only place the rep can chase a silent approver,
                    since the reminder button lives on this rail. */}
                <View style={{ height: 1, backgroundColor: '#FBCFE8', marginTop: 12, marginBottom: 12 }} />
                <RefundStatusRail
                  amount={refundDue}
                  refund={jobRefund}
                  reminder={refundApproval.reminder}
                  approverName={refundApproval.approverName || approverName}
                  onRemind={refundApproval.remind}
                  reminding={refundApproval.sending}
                />

                <Text style={{ fontSize: 11, color: '#9F1239', marginTop: 14, marginBottom: 5 }}>How the money goes back</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {([
                    { v: 'card' as const, label: 'Back to the card' },
                    { v: 'check' as const, label: 'Cheque in the post' },
                  ])
                    // ⚠️ Card is hidden with no signal: it reverses through the processor,
                    // which the device cannot do. Cheque stays, and queues.
                    .filter((o) => o.v !== 'card' || (refundSourceRow?.type === 'cc' && online))
                    .map((o) => (
                      <TouchableOpacity
                        key={o.v}
                        onPress={() => setRefundMethod(o.v)}
                        style={{ flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 9, alignItems: 'center', borderColor: refundMethod === o.v ? '#BE123C' : '#FBCFE8', backgroundColor: refundMethod === o.v ? '#FFE4E6' : '#fff' }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: refundMethod === o.v ? '#9F1239' : '#9CA3AF' }}>{o.label}</Text>
                      </TouchableOpacity>
                    ))}
                </View>

                <Text style={{ fontSize: 11, color: '#9F1239', marginTop: 14, marginBottom: 5 }}>Reason</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                  {(Object.keys(REFUND_REASON_LABELS) as (keyof typeof REFUND_REASON_LABELS)[]).map((r) => (
                    <TouchableOpacity
                      key={r}
                      onPress={() => setRefundReason(r)}
                      style={{ borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, borderColor: refundReason === r ? '#BE123C' : '#FBCFE8', backgroundColor: refundReason === r ? '#FFE4E6' : '#fff' }}
                    >
                      <Text style={{ fontSize: 11.5, fontWeight: '700', color: refundReason === r ? '#9F1239' : '#9CA3AF' }}>
                        {REFUND_REASON_LABELS[r]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <RefundApproverRow
                  selectedName={approverName}
                  isLoading={approverFeed.isLoading}
                  isConfigured={approverFeed.isConfigured}
                  isError={approverFeed.isError}
                  onRetry={approverFeed.refetch}
                  locked={approverLocked}
                  onPress={() => setShowApproverPicker(true)}
                />

                <Text style={{ fontSize: 11, color: '#9F1239', marginTop: 14, marginBottom: 5 }}>Note (optional)</Text>
                <TextInput
                  value={refundNote}
                  onChangeText={setRefundNote}
                  placeholder="Anything the approver should know"
                  placeholderTextColor="#D6A2AC"
                  multiline
                  style={{ borderWidth: 1.5, borderColor: '#FBCFE8', backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 60, fontSize: 13, color: '#0F172A', textAlignVertical: 'top' }}
                />
              </View>
            )}
          </KeyboardAwareScrollView>
        )}
      </View>

      {/* The approver picker. Fed from `/lead/v1/approvals/approvers`, which is the
          ONLY list of who may approve — the company config stores role ids and this
          endpoint is the join to people, so a client-side filter would offer choices
          the server then refuses. */}
      <UserPickerModal
        visible={showApproverPicker}
        users={approverOptions}
        selectedId={approverId}
        title="Send for approval to"
        subtitle={`Refund of ${fmtMoney(refundDue)}`}
        emptyText="No refund approvers are configured for your company"
        isLoading={approverFeed.isLoading}
        onSelect={(u) => setApproverId(u.id)}
        onClose={() => setShowApproverPicker(false)}
      />

      {/* Footer — Price / Funding / Review steps (Install Date + Build own their nav) */}
      {(step === 2 || step === 3) && (
        <View style={{ padding: 16, paddingBottom: Math.max(insets.bottom, 16), borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff' }}>
          {step === 2 && priceScreen === 'funding' ? (
            <>
              {/* The same checklist the Deal Center's Submit footer shows. The
                  SERVER's list replaces it the moment a save or submit is refused —
                  that one is authoritative and already ordered.

                  ⚠️ It reports, it does not BLOCK. Submitting an addendum has never
                  required funding to be complete, and a job whose links cannot be sent
                  yet (the company-wide charges_enabled gate) is exactly the case where
                  gating Review would strand the rep with no way forward on a change
                  the customer still has to sign. */}
              <BlockerList
                items={fundingBlockerList}
                readyText="✓ Every payment is as far as you can take it."
                override={
                  bankDeclined
                    ? { title: 'No funding to satisfy.', body: 'The job is closing as a bank decline.' }
                    : undefined
                }
              />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TouchableOpacity
                  onPress={goPricing}
                  style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 }}
                >
                  <Text style={{ fontWeight: '800', fontSize: 13, color: '#334155' }}>Edit payments</Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                <TouchableOpacity
                  onPress={handleNextToReview}
                  style={{ backgroundColor: '#0F172A', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                >
                  <Text style={{ fontWeight: '800', fontSize: 13, color: '#fff' }}>Next · Review</Text>
                  <Icon name="arrow-right" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              {/* Why Confirm is off, listed above it — the price floor first, then the
                  allocation rules. Same control, same reasoning as the funding footer:
                  the rep works a list instead of tapping a grey button and being told no. */}
              {step === 2 && <BlockerList items={confirmGate} title="Before you can confirm:" />}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TouchableOpacity onPress={goBack} disabled={isSubmitting} style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 }}>
                  <Text style={{ fontWeight: '800', fontSize: 13, color: '#334155' }}>Back</Text>
                </TouchableOpacity>
                <View style={{ flex: 1 }} />
                {step === 2 ? (
                  <TouchableOpacity
                    onPress={goFunding}
                    disabled={confirmGate.length > 0 || funding.isSaving}
                    style={{ backgroundColor: confirmGate.length > 0 ? '#CBD5E1' : '#0F172A', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: funding.isSaving ? 0.7 : 1 }}
                  >
                    {funding.isSaving && <ActivityIndicator size="small" color="#fff" />}
                    <Text style={{ fontWeight: '800', fontSize: 13, color: '#fff' }}>Confirm</Text>
                    <Icon name="arrow-right" size={16} color="#fff" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    onPress={handleSubmit}
                    disabled={submitBlocked}
                    style={{ backgroundColor: submitBlocked ? '#CBD5E1' : '#22C55E', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: isSubmitting ? 0.7 : 1 }}
                  >
                    {isSubmitting && <ActivityIndicator size="small" color="#fff" />}
                    {/* ⚠️ The label names the refund when there is one. "Submit Addendum"
                        alone is why a rep asked how to raise the request: the refund is
                        filed by THIS tap (draft first, then `POST …/refund` carrying its
                        `draftId`), and nothing said so. An ordinary addendum — install
                        date, scope, materials, a price that went UP — keeps the plain
                        label, since none of those raise anything. */}
                    <Text style={{ fontWeight: '800', fontSize: 13, color: '#fff' }} numberOfLines={1}>
                      {activeRefund ? 'Submit & Request Refund' : 'Submit Addendum'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </View>
      )}

      {/* Share sheet — an in-sheet overlay, not a nested Modal (see SendLinkModal),
          mounted as the LAST child of the screen root so it covers the footer too. It
          reports the send; the STEP comes back on the record, never from here. */}
      {!!linkPayment && (
        <SendLinkModal
          payment={linkPayment}
          link={linkUrl}
          isLoadingLink={isLoadingLink}
          isSending={funding.busyPid === linkPayment.pid}
          blockedReason={funding.paymentsSetupError}
          onSend={handleSendLink}
          onCopyLink={() =>
            logFundingLinkCopied({
              ...fundingLog,
              payment: {
                pid: linkPayment.pid,
                method: linkPayment.method,
                type: linkPayment.type,
                kind: linkPayment.kind,
                amount: linkPayment.amount,
              },
            })
          }
          onClose={() => {
            setLinkTarget(null);
            setLinkUrl('');
          }}
        />
      )}

      {/* ⚠️ Both of this screen’s questions now go through ONE dialog. The card is
          the geometry this one always had — it moved into `ConfirmDialog` rather than
          being redesigned — and the refund warning, which used to be a native Alert in
          OS chrome, joins it. */}
      <ConfirmDialog
        visible={showCancelConfirm}
        title="Cancel this job?"
        message="This job will be marked as Cancelled."
        note="This cannot be undone."
        tone="danger"
        confirmLabel="Yes, Cancel"
        busy={isSubmitting}
        onConfirm={handleCancelJob}
        onCancel={() => setShowCancelConfirm(false)}
      />

      {/* The price has dropped below what has already been collected. ⚠️ The copy is
          Lance’s, verbatim — do not reword it. Only YES makes the refund real. */}
      <ConfirmDialog
        visible={showRefundPrompt}
        title="Refund required"
        message={REFUND_APPROVAL_WARNING}
        note={`${fmtMoney(refundDue)} would have to go back to the customer, and an approver has to sign off before they see the addendum.`}
        tone="warn"
        confirmLabel="Yes, continue"
        cancelLabel="No"
        onConfirm={() => {
          setRefundAcknowledged(true);
          setShowRefundPrompt(false);
        }}
        onCancel={() => {
          setRefundAcknowledged(false);
          setShowRefundPrompt(false);
        }}
      />
    </SafeAreaView>
  );
}

function InstallDateCalendar({
  selectedDate,
  onSelect,
  leadId,
}: {
  selectedDate: Date | null;
  onSelect: (day: Date) => void;
  leadId?: string;
}) {
  const [currentMonth, setCurrentMonth] = useState<Date>(() => selectedDate || new Date());
  // Days no crew can take are dulled out. Empty until the scheduler answers.
  const { blocked: blockedDays } = useInstallCalendarAvailability(currentMonth, leadId, true);
  const daysInMonth = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) });
  const startDay = getDay(startOfMonth(currentMonth));
  const dayLabels = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, marginBottom: 12 }}>
      {/* Web layout: month + caret on the left, nav chevrons grouped on the right. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <Text style={{ fontSize: 16, fontWeight: '900', color: '#334155' }}>{format(currentMonth, 'MMMM yyyy')}</Text>
          <Icon name="chevron-down" size={20} color="#94A3B8" />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={() => setCurrentMonth(subMonths(currentMonth, 1))} style={{ padding: 4 }}>
            <Icon name="chevron-left" size={24} color="#94A3B8" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setCurrentMonth(addMonths(currentMonth, 1))} style={{ padding: 4 }}>
            <Icon name="chevron-right" size={24} color="#94A3B8" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ flexDirection: 'row', marginBottom: 8 }}>
        {dayLabels.map((d, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '900', color: '#94A3B8' }}>
            {d}
          </Text>
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {Array.from({ length: startDay }).map((_, i) => (
          <View key={`blank-${i}`} style={{ width: '14.28%', height: 44 }} />
        ))}
        {daysInMonth.map((day, i) => {
          const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
          const isToday = isSameDay(day, new Date());
          const isDisabled =
            day < startOfToday() || getDay(day) === 0 || blockedDays.has(format(day, 'yyyy-MM-dd'));
          return (
            <TouchableOpacity
              key={i}
              disabled={isDisabled}
              onPress={() => onSelect(day)}
              style={{ width: '14.28%', height: 44, alignItems: 'center', justifyContent: 'center' }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isSelected ? '#22C55E' : 'transparent',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: '900', color: isSelected ? '#fff' : isDisabled ? '#E2E8F0' : '#475569' }}>
                  {format(day, 'd')}
                </Text>
              </View>
              {isToday && !isSelected && (
                <View style={{ position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: '#22C55E' }} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function ProposedTimeCard({
  date,
  slot,
  loading,
  noAvailability,
  noCrewForWindow,
  otherWindowLabel,
  notice,
  booking,
  onNo,
  onYes,
  onTryOtherWindow,
  onPickAnotherDate,
}: {
  date: Date | null;
  slot: { period: string; value: string };
  loading?: boolean;
  noAvailability?: boolean;
  /** This window came back `taken` from the booking call (REVDSM-1300). */
  noCrewForWindow?: boolean;
  /** Label of the other window, when one is left that has not failed. */
  otherWindowLabel?: string | null;
  notice?: { tone: 'ok' | 'warn'; text: string } | null;
  booking?: boolean;
  onNo: () => void;
  onYes: () => void;
  onTryOtherWindow?: () => void;
  onPickAnotherDate?: () => void;
}) {
  if (!date) return null;

  if (loading) {
    return (
      <View style={styles.dateCard}>
        <Text style={styles.dateCardTitle}>Checking availability…</Text>
        <ActivityIndicator size="small" color="#22C55E" />
      </View>
    );
  }

  // This window was just taken by someone else (REVDSM-1300, 409). More specific than
  // `noAvailability`, so it is checked first: name the window that failed and offer the two
  // ways out, exactly as the job builder's scheduler does.
  if (noCrewForWindow) {
    return (
      <View style={styles.dateCard}>
        <Text style={styles.dateCardTitle}>No crew available</Text>
        <Text style={styles.confirmDate}>{format(date, 'EEEE, MMMM d, yyyy')}</Text>
        <Text style={styles.confirmPrompt}>
          {`No crew can take this job on ${format(date, 'EEEE, MMM d')} from ${slot.value}.`}
        </Text>
        {!!otherWindowLabel && (
          <TouchableOpacity onPress={onTryOtherWindow} style={[styles.useDateBtn, { marginBottom: 12 }]}>
            <Text style={styles.useDateBtnText}>{`Try ${otherWindowLabel}`}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onPickAnotherDate} style={styles.tbdBtn}>
          <Text style={styles.tbdBtnText}>Pick Another Date</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Nothing a crew can reach in time: say so instead of offering a window that cannot be booked.
  if (noAvailability) {
    return (
      <View style={styles.dateCard}>
        <Text style={styles.dateCardTitle}>No availability</Text>
        <Text style={styles.confirmDate}>{format(date, 'EEEE, MMMM d, yyyy')}</Text>
        <Text style={styles.confirmPrompt}>No crew can take this job on that day.</Text>
        <TouchableOpacity onPress={onNo} style={styles.useDateBtn}>
          <Text style={styles.useDateBtnText}>Pick Another Date</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.dateCard}>
      <Text style={styles.dateCardTitle}>Confirm Time Window</Text>
      <Text style={styles.confirmDate}>{format(date, 'EEEE, MMMM d, yyyy')}</Text>

      <View style={styles.windowBox}>
        <Text style={styles.windowLabel}>{slot.period.toUpperCase()}</Text>
        <Text style={styles.windowValue}>{slot.value}</Text>
        <Text style={styles.windowCaption}>Arrival window</Text>
      </View>

      {!!notice && (
        <Text
          style={{
            marginBottom: 16,
            paddingHorizontal: 12,
            paddingVertical: 10,
            borderRadius: 10,
            overflow: 'hidden',
            textAlign: 'center',
            fontWeight: '700',
            fontSize: 12.5,
            color: notice.tone === 'warn' ? '#8A5A00' : '#047857',
            backgroundColor: notice.tone === 'warn' ? '#FFF7E6' : '#ECFDF5',
          }}
        >
          {notice.text}
        </Text>
      )}

      <Text style={styles.confirmPrompt}>Work for the customer?</Text>

      <View style={styles.calendarActions}>
        <TouchableOpacity onPress={onNo} style={styles.tbdBtn}>
          <Text style={styles.tbdBtnText}>Doesn&apos;t Work</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onYes}
          disabled={booking}
          style={[styles.useDateBtn, booking ? { opacity: 0.7 } : null]}
        >
          <Text style={styles.useDateBtnText}>
            {booking ? 'Checking…' : notice?.tone === 'warn' ? 'Confirm Anyway' : 'Confirm'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StepDots({ step }: { step: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
      {STEP_LABELS.map((label, s) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: s <= step ? '#22C55E' : '#E2E8F0',
            }}
          >
            {s < step ? (
              <Icon name="check" size={14} color="#fff" />
            ) : (
              <Text style={{ fontSize: 12, fontWeight: '800', color: s <= step ? '#fff' : '#94A3B8' }}>{s + 1}</Text>
            )}
          </View>
          {s < STEP_LABELS.length - 1 && (
            <View style={{ width: 22, height: 2, marginHorizontal: 4, backgroundColor: s < step ? '#22C55E' : '#E2E8F0' }} />
          )}
        </View>
      ))}
    </View>
  );
}

function TierRow({ tiers, highlight }: { tiers: Tiers; highlight?: boolean }) {
  const cells: [string, number][] = [
    ['COST', tiers.cost],
    ['PAR', tiers.par],
    ['RETAIL', tiers.retail],
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {cells.map(([label, value]) => {
        const isRetail = highlight && label === 'RETAIL';
        return (
          <View
            key={label}
            style={{
              flex: 1,
              alignItems: 'center',
              paddingVertical: 8,
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor: isRetail ? '#22C55E' : '#E2E8F0',
              backgroundColor: isRetail ? '#DCFCE7' : 'transparent',
            }}
          >
            <Text style={{ fontSize: 10, fontWeight: '800', color: '#94A3B8' }}>{label}</Text>
            <Text style={{ fontSize: 14, fontWeight: '900', color: '#0F172A' }}>{fmtMoney(value)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ComboSectionCard({ label, blocks }: { label: string; blocks: ComboBlock[] }) {
  return (
    <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
      {!!label && <Text style={styles.comboSectionTitle}>{label}</Text>}
      <View style={styles.comboOuter}>
        {blocks.map((block, bi) => {
          const eyebrow =
            block.kind === 'removed' ? 'REMOVED' : block.kind === 'added' ? 'ADDED' : 'UPDATED';
          const valueColor = block.kind === 'removed' ? '#94A3B8' : '#15803D';
          return (
            <View key={`${block.title}-${bi}`} style={bi ? styles.comboBlockSpaced : undefined}>
              <View style={styles.comboBlockHead}>
                <Text style={styles.comboBlockTitle}>{block.title}</Text>
                <Text
                  style={[
                    styles.comboBlockKind,
                    block.kind === 'removed' ? { color: '#DC2626' } : null,
                  ]}
                >
                  {eyebrow}
                </Text>
              </View>
              <View style={styles.comboCard}>
                {block.rows.map((f, i) => (
                  <View key={`${f.label}-${i}`} style={styles.comboRow}>
                    {/* `flexShrink` on BOTH columns, so a long label wraps instead of
                        shunting the value off the right edge of a phone. */}
                    <Text style={styles.comboLabel}>{f.label}</Text>
                    <View style={{ flexShrink: 1 }}>
                      {/* Only an EDIT has a previous value; an em dash means the field
                          was empty before, and striking one reads as "something was
                          there". */}
                      {!!f.from && f.from !== '—' && <Text style={styles.comboFrom}>{f.from}</Text>}
                      {/* An untouched measurement is there to NAME the combination, not to
                          report a change, so it stays neutral — green would read as newly
                          entered. */}
                      <Text
                        style={[
                          styles.comboValue,
                          { color: f.unchanged ? '#334155' : valueColor },
                        ]}
                      >
                        {f.value}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function ReviewRow({
  label,
  from,
  to,
  kind,
}: {
  label: string;
  from: string;
  to: string;
  kind?: BuildChangeKind;
}) {
  const eyebrow = kind === 'removed' ? 'REMOVED' : kind === 'added' ? 'ADDED' : 'NEW';
  const eyebrowColor = kind === 'removed' ? '#DC2626' : '#94A3B8';
  const valueColor = kind === 'removed' ? '#94A3B8' : '#15803D';

  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
      {/* `minWidth: 0` is the flexbox guard that lets this column actually shrink
          below its content width — without it a long build-field label pushes the
          row wider instead of wrapping, squeezing everything to its right. */}
      <View style={{ flex: 1, flexShrink: 1, minWidth: 0, paddingRight: 12 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>{label}</Text>
        {/* An ADDED combination has no previous value — striking through an em
            dash would read as "something was there before". */}
        {kind !== 'added' && (
          <Text style={{ fontSize: 11, color: '#DC2626', textDecorationLine: 'line-through' }}>{from}</Text>
        )}
      </View>
      {/* Payment-plan labels are long sentences ("2511 (6 Months 0% Interest No
          Payments…)"), so the value column must SHRINK and wrap — RN defaults a
          View to flexShrink: 0, which would push it off-screen. Web wraps it the
          same way, right-aligned. */}
      <View style={{ alignItems: 'flex-end', flexShrink: 1, maxWidth: '55%' }}>
        <Text style={{ fontSize: 10, fontWeight: '700', color: eyebrowColor }}>{eyebrow}</Text>
        <Text style={{ fontSize: 13, fontWeight: '800', color: valueColor, textAlign: 'right' }}>{to}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  comboCard: {
    backgroundColor: '#E6F4F7',
    borderWidth: 1,
    borderColor: '#CFE7EC',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  comboRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  comboLabel: {
    flexShrink: 1,
    paddingRight: 12,
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  comboValue: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  comboFrom: {
    fontSize: 11,
    color: '#DC2626',
    textAlign: 'right',
    textDecorationLine: 'line-through',
  },
  comboSectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 8,
  },
  comboOuter: {
    borderWidth: 1,
    borderColor: '#CFE7EC',
    borderRadius: 14,
    backgroundColor: '#F8FCFD',
    padding: 12,
  },
  comboBlockSpaced: {
    marginTop: 14,
  },
  comboBlockHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  comboBlockTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#64748B',
  },
  comboBlockKind: {
    fontSize: 10,
    fontWeight: '700',
    color: '#94A3B8',
  },
  dateCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  dateCardTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  dateCardSubtitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 16,
  },
  currentInstallBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 20,
  },
  currentInstallLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#94A3B8',
    marginBottom: 6,
  },
  currentInstallDate: {
    fontSize: 20,
    fontWeight: '900',
    color: '#0F172A',
    marginBottom: 4,
  },
  currentInstallTime: {
    fontSize: 13,
    color: '#64748B',
  },
  primaryBtn: {
    backgroundColor: '#22C55E',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  outlineBtn: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
    marginBottom: 10,
  },
  outlineBtnText: { color: '#0F172A', fontSize: 15, fontWeight: '800' },
  dangerBtn: {
    backgroundColor: '#EF4444',
    borderRadius: 10,
    paddingVertical: 15,
    alignItems: 'center',
  },
  dangerBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  calendarBackBtn: { width: 56 },
  calendarBackText: { color: '#22C55E', fontSize: 14, fontWeight: '800' },
  calendarTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
  },
  calendarHint: {
    fontSize: 11,
    color: '#94A3B8',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 14,
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 20,
  },
  successIconTbd: { backgroundColor: '#00B8D9' },
  successIconDone: { backgroundColor: '#22C55E' },
  successDate: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  successCaption: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 24,
  },
  confirmDate: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  windowBox: {
    borderWidth: 2,
    borderColor: '#22C55E',
    backgroundColor: '#F0FDF4',
    borderRadius: 12,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 24,
  },
  windowLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#15803D',
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  windowValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#22C55E',
    marginBottom: 6,
  },
  windowCaption: { fontSize: 12, color: '#15803D' },
  confirmPrompt: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  calendarActions: { flexDirection: 'row', gap: 12 },
  tbdBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  tbdBtnText: { color: '#0F172A', fontSize: 15, fontWeight: '800' },
  useDateBtn: {
    flex: 1,
    backgroundColor: '#22C55E',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  useDateBtnDisabled: { backgroundColor: '#E2E8F0' },
  useDateBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  useDateBtnTextDisabled: { color: '#94A3B8' },
});
