import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNumPadActive } from '../../../widgets/common/keyboard/NumPad';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCalculatorSchema } from '../hooks/useCalculatorSchema';
import { useDynamicCalculators } from '../hooks/useDynamicCalculators';
import { useDynamicCalculatorSchemas } from '../hooks/useDynamicCalculatorSchemas';
import { useDealPricing } from '../hooks/useDealPricing';
import { CalculatorView } from './CalculatorView';
import { RolloutView } from './RolloutView';
import { ResultJobModal } from './ResultJobModal';
import { DynamicJobBuilderScreen } from '../DynamicJobBuilderScreen';
import { DynamicDealEditScreen } from './DynamicDealEditScreen';
import { BuildFromExistingModal } from './BuildFromExistingModal';
import { extractCalculatorOutcome, hasSavedJobBuild } from '../utils/saved-job-build';
import { createRehashDraftLatch, latchRehashDrafts, releaseRehashDrafts, isRehashDraftCalculator } from '../utils/rehash-draft-calculators';
import { buildDealCenterData } from '../utils/build-deal-center-data';
import { resolveSubmittedCalculatorId } from '../utils/job-builder-submission';
import { FlashMessage } from '../../../config/message';
import { buildSectionLabelMap } from '../utils/item-format';
import { resolveFundingSource } from '../../../utils/activity-log/funding-log';
import { LeadService, resolveLeadCalculatorId } from '../../../services/api/leads';
import { ConfirmDialog } from './ConfirmDialog';
import { FundingService } from '../../../services/api/FundingService';
import { canResumeJobBuild, fundingBelongsToCalculator, fundingPinnedToOtherCalculator } from '../utils/funding';
import { useAuth } from '../../../hooks/useAuth';
import { useSlowLoadHint } from '../../../hooks/useSlowLoadHint';
import { logViewAllCalculators, logBuildJobInitiated } from '../../../utils/activity-log/calculator-log';
import { useQueryClient } from '@tanstack/react-query';
import { markLeadRolloutsConfirmed } from '../../../hooks/useLeadCalculatorStatus';
import { allRolloutsConfirmed } from '../../../utils/rollout-status';
import { isOnline } from '../../../services/connectivity';
import { backToLeadCenter } from '../../../utils/navigate-back-to-lead-center';

type FlowStep = 'calculator' | 'rollout' | 'result' | 'jobBuilder';

const resultTypeFromLead = (lead: any): 'sale' | 'demo' => {
  const status = String(lead?.status || '').toLowerCase().replace(/[^a-z]/g, '');
  return status === 'demo' || status === 'demonosale' ? 'demo' : 'sale';
};

interface DynamicDealCenterScreenProps {
  navigation?: NativeStackNavigationProp<any>;
  route?: {
    params?: {
      lead?: any;
      initialVerticalId?: string;
      mode?: 'new' | 'edit';
      calculatorResultData?: any;
      resultOptIn?: { calculatorId?: string; price?: number; paymentMethod?: string; downPayment?: number };
      openJobBuilder?: boolean;
    };
  };
}

/**
 * Edit mode is a DIFFERENT SCREEN, so it is split out here rather than early-returned from
 * inside the create screen.
 *
 * ⚠️ It used to `return <DynamicDealEditScreen/>` after three hooks and before the other
 * ~40, which put every remaining hook behind a conditional. React only tolerated it because
 * `mode` never changes within a mount; it also silenced nothing - 27 rules-of-hooks errors
 * were being carried, and the first hook added below them crashed the screen.
 */
export default function DynamicDealCenterScreen({ navigation, route }: DynamicDealCenterScreenProps) {
  if (route?.params?.mode === 'edit') {
    return <DynamicDealEditScreen navigation={navigation} route={route} />;
  }
  return <DynamicDealCenterCreate navigation={navigation} route={route} />;
}

function DynamicDealCenterCreate({ navigation, route }: DynamicDealCenterScreenProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const numPadActive = useNumPadActive();

  const lead = route?.params?.lead;
  const [fundingBlock, setFundingBlock] = useState<{ ownerTitle: string } | null>(null);
  const [flowStep, setFlowStep] = useState<FlowStep>('calculator');
  const [resultModal, setResultModal] = useState<{ visible: boolean; calculatorId?: string; resultType?: 'sale' | 'demo'; price?: number; paymentMethod?: string; downPayment?: number; startOnFunding?: boolean }>({ visible: false });
  const [calculatorResultData, setCalculatorResultData] = useState<any>(null);
  const [currentCalculatorId, setCurrentCalculatorId] = useState<string | undefined>();
  const [rehashBuild, setRehashBuild] = useState<{ prompt: boolean; startFresh: boolean }>({
    prompt: false,
    startFresh: false,
  });
  const [jobResetLocally, setJobResetLocally] = useState(false);

  const {
    config: jobBuilderConfig,
    isConfigured: hasJobBuilderConfig,
    isLoading: isJobBuilderConfigLoading,
    refetch: refetchJobBuilderConfig,
  } = useDynamicCalculatorSchemas();

  const {
    configuredSchemas,
    isConfigured: hasCalculatorSchema,
    isLoading: isSchemaLoading,
    pricingConfig,
  } = useCalculatorSchema();
  const pricing = useDealPricing(lead);
  const verticals = useMemo(() => configuredSchemas, [configuredSchemas]);

  const {
    tabs,
    activeTabId,
    setActiveTabId,
    appointmentId,
    loading: isCalcLoading,
    offlineUnavailable,
    workFromDevice,
    isSaving,
    lastUpdated,
    handleEntryChange,
    handleClearSection,
    handleAddTab,
    handleDuplicateTab,
    handleDeleteTab,
    handleRenameTab,
    handleReorderTabs,
    handleConfirmRollouts,
    handleSetPaymentMethod,
    handleSetDrops,
    handleSetDiscount,
    handleSetDownPayment,
    handleSetRenders,
    handleSetOneYearMonthly,
    handleSetPrice,
    handleAckScopeWarning,
  } = useDynamicCalculators(lead, verticals);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  const rehashLatchRef = useRef(createRehashDraftLatch());
  if (lead?.isRehashed === true && !isCalcLoading) latchRehashDrafts(rehashLatchRef.current, tabs);
  const isRehashDraftTab = isRehashDraftCalculator(rehashLatchRef.current, activeTab?.id);

  const sectionLabelMap = useMemo(() => buildSectionLabelMap(verticals), [verticals]);

  const fundingSource = resolveFundingSource({ lead, mode: route?.params?.mode });

  const cd = lead?.customerDetails || {};
  const customerName = cd.firstName
    ? `${cd.firstName} ${cd.lastName || ''}`.trim()
    : lead?.title || lead?.customerName || 'Lead Center';
  const customerTabName = `${cd.firstName || ''} ${cd.lastName || ''}`.trim();
  const leadTime = lead?.leadTime || '';

  const resumeRef = useRef<{ confirm: (data: any, calcIdOverride?: string) => void; checking: boolean }>({
    confirm: () => {},
    checking: false,
  });

  const handleResultJob = useCallback(
    async (calculatorId: string, result: 'sale' | 'demo', price?: number, paymentMethod?: string, downPayment?: number) => {
      const openSheet = (startOnFunding?: boolean) => {
        setResultModal({ visible: true, calculatorId, resultType: result, price, paymentMethod, downPayment, startOnFunding });
        setCurrentCalculatorId(calculatorId);

        const progressLeadId = lead?._id || lead?.leadId || lead?.id;
        if (progressLeadId) {
          LeadService.updateLeadTimelineProgress(progressLeadId, {
            salesProcess: 'completed',
            leadResulted: 'active',
          }).catch((e: any) =>
            console.warn('[DynamicDealCenter] timeline progress (result opened) failed:', e?.message || e)
          );
        }
      };

      const resumeLeadId = lead?._id || lead?.leadId || lead?.id;
      if (result !== 'sale' || !resumeLeadId || resumeRef.current.checking) {
        openSheet();
        return;
      }

      resumeRef.current.checking = true;
      try {
        const res = await FundingService.getFunding(
          resumeLeadId,
          lead?.companyId || user?.companyId,
          user?._id || user?.id
        );
        const record = res.data?.data?.funding ?? null;
        // Collected money (down payment charged / cheque) pins the lead to the calculator that took it.
        // Fully-financed funding pins nothing, so sibling calculators may still be resulted.
        if (fundingPinnedToOtherCalculator(record, calculatorId)) {
          const ownerTitle =
            tabs.find((t) => String(t.id) === String(record?.calculatorId))?.title || 'another calculator';
          setFundingBlock({ ownerTitle });
          return;
        }
        if (canResumeJobBuild(record) && fundingBelongsToCalculator(record?.calculatorId, calculatorId)) {
          resumeRef.current.checking = false;
          openSheet(true);
          return;
        }
      } catch (err) {
        if (__DEV__) console.warn('[DynamicDealCenter] resume check failed:', err);
      } finally {
        resumeRef.current.checking = false;
      }
      openSheet();
    },
    [lead, user, pricing.plans, tabs]
  );

  const submittedCalculatorId = jobResetLocally ? null : resolveSubmittedCalculatorId(lead);

  const handleResetJobBuilder = () => {
    const resetLeadId = lead?._id || lead?.leadId || lead?.id;
    Alert.alert(
      'Reset Job Builder',
      'Are you sure you want to reset this lead result? This will clear the current result and allow you to re-enter the lead',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              if (resetLeadId) await LeadService.resetLead(resetLeadId);
              setJobResetLocally(true);
              queryClient.invalidateQueries({ queryKey: ['leads'] });
              if (resetLeadId) queryClient.invalidateQueries({ queryKey: ['lead', resetLeadId] });
              FlashMessage.success('Success', 'Job builder reset successfully');
            } catch (err) {
              console.error('[DynamicDealCenter] Reset job builder failed:', err);
              FlashMessage.error('Error', 'Could not reset job builder. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const optInHandledRef = useRef(false);
  useEffect(() => {
    const optIn = route?.params?.resultOptIn;
    if (!optIn?.calculatorId || optInHandledRef.current) return;
    if (isCalcLoading) return;
    const calc = tabs.find((t) => t.id === optIn.calculatorId);
    if (!calc) return;
    optInHandledRef.current = true;
    setActiveTabId(optIn.calculatorId);
    handleResultJob(optIn.calculatorId, 'sale', optIn.price, optIn.paymentMethod, optIn.downPayment);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.resultOptIn, isCalcLoading, tabs]);

  const [openedViaNotification, setOpenedViaNotification] = useState(false);
  const openJobBuilderHandledRef = useRef(false);
  useEffect(() => {
    if (!route?.params?.openJobBuilder || openJobBuilderHandledRef.current) return;
    if (isCalcLoading || !jobBuilderConfig || tabs.length === 0) return;

    openJobBuilderHandledRef.current = true;
    setOpenedViaNotification(true);
    if (__DEV__) {
      console.log(
        `[DynamicDealCenter] openJobBuilder → Summary (tabs=${tabs.length}, calcId=${
          route?.params?.calculatorResultData?.calculatorId || 'NONE'
        })`
      );
    }

    const pushedResult = route?.params?.calculatorResultData;
    const pushedCalcId = pushedResult?.calculatorId ? String(pushedResult.calculatorId) : '';
    if (pushedCalcId) {
      setCalculatorResultData((prev: any) =>
        prev?.calculatorId
          ? prev
          : { ...pushedResult, resultType: resultTypeFromLead(lead) }
      );
    }

    const targetId = pushedCalcId || resolveLeadCalculatorId(lead) || undefined;
    if (targetId && tabs.some((t) => t.id === targetId)) setActiveTabId(targetId);

    refetchJobBuilderConfig();
    setFlowStep('jobBuilder');
    navigation?.setParams({ openJobBuilder: undefined } as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.params?.openJobBuilder, isCalcLoading, jobBuilderConfig, tabs]);

  const buildFromExistingPrompt = (
    <BuildFromExistingModal
      visible={rehashBuild.prompt}
      onReuse={() => {
        setRehashBuild({ prompt: false, startFresh: false });
        setFlowStep('jobBuilder');
      }}
      onStartFresh={() => {
        setRehashBuild({ prompt: false, startFresh: true });
        setFlowStep('jobBuilder');
      }}
    />
  );

  const handleResultConfirm = useCallback((data: any, calcIdOverride?: string) => {
    setResultModal({ visible: false });
    const resultCalcId = calcIdOverride || currentCalculatorId;

    if (resultCalcId && data?.resultType === 'sale') {
      handleSetDownPayment(resultCalcId, Number(data?.downPayment) || 0);
    }

    const calc: any = tabs.find((t) => t.id === resultCalcId);
    setCalculatorResultData({
      ...data,
      calculatorId: resultCalcId,
      LFCalculator: calc || {},
      selectedAppointmentId: calc?.appointmentId,
    });

    const leadIdForProgress = lead?._id || lead?.leadId || lead?.id;
    if (leadIdForProgress) {
      LeadService.updateLeadTimelineProgress(leadIdForProgress, {
        salesProcess: 'completed',
        leadResulted: 'completed',
        jobBuild: 'active',
      }).catch((e: any) => console.warn('[DynamicDealCenter] timeline progress failed:', e?.message || e));
    }
    const uId = user?._id || user?.id;
    if (uId && leadIdForProgress) {
      logBuildJobInitiated({
        userId: uId,
        leadId: leadIdForProgress,
        result: data?.resultType || data?.result || undefined,
        calculatorId: resultCalcId || undefined,
        appointmentId: calc?.appointmentId || appointmentId || undefined,
        calculatorType: 'dynamic',
      }).catch(() => {});
    }
    const openJobBuilder = (startFresh: boolean) => {
      refetchJobBuilderConfig();
      setRehashBuild({ prompt: false, startFresh });
      setFlowStep('jobBuilder');
    };

    if (lead?.isRehashed !== true || !resultCalcId || !leadIdForProgress) {
      openJobBuilder(false);
      return;
    }

    LeadService.getLeadOutcomeByCalculator(leadIdForProgress, resultCalcId)
      .then((res: any) => {
        if (hasSavedJobBuild(extractCalculatorOutcome(res.data))) {
          setRehashBuild({ prompt: true, startFresh: false });
        } else {
          openJobBuilder(false);
        }
      })
      .catch((e: any) => {
        if (e?.httpStatus !== 404) {
          console.warn('[DynamicDealCenter] existing job-build check failed:', e?.message || e);
        }
        openJobBuilder(false);
      });
  }, [currentCalculatorId, tabs, lead, user, appointmentId, handleSetDownPayment, refetchJobBuilderConfig]);

  resumeRef.current.confirm = handleResultConfirm;

  const handleJobBuilderBack = useCallback(() => {
    setFlowStep('calculator');
  }, []);

  const handleJobBuilderComplete = useCallback((config: any, state: any) => {
    navigation?.reset({
      index: 1,
      routes: [
        { name: 'Leads' },
        {
          name: 'LeadCenter',
          params: { lead, tab: 'job_docs', justCompleted: true },
        },
      ],
    });
  }, [navigation, lead]);

  const consolidatedDealCenterData = useMemo(() => {
    const resultedId = calculatorResultData?.calculatorId || currentCalculatorId;
    const resultedTab = resultedId ? tabs.find((t) => t.id === resultedId) : undefined;
    const entries =
      resultedTab?.entries ||
      calculatorResultData?.LFCalculator?.entries ||
      activeTab?.entries ||
      {};
    return buildDealCenterData({
      entries,
      resultData: calculatorResultData || {},
      schemas: verticals,   // CalculatorSchema[] — same array used by the calculator
      lead: lead || {},
    });
  }, [lead, calculatorResultData, currentCalculatorId, tabs, activeTab, verticals]);

  const summaryCalculators = tabs.map((t) => ({
    _id: t.id,
    title: t.title,
    appointmentId,
    price: t.price,
    dropPrice: t.dropPrice || [],
    paymentMethod: t.paymentMethod,
    totals: t.totals,
    entries: t.entries,
  }));

  // ⚠️ ABOVE every early return below. `flowStep` changes at runtime (the View-all
  // button sets 'rollout'), so a hook placed after those returns runs on one render and
  // not the next - "Rendered fewer hooks than expected", which crashed the screen.
  const isLoading = isSchemaLoading || isCalcLoading || isJobBuilderConfigLoading;
  const loadIsSlow = useSlowLoadHint(isLoading);

  if (flowStep === 'jobBuilder') {
    return (
      <DynamicJobBuilderScreen
        navigation={navigation}
        initialConfig={jobBuilderConfig ?? undefined}
        calculatorSchemas={verticals}
        dealCenterData={consolidatedDealCenterData}
        calculatorResultData={calculatorResultData}
        leadId={lead?._id || lead?.leadId || lead?.id}
        lead={lead}
        appointmentId={appointmentId || undefined}
        allCalculators={summaryCalculators}
        startFresh={rehashBuild.startFresh}
        openOnSummary={openedViaNotification}
        onGoBack={handleJobBuilderBack}
        onJobComplete={handleJobBuilderComplete}
      />
    );
  }

  if (flowStep === 'rollout') {
    return (
      <>
        <RolloutView
          calculators={tabs}
          verticals={verticals}
          pricingConfig={pricingConfig}
          pricing={pricing}
          isLowesLead={lead?.lowesLead === true}
          isRehashed={lead?.isRehashed === true}
          leadId={lead?._id || lead?.leadId || lead?.id}
          appointmentId={appointmentId || undefined}
          onBack={() => setFlowStep('calculator')}
          onConfirmRollouts={(confirmed) => {
            releaseRehashDrafts(rehashLatchRef.current, confirmed.map((c) => c.id));
            handleConfirmRollouts(confirmed);

            const justConfirmed = new Set(confirmed.map((c) => c.id));
            const afterConfirm = tabs.map((t) =>
              justConfirmed.has(t.id) ? { ...t, isRolloutConfirmed: true } : t
            );
            if (allRolloutsConfirmed(afterConfirm)) {
              markLeadRolloutsConfirmed(queryClient, lead);
            }
          }}
          onResultJob={handleResultJob}
          onPriceCommit={handleSetPrice}
          onDismissScopeWarning={handleAckScopeWarning}
          onPaymentMethodChange={handleSetPaymentMethod}
          onDropChange={handleSetDrops}
          onDiscountChange={handleSetDiscount}
          onDownPaymentChange={handleSetDownPayment}
          onRendersChange={handleSetRenders}
          onOneYearMonthlyChange={handleSetOneYearMonthly}
          onRolloutsConfirmedDone={() => {
            markLeadRolloutsConfirmed(queryClient, lead);
            backToLeadCenter(navigation, lead);
          }}
          activeTabId={activeTabId}
          onTabSelect={setActiveTabId}
          submittedCalculatorId={submittedCalculatorId}
          onResetJobBuilder={handleResetJobBuilder}
        />
        <ResultJobModal
          visible={resultModal.visible}
          lead={lead}
          calculatorTitle={tabs.find((t) => t.id === resultModal.calculatorId)?.title}
          calculatorId={resultModal.calculatorId}
          fundingSource={fundingSource}
          resultType={resultModal.resultType}
          initialPrice={resultModal.price}
          initialPaymentMethod={resultModal.paymentMethod}
          initialDownPayment={resultModal.downPayment}
          startOnFunding={resultModal.startOnFunding}
          entries={tabs.find((t) => t.id === resultModal.calculatorId)?.entries || {}}
          verticals={verticals}
          sectionLabelMap={sectionLabelMap}
          isLowesLead={lead?.lowesLead === true}
          pricing={pricing}
          onClose={() => setResultModal({ visible: false })}
          onConfirm={handleResultConfirm}
        />
        {buildFromExistingPrompt}
        <ConfirmDialog
          visible={!!fundingBlock}
          tone="warn"
          hideCancel
          title="Down payment already collected"
          message={`A payment was already collected against the calculator "${fundingBlock?.ownerTitle || ''}". This lead can only be resulted against that calculator.`}
          note="To result a different calculator, first run the refund process against the collected payment."
          confirmLabel="OK"
          onConfirm={() => setFundingBlock(null)}
          onCancel={() => setFundingBlock(null)}
        />
      </>
    );
  }

  const isDynamicConfigured = hasCalculatorSchema && hasJobBuilderConfig;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={numPadActive ? [] : ['bottom']}>
      {/* Compact header — back button + lead name + save status, matching the regular deal center */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
        <TouchableOpacity
          onPress={() => navigation?.goBack()}
          style={{ width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}
        >
          <Ionicons name="arrow-back" size={16} color="#637381" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: '900', color: '#1C252E' }} numberOfLines={1}>
             {customerName}
            {leadTime ? <Text style={{ fontSize: 18, fontWeight: '900', color: '#1C252E' }}> - {leadTime} Lead</Text> : ''}
          </Text>
          {isSaving ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
              <ActivityIndicator size={8} color="#4CBB17" />
              <Text style={{ fontSize: 10, fontWeight: '900', color: '#16a34a', marginLeft: 4 }}>Syncing…</Text>
            </View>
          ) : (
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#94A3B8', marginTop: 1 }}>
              {lastUpdated ? `Last updated at ${lastUpdated}` : 'No changes to save'}
            </Text>
          )}
        </View> 
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <ActivityIndicator size="large" color="#4CBB17" />
          {/* ⚠️ Never a bare spinner past a few seconds. On one bar this screen used to hold
              "Loading calculator…" for two minutes with no message and no way out — the rep
              could not tell a slow line from a broken app. */}
          <Text style={{ marginTop: 12, fontSize: 13, color: '#94A3B8', textAlign: 'center' }}>
            {loadIsSlow ? 'Still loading — your connection looks slow' : 'Loading calculator…'}
          </Text>
          {loadIsSlow && (
            <>
              <Text style={{ marginTop: 6, fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
                You can carry on with the copy saved on this device.
              </Text>
              <TouchableOpacity
                onPress={workFromDevice}
                style={{ marginTop: 16, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#4CBB17' }}
              >
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Work offline</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : offlineUnavailable ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="cloud-offline-outline" size={40} color="#CBD5E1" />
          <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '800', color: '#475569', textAlign: 'center' }}>
            This quote isn’t saved on your device
          </Text>
          <Text style={{ marginTop: 6, fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
            This lead may already have calculators on the server, and starting a new one here
            {'\n'}would file it alongside them.
            {'\n'}{'\n'}Open the Deal Center once with a connection and it will be available offline.
          </Text>
          <TouchableOpacity
            onPress={() => navigation?.goBack()}
            style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#4CBB17' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Back to Tools</Text>
          </TouchableOpacity>
        </View>
      ) : !isDynamicConfigured && !isOnline() ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="cloud-offline-outline" size={40} color="#CBD5E1" />
          <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '800', color: '#475569', textAlign: 'center' }}>
            Deal Center isn’t saved on this device yet
          </Text>
          <Text style={{ marginTop: 6, fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
            Open the Leads list or the Deal Center once with a connection and it will be available offline.
          </Text>
          <TouchableOpacity
            onPress={() => navigation?.goBack()}
            style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#4CBB17' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Back</Text>
          </TouchableOpacity>
        </View>
      ) : !isDynamicConfigured ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Ionicons name="construct-outline" size={40} color="#CBD5E1" />
          <Text style={{ marginTop: 12, fontSize: 15, fontWeight: '800', color: '#475569', textAlign: 'center' }}>
            Deal Center isn’t configured yet
          </Text>
          <Text style={{ marginTop: 6, fontSize: 12, color: '#94A3B8', textAlign: 'center', lineHeight: 18 }}>
            {!hasCalculatorSchema
              ? 'No calculator form schema has been published for this company.'
              : 'No job-builder configuration has been published for this company.'}
            {'\n'}Ask an admin to configure it in the web portal. In the meantime, use
            {'\n'}“Classic Deal Center” on the previous screen.
          </Text>
          <TouchableOpacity
            onPress={() => navigation?.goBack()}
            style={{ marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10, backgroundColor: '#4CBB17' }}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>Use Classic Deal Center</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <CalculatorView
          verticals={verticals}
          customerTabName={customerTabName}
          pricingConfig={pricingConfig}
          entries={activeTab?.entries || {}}
          onEntryChange={handleEntryChange}
          onClearSection={handleClearSection}
          totals={activeTab?.totals || { cost: 0, par: 0, retail: 0 }}
          readOnly={!isRehashDraftTab && (activeTab?.isRolloutConfirmed || lead?.isRehashed === true)}
          price={activeTab?.price || 0}
          drops={activeTab?.dropPrice || []}
          tabs={tabs}
          activeTabId={activeTabId}
          onTabSelect={setActiveTabId}
          onAddTab={handleAddTab}
          onRenameTab={handleRenameTab}
          onDuplicateTab={handleDuplicateTab}
          onDeleteTab={handleDeleteTab}
          onReorderTabs={handleReorderTabs}
          onViewAll={() => {
            const uId = user?._id || user?.id;
            if (uId) logViewAllCalculators(uId).catch(() => {});
            setFlowStep('rollout');
          }}
          appointmentId={appointmentId || undefined}
          isLowesLead={lead?.lowesLead === true}
          plans={pricing.plans}
          defaultMethod={pricing.defaultMethod}
        />
      )}

        <ResultJobModal
          visible={resultModal.visible}
          lead={lead}
          calculatorTitle={tabs.find((t) => t.id === resultModal.calculatorId)?.title}
          calculatorId={resultModal.calculatorId}
          fundingSource={fundingSource}
          resultType={resultModal.resultType}
          initialPrice={resultModal.price}
          initialPaymentMethod={resultModal.paymentMethod}
          initialDownPayment={resultModal.downPayment}
          startOnFunding={resultModal.startOnFunding}
          entries={tabs.find((t) => t.id === resultModal.calculatorId)?.entries || {}}
          verticals={verticals}
          sectionLabelMap={sectionLabelMap}
          isLowesLead={lead?.lowesLead === true}
          pricing={pricing}
          onClose={() => setResultModal({ visible: false })}
          onConfirm={handleResultConfirm}
        />
        {buildFromExistingPrompt}
        <ConfirmDialog
          visible={!!fundingBlock}
          tone="warn"
          hideCancel
          title="Down payment already collected"
          message={`A payment was already collected against the calculator "${fundingBlock?.ownerTitle || ''}". This lead can only be resulted against that calculator.`}
          note="To result a different calculator, first run the refund process against the collected payment."
          confirmLabel="OK"
          onConfirm={() => setFundingBlock(null)}
          onCancel={() => setFundingBlock(null)}
        />
    </SafeAreaView>
  );
}
