import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCalculatorSchema } from '../hooks/useCalculatorSchema';
import { useDynamicCalculators } from '../hooks/useDynamicCalculators';
import { useDynamicCalculatorSchemas } from '../hooks/useDynamicCalculatorSchemas';
import { useDealPricing } from '../hooks/useDealPricing';
import { CalculatorView } from './CalculatorView';
import { RolloutView } from './RolloutView';
import { ResultJobModal } from './ResultJobModal';
import { DynamicJobBuilderScreen } from '../DynamicJobBuilderScreen';
import { buildDealCenterData } from '../utils/build-deal-center-data';

type FlowStep = 'calculator' | 'rollout' | 'result' | 'jobBuilder';

interface DynamicDealCenterScreenProps {
  navigation?: NativeStackNavigationProp<any>;
  route?: { params?: { lead?: any; initialVerticalId?: string } };
}

export default function DynamicDealCenterScreen({ navigation, route }: DynamicDealCenterScreenProps) {
  const lead = route?.params?.lead;
  const [flowStep, setFlowStep] = useState<FlowStep>('calculator');
  const [resultModal, setResultModal] = useState<{ visible: boolean; calculatorId?: string; resultType?: 'sale' | 'demo'; price?: number }>({ visible: false });
  const [calculatorResultData, setCalculatorResultData] = useState<any>(null);

  const { config: jobBuilderConfig } = useDynamicCalculatorSchemas();

  const { schema, configuredSchemas, isLoading: isSchemaLoading } = useCalculatorSchema();
  // Backend-driven payment plans + discount tiers (web parity), static fallback.
  const pricing = useDealPricing(lead);
  // The top scroller lists the configured verticals (products); fall back to the
  // single template schema so the flow still works pre-config / offline.
  // Memoized so its reference is stable across renders (the calculators hook
  // re-derives titles when this changes).
  const verticals = useMemo(
    () => (configuredSchemas.length ? configuredSchemas : [schema]),
    [configuredSchemas, schema]
  );

  // Calculators are persisted to the backend (list/create/save/delete) via this
  // hook; entries auto-save (debounced) on every field change.
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    loading: isCalcLoading,
    isSaving,
    lastUpdated,
    handleEntryChange,
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
  } = useDynamicCalculators(lead, verticals);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];

  // Header shows the LEAD (customer name + lead time), matching the regular
  // DealCenter header (`src/screens/DealCenter/index.tsx`). The active calculator
  // name lives in the bottom tab bar, not the header.
  const cd = lead?.customerDetails || {};
  const customerName = cd.firstName
    ? `${cd.firstName} ${cd.lastName || ''}`.trim()
    : lead?.title || lead?.customerName || 'Lead Center';
  const leadTime = lead?.leadTime || '';

  const handleResultJob = useCallback((calculatorId: string, result: 'sale' | 'demo', price?: number) => {
    setResultModal({ visible: true, calculatorId, resultType: result, price });
  }, []);

  const handleResultConfirm = useCallback((data: any) => {
    setResultModal({ visible: false });
    setCalculatorResultData(data);
    setFlowStep('jobBuilder');
  }, []);

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
          params: { lead, tab: 'job_docs' },
        },
      ],
    });
  }, [navigation, lead]);

  // Build the dealCenterData map using the same algorithm as the web's
  // buildDealCenterSessionData — extracts field-option aliases from the
  // calculator form schemas so that tab.dcField references (which may use
  // a field's legacy name rather than its id) are correctly resolved.
  const consolidatedDealCenterData = useMemo(() => {
    return buildDealCenterData({
      entries: activeTab?.entries || {},
      resultData: calculatorResultData || {},
      schemas: verticals,   // CalculatorSchema[] — same array used by the calculator
      lead: lead || {},
    });
  }, [lead, calculatorResultData, activeTab, verticals]);

  if (flowStep === 'jobBuilder') {
    return (
      <DynamicJobBuilderScreen
        navigation={navigation}
        initialConfig={jobBuilderConfig}
        dealCenterData={consolidatedDealCenterData}
        calculatorResultData={calculatorResultData}
        leadId={lead?._id || lead?.leadId || lead?.id}
        onGoBack={handleJobBuilderBack}
        onJobComplete={handleJobBuilderComplete}
      />
    );
  }

  if (flowStep === 'rollout') {
    // The outcome modal must be mounted alongside the rollout view too — the
    // rollout's "Result Lead" button and the drop modal's "Secure This Price"
    // both open it (otherwise the visibility state toggles with nothing to show).
    return (
      <>
        <RolloutView
          calculators={tabs}
          verticals={verticals}
          pricing={pricing}
          isLowesLead={lead?.lowesLead === true}
          onBack={() => setFlowStep('calculator')}
          onConfirmRollouts={handleConfirmRollouts}
          onResultJob={handleResultJob}
          onPaymentMethodChange={handleSetPaymentMethod}
          onDropChange={handleSetDrops}
          onDiscountChange={handleSetDiscount}
          onDownPaymentChange={handleSetDownPayment}
        />
        <ResultJobModal
          visible={resultModal.visible}
          calculatorTitle={tabs.find((t) => t.id === resultModal.calculatorId)?.title}
          resultType={resultModal.resultType}
          initialPrice={resultModal.price}
          entries={tabs.find((t) => t.id === resultModal.calculatorId)?.entries || {}}
          isLowesLead={lead?.lowesLead === true}
          pricing={pricing}
          onClose={() => setResultModal({ visible: false })}
          onConfirm={handleResultConfirm}
        />
      </>
    );
  }

  const isLoading = isSchemaLoading || isCalcLoading;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }} edges={['bottom']}>
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
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#4CBB17" />
          <Text style={{ marginTop: 12, fontSize: 13, color: '#94A3B8' }}>Loading calculator…</Text>
        </View>
      ) : (
        <CalculatorView
          verticals={verticals}
          entries={activeTab?.entries || {}}
          onEntryChange={handleEntryChange}
          totals={activeTab?.totals || { cost: 0, par: 0, retail: 0 }}
          readOnly={activeTab?.isRolloutConfirmed || false}
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
          onViewAll={() => setFlowStep('rollout')}
        />
      )}

      <ResultJobModal
        visible={resultModal.visible}
        calculatorTitle={tabs.find((t) => t.id === resultModal.calculatorId)?.title}
        resultType={resultModal.resultType}
        initialPrice={resultModal.price}
        entries={tabs.find((t) => t.id === resultModal.calculatorId)?.entries || {}}
        isLowesLead={lead?.lowesLead === true}
        pricing={pricing}
        onClose={() => setResultModal({ visible: false })}
        onConfirm={handleResultConfirm}
      />
    </SafeAreaView>
  );
}
