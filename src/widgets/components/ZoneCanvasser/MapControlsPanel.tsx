import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

type Props = {
  mapType: 'standard' | 'satellite';
  onClose: () => void;
  onLocate: () => void;
  onToggleMapType: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
};

export function MapControlsPanel({
  mapType,
  onClose,
  onLocate,
  onToggleMapType,
  onZoomIn,
  onZoomOut,
}: Props) {
  return (
    <View className="absolute bottom-6 right-4 items-end gap-3">
      <TouchableOpacity
        onPress={onLocate}
        className="w-11 h-11 rounded-full bg-[#4CBB17] items-center justify-center shadow-md"
      >
        <MaterialCommunityIcons name="crosshairs-gps" size={22} color="#FFFFFF" />
      </TouchableOpacity>

      <View className="bg-white rounded-xl overflow-hidden shadow-md">
        <TouchableOpacity onPress={onToggleMapType} className="w-11 h-11 items-center justify-center border-b border-slate-100">
          <MaterialCommunityIcons
            name={mapType === 'satellite' ? 'map' : 'satellite-variant'}
            size={18}
            color="#444444"
          />
        </TouchableOpacity>
        <TouchableOpacity onPress={onZoomIn} className="w-11 h-11 items-center justify-center border-b border-slate-100">
          <Ionicons name="add" size={24} color="#475569" />
        </TouchableOpacity>
        <TouchableOpacity onPress={onZoomOut} className="w-11 h-11 items-center justify-center">
          <Ionicons name="remove" size={24} color="#475569" />
        </TouchableOpacity>
      </View>
    </View>
  );
}
