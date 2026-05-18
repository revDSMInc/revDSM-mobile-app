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

const { width, height } = Dimensions.get('window');

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
  const [centerCoords, setCenterCoords] = useState<{ latitude: number, longitude: number } | null>(null);
  const [sortOption, setSortOption] = useState<'price_asc' | 'price_desc' | 'date_asc' | 'date_desc'>('date_desc');
  const [showSortDropdown, setShowSortDropdown] = useState(false);

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
        Geolocation.requestAuthorization('whenInUse');
      } else {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      }

      Geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation(pos.coords);
        },
        (err) => console.log('Location error:', err),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    };

    requestLocation();
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [filters, userLocation]);

  const fetchLeads = async () => {
    if (!user?._id) return;
    try {
      setLoading(true);
      
      // Default to Tampa coordinates if user is elsewhere (web parity)
      const payload: any = {
        radiusInMiles: filters.radius || 50,
        isFavorite: filters.isFavoriteOnly,
        latitude: userLocation?.latitude || 27.9506, 
        longitude: userLocation?.longitude || -82.4572,
      };
      
      const res = await LeadService.findJobs(payload);
      const data = res.data?.data || [];
      setLeads(data);
    } catch (err) {
      console.error('[MapDetail] Fetch Leads Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredLeads = useMemo(() => {
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
      // Job Number / Search Text
      if (filters.jobNumber) {
        const search = filters.jobNumber.toLowerCase();
        const matchesJob = item.jobNumber?.toLowerCase().includes(search);
        const matchesAddress = item.fullAddress?.toLowerCase().includes(search);
        if (!matchesJob && !matchesAddress) return false;
      }

      // Favorites
      if (filters.isFavoriteOnly && !(item.isFavorite || item.isFavourite)) return false;

      // My Jobs Only
      if (filters.myJobsOnly) {
        const uid = user?._id || user?.id;
        const isMine = item.salesRepId === uid || item.userId === uid || item.salesRep?._id === uid;
        if (!isMine) return false;
      }

      // Price Range
      if (filters.minPrice && (item.price || 0) < parseFloat(filters.minPrice)) return false;
      if (filters.maxPrice && (item.price || 0) > parseFloat(filters.maxPrice)) return false;

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

    // Apply Sorting
    return result.sort((a, b) => {
      if (sortOption === 'price_asc') return (a.price || 0) - (b.price || 0);
      if (sortOption === 'price_desc') return (b.price || 0) - (a.price || 0);
      
      const timeA = new Date(a.installationDate || a.createdAt || 0).getTime();
      const timeB = new Date(b.installationDate || b.createdAt || 0).getTime();
      
      if (sortOption === 'date_asc') return timeA - timeB;
      return timeB - timeA; // date_desc
    });
  }, [leads, filters, sortOption]);

  // Automatic navigation to searched job or location (Web Parity)
  useEffect(() => {
    if (filters.centerCoords) {
      setCenterCoords(filters.centerCoords);
      setJumpLead(null); // Clear selected lead if we are jumping to a general area
    } else if (filters.jobNumber && filteredLeads.length > 0) {
      const search = filters.jobNumber.toLowerCase();
      const exactMatch = filteredLeads.find(l => l.jobNumber?.toLowerCase() === search);
      if (exactMatch) {
        setJumpLead(exactMatch);
      } else if (filteredLeads.length === 1) {
        setJumpLead(filteredLeads[0]);
      }
    }
  }, [filters.jobNumber, filteredLeads, filters.centerCoords]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#121212' : '#F4F6F8' }}>
      
      {/* Global Common Header with Map Tools */}
      <Header 
        onNavigate={(r) => navigation.navigate(r)} 
        onFilterPress={() => setShowFiltersModal(true)}
        onListPress={() => setIsListView(!isListView)}
      />

      <View style={{ flex: 1 }}>
        {isListView ? (
          <View style={{ flex: 1 }}>
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


            <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 100 }}>
              {filteredLeads.map((job) => {
                const dateStr = job.installationDate 
                  ? format(new Date(job.installationDate), 'MM/dd/yyyy')
                  : job.leadDate ? format(new Date(job.leadDate), 'MM/dd/yyyy')
                  : job.createdAt ? format(new Date(job.createdAt), 'MM/dd/yyyy') : 'N/A';
                
                const addressStr = typeof job.fullAddress === 'string' ? job.fullAddress : 
                  (job.address && typeof job.address === 'object' 
                    ? [job.address.houseNumber, job.address.streetName, job.address.city, job.address.state, job.address.zip].filter(Boolean).join(', ')
                    : 'N/A');
                  
                return (
                  <TouchableOpacity 
                    key={job._id}
                    onPress={() => {
                      setJumpLead(job);
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
                      <View>
                        <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Rep</Text>
                        <View className="flex-row items-center">
                          <Icon name="account-circle-outline" size={18} color="#2EDE56" />
                          <Text className="text-[14px] font-bold text-slate-700 dark:text-zinc-300 ml-1">
                            {job.salesRep?.fullName || job.salesRep?.firstName || job.salesRepName || job.salesRep || job.userName || 'Unknown'}
                          </Text>

                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : (
          <LeadMap 
            currentLead={centerCoords ?? jumpLead ?? currentLead} 
            fullScreen 
            leads={filteredLeads}
            isFavoriteFilter={filters.isFavoriteOnly}
            isReferralFilter={filters.isReferralOnly}
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
        onClose={() => setShowGalleryModal(false)}
        onCameraPress={(job) => {
          setSelectedJob(job);
          setShowCameraModal(true);
        }}
      />




      <ReferralModal
        visible={showReferralModal}
        onClose={() => setShowReferralModal(false)}
        selectedJob={selectedJob}
        onSuccess={fetchLeads}
        isMyJob={
          selectedJob && user && (
            selectedJob.salesRepId === user._id ||
            selectedJob.userId === user._id ||
            selectedJob.salesRep?._id === user._id ||
            selectedJob.salesRepName === user.fullName ||
            selectedJob.salesRep === user.userName
          )
        }
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
    </SafeAreaView>
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
