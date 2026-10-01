import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Look } from '../../../utils/revrender-lighting/types';
import { LightStrip } from './LightStrip';

const GREEN = '#2EDE56';

/**
 * One look in a grid. Selected state must match everywhere the same look
 * appears — Quick picks, its own tab, and the selected box — so it is driven by
 * id from one piece of state rather than held locally.
 */
export function LookTile({
  look,
  selected,
  favourite,
  tag,
  isDark,
  onPress,
  onLongPress,
}: {
  look: Look;
  selected: boolean;
  favourite?: boolean;
  tag?: 'now' | 'next' | null;
  isDark: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      // 483 §3: hold 450ms to favourite. Below the RN default of 500.
      delayLongPress={450}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={look.name}
      accessibilityState={{ selected }}
      // 44pt minimum tap target (483 §11).
      style={{ width: '23%', minHeight: 44, marginBottom: 14 }}
    >
      <View
        className="rounded-[14px] overflow-hidden border-2"
        style={{ borderColor: selected ? GREEN : 'transparent' }}
      >
        <LightStrip colors={look.colors} height={62} radius={12} />
      </View>

      {selected && (
        <View
          className="absolute items-center justify-center rounded-full"
          style={{ top: -6, right: -6, width: 22, height: 22, backgroundColor: GREEN }}
        >
          <Icon name="check" size={14} color="#fff" />
        </View>
      )}

      {favourite && !selected && (
        <View className="absolute" style={{ top: 2, left: 4 }}>
          <Icon name="star" size={13} color="#FFC94D" />
        </View>
      )}

      {tag && (
        <View
          className="absolute rounded-full px-1.5"
          style={{ top: 2, right: 2, backgroundColor: tag === 'now' ? GREEN : '#637381' }}
        >
          <Text className="text-[9px] font-black text-white">{tag === 'now' ? 'NOW' : 'NEXT'}</Text>
        </View>
      )}

      <Text
        numberOfLines={2}
        className="text-[11px] font-bold mt-1.5 text-center"
        style={{ color: selected ? (isDark ? '#fff' : '#212B36') : (isDark ? '#919EAB' : '#637381') }}
      >
        {look.name}
      </Text>
    </TouchableOpacity>
  );
}
