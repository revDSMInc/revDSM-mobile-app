import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useDynamicJobBuilderSession } from './useDynamicJobBuilderSession';
import { DynamicTabRenderer } from '../../widgets/components/dynamic-job-builder/DynamicTabRenderer';
import { ProgressTracker } from '../../widgets/components/dynamic-job-builder/ProgressTracker';
import { VerticalTabBar } from '../../widgets/components/dynamic-job-builder/VerticalTabBar';
import { FlashMessage } from '../../config/message';
import { LeadService } from '../../services/api/leads';
import { logEvent } from '../../services/api/LoggerService';
import { isTabComplete } from '../../utils/dynamic-job-builder/engine/tab-validation';

interface DynamicJobBuilderScreenProps {
  navigation?: NativeStackNavigationProp<any>;
  initialConfig?: any;
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
}

function DynamicJobBuilderInner({
  navigation,
  initialConfig,
  dealCenterData,
  calculatorResultData,
  leadId,
  onJobComplete,
  onGoBack,
}: DynamicJobBuilderScreenProps) {
  const verticalList = useMemo(
    () => initialConfig?.verticals || [],
    [initialConfig]
  );

  const session = useDynamicJobBuilderSession({
    initialConfig,
    dealCenterData,
  });

  const { jobState, updateTabState, lockedTabIdsByVertical } = session;

  const [selectedVerticalId, setSelectedVerticalId] = useState(
    verticalList[0]?.id || ''
  );
  const [selectedTabId, setSelectedTabId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const openedLoggedRef = useRef(false);

  useEffect(() => {
    if (openedLoggedRef.current || !leadId) return;
    openedLoggedRef.current = true;
    logEvent('view', {
      module_type: 'job_builder',
      meta: {
        draft: true,
        leadId,
        action: 'job_builder_opened',
        fieldCategory: 'job_builder',
      },
    });
  }, [leadId]);

  useEffect(() => {
    if (!leadId) return;

    const timer = setTimeout(async () => {
      try {
        const payload = { jobBuilder: jobState };
        await LeadService.updateLeadOutcome(leadId, payload);
      } catch (error) {
        console.warn('[DynamicJobBuilder] Auto-save failed:', error);
      }
    }, 2000);

    return () => clearTimeout(timer);
  }, [leadId, jobState]);

  const selectedVertical = useMemo(
    () => verticalList.find((v: any) => v.id === selectedVerticalId) || verticalList[0],
    [verticalList, selectedVerticalId]
  );

  const currentVerticalLockedTabIds = useMemo(() => {
    return selectedVertical ? lockedTabIdsByVertical[selectedVertical.id] || [] : [];
  }, [selectedVertical, lockedTabIdsByVertical]);

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

  useEffect(() => {
    if (!selectedTabId) {
      if (nonSummaryTabs.length > 0) {
        setSelectedTabId(nonSummaryTabs[0].id);
      } else if (summaryTab) {
        // All product tabs are locked — fall back to the summary tab so the
        // screen isn't blank. This can happen when dealCenterData has no
        // calculator entries yet (e.g. no dcField keys are satisfied).
        setSelectedTabId(summaryTab.id);
      }
    }
  }, [nonSummaryTabs, summaryTab, selectedTabId]);

  const validationCtx = useMemo(() => ({
    dealCenterData: dealCenterData || {},
    applyConditions: true,
    products: initialConfig?.products || [],
  }), [dealCenterData, initialConfig]);

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

  const canProceed = useMemo(() => {
    if (currentTabIndex === nonSummaryTabs.length) {
      return areAllTabsComplete;
    }
    return isCurrentTabComplete;
  }, [currentTabIndex, nonSummaryTabs.length, areAllTabsComplete, isCurrentTabComplete]);

  const handleVerticalSelect = useCallback((verticalId: string) => {
    setSelectedVerticalId(verticalId);
    setSelectedTabId('');
  }, []);

  const handleTabStateChange = useCallback(
    (tabStateOrUpdater: any) => {
      if (!selectedVertical?.id || !currentTab?.id) return;
      const currentTabState = jobState?.[selectedVertical.id]?.[currentTab.id] || {};
      const nextTabState =
        typeof tabStateOrUpdater === 'function'
          ? tabStateOrUpdater(currentTabState)
          : tabStateOrUpdater;
      updateTabState(selectedVertical.id, currentTab.id, nextTabState);
    },
    [selectedVertical, currentTab, updateTabState, jobState]
  );

  const handleGoToTab = useCallback(
    (index: number) => {
      if (index >= 0 && index < allNonSummaryTabs.length) {
        const tab = allNonSummaryTabs[index];
        if (tab && !currentVerticalLockedTabIds.includes(tab.id)) {
          setSelectedTabId(tab.id);
        }
      } else if (index === allNonSummaryTabs.length && summaryTab) {
        setSelectedTabId(summaryTab.id);
      }
    },
    [allNonSummaryTabs, currentVerticalLockedTabIds, summaryTab]
  );

  const handleNext = useCallback(() => {
    if (!canProceed) return;
    const nextIdx = currentTabIndex + 1;
    if (nextIdx < nonSummaryTabs.length) {
      setSelectedTabId(nonSummaryTabs[nextIdx].id);
    } else if (nextIdx === nonSummaryTabs.length && summaryTab) {
      setSelectedTabId(summaryTab.id);
    }
  }, [currentTabIndex, nonSummaryTabs, summaryTab, canProceed]);

  const handleBack = useCallback(() => {
    const prevIdx = currentTabIndex - 1;
    if (prevIdx >= 0) {
      setSelectedTabId(nonSummaryTabs[prevIdx].id);
    }
  }, [currentTabIndex, nonSummaryTabs]);

  const handleComplete = useCallback(async () => {
    if (!areAllTabsComplete) return;
    try {
      setIsSaving(true);

      if (leadId) {
        logEvent('submit', {
          module_type: 'job_builder',
          meta: {
            leadId,
            fieldCategory: 'summary',
            action: 'job_builder_completed',
          },
        });
      }

      const payload = {
        jobBuilder: jobState,
        ...calculatorResultData,
        leadId,
      };

      if (leadId) {
        await LeadService.submitJobBuilder(leadId, payload);
      }

      FlashMessage.success('Job Complete', 'Job builder submitted successfully');

      if (onJobComplete) {
        onJobComplete(initialConfig, jobState);
      }
    } catch (error) {
      console.error('[DynamicJobBuilder] Completion failed:', error);
      Alert.alert('Error', 'Failed to complete the job. Please check your connection.');
    } finally {
      setIsSaving(false);
    }
  }, [jobState, initialConfig, calculatorResultData, leadId, onJobComplete, areAllTabsComplete]);

  const isLastStep = currentTabIndex === nonSummaryTabs.length;
  const isFirstStep = currentTabIndex <= 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flex: 1 }}>
        <View
          style={{
            paddingHorizontal: 16,
            paddingTop: 8,
            paddingBottom: 16,
            borderBottomWidth: 1,
            borderBottomColor: '#E2E8F0',
            backgroundColor: '#fff',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 12,
            }}
          >
            <TouchableOpacity onPress={onGoBack || (() => navigation?.goBack())}>
              <Text style={{ color: '#1976D2', fontSize: 14, fontWeight: '600' }}>← Back</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' }}>
              Job Builder
            </Text>
            <View style={{ width: 48 }} />
          </View>

          {verticalList.length > 1 && (
            <VerticalTabBar
              verticals={verticalList}
              selectedVerticalId={selectedVerticalId}
              onVerticalChange={handleVerticalSelect}
              jobState={jobState}
              lockedTabIds={currentVerticalLockedTabIds}
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

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            style={{ flex: 1, backgroundColor: '#F8FAFC' }}
            showsVerticalScrollIndicator={false}
          >
            {currentTab ? (
              <DynamicTabRenderer
                tab={currentTab}
                vertical={selectedVertical}
                tabState={jobState?.[selectedVertical?.id]?.[currentTab.id] || {}}
                verticalState={jobState?.[selectedVertical?.id] || {}}
                lockedTabIds={currentVerticalLockedTabIds}
                onStateChange={handleTabStateChange}
                dealCenterData={dealCenterData}
                readOnly={false}
                applyConditions={true}
                verticalId={selectedVertical?.id}
                verticalColor={selectedVertical?.color || '#22c55e'}
                products={initialConfig?.products || []}
                schemas={initialConfig?.schemas || []}
              />
            ) : (
              <View style={{ alignItems: 'center', paddingTop: 60 }}>
                <Text style={{ color: '#94A3B8', fontSize: 14 }}>
                  Select a tab to begin
                </Text>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderTopWidth: 1,
            borderTopColor: '#E2E8F0',
            backgroundColor: '#fff',
          }}
        >
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
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  borderRadius: 10,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: '#E2E8F0',
                  backgroundColor: '#fff',
                }}
              >
                <Text style={{ fontWeight: '600', fontSize: 13, color: '#1C252E' }}>
                  Back
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={{ width: 80 }} />
            )}

            {isLastStep && summaryTab ? (
              <TouchableOpacity
                onPress={handleComplete}
                disabled={isSaving || !areAllTabsComplete}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  backgroundColor: isSaving || !areAllTabsComplete ? '#94A3B8' : '#22C55E',
                }}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />
                ) : (
                  <Icon name="check-all" size={18} color="white" style={{ marginRight: 6 }} />
                )}
                <Text
                  style={{
                    fontWeight: '700',
                    fontSize: 13,
                    color: 'white',
                  }}
                >
                  {isSaving ? 'Completing...' : 'Complete Job'}
                </Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={handleNext}
                disabled={!canProceed}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: canProceed ? '#1C252E' : '#CBD5E1',
                }}
              >
                <Text style={{ fontWeight: '600', fontSize: 13, color: 'white' }}>
                  Next
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

export function DynamicJobBuilderScreen(props: DynamicJobBuilderScreenProps) {
  return <DynamicJobBuilderInner {...props} />;
}
