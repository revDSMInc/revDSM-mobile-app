import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

type Props = {
  drawType: 'polygon' | 'rectangle';
  pointCount: number;
  onCancel: () => void;
  onUndo: () => void;
  onSave: () => void;
};

export function DrawingToolbar({ drawType, pointCount, onCancel, onUndo, onSave }: Props) {
  const canSave = drawType === 'polygon' ? pointCount >= 3 : pointCount >= 4;

  return (
    // ⚠️ Stops short of the right-hand control column (locate / map type / zoom, 44pt wide + its
    // 16pt margin = 60) with `right: 72`, and the three buttons SHARE the width (`flex-1`). It
    // used to be centred full-width, so "Save Zone" sat underneath the zoom buttons. `bottom: 24`
    // is the SAME line the right-hand control column ends on (`bottom-6`), so the two read as
    // one row. (The Mapbox logo/attribution were moved to the top-left in MapCanvas for this.)
    <View
      className="absolute flex-row gap-2"
      style={{ bottom: 24, left: 16, right: 72 }}
    >
      <TouchableOpacity onPress={onCancel} className="flex-1 items-center py-3 rounded-lg bg-[#FF5630]">
        <Text className="text-white font-bold" numberOfLines={1}>Cancel</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onUndo}
        disabled={pointCount === 0}
        className="flex-1 items-center py-3 rounded-lg bg-[#FFAB00]"
        style={{ opacity: pointCount === 0 ? 0.5 : 1 }}
      >
        <Text className="text-white font-bold" numberOfLines={1}>Undo</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onSave}
        disabled={!canSave}
        className="flex-1 items-center py-3 rounded-lg bg-[#36B37E]"
        style={{ opacity: canSave ? 1 : 0.5 }}
      >
        <Text className="text-white font-bold" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>Save Zone</Text>
      </TouchableOpacity>
    </View>
  );
}
