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
    <View className="absolute bottom-8 left-0 right-0 flex-row justify-center gap-3 px-4">
      <TouchableOpacity onPress={onCancel} className="px-5 py-3 rounded-lg bg-[#FF5630]">
        <Text className="text-white font-bold">Cancel</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onUndo}
        disabled={pointCount === 0}
        className="px-5 py-3 rounded-lg bg-[#FFAB00]"
        style={{ opacity: pointCount === 0 ? 0.5 : 1 }}
      >
        <Text className="text-white font-bold">Undo</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={onSave}
        disabled={!canSave}
        className="px-5 py-3 rounded-lg bg-[#36B37E]"
        style={{ opacity: canSave ? 1 : 0.5 }}
      >
        <Text className="text-white font-bold">Save Zone</Text>
      </TouchableOpacity>
    </View>
  );
}
