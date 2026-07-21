import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  addDays,
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
import {
  serializeDynamicJobStateForStorage,
  deserializeDynamicJobStateFromStorage,
  hydrateJobStateForPersistence,
} from '../../../utils/dynamic-job-builder/engine/dynamic-job-state-storage';
import {
  computeEditedTiers,
  resolveTierPaymentMethod,
  getMarkupInfo,
  parsePrice,
  type Tiers,
} from '../utils/dynamic-deal-pricing';
import { computeDynamicBuildChanges } from '../utils/dynamic-deal-diff';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';

/**
 * 4-step DYNAMIC deal-edit wizard. Faithful port of web
 * `src/sections/deal/components/dynamic-deal-edit-modal.js` (`DynamicDealEditModal`).
 * Reached from Deal Detail → Edit (web: ContractDetails pencil → isDynamicDeal
 * branch). Steps mirror `STEP_LABELS`:
 *
 *   0 Install Date  — reschedule the install appointment via an inline calendar +
 *                     propose-a-time card (web parity), or skip to keep the current
 *   1 Job Build     — embed the DYNAMIC job builder in edit mode (unlockAll, no
 *                     allocation trackers), streaming edited state up
 *   2 Job Price     — reconfirm rollout tiers + contract price + payment methods
 *   3 Review&Submit — diff the build/schedule/price and submit a pending-signature
 *                     ADDENDUM draft (submitJobBuilderDraft + sendDraftSubmitEmail).
 *                     Editing does NOT re-run /job-builder or upsert the portal record.
 */

const STEP_LABELS = ['Install Date', 'Job Build', 'Job Price', 'Review & Submit'];

const fmtMoney = (n: any) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

// Install time windows for the inline "propose a time" step (web parity).
const INSTALL_WINDOWS = [
  { period: 'AM', value: '8:00 AM - 12:00 PM' },
  { period: 'PM', value: '12:00 PM - 4:00 PM' },
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

  const {
    config: jobBuilderConfig,
    isConfigured: hasJobBuilderConfig,
    isLoading: isConfigLoading,
  } = useDynamicCalculatorSchemas();
  const { configuredSchemas, isLoading: isSchemasLoading, pricingConfig } = useCalculatorSchema();
  const pricing = useDealPricing(lead);

  // ── step + edit state ──────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [editedJobState, setEditedJobState] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  const [scheduleTimeWindow, setScheduleTimeWindow] = useState('');
  // Inline install-date rescheduler (web parity): the Step-0 calendar and the
  // "propose a time" card both live in the step itself, not a modal. `dateStep`
  // toggles between them; picking a calendar date proposes a time for it.
  const [dateStep, setDateStep] = useState<'calendar' | 'time'>('calendar');
  const [proposedDate, setProposedDate] = useState<Date | null>(null);
  const [proposedSlotIdx, setProposedSlotIdx] = useState(0);

  const [contractPrice, setContractPrice] = useState(0);
  const [downPayment, setDownPayment] = useState(0);
  const [downPaymentMethod, setDownPaymentMethod] = useState('');
  const [balanceMethod, setBalanceMethod] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const seededRef = useRef(false);

  // The calculator whose outcome this edit session belongs to. DealDetail passes
  // it on the pencil tap; fall back to the lead's own reference.
  const editCalculatorId =
    calculatorResultData?.calculatorId ||
    lead?.selectedCalculatorId ||
    lead?.calculatorId ||
    lead?.jobBuilder?.calculatorId ||
    lead?.outcome?.selectedCalculatorId ||
    lead?.leadData?.selectedCalculatorId ||
    null;

  // ── load the authoritative saved outcome ───────────────────────────────────
  // Web parity: a resulted deal is scoped to ONE calculator, so read
  // `GET lead/v1/{leadId}/outcome/{calculatorId}` when we know which calculator
  // is being edited. Only fall back to the lead-wide
  // `GET lead/v1/{leadId}/outcome` for legacy deals that carry no calculator id.
  const { data: savedOutcome, isFetched: outcomeFetched } = useQuery({
    queryKey: ['dealEditOutcome', leadId, editCalculatorId],
    queryFn: async () => {
      try {
        const res = editCalculatorId
          ? await LeadService.getLeadOutcomeByCalculator(leadId!, editCalculatorId)
          : await LeadService.getJobBuilder(leadId!);
        const body = res.data;
        return body?.data?.outcome ?? body?.outcome ?? body?.data ?? body ?? null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(leadId),
    staleTime: 30_000,
  });

  // ── load the REAL saved calculator (accurate COST/PAR/RETAIL) ───────────────
  // Web reads the deal's stored `LFCalculator` (with its `entries`/`totals`) and
  // prices the Previous/New tiers from it — those are the accurate figures shown
  // when the lead was created. Mobile's outcome comes back with `lfCalculator: null`
  // (it never persists the subdoc), so without this the tiers fall back to pricing
  // the build through the schema against a lead-polluted `dealCenterData`, which
  // produces the garbage values (e.g. $134k retail on a $200 job). The calculator
  // itself IS saved on the backend at `GET /lfcalculators/{id}` — fetch it so the
  // stored path (`computeStoredTiers`) yields the SAME accurate tiers as the web.
  const { data: fetchedCalculator } = useQuery({
    queryKey: ['dealEditCalculator', editCalculatorId],
    queryFn: async () => {
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

  // Seed schedule/price/method state from the lead once, on first load.
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    const sched = lead?.jobBuilder?.scheduleTime || lead?.jobBuilderData?.scheduleTime || {};
    setScheduleDate(sched.date || null);
    setScheduleTimeWindow(sched.timeWindow || '');
    setContractPrice(parsePrice(lead?.originalContractPrice));
    setDownPayment(parsePrice(lead?.downPayment));
    // Payment methods start UNSELECTED ("Select payment method") — the rep explicitly
    // chooses. The submit payload falls back to the lead's saved method when left
    // blank, so nothing is lost by not pre-seeding them here.
    setDownPaymentMethod('');
    setBalanceMethod('');
    setCustomerPhone(lead?.customerDetails?.phone || lead?.customerDetails?.phoneNumber || '');
  }, [lead]);

  // ── derive: saved dynamic state, calculator, dealCenterData, initial state ──
  const savedDynamicJobState = useMemo(
    () =>
      savedOutcome?.jobBuilder?.dynamicJobState ||
      savedOutcome?.dynamicJobState ||
      lead?.jobBuilder?.dynamicJobState ||
      null,
    [savedOutcome, lead]
  );

  const calculatorData = useMemo(
    () =>
      // Prefer the freshly-fetched calculator (real entries/totals) so the tiers are
      // accurate; fall back to whatever the outcome/lead carried (usually empty).
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
        // Feed the saved calculator's per-field entries (the LFCalculator `entries`
        // array of { fieldId, inputValue }) — same as the ORIGINAL build
        // (DynamicDealCenterScreen). Passing `{}` here left dealCenterData without
        // any calculator field values, so every calculator-driven LOCKED field
        // (LeafFilter/Gutter Extras: C-S-R, Corners, footage, …) resolved blank via
        // resolveLockedValue on reopen. `buildDealCenterData` reads this with
        // Object.values, so an array is accepted.
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
      // `preserveExisting = true` — REQUIRED here, and this is exactly what the flag
      // exists for (see hydrateFieldValue in dynamic-job-state-storage.ts). Without
      // it, every LOCKED (calculator-driven) field is re-resolved from
      // `dealCenterData` and the saved value is overwritten by whatever
      // resolveLockedValue returns — which is the field's blank `defaultValue`
      // whenever the dcField can't be resolved.
      //
      // It usually CAN'T be resolved on this path: dealCenterData is built from
      // `calculatorData.entries`, sourced from `savedOutcome.LFCalculator`, but
      // mobile deliberately never sends LFCalculator (buildCalculatorOutcomePayload
      // omits it — the in-memory CalcTab lacks the backend subdoc's required
      // createdBy/appointmentId), so the outcome comes back with
      // `lfCalculator: null`. dealCenterData is therefore empty and every locked
      // field resolves blank. That is why the Gutters "Extras" section — which is
      // almost entirely locked fields — reopened empty in the My Deals reschedule
      // flow, while combo-group sections (ordinary unlocked fields) survived.
      //
      // In edit mode the saved value is the authoritative one regardless: the rep is
      // reopening their own entered data, not re-deriving it from the calculator.
      return hydrateJobStateForPersistence(deserialized, jobBuilderConfig, dealCenterData, true);
    } catch (err) {
      console.warn('[DynamicDealEdit] deserialize failed:', err);
      return null;
    }
  }, [jobBuilderConfig, savedDynamicJobState, dealCenterData]);

  const effectiveJobState = editedJobState || initialState;

  // ── payment options (web useGetPaymentPlans → paymentOptions) ───────────────
  // Full catalog — used for key coercion + the Balance Method picker (financing
  // plans allowed on the balance, web parity: PaymentPlanSelect).
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

  // Down Pmt Method: cash/card ONLY (Check / MC-VISA-DSCVR / AMEX) — never the
  // financing plans. Web parity (`downPaymentOptions`: p.type === 'cash' || 'card').
  // `pricing.outcomeDownPaymentMethods` is already that Lowe's-aware basics subset.
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

  // Both default to '' (unselected → "Select payment method") until the rep picks.
  const balanceMethodKey = balanceMethod ? coerceToPlanKey(balanceMethod, '') : '';
  const downPaymentMethodKey = downPaymentMethod ? coerceToPlanKey(downPaymentMethod, '') : '';

  // ── tiers (web computeEditedTiers) ──────────────────────────────────────────
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
  const balance = Math.max(0, (Number(contractPrice) || 0) - (Number(downPayment) || 0));
  const newMarkup = getMarkupInfo(contractPrice, tierResult.next, undefined);
  // Markup badge for the PREVIOUS build's contract price vs its tiers (web parity —
  // the previous card shows a "RETAIL +X%" badge next to its contract price too).
  const previousMarkup = getMarkupInfo(parsePrice(lead?.originalContractPrice), tierResult.previous, undefined);

  // Current install date parsed for the inline calendar highlight, and formatted
  // for display (fixes the raw-ISO string that was shown, e.g. 2026-07-17T20:00:00
  // -04:00 → 7/17/2026 · <window>). Mirrors AppointmentSchedulerModal's parsing.
  const parsedScheduleDate = useMemo(() => {
    if (!scheduleDate || scheduleDate === 'TBD') return null;
    const d = new Date(scheduleDate);
    return isNaN(d.getTime()) ? null : d;
  }, [scheduleDate]);
  const currentInstallLabel = useMemo(() => {
    if (!scheduleDate) return 'Not Scheduled';
    if (scheduleDate === 'TBD') return `TBD${scheduleTimeWindow ? ` · ${scheduleTimeWindow}` : ''}`;
    const dateStr = parsedScheduleDate ? format(parsedScheduleDate, 'M/d/yyyy') : scheduleDate;
    return `${dateStr}${scheduleTimeWindow ? ` · ${scheduleTimeWindow}` : ''}`;
  }, [scheduleDate, scheduleTimeWindow, parsedScheduleDate]);

  // ── change detection + diff ─────────────────────────────────────────────────
  const buildChangeGroups = useMemo(
    () => (editedJobState ? computeDynamicBuildChanges(initialState, editedJobState, jobBuilderConfig) : []),
    [editedJobState, initialState, jobBuilderConfig]
  );
  const buildChanged = buildChangeGroups.some((g) => g.changes.length > 0);
  const rawBuildChanged = useMemo(() => {
    if (!editedJobState || !initialState) return false;
    try {
      return JSON.stringify(editedJobState) !== JSON.stringify(initialState);
    } catch {
      return false;
    }
  }, [editedJobState, initialState]);

  const scheduleChanged =
    !!scheduleDate &&
    (scheduleDate !== (lead?.jobBuilder?.scheduleTime?.date || null) ||
      scheduleTimeWindow !== (lead?.jobBuilder?.scheduleTime?.timeWindow || ''));
  const priceChanged = parsePrice(lead?.originalContractPrice) !== Number(contractPrice);
  const hasAnyChange =
    buildChanged ||
    rawBuildChanged ||
    scheduleChanged ||
    priceChanged ||
    parsePrice(lead?.downPayment) !== Number(downPayment) ||
    // Only count a method as changed once the rep has actually PICKED one — a blank
    // "Select payment method" (the default) must not read as a change.
    (!!downPaymentMethodKey && coerceToPlanKey(lead?.paymentMethod, '') !== downPaymentMethodKey) ||
    (!!balanceMethodKey && coerceToPlanKey(lead?.balancePaymentMethod, '') !== balanceMethodKey);

  // ── handlers ────────────────────────────────────────────────────────────────
  // Tap a calendar date → propose the first time window for it (web parity).
  const handleInlineDateSelect = useCallback((day: Date) => {
    setProposedDate(day);
    setProposedSlotIdx(0);
    setDateStep('time');
  }, []);

  // "No" on the proposed time → next window, or roll to the next non-Sunday day.
  const handleProposeNextSlot = useCallback(() => {
    if (proposedSlotIdx < INSTALL_WINDOWS.length - 1) {
      setProposedSlotIdx(proposedSlotIdx + 1);
    } else {
      let next = addDays(proposedDate || new Date(), 1);
      while (getDay(next) === 0) next = addDays(next, 1);
      setProposedDate(next);
      setProposedSlotIdx(0);
    }
  }, [proposedSlotIdx, proposedDate]);

  // "Yes" → commit the proposed schedule and advance to the Job Build step.
  const handleAcceptProposedTime = useCallback(() => {
    if (!proposedDate) return;
    setScheduleDate(format(proposedDate, 'M/d/yyyy'));
    setScheduleTimeWindow(INSTALL_WINDOWS[proposedSlotIdx].value);
    setDateStep('calendar');
    setProposedDate(null);
    setStep(1);
  }, [proposedDate, proposedSlotIdx]);

  const handleBackToCalendar = useCallback(() => {
    setDateStep('calendar');
    setProposedDate(null);
  }, []);

  const handleAutoAdjust = useCallback(() => {
    const { previous, next } = tierResult;
    const original = parsePrice(lead?.originalContractPrice) || contractPrice;
    // Preserve the markup the PREVIOUS card shows (e.g. "COST +75%"), not the raw
    // retail ratio. The badge measures the premium over the nearest LOWER tier, and
    // the tiers do NOT scale uniformly when the build changes (cost/par/retail each
    // move by a different factor), so scaling the price by the retail ratio left the
    // New badge reading a different % (COST +169%). Scale by the SAME tier the badge
    // is based on so the New card reproduces the previous markup: with pct = original
    // premium over previous[baseKey], newContract = next[baseKey] × (original /
    // previous[baseKey]) lands the New price at the identical premium over next[baseKey].
    const info = getMarkupInfo(original, previous);
    const baseKey = info.baseKey;
    const prevBase = baseKey ? previous[baseKey] : 0;
    const nextBase = baseKey ? next[baseKey] : 0;
    if (baseKey && prevBase > 0 && nextBase > 0) {
      setContractPrice(Math.round(nextBase * (original / prevBase)));
    } else if (previous.retail > 0 && next.retail > 0) {
      setContractPrice(Math.round(next.retail * (original / previous.retail)));
    } else if (next.par > 0) {
      setContractPrice(Math.round(next.par * 1.1));
    }
  }, [tierResult, lead, contractPrice]);

  const handleCancelJob = useCallback(async () => {
    if (!leadId) return;
    setIsSubmitting(true);
    try {
      await LeadService.cancelLead(leadId, lead);
      FlashMessage.success('Job Cancelled', 'This job was marked cancelled');
      setShowCancelConfirm(false);
      navigation?.goBack();
    } catch (err: any) {
      FlashMessage.error('Error', err?.response?.data?.message || 'Failed to cancel job');
    } finally {
      setIsSubmitting(false);
    }
  }, [leadId, lead, navigation]);

  const handleSubmit = useCallback(async () => {
    if (!leadId) return;
    setIsSubmitting(true);
    try {
      // Persisted state is document-free — the draft endpoint reads docs from the
      // TOP LEVEL. Serialize runtime ids → storage keys (web parity).
      const stateForSubmit = { ...(effectiveJobState || {}), agreements: [], orderSheets: [] };
      // preserveExisting=true: this wizard renders the builder in editMode, so the
      // rep may override locked (calculator-driven) fields. Persist their explicit
      // entries instead of reverting them to the stale dealCenterData snapshot.
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

      // LFCalculator is a backend subdoc with REQUIRED `createdBy`/`appointmentId`/
      // `title`. Web always sends a COMPLETE one (it persists a real LFCalculator);
      // mobile deliberately never persists LFCalculator (see repo guide §5), so
      // `calculatorData` here is usually empty/partial. Sending that partial subdoc
      // is exactly what tripped the 500 — "JobBuilderDraft validation failed:
      // LFCalculator.createdBy/appointmentId/title required". Only attach it when it
      // is a complete subdoc; otherwise omit it (the top-level `originalContractPrice`
      // / `selectedCalculatorId` already carry what the addendum needs).
      const lfCalculatorComplete = Boolean(
        calculatorData &&
          typeof calculatorData === 'object' &&
          (calculatorData as any).createdBy &&
          (calculatorData as any).appointmentId &&
          (calculatorData as any).title
      );

      const payload: any = {
        result: lead?.result || 'Sale',
        lastPriceQuoted: lead?.lastPriceQuoted || '',
        originalContractPrice: String(contractPrice),
        // Normalize to a number-string (web parity): an empty field still saves "0"
        // so it doesn't read as a phantom down-payment change on the customer's addendum.
        downPayment: String(Number(downPayment) || 0),
        paymentMethod: downPaymentMethodKey || lead?.paymentMethod || '',
        balancePaymentMethod: balanceMethodKey || lead?.balancePaymentMethod || '',
        balance: String(balance),
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
        // Snapshot the build diff for the customer consent page (web parity).
        buildChangeSummary: buildChangeGroups,
      };
      if (lfCalculatorComplete) payload.LFCalculator = calculatorData;

      // Attach any NEW captures the rep added while editing that already carry
      // inline data (data:/base64). Existing S3 docs are skipped (not re-uploaded).
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

      const draftRes = await LeadService.submitJobBuilderDraft(leadId, payload);
      const b = draftRes?.data;
      const draftId = b?.data?.draft?._id || b?.draft?._id || b?.data?._id || b?._id;

      if (draftId) {
        const rawPhone = customerPhone || lead?.customerDetails?.phone || '';
        const formattedPhone = String(rawPhone).startsWith('+')
          ? rawPhone
          : `+1${String(rawPhone).replace(/[^0-9]/g, '')}`;
        try {
          await LeadService.sendDraftSubmitEmail(draftId, {
            customerEmail: lead?.customerDetails?.email || '',
            customerPhone: formattedPhone,
          });
        } catch (emailErr) {
          console.warn('[DynamicDealEdit] draft email failed:', emailErr);
        }
      }

      FlashMessage.success('Addendum Submitted', 'The customer has been notified to sign');
      navigation?.goBack();
    } catch (err: any) {
      console.error('[DynamicDealEdit] submit failed:', err);
      FlashMessage.error('Error', err?.response?.data?.message || 'Failed to submit addendum');
    } finally {
      setIsSubmitting(false);
    }
  }, [
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
    downPayment,
    downPaymentMethodKey,
    balanceMethodKey,
    balance,
    calculatorData,
    buildChangeGroups,
    customerPhone,
    navigation,
  ]);

  const goBack = () => setStep((s) => Math.max(0, s - 1));

  // Wait on the calculator schemas too (web parity): the Step-2 tiers price the
  // edited build THROUGH those schemas, so rendering before they load would show
  // a zero-delta price. Mirrors web's `configLoading || schemasLoading || …` gate.
  const isLoading = isConfigLoading || isSchemasLoading || !outcomeFetched;
  const builderReady = Boolean(jobBuilderConfig && initialState);
  const isDynamicDeal = Boolean(
    lead?.jobBuilder?.isDynamic || lead?.jobBuilder?.dynamicJobState || lead?.isDynamic || savedDynamicJobState
  );

  // ── render ───────────────────────────────────────────────────────────────
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
        onPress={() => (step === 2 || step === 3 ? goBack() : navigation?.goBack())}
        style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
      >
        <Ionicons name="arrow-back" size={16} color="#637381" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A' }}>Edit Job Build</Text>
        <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', marginTop: 1 }}>
          {STEP_LABELS[step]} · {customerName}
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

  if (isLoading) {
    return (
      // edges={[]} — DynamicDealCenter is in the nav `showHeader` list, so the root
      // SafeAreaView already applies the top inset + global header; adding it again
      // here would double-pad the top.
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
      <StepDots step={step} />

      <View style={{ flex: 1 }}>
        {/* STEP 0 — Install Date */}
        {step === 0 && (
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {/* Compact "Current" pill (web parity): label left, value inline right. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F1F5F9', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#94A3B8' }}>Current</Text>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#0F172A', flexShrink: 1, textAlign: 'right', marginLeft: 12 }}>
                {currentInstallLabel}
              </Text>
            </View>

            {dateStep === 'calendar' ? (
              <>
                {/* Inline calendar (web parity: the edit step opens directly on
                    the calendar). Tapping a date proposes a time for it below. */}
                <InstallDateCalendar selectedDate={parsedScheduleDate} onSelect={handleInlineDateSelect} />

                {/* Hint above two side-by-side actions (web parity). */}
                <Text style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 4, marginBottom: 14, lineHeight: 16 }}>
                  Sundays unavailable · Pick a date to propose a time, or Skip to keep the current one.
                </Text>

                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <TouchableOpacity
                    onPress={() => setStep(1)}
                    style={{ flex: 1, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#334155', fontWeight: '800', fontSize: 14 }}>No Change — Skip</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setShowCancelConfirm(true)}
                    style={{ flex: 1, borderWidth: 1, borderColor: '#FDBA74', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
                  >
                    <Text style={{ color: '#EA580C', fontWeight: '800', fontSize: 14 }}>Cancel Job</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              /* Propose-a-time card shown after a calendar date is tapped. */
              <ProposedTimeCard
                date={proposedDate}
                slot={INSTALL_WINDOWS[proposedSlotIdx]}
                onNo={handleProposeNextSlot}
                onYes={handleAcceptProposedTime}
                onBack={handleBackToCalendar}
              />
            )}
          </ScrollView>
        )}

        {/* STEP 1 — Job Build (kept mounted to preserve edits; hidden off-step) */}
        <View style={{ flex: step === 1 ? 1 : 0, display: step === 1 ? 'flex' : 'none' }}>
          <DynamicJobBuilderScreen
            navigation={navigation}
            embedded
            mode="edit"
            initialConfig={jobBuilderConfig ?? undefined}
            initialJobState={initialState}
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
            // Web parity: the amendment view must show the agreements/order sheets
            // saved on the original deal. The builder's own outcome GET is skipped in
            // edit mode, so hand it the raw docs from the deal we already fetched.
            // A RESULTED deal carries its docs under `lead.jobBuilderDocuments`
            // (the same source DealDetail renders, and what web's `dealEditMode`
            // prefers in `refreshDocumentsFromServer` — `jobBuilderDocuments` over
            // `leadOutcomeDocuments`). The calculator-scoped outcome often echoes NO
            // `leadOutcomeDocuments`, so reading only that showed "No documents" on
            // the summary even when agreements existed. Prefer jobBuilderDocuments,
            // falling back to either outcome-echoed shape.
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

        {/* STEP 2 — Job Price */}
        {step === 2 && (
          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
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
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 12, marginBottom: 12 }}>
                <Text style={{ color: '#94A3B8', marginRight: 6, fontSize: 16 }}>$</Text>
                <TextInput
                  value={String(contractPrice)}
                  onChangeText={(t) => setContractPrice(parseFloat(t.replace(/[^0-9.]/g, '')) || 0)}
                  keyboardType="numeric"
                  style={{ flex: 1, fontSize: 16, fontWeight: '800', color: '#0F172A', paddingVertical: 10 }}
                />
                <View style={{ backgroundColor: '#E0F2FE', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
                  <Text style={{ color: '#0284C7', fontWeight: '800', fontSize: 11 }}>
                    {newMarkup.text}
                    {newMarkup.markupPct !== null
                      ? ` ${newMarkup.markupPct > 0 ? '+' : ''}${newMarkup.markupPct}%`
                      : ''}
                  </Text>
                </View>
              </View>

              {/* Down Payment + its method, side by side (web parity). */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 4 }}>Down Payment</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 10 }}>
                    <Text style={{ color: '#94A3B8', marginRight: 4 }}>$</Text>
                    <TextInput
                      value={String(downPayment)}
                      onChangeText={(t) => setDownPayment(parseFloat(t.replace(/[^0-9.]/g, '')) || 0)}
                      keyboardType="numeric"
                      style={{ flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 12 }}
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 4 }}>Down Pmt Method</Text>
                  <MethodPicker
                    options={downPaymentOptions}
                    selected={downPaymentMethodKey}
                    onSelect={(k) => setDownPaymentMethod(k)}
                    allowNone
                  />
                </View>
              </View>

              {/* Balance + its method, side by side (web parity). */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 4 }}>Balance</Text>
                  <View style={{ borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 13, backgroundColor: '#F1F5F9' }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#0F172A' }}>{fmtMoney(balance)}</Text>
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 4 }}>Balance Method</Text>
                  <MethodPicker
                    options={paymentOptions}
                    selected={balanceMethodKey}
                    onSelect={(k) => setBalanceMethod(k)}
                    // Grouped picker (Basic / GreenSky / Wells Fargo / …) with proper
                    // plan labels — same categorised list the rollout / job-builder
                    // payment picker uses, instead of a flat unlabelled dropdown.
                    categories={pricing?.categories}
                  />
                </View>
              </View>
            </View>
          </ScrollView>
        )}

        {/* STEP 3 — Review & Submit */}
        {step === 3 && (
          <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 2 }}>Addendum Review</Text>
            <Text style={{ fontSize: 13, color: '#94A3B8', marginBottom: 14 }}>{customerName}</Text>

            {!hasAnyChange ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ fontWeight: '700', color: '#64748B' }}>No changes made</Text>
                <Text style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>Go back and modify the build, schedule, or price.</Text>
              </View>
            ) : (
              <View style={{ marginBottom: 14 }}>
                {buildChangeGroups.map((group) => (
                  <View key={group.vertical} style={{ marginBottom: 10 }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: '#64748B', marginBottom: 4 }}>{group.vertical}</Text>
                    {group.changes.map((c, i) => (
                      <ReviewRow key={`${c.field}-${i}`} label={c.field} from={c.from} to={c.to} />
                    ))}
                  </View>
                ))}
                {buildChangeGroups.length === 0 && rawBuildChanged && (
                  <ReviewRow label="Job Build" from="Previous build" to="Updated build" />
                )}
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
                {parsePrice(lead?.downPayment) !== Number(downPayment) && (
                  <ReviewRow label="Down Payment" from={fmtMoney(parsePrice(lead?.downPayment))} to={fmtMoney(downPayment)} />
                )}
              </View>
            )}

            <View style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, padding: 16 }}>
              <Text style={{ fontSize: 14, fontWeight: '800', color: '#0F172A', marginBottom: 8 }}>Send Addendum To</Text>
              <Text style={{ fontSize: 11, color: '#94A3B8', marginBottom: 4 }}>Phone Number</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 12 }}>
                <Text style={{ color: '#94A3B8', marginRight: 4, fontSize: 14 }}>+1</Text>
                <TextInput
                  value={customerPhone}
                  onChangeText={setCustomerPhone}
                  keyboardType="phone-pad"
                  placeholder="Enter phone number"
                  placeholderTextColor="#94A3B8"
                  style={{ flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 10 }}
                />
              </View>
            </View>
          </ScrollView>
        )}
      </View>

      {/* Footer — Price / Review steps (Install Date + Build own their nav) */}
      {(step === 2 || step === 3) && (
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: Math.max(insets.bottom, 16), borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff', gap: 12 }}>
          <TouchableOpacity onPress={goBack} disabled={isSubmitting} style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 12 }}>
            <Text style={{ fontWeight: '800', fontSize: 13, color: '#334155' }}>Back</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }} />
          {step === 2 ? (
            <TouchableOpacity onPress={() => setStep(3)} style={{ backgroundColor: '#0F172A', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={{ fontWeight: '800', fontSize: 13, color: '#fff' }}>Next · Review</Text>
              <Icon name="arrow-right" size={16} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSubmit}
              disabled={isSubmitting || !hasAnyChange}
              style={{ backgroundColor: hasAnyChange ? '#22C55E' : '#CBD5E1', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: isSubmitting ? 0.7 : 1 }}
            >
              {isSubmitting && <ActivityIndicator size="small" color="#fff" />}
              <Text style={{ fontWeight: '800', fontSize: 13, color: '#fff' }}>Submit Addendum</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Cancel Job confirmation */}
      <Modal visible={showCancelConfirm} transparent animationType="fade" onRequestClose={() => setShowCancelConfirm(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 340 }}>
            <Text style={{ fontSize: 17, fontWeight: '900', color: '#0F172A', textAlign: 'center' }}>Cancel this job?</Text>
            <Text style={{ fontSize: 13, color: '#64748B', textAlign: 'center', marginTop: 8 }}>
              This job will be marked as Cancelled. This cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <TouchableOpacity onPress={() => setShowCancelConfirm(false)} disabled={isSubmitting} style={{ flex: 1, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}>
                <Text style={{ fontWeight: '800', color: '#334155' }}>Go Back</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCancelJob} disabled={isSubmitting} style={{ flex: 1, backgroundColor: '#DC2626', borderRadius: 10, paddingVertical: 12, alignItems: 'center' }}>
                {isSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ fontWeight: '800', color: '#fff' }}>Yes, Cancel</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── subcomponents ────────────────────────────────────────────────────────────

/**
 * Inline install-date calendar for edit Step 0 (web parity). Same date-fns logic
 * as AppointmentSchedulerModal's `renderCalendar`: Sundays and past dates are
 * disabled, the current install date is highlighted, today gets a dot. Tapping a
 * selectable date calls `onSelect`, which opens the scheduler on its time step.
 */
function InstallDateCalendar({
  selectedDate,
  onSelect,
}: {
  selectedDate: Date | null;
  onSelect: (day: Date) => void;
}) {
  const [currentMonth, setCurrentMonth] = useState<Date>(() => selectedDate || new Date());
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
          const isDisabled = day < startOfToday() || getDay(day) === 0;
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

/**
 * "Propose a time" card shown after a calendar date is tapped (web parity):
 * full date, an AM/PM window pill, Yes/No, and a "Back to calendar" link. "No"
 * cycles to the next window/day; "Yes" commits the schedule.
 */
function ProposedTimeCard({
  date,
  slot,
  onNo,
  onYes,
  onBack,
}: {
  date: Date | null;
  slot: { period: string; value: string };
  onNo: () => void;
  onYes: () => void;
  onBack: () => void;
}) {
  if (!date) return null;
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', padding: 24, alignItems: 'center' }}>
      <Text style={{ fontSize: 12, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.5, marginBottom: 8 }}>Proposed Install Date</Text>
      <Text style={{ fontSize: 20, fontWeight: '900', color: '#1E293B', marginBottom: 14, textAlign: 'center' }}>
        {format(date, 'EEEE, MMMM d, yyyy')}
      </Text>

      <View style={{ backgroundColor: '#DCFCE7', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 8, marginBottom: 20 }}>
        <Text style={{ fontSize: 15, fontWeight: '900', color: '#15803D' }}>{`${slot.period} · ${slot.value}`}</Text>
      </View>

      <Text style={{ fontSize: 15, fontWeight: '700', color: '#475569', marginBottom: 20 }}>Does this time work?</Text>

      <View style={{ flexDirection: 'row', gap: 12, width: '100%', marginBottom: 16 }}>
        <TouchableOpacity onPress={onNo} style={{ flex: 1, height: 52, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
          <Text style={{ color: '#475569', fontWeight: '900', fontSize: 14 }}>No</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onYes} style={{ flex: 1, height: 52, borderRadius: 12, backgroundColor: '#22C55E', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '900', fontSize: 14 }}>Yes</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={onBack} style={{ paddingVertical: 4 }}>
        <Text style={{ fontSize: 13, fontWeight: '800', color: '#94A3B8' }}>← Back to calendar</Text>
      </TouchableOpacity>
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

// Payment-method selector rendered as a DROPDOWN (web parity), not a horizontally
// scrollable pill list — the plan labels are long, so a dropdown lets the rep see
// and pick every option. Tapping the field opens a modal list of the options.
// When `categories` is supplied (Balance Method), the list is GROUPED under coloured
// category headers — Basic Options / GreenSky Plans / Wells Fargo Plans / … — exactly
// like the rollout / job-builder payment picker, instead of a flat unlabelled list.
function MethodPicker({
  options,
  selected,
  onSelect,
  allowNone,
  categories,
}: {
  options: { key: string; label: string }[];
  selected: string;
  onSelect: (key: string) => void;
  allowNone?: boolean;
  categories?: { title: string; bg: string; text: string; plans: string[] }[];
}) {
  const [open, setOpen] = useState(false);
  const labelByKey = useMemo(() => {
    const m: Record<string, string> = {};
    options.forEach((o) => {
      m[o.key] = o.label;
    });
    return m;
  }, [options]);
  const items = allowNone ? [{ key: '', label: 'Select payment method' }, ...options] : options;
  const selectedLabel = labelByKey[selected] || (selected ? selected : 'Select payment method');
  const hasSelection = !!selected;
  const useGroups = Array.isArray(categories) && categories.length > 0;

  const renderOption = (key: string, label: string) => {
    const active = selected === key;
    return (
      <TouchableOpacity
        key={key || 'none'}
        onPress={() => {
          onSelect(key);
          setOpen(false);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 16,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: '#F8FAFC',
          backgroundColor: active ? '#F0FDF4' : '#fff',
        }}
      >
        <Text style={{ flex: 1, fontSize: 13, fontWeight: active ? '800' : '600', color: active ? '#15803D' : '#334155', marginRight: 8 }}>
          {label}
        </Text>
        {active && <Icon name="check" size={18} color="#22C55E" />}
      </TouchableOpacity>
    );
  };

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderWidth: 1.5,
          borderColor: '#CBD5E1',
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 12,
          backgroundColor: '#fff',
        }}
      >
        <Text
          numberOfLines={1}
          style={{ flex: 1, fontSize: 13, fontWeight: '700', color: hasSelection ? '#0F172A' : '#94A3B8', marginRight: 8 }}
        >
          {selectedLabel}
        </Text>
        <Icon name="chevron-down" size={20} color="#94A3B8" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', paddingHorizontal: 24 }}
        >
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: '#fff', borderRadius: 16, maxHeight: '70%', overflow: 'hidden' }}>
            <View style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
              <Text style={{ fontSize: 14, fontWeight: '900', color: '#0F172A' }}>Select Payment Method</Text>
            </View>
            <ScrollView>
              {useGroups ? (
                <>
                  {allowNone && renderOption('', 'Select payment method')}
                  {categories!.map((cat, ci) => (
                    <View key={cat.title || `cat-${ci}`}>
                      {cat.title ? (
                        <View style={{ backgroundColor: cat.bg, paddingHorizontal: 16, paddingVertical: 8 }}>
                          <Text style={{ fontSize: 11, fontWeight: '900', color: cat.text, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            {cat.title}
                          </Text>
                        </View>
                      ) : null}
                      {cat.plans.map((planKey) => renderOption(planKey, labelByKey[planKey] || planKey))}
                    </View>
                  ))}
                </>
              ) : (
                items.map((o) => renderOption(o.key, o.label))
              )}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

function ReviewRow({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: '#334155' }}>{label}</Text>
        <Text style={{ fontSize: 11, color: '#DC2626', textDecorationLine: 'line-through' }}>{from}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 10, fontWeight: '700', color: '#94A3B8' }}>NEW</Text>
        <Text style={{ fontSize: 13, fontWeight: '800', color: '#15803D' }}>{to}</Text>
      </View>
    </View>
  );
}
