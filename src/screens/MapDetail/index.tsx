import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Platform,
  StatusBar,
  Dimensions,
  Modal,
  PermissionsAndroid,
  FlatList,
  DeviceEventEmitter,
} from 'react-native';
import Geolocation from 'react-native-geolocation-service';

import { useNavigation, useRoute, RouteProp, useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { LeadService } from '../../services/api/leads';
import { useAuth } from '../../hooks/useAuth';
import { logEvent } from '../../services/api/LoggerService';
import { logSalesMapView } from '../../utils/activity-log/map-activity-log';
import { LeadMap } from '../../widgets/components/LeadCenter/LeadMap';
import { RootStackParamList } from '../../navigation';
import { Header, useHeader } from '../../widgets/common/MainHeader';
import { MapFiltersModal, FilterState } from '../../widgets/modals/MapFiltersModal';
import { MapGalleryModal } from '../../widgets/components/LeadCenter/MapGalleryModal';
import { ReferralModal } from '../../widgets/modals/ReferralModal';
import { BeforeAfterModal } from '../../widgets/modals/BeforeAfterModal';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { format } from 'date-fns';
import { getOfflineImagesForJob } from '../../services/api/offlineUploadManager';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashMessage } from '../../config/message';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const { width, height } = Dimensions.get('window');

const isJobOwner = (item: any, user: any): boolean => {
  if (!user || !item) return false;
  const uid = typeof user === 'string' ? user : (user._id || user.id);
  if (!uid) return false;

  const matchesId = !!(
    item.salesRepId === uid ||
    item.salesRep === uid ||
    (item.salesRep && typeof item.salesRep === 'object' && (item.salesRep._id === uid || item.salesRep.id === uid)) ||
    item.assignedRepId === uid ||
    (item.assignedRep && typeof item.assignedRep === 'object' && (item.assignedRep._id === uid || item.assignedRep.id === uid))
  );
  if (matchesId) return true;

  if (typeof user === 'object') {
    const repName = (item.salesRepName || item.userName || (typeof item.salesRep === 'string' ? item.salesRep : ''))?.toLowerCase().trim();
    if (repName) {
      const userFullName = `${user.firstName || ''} ${user.lastName || ''}`.toLowerCase().trim();
      const userFirstName = (user.firstName || '').toLowerCase().trim();
      if (userFullName && (repName === userFullName || repName === userFirstName)) {
        return true;
      }
    }
  }

  return false;
};

const toRad = (deg: number) => (deg * Math.PI) / 180;
const getDistanceInMiles = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const EMPTY_LEADS: any[] = [];

const getRegionDeltaForRadiusMiles = (latitude: number, radiusMiles: number) => {
  // latitude: ~69 miles per degree. Use diameter (radius * 2) to fit full range.
  const latDelta = (radiusMiles * 2) / 69;
  // longitude shrinks by cos(latitude)
  const cosLat = Math.cos((latitude * Math.PI) / 180) || 0.0001;
  const lonDelta = latDelta / Math.max(cosLat, 0.0001);

  // Small padding so pins at the edge stay visible.
  return {
    latitudeDelta: Math.max(latDelta * 1.2, 0.01),
    longitudeDelta: Math.max(lonDelta * 1.2, 0.01),
  };
};

export default function MapDetailScreen() {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'MapDetail'>>();
  const { currentLead } = route.params || {};

  const { setHeaderActions } = useHeader();

  useEffect(() => {
    if (user) {
      logSalesMapView(user);
    }
  }, [user]);

  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [showGalleryModal, setShowGalleryModal] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);

  const [isListView, setIsListView] = useState(false);
  const [updatedJob, setUpdatedJob] = useState<any>(null);
  // Satellite / street map-view toggle (web parity: `isSatelliteView`).
  const [isSatelliteView, setIsSatelliteView] = useState(false);

  useFocusEffect(
    React.useCallback(() => {
      setHeaderActions({
        onFilterPress: () => setShowFiltersModal(true),
        onListPress: () => setIsListView(prev => !prev),
      });
      return () => {
        setHeaderActions({
          onFilterPress: null,
          onListPress: null,
        });
      };
    }, [isListView])
  );

  const [filters, setFilters] = useState<FilterState>({
    jobNumber: '',
    sortOrder: 'date-desc',
    radius: 0,
    minPrice: '',
    maxPrice: '',
    startDate: null,
    endDate: null,
    myJobsOnly: false,
    isFavoriteOnly: false,
    isReferralOnly: false,
    isHeatMap: false,
    showRoute: false,
    showProduct: true,
  });

  const [jumpLead, setJumpLead] = useState<any>(null);
  const [centerCoords, setCenterCoords] = useState<{
    latitude: number;
    longitude: number;
    latitudeDelta?: number;
    longitudeDelta?: number;
    _forceTimestamp?: number;
  } | null>(null);
  const [sortOption, setSortOption] = useState<'price_asc' | 'price_desc' | 'date_asc' | 'date_desc'>('date_desc');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const lastRadiusMessageKeyRef = useRef<string>('');

  const sortLabels = {
    price_asc: 'Price Ascending',
    price_desc: 'Price Descending',
    date_asc: 'Date Ascending',
    date_desc: 'Date Descending',
  };

  useEffect(() => {
    // Get initial location for API call
    const requestLocation = async () => {
      if (Platform.OS === 'ios') {
        await Geolocation.requestAuthorization('whenInUse');
      } else {
        const hasLocation = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        if (!hasLocation) {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        }
      }

      Geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation(pos.coords);
        },
        (err) => {
          console.log('Location error:', err);
          // Fallback to Tampa coords so leads still fetch on failure
          setUserLocation({ latitude: 27.9506, longitude: -82.4572 });
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    };

    requestLocation();
  }, []);

  const queryClient = useQueryClient();
  const latKey = userLocation ? parseFloat(userLocation.latitude.toFixed(2)) : 27.95;
  const lngKey = userLocation ? parseFloat(userLocation.longitude.toFixed(2)) : -82.46;
  const radiusVal = filters.radius;

  const queryKey = useMemo(() => {
    if (radiusVal > 0 && userLocation) {
      return ['mapJobs', latKey, lngKey, radiusVal];
    }
    return ['mapJobs', 'all'];
  }, [latKey, lngKey, radiusVal, userLocation]);

  const { data: queryLeads, isLoading: queryLoading, refetch: refetchQuery } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload: any = {};
      if (radiusVal > 0 && userLocation) {
        payload.radiusInMiles = radiusVal;
        payload.latitude = userLocation.latitude;
        payload.longitude = userLocation.longitude;
      }
      console.log('[MapDetail DEBUG] Calling LeadService.findJobs via useQuery with payload:', payload);
      const res = await LeadService.findJobs(payload);
      return res.data?.data || [];
    },
    enabled: !!user?._id,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Sync queryLeads to leads state
  useEffect(() => {
    const activeLeads = queryLeads || EMPTY_LEADS;
    setLeads(activeLeads);
    if (selectedJob?._id) {
      const updatedJob = activeLeads.find((job: any) => job._id === selectedJob._id);
      if (updatedJob) {
        setSelectedJob(updatedJob);
      }
    }
  }, [queryLeads]);

  // Maintain loading state compatible with the UI spinner
  useEffect(() => {
    setLoading(queryLoading);
  }, [queryLoading]);

  const fetchLeads = async () => {
    refetchQuery();
  };

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('OFFLINE_UPLOAD_SUCCESS', (data) => {
      queryClient.invalidateQueries({ queryKey: ['mapJobs'] });
      refetchQuery();
    });
    return () => sub.remove();
  }, [queryClient, refetchQuery]);

  const baseFilteredLeads = useMemo(() => {
    console.log('[MapDetail DEBUG] Recalculating filteredLeads. leads.length:', leads.length, 'myJobsOnly:', filters.myJobsOnly, 'user ID:', user?._id || user?.id);
    let result = [...leads];
    // 1. Filter out specific job number range (Web parity)
    result = result.filter((item) => {
      const jobNumber = item?.jobNumber;
      if (typeof jobNumber === 'string' && jobNumber.startsWith('TAM')) {
        const number = parseInt(jobNumber.replace('TAM', ''), 10);
        if (!isNaN(number) && number >= 30000 && number <= 30032) {
          return false;
        }
      }
      return true;
    });

    // 2. Local Filtering based on UI filters (for strictness)
    result = result.filter((item) => {
      // Job Number / Search Text - only filter by text if NOT performing a location search
      if (filters.jobNumber && !filters.centerCoords) {
        // Coerce to string — jobNumber/fullAddress can be numeric in API data,
        // where `?.toLowerCase()` would throw "undefined is not a function".
        const search = String(filters.jobNumber).toLowerCase();
        const matchesJob = String(item.jobNumber ?? '').toLowerCase().includes(search);
        const matchesAddress = String(item.fullAddress ?? '').toLowerCase().includes(search);
        if (!matchesJob && !matchesAddress) return false;
      }

      // Referral Filter (match web app logic)
      if (filters.isReferralOnly) {
        const isMine = isJobOwner(item, user);
        const hasReferrals = item.jobReferrals && item.jobReferrals.length > 0;
        if (!hasReferrals) return false;

        if (!isMine) {
          const activeToggle = item.jobReferrals[0]?.referralToggle === true || item.jobReferrals[0]?.referralToggle === 'true';
          if (!activeToggle) return false;
        }
      }

      // My Jobs Only
      if (filters.myJobsOnly) {
        const isMine = isJobOwner(item, user);
        console.log('[MapDetail DEBUG] MyJobsOnly check for job:', item.jobNumber, 'user uid:', user?._id || user?.id, 'isMine:', isMine);
        if (!isMine) return false;
      }

      // Favorite Only
      if (filters.isFavoriteOnly) {
        const isFav = item.isFavorite === true || item.isFavourite === true;
        if (!isFav) return false;
      }

      // Price Range
      if (filters.minPrice && (item.price || 0) < parseFloat(filters.minPrice)) return false;
      if (filters.maxPrice && (item.price || 0) > parseFloat(filters.maxPrice)) return false;

      // Location radius filter (from searched location)
      if (filters.centerCoords && filters.radius > 0) {
        const coords = item?.location?.coordinates;
        if (!coords || coords.length < 2) return false;
        const miles = getDistanceInMiles(
          filters.centerCoords.latitude,
          filters.centerCoords.longitude,
          coords[1],
          coords[0]
        );
        if (miles > filters.radius) return false;
      }

      // Date Range
      if (filters.startDate) {
        const itemDate = new Date(item.installationDate || item.createdAt || 0);
        if (itemDate < new Date(filters.startDate)) return false;
      }
      if (filters.endDate) {
        const itemDate = new Date(item.installationDate || item.createdAt || 0);
        if (itemDate > new Date(filters.endDate)) return false;
      }

      return true;
    });

    const processed = result.map((item) => ({
      ...item,
      _timestamp: new Date(item.installationDate || item.createdAt || 0).getTime(),
    }));

    console.log('[MapDetail DEBUG] Recalculated filteredLeads. final count:', processed.length);
    return processed;
  }, [
    leads,
    filters.jobNumber,
    filters.myJobsOnly,
    filters.isFavoriteOnly,
    filters.isReferralOnly,
    filters.minPrice,
    filters.maxPrice,
    filters.startDate,
    filters.endDate,
    filters.centerCoords,
    filters.radius,
    user
  ]);

  const filteredLeads = useMemo(() => {
    // Apply Sorting
    return [...baseFilteredLeads].sort((a, b) => {
      if (sortOption === 'price_asc') return (a.price || 0) - (b.price || 0);
      if (sortOption === 'price_desc') return (b.price || 0) - (a.price || 0);

      const timeA = a._timestamp || 0;
      const timeB = b._timestamp || 0;

      if (sortOption === 'date_asc') return timeA - timeB;
      return timeB - timeA; // date_desc
    });
  }, [baseFilteredLeads, sortOption]);

  // Automatic navigation to searched job or location (Web Parity)
  useEffect(() => {
    if (filters.centerCoords) {
      const radius = filters.radius || 0;
      const deltas = radius > 0 ? getRegionDeltaForRadiusMiles(filters.centerCoords.latitude, radius) : {};
      setCenterCoords({
        ...filters.centerCoords,
        ...deltas,
        _forceTimestamp: Date.now() // force new object reference on every apply
      });
      setJumpLead(null); // Clear selected lead if we are jumping to a general area
    } else {
      setCenterCoords(null);
      if (filters.jobNumber && filteredLeads.length > 0) {
        const search = filters.jobNumber.toLowerCase();
        const exactMatch = filteredLeads.find(l => l.jobNumber?.toLowerCase() === search);
        if (exactMatch) {
          setJumpLead(exactMatch);
        } else if (filteredLeads.length === 1) {
          setJumpLead(filteredLeads[0]);
        }
      } else {
        setJumpLead(null);
      }
    }
  }, [filters.jobNumber, filteredLeads, filters]);

  useEffect(() => {
    // Distance result feedback for location-based radius searches only.
    if (!filters.centerCoords || !filters.radius) return;
    const key = `${filters.centerCoords.latitude.toFixed(5)}-${filters.centerCoords.longitude.toFixed(5)}-${filters.radius}-${filteredLeads.length}`;
    if (lastRadiusMessageKeyRef.current === key) return;
    lastRadiusMessageKeyRef.current = key;

    if (filteredLeads.length > 0) {
      FlashMessage.success('Job found');
    } else {
      FlashMessage.warning('No job found');
    }
  }, [filters.centerCoords, filters.radius, filteredLeads.length]);

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#121212' : '#F4F6F8' }}>

      {/* Global Common Header with Map Tools */}
      <StatusBar barStyle={'light-content'} backgroundColor="#ffffff" />

      <View style={{ flex: 1 }}>
        <LeadMap
          currentLead={centerCoords ?? currentLead}
          focusLead={jumpLead}
          fullScreen
          leads={baseFilteredLeads}
          isFavoriteFilter={filters.isFavoriteOnly}
          isReferralFilter={filters.isReferralOnly}
          isMyJobsFilter={filters.myJobsOnly}
          isHeatMapFilter={filters.isHeatMap}
          searchedJobNumber={filters.jobNumber}
          showProduct={filters.showProduct}
          isSatelliteView={isSatelliteView}
          showRoute={filters.showRoute}
          updatedJob={updatedJob}
          onToggleFilter={(type) => {
            setFilters((prev) => {
              let next = prev;
              if (type === 'heatmap') next = { ...prev, isHeatMap: !prev.isHeatMap };
              else if (type === 'myjobs') next = { ...prev, myJobsOnly: !prev.myJobsOnly };
              else if (type === 'referral') next = { ...prev, isReferralOnly: !prev.isReferralOnly };
              else if (type === 'favorite') next = { ...prev, isFavoriteOnly: !prev.isFavoriteOnly };

              const userId = user?._id || user?.id;
              if (userId && next !== prev) {
                const toggleMeta: Record<string, { toggle: string; enabled: boolean; action: string }> = {
                  heatmap: {
                    toggle: 'heat_map',
                    enabled: next.isHeatMap,
                    action: next.isHeatMap ? 'heat_map_enabled' : 'heat_map_disabled',
                  },
                  myjobs: {
                    toggle: 'my_jobs',
                    enabled: next.myJobsOnly,
                    action: next.myJobsOnly ? 'my_jobs_filter_enabled' : 'my_jobs_filter_disabled',
                  },
                  referral: {
                    toggle: 'referral',
                    enabled: next.isReferralOnly,
                    action: next.isReferralOnly ? 'referral_filter_enabled' : 'referral_filter_disabled',
                  },
                  favorite: {
                    toggle: 'favorite',
                    enabled: next.isFavoriteOnly,
                    action: next.isFavoriteOnly ? 'favorite_filter_enabled' : 'favorite_filter_disabled',
                  },
                };
                const meta = toggleMeta[type];
                if (meta) {
                  logEvent('toggle', {
                    user_id: userId,
                    created_by: userId,
                    module_type: 'heat_map_filter',
                    meta,
                  });
                }
              }
              return next;
            });
          }}
          onFavoriteToggle={(jobId, isFav) => {
            setLeads((prev) =>
              prev.map((l) =>
                l._id === jobId ? { ...l, isFavourite: isFav, isFavorite: isFav } : l
              )
            );
            queryClient.setQueryData(queryKey, (old: any) => {
              if (!old) return old;
              return old.map((l: any) =>
                l._id === jobId ? { ...l, isFavourite: isFav, isFavorite: isFav } : l
              );
            });
          }}
          onGalleryPress={(job) => {
            setSelectedJob(job);
            setShowGalleryModal(true);
          }}
          onCameraPress={(job) => {
            setSelectedJob(job);
            setShowCameraModal(true);
            logEvent('view', {
              user_id: user?._id || user?.id,
              module_type: 'upload_before_after_images',
              created_by: user?._id || user?.id,
              meta: {
                job_number: job?.jobNumber,
                company_id: job?.companyId,
              },
            });
          }}
          onReferencePress={(job) => {
            setSelectedJob(job);
            setShowReferralModal(true);
          }}
        />

        {/* Satellite / Street map-view toggle (web parity: ToggleMapView). */}
        {!isListView && (
          <TouchableOpacity
            onPress={() => {
              setIsSatelliteView((prev) => {
                const next = !prev;
                const userId = user?._id || user?.id;
                if (userId) {
                  logEvent('toggle', {
                    user_id: userId,
                    created_by: userId,
                    module_type: 'map_view_filter',
                    meta: {
                      toggle: 'satellite_view',
                      enabled: next,
                      action: next ? 'satellite_view_enabled' : 'satellite_view_disabled',
                    },
                  });
                }
                return next;
              });
            }}
            activeOpacity={0.8}
            accessibilityLabel={isSatelliteView ? 'Switch to street view' : 'Switch to satellite view'}
            className="absolute top-5 right-5 w-12 h-12 rounded-full items-center justify-center shadow-xl"
            style={{
              zIndex: 20,
              backgroundColor: isSatelliteView ? '#4CBB17' : 'rgba(255,255,255,0.95)',
              borderWidth: 2,
              borderColor: '#4CBB17',
            }}
          >
            <Icon
              name={isSatelliteView ? 'satellite-variant' : 'map'}
              size={24}
              color={isSatelliteView ? 'white' : '#4CBB17'}
            />
          </TouchableOpacity>
        )}

        {isListView && (
          <SafeAreaView edges={['bottom']} style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? '#121212' : '#F4F6F8', zIndex: 10000 }]}>
            {/* List Toolbar */}
            <View className="px-5 py-4 flex-row items-center justify-between bg-white dark:bg-black/20 border-b border-slate-100 dark:border-zinc-800 z-50">
              <View className="flex-1 mr-4">
                <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">
                  Order By
                </Text>
                <View className="relative">
                  <TouchableOpacity
                    onPress={() => setShowSortDropdown(!showSortDropdown)}
                    className="flex-row items-center justify-between bg-slate-50 dark:bg-zinc-800 px-4 py-2.5 rounded-xl border border-slate-100 dark:border-zinc-700"
                  >
                    <Text className="text-[13px] font-bold text-slate-700 dark:text-zinc-300">
                      {sortLabels[sortOption]}
                    </Text>
                    <Icon name={showSortDropdown ? "chevron-up" : "chevron-down"} size={20} color="#94a3b8" />
                  </TouchableOpacity>

                  {showSortDropdown && (
                    <View
                      className="absolute top-12 left-0 right-0 bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-zinc-800 p-2 z-[1000]"
                      style={{ elevation: 20 }}
                    >
                      {Object.entries(sortLabels).map(([key, label]) => (
                        <TouchableOpacity
                          key={key}
                          onPress={() => {
                            setSortOption(key as any);
                            setShowSortDropdown(false);
                          }}
                          className={`px-4 py-3 rounded-xl mb-1 ${sortOption === key ? 'bg-slate-50 dark:bg-zinc-800' : ''}`}
                        >
                          <Text className={`text-[13px] ${sortOption === key ? 'font-black text-slate-900 dark:text-white' : 'font-bold text-slate-500'}`}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>
              <View className="flex-row gap-2 mt-4">
                <TouchableOpacity
                  onPress={() => setIsListView(false)}
                  className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-800 items-center justify-center border border-slate-100 dark:border-zinc-700 shadow-sm"
                >
                  <Icon name="map-marker-outline" size={22} color="#94a3b8" />
                </TouchableOpacity>
                <TouchableOpacity className="w-10 h-10 rounded-xl bg-white dark:bg-zinc-800 items-center justify-center border border-slate-100 dark:border-zinc-700 shadow-sm">
                  <Icon name="menu" size={22} color="#2EDE56" />
                </TouchableOpacity>
              </View>
            </View>


            <FlatList
              data={filteredLeads}
              keyExtractor={(job) => job._id}
              initialNumToRender={10}
              maxToRenderPerBatch={10}
              windowSize={5}
              removeClippedSubviews={Platform.OS === 'android'}
              contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
              renderItem={({ item: job }) => {
                const dateStr = job.installationDate
                  ? format(new Date(job.installationDate), 'MM/dd/yyyy')
                  : job.leadDate ? format(new Date(job.leadDate), 'MM/dd/yyyy')
                    : job.createdAt ? format(new Date(job.createdAt), 'MM/dd/yyyy') : 'N/A';

                const addressStr = typeof job.fullAddress === 'string' ? job.fullAddress :
                  (job.address && typeof job.address === 'object'
                    ? [job.address.houseNumber, job.address.streetName, job.address.city, job.address.state, job.address.zip].filter(Boolean).join(', ')
                    : 'N/A');

                 const isOwner = isJobOwner(job, user);

                return (
                  <TouchableOpacity
                    onPress={() => {
                      setJumpLead({ ...job });
                      setIsListView(false);
                    }}
                    activeOpacity={0.7}
                    className="bg-white dark:bg-zinc-900 rounded-[24px] mb-4 shadow-sm border border-slate-100 dark:border-zinc-800 overflow-hidden"
                    style={{
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.05,
                      shadowRadius: 10,
                      elevation: 2,
                    }}
                  >
                    <View className="p-5">
                      {/* Card Header */}
                      <View className="flex-row justify-between items-start mb-4">
                        <View className="bg-green-50 dark:bg-green-900/20 px-3 py-1.5 rounded-lg border border-green-100 dark:border-green-900/30">
                          <Text className="text-[13px] font-black text-[#2EDE56]">#{job.jobNumber}</Text>
                        </View>
                        {(() => {
                          const offlineBefore = getOfflineImagesForJob(job.jobNumber, 'before');
                          const offlineAfter = getOfflineImagesForJob(job.jobNumber, 'after');
                          const hasImages = (job.images?.beforeImages?.length > 0) || 
                                            (job.images?.afterImages?.length > 0) || 
                                            (offlineBefore.length > 0) || 
                                            (offlineAfter.length > 0);
                          return hasImages && (
                            <TouchableOpacity
                              onPress={() => {
                                setSelectedJob(job);
                                setShowGalleryModal(true);
                              }}
                              className="p-1"
                            >
                              <Icon name="image-multiple-outline" size={22} color="#2EDE56" />
                            </TouchableOpacity>
                          );
                        })()}
                      </View>

                      {/* Card Body - Grid Layout */}
                      <View className="flex-row mb-4">
                        <View className="flex-1">
                          <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Price</Text>
                          <View className="flex-row items-center">
                            <Text className="text-[#2EDE56] font-bold mr-1">$</Text>
                            <Text className="text-[17px] font-black text-slate-800 dark:text-zinc-200">
                              {(job.price || 0).toLocaleString()}
                            </Text>
                          </View>
                        </View>
                        <View className="flex-1">
                          <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Date</Text>
                          <View className="flex-row items-center">
                            <Icon name="calendar-check-outline" size={16} color="#2EDE56" />
                            <Text className="text-[14px] font-bold text-[#2EDE56] ml-1">
                              {dateStr}
                            </Text>
                          </View>
                        </View>
                      </View>

                      {/* Rep Footer */}
                      {isOwner && (
                        <View>
                          <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Rep</Text>
                          <View className="flex-row items-center">
                            <Icon name="account-circle-outline" size={18} color="#2EDE56" />
                            <Text className="text-[14px] font-bold text-slate-700 dark:text-zinc-300 ml-1">
                              {job.salesRep?.fullName || job.salesRep?.firstName || job.salesRepName || job.salesRep || job.userName || 'Unknown'}
                            </Text>
                          </View>
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          </SafeAreaView>
        )}
      </View>

      <MapFiltersModal
        visible={showFiltersModal}
        onClose={() => setShowFiltersModal(false)}
        filters={filters}
        onApply={(f) => setFilters(f)}
        onReset={() => setFilters({
          jobNumber: '',
          sortOrder: 'date-desc',
          radius: 0,
          minPrice: '',
          maxPrice: '',
          startDate: null,
          endDate: null,
          myJobsOnly: false,
          isFavoriteOnly: false,
          isReferralOnly: false,
          isHeatMap: false,
          showRoute: false,
          centerCoords: undefined,
          showProduct: true,
        })}
      />

      <MapGalleryModal
        visible={showGalleryModal}
        job={selectedJob}
        isMyJob={isJobOwner(selectedJob, user)}
        user={user}
        onClose={() => setShowGalleryModal(false)}
        onUploadSuccess={fetchLeads}
      />




      <ReferralModal
        visible={showReferralModal}
        onClose={() => setShowReferralModal(false)}
        selectedJob={selectedJob}
        isMyJob={isJobOwner(selectedJob, user)}
        onSuccess={(referralData) => {
          // ── 1. Instantly update the visible job card ──────────────────────
          let patchedJob: any = null;
          setSelectedJob((prev: any) => {
            if (!prev) return prev;
            const existingReferrals: any[] = prev.jobReferrals || [];
            const idx = existingReferrals.findIndex((r: any) => r._id === referralData._id);
            const updatedReferrals =
              idx >= 0
                ? existingReferrals.map((r: any) => (r._id === referralData._id ? referralData : r))
                : [referralData, ...existingReferrals];
            patchedJob = { ...prev, jobReferrals: updatedReferrals };
            return patchedJob;
          });

          // ── 2. Patch the full leads list so filters/map stay consistent ──
          setLeads((prev: any[]) =>
            prev.map((job: any) => {
              if (job._id !== selectedJob?._id) return job;
              const existingReferrals: any[] = job.jobReferrals || [];
              const idx = existingReferrals.findIndex((r: any) => r._id === referralData._id);
              const updatedReferrals =
                idx >= 0
                  ? existingReferrals.map((r: any) => (r._id === referralData._id ? referralData : r))
                  : [referralData, ...existingReferrals];
              return { ...job, jobReferrals: updatedReferrals };
            })
          );

          // ── 3. Patch React Query cache to keep it consistent ─────────────
          queryClient.setQueryData(queryKey, (old: any) => {
            if (!old) return old;
            return old.map((job: any) => {
              if (job._id !== selectedJob?._id) return job;
              const existingReferrals: any[] = job.jobReferrals || [];
              const idx = existingReferrals.findIndex((r: any) => r._id === referralData._id);
              const updatedReferrals =
                idx >= 0
                  ? existingReferrals.map((r: any) => (r._id === referralData._id ? referralData : r))
                  : [referralData, ...existingReferrals];
              return { ...job, jobReferrals: updatedReferrals };
            });
          });

          // Pass the patched job down to LeadMap so the selectedLead state there updates instantly
          if (patchedJob) {
            setUpdatedJob(patchedJob);
          }

          // ── 4. Background refetch to sync real server state ──────────────
          fetchLeads();
        }}
      />



      <BeforeAfterModal
        visible={showCameraModal}
        onClose={() => setShowCameraModal(false)}
        selectedJob={selectedJob}
        onUploadSuccess={fetchLeads}
      />

      {loading && !leads.length && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#4CBB17" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  }
});
