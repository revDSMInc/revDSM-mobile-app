import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { pricing, extrasList, extrasList50 } from '../../utils/calculator/pricing-data';
import { paymentPlans } from '../../utils/calculator/payment-plans';
import { useAuth } from '../../hooks/useAuth';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Alert,
  Platform,
  InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { LeadService } from '../../services/api/leads';
import JobService from '../../services/api/JobService';
import { ModalContainer } from '../../widgets/components/LeadCenter/SharedElements';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { Header } from '../../widgets/common/MainHeader';
import Feather from 'react-native-vector-icons/Feather';

// Modular Imports
import { CalculatorForm } from '../../widgets/components/dealcenter/CalculatorForm';
import { CalculatorSummary } from '../../widgets/components/dealcenter/CalculatorSummary';
import {
  demoReasons,
  PaymentPlanPicker,
  ResultView,
} from '../../widgets/components/dealcenter/ResultViews';
import { OutcomeModal, LoadingOverlay } from '../../widgets/modals/DealCenter/OutcomeModal';
import { getAvailableSteps } from '../../utils/job-builder-util';
import { getPresentComponents } from '../../utils/calculator/tab-naming.utils';
import { AddEditJobModal } from '../../screens/JobTracker/components/AddEditJobModal';
import { format } from 'date-fns';

import { useDealCalculator } from '../../hooks/useDealCalculator';
import { HorizontalDraggableTabs } from '../../widgets/components/dealcenter/HorizontalDraggableTabs';
import { useDealOutcome } from '../../hooks/useDealOutcome';

const INITIAL_JOB_STATE = {
  gutter: {
    partial: '',
    gutterColorsMulti: [],
    downspoutsMulti: [],
    extrasColors: { groundSpout: 'Black' },
  },
  leaffilter: {
    combinations: [],
    extras: { csr: 0, cornersFilter: 0, sawzallHanger: 0, removeProtection: 0, ribbedRoof: 0 },
  },
  soffit: { vinyl: { type: '' }, porch: { location: [] }, nailer: { type: '' } },
  fascia: { wrap: { type: '' }, boards: { boardType: '' }, aluminumBoards: { footage: '' } },
  lighting: {
    combinations: [],
    extras: { boosterBox: 0, controlBox: 0, electricalOutlet: 0, wifiExtender: 0 },
  },
  additional: { extraLabor: 0 },
  scheduleTime: null,
};

export default function LFCalculator({ route }: any) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const [currentLead, setCurrentLead] = useState(route.params?.lead);
  const onRefresh = route.params?.onRefresh;
  const onClose = () => navigation.goBack();
  const isLowesLead = currentLead?.lowesLead === true;

  const [currentView, setCurrentView] = useState<
    'form' | 'summary' | 'picker' | 'result' | 'outcome'
  >('form');
  const [prevView, setPrevView] = useState<'form' | 'summary'>('form');
  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const [showJobBuilder, setShowJobBuilder] = useState(false);
  const [menuVisible, setMenuVisible] = useState<number | null>(null);
  const [trackerJobs, setTrackerJobs] = useState<any[]>([]);
  const [showTooltip, setShowTooltip] = useState(false);
  const [isDraggingTab, setIsDraggingTab] = useState(false);
  const tabsScrollViewRef = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);

  useEffect(() => {
    navigation.setOptions({
      gestureEnabled: false,
    });
  }, [navigation]);

  const {
    calculators,
    setCalculators,
    activeIdx,
    setActiveIdx,
    active,
    inputs,
    extras,
    discounts,
    results,
    updateActive,
    loading: calcLoading,
    setLoading: setCalcLoading,
    isAutoSaving,
    lastUpdatedAt,
    appointmentId,
    handleAddNewCalculator,
    fetchCalculators,
    handleDuplicateCalculator,
    handleDeleteCalculator,
    handleReorderCalculators,
  } = useDealCalculator(currentLead);

  useEffect(() => {
    if (activeIdx >= 0 && calculators.length > 0) {
      // Auto-scroll so the active tab is in view
      const tabWidth = 90;
      const targetOffset = Math.max(0, (activeIdx - 1) * tabWidth);
      tabsScrollViewRef.current?.scrollTo({ x: targetOffset, animated: true });
    }
  }, [activeIdx, calculators.length]);

  const isFullPackage = useMemo(() => {
    if (!active) return false;
    const presentComponents = getPresentComponents(active);
    return (
      presentComponents.has('G') &&
      presentComponents.has('S') &&
      presentComponents.has('FWrap') &&
      (presentComponents.has('Versa') || presentComponents.has('VMax'))
    );
  }, [active]);

  const {
    outcomeStatus,
    setOutcomeStatus,
    outcomeForm,
    setOutcomeForm,
    handleStatusSelect: handleStatusSelectHook,
    handleFinishOutcome: handleFinishOutcomeHook,
    refetchOutcome,
    loading: outcomeLoading,
    setLoading: setOutcomeLoading,
    loadingMessage,
    jobState,
    setJobState,
  } = useDealOutcome(currentLead, active, results, appointmentId, onRefresh, onClose);

  const fetchTrackerJobs = useCallback(async () => {
    try {
      const jobs = await JobService.getJobs();
      setTrackerJobs(jobs);
    } catch (e) { }
  }, []);

  useEffect(() => {
    fetchTrackerJobs();
  }, [fetchTrackerJobs]);

  const isAlreadyInTracker = useMemo(() => {
    if (!active?._id) return false;
    return trackerJobs.some((j) => j.calculatorId === active._id);
  }, [trackerJobs, active?._id]);

  const handleStatusSelect = (status: 'demo' | 'sale') => {
    handleStatusSelectHook(status);
    setCurrentView('outcome');
  };

  const handleAddJobToTracker = () => {
    setShowAddJobModal(true);
  };

  const prefilledJob = useMemo(() => {
    if (!currentLead || !active) return null;

    // If it's already in the tracker, return the existing job so we can edit it
    const existing = trackerJobs.find((j) => j.calculatorId === active._id);
    if (existing) return existing;

    const customerName = currentLead.customerDetails
      ? `${currentLead.customerDetails.firstName} ${currentLead.customerDetails.lastName}`
      : currentLead.title || '';

    // Map calculator payment plan to JobTracker payment method
    const paymentMethod = active.inputs?.paymentPlan || 'check';

    return {
      customerName,
      title: active.name || '',
      salesPrice: results.total || 0,
      paymentMethod,
      soldDate: format(new Date(), 'yyyy-MM-dd'),
      appointmentId: String(appointmentId || ''),
      calculatorId: String(active._id || ''),
      isManual: false,
    };
  }, [currentLead, active, results.total, appointmentId, trackerJobs]);


  const handleFinishOutcome = () => {
    handleFinishOutcomeHook((showJB: boolean) => {
      if (showJB) {
        // Ensure the native Outcome modal unmounts before navigating (critical on iOS).
        setCurrentView('summary');
        InteractionManager.runAfterInteractions(() => {
          navigation.navigate('JobBuilder', {
            initialJobState: jobState,
            calculatorData: active,
            leadId: currentLead?._id || currentLead?.leadId || currentLead?.id,
            outcomeForm: { ...outcomeForm, result: outcomeStatus },
            // Called when user closes JobBuilder WITHOUT completing
            onGoBack: (updatedJobState: any) => {
              setJobState(updatedJobState);
              setCurrentView('outcome');
            },
            // Called when user COMPLETES the job — close modal, go to Rollout view, and refresh data
            onComplete: (updatedJobState: any) => {
              if (updatedJobState) {
                // Update local lead state with the completed job builder data
                setCurrentLead((prev: any) => ({
                  ...prev,
                  jobBuilder: updatedJobState,
                }));
              }
              // Clear jobState so we don't show "Reset Job Builder" if we ever come back
              setJobState({});

              // Reset the navigation stack to LeadCenter (with Job Docs tab) and Leads list
              // This properly removes JobBuilder and DealCenter from the history
              navigation.reset({
                index: 1,
                routes: [
                  { name: 'Leads' },
                  {
                    name: 'LeadCenter',
                    params: {
                      lead: currentLead,
                      tab: 'job_docs'
                    }
                  },
                ],
              });
            },
          });
        });
      }
    });
  };

  const setLoading = (val: boolean) => {
    setCalcLoading(val);
    setOutcomeLoading(val);
  };

  const [expanded, setExpanded] = useState<any>({
    gutters: true,
    protection: true,
    structural: true,
    maintenance: true,
    finance: true,
    lighting: false,
  });

  const loading = calcLoading || outcomeLoading;
  const isJobBuilderSubmitted = jobState?.status === 'submitted' || currentLead?.jobBuilder?.status === 'submitted';

  const openPicker = () => {
    setPrevView(currentView as 'form' | 'summary');
    setCurrentView('picker');
  };

  const fetchFreshLead = useCallback(async () => {
    const leadId = currentLead?._id || currentLead?.leadId || currentLead?.id;
    if (!leadId || !user?._id) return null;
    try {
      // Mirror the 'entry' logic by using workLead API
      const res = await LeadService.workLead(leadId, user._id);
      const freshLead = res.data?.data || res.data;
      if (freshLead) {
        setCurrentLead(freshLead);
        return freshLead;
      }
    } catch (error) {
      console.error('[DealCenter] Failed to fetch fresh lead:', error);
    }
    return null;
  }, [currentLead, user?._id]);

  const refreshCalculators = useCallback(async () => {
    try {
      setCalcLoading(true);
      const freshLead = await fetchFreshLead();
      await Promise.all([
        fetchCalculators(freshLead),
        fetchTrackerJobs(),
        refetchOutcome(freshLead?._id || freshLead?.id || freshLead?.leadId),
      ]);
    } catch (e) {
      console.error('[DealCenter] Full refresh failed:', e);
    } finally {
      setCalcLoading(false);
    }
  }, [fetchFreshLead, fetchCalculators, fetchTrackerJobs, refetchOutcome, setCalcLoading]);

  const handleResetJobBuilder = () => {
    Alert.alert(
      'Reset Job Builder',
      'This will reset the job builder for this rollout. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              const leadId = currentLead?._id || currentLead?.leadId || currentLead?.id;
              if (leadId) await LeadService.resetLead(leadId);
              // Immediately clear local jobState so the UI reflects the reset
              // without waiting for the async re-fetch to complete
              setJobState({});
              setCurrentLead((prev: any) => ({
                ...prev,
                jobBuilder: {},
              }));
              refreshCalculators();
            } catch (err) {
              console.error('[DealCenter] Reset job builder failed:', err);
              Alert.alert('Error', 'Could not reset job builder. Please try again.');
            }
          },
        },
      ],
      { cancelable: true }
    );
  };


  const handleManualSave = async () => {
    if (!active?._id) return;
    try {
      const payload = {
        title: active.name,
        gutter5DsE: Number(active.inputs.gutter5DsE),
        gutter6Ft1: Number(active.inputs.gutter6Ft1),
        gutter7DsE: Number(active.inputs.gutter7DsE),
        miters: Number(active.inputs.miters),
        endCaps: Number(active.inputs.endCaps),
        spoutSavers: Number(active.inputs.spoutSavers),
        versaMaxFt1: Number(active.inputs.versaMaxFt1),
        versaMaxFt2: Number(active.inputs.versaMaxFt2),
        versaMaxFt3: Number(active.inputs.versaMaxFt3),
        versa6Ft1: Number(active.inputs.versa6Ft1),
        versa7Ft1: Number(active.inputs.versa7Ft1),
        filter45Ft1: Number(active.inputs.filter45Ft1),
        versa6Ft2: Number(active.inputs.versa6Ft2),
        versa7Ft2: Number(active.inputs.versa7Ft2),
        filter45Ft2: Number(active.inputs.filter45Ft2),
        versa6Ft3: Number(active.inputs.versa6Ft3),
        versa7Ft3: Number(active.inputs.versa7Ft3),
        filter45Ft3: Number(active.inputs.filter45Ft3),
        ckToInstallers: Number(active.inputs.ckToInstallers),
        extraLabor: Number(active.inputs.extraLabor),
        paymentMethod: active.inputs.paymentPlan,
        pricemarkup: active.inputs.markup,
        price: active.price,
        isRolloutConfirmed: active.isRolloutConfirmed,
        discounts: active.discounts,
        ...Object.keys(active.extras).reduce(
          (acc, k) => ({
            ...acc,
            [(extrasList as any[]).find((e: any) => e.id === k)?.apiKey || k]: Number(
              active.extras[k]
            ),
          }),
          {}
        ),
      };
      await LeadService.updateCalculator(active._id, payload);
    } catch (e) {
      console.warn('Manual save failed', e);
    }
  };

  if (!currentLead) return null;

  const handleResetOutcome = async () => {
    try {
      setLoading(true);
      if (!currentLead?._id) return;
      const res = await LeadService.getLeadOutcome(currentLead._id);
      const data = res.data?.data || res.data;
      if (data) {
        const outcome = data.outcome || data.leadData || data;
        setOutcomeStatus(outcome.status || outcome.result);
        setOutcomeForm({
          ...outcomeForm,
          ...outcome,
        });
      }
    } catch (e) {
      console.warn('Outcome reset failed', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalContainer>
      <Header />
      {loading && (
        <View className="absolute inset-0 z-50 items-center justify-center bg-black/5">
          <ActivityIndicator color="#4CBB17" size="large" />
        </View>
      )}

      {/* Unified Fixed Header with Back Button and Title (Only shown in Form View) */}
      {currentView === 'form' && (
        <View className="px-5 pt-4 pb-3 flex-row items-center justify-between border-b border-border bg-card">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={onClose}
              className="mr-3 p-1 items-center justify-center w-8 h-8 border border-border rounded-lg"
            >
              <Feather
                name="arrow-left"
                size={14}
                color={isDark ? colors.text : colors.textSecondary}
              />
            </TouchableOpacity>
            <View>
              <Text className="text-lg font-black text-text-primary">
                {currentLead?.customerDetails?.firstName
                  ? `${currentLead.customerDetails.firstName} ${currentLead.customerDetails.lastName}`
                  : currentLead?.title || 'Lead Center'}{' '}
                <Text className="text-lg font-black text-text-primary">
                  - {currentLead?.leadTime || ''} Lead
                </Text>
              </Text>
              <View className="flex-row items-center mt-0.5">
                {isAutoSaving ? (
                  <View className="flex-row items-center">
                    <ActivityIndicator size={8} color="#4CBB17" />
                    <Text className="text-[10px] font-black text-green-600  ml-1">Syncing...</Text>
                  </View>
                ) : lastUpdatedAt ? (
                  <Text className="text-[10px] font-bold text-text-secondary ">
                    Last updated at {lastUpdatedAt}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </View>
      )}

      {currentView === 'form' && (
        <>
          <CalculatorForm
            inputs={inputs}
            extras={extras}
            expanded={expanded}
            onToggle={(id: string) => setExpanded({ ...expanded, [id]: !expanded[id] })}
            onUpdate={updateActive}
            readOnly={!!active?.isRolloutConfirmed}
            results={results}
            onClose={onClose}
            handleAddJobToTracker={handleAddJobToTracker}
            onGoToTracker={() => navigation.navigate('JobTracker')}
            isAlreadyInTracker={isAlreadyInTracker}
            refresh={refreshCalculators}
            active={active}
            lead={currentLead}
            isDark={isDark}
            colors={colors}
            isAutoSaving={isAutoSaving}
            lastUpdatedAt={lastUpdatedAt}
          />
          <View
            className="px-5 py-4 border-t border-border bg-card relative"
            style={{ paddingBottom: Platform.OS === 'ios' ? 0 : insets.bottom + 10, position: 'relative', overflow: 'visible' }}
          >


            <View className="flex-row items-center justify-between" style={{ overflow: 'visible', height: 44 }}>
              <View style={{ flex: 1, marginRight: 16, height: 44, justifyContent: 'center', overflow: isDraggingTab ? 'visible' : 'hidden' }}>
                <ScrollView
                  ref={tabsScrollViewRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  scrollEnabled={!isDraggingTab}
                  onScroll={(e) => {
                    scrollXRef.current = e.nativeEvent.contentOffset.x;
                  }}
                  scrollEventThrottle={16}
                  style={{ overflow: isDraggingTab ? 'visible' : 'hidden' }}
                  contentContainerStyle={{ alignItems: 'center' }}
                >
                  <HorizontalDraggableTabs
                    calculators={calculators}
                    activeIdx={activeIdx}
                    setActiveIdx={setActiveIdx}
                    onReorder={handleReorderCalculators}
                    setMenuVisible={setMenuVisible}
                    onDragStateChange={setIsDraggingTab}
                    tabsScrollViewRef={tabsScrollViewRef}
                    scrollXRef={scrollXRef}
                  />
                </ScrollView>
              </View>

              <View className="flex-row items-center gap-2" style={{ flexShrink: 0 }}>
                <TouchableOpacity
                  onPress={handleAddNewCalculator}
                  style={{ width: 44, height: 44 }}
                  className="bg-surface rounded-xl items-center justify-center border border-border"
                >
                  <Ionicons name="add" size={24} color={colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setCurrentView('summary')}
                  style={{ width: 44, height: 44 }}
                  className="bg-[#2169f3] rounded-xl items-center justify-center shadow-lg shadow-slate-900/20"
                >
                  <Ionicons name="grid" size={20} color="white" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </>
      )}

      {currentView === 'summary' && (
        <CalculatorSummary
          activeCalc={active}
          results={results}
          calculators={calculators}
          setCalculators={setCalculators}
          setActiveIdx={setActiveIdx}
          activeIdx={activeIdx}
          setCurrentView={setCurrentView}
          openPicker={openPicker}
          handleStatusSelect={handleStatusSelect}
          updateActive={updateActive}
          handleSave={handleManualSave}
          insets={insets}
          refresh={refreshCalculators}
          onClose={onClose}
          handleAddJobToTracker={handleAddJobToTracker}
          onGoToTracker={() => navigation.navigate('JobTracker')}
          isAlreadyInTracker={isAlreadyInTracker}
          lead={currentLead}
          jobBuilderState={jobState}
          handleResetJobBuilder={handleResetJobBuilder}
        />
      )}

      {currentView === 'result' && (
        <ResultView
          onBack={() => setCurrentView('summary')}
          handleAddJobToTracker={handleAddJobToTracker}
          hasItems={results.items.length > 0}
          isAlreadyInTracker={isAlreadyInTracker}
        />
      )}

      <OutcomeModal
        visible={currentView === 'outcome'}
        onClose={() => setCurrentView('summary')}
        outcomeForm={outcomeForm}
        setOutcomeForm={setOutcomeForm}
        outcomeStatus={outcomeStatus}
        handleStatusSelect={handleStatusSelect}
        calculators={calculators}
        activeIdx={activeIdx}
        setActiveIdx={setActiveIdx}
        refreshCalculators={refreshCalculators}
        results={results}
        handleFinishOutcome={handleFinishOutcome}
        onReset={handleResetOutcome}
        onResetJobBuilder={handleResetJobBuilder}
        loading={loading}
        isJobBuilderSubmitted={isJobBuilderSubmitted}
        lead={currentLead}
      />

      <Modal visible={currentView === 'picker'} transparent animationType="slide">
        <Pressable
          className="flex-1 bg-black/40 justify-end"
          onPress={() => setCurrentView(prevView)}
        >
          <View className="bg-card rounded-t-[40px] p-8 pb-12 shadow-2xl">
            <View className="w-12 h-1.5 bg-surface rounded-full self-center mb-8" />
            <Text className="text-xl font-black text-text-primary mb-6">Select Payment Plan</Text>
            <ScrollView className="max-h-[500px]" showsVerticalScrollIndicator={false}>
              <View className="gap-3">
                {/* Basic Options */}
                {['check', 'mcVisaDscvr', 'amex'].map((key) => {
                  const plan = paymentPlans[key];
                  if (!plan) return null;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => {
                        updateActive({ inputs: { paymentPlan: key } });
                        setCurrentView(prevView);
                      }}
                      className={`p-5 border-2 rounded-3xl flex-row items-center justify-between ${inputs.paymentPlan === key
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-surface'
                        }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-black ${inputs.paymentPlan === key ? 'text-green-500' : 'text-text-primary'
                            }`}
                        >
                          {plan.label}
                        </Text>
                      </View>
                      {inputs.paymentPlan === key && (
                        <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* GreenSky Plans */}
                <View className="bg-[#d9ead3] p-3 rounded-xl mt-4">
                  <Text className="text-xs font-black text-black ">GreenSky Plans</Text>
                </View>
                {[
                  'greensky2511',
                  'greensky2521',
                  'greensky2531',
                  'greensky1599',
                  'greensky1509',
                  'greensky2011',
                ].map((key) => {
                  const plan = paymentPlans[key];
                  if (!plan) return null;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => {
                        updateActive({ inputs: { paymentPlan: key } });
                        setCurrentView(prevView);
                      }}
                      className={`p-5 border-2 rounded-3xl flex-row items-center justify-between ${inputs.paymentPlan === key
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-surface'
                        }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-black ${inputs.paymentPlan === key ? 'text-green-500' : 'text-text-primary'
                            }`}
                        >
                          {plan.label}
                        </Text>
                        {plan.displayMonths && (
                          <Text className="text-[10px] font-bold text-text-secondary  mt-1">
                            {plan.displayMonths}
                          </Text>
                        )}
                      </View>
                      {inputs.paymentPlan === key && (
                        <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* Wells Fargo Plans */}
                <View className="bg-[#f4cccc] p-3 rounded-xl mt-4">
                  <Text className="text-xs font-black text-black ">Wells Fargo Plans</Text>
                </View>
                {[
                  'wf1148',
                  'wf1019',
                  'wf1157',
                  'wf1197',
                  'wf2225',
                  'wf3198',
                  'wf1529',
                  'wf4073',
                  'wf4079',
                  'wf4091',
                  'wf4103',
                  'wf4115',
                ].map((key) => {
                  const plan = paymentPlans[key];
                  if (!plan) return null;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => {
                        updateActive({ inputs: { paymentPlan: key } });
                        setCurrentView(prevView);
                      }}
                      className={`p-5 border-2 rounded-3xl flex-row items-center justify-between ${inputs.paymentPlan === key
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-surface'
                        }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-black ${inputs.paymentPlan === key ? 'text-green-500' : 'text-text-primary'
                            }`}
                        >
                          {plan.label}
                        </Text>
                        {plan.displayMonths && (
                          <Text className="text-[10px] font-bold text-text-secondary  mt-1">
                            {plan.displayMonths}
                          </Text>
                        )}
                      </View>
                      {inputs.paymentPlan === key && (
                        <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* Wells Fargo High Plans */}
                <View className="bg-[#f4cccc] p-3 rounded-xl mt-4">
                  <Text className="text-xs font-black text-black ">
                    Wells Fargo Plans (Over $7,500)
                  </Text>
                </View>
                {['wf3672', 'wf3667', 'wf3668', 'wf3669', 'wf3670', 'wf3671'].map((key) => {
                  const plan = paymentPlans[key];
                  if (!plan) return null;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => {
                        updateActive({ inputs: { paymentPlan: key } });
                        setCurrentView(prevView);
                      }}
                      className={`p-5 border-2 rounded-3xl flex-row items-center justify-between ${inputs.paymentPlan === key
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-surface'
                        }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-black ${inputs.paymentPlan === key ? 'text-green-500' : 'text-text-primary'
                            }`}
                        >
                          {plan.label}
                        </Text>
                        {plan.displayMonths && (
                          <Text className="text-[10px] font-bold text-text-secondary  mt-1">
                            {plan.displayMonths}
                          </Text>
                        )}
                      </View>
                      {inputs.paymentPlan === key && (
                        <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* Concora Credit */}
                <View className="bg-[#c9daf8] p-3 rounded-xl mt-4">
                  <Text className="text-xs font-black text-black ">Concora Credit</Text>
                </View>
                {['concora'].map((key) => {
                  const plan = paymentPlans[key];
                  if (!plan) return null;
                  return (
                    <TouchableOpacity
                      key={key}
                      onPress={() => {
                        updateActive({ inputs: { paymentPlan: key } });
                        setCurrentView(prevView);
                      }}
                      className={`p-5 border-2 rounded-3xl flex-row items-center justify-between ${inputs.paymentPlan === key
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-surface'
                        }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-black ${inputs.paymentPlan === key ? 'text-green-500' : 'text-text-primary'
                            }`}
                        >
                          {plan.label}
                        </Text>
                      </View>
                      {inputs.paymentPlan === key && (
                        <Ionicons name="checkmark-circle" size={20} color="#22C55E" />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
            <TouchableOpacity
              onPress={() => setCurrentView(prevView)}
              className="mt-8 h-16 bg-grey-900 rounded-3xl items-center justify-center"
            >
              <Text className="text-grey-0 font-black  tracking-widest text-xs">Close</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>



      {menuVisible !== null && (
        <Modal
          transparent
          visible={menuVisible !== null}
          animationType="fade"
          onRequestClose={() => setMenuVisible(null)}
        >
          <Pressable className="flex-1 bg-black/20" onPress={() => setMenuVisible(null)}>
            <View
              style={{
                position: 'absolute',
                bottom: insets.bottom + 70,
                left: 20,
                right: 20,
                backgroundColor: isDark ? '#1C252E' : 'white',
                borderRadius: 16,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.15,
                shadowRadius: 12,
                elevation: 10,
                padding: 8,
              }}
            >
              {menuVisible !== null && calculators[menuVisible]?.name !== '.' && (
                <TouchableOpacity
                  onPress={() => {
                    if (menuVisible !== null) {
                      handleDuplicateCalculator(menuVisible).then(() => setMenuVisible(null));
                    }
                  }}
                  className="flex-row items-center p-3 rounded-xl"
                >
                  <Feather name="copy" size={18} color={isDark ? '#919EAB' : '#637381'} />
                  <Text className="ml-3 text-sm font-semibold" style={{ color: colors.text }}>
                    Duplicate
                  </Text>
                </TouchableOpacity>
              )}

              {calculators.length > 1 && (
                <TouchableOpacity
                  onPress={() => {
                    if (menuVisible !== null) {
                      handleDeleteCalculator(menuVisible).then(() => setMenuVisible(null));
                    }
                  }}
                  className="flex-row items-center p-3 rounded-xl"
                >
                  <Feather name="trash-2" size={18} color="#FF5630" />
                  <Text className="ml-3 text-sm font-semibold text-[#FF5630]">Delete</Text>
                </TouchableOpacity>
              )}

              <View className="h-[1px] bg-border/50 my-1" />

              <TouchableOpacity
                onPress={() => setMenuVisible(null)}
                className="flex-row items-center p-3 rounded-xl"
              >
                <Feather name="x" size={18} color="#919EAB" />
                <Text className="ml-3 text-sm font-semibold text-[#919EAB]">Cancel</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Modal>
      )}
      <LoadingOverlay visible={loading} message={loadingMessage} />

      <AddEditJobModal
        visible={showAddJobModal}
        onClose={() => setShowAddJobModal(false)}
        onSuccess={() => {
          setShowAddJobModal(false);
          fetchTrackerJobs(); // Refresh the list
        }}
        job={prefilledJob as any}
        isLowesLead={isLowesLead}
      />
    </ModalContainer>
  );
}
