import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, TextInput, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import DateTimePicker from '@react-native-community/datetimepicker';

export interface FilterState {
  jobNumber: string;
  sortOrder: string;
  radius: number;
  minPrice: string;
  maxPrice: string;
  startDate: string | null;
  endDate: string | null;
  myJobsOnly: boolean;
  isHeatMap: boolean;
  showRoute: boolean;
}

interface MapFiltersModalProps {
  visible: boolean;
  onClose: () => void;
  filters: FilterState;
  onApply: (newFilters: FilterState) => void;
  onReset: () => void;
}

export const MapFiltersModal = ({
  visible,
  onClose,
  filters,
  onApply,
  onReset,
}: MapFiltersModalProps) => {
  const { colors, isDark } = useTheme();
  const [localFilters, setLocalFilters] = useState(filters);
  const [showStartDate, setShowStartDate] = useState(false);
  const [showEndDate, setShowEndDate] = useState(false);

  const radiusOptions = [5, 10, 25, 50, 100];

  const handleApply = () => {
    onApply(localFilters);
    onClose();
  };

  const handleReset = () => {
    onReset();
    onClose();
  };

  const FilterInput = ({ icon, label, children, isGreen = true }: any) => (
    <View className="flex-row items-center mb-3 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
      <View
        className={`w-[50px] h-full ${
          isGreen ? 'bg-green-600' : 'bg-slate-100'
        } items-center justify-center`}
      >
        <Icon name={icon} size={20} color={isGreen ? 'white' : '#64748b'} />
      </View>
      <View className="flex-1 px-3 justify-center">{children}</View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/40 justify-center px-8">
        <View className="bg-white rounded-[24px] p-5 shadow-2xl relative">
          <TouchableOpacity onPress={onClose} className="absolute right-4 top-4 z-10 p-1">
            <Icon name="close" size={20} color="#64748b" />
          </TouchableOpacity>

          <View className="mt-6">
            {/* Job Number / Location */}
            <FilterInput icon="map-marker-outline">
              <TextInput
                placeholder="Enter a location or Job#"
                placeholderTextColor="#94a3b8"
                className="font-bold text-slate-700 text-[13px]"
                value={localFilters.jobNumber}
                onChangeText={(text) => setLocalFilters({ ...localFilters, jobNumber: text })}
              />
            </FilterInput>

            {/* Distance */}
            <FilterInput icon="radius-outline">
              <View className="flex-row items-center justify-between">
                <Text className="font-bold text-slate-400 text-[13px]">Select Distance</Text>
                <Icon name="chevron-down" size={18} color="#94a3b8" />
              </View>
            </FilterInput>

            {/* Min Price */}
            <FilterInput icon="minus-circle-outline">
              <TextInput
                placeholder="Min Price"
                placeholderTextColor="#94a3b8"
                keyboardType="numeric"
                className="font-bold text-slate-700 text-[13px]"
                value={localFilters.minPrice}
                onChangeText={(text) => setLocalFilters({ ...localFilters, minPrice: text })}
              />
            </FilterInput>

            {/* Max Price */}
            <FilterInput icon="plus-circle-outline">
              <TextInput
                placeholder="Max Price"
                placeholderTextColor="#94a3b8"
                keyboardType="numeric"
                className="font-bold text-slate-700 text-[13px]"
                value={localFilters.maxPrice}
                onChangeText={(text) => setLocalFilters({ ...localFilters, maxPrice: text })}
              />
            </FilterInput>

            {/* Date Range */}
            <FilterInput icon="calendar-range-outline">
              <TouchableOpacity
                onPress={() => setShowStartDate(true)}
                className="flex-row items-center justify-between"
              >
                <Text className="font-bold text-slate-400 text-[13px]">
                  {localFilters.startDate
                    ? new Date(localFilters.startDate).toLocaleDateString()
                    : 'Select Date Range'}
                </Text>
                <Icon name="chevron-down" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </FilterInput>

            {/* Bottom Controls Row */}
            <View className="flex-row items-center justify-between mb-5 px-1">
              <View className="flex-row gap-3 items-center">
                <TouchableOpacity className="p-1">
                  <Icon name="format-list-checks" size={24} color="#64748b" />
                </TouchableOpacity>

                <View className="w-8 h-5 bg-green-500 rounded-full px-1 justify-center">
                  <View className="w-3.5 h-3.5 bg-white rounded-full self-end" />
                </View>

                <TouchableOpacity className="p-1 ml-1">
                  <Icon name="star" size={22} color="#f59e0b" />
                </TouchableOpacity>

                <View className="w-8 h-5 bg-slate-200 rounded-full px-1 justify-center">
                  <View className="w-3.5 h-3.5 bg-white rounded-full" />
                </View>
              </View>

              <TouchableOpacity
                onPress={onReset}
                className="w-14 h-10 bg-green-600 rounded-lg items-center justify-center shadow-md"
              >
                <Icon name="refresh" size={20} color="white" />
              </TouchableOpacity>
            </View>

            {/* Search Button */}
            <TouchableOpacity
              onPress={handleApply}
              className="w-full h-12 bg-green-600 rounded-xl flex-row items-center justify-center shadow-lg shadow-green-200"
            >
              <Icon name="magnify" size={20} color="white" />
              <Text className="text-white font-black text-base ml-2">Search</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {showStartDate && (
        <DateTimePicker
          value={localFilters.startDate ? new Date(localFilters.startDate) : new Date()}
          mode="date"
          display="default"
          onChange={(event, date) => {
            setShowStartDate(false);
            if (date) setLocalFilters({ ...localFilters, startDate: date.toISOString() });
          }}
        />
      )}
    </Modal>
  );
};
