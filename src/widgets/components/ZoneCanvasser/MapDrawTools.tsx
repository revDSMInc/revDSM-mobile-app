import React from 'react';
import { View, TouchableOpacity } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';

type Props = {
  isDrawingMode: boolean;
  drawType: 'polygon' | 'rectangle';
  onStartPolygon: () => void;
  onStartRectangle: () => void;
};

export function MapDrawTools({
  isDrawingMode,
  drawType,
  onStartPolygon,
  onStartRectangle,
}: Props) {
  return (
    <View className="absolute right-4 gap-2" style={{ top: isDrawingMode ? 20 : 76 }}>
      <TouchableOpacity
        onPress={onStartPolygon}
        className={`w-11 h-11 rounded-xl items-center justify-center shadow-md ${
          isDrawingMode && drawType === 'polygon' ? 'bg-slate-800' : 'bg-white'
        }`}
      >
        <MaterialCommunityIcons
          name="pentagon"
          size={20}
          color={isDrawingMode && drawType === 'polygon' ? '#FFFFFF' : '#475569'}
        />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onStartRectangle}
        className={`w-11 h-11 rounded-xl items-center justify-center shadow-md ${
          isDrawingMode && drawType === 'rectangle' ? 'bg-slate-800' : 'bg-white'
        }`}
      >
        <MaterialCommunityIcons
          name="rectangle"
          size={20}
          color={isDrawingMode && drawType === 'rectangle' ? '#FFFFFF' : '#475569'}
        />
      </TouchableOpacity>
    </View>
  );
}
