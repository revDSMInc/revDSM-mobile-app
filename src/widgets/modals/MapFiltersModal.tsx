import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, TextInput, Platform, ActivityIndicator, Keyboard, KeyboardAvoidingView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ENV } from '../../config/env';
import axios from 'axios';
import { CustomDatePicker } from '../../screens/JobTracker/components/CustomDatePicker';
import { useAuth } from '../../hooks/useAuth';
import { logEvent } from '../../services/api/LoggerService';

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
  isReferralOnly: boolean;
  isHeatMap: boolean;
  showRoute: boolean;
  showProduct: boolean;
  centerCoords?: { latitude: number; longitude: number };
}

interface MapFiltersModalProps {
  visible: boolean;
  onClose: () => void;
  filters: FilterState;
  onApply: (newFilters: FilterState) => void;
  onReset: () => void;
}

const FilterInput = ({ icon, children, isGreen = true, primaryColor }: any) => (
  <View className="flex-row items-center mb-3 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
    <View
      className="w-[50px] h-full items-center justify-center"
      style={{ backgroundColor: isGreen ? primaryColor : '#f1f5f9' }}
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
  const { user } = useAuth();
  const [localFilters, setLocalFilters] = useState(filters);
  const [showStartDate, setShowStartDate] = useState(false);
  const [showEndDate, setShowEndDate] = useState(false);

  // Search State
  const [searchType, setSearchType] = useState<'location' | 'job'>('location');
  const [showTypeDropdown, setShowTypeDropdown] = useState(false);
  const [searchText, setSearchText] = useState(filters.jobNumber || '');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showRadiusDropdown, setShowRadiusDropdown] = useState(false);
  const [showDateRangeDropdown, setShowDateRangeDropdown] = useState(false);
  const [dateRangeLabel, setDateRangeLabel] = useState('Select Date Range');
  const [isSearching, setIsSearching] = useState(false);
  const skipSearch = useRef(false);

  useEffect(() => {
    setLocalFilters(filters);
    setSearchText(filters.jobNumber || '');
  }, [filters, visible]);

  // Keyboard listener to hide results
  useEffect(() => {
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setSearchResults([]);
    });
    return () => hideSubscription.remove();
  }, []);

  // Debounced search for Places (Only for 'location' type)
  useEffect(() => {
    if (searchType !== 'location' || !searchText || searchText.length < 3 || skipSearch.current) {
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
    setSearchResults([]);
    onClose();

    const uid = user?._id || user?.id;
    if (!uid) return;

    if (localFilters.minPrice || localFilters.maxPrice) {
      logEvent('apply', {
        user_id: uid,
        module_type: 'price_filter',
        created_by: uid,
        meta: { minPrice: localFilters.minPrice || null, maxPrice: localFilters.maxPrice || null },
      });
    }

    if (localFilters.radius) {
      logEvent('apply', {
        user_id: uid,
        module_type: 'distance_filter',
        created_by: uid,
        meta: { radiusInMiles: localFilters.radius },
      });
    }

    if (searchType === 'job' && searchText) {
      logEvent('apply', {
        user_id: uid,
        module_type: 'job_number_filter',
        created_by: uid,
        meta: { jobNumber: searchText },
      });
    }

    if (dateRangeLabel !== 'Select Date Range') {
      logEvent('apply', {
        user_id: uid,
        module_type: 'date_range_filter',
        created_by: uid,
        meta: {
          dateFilterType: dateRangeLabel,
          startDate: dateRangeLabel === 'Custom' ? localFilters.startDate : null,
          endDate: dateRangeLabel === 'Custom' ? localFilters.endDate : null,
        },
      });
    }

    if (localFilters.isFavoriteOnly) {
      logEvent('apply', {
        user_id: uid,
        module_type: 'favorite_filter',
        created_by: uid,
        meta: { favoriteEnabled: true },
      });
    }

    if (localFilters.isHeatMap) {
      logEvent('apply', {
        user_id: uid,
        module_type: 'heat_map_filter',
        created_by: uid,
        meta: { heatMapEnabled: true },
      });
    }

    if (localFilters.showProduct) {
      logEvent('apply', {
        user_id: uid,
        module_type: 'product_filter',
        created_by: uid,
        meta: { productEnabled: true },
      });
    }

    logEvent('apply', {
      user_id: uid,
      module_type: 'search_action',
      created_by: uid,
      meta: {
        searchType,
        filtersApplied: {
          hasAddress: !!localFilters.centerCoords,
          hasJobNumber: searchType === 'job' && !!searchText,
          hasDistance: !!localFilters.radius,
          hasPrice: !!(localFilters.minPrice || localFilters.maxPrice),
          hasDateRange: dateRangeLabel !== 'Select Date Range',
          hasFavorite: localFilters.isFavoriteOnly,
          hasProduct: localFilters.showProduct,
          hasHeatMap: localFilters.isHeatMap,
        },
      },
    });
  };

  const handleReset = () => {
    setSearchText('');
    setSearchResults([]);
    setSearchType('location');
    setDateRangeLabel('Select Date Range');
    onReset();
    const uid = user?._id || user?.id;
    if (uid) {
      logEvent('apply', {
        user_id: uid,
        module_type: 'reset_filter',
        created_by: uid,
        meta: { reset: true },
      });
    }
  };

  const handleDateRangeSelect = (option: string) => {
    const now = new Date();
    let start: Date | null = null;
    let end: Date | null = now;
    let label = option;

    if (option === 'Past 30 Days') {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (option === 'Past Year') {
      start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    } else if (option === 'Past 5 Years') {
      start = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    } else if (option === 'Custom') {
      start = localFilters.startDate ? new Date(localFilters.startDate) : null;
      end = localFilters.endDate ? new Date(localFilters.endDate) : now;
    }

    setLocalFilters({
      ...localFilters,
      startDate: start ? start.toISOString() : null,
      endDate: end ? end.toISOString() : null,
    });
    setDateRangeLabel(label);
    // Always close dropdown after selection (including Custom) for iOS parity.
    setShowDateRangeDropdown(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <View className="flex-1 bg-black/40 justify-center px-8">
          <View className="bg-white rounded-[24px] p-5 shadow-2xl relative" style={{ transform: [{ translateY: 30 }] }}>
            <TouchableOpacity
              onPress={onClose}
              className="absolute right-2 top-4 z-30 p-2"
            >
              <Icon name="close" size={24} color="#64748b" />
            </TouchableOpacity>

            <View className="mt-8">
              {/* Search Input with Type Toggle */}
              <View className="mb-3" style={{ zIndex: 200 }}>
                <View className="flex-row items-center bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
                  {/* Type Toggle Dropdown Trigger */}
                  <TouchableOpacity
                    onPress={() => {
                      setShowTypeDropdown(!showTypeDropdown);
                      setShowRadiusDropdown(false);
                    }}
                    className="w-[85px] h-full items-center justify-center flex-row px-2"
                    style={{ backgroundColor: colors.primary.main }}
                  >
                    <Icon name={searchType === 'location' ? "map-marker" : ""} size={18} color="white" />
                    <Text className="text-white font-bold text-[12px] ml-1 uppercase">
                      {searchType === 'location' ? 'Loc' : 'Job #'}
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
                        onChangeText={(text) => {
                          skipSearch.current = false;
                          setSearchText(text);
                          // Clear centerCoords if they modify the text so we don't use a stale geocoded location
                          setLocalFilters((prev) => ({ ...prev, centerCoords: undefined }));
                        }}
                      />
                      {searchText.length > 0 && (
                        <TouchableOpacity
                          onPress={() => {
                            setSearchText('');
                            setSearchResults([]);
                            setLocalFilters({ ...localFilters, centerCoords: undefined });
                          }}
                          className="p-1"
                        >
                          <Icon name="close-circle" size={18} color="#94a3b8" />
                        </TouchableOpacity>
                      )}
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
                        setSearchText('');
                        setLocalFilters((prev) => ({ ...prev, centerCoords: undefined }));
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
                        setSearchText('');
                        setShowTypeDropdown(false);
                        setSearchResults([]);
                        // Clear location coordinates and radius when switching search modes
                        setLocalFilters((prev) => ({ ...prev, centerCoords: undefined, radius: 0 }));
                      }}
                    >
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
                          onPress={async () => {
                            skipSearch.current = true;
                            setSearchText(item.description);
                            setSearchResults([]);
                            Keyboard.dismiss();

                            // Geocode to get coordinates for map navigation
                            try {
                              const url = `https://maps.googleapis.com/maps/api/geocode/json?place_id=${item.place_id}&key=${ENV.GOOGLE_MAPS_API_KEY}`;
                              const res = await axios.get(url);
                              if (res.data?.results?.[0]?.geometry?.location) {
                                const { lat, lng } = res.data.results[0].geometry.location;
                                setLocalFilters({
                                  ...localFilters,
                                  centerCoords: { latitude: lat, longitude: lng }
                                });
                                if (user?._id || user?.id) {
                                  logEvent('change', {
                                    user_id: user._id || user.id,
                                    module_type: 'address_filter',
                                    created_by: user._id || user.id,
                                    meta: {
                                      address: item.description,
                                      coordinates: { lat, lng },
                                    },
                                  });
                                }
                              }
                            } catch (e) {
                              console.log('Geocoding error:', e);
                            }
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
              <View className="mb-3" style={{ zIndex: 150 }}>
                <FilterInput icon="radius-outline" primaryColor={colors.primary.main}>
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
                    className="absolute top-[52px] left-[50px] right-0 bg-white rounded-xl shadow-xl border border-slate-100 z-[120] overflow-hidden"
                    style={{
                      elevation: 10,
                      height: 180,
                    }}
                  >
                    <ScrollView
                      nestedScrollEnabled={true}
                      keyboardShouldPersistTaps="always"
                      showsVerticalScrollIndicator={true}
                    >
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
                <View className="w-[50px] h-full items-center justify-center" style={{ backgroundColor: colors.primary.main }}>
                  <Text className="text-white font-black text-[12px]">Min</Text>
                </View>
                <View className="flex-1 px-3 justify-center">
                  <TextInput
                    placeholder="Min Price"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numeric"
                    className="font-bold text-slate-700 text-[13px]"
                    style={{ paddingVertical: 0, includeFontPadding: false as any }}
                    value={localFilters.minPrice}
                    onChangeText={(text) => setLocalFilters({ ...localFilters, minPrice: text })}
                  />
                </View>
              </View>

              <View className="flex-row items-center mb-3 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
                <View className="w-[50px] h-full items-center justify-center" style={{ backgroundColor: colors.primary.main }}>
                  <Text className="text-white font-black text-[12px]">Max</Text>
                </View>
                <View className="flex-1 px-3 justify-center">
                  <TextInput
                    placeholder="Max Price"
                    placeholderTextColor="#94a3b8"
                    keyboardType="numeric"
                    className="font-bold text-slate-700 text-[13px]"
                    style={{ paddingVertical: 0, includeFontPadding: false as any }}
                    value={localFilters.maxPrice}
                    onChangeText={(text) => setLocalFilters({ ...localFilters, maxPrice: text })}
                  />
                </View>
              </View>

              {/* Date Range Dropdown */}
              <View className="z-[80] mb-3">
                <View className="flex-row items-center bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
                  <View className="w-[50px] h-full items-center justify-center" style={{ backgroundColor: colors.primary.main }}>
                    <Icon name="calendar-month" size={22} color="white" />
                  </View>
                  <TouchableOpacity
                    onPress={() => setShowDateRangeDropdown(!showDateRangeDropdown)}
                    className="flex-1 px-3 flex-row items-center justify-between"
                  >
                    <Text className={`font-bold text-[13px] ${dateRangeLabel !== 'Select Date Range' ? 'text-slate-700' : 'text-slate-400'}`}>
                      {dateRangeLabel}
                    </Text>
                    <Icon name={showDateRangeDropdown ? "chevron-up" : "chevron-down"} size={18} color="#94a3b8" />
                  </TouchableOpacity>
                </View>

                {showDateRangeDropdown && (
                  <View
                    className="absolute top-[52px] left-[50px] right-0 bg-white rounded-xl shadow-xl border border-slate-100 z-[120]"
                    style={{ elevation: 10 }}
                  >
                    {['Past 30 Days', 'Past Year', 'Past 5 Years', 'Custom'].map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        className="p-4 border-b border-slate-50"
                        onPress={() => handleDateRangeSelect(opt)}
                      >
                        <Text className="font-bold text-[13px] text-slate-700">{opt}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              {/* Custom Date Inputs */}
              {dateRangeLabel === 'Custom' && (
                <View className="mb-3">
                  <View className="flex-row items-center mb-3 bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
                    <View className="w-[50px] h-full bg-slate-100 items-center justify-center">
                      <Icon name="calendar-start" size={20} color="#64748b" />
                    </View>
                    <TouchableOpacity
                      onPress={() => setShowStartDate(true)}
                      className="flex-1 px-3 justify-center"
                    >
                      <Text className={`font-bold text-[13px] ${localFilters.startDate ? 'text-slate-700' : 'text-slate-400'}`}>
                        {localFilters.startDate ? new Date(localFilters.startDate).toLocaleDateString() : 'Start date'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View className="flex-row items-center bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
                    <View className="w-[50px] h-full bg-slate-100 items-center justify-center">
                      <Icon name="calendar-end" size={20} color="#64748b" />
                    </View>
                    <TouchableOpacity
                      onPress={() => setShowEndDate(true)}
                      className="flex-1 px-3 justify-center"
                    >
                      <Text className={`font-bold text-[13px] ${localFilters.endDate ? 'text-slate-700' : 'text-slate-400'}`}>
                        {localFilters.endDate ? new Date(localFilters.endDate).toLocaleDateString() : 'End date'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {/* Toggles Row */}
              <View className="flex-row items-center justify-between mb-8 px-1">
                <View className="flex-row gap-5 items-center">
                  <Icon name="format-list-checks" size={24} color="#000" />
                  <TouchableOpacity
                    onPress={() => {
                      const next = !localFilters.showProduct;
                      setLocalFilters({ ...localFilters, showProduct: next });
                      if (user?._id || user?.id) {
                        logEvent('toggle', {
                          user_id: user._id || user.id,
                          module_type: 'product_filter',
                          created_by: user._id || user.id,
                          meta: { productEnabled: next },
                        });
                      }
                    }}
                    className="w-11 h-6 rounded-full px-1 justify-center"
                    style={{ backgroundColor: localFilters.showProduct ? colors.primary.main : '#e2e8f0' }}
                  >
                    <View className={`w-4 h-4 bg-white rounded-full ${localFilters.showProduct ? 'self-end' : 'self-start'}`} />
                  </TouchableOpacity>

                  {/* Route / directions toggle (web parity: ToggleSwitchRoute). */}
                  <Icon name="map-marker-path" size={24} color="#000" />
                  <TouchableOpacity
                    onPress={() => {
                      const next = !localFilters.showRoute;
                      setLocalFilters({ ...localFilters, showRoute: next });
                      if (user?._id || user?.id) {
                        logEvent('toggle', {
                          user_id: user._id || user.id,
                          module_type: 'route_filter',
                          created_by: user._id || user.id,
                          meta: { routeEnabled: next },
                        });
                      }
                    }}
                    className="w-11 h-6 rounded-full px-1 justify-center"
                    style={{ backgroundColor: localFilters.showRoute ? colors.primary.main : '#e2e8f0' }}
                  >
                    <View className={`w-4 h-4 bg-white rounded-full ${localFilters.showRoute ? 'self-end' : 'self-start'}`} />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  onPress={handleReset}
                  className="w-12 h-10 rounded-xl items-center justify-center"
                  style={{ backgroundColor: colors.primary.main }}
                >
                  <Icon name="refresh" size={24} color="white" />
                </TouchableOpacity>
              </View>

              {/* Search Button */}
              <TouchableOpacity
                onPress={handleApply}
                className="w-full h-14 rounded-2xl flex-row items-center justify-center shadow-xl"
                style={{ backgroundColor: colors.primary.main, shadowColor: colors.primary.main }}
              >
                <Icon name="magnify" size={26} color="white" />
                <Text className="text-white font-black text-lg ml-2 uppercase">Search</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>


      {showStartDate && Platform.OS === 'android' && (
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
      {showEndDate && Platform.OS === 'android' && (
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

      {Platform.OS === 'ios' && (
        <>
          <CustomDatePicker
            visible={showStartDate}
            onClose={() => setShowStartDate(false)}
            initialDate={localFilters.startDate || undefined}
            onSelect={(dateStr) => {
              const d = new Date(dateStr);
              setLocalFilters({ ...localFilters, startDate: d.toISOString() });
            }}
          />
          <CustomDatePicker
            visible={showEndDate}
            onClose={() => setShowEndDate(false)}
            initialDate={localFilters.endDate || undefined}
            onSelect={(dateStr) => {
              const d = new Date(dateStr);
              setLocalFilters({ ...localFilters, endDate: d.toISOString() });
            }}
          />
        </>
      )}
    </Modal>
  );
};

