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
import { LeadService } from '../../services/api/leads';
import { NUMERIC_KEYBOARD } from '../../utils/keyboard-type';
import { PIN_STATUS_FILTER_LABELS, PinStatusFilter } from '../../utils/sales-pins';

// Dedicated, interceptor-free client for the Google Places/Geocode web-service calls,
// with a finite timeout so a hung request fails fast instead of surfacing a bare
// "Network Error". It's fully isolated from the app's authed API instance
// (`services/api/index.ts`, which is its own `axios.create`) and from the global axios.
const googleHttp = axios.create({ timeout: 15000 });

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
  // Sold-job pin status (REVUIUX-439), applied on the device like web: pending =
  // `pinCategory === 'pendingInstall'`, installed = everything else. Drives ONLY this
  // modal's dropdown — web parity, do not repoint the on-map toggles at this field.
  statusFilter: PinStatusFilter;
  /**
   * The Sales Map's on-map "INS" / "PI" quick toggles (`LeadMap.tsx`'s right-side
   * stack) — NOT the same thing as `statusFilter` above, on purpose.
   *
   * Ticket: "in the installed toggle only installed pins [should] display, uploaded
   * pins should not display in this toggle." `statusFilter === 'installed'` means
   * "not pending" (uploaded counts as a historical install — web parity, see above),
   * which is right for the dropdown but was also what the on-map toggle used at
   * first, and that's the "uploaded is displayed" the ticket is against.
   *
   * ⚠️ **Deliberate divergence from web / from `statusFilter`'s own rule — do NOT
   * "fix" this to reuse `statusFilter`.** These two are a STRICT `pinCategory` match
   * (`getPinCategory(item) === 'installed'` / `'pendingInstall'`), independent of the
   * modal's dropdown. A rep can therefore have the dropdown on "All Jobs" while the
   * on-map toggle narrows further to a stricter set — that is correct, not a bug.
   * Mutually exclusive with each other (enforced in `MapDetail`'s `onToggleFilter`
   * handler, not by type), unrelated to `statusFilter`'s own value.
   *
   * Not counted in `countAppliedMapFilters` / not persisted via
   * `savedFiltersToFilterState`, matching the other on-map-only toggles
   * (`isHeatMap` / `myJobsOnly` / `isReferralOnly`) rather than `statusFilter`.
   */
  isMapInstalledOnly: boolean;
  isMapPendingInstallOnly: boolean;
  centerCoords?: { latitude: number; longitude: number };
  // Persisted so a re-hydrated (saved) filter set restores the search mode and the
  // date-range label (web `savedFilters.searchType` / `savedFilters.rangeType`).
  searchType?: 'location' | 'job';
  rangeType?: string;
}

// Date-range option ↔ web `rangeType` value (web parity: header-filter.js menu items).
export const RANGE_TYPE_TO_LABEL: Record<string, string> = {
  last30days: 'Past 30 Days',
  lastYear: 'Past Year',
  last5Years: 'Past 5 Years',
  custom: 'Custom',
};
export const LABEL_TO_RANGE_TYPE: Record<string, string> = {
  'Past 30 Days': 'last30days',
  'Past Year': 'lastYear',
  'Past 5 Years': 'last5Years',
  Custom: 'custom',
};

/**
 * Map a lead's persisted `savedFilters` (web shape) back onto the mobile
 * `FilterState`, so re-opening the map screen restores what the rep last applied
 * (web parity: header-filter.js "Populate filters from savedFilters"). Returns a
 * partial to spread over the default filter state.
 */
export const savedFiltersToFilterState = (sf: any): Partial<FilterState> => {
  if (!sf || typeof sf !== 'object') return {};
  const out: Partial<FilterState> = {};
  const isJob = sf.searchType === 'jobNumber';
  const text = isJob ? sf.jobNumber : sf.formattedAddress;
  if (text) out.jobNumber = String(text);
  out.searchType = isJob ? 'job' : 'location';
  if (!isJob && sf.lat != null && sf.lng != null) {
    out.centerCoords = { latitude: Number(sf.lat), longitude: Number(sf.lng) };
  }
  if (sf.radius) out.radius = Number(sf.radius) || 0;
  if (sf.min !== undefined && sf.min !== '') out.minPrice = String(sf.min);
  if (sf.max !== undefined && sf.max !== '') out.maxPrice = String(sf.max);
  if (sf.startDate) out.startDate = sf.startDate;
  if (sf.endDate) out.endDate = sf.endDate;
  if (sf.rangeType && RANGE_TYPE_TO_LABEL[sf.rangeType]) out.rangeType = sf.rangeType;
  if (sf.favoriteJobs) out.isFavoriteOnly = true;
  return out;
};

/**
 * How many filters are actually applied — drives the badge on the header's
 * filter icon. Port of web `header-filter.js`'s `filteredItemsCount`, which
 * counts: address, job number, distance, min, max, date range, favourites.
 *
 * Mobile keeps the location text in the same `jobNumber` field as a job-number
 * search, so a geocoded location (which also sets `centerCoords`) counts once
 * rather than twice. The product/route switches are display toggles and are not
 * counted, matching web. A pin status other than "all" counts as one.
 */
export const countAppliedMapFilters = (filters: FilterState | null | undefined): number => {
  if (!filters) return 0;

  return [
    !!filters.centerCoords,
    !filters.centerCoords && !!filters.jobNumber?.trim(),
    !!filters.radius,
    !!filters.minPrice?.trim(),
    !!filters.maxPrice?.trim(),
    !!(filters.startDate || filters.endDate),
    !!filters.isFavoriteOnly,
    !!filters.statusFilter && filters.statusFilter !== 'all',
  ].filter(Boolean).length;
};

interface MapFiltersModalProps {
  visible: boolean;
  onClose: () => void;
  filters: FilterState;
  onApply: (newFilters: FilterState) => void;
  onReset: () => void;
  /** The lead the map is scoped to — filters are saved/cleared against it. */
  lead?: any;
  /** Called with the persisted `savedFilters` after a save/reset, so the parent can
   *  keep the (shared) lead object fresh — mobile has no global lead store, so this is
   *  how a reset/apply survives a back-and-return without an app reload. */
  onFiltersPersisted?: (savedFilters: any) => void;
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
  lead,
  onFiltersPersisted,
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
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const skipSearch = useRef(false);

  useEffect(() => {
    setLocalFilters(filters);
    setSearchText(filters.jobNumber || '');
    // Restore the search mode + date-range label from the (possibly saved) filters
    // so a re-hydrated set shows the way the rep left it (web parity).
    setSearchType(filters.searchType || 'location');
    setDateRangeLabel(
      filters.rangeType && RANGE_TYPE_TO_LABEL[filters.rangeType]
        ? RANGE_TYPE_TO_LABEL[filters.rangeType]
        : 'Select Date Range',
    );
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

      const res = await googleHttp.get(url);
      // Google always answers 200 — a bad key / quota shows up as a `status` field
      // (REQUEST_DENIED / OVER_QUERY_LIMIT), which is the actionable case to flag.
      if (res.data?.status && res.data.status !== 'OK' && res.data.status !== 'ZERO_RESULTS') {
        console.error('[MapFilters] Places API rejected:', res.data.status, res.data.error_message || '');
        setSearchResults([]);
      } else {
        setSearchResults(res.data?.predictions || []);
      }
    } catch (error: any) {
      // A transient "Network Error" (the Google request never reached a response —
      // connectivity blip) is expected mid-typing and must NOT throw a red LogBox
      // overlay; autocomplete just yields no suggestions for this keystroke. Only a
      // real HTTP failure with a response is worth an error.
      if (error?.response) {
        console.error('[MapFilters] Places API error:', error.response.status, error.response.data);
      } else {
        console.warn('[MapFilters] Places lookup skipped (network):', error?.message || error);
      }
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleApply = () => {
    const rangeType = LABEL_TO_RANGE_TYPE[dateRangeLabel];
    onApply({ ...localFilters, jobNumber: searchText, searchType, rangeType });
    setSearchResults([]);
    onClose();

    // Persist the applied filters against the lead (web parity: `saveLeadFilters`) so
    // they re-hydrate on the next visit. Only set fields go in the payload, exactly
    // like web's `payload` build; wrapped in `{ savedFilters }` to match the endpoint.
    const leadId = lead?._id || lead?.id;
    if (leadId) {
      const text = searchText?.trim();
      const payload: Record<string, any> = {};
      if (searchType === 'job') payload.searchType = 'jobNumber';
      if (localFilters.minPrice?.trim()) payload.min = localFilters.minPrice.trim();
      if (localFilters.maxPrice?.trim()) payload.max = localFilters.maxPrice.trim();
      if (localFilters.radius) payload.radius = localFilters.radius;
      if (searchType === 'location' && text) {
        payload.formattedAddress = text;
        if (localFilters.centerCoords) {
          payload.lat = localFilters.centerCoords.latitude;
          payload.lng = localFilters.centerCoords.longitude;
        }
      }
      if (searchType === 'job' && text) payload.jobNumber = text;
      if (rangeType) payload.rangeType = rangeType;
      if (localFilters.startDate) payload.startDate = localFilters.startDate;
      if (localFilters.endDate) payload.endDate = localFilters.endDate;
      if (localFilters.isFavoriteOnly) payload.favoriteJobs = true;
      if (Object.keys(payload).length > 0) {
        LeadService.saveLeadFilters(leadId, { savedFilters: payload }).catch((error) =>
          console.error('[MapFilters] Error saving filters:', error),
        );
        // Sync the (shared) lead object so re-opening the map re-hydrates these filters
        // rather than a stale set — mobile has no global lead store (web: setCurrentLead).
        onFiltersPersisted?.(payload);
      }
    }

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

    if (localFilters.statusFilter && localFilters.statusFilter !== 'all') {
      logEvent('apply', {
        user_id: uid,
        module_type: 'pin_status_filter',
        created_by: uid,
        meta: { pinStatus: localFilters.statusFilter },
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
          pinStatus: localFilters.statusFilter || 'all',
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
    // Clear the persisted filters too (web parity: `saveLeadFilters(leadId, { savedFilters: {} })`).
    const leadId = lead?._id || lead?.id;
    if (leadId) {
      LeadService.saveLeadFilters(leadId, { savedFilters: {} }).catch(() => {});
    }
    // Clear the shared lead object's saved filters so a back-and-return shows the reset
    // state (not a stale filter set) without an app reload.
    onFiltersPersisted?.({});
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
                              const res = await googleHttp.get(url);
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
                    keyboardType={NUMERIC_KEYBOARD}
                    returnKeyType="done"
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
                    keyboardType={NUMERIC_KEYBOARD}
                    returnKeyType="done"
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
                    onPress={() => {
                      setShowDateRangeDropdown(!showDateRangeDropdown);
                      setShowStatusDropdown(false);
                    }}
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

              {/* Pin status (REVUIUX-439): all / pending install / installed. Below the
                  date range's own dropdown in paint order (z 70 < 80) so that one
                  still opens over this row. */}
              <View className="z-[70] mb-3">
                <View className="flex-row items-center bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden h-[50px]">
                  <View className="w-[50px] h-full items-center justify-center" style={{ backgroundColor: colors.primary.main }}>
                    <Icon name="map-marker-check" size={22} color="white" />
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      setShowStatusDropdown(!showStatusDropdown);
                      setShowDateRangeDropdown(false);
                      setShowRadiusDropdown(false);
                      setShowTypeDropdown(false);
                    }}
                    className="flex-1 px-3 flex-row items-center justify-between"
                  >
                    <Text className={`font-bold text-[13px] ${localFilters.statusFilter && localFilters.statusFilter !== 'all' ? 'text-slate-700' : 'text-slate-400'}`}>
                      {PIN_STATUS_FILTER_LABELS[localFilters.statusFilter || 'all']}
                    </Text>
                    <Icon name={showStatusDropdown ? "chevron-up" : "chevron-down"} size={18} color="#94a3b8" />
                  </TouchableOpacity>
                </View>

                {showStatusDropdown && (
                  <View
                    className="absolute top-[52px] left-[50px] right-0 bg-white rounded-xl shadow-xl border border-slate-100 z-[120]"
                    style={{ elevation: 10 }}
                  >
                    {(Object.keys(PIN_STATUS_FILTER_LABELS) as PinStatusFilter[]).map((opt) => (
                      <TouchableOpacity
                        key={opt}
                        className="p-4 border-b border-slate-50"
                        onPress={() => {
                          setLocalFilters((prev) => ({ ...prev, statusFilter: opt }));
                          setShowStatusDropdown(false);
                        }}
                      >
                        <Text className="font-bold text-[13px] text-slate-700">{PIN_STATUS_FILTER_LABELS[opt]}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

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

