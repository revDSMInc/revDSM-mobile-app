import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  Dimensions,
  StatusBar,
  Alert,
  TextInput,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Heatmap as MapHeatmap, PROVIDER_GOOGLE, Callout } from 'react-native-maps';
const Heatmap = MapHeatmap as any;
import MapViewDirections from 'react-native-maps-directions';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Feather from 'react-native-vector-icons/Feather';
import Geolocation from 'react-native-geolocation-service';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useTheme } from '../../theme/ThemeProvider';
import { LeadService } from '../../services/api/leads';
import { useAuth } from '../../hooks/useAuth';
import { format } from 'date-fns';
import { MapJobCard } from '../../widgets/components/LeadCenter/MapJobCard';
import { ENV } from '../../config/env';
import { RootStackParamList } from '../../navigation';
import { ReferralModal } from '../../widgets/modals/ReferralModal';
import { launchCamera } from 'react-native-image-picker';
import { JobImageUploadModal } from '../../widgets/modals/JobImageUploadModal';
import { MapFiltersModal, FilterState } from '../../widgets/modals/MapFiltersModal';
import { Header } from '../../widgets/common/MainHeader';

const { width, height } = Dimensions.get('window');
const GOOGLE_MAPS_API_KEY = ENV.GOOGLE_MAPS_API_KEY;

export default function MapDetailScreen() {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'MapDetail'>>();
  const { currentLead } = route.params || {};
  const mapRef = useRef<MapView>(null);
  const markerRefs = useRef<{ [key: string]: any }>({});

  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<any>(null);
  const [selectedJob, setSelectedJob] = useState<any>(currentLead || null);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [showImageUploadModal, setShowImageUploadModal] = useState(false);
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [filters, setFilters] = useState<FilterState>({
    jobNumber: '',
    sortOrder: 'date-desc',
    radius: 50,
    minPrice: '',
    maxPrice: '',
    startDate: null,
    endDate: null,
    myJobsOnly: false,
    isHeatMap: false,
  });

  // Filters
  const [showRoute, setShowRoute] = useState(false);

  const [region, setRegion] = useState({
    latitude: currentLead?.location?.coordinates?.[1] || 27.9506,
    longitude: currentLead?.location?.coordinates?.[0] || -82.4572,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [isMapReady, setIsMapReady] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);

  useEffect(() => {
    console.log('[MapDetail] PROVIDER_GOOGLE constant:', PROVIDER_GOOGLE);
    const timer = setTimeout(() => {
      console.log('[MapDetail] Setting mapVisible to true');
      setMapVisible(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    console.log('[MapDetail] Mounting...');
    requestLocationPermission();
    fetchLeads();
  }, []);

  const requestLocationPermission = async () => {
    console.log('[MapDetail] Requesting location permission...');
    if (Platform.OS === 'ios') {
      const auth = await Geolocation.requestAuthorization('whenInUse');
      console.log('[MapDetail] iOS Auth Status:', auth);
      startTracking();
    } else {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      console.log('[MapDetail] Android Auth Status:', granted);
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        startTracking();
      }
    }
  };

  const startTracking = () => {
    console.log('[MapDetail] Starting location tracking...');
    Geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        console.log('[MapDetail] Current Position:', { latitude, longitude });
        setUserLocation({ latitude, longitude });
        if (!currentLead) {
          console.log('[MapDetail] Moving region to user location');
          setRegion((prev) => ({ ...prev, latitude, longitude }));
          mapRef.current?.animateToRegion(
            {
              latitude,
              longitude,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            },
            1000
          );
        }
      },
      (error) => console.error('[MapDetail] Geolocation Error:', error),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const fetchLeads = async () => {
    if (!user?._id) {
      console.log('[MapDetail] Skipping fetch: No user ID');
      return;
    }
    console.log('[MapDetail] Fetching leads with filters:', filters);
    try {
      setLoading(true);
      const payload: any = {
        radiusInMiles: filters.radius,
        isFavorite: false,
      };
      if (filters.jobNumber) payload.jobNumber = filters.jobNumber;
      if (filters.minPrice || filters.maxPrice) {
        payload.price = {};
        if (filters.minPrice) payload.price.min = Number(filters.minPrice);
        if (filters.maxPrice) payload.price.max = Number(filters.maxPrice);
      }
      if (filters.startDate || filters.endDate) {
        payload.dateRange = {
          start: filters.startDate,
          end: filters.endDate,
        };
      }
      if (userLocation) {
        payload.coordinates = [userLocation.longitude, userLocation.latitude];
      }
      
      console.log('[MapDetail] Search Payload:', payload);
      const res = await LeadService.findJobs(payload);
      const data = res.data?.data || [];
      console.log(`[MapDetail] Successfully fetched ${data.length} leads`);
      setLeads(data);
    } catch (err) {
      console.error('[MapDetail] Fetch Leads Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredLeads = useMemo(() => {
    let result = [...leads];

    if (filters.myJobsOnly && user?._id) {
      result = result.filter((l) => l.salesRepId === user._id || l.salesRep?._id === user._id);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (l) =>
          l.customerDetails?.firstName?.toLowerCase().includes(q) ||
          l.customerDetails?.lastName?.toLowerCase().includes(q) ||
          l.fullAddress?.toLowerCase().includes(q) ||
          l.jobNumber?.toLowerCase().includes(q)
      );
    }

    const currentSort = filters.sortOrder;
    if (currentSort) {
      result.sort((a, b) => {
        if (currentSort === 'price-asc') return (a.price || 0) - (b.price || 0);
        if (currentSort === 'price-desc') return (b.price || 0) - (a.price || 0);
        if (currentSort === 'date-asc')
          return (
            new Date(a.installationDate || 0).getTime() -
            new Date(b.installationDate || 0).getTime()
          );
        if (currentSort === 'date-desc')
          return (
            new Date(b.installationDate || 0).getTime() -
            new Date(a.installationDate || 0).getTime()
          );
        return 0;
      });
    }

    return result;
  }, [leads, filters.myJobsOnly, filters.sortOrder, user?._id, searchQuery]);

  const heatmapData = useMemo(() => {
    return filteredLeads
      .filter((l) => l.location?.coordinates && l.price)
      .map((l) => ({
        latitude: l.location.coordinates[1],
        longitude: l.location.coordinates[0],
        weight: Math.min((l.price || 0) / 15000, 1) || 0.5,
      }));
  }, [filteredLeads]);

  const [isListView, setIsListView] = useState(false);

  const handleMarkerPress = useCallback((job: any) => {
    setSelectedJob(job);

    // Log event like web
    if (user?._id) {
      LeadService.logEvent('click', {
        user_id: user._id,
        created_by: user._id,
        module_type: 'map_interaction',
        meta: {
          jobNumber: job.jobNumber,
          jobId: job._id,
          address: job.fullAddress,
          coordinates: job.location?.coordinates,
          price: job.price || 0,
          action: 'job_pin_selected',
        },
      });
    }

    const coords = job.location?.coordinates;
    if (coords) {
      mapRef.current?.animateToRegion(
        {
          latitude: coords[1] + 0.0007,
          longitude: coords[0],
          latitudeDelta: 0.002,
          longitudeDelta: 0.002,
        },
        1000
      );
      // Wait for animation then show callout
      setTimeout(() => {
        markerRefs.current[job.jobNumber]?.showCallout();
      }, 1100);
    }
  }, []);

  // Handle auto-open for currentLead from params
  useEffect(() => {
    if (currentLead && isMapReady) {
      handleMarkerPress(currentLead);
    }
  }, [currentLead, isMapReady]);

  const handleCameraPress = async (job: any) => {
    setSelectedJob(job);
    setShowImageUploadModal(true);
  };

  return (
    <View className="flex-1 bg-background">
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      <Header onNavigate={(route) => navigation.navigate(route)} />

      <View className="bg-background border-b border-border">
        <View className="px-4 py-3 flex-row justify-between items-center">
          <View className="flex-row items-center">
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              className="mr-3 p-1 items-center justify-center border border-border rounded-lg"
              style={{ width: 32, height: 32 }}
            >
              <Feather
                name="arrow-left"
                size={14}
                color={isDark ? colors.text : colors.textSecondary}
              />
            </TouchableOpacity>
            <Text className="text-lg font-black" style={{ color: colors.text }}>
              Sales Map
            </Text>
          </View>

          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={() => setShowFiltersModal(true)}
              className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 flex-row items-center"
            >
              <Icon name="filter-variant" size={16} color="#4CBB17" />
              <Text className="ml-1 text-xs font-bold text-green-600">Filters</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setIsListView(!isListView)}
              className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 flex-row items-center"
            >
              <Icon name={isListView ? 'map' : 'view-list'} size={16} color="#4CBB17" />
              <Text className="ml-1 text-xs font-bold text-green-600">
                {isListView ? 'Map' : 'List'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View className="flex-1">
        {isListView ? (
          <View className="flex-1 bg-surface px-4 pt-4">
            <View className="bg-card rounded-xl p-4 mb-4 shadow-sm border border-border">
              <Text className="text-[12px] font-bold text-text-secondary mb-2">Order By</Text>
              <TouchableOpacity className="flex-row justify-between items-center">
                <Text className="text-[16px] font-bold text-text-primary">Price Ascending</Text>
                <Icon name="chevron-down" size={20} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {filteredLeads.map((item) => (
                <TouchableOpacity
                  key={item._id}
                  onPress={() => {
                    setIsListView(false);
                    // Defer centering and opening callout to allow list to close
                    setTimeout(() => {
                      handleMarkerPress(item);
                    }, 300);
                  }}
                  className="bg-card rounded-2xl p-4 mb-4 shadow-sm border border-border"
                >
                  <View className="flex-row justify-between mb-4">
                    <View className="bg-green-50 dark:bg-green-900/20 px-3 py-1 rounded-lg">
                      <Text className="text-green-600 font-bold">#{item.jobNumber}</Text>
                    </View>
                  </View>

                  <View className="flex-row justify-between mb-3">
                    <View>
                      <Text className="text-[10px] font-bold text-text-secondary uppercase">
                        Price
                      </Text>
                      <Text className="text-[16px] font-black text-green-600">
                        ${(item.price || 0).toLocaleString()}
                      </Text>
                    </View>
                    <View>
                      <Text className="text-[10px] font-bold text-text-secondary uppercase text-right">
                        Date
                      </Text>
                      <View className="flex-row items-center">
                        <Icon name="calendar" size={14} color="#4CBB17" />
                        <Text className="text-[14px] font-bold text-text-primary ml-1">
                          {item.installationDate
                            ? format(new Date(item.installationDate), 'MM/dd/yyyy')
                            : 'N/A'}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View>
                    <Text className="text-[10px] font-bold text-text-secondary uppercase">Rep</Text>
                    <View className="flex-row items-center">
                      <Icon name="account" size={14} color="#4CBB17" />
                      <Text className="text-[14px] font-bold text-text-primary ml-1">sr</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              <View className="h-20" />
            </ScrollView>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {mapVisible && (
              <MapView
                ref={mapRef}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                style={styles.map}
                initialRegion={region}
                showsUserLocation={true}
                showsMyLocationButton={false}
                // customMapStyle={isDark ? darkMapStyle : []}
                onMapReady={() => {
                  console.log('[MapDetail] Map Ready Callback (Google Maps)');
                  setIsMapReady(true);
                }}
                onMapLoaded={() => {
                  console.log('[MapDetail] Map Loaded (Tiles Finished)');
                }}
                onRegionChangeComplete={(r) => {
                  console.log('[MapDetail] Region Change Complete:', r);
                }}
              >
                {/* Heatmap Layer */}
                {filters.isHeatMap && heatmapData.length > 0 && (
                  <Heatmap
                    points={heatmapData}
                    radius={Platform.OS === 'ios' ? 40 : 50}
                    opacity={0.6}
                    gradient={{
                      colors: ['#00B8D9', '#36B37E', '#FFAB00', '#FF5630', '#DE350B'],
                      startPoints: [0.1, 0.25, 0.5, 0.75, 1],
                      colorMapSize: 2048,
                    }}
                  />
                )}

                {/* Markers */}
                {!filters.isHeatMap &&
                  filteredLeads.map((job) => {
                    const coords = job.location?.coordinates;
                    if (!coords) return null;
                    const isActive = selectedJob?._id === job._id;
                    return (
                      <Marker
                        key={job._id}
                        ref={(el) => {
                          markerRefs.current[job.jobNumber] = el;
                        }}
                        coordinate={{ latitude: coords[1], longitude: coords[0] }}
                        onPress={() => handleMarkerPress(job)}
                        tracksViewChanges={Platform.OS === 'ios' ? isActive : false}
                      >
                        <View className="items-center justify-center">
                          <View
                            style={{
                              transform: [{ scale: isActive ? 1.4 : 1 }],
                            }}
                          >
                            <Icon
                              name={
                                job.isFavorite || job.isFavourite ? 'star-circle' : 'map-marker'
                              }
                              size={isActive ? 44 : 36}
                              color={job.isFavorite || job.isFavourite ? '#f59e0b' : '#4CBB17'}
                            />
                          </View>
                          {isActive && (
                            <View className="w-2 h-2 rounded-full bg-blue-500 border-2 border-white absolute -top-1 -right-1" />
                          )}
                        </View>
                        <Callout
                          tooltip={true}
                          onPress={() => navigation.navigate('LeadCenter', { lead: job })}
                        >
                          <View style={{ width: 320 }}>
                            <MapJobCard
                              job={job}
                              onClose={() => {
                                setSelectedJob(null);
                                markerRefs.current[job.jobNumber]?.hideCallout();
                              }}
                              isMyJob={user?._id === job.salesRep?._id}
                              onCameraPress={handleCameraPress}
                              onReferencePress={(j) => {
                                setSelectedJob(j);
                                setShowReferralModal(true);
                              }}
                            />
                          </View>
                        </Callout>
                      </Marker>
                    );
                  })}
              </MapView>
            )}

            {/* Map Controls */}
            <View className="absolute bottom-10 right-4 gap-3">
              <TouchableOpacity
                onPress={() => setFilters({ ...filters, isHeatMap: !filters.isHeatMap })}
                className="w-12 h-12 rounded-full bg-card shadow-lg items-center justify-center"
              >
                <Icon
                  name="fire"
                  size={24}
                  color={filters.isHeatMap ? '#ef4444' : isDark ? '#FFF' : '#666'}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={startTracking}
                className="w-12 h-12 rounded-full bg-green-500 shadow-lg items-center justify-center"
              >
                <Icon name="crosshairs-gps" size={24} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Loading Overlay */}

      {/* Loading Overlay */}
      {loading && !leads.length && (
        <View className="absolute inset-0 bg-black/10 items-center justify-center z-50">
          <ActivityIndicator size="large" color="#4CBB17" />
        </View>
      )}
      {showReferralModal && (
        <ReferralModal
          visible={showReferralModal}
          onClose={() => setShowReferralModal(false)}
          selectedJob={selectedJob}
        />
      )}
      {showImageUploadModal && (
        <JobImageUploadModal
          visible={showImageUploadModal}
          onClose={() => setShowImageUploadModal(false)}
          selectedJob={selectedJob}
        />
      )}
      {showFiltersModal && (
        <MapFiltersModal
          visible={showFiltersModal}
          onClose={() => setShowFiltersModal(false)}
          filters={filters}
          onApply={(newFilters) => {
            setFilters(newFilters);
            fetchLeads();
          }}
          onReset={() => {
            setFilters({
              jobNumber: '',
              sortOrder: 'date-desc',
              radius: 50,
              minPrice: '',
              maxPrice: '',
              startDate: null,
              endDate: null,
              myJobsOnly: false,
              isHeatMap: filters.isHeatMap,
            });
            fetchLeads();
          }}
        />
      )}
    </View>
  );
}

const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#121212' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#212121' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#757575' }] },
  { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#181818' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#000000' }] },
];

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
    width: width,
    height: height,
  },
});
