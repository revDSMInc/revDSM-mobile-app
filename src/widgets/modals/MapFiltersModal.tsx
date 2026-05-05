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
  const sortOptions = [
    { label: 'Price Ascending', value: 'price-asc' },
    { label: 'Price Descending', value: 'price-desc' },
    { label: 'Date Ascending', value: 'date-asc' },
    { label: 'Date Descending', value: 'date-desc' },
  ];

  const handleApply = () => {
    onApply(localFilters);
    onClose();
  };

  const handleReset = () => {
    onReset();
    onClose();
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View className="flex-1 bg-black/50 justify-end">
        <View className="bg-white dark:bg-zinc-900 rounded-t-[40px] p-6 h-[85%]">
          <View className="flex-row justify-between items-center mb-6">
            <Text className="text-2xl font-black dark:text-white">Filters</Text>
            <TouchableOpacity
              onPress={onClose}
              className="bg-slate-100 dark:bg-zinc-800 p-2 rounded-full"
            >
              <Icon name="close" size={24} color={isDark ? 'white' : 'black'} />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            {/* Search by Job Number */}
            <Text className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">
              Search
            </Text>
            <View className="bg-slate-50 dark:bg-zinc-800 rounded-2xl p-4 mb-6 border border-slate-100 dark:border-zinc-700 flex-row items-center">
              <Icon name="magnify" size={20} color="#94a3b8" />
              <TextInput
                className="flex-1 ml-3 dark:text-white font-medium"
                placeholder="Job Number (e.g. TAM123)"
                placeholderTextColor="#94a3b8"
                value={localFilters.jobNumber}
                onChangeText={(text) => setLocalFilters({ ...localFilters, jobNumber: text })}
              />
            </View>

            {/* Sorting */}
            <Text className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">
              Sort By
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-6">
              {sortOptions.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setLocalFilters({ ...localFilters, sortOrder: opt.value })}
                  className={`px-4 py-2 rounded-full border ${
                    localFilters.sortOrder === opt.value
                      ? 'bg-green-600 border-green-600'
                      : 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800'
                  }`}
                >
                  <Text
                    className={`font-bold ${
                      localFilters.sortOrder === opt.value
                        ? 'text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Radius */}
            <Text className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">
              Distance (Miles)
            </Text>
            <View className="flex-row justify-between mb-6">
              {radiusOptions.map((r) => (
                <TouchableOpacity
                  key={r}
                  onPress={() => setLocalFilters({ ...localFilters, radius: r })}
                  className={`w-12 h-12 rounded-full items-center justify-center border ${
                    localFilters.radius === r
                      ? 'bg-green-600 border-green-600'
                      : 'border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800'
                  }`}
                >
                  <Text
                    className={`font-bold ${
                      localFilters.radius === r
                        ? 'text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {r}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Price Range */}
            <Text className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">
              Price Range
            </Text>
            <View className="flex-row gap-4 mb-6">
              <View className="flex-1 bg-slate-50 dark:bg-zinc-800 rounded-2xl p-4 border border-slate-100 dark:border-zinc-700">
                <Text className="text-[10px] text-slate-400 font-bold mb-1">MIN PRICE</Text>
                <TextInput
                  keyboardType="numeric"
                  className="dark:text-white font-bold p-0"
                  value={localFilters.minPrice}
                  onChangeText={(text) => setLocalFilters({ ...localFilters, minPrice: text })}
                  placeholder="$0"
                />
              </View>
              <View className="flex-1 bg-slate-50 dark:bg-zinc-800 rounded-2xl p-4 border border-slate-100 dark:border-zinc-700">
                <Text className="text-[10px] text-slate-400 font-bold mb-1">MAX PRICE</Text>
                <TextInput
                  keyboardType="numeric"
                  className="dark:text-white font-bold p-0"
                  value={localFilters.maxPrice}
                  onChangeText={(text) => setLocalFilters({ ...localFilters, maxPrice: text })}
                  placeholder="$No Limit"
                />
              </View>
            </View>

            {/* Date Range */}
            <Text className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-3">
              Date Range
            </Text>
            <View className="flex-row gap-4 mb-6">
              <TouchableOpacity
                onPress={() => setShowStartDate(true)}
                className="flex-1 bg-slate-50 dark:bg-zinc-800 rounded-2xl p-4 border border-slate-100 dark:border-zinc-700"
              >
                <Text className="text-[10px] text-slate-400 font-bold mb-1">START DATE</Text>
                <Text className="dark:text-white font-bold">
                  {localFilters.startDate
                    ? new Date(localFilters.startDate).toLocaleDateString()
                    : 'Select'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowEndDate(true)}
                className="flex-1 bg-slate-50 dark:bg-zinc-800 rounded-2xl p-4 border border-slate-100 dark:border-zinc-700"
              >
                <Text className="text-[10px] text-slate-400 font-bold mb-1">END DATE</Text>
                <Text className="dark:text-white font-bold">
                  {localFilters.endDate
                    ? new Date(localFilters.endDate).toLocaleDateString()
                    : 'Select'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Toggles */}
            <View className="bg-slate-50 dark:bg-zinc-800 rounded-[32px] p-6 mb-10 gap-6">
              <TouchableOpacity
                onPress={() =>
                  setLocalFilters({ ...localFilters, myJobsOnly: !localFilters.myJobsOnly })
                }
                className="flex-row justify-between items-center"
              >
                <View className="flex-row items-center">
                  <View
                    className={`w-10 h-10 rounded-xl items-center justify-center ${
                      localFilters.myJobsOnly ? 'bg-blue-100' : 'bg-slate-200'
                    }`}
                  >
                    <Icon
                      name="account-check"
                      size={20}
                      color={localFilters.myJobsOnly ? '#3b82f6' : '#64748b'}
                    />
                  </View>
                  <Text className="ml-3 font-bold dark:text-white">My Jobs Only</Text>
                </View>
                <View
                  className={`w-12 h-6 rounded-full px-1 justify-center ${
                    localFilters.myJobsOnly ? 'bg-green-500' : 'bg-slate-300'
                  }`}
                >
                  <View
                    className={`w-4 h-4 rounded-full bg-white ${
                      localFilters.myJobsOnly ? 'self-end' : 'self-start'
                    }`}
                  />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() =>
                  setLocalFilters({ ...localFilters, isHeatMap: !localFilters.isHeatMap })
                }
                className="flex-row justify-between items-center"
              >
                <View className="flex-row items-center">
                  <View
                    className={`w-10 h-10 rounded-xl items-center justify-center ${
                      localFilters.isHeatMap ? 'bg-orange-100' : 'bg-slate-200'
                    }`}
                  >
                    <Icon
                      name="fire"
                      size={20}
                      color={localFilters.isHeatMap ? '#f97316' : '#64748b'}
                    />
                  </View>
                  <Text className="ml-3 font-bold dark:text-white">Heatmap View</Text>
                </View>
                <View
                  className={`w-12 h-6 rounded-full px-1 justify-center ${
                    localFilters.isHeatMap ? 'bg-green-500' : 'bg-slate-300'
                  }`}
                >
                  <View
                    className={`w-4 h-4 rounded-full bg-white ${
                      localFilters.isHeatMap ? 'self-end' : 'self-start'
                    }`}
                  />
                </View>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View className="flex-row gap-4 mt-4">
            <TouchableOpacity
              onPress={handleReset}
              className="flex-1 h-16 rounded-2xl items-center justify-center border border-slate-200 dark:border-zinc-700"
            >
              <Text className="font-bold text-slate-600 dark:text-slate-300">Reset</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleApply}
              className="flex-[2] h-16 bg-green-600 rounded-2xl items-center justify-center shadow-lg shadow-green-200"
            >
              <Text className="text-white font-black text-lg">Apply Filters</Text>
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
      {showEndDate && (
        <DateTimePicker
          value={localFilters.endDate ? new Date(localFilters.endDate) : new Date()}
          mode="date"
          display="default"
          onChange={(event, date) => {
            setShowEndDate(false);
            if (date) setLocalFilters({ ...localFilters, endDate: date.toISOString() });
          }}
        />
      )}
    </Modal>
  );
};
