import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
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
import {
  computeDynamicBuildChanges,
  type BuildChangeKind,
  type ComboField,
} from '../utils/dynamic-deal-diff';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';
import { useAuth } from '../../../hooks/useAuth';
import { logDealAddendumSubmitted } from '../../../utils/activity-log/my-deal-log';
import { formatLocalUSPhone, toE164USPhone } from '../../../utils/phone-util';
import { validateEmail } from '../../../utils/validation';
import { readLeadPhone, readLeadEmail } from '../../../utils/addendum-recipients';
import { toPayloadText } from '../utils/job-submit-payload';
// Handles keyboard avoidance on BOTH platforms (its `KeyboardProvider` is mounted in
// App.tsx). `automaticallyAdjustKeyboardInsets` is iOS-only, and on Android the
// manifest's `adjustResize` no longer shrinks the window once KeyboardProvider goes
// edge-to-edge — so the phone field stayed hidden behind the keypad there.
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

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

// The two install windows offered on the confirm-time step, in order (web parity:
// `TIME_SLOTS`). "Doesn't Work" walks this list, then returns to the calendar.
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

  // ── step + edit state ──────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [editedJobState, setEditedJobState] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  const [scheduleTimeWindow, setScheduleTimeWindow] = useState('');
  // Inline install-date rescheduler (web parity: `dynamic-deal-edit-modal.js`
  // `showCalendar`/`showProposal`/`showSuccess`). Step 0 has four sub-views that all
  // live in the step itself, not a modal:
  //   intro    — the "Edit Job Build / Install Date" card with the current install
  //              date and the Modify / Skip / Cancel actions (the landing view).
  //   calendar — "Select Install Date": pick a date, then confirm with "Use <date>"
  //              (or set TBD). Tapping a day only SELECTS it, matching web.
  //   time     — "Confirm Time Window" for the selected date, one window at a time.
  //   success  — the confirmation card ("Install Date Updated" / "Set to TBD") whose
  //              "Done — Next →" advances to Job Build.
  const [dateStep, setDateStep] = useState<'intro' | 'calendar' | 'time' | 'success'>('intro');
  const [proposedDate, setProposedDate] = useState<Date | null>(null);
  const [proposedSlotIdx, setProposedSlotIdx] = useState(0);

  const [contractPrice, setContractPrice] = useState(0);
  const [downPayment, setDownPayment] = useState(0);
  const [downPaymentMethod, setDownPaymentMethod] = useState('');
  const [balanceMethod, setBalanceMethod] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  // The addendum's SECOND delivery channel. The submit used to hardcode
  // `lead.customerDetails.email`, so the rep could neither see nor correct the address
  // it was mailed to — a stale or misspelt one failed silently, with only the SMS
  // actually reaching the customer.
  const [customerEmail, setCustomerEmail] = useState('');
  // Free-text note shown to the customer on the addendum. Persists to the draft and,
  // on signature, to Lead.note / LeadOutcome.note (backend `note` field). `''` clears it.
  const [note, setNote] = useState('');

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
        // No lead-scoped fallback: that route is deprecated and 404s, so a deal
        // with no calculator id simply has no saved outcome to read.
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

  // ── load the REAL saved calculator (accurate COST/PAR/RETAIL) ───────────────
  // Web reads the deal's stored `LFCalculator` (with its `entries`/`totals`) and
  // prices the Previous/New tiers from it — those are the accurate figures shown
  // when the lead was created. Mobile's outcome comes back with `lfCalculator: null`
  // (it never persists the subdoc), so without this the tiers fall back to pricing
  // the build through the schema against a lead-polluted `dealCenterData`, which
  // produces the garbage values (e.g. $134k retail on a $200 job). The calculator
  // itself IS saved on the backend at `GET /lfcalculators/{id}` — fetch it so the
  // stored path (`computeStoredTiers`) yields the SAME accurate tiers as the web.
  // ⚠️ `isLoading`, not `isPending`. This query is `enabled`-gated, and in TanStack v5
  // a DISABLED query stays `isPending` forever — gating on that would hang the Review
  // step for every deal that carries no calculator id. `isLoading` is
  // `isPending && isFetching`, so it is false unless a request is actually in flight.
  const { data: fetchedCalculator, isLoading: isCalculatorLoading } = useQuery({
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
    // Seed BOTH methods from the sale (web parity — `dynamic-deal-edit-modal.js`
    // seeds `lead.paymentMethod` / `lead.balancePaymentMethod`). These used to open
    // blank on the theory that the rep should re-pick; the result was that the deal's
    // own payment method simply never showed. The change flags below compare against
    // the same lead values, so a seeded picker still reads as "no change".
    setDownPaymentMethod(lead?.paymentMethod || '');
    setBalanceMethod(lead?.balancePaymentMethod || '');
    // Seed already dash-formatted — the stored value may be raw digits or E.164
    // (`+14438784937`), and the field renders its own "+1", so only the local part
    // belongs in the value.
    setCustomerPhone(formatLocalUSPhone(readLeadPhone(lead)));
    // Seed the address the submit previously hardcoded, so the field opens on what the
    // addendum will really be mailed to. TRIMMED — a stored value carrying whitespace
    // would otherwise fail the format check on a field the rep never touched, which is
    // the same trap the phone seed's `formatLocalUSPhone` normalization avoids.
    setCustomerEmail(readLeadEmail(lead));
    // Pre-fill with the lead's existing note so the rep sees the current value and
    // edits from it; a matching value then reads as "no change".
    setNote(lead?.note != null ? String(lead.note) : '');
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

  /**
   * The state handed to the embedded builder — a DEEP COPY, never `initialState`
   * itself.
   *
   * ⚠️ This is the "48 shows as 4" bug. `hydrateJobStateForPersistence` SHARES object
   * references with the state it is given — a field's value object is carried across
   * by reference, not cloned (verified: `hydrated…grid === saved…grid`) — and
   * `useDynamicJobBuilderSession` seeds its `useState` with that exact object. So the
   * diff's ORIGINAL and the rep's live build were one object graph, and any in-place
   * write anywhere in the ~4k-line engine rewrote the "previous value" the Addendum
   * Review prints. A locationGrid losing one column that way turns a saved total of
   * 48 into 4 — which is what the review showed.
   *
   * It stayed wrong until something recomputed this memo, which is exactly why a Fast
   * Refresh of THIS file "fixed" it and why no amount of device speed changed it.
   *
   * ⚠️ Not just a display bug: `buildChangeGroups` is submitted as
   * `buildChangeSummary`, so the corrupted original was written onto the addendum the
   * customer signs.
   *
   * A JSON round-trip is the correct clone here: this state is exactly what gets PUT
   * to the API, so it is plain JSON by construction — no Dates, functions or cycles.
   * Memoized on `initialState` so its identity changes at exactly the same cadence as
   * before (the session's re-apply is keyed by `draftToken` = (leadId, calcId), not by
   * this object's identity, so a fresh copy can never clobber the rep's edits).
   */
  const builderInitialState = useMemo(
    () => (initialState ? JSON.parse(JSON.stringify(initialState)) : null),
    [initialState]
  );

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

  // Web parity (`dynamic-deal-edit-modal.js`): the BALANCE always resolves — it falls
  // back to `check` — because every sold deal has a balance to collect. The DOWN
  // PAYMENT may legitimately be unset (a deal with no money down), so it stays blank
  // and the picker shows its placeholder.
  const balanceMethodKey = coerceToPlanKey(balanceMethod, 'check');

  /**
   * Coerce a stored value to a DOWN-PAYMENT key, which must be one of the cash/card
   * basics the picker offers.
   *
   * ⚠️ Deliberate divergence from web. `lead.paymentMethod` is the down-payment
   * field, but a sold deal often has the ROLLOUT's plan written into it — i.e. a
   * financing plan like `2521`. Web coerces against the FULL catalog and then
   * splices whatever comes out into the Down Pmt options, so the picker ends up
   * offering a balance/financing plan as a way to pay a down payment. It isn't one:
   * financing is how the BALANCE is carried. Anything outside the basics resolves to
   * blank here, so the picker shows its placeholder and the rep picks a real method.
   *
   * Used for the live selection AND for the change-flag baseline — if only one side
   * were filtered, opening the wizard and touching nothing would read as a change.
   */
  const toDownPaymentKey = useCallback(
    (stored: any) => {
      const key = stored ? coerceToPlanKey(stored, '') : '';
      return key && downPaymentOptions.some((o) => o.key === key) ? key : '';
    },
    [coerceToPlanKey, downPaymentOptions]
  );

  const downPaymentMethodKey = toDownPaymentKey(downPaymentMethod);

  // Plan key → human label for the Review rows, e.g. `2511` → "2511 (6 Months 0%
  // Interest No Payments…) (Bank Fee: 4%)". Web parity: `resolvePlanLabel`. Falls
  // back to the raw key when the catalog has no entry (a plan retired since the
  // deal was sold still has to render), and to an em dash when nothing is set.
  const resolvePlanLabel = useCallback(
    (stored: any, fallbackKey = '') => {
      const key = coerceToPlanKey(stored, fallbackKey);
      if (!key) return '—';
      return paymentOptions.find((o) => o.key === key)?.label || key;
    },
    [coerceToPlanKey, paymentOptions]
  );

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
  // The intro card stacks the date over its time window (web `formatScheduleDate`
  // renders M/D/YY, with the window — or "TBD" — underneath).
  const currentInstallDateText = useMemo(() => {
    if (!scheduleDate) return 'Not Scheduled';
    if (scheduleDate === 'TBD') return 'TBD';
    return parsedScheduleDate ? format(parsedScheduleDate, 'M/d/yy') : String(scheduleDate);
  }, [scheduleDate, parsedScheduleDate]);
  const currentInstallTimeText = scheduleTimeWindow || 'TBD';

  // ── change detection + diff ─────────────────────────────────────────────────
  const buildChangeGroups = useMemo(
    () => (editedJobState ? computeDynamicBuildChanges(initialState, editedJobState, jobBuilderConfig) : []),
    [editedJobState, initialState, jobBuilderConfig]
  );
  // A build change is detected ONLY via the field-level diff (`computeDynamicBuildChanges`
  // → `buildChangeGroups`). The previous raw `JSON.stringify(edited) !== initial` signal
  // produced false positives — the builder mutates the hydrated state on mount
  // (auto-fields, defaults, editable locked fields), so it differed even when the rep
  // changed nothing, showing a phantom "Job Build: Previous → Updated build" row.
  const buildChanged = buildChangeGroups.some((g) => g.changes.length > 0);

  const scheduleChanged =
    !!scheduleDate &&
    (scheduleDate !== (lead?.jobBuilder?.scheduleTime?.date || null) ||
      scheduleTimeWindow !== (lead?.jobBuilder?.scheduleTime?.timeWindow || ''));
  const priceChanged = parsePrice(lead?.originalContractPrice) !== Number(contractPrice);
  // A note edit is itself an addendum change, so the rep can send a note-only
  // addendum (baseline is the lead's existing note).
  const noteChanged = String(lead?.note ?? '') !== note;
  const downPaymentChanged = parsePrice(lead?.downPayment) !== Number(downPayment);

  // ── price validation (web parity: `contractPriceError` / `downPaymentError`) ──
  // Selling under the rebuilt COST loses money on the addendum, and a down payment
  // above the contract price yields a negative balance. Both block the wizard here
  // rather than being caught downstream — mobile had NO validation at all, so a rep
  // could advance and submit an addendum priced below cost.
  const costFloor = Number(tierResult?.next?.cost) || 0;
  const contractPriceError =
    costFloor > 0 && (Number(contractPrice) || 0) < costFloor
      ? `Cannot be below the cost of ${fmtMoney(costFloor)}.`
      : '';
  const downPaymentError =
    (Number(downPayment) || 0) > (Number(contractPrice) || 0)
      ? `Cannot exceed the contract price of ${fmtMoney(Number(contractPrice) || 0)}.`
      : '';
  const hasPriceError = Boolean(contractPriceError || downPaymentError);

  // ── "Send Addendum To" phone ────────────────────────────────────────────────
  // The addendum is TEXTED to this number, so an incomplete one means the customer
  // is never asked to sign and the draft sits pending forever. Same rule as Add New
  // Lead / Edit Customer, with one difference that matters: this field renders a
  // STATIC "+1" beside it and holds the local part only (`formatLocalUSPhone`), so a
  // complete number is TEN digits here, not the eleven those two screens count.
  const customerPhoneDigits = customerPhone.replace(/\D/g, '');
  const customerPhoneError =
    customerPhoneDigits.length === 0
      ? 'Phone number is required to send the addendum.'
      : customerPhoneDigits.length !== 10
        ? 'Enter a complete 10-digit phone number.'
        : '';

  // ── "Send Addendum To" email ────────────────────────────────────────────────
  // Format-checked with the app's shared `validateEmail` (the same rule login and
  // forgot-password use), so "email" cannot come to mean two different things.
  //
  // ⚠️ OPTIONAL, unlike the phone — and that asymmetry is deliberate. SMS is the
  // channel that gets the customer to the signature page, so an unreachable phone
  // leaves the draft pending forever; email is a copy. The submit already tolerated a
  // blank address (it sent `lead.customerDetails.email || ''`), so requiring one here
  // would make every email-less lead UNSUBMITTABLE — a regression on a flow that
  // works today. A blank field therefore means "SMS only", exactly as before; only a
  // value that is present and malformed blocks Submit.
  const customerEmailTrimmed = customerEmail.trim();
  const customerEmailError =
    customerEmailTrimmed && !validateEmail(customerEmailTrimmed)
      ? 'Enter a valid email address (e.g. name@example.com).'
      : '';
  // Compare each picker against the SAME baseline it was seeded from, so opening the
  // wizard and touching nothing reads as no change. Both sides go through
  // `coerceToPlanKey` with the matching fallback ('check' for the balance, blank for
  // the down payment) — web parity. The old `!!key &&` guard existed only because the
  // pickers opened blank; seeding them made it obsolete, and keeping it would have
  // masked a real edit back to the deal's original method.
  // Same filter as the seed (`toDownPaymentKey`): a deal storing a financing plan in
  // `paymentMethod` blanks BOTH sides, so opening the wizard and touching nothing is
  // not a change. Once the rep picks a real method it compares blank → that method.
  const downPaymentMethodChanged =
    toDownPaymentKey(lead?.paymentMethod) !== downPaymentMethodKey;
  const balanceMethodChanged =
    coerceToPlanKey(lead?.balancePaymentMethod, 'check') !== balanceMethodKey;

  // These were previously inlined here, so the Submit button enabled on a payment
  // change but the Review list had no row for it — the rep saw "no changes" for an
  // edit that was really being submitted. Named so the review step can render them.
  const hasAnyChange =
    buildChanged ||
    scheduleChanged ||
    priceChanged ||
    noteChanged ||
    downPaymentChanged ||
    downPaymentMethodChanged ||
    balanceMethodChanged;

  // ── handlers ────────────────────────────────────────────────────────────────
  // Tapping a calendar day only SELECTS it (web `handleDatePick`) — the rep then
  // confirms with "Use <date>", which opens the confirm-time card.
  const handleInlineDateSelect = useCallback((day: Date) => {
    setProposedDate(day);
    setProposedSlotIdx(0);
  }, []);

  // "Use <date>" → offer the first time window for the selected day.
  const handleUseSelectedDate = useCallback(() => {
    if (!proposedDate) return;
    setDateStep('time');
  }, [proposedDate]);

  // "TBD" → clear the scheduled date/window, then show the confirmation card
  // (web `handleSelectTbd` → `showSuccess`). "Done — Next →" moves on to Job Build.
  const handleSelectTbd = useCallback(() => {
    setScheduleDate('TBD');
    setScheduleTimeWindow('');
    setProposedDate(null);
    setProposedSlotIdx(0);
    setDateStep('success');
  }, []);

  // "Doesn't Work" → offer the next window for the SAME day; once both windows have
  // been declined, send the rep back to the calendar to pick another date (web
  // `handleProposalNo`). It used to roll forward to the next non-Sunday day instead,
  // which silently moved the date the rep had chosen.
  const handleProposeNextSlot = useCallback(() => {
    if (proposedSlotIdx < INSTALL_WINDOWS.length - 1) {
      setProposedSlotIdx(proposedSlotIdx + 1);
      return;
    }
    setProposedSlotIdx(0);
    setDateStep('calendar');
  }, [proposedSlotIdx]);

  // "Confirm" → commit the proposed schedule, then show the confirmation card (web
  // `handleProposalYes` → `showSuccess`). `proposedDate` is intentionally kept so the
  // card can echo the committed date; `handleFinishInstallDate` clears it.
  const handleAcceptProposedTime = useCallback(() => {
    if (!proposedDate) return;
    setScheduleDate(format(proposedDate, 'M/d/yyyy'));
    setScheduleTimeWindow(INSTALL_WINDOWS[proposedSlotIdx].value);
    setDateStep('success');
  }, [proposedDate, proposedSlotIdx]);

  // "Done — Next →" on the confirmation card → Job Build. Resets Step 0 back to its
  // landing card so stepping back to Install Date shows the intro, not the success card.
  const handleFinishInstallDate = useCallback(() => {
    setDateStep('intro');
    setProposedDate(null);
    setProposedSlotIdx(0);
    setStep(1);
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

      // The Deal Center job-submit builds `leadData` with a fixed key set
      // (`buildSubmitLeadData`). This draft is a DIFFERENT endpoint with a flatter
      // shape, but the OUTCOME fields it carries should be the same ones — three were
      // missing here, so an addendum dropped them and the signed record disagreed with
      // the original submit. Sale/Demo blanking follows the same rule as there.
      const isSaleResult = (lead?.result || 'Sale') === 'Sale';

      const payload: any = {
        result: lead?.result || 'Sale',
        // ⚠️ Present on the draft record (it reads `oneLeg: null` today) and on the
        // Deal Center payload, but never sent from here — so every addendum silently
        // cleared it. Defaults to 'No', matching `buildSubmitLeadData`.
        oneLeg: toPayloadText(savedOutcome?.oneLeg ?? lead?.oneLeg ?? 'No'),
        // Demo-only, blank on a Sale — exactly as the Deal Center does. Resolution
        // chain matches `EditContractDetailsModal`, which reads the same two fields.
        reason: toPayloadText(isSaleResult ? '' : (savedOutcome?.reason ?? lead?.reason)),
        explain: toPayloadText(isSaleResult ? '' : (savedOutcome?.explain ?? lead?.explain)),
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
        // Free-text note ("" → null). Stored on the draft now, written to
        // Lead.note / LeadOutcome.note when the customer signs.
        note,
        // ── who this addendum goes to ──────────────────────────────────────────
        // ROOT-LEVEL on the draft-create POST. Both fields are seeded from the
        // customer record and shown on the Review step, so the rep can OVERRIDE them:
        // typing a different number/address here sends the addendum there instead of
        // to whatever the customer record holds.
        //
        // ⚠️ E.164 (`+12542343674`) for the phone, per the documented payload. The
        // field itself renders a static "+1" and holds the LOCAL part, so the display
        // value must go through `toE164USPhone` — sending it raw would hand the SMS
        // provider "232-123-2112".
        customerPhone: toE164USPhone(customerPhone || readLeadPhone(lead)),
        customerEmail: customerEmailTrimmed,
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
        // Always E.164 (+1XXXXXXXXXX) for the SMS provider. The old branch passed a
        // value through untouched when it merely STARTED with '+', so a display
        // string like "+1 443-878-4937" reached the API with spaces and dashes; and
        // a stored "14438784937" became "+114438784937". `toE164USPhone` strips
        // formatting and takes the last 10 digits, so every shape normalizes.
        const formattedPhone = toE164USPhone(customerPhone || readLeadPhone(lead));
        try {
          await LeadService.sendDraftSubmitEmail(draftId, {
            // The address the rep typed, not the lead's stored one — that is the whole
            // point of the field. Deliberately NOT falling back to the stored value when
            // blank: the field is SEEDED from it, so an empty field means the rep cleared
            // it on purpose, and a fallback would mail the addendum to an address they
            // had just removed.
            customerEmail: customerEmailTrimmed,
            customerPhone: formattedPhone,
          });
        } catch (emailErr) {
          console.warn('[DynamicDealEdit] draft email failed:', emailErr);
        }
      }

      // Log the addendum submission under `my_deal` (web `logAddendumSubmitted`). This
      // is the deal-edit completion event — the embedded builder's job_builder_completed
      // is suppressed in edit mode, so this is the single "addendum sent" marker.
      const logUserId = user?._id || user?.id;
      if (logUserId) {
        logDealAddendumSubmitted({
          userId: logUserId,
          leadId,
          calculatorId: editCalculatorId || undefined,
          result: lead?.result || 'Sale',
          summary: {
            ...(draftId ? { draftId } : {}),
            contractPrice: Number(contractPrice) || 0,
            downPayment: Number(downPayment) || 0,
            buildChanged,
            scheduleChanged,
            priceChanged,
            noteChanged,
          },
        });
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
    customerEmailTrimmed,
    note,
    navigation,
    user,
    editCalculatorId,
    buildChanged,
    scheduleChanged,
    priceChanged,
    noteChanged,
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
            {dateStep === 'intro' ? (
              /* Landing card (web parity: `dynamic-deal-edit-modal.js` step 0) —
                 the current install date, then Modify / Skip / Cancel. */
              <View style={styles.dateCard}>
                <Text style={styles.dateCardTitle}>Edit Job Build</Text>
                <Text style={styles.dateCardSubtitle}>Install Date</Text>

                <View style={styles.currentInstallBox}>
                  <Text style={styles.currentInstallLabel}>Current Install Date</Text>
                  <Text style={styles.currentInstallDate}>{currentInstallDateText}</Text>
                  <Text style={styles.currentInstallTime}>{currentInstallTimeText}</Text>
                </View>

                <TouchableOpacity onPress={() => setDateStep('calendar')} style={styles.primaryBtn}>
                  <Text style={styles.primaryBtnText}>Modify Install Date</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setStep(1)} style={styles.outlineBtn}>
                  <Text style={styles.outlineBtnText}>No Change — Skip</Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setShowCancelConfirm(true)} style={styles.dangerBtn}>
                  <Text style={styles.dangerBtnText}>Cancel Job</Text>
                </TouchableOpacity>
              </View>
            ) : dateStep === 'calendar' ? (
              /* "Select Install Date": tapping a day selects it; the rep confirms
                 with "Use <date>", or sets TBD. */
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
              /* Confirm-time card, reached from "Use <date>". Declining both windows
                 walks the rep back to the calendar (see `handleProposeNextSlot`). */
              <ProposedTimeCard
                date={proposedDate}
                slot={INSTALL_WINDOWS[proposedSlotIdx]}
                onNo={handleProposeNextSlot}
                onYes={handleAcceptProposedTime}
              />
            ) : (
              /* Confirmation card (web `showSuccess`) — TBD gets a blue "?" badge,
                 a committed date gets a green check plus the date + window it saved. */
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
            initialConfig={jobBuilderConfig ?? undefined}
            // System A calculator schemas — the Job Builder Summary resolves each
            // card's header colour from the matching schema CATEGORY's colour (web
            // parity: `resolveTabAccentColor` → `findTabCategoryColorFromSchemas`).
            // They are NOT on `initialConfig` (that is the System B job-builder
            // config), so without this every tab fell through to the single
            // `vertical.color` and every card rendered the same purple. The new-deal
            // path (`DynamicDealCenterScreen`) passes this same array as `verticals`.
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
          // Same keyboard treatment as step 3 — the Contract Price / Down Payment
          // inputs are equally low on the page once the payment pickers are expanded.
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
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: contractPriceError ? '#DC2626' : '#CBD5E1', borderRadius: 10, paddingHorizontal: 12, marginBottom: contractPriceError ? 4 : 12 }}>
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
              {!!contractPriceError && (
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#DC2626', marginBottom: 12 }}>
                  {contractPriceError}
                </Text>
              )}

              {/* Down Payment + its method, side by side (web parity). */}
              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 4 }}>Down Payment</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: downPaymentError ? '#DC2626' : '#CBD5E1', borderRadius: 10, paddingHorizontal: 10 }}>
                    <Text style={{ color: '#94A3B8', marginRight: 4 }}>$</Text>
                    <TextInput
                      value={String(downPayment)}
                      onChangeText={(t) => setDownPayment(parseFloat(t.replace(/[^0-9.]/g, '')) || 0)}
                      keyboardType="numeric"
                      style={{ flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 12 }}
                    />
                  </View>
                  {!!downPaymentError && (
                    <Text style={{ fontSize: 11, fontWeight: '600', color: '#DC2626', marginTop: 4 }}>
                      {downPaymentError}
                    </Text>
                  )}
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
          </KeyboardAwareScrollView>
        )}

        {/* STEP 3 — Review & Submit */}
        {step === 3 && (
          // Additional Notes and Phone Number sit at the very bottom, so the keyboard
          // covered them. `KeyboardAwareScrollView` scrolls the FOCUSED input above the
          // keyboard on both platforms, which plain `automaticallyAdjustKeyboardInsets`
          // could not do on Android. `bottomOffset` keeps a gap between the caret and
          // the keypad; the extra bottom padding lets the last field clear the sticky
          // Back / Submit footer. Deliberately NOT a padding `KeyboardAvoidingView` —
          // that only shrinks the ScrollView and leaves a low field below the fold,
          // which is the bug it was meant to fix (see DynamicJobBuilderScreen).
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
                    {group.changes.map((c, i) => (
                      <ReviewRow
                        key={`${c.field}-${i}`}
                        label={c.field}
                        from={c.from}
                        to={c.to}
                        kind={c.kind}
                        comboFields={c.comboFields}
                      />
                    ))}
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
                  <ReviewRow label="Down Payment" from={fmtMoney(parsePrice(lead?.downPayment))} to={fmtMoney(downPayment)} />
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
                  // Dash-formatted as typed (443-878-4937). The country code is the
                  // static "+1" to the left, so the value holds the local part only.
                  onChangeText={(t) => setCustomerPhone(formatLocalUSPhone(t))}
                  keyboardType="phone-pad"
                  // 10 digits + 2 dashes — stops extra digits being appended silently.
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
                  // An address is case-insensitive and never a proper noun, so the OS
                  // shift-on-first-letter and autocorrect only ever corrupt it.
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
          </KeyboardAwareScrollView>
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
            // Web parity: a price below cost (or a down payment above it) blocks the
            // step — the rep must correct it before Review, not discover it later.
            <TouchableOpacity
              onPress={() => setStep(3)}
              disabled={hasPriceError}
              style={{ backgroundColor: hasPriceError ? '#CBD5E1' : '#0F172A', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <Text style={{ fontWeight: '800', fontSize: 13, color: '#fff' }}>Next · Review</Text>
              <Icon name="arrow-right" size={16} color="#fff" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              onPress={handleSubmit}
              // ⚠️ The phone and email gate SUBMIT only, never `Next · Review` on step 2
              // — both fields live on THIS step, so blocking Next would strand the rep
              // with a disabled button and nothing on screen explaining it.
              disabled={isSubmitting || !hasAnyChange || hasPriceError || isCalculatorLoading || !!customerPhoneError || !!customerEmailError}
              style={{ backgroundColor: hasAnyChange && !hasPriceError && !isCalculatorLoading && !customerPhoneError && !customerEmailError ? '#22C55E' : '#CBD5E1', borderRadius: 10, paddingHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: isSubmitting ? 0.7 : 1 }}
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
 * "Confirm Time Window" card, shown after the rep confirms a date with "Use <date>"
 * (web parity: the `showProposal` card). It offers ONE window at a time — the long
 * date, a green-outlined block naming the window (Morning / Afternoon), then
 * "Doesn't Work" / "Confirm". "Doesn't Work" walks to the other window and, once both
 * are declined, returns to the calendar (handled by the caller).
 */
function ProposedTimeCard({
  date,
  slot,
  onNo,
  onYes,
}: {
  date: Date | null;
  slot: { period: string; value: string };
  onNo: () => void;
  onYes: () => void;
}) {
  if (!date) return null;
  return (
    <View style={styles.dateCard}>
      <Text style={styles.dateCardTitle}>Confirm Time Window</Text>
      <Text style={styles.confirmDate}>{format(date, 'EEEE, MMMM d, yyyy')}</Text>

      <View style={styles.windowBox}>
        <Text style={styles.windowLabel}>{slot.period.toUpperCase()}</Text>
        <Text style={styles.windowValue}>{slot.value}</Text>
        <Text style={styles.windowCaption}>Arrival window</Text>
      </View>

      <Text style={styles.confirmPrompt}>Work for the customer?</Text>

      <View style={styles.calendarActions}>
        <TouchableOpacity onPress={onNo} style={styles.tbdBtn}>
          <Text style={styles.tbdBtnText}>Doesn&apos;t Work</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onYes} style={styles.useDateBtn}>
          <Text style={styles.useDateBtnText}>Confirm</Text>
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

function ReviewRow({
  label,
  from,
  to,
  kind,
  comboFields,
}: {
  label: string;
  from: string;
  to: string;
  kind?: BuildChangeKind;
  comboFields?: ComboField[];
}) {
  // A whole combination dropped from (or added to) the build is not an edit of a
  // value, so it must not read as one — the eyebrow names the operation instead
  // of the generic "NEW", and a removal's value column stays neutral rather than
  // showing a green "new value" the rep never entered.
  const eyebrow = kind === 'removed' ? 'REMOVED' : kind === 'added' ? 'ADDED' : 'NEW';
  const eyebrowColor = kind === 'removed' ? '#DC2626' : '#94A3B8';
  const valueColor = kind === 'removed' ? '#94A3B8' : '#15803D';

  // A whole combination is rendered as the portal's build card renders it — the
  // measurements as a labelled table, in the config's field order. Run together on
  // one line ("Type PARTIAL · Vinyl Soffit Footage 200 · Soffit Type HIDDEN VENT
  // VINYL · Color White") they wrap into a green paragraph the rep has to parse word
  // by word, and two combinations of the same section read as different products.
  if (comboFields?.length) {
    return (
      <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Text style={{ flex: 1, minWidth: 0, paddingRight: 12, fontSize: 13, fontWeight: '700', color: '#334155' }}>
            {label}
          </Text>
          <Text style={{ fontSize: 10, fontWeight: '700', color: eyebrowColor }}>{eyebrow}</Text>
        </View>
        <View style={styles.comboCard}>
          {comboFields.map((f, i) => (
            <View key={`${f.label}-${i}`} style={styles.comboRow}>
              {/* `flexShrink` on BOTH columns, so a long label wraps instead of
                  shunting the value off the right edge of a phone. */}
              <Text style={styles.comboLabel}>{f.label}</Text>
              <Text style={[styles.comboValue, { color: valueColor }]}>{f.value}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }

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
          // ⚠️ `from` is NOT free text — for a locationGrid it is `displayValue()` →
          // the grid's TOTAL. So a wrong value here ("48" reading as "4") is a wrong
          // SUM, never a clipped glyph, and no amount of width or font styling can
          // affect it. That was mis-diagnosed once; the cause was the diff's original
          // side still hydrating — see the note on the Review step's loading hold.
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

// ── Step 0 (Install Date) card styling — mirrors the web edit modal's centred
// card: a white rounded panel with a hairline border, a soft shadow, and
// full-width stacked actions.
const styles = StyleSheet.create({
  // The portal's build card: a soft tinted panel holding one row per measurement.
  comboCard: {
    marginTop: 8,
    backgroundColor: '#EFF8FA',
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
  // Current install date block (grey, bordered, centred).
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
  // "‹ Back  Select Install Date" header — the spacer view opposite Back keeps
  // the title optically centred.
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
  // ── Confirmation ("success") card ──
  // Circular badge: blue + "?" for TBD, green + check for a committed date.
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
  // ── Confirm Time Window card ──
  confirmDate: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 20,
  },
  // Green-outlined block naming the offered window.
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
