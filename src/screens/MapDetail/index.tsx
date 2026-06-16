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
} from 'react-native';
import Geolocation from 'react-native-geolocation-service';

import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { LeadService } from '../../services/api/leads';
import { useAuth } from '../../hooks/useAuth';
import { LeadMap } from '../../widgets/components/LeadCenter/LeadMap';
import { RootStackParamList } from '../../navigation';
import { Header } from '../../widgets/common/MainHeader';
import { MapFiltersModal, FilterState } from '../../widgets/modals/MapFiltersModal';
import { MapGalleryModal } from '../../widgets/components/LeadCenter/MapGalleryModal';
import { ReferralModal } from '../../widgets/modals/ReferralModal';
import { BeforeAfterModal } from '../../widgets/modals/BeforeAfterModal';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { format } from 'date-fns';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashMessage } from '../../config/message';
import { useQuery, useQueryClient } from '@tanstack/react-query';

const { width, height } = Dimensions.get('window');

const isJobOwner = (item: any, uid: string | undefined): boolean => {
  if (!uid || !item) return false;
  return !!(
    item.salesRepId === uid ||
    item.salesRep === uid ||
    (item.salesRep && typeof item.salesRep === 'object' && item.salesRep._id === uid) ||
    (item.salesRep && typeof item.salesRep === 'object' && item.salesRep.id === uid) ||
    item.assignedRepId === uid ||
    (item.assignedRep && typeof item.assignedRep === 'object' && item.assignedRep._id === uid) ||
    (item.assignedRep && typeof item.assignedRep === 'object' && item.assignedRep.id === uid)
  );
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

  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [showGalleryModal, setShowGalleryModal] = useState(false);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number, longitude: number } | null>(null);

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
  });

  const [isListView, setIsListView] = useState(false);
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
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
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

  const { data: queryLeads, isLoading: queryLoading, refetch: refetchQuery } = useQuery({
    queryKey: ['mapJobs', latKey, lngKey, radiusVal],
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
        const search = filters.jobNumber.toLowerCase();
        const matchesJob = item.jobNumber?.toLowerCase().includes(search);
        const matchesAddress = item.fullAddress?.toLowerCase().includes(search);
        if (!matchesJob && !matchesAddress) return false;
      }

      // Referral Filter (match web app logic)
      if (filters.isReferralOnly) {
        const uid = user?._id || user?.id;
        const isMine = isJobOwner(item, uid);
        const hasReferrals = item.jobReferrals && item.jobReferrals.length > 0;
        if (!hasReferrals) return false;

        if (!isMine) {
          const activeToggle = item.jobReferrals[0]?.referralToggle === true || item.jobReferrals[0]?.referralToggle === 'true';
          if (!activeToggle) return false;
        }
      }

      // My Jobs Only
      if (filters.myJobsOnly) {
        const uid = user?._id || user?.id;
        const isMine = isJobOwner(item, uid);
        console.log('[MapDetail DEBUG] MyJobsOnly check for job:', item.jobNumber, 'user uid:', uid, 'isMine:', isMine);
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

    console.log('[MapDetail DEBUG] Recalculated filteredLeads. final count:', result.length);
    return result;
  }, [leads, filters, user]);

  const filteredLeads = useMemo(() => {
    // Apply Sorting
    return [...baseFilteredLeads].sort((a, b) => {
      if (sortOption === 'price_asc') return (a.price || 0) - (b.price || 0);
      if (sortOption === 'price_desc') return (b.price || 0) - (a.price || 0);
      
      const timeA = new Date(a.installationDate || a.createdAt || 0).getTime();
      const timeB = new Date(b.installationDate || b.createdAt || 0).getTime();
      
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
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <SafeAreaView edges={['top']} style={{ backgroundColor: '#ffffff' }}>
        <Header 
          onNavigate={(r) => navigation.navigate(r)} 
          onFilterPress={() => setShowFiltersModal(true)}
          onListPress={() => setIsListView(!isListView)}
        />
      </SafeAreaView>

      <View style={{ flex: 1 }}>
        <LeadMap 
          currentLead={centerCoords ?? currentLead} 
          focusLead={jumpLead}
          fullScreen 
          leads={filteredLeads}
          isFavoriteFilter={filters.isFavoriteOnly}
          isReferralFilter={filters.isReferralOnly}
          isMyJobsFilter={filters.myJobsOnly}
          isHeatMapFilter={filters.isHeatMap}
          onToggleFilter={(type) => {
            setFilters((prev) => {
              if (type === 'heatmap') return { ...prev, isHeatMap: !prev.isHeatMap };
              if (type === 'myjobs') return { ...prev, myJobsOnly: !prev.myJobsOnly };
              if (type === 'referral') return { ...prev, isReferralOnly: !prev.isReferralOnly };
              return prev;
            });
          }}
          onGalleryPress={(job) => {
            setSelectedJob(job);
            setShowGalleryModal(true);
          }}
          onCameraPress={(job) => {
            setSelectedJob(job);
            setShowCameraModal(true);
          }}
          onReferencePress={(job) => {
            setSelectedJob(job);
            setShowReferralModal(true);
          }}
        />

        {isListView && (
          <SafeAreaView edges={['bottom']} style={[StyleSheet.absoluteFill, { backgroundColor: isDark ? '#121212' : '#F4F6F8' ,zIndex:10000}]}>
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

                const isOwner = isJobOwner(job, user?._id || user?.id);
                  
                return (
                  <TouchableOpacity 
                    onPress={() => {
                      setJumpLead({...job});
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
                        {(job.images?.beforeImages?.length > 0 || job.images?.afterImages?.length > 0) && (
                          <TouchableOpacity 
                            onPress={() => {
                              setSelectedJob(job);
                              setShowGalleryModal(true);
                            }}
                            className="p-1"
                          >
                            <Icon name="image-multiple-outline" size={22} color="#2EDE56" />
                          </TouchableOpacity>
                        )}
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
        })}
      />

      <MapGalleryModal
        visible={showGalleryModal}
        job={selectedJob}
        isMyJob={isJobOwner(selectedJob, user?._id || user?.id)}
        onClose={() => setShowGalleryModal(false)}
        onUploadSuccess={fetchLeads}
      />




      <ReferralModal
        visible={showReferralModal}
        onClose={() => setShowReferralModal(false)}
        selectedJob={selectedJob}
        onSuccess={fetchLeads}
        isMyJob={isJobOwner(selectedJob, user?._id || user?.id)}
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
