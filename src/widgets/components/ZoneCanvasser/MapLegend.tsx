import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { LEGEND_ITEMS } from '../../../utils/zone-canvasser-status';
import { BuildingMapMarker } from './BuildingMapMarker';

/**
 * The building-status legend card. Rendered IN FLOW above the bottom-left buttons
 * (see ZoneCanvasserMap), not as an absolute popover off its own button — Android does
 * not deliver touches to a child drawn outside its parent's bounds.
 */
export function MapLegendCard() {
  const { colors, isDark } = useTheme();

  return (
    <View
      className="rounded-xl p-4 shadow-lg min-w-[200px] mb-2 self-start"
      style={{ backgroundColor: isDark ? colors.surface : '#FFFFFF' }}
    >
      <Text className="text-[10px] font-bold tracking-wider mb-3" style={{ color: colors.textSecondary }}>
        BUILDING STATUS
      </Text>
      {LEGEND_ITEMS.map((item) => (
        <View key={item.label} className="flex-row items-center gap-2 mb-2">
          <BuildingMapMarker status={item.status} size="sm" />
          <Text className="text-sm font-medium" style={{ color: colors.text }}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Web palette toggle: white with a palette icon, dark with a close icon while open. */
export function MapLegendToggle({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`w-11 h-11 rounded-full items-center justify-center shadow-md ${
        open ? 'bg-slate-800' : 'bg-white'
      }`}
    >
      <Ionicons name={open ? 'close' : 'color-palette'} size={open ? 24 : 22} color={open ? '#FFFFFF' : '#475569'} />
    </TouchableOpacity>
  );
}
