import React from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { OverlayModal } from './OverlayModal';

type Props = {
  visible: boolean;
  searchText: string;
  onChangeText: (text: string) => void;
  onSearch: () => void;
  onClose: () => void;
};

export function SearchLocationModal({
  visible,
  searchText,
  onChangeText,
  onSearch,
  onClose,
}: Props) {
  return (
    <OverlayModal visible={visible} onRequestClose={onClose}>
      <View className="w-[90%] rounded-xl bg-white p-5 relative">
        <TouchableOpacity onPress={onClose} className="absolute right-4 top-4 z-10">
          <Ionicons name="close" size={24} color="#94A3B8" />
        </TouchableOpacity>

        <View className="flex-row items-center mt-6 gap-2">
          <View className="w-10 h-10 rounded-lg bg-[#4CBB17] items-center justify-center">
            <Ionicons name="location" size={20} color="#FFFFFF" />
          </View>
          <TextInput
            className="flex-1 h-12 border border-slate-200 rounded-lg px-3 text-slate-800"
            placeholder="Enter a location"
            placeholderTextColor="#94A3B8"
            value={searchText}
            onChangeText={onChangeText}
            onSubmitEditing={onSearch}
          />
        </View>

        <TouchableOpacity
          onPress={onSearch}
          className="flex-row items-center justify-center gap-2 mt-4 py-3 rounded-lg bg-slate-800"
        >
          <Ionicons name="search" size={20} color="#FFFFFF" />
          <Text className="text-white font-bold">Search</Text>
        </TouchableOpacity>
      </View>
    </OverlayModal>
  );
}
