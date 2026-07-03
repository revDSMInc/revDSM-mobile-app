import React, { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { createDefaultJobBuilderConfig } from '../../utils/dynamic-job-builder/constants/default-config';
import { DynamicTabRenderer } from '../../widgets/components/dynamic-job-builder/DynamicTabRenderer';

interface DynamicJobBuilderScreenProps {
  navigation?: NativeStackNavigationProp<any>;
  initialConfig?: any;
  onJobComplete?: (config: any, state: any) => void;
  onGoBack?: () => void;
}

export function DynamicJobBuilderScreen({
  navigation,
  onJobComplete,
  onGoBack,
}: DynamicJobBuilderScreenProps) {
  const config = createDefaultJobBuilderConfig();
  const verticals = config.verticals || [];
  const [selectedVerticalId, setSelectedVerticalId] = useState(verticals[0]?.id || '');
  const [selectedTabId, setSelectedTabId] = useState('');
  const [jobState, setJobState] = useState<any>(() => {
    const state: any = {};
    verticals.forEach((v: any) => {
      state[v.id] = {};
      v.tabs?.forEach((t: any) => {
        state[v.id][t.id] = {};
      });
    });
    return state;
  });

  const selectedVertical = verticals.find((v: any) => v.id === selectedVerticalId) || verticals[0];
  const tabs = selectedVertical?.tabs || [];
  const selectedTab = tabs.find((t: any) => t.id === selectedTabId) || tabs[0];

  const handleTabSelect = useCallback((tabId: string) => {
    setSelectedTabId(tabId);
  }, []);

  const handleVerticalSelect = useCallback((verticalId: string) => {
    setSelectedVerticalId(verticalId);
    setSelectedTabId('');
  }, []);

  const handleFieldChange = useCallback(
    (fieldId: string, value: any) => {
      const vId = selectedVertical?.id;
      const tId = selectedTab?.id;
      if (!vId || !tId) return;
      setJobState((prev: any) => ({
        ...prev,
        [vId]: {
          ...(prev[vId] || {}),
          [tId]: {
            ...(prev[vId]?.[tId] || {}),
            [fieldId]: value,
          },
        },
      }));
    },
    [selectedVertical, selectedTab]
  );

  const handleComplete = useCallback(() => {
    onJobComplete?.(config, jobState);
  }, [config, jobState, onJobComplete]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
        <TouchableOpacity onPress={onGoBack || (() => navigation?.goBack())}>
          <Text style={{ color: '#1976D2', fontSize: 14 }}>← Back</Text>
        </TouchableOpacity>
        <Text style={{ fontSize: 14, fontWeight: 700, flex: 1, textAlign: 'center' }}>Job Builder</Text>
        <View style={{ width: 48 }} />
      </View>

      {verticals.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
          {verticals.map((v: any) => {
            const active = v.id === selectedVerticalId;
            return (
              <TouchableOpacity
                key={v.id}
                onPress={() => handleVerticalSelect(v.id)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 20,
                  marginRight: 8,
                  backgroundColor: active ? (v.color || '#4CAF50') : '#E8F5E9',
                }}
              >
                <Text style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: active ? '#fff' : '#637381' }}>
                  {v.icon} {v.label || v.name || v.id}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
        {tabs.map((tab: any) => {
          const isActive = tab.id === (selectedTabId || tabs[0]?.id);
          return (
            <TouchableOpacity
              key={tab.id}
              onPress={() => handleTabSelect(tab.id)}
              style={{
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 8,
                marginRight: 6,
                backgroundColor: isActive ? '#1976D2' : '#F1F5F9',
                borderWidth: 1,
                borderColor: isActive ? '#1976D2' : '#E2E8F0',
              }}
            >
              <Text style={{ fontSize: 12, fontWeight: isActive ? 700 : 500, color: isActive ? '#fff' : '#637381' }}>
                {tab.label || tab.name || tab.id}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <ScrollView style={{ flex: 1, backgroundColor: '#F8FAFC' }}>
        {selectedTab ? (
          <DynamicTabRenderer
            tab={selectedTab}
            tabState={jobState[selectedVertical?.id]?.[selectedTab.id] || {}}
            onStateChange={(tabState) => {
              const vId = selectedVertical?.id;
              const tId = selectedTab.id;
              if (!vId) return;
              setJobState((prev: any) => ({
                ...prev,
                [vId]: { ...(prev[vId] || {}), [tId]: tabState },
              }));
            }}
          />
        ) : (
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ color: '#94A3B8', fontSize: 14 }}>Select a tab to begin</Text>
          </View>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#E2E8F0', backgroundColor: '#fff' }}>
        <TouchableOpacity
          onPress={handleComplete}
          style={{ backgroundColor: '#4CAF50', paddingVertical: 14, borderRadius: 12 }}
        >
          <Text style={{ color: '#fff', textAlign: 'center', fontWeight: 700, fontSize: 14 }}>Complete Job</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
