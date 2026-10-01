import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const GREEN = '#2EDE56';

export type RenderMode = 'core' | 'lighting';

/**
 * Core Products | Roofline Lighting, sitting directly under the photo.
 *
 * Core is the default and its screen below stays pixel-identical to production
 * (483 §1) — switching swaps only the configuration area, never the photo,
 * header or bottom action bar.
 */
export function ModeSwitch({
  mode,
  onChange,
  isDark,
}: {
  mode: RenderMode;
  onChange: (mode: RenderMode) => void;
  isDark: boolean;
}) {
  const Option = ({ value, label, icon }: { value: RenderMode; label: string; icon: string }) => {
    const active = mode === value;
    return (
      <TouchableOpacity
        onPress={() => onChange(value)}
        activeOpacity={0.85}
        accessibilityRole="tab"
        accessibilityState={{ selected: active }}
        className="flex-1 flex-row items-center justify-center rounded-full"
        style={{ minHeight: 44, backgroundColor: active ? GREEN : 'transparent' }}
      >
        <Icon
          name={icon}
          size={16}
          color={active ? '#fff' : isDark ? '#919EAB' : '#637381'}
          style={{ marginRight: 6 }}
        />
        <Text
          className="text-[13px] font-black"
          style={{ color: active ? '#fff' : isDark ? '#919EAB' : '#637381' }}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View
      className="flex-row rounded-full p-1 mb-4"
      style={{ backgroundColor: isDark ? '#1E1E1E' : '#F4F6F8' }}
      accessibilityRole="tablist"
    >
      <Option value="core" label="Core Products" icon="home-outline" />
      <Option value="lighting" label="Roofline Lighting" icon="lightning-bolt" />
    </View>
  );
}
