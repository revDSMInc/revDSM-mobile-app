import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { LEGEND_ITEMS } from '../../../utils/zone-canvasser-status';
import { BuildingMapMarker } from './BuildingMapMarker';

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};

export function MapLegend({ open, onOpen, onClose }: Props) {
  const { colors, isDark } = useTheme();

  return (
    <View className="absolute bottom-6 left-4">
      {open ? (
        <>
          <View
            className="rounded-xl p-4 shadow-lg min-w-[200px]"
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
          <TouchableOpacity
            onPress={onClose}
            className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center mt-2 self-start"
          >
            <Ionicons name="close" size={24} color="#FFFFFF" />
          </TouchableOpacity>
        </>
      ) : (
        <TouchableOpacity
          onPress={onOpen}
          className="w-11 h-11 rounded-full bg-white items-center justify-center shadow-md"
        >
          <Ionicons name="color-palette" size={24} color="#475569" />
        </TouchableOpacity>
      )}
    </View>
  );
}
