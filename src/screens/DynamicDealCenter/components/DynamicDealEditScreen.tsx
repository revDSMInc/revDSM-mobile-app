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
import { AppointmentSchedulerModal } from '../../../widgets/modals/job-builder/AppointmentSchedulerModal';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';

/**
 * 4-step DYNAMIC deal-edit wizard. Faithful port of web
 * `src/sections/deal/components/dynamic-deal-edit-modal.js` (`DynamicDealEditModal`).
 * Reached from Deal Detail → Edit (web: ContractDetails pencil → isDynamicDeal
 * branch). Steps mirror `STEP_LABELS`:
 *
 *   0 Install Date  — reschedule the install appointment (AppointmentSchedulerModal)
 *   1 Job Build     — embed the DYNAMIC job builder in edit mode (unlockAll, no
 *                     allocation trackers), streaming edited state up
 *   2 Job Price     — reconfirm rollout tiers + contract price + payment methods
 *   3 Review&Submit — diff the build/schedule/price and submit a pending-signature
 *                     ADDENDUM draft (submitJobBuilderDraft + sendDraftSubmitEmail).
 *                     Editing does NOT re-run /job-builder or upsert the portal record.
 */

const STEP_LABELS = ['Install Date', 'Job Build', 'Job Price', 'Review & Submit'];

const fmtMoney = (n: any) => `$${Math.round(Number(n) || 0).toLocaleString()}`;

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
  const { configuredSchemas, isLoading: isSchemasLoading } = useCalculatorSchema();
  const pricing = useDealPricing(lead);

  // ── step + edit state ──────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [editedJobState, setEditedJobState] = useState<any>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const [scheduleDate, setScheduleDate] = useState<string | null>(null);
  const [scheduleTimeWindow, setScheduleTimeWindow] = useState('');

  const [contractPrice, setContractPrice] = useState(0);
  const [downPayment, setDownPayment] = useState(0);
  const [downPaymentMethod, setDownPaymentMethod] = useState('');
  const [balanceMethod, setBalanceMethod] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');

  const seededRef = useRef(false);

  // ── load the authoritative saved outcome (web: getJobBuilder(leadId)) ───────
  const { data: savedOutcome, isFetched: outcomeFetched } = useQuery({
    queryKey: ['dealEditOutcome', leadId],
    queryFn: async () => {
      try {
        const res = await LeadService.getJobBuilder(leadId!);
        const body = res.data;
        return body?.data?.outcome ?? body?.outcome ?? body?.data ?? body ?? null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(leadId),
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
    setDownPaymentMethod(lead?.paymentMethod || '');
    setBalanceMethod(lead?.balancePaymentMethod || '');
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
      savedOutcome?.LFCalculator ||
      savedOutcome?.lfCalculator ||
      lead?.LFCalculator ||
      lead?.lfCalculator ||
      lead?.calculatorData ||
      {},
    [savedOutcome, lead]
  );

  const dealCenterData = useMemo(
    () =>
      buildDealCenterData({
        entries: {},
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
      return hydrateJobStateForPersistence(deserialized, jobBuilderConfig, dealCenterData);
    } catch (err) {
      console.warn('[DynamicDealEdit] deserialize failed:', err);
      return null;
    }
  }, [jobBuilderConfig, savedDynamicJobState, dealCenterData]);

  const effectiveJobState = editedJobState || initialState;

  // ── payment options (web useGetPaymentPlans → paymentOptions) ───────────────
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

  const balanceMethodKey = coerceToPlanKey(balanceMethod, 'check');
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
        pricingConfig: null,
      }),
    [calculatorData, dealCenterData, jobBuilderConfig, initialState, effectiveJobState, configuredSchemas, balanceMethodKey, lead]
  );

  const customerName =
    `${lead?.customerDetails?.firstName || ''} ${lead?.customerDetails?.lastName || ''}`.trim() ||
    'Customer';
  const balance = Math.max(0, (Number(contractPrice) || 0) - (Number(downPayment) || 0));
  const newMarkup = getMarkupInfo(contractPrice, tierResult.next, undefined);

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
    coerceToPlanKey(lead?.paymentMethod, '') !== downPaymentMethodKey ||
    coerceToPlanKey(lead?.balancePaymentMethod, 'check') !== balanceMethodKey;

  // ── handlers ────────────────────────────────────────────────────────────────
  const handleScheduleConfirm = useCallback((data: any) => {
    setScheduleDate(data?.date || null);
    setScheduleTimeWindow(data?.timeWindow || '');
    setSchedulerOpen(false);
    setStep(1);
  }, []);

  const handleAutoAdjust = useCallback(() => {
    const { previous, next } = tierResult;
    const original = parsePrice(lead?.originalContractPrice) || contractPrice;
    if (previous.retail > 0 && next.retail > 0) {
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

      const payload: any = {
        result: lead?.result || 'Sale',
        lastPriceQuoted: lead?.lastPriceQuoted || '',
        originalContractPrice: String(contractPrice),
        downPayment: String(downPayment),
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
        LFCalculator: calculatorData,
        // Snapshot the build diff for the customer consent page (web parity).
        buildChangeSummary: buildChangeGroups,
      };

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
            <View style={{ backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 16, marginBottom: 12 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', marginBottom: 4 }}>Current Install Date</Text>
              <Text style={{ fontSize: 16, fontWeight: '900', color: '#0F172A' }}>
                {scheduleDate ? `${scheduleDate}${scheduleTimeWindow ? ` · ${scheduleTimeWindow}` : ''}` : 'Not Scheduled'}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => setSchedulerOpen(true)}
              style={{ backgroundColor: '#0EA5E9', borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 10 }}
            >
              <Icon name="calendar-edit" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>Reschedule Install Date</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setStep(1)}
              style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}
            >
              <Text style={{ color: '#334155', fontWeight: '800', fontSize: 14 }}>No Change — Continue</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setShowCancelConfirm(true)}
              style={{ borderWidth: 1, borderColor: '#FCA5A5', borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ color: '#DC2626', fontWeight: '800', fontSize: 14 }}>Cancel Job</Text>
            </TouchableOpacity>

            <Text style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 14, lineHeight: 16 }}>
              Sundays unavailable · Pick a date to propose a time, or Continue to keep the current one.
            </Text>
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
              calculatorId: calculatorResultData?.calculatorId || savedOutcome?.selectedCalculatorId || null,
            }}
            leadId={leadId}
            appointmentId={calculatorResultData?.appointmentId || savedOutcome?.selectedAppointmentId}
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
              <Text style={{ fontSize: 18, fontWeight: '900', color: '#0F172A' }}>{fmtMoney(parsePrice(lead?.originalContractPrice))}</Text>
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
                    {newMarkup.markupPct !== null && newMarkup.markupPct !== 0
                      ? ` ${newMarkup.markupPct > 0 ? '+' : ''}${newMarkup.markupPct}%`
                      : ''}
                  </Text>
                </View>
              </View>

              <View style={{ flexDirection: 'row', gap: 12, marginBottom: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 4 }}>Down Payment</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 10 }}>
                    <Text style={{ color: '#94A3B8', marginRight: 4 }}>$</Text>
                    <TextInput
                      value={String(downPayment)}
                      onChangeText={(t) => setDownPayment(parseFloat(t.replace(/[^0-9.]/g, '')) || 0)}
                      keyboardType="numeric"
                      style={{ flex: 1, fontSize: 14, color: '#0F172A', paddingVertical: 10 }}
                    />
                  </View>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 4 }}>Balance</Text>
                  <View style={{ borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 11, backgroundColor: '#F1F5F9' }}>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#0F172A' }}>{fmtMoney(balance)}</Text>
                  </View>
                </View>
              </View>

              <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 6 }}>Down Payment Method</Text>
              <MethodPicker
                options={paymentOptions}
                selected={downPaymentMethodKey}
                onSelect={(k) => setDownPaymentMethod(k)}
                allowNone
              />

              <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginTop: 12, marginBottom: 6 }}>Balance Method</Text>
              <MethodPicker
                options={paymentOptions}
                selected={balanceMethodKey}
                onSelect={(k) => setBalanceMethod(k)}
              />
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

      {/* Install Date scheduler (web step-0 calendar + AM/PM proposal) */}
      <AppointmentSchedulerModal
        visible={schedulerOpen}
        onClose={() => setSchedulerOpen(false)}
        onConfirm={handleScheduleConfirm}
        customerName={customerName}
        isEdit
        initialDate={scheduleDate || undefined}
        initialTimeWindow={scheduleTimeWindow || undefined}
      />

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

function MethodPicker({
  options,
  selected,
  onSelect,
  allowNone,
}: {
  options: { key: string; label: string }[];
  selected: string;
  onSelect: (key: string) => void;
  allowNone?: boolean;
}) {
  const items = allowNone ? [{ key: '', label: 'Select' }, ...options] : options;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {items.map((o) => {
        const active = selected === o.key;
        return (
          <TouchableOpacity
            key={o.key || 'none'}
            onPress={() => onSelect(o.key)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1.5,
              borderColor: active ? '#22C55E' : '#CBD5E1',
              backgroundColor: active ? '#DCFCE7' : '#fff',
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: active ? '#15803D' : '#64748B' }}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
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
