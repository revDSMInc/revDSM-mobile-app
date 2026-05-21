import React from 'react';
import { View, Text, TouchableOpacity, FlatList } from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import { RESULT_OPTIONS } from '../../../utils/zone-canvasser-status';
import { OverlayModal } from './OverlayModal';

type Props = {
  visible: boolean;
  address: string;
  onSelectOption: (value: string) => void;
  onCancel: () => void;
};

export function ResultsModal({ visible, address, onSelectOption, onCancel }: Props) {
  return (
    <OverlayModal visible={visible} onRequestClose={onCancel}>
      <View className="w-[90%] max-w-md rounded-xl overflow-hidden bg-white">
        <View className="flex-row justify-between items-center px-5 pt-5 pb-3">
          <Text className="text-xl font-semibold text-slate-800">Results</Text>
          <TouchableOpacity onPress={onCancel}>
            <MaterialCommunityIcons name="close" size={24} color="#64748b" />
          </TouchableOpacity>
        </View>

        <View className="flex-row items-start px-5 pb-3 gap-2">
          <MaterialCommunityIcons name="map-marker" size={20} color="#95a5a6" />
          <Text className="flex-1 text-sm text-slate-500" numberOfLines={2}>
            {address}
          </Text>
        </View>

        <FlatList
          data={RESULT_OPTIONS}
          keyExtractor={(item) => item.value}
          style={{ maxHeight: 350 }}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              onPress={() => onSelectOption(item.value)}
              className={`flex-row justify-between items-center px-5 py-4 ${
                index < RESULT_OPTIONS.length - 1 ? 'border-b border-slate-200' : ''
              }`}
            >
              <Text className="text-[15px] font-medium text-slate-800">{item.label}</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color="#95a5a6" />
            </TouchableOpacity>
          )}
        />

        <View className="p-5 items-end">
          <TouchableOpacity onPress={onCancel}>
            <Text className="text-[15px] font-semibold text-slate-800">Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </OverlayModal>
  );
}
