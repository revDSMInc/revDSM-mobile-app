import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';

interface Tab {
  id: string;
  name?: string;
  label?: string;
  title?: string;
  active?: boolean;
  locked?: boolean;
  complete?: boolean;
}

interface DynamicCalculatorTabsProps {
  tabs?: Tab[];
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;
}

export function DynamicCalculatorTabs({ tabs = [], activeTabId, onTabChange }: DynamicCalculatorTabsProps) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="px-3 py-2">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <TouchableOpacity
            key={tab.id}
            onPress={() => !tab.locked && onTabChange?.(tab.id)}
            className={`mr-2 px-4 py-2.5 rounded-xl ${isActive ? 'bg-blue-500' : 'bg-gray-50 border border-gray-200'}`}
            disabled={tab.locked}
          >
            <Text
              className={`text-xs font-semibold ${isActive ? 'text-white' : tab.locked ? 'text-gray-400' : 'text-gray-700'}`}
            >
              {tab.locked ? '🔒 ' : ''}{tab.name || tab.label || tab.title || tab.id}{tab.complete ? ' ✓' : ''}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}
