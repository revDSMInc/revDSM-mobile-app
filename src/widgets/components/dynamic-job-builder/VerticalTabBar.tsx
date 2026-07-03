import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface VerticalTabBarVertical {
  id: string;
  title?: string;
  name?: string;
  label?: string;
  icon?: string;
  color?: string;
}

interface VerticalTabBarProps {
  verticals?: VerticalTabBarVertical[];
  selectedVerticalId?: string;
  activeId?: string;
  onVerticalChange?: (id: string) => void;
  onChange?: (id: string) => void;
  jobState?: any;
  lockedTabIds?: string[];
}

export function VerticalTabBar({
  verticals = [],
  selectedVerticalId,
  activeId,
  onVerticalChange,
  onChange,
  jobState,
  lockedTabIds = [],
}: VerticalTabBarProps) {
  const activeIdResolved = selectedVerticalId || activeId;
  const handleChange = onVerticalChange || onChange;

  return (
    <View className="flex-row overflow-hidden gap-3 px-4 py-2.5">
      {verticals.map((v) => {
        const active = v.id === activeIdResolved;
        const isLocked = lockedTabIds.includes(v.id);
        const label = v.label || v.title || v.name || v.id;

        return (
          <TouchableOpacity
            key={v.id}
            onPress={() => !isLocked && handleChange?.(v.id)}
            disabled={isLocked}
            className="shrink-0 py-2 px-3.5 rounded-full"
            style={{
              backgroundColor: active ? (v.color || '#22c55e') : isLocked ? '#ccc' : '#e5e5ea',
            }}
          >
            <Text
              className="text-[11px] whitespace-nowrap"
              style={{ color: active ? '#fff' : '#666', fontWeight: active ? '700' : '400' }}
            >
              {isLocked ? '🔒 ' : ''}{v.icon ? `${v.icon} ` : ''}{label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
