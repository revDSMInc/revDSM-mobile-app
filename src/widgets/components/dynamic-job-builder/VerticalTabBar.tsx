import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

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
  /**
   * VERTICAL ids that are locked because none of their steps are configured for
   * this deal (web `verticalHasUnlockedSteps === false`). A locked vertical shows a
   * padlock, greys out and can't be opened — only the configured Job Builder(s) are
   * navigable in a multi-product deal.
   */
  lockedVerticalIds?: string[];
}

// Product/vertical selector — slate pills, font-black, #22C55E (or vertical color)
// when active, MCIcon lock when locked. Consistent with the normal JB palette.
export function VerticalTabBar({
  verticals = [],
  selectedVerticalId,
  activeId,
  onVerticalChange,
  onChange,
  lockedVerticalIds = [],
}: VerticalTabBarProps) {
  const activeIdResolved = selectedVerticalId || activeId;
  const handleChange = onVerticalChange || onChange;

  if (verticals.length <= 1) return null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row py-2.5">
      <View className="flex-row gap-2">
        {verticals.map((v) => {
          const active = v.id === activeIdResolved;
          const isLocked = lockedVerticalIds.includes(v.id);
          const label = v.label || v.title || v.name || v.id;

          return (
            <TouchableOpacity
              key={v.id}
              onPress={() => !isLocked && handleChange?.(v.id)}
              disabled={isLocked}
              className="shrink-0 py-2 px-4 rounded-full flex-row items-center"
              style={{
                backgroundColor: active ? (v.color || '#22C55E') : '#F1F5F9',
                opacity: isLocked ? 0.5 : 1,
              }}
            >
              {isLocked && <Icon name="lock" size={12} color="#94A3B8" style={{ marginRight: 4 }} />}
              <Text
                className="text-[11px] font-black"
                style={{ color: active ? '#fff' : '#64748B' }}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}
