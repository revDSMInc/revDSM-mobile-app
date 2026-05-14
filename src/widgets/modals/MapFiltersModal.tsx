import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, TextInput, Platform, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ENV } from '../../config/env';
import axios from 'axios';

export interface FilterState {
  jobNumber: string;
  sortOrder: string;
  radius: number;
  minPrice: string;
  maxPrice: string;
  startDate: string | null;
  endDate: string | null;
  myJobsOnly: boolean;
  isFavoriteOnly: boolean;
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

const FilterInput = ({ icon, children, isGreen = true }: any) => (
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
  
  // Search State
  const [searchType, setSearchType] = useState<'location' | 'job'>('location');
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [searchText, setSearchText] = useState(filters.jobNumber || '');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showRadiusDropdown, setShowRadiusDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    setLocalFilters(filters);
    setSearchText(filters.jobNumber || '');
  }, [filters, visible]);

  // Debounced search for Places (Only for 'location' type)
  useEffect(() => {
    if (searchType !== 'location' || !searchText || searchText.length < 3) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      fetchPlaces(searchText);
    }, 600);

    return () => clearTimeout(timer);
  }, [searchText, searchType]);

  const fetchPlaces = async (input: string) => {
    try {
      setIsSearching(true);
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
        input
      )}&key=${ENV.GOOGLE_MAPS_API_KEY}&components=country:us`;
      
      const res = await axios.get(url);
      if (res.data?.predictions) {
        setSearchResults(res.data.predictions);
      }
    } catch (error) {
      console.error('[MapFilters] Places API Error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleApply = () => {
    onApply({ ...localFilters, jobNumber: searchText });
    onClose();
  };

  const handleReset = () => {
    setSearchText('');
    setSearchResults([]);
    setSearchType('location');
    onReset();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/40 justify-center px-8">
        <View className="bg-white rounded-[24px] p-5 shadow-2xl relative">
          <TouchableOpacity 
            onPress={onClose} 
            className="absolute right-4 top-4 z-30 p-2"
          >
            <Icon name="close" size={24} color="#64748b" />
          </TouchableOpacity>

          <View className="mt-8">
            {/* Search Input with Type Toggle */}
            <View className="z-50 mb-3">
              <View className="flex-row items-center bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
                {/* Type Toggle Dropdown Trigger */}
                <TouchableOpacity 
                  onPress={() => {
                    setShowTypeDropdown(!showTypeDropdown);
                    setShowRadiusDropdown(false);
                  }}
                  className="w-[85px] h-full bg-[#65C216] items-center justify-center flex-row px-2"
                >
                  <Icon name={searchType === 'location' ? "map-marker" : "pound"} size={18} color="white" />
                  <Text className="text-white font-bold text-[12px] ml-1 uppercase">
                    {searchType === 'location' ? 'Loc' : 'Job#'}
                  </Text>
                  <Icon name={showTypeDropdown ? "chevron-up" : "chevron-down"} size={14} color="white" className="ml-1" />
                </TouchableOpacity>

                <View className="flex-1 px-3 justify-center">
                  <View className="flex-row items-center">
                    <TextInput
                      placeholder={searchType === 'location' ? "Enter a location" : "Enter job number"}
                      placeholderTextColor="#94a3b8"
                      className="flex-1 font-bold text-slate-700 text-[13px] h-full"
                      value={searchText}
                      onChangeText={setSearchText}
                    />
                    {isSearching && <ActivityIndicator size="small" color="#059669" />}
                  </View>
                </View>
              </View>

              {/* Search Type Dropdown Menu */}
              {showTypeDropdown && (
                <View 
                  className="absolute top-[52px] left-0 w-[100px] bg-white rounded-xl shadow-xl border border-slate-100 z-[110]"
                  style={{ elevation: 10 }}
                >
                  <TouchableOpacity 
                    className="p-3 border-b border-slate-50 flex-row items-center"
                    onPress={() => {
                      setSearchType('location');
                      setShowTypeDropdown(false);
                      setSearchResults([]);
                    }}
                  >
                    <Icon name="map-marker" size={16} color="#64748b" />
                    <Text className="ml-2 font-bold text-[12px] text-slate-700">Location</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    className="p-3 flex-row items-center"
                    onPress={() => {
                      setSearchType('job');
                      setShowTypeDropdown(false);
                      setSearchResults([]);
                    }}
                  >
                    <Icon name="pound" size={16} color="#64748b" />
                    <Text className="ml-2 font-bold text-[12px] text-slate-700">Job #</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Places Search Results */}
              {searchType === 'location' && searchResults.length > 0 && (
                <View 
                  className="absolute top-[55px] left-0 right-0 bg-white rounded-xl shadow-xl border border-slate-100 z-[100] overflow-hidden"
                  style={{ elevation: 5, height: 200 }}
                >
                  <ScrollView 
                    nestedScrollEnabled={true}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ flexGrow: 1 }}
                  >
                    {searchResults.map((item, idx) => (
                      <TouchableOpacity
                        key={idx}
                        className="p-4 border-b border-slate-50 flex-row items-center"
                        onPress={() => {
                          setSearchText(item.description);
                          setSearchResults([]);
                        }}
                      >
                        <Icon name="map-marker" size={16} color="#94a3b8" />
                        <Text className="ml-3 text-[13px] text-slate-700 flex-1" numberOfLines={1}>
                          {item.description}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>

            {/* Distance */}
            <View className="z-[60] mb-3">
              <FilterInput icon="radius-outline">
                <TouchableOpacity 
                  onPress={() => {
                    setShowRadiusDropdown(!showRadiusDropdown);
                    setShowTypeDropdown(false);
                  }}
                  className="flex-row items-center justify-between"
                >
                  <Text className={`font-bold text-[13px] ${localFilters.radius ? 'text-slate-700' : 'text-slate-400'}`}>
                    {localFilters.radius ? `${localFilters.radius} ${localFilters.radius === 1 ? 'Mile' : 'Miles'}` : 'Select Distance'}
                  </Text>
                  <Icon name={showRadiusDropdown ? "chevron-up" : "chevron-down"} size={18} color="#94a3b8" />
                </TouchableOpacity>
              </FilterInput>

              {showRadiusDropdown && (
                <View 
                  className="absolute top-[52px] left-[50px] right-0 bg-white rounded-xl shadow-xl border border-slate-100 z-[120]"
                  style={{ 
                    elevation: 10,
                    height: 200, // Explicit height to ensure scrolling
                  }}
                >
                  <ScrollView 
                    nestedScrollEnabled={true}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ flexGrow: 1 }}
                  >
                    <TouchableOpacity 
                      className="p-4 border-b border-slate-50"
                      onPress={() => {
                        setLocalFilters({ ...localFilters, radius: 0 });
                        setShowRadiusDropdown(false);
                      }}
                    >
                      <Text className="font-bold text-[13px] text-slate-400">Select Distance</Text>
                    </TouchableOpacity>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((val) => (
                      <TouchableOpacity 
                        key={val}
                        className="p-4 border-b border-slate-50"
                        onPress={() => {
                          setLocalFilters({ ...localFilters, radius: val });
                          setShowRadiusDropdown(false);
                        }}
                      >
                        <Text className="font-bold text-[13px] text-slate-700">
                          {val} {val === 1 ? 'Mile' : 'Miles'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}

            </View>

            {/* Price Inputs with labels */}
            <View className="flex-row items-center mb-3 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
              <View className="w-[50px] h-full bg-[#65C216] items-center justify-center">
                <Text className="text-white font-black text-[12px]">Min</Text>
              </View>
              <View className="flex-1 px-3 justify-center">
                <TextInput
                  placeholder="Min Price"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                  className="font-bold text-slate-700 text-[13px]"
                  value={localFilters.minPrice}
                  onChangeText={(text) => setLocalFilters({ ...localFilters, minPrice: text })}
                />
              </View>
            </View>

            <View className="flex-row items-center mb-3 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
              <View className="w-[50px] h-full bg-[#65C216] items-center justify-center">
                <Text className="text-white font-black text-[12px]">Max</Text>
              </View>
              <View className="flex-1 px-3 justify-center">
                <TextInput
                  placeholder="Max Price"
                  placeholderTextColor="#94a3b8"
                  keyboardType="numeric"
                  className="font-bold text-slate-700 text-[13px]"
                  value={localFilters.maxPrice}
                  onChangeText={(text) => setLocalFilters({ ...localFilters, maxPrice: text })}
                />
              </View>
            </View>

            {/* Date Range */}
            <View className="flex-row items-center mb-6 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
              <View className="w-[50px] h-full bg-[#65C216] items-center justify-center">
                <Icon name="calendar-month" size={22} color="white" />
              </View>
              <TouchableOpacity
                onPress={() => setShowStartDate(true)}
                className="flex-1 px-3 flex-row items-center justify-between"
              >
                <Text className="font-bold text-slate-400 text-[13px]">
                  {localFilters.startDate
                    ? new Date(localFilters.startDate).toLocaleDateString()
                    : 'Select Date Range'}
                </Text>
                <Icon name="chevron-down" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {/* Toggles Row */}
            <View className="flex-row items-center justify-between mb-8 px-1">
              <View className="flex-row gap-5 items-center">
                <Icon name="format-list-checks" size={24} color="#000" />
                <TouchableOpacity 
                  onPress={() => setLocalFilters({ ...localFilters, myJobsOnly: !localFilters.myJobsOnly })}
                  className={`w-11 h-6 rounded-full px-1 justify-center ${localFilters.myJobsOnly ? 'bg-[#65C216]' : 'bg-slate-300'}`}
                >
                  <View className={`w-4 h-4 bg-white rounded-full ${localFilters.myJobsOnly ? 'self-end' : 'self-start'}`} />
                </TouchableOpacity>

                <Icon name="star" size={24} color="#FFA500" />
                <TouchableOpacity 
                  onPress={() => setLocalFilters({ ...localFilters, isFavoriteOnly: !localFilters.isFavoriteOnly })}
                  className={`w-11 h-6 rounded-full px-1 justify-center ${localFilters.isFavoriteOnly ? 'bg-[#65C216]' : 'bg-slate-300'}`}
                >
                  <View className={`w-4 h-4 bg-white rounded-full ${localFilters.isFavoriteOnly ? 'self-end' : 'self-start'}`} />
                </TouchableOpacity>

                <Icon name="fire" size={24} color="#FF5630" />
                <TouchableOpacity 
                  onPress={() => setLocalFilters({ ...localFilters, isHeatMap: !localFilters.isHeatMap })}
                  className={`w-11 h-6 rounded-full px-1 justify-center ${localFilters.isHeatMap ? 'bg-[#65C216]' : 'bg-slate-300'}`}
                >
                  <View className={`w-4 h-4 bg-white rounded-full ${localFilters.isHeatMap ? 'self-end' : 'self-start'}`} />
                </TouchableOpacity>

              </View>

              <TouchableOpacity
                onPress={handleReset}
                className="w-12 h-10 bg-[#65C216] rounded-xl items-center justify-center"
              >
                <Icon name="refresh" size={24} color="white" />
              </TouchableOpacity>
            </View>

            {/* Search Button */}
            <TouchableOpacity
              onPress={handleApply}
              className="w-full h-14 bg-[#65C216] rounded-2xl flex-row items-center justify-center shadow-xl shadow-green-100"
            >
              <Icon name="magnify" size={26} color="white" />
              <Text className="text-white font-black text-lg ml-2 uppercase">Search</Text>
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

