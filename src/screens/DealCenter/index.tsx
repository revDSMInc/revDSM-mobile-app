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
import { AddEditJobModal } from '../../screens/JobTracker/components/AddEditJobModal';
import { format } from 'date-fns';

import { useDealCalculator } from '../../hooks/useDealCalculator';
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
  additional: { extraLabor: 0 },
  scheduleTime: null,
};

export default function LFCalculator({ route }: any) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const lead = route.params?.lead;
  const onRefresh = route.params?.onRefresh;
  const onClose = () => navigation.goBack();

  const [currentView, setCurrentView] = useState<
    'form' | 'summary' | 'picker' | 'result' | 'outcome'
  >('form');
  const [prevView, setPrevView] = useState<'form' | 'summary'>('form');
  const [showTrackerModal, setShowTrackerModal] = useState(false);
  const [showAddJobModal, setShowAddJobModal] = useState(false);
  const [showJobBuilder, setShowJobBuilder] = useState(false);
  const [menuVisible, setMenuVisible] = useState<number | null>(null);
  const [trackerJobs, setTrackerJobs] = useState<any[]>([]);

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
  } = useDealCalculator(lead);

  const {
    outcomeStatus,
    setOutcomeStatus,
    outcomeForm,
    setOutcomeForm,
    handleStatusSelect: handleStatusSelectHook,
    handleFinishOutcome: handleFinishOutcomeHook,
    loading: outcomeLoading,
    setLoading: setOutcomeLoading,
    loadingMessage,
    jobState,
    setJobState,
  } = useDealOutcome(lead, active, results, appointmentId, onRefresh, onClose);

  const fetchTrackerJobs = useCallback(async () => {
    try {
      const jobs = await JobService.getJobs();
      setTrackerJobs(jobs);
    } catch (e) {}
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
    if (isAlreadyInTracker) {
      navigation.navigate('JobTracker');
    } else if (results.items.length > 0) {
      setShowAddJobModal(true);
    } else {
      navigation.navigate('JobTracker');
    }
  };

  const prefilledJob = useMemo(() => {
    if (!lead || !active) return null;

    const customerName = lead.customerDetails
      ? `${lead.customerDetails.firstName} ${lead.customerDetails.lastName}`
      : lead.title || '';

    // Map calculator payment plan to JobTracker payment method
    const paymentMethod = active.inputs?.paymentPlan || 'check';

    return {
      customerName,
      salesPrice: results.total || 0,
      paymentMethod,
      soldDate: format(new Date(), 'yyyy-MM-dd'),
      appointmentId: appointmentId || undefined,
      calculatorId: active._id || undefined,
      isManual: false,
    };
  }, [lead, active, results.total, appointmentId]);

  const handleFinishOutcome = () => {
    handleFinishOutcomeHook((showJB: boolean) => {
      if (showJB) {
        navigation.navigate('JobBuilder', {
          initialJobState: jobState,
          calculatorData: active,
          leadId: lead?._id || lead?.leadId || lead?.id,
          outcomeForm: outcomeForm,
          onGoBack: (updatedJobState: any) => {
            setJobState(updatedJobState);
          },
        });
        setCurrentView('summary');
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
    soffit: true,
    fascia: true,
    additional: true,
  });

  const loading = calcLoading || outcomeLoading;

  const openPicker = () => {
    setPrevView(currentView as 'form' | 'summary');
    setCurrentView('picker');
  };

  const refreshCalculators = () => {
    fetchCalculators();
    fetchTrackerJobs();
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

  if (!lead) return null;

  const handleResetOutcome = async () => {
    try {
      setLoading(true);
      if (!lead?._id) return;
      const res = await LeadService.getLeadOutcome(lead._id);
      const data = res.data?.data || res.data;
      if (data) {
        setOutcomeStatus(data.status);
        setOutcomeForm({
          ...outcomeForm,
          ...data.leadData,
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

      {currentView === 'form' && (
        <>
          <CalculatorForm
            inputs={inputs}
            extras={extras}
            expanded={expanded}
            onToggle={(id: string) => setExpanded({ ...expanded, [id]: !expanded[id] })}
            onUpdate={updateActive}
            results={results}
            onClose={onClose}
            handleAddJobToTracker={handleAddJobToTracker}
            isAlreadyInTracker={isAlreadyInTracker}
            refresh={refreshCalculators}
            active={active}
            lead={lead}
            isDark={isDark}
            colors={colors}
            isAutoSaving={isAutoSaving}
            lastUpdatedAt={lastUpdatedAt}
          />
          <View
            className="px-5 py-4 border-t border-border bg-card"
            style={{ paddingBottom: insets.bottom + 10 }}
          >
            <View className="flex-row items-center justify-between">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1 mr-4">
                <View className="flex-row items-center gap-2">
                  {calculators.map((calc, idx) => {
                    const isWarning = calc.name?.startsWith('⚠️') && calc.name?.endsWith('⚠️');
                    const isActive = idx === activeIdx;

                    return (
                      <TouchableOpacity
                        key={idx}
                        onPress={() => setActiveIdx(idx)}
                        className={`px-4 h-10 rounded-xl border flex-row items-center ${
                          isActive
                            ? isWarning
                              ? 'bg-amber-500 border-amber-500'
                              : 'bg-green-500 border-green-500'
                            : 'bg-surface border-border'
                        }`}
                      >
                        <Text
                          className={`text-[10px] font-black  ${
                            isActive ? 'text-white' : 'text-text-secondary'
                          }`}
                        >
                          {calc.name === '.' ? '' : calc.name || `Rollout ${idx + 1}`}
                        </Text>
                        <TouchableOpacity onPress={() => setMenuVisible(idx)} className="ml-2">
                          <Ionicons
                            name="ellipsis-vertical"
                            size={14}
                            color={idx === activeIdx ? 'white' : '#637381'}
                          />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>

              <View className="flex-row items-center gap-2">
                <TouchableOpacity
                  onPress={handleAddNewCalculator}
                  className="w-10 h-10 bg-surface rounded-xl items-center justify-center border border-border"
                >
                  <Ionicons name="add" size={22} color={colors.text} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setCurrentView('summary')}
                  className="w-10 h-10 bg-[#2169f3] rounded-xl items-center justify-center shadow-lg shadow-slate-900/20"
                >
                  <Ionicons name="grid" size={18} color="white" />
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
          isAlreadyInTracker={isAlreadyInTracker}
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
        loading={loading}
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
                      className={`p-5 border-2 rounded-3xl flex-row items-center justify-between ${
                        inputs.paymentPlan === key
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-surface'
                      }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-black ${
                            inputs.paymentPlan === key ? 'text-green-500' : 'text-text-primary'
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
                      className={`p-5 border-2 rounded-3xl flex-row items-center justify-between ${
                        inputs.paymentPlan === key
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-surface'
                      }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-black ${
                            inputs.paymentPlan === key ? 'text-green-500' : 'text-text-primary'
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
                      className={`p-5 border-2 rounded-3xl flex-row items-center justify-between ${
                        inputs.paymentPlan === key
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-surface'
                      }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-black ${
                            inputs.paymentPlan === key ? 'text-green-500' : 'text-text-primary'
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
                      className={`p-5 border-2 rounded-3xl flex-row items-center justify-between ${
                        inputs.paymentPlan === key
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-surface'
                      }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-black ${
                            inputs.paymentPlan === key ? 'text-green-500' : 'text-text-primary'
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
                      className={`p-5 border-2 rounded-3xl flex-row items-center justify-between ${
                        inputs.paymentPlan === key
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border bg-surface'
                      }`}
                    >
                      <View className="flex-1">
                        <Text
                          className={`text-sm font-black ${
                            inputs.paymentPlan === key ? 'text-green-500' : 'text-text-primary'
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

      {showTrackerModal && (
        <View className="absolute inset-0 bg-black/60 z-[100] items-center justify-center p-6">
          <View className="bg-card w-full rounded-[40px] p-8">
            <View className="w-16 h-16 rounded-2xl bg-green-50 items-center justify-center mb-6">
              <Ionicons name="checkmark-circle" size={32} color="#4CBB17" />
            </View>
            <Text className="text-2xl font-black text-text-primary leading-tight">
              Added to Job Tracker
            </Text>
            <Text className="text-sm font-medium text-text-secondary mt-3 leading-relaxed">
              This rollout has been saved and is now visible in the job tracker for operational
              review.
            </Text>
            <View className="flex-row gap-3 mt-10">
              <TouchableOpacity
                onPress={() => setShowTrackerModal(false)}
                className="flex-1 h-16 bg-surface rounded-3xl items-center justify-center"
              >
                <Text className="text-text-secondary font-black  text-xs">Dismiss</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowTrackerModal(false)}
                className="flex-[1.5] h-16 bg-[#4CBB17] rounded-3xl items-center justify-center shadow-lg shadow-green-600/30"
              >
                <Text className="text-white font-black  text-xs">View Tracker</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}

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
          setShowTrackerModal(true);
        }}
        job={prefilledJob as any}
      />
    </ModalContainer>
  );
}
