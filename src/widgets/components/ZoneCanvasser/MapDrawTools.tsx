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
    // Sits BELOW the top row (back button + address search bar, 44pt at top 20) rather
    // than beside it, so the search bar can take the full width between them. While drawing
    // the search bar is hidden, so the tools rise INTO that row and line up with the back
    // button (same top, same 16pt side margin) instead of floating 56pt below an empty strip.
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
