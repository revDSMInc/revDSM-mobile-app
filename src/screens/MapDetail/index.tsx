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
  ScrollView,
} from 'react-native';
import MapView, { Marker, Heatmap as MapHeatmap, PROVIDER_GOOGLE } from 'react-native-maps';
const Heatmap = MapHeatmap as any;
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
import MapViewDirections from 'react-native-maps-directions';

const GOOGLE_MAPS_API_KEY = ENV.GOOGLE_MAPS_API_KEY;
import { RootStackParamList } from '../../navigation';
import { ReferralModal } from '../../widgets/modals/ReferralModal';
import { BeforeAfterModal } from '../../widgets/modals/BeforeAfterModal';
import { MapFiltersModal, FilterState } from '../../widgets/modals/MapFiltersModal';
import { Header } from '../../widgets/common/MainHeader';
import { Callout } from 'react-native-maps';
import Svg, { Path } from 'react-native-svg';

const { width, height } = Dimensions.get('window');

import { MapToggleSwitch } from '../../widgets/common/MapToggleSwitch';

export default function MapDetailScreen() {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'MapDetail'>>();
  const { currentLead } = route.params || {};
  const mapRef = useRef<MapView>(null);
  const isInternalMove = useRef(false);

  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [userLocation, setUserLocation] = useState<any>(null);
  const [selectedJob, setSelectedJob] = useState<any>(null);
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
    showRoute: false,
  });

  const [region, setRegion] = useState({
    latitude: currentLead?.location?.coordinates?.[1] || 27.9506,
    longitude: currentLead?.location?.coordinates?.[0] || -82.4572,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  });

  const [isMapReady, setIsMapReady] = useState(false);
  const [mapVisible, setMapVisible] = useState(false);
  const [isListView, setIsListView] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMapVisible(true);
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    requestLocationPermission();
    fetchLeads();
  }, []);

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') {
      await Geolocation.requestAuthorization('whenInUse');
      startTracking();
    } else {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        startTracking();
      }
    }
  };

  const startTracking = () => {
    Geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ latitude, longitude });
        if (!currentLead) {
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
    if (!user?._id) return;
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
    if (filters.myJobsOnly && user?._id) {
      result = result.filter((l) => l.salesRepId === user._id || l.salesRep?._id === user._id);
    }
    // Filter out jobs starting from TAM30000 - TAM30032 (Web parity)
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
  }, [leads, filters.myJobsOnly, filters.sortOrder, user?._id]);

  const toggleFilter = (key: 'myJobsOnly' | 'isHeatMap' | 'showRoute') => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key as keyof FilterState] }));
  };

  const heatmapData = useMemo(() => {
    return filteredLeads
      .filter((l) => l.location?.coordinates && l.price)
      .map((l) => ({
        latitude: l.location.coordinates[1],
        longitude: l.location.coordinates[0],
        weight: Math.min((l.price || 0) / 15000, 1) || 0.5,
      }));
  }, [filteredLeads]);

 
  const handleMarkerPress = useCallback(
    (job: any) => {
      console.log('[MapDetail] Marker Pressed:', job.jobNumber);
      setSelectedJob(job);

    isInternalMove.current = true;
    mapRef.current?.animateCamera(
      {
        center: {
          latitude: job.location.coordinates[1] + 0.005, // Larger offset to center the modal
          longitude: job.location.coordinates[0],
        },
        zoom: 16,
        pitch: 0,
        heading: 0,
      },
      { duration: 800 }
    );
    // Reset flag after animation completes
    setTimeout(() => {
      isInternalMove.current = false;
    }, 1000);

      if (user?._id) {
        LeadService.logEvent('click', {
          user_id: user._id,
          created_by: user._id,
          module_type: 'map_interaction',
          meta: {
            jobNumber: job.jobNumber,
            jobId: job._id,
            action: 'job_pin_selected',
          },
        });
      }
    },
    [user?._id]
  );

  useEffect(() => {
    if (currentLead && isMapReady) {
      handleMarkerPress(currentLead);
    }
  }, [currentLead, isMapReady]);

  const handleZoom = (type: 'in' | 'out') => {
    mapRef.current?.getCamera().then((camera) => {
      const zoomLevel = camera.zoom || 10;
      mapRef.current?.animateCamera({
        zoom: type === 'in' ? zoomLevel + 1 : zoomLevel - 1,
      });
    });
  };

  return (
    <View style={{ flex: 1, backgroundColor: isDark ? '#121212' : '#F4F6F8' }}>
      <StatusBar barStyle="light-content" />

      <View
        className="flex-row items-center justify-between px-4 py-3"
        style={{
          backgroundColor: isDark ? '#1C252E' : '#101828',
          paddingTop: Platform.OS === 'ios' ? 50 : 10,
        }}
      >
        <TouchableOpacity
          onPress={() => navigation.navigate('Leads')}
          className="flex-row items-center"
        >
          <Text className="text-[22px] font-black text-green-400">rev</Text>
          <Text className="text-[22px] font-black text-white">DSM</Text>
        </TouchableOpacity>

        <View className="flex-row items-center gap-1.5">
          <TouchableOpacity
            onPress={() => setShowFiltersModal(true)}
            className="w-8 h-8 bg-green-500 rounded-lg items-center justify-center"
          >
            <Icon name="filter-variant" size={18} color="white" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setIsListView(!isListView)}
            className="w-8 h-8 bg-green-500 rounded-lg items-center justify-center"
          >
            <Icon
              name={isListView ? 'map-outline' : 'format-list-bulleted'}
              size={18}
              color="white"
            />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => navigation.navigate('Chat')}
            className="w-8 h-8 bg-green-500 rounded-full items-center justify-center"
          >
            <Icon name="message-outline" size={16} color="white" />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {}}
            className="w-8 h-8 bg-slate-400 rounded-full items-center justify-center border border-white/20"
          >
            <Icon name="account" size={18} color="white" />
          </TouchableOpacity>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        {isListView ? (
          <View style={{ flex: 1, backgroundColor: isDark ? '#121212' : '#F4F6F8' }}>
            <View className="p-3 flex-row justify-between items-center bg-white dark:bg-zinc-900 border-b border-slate-100 dark:border-zinc-800">
              <View className="flex-row items-center">
                <View className="px-3 py-1 bg-green-50 rounded-lg">
                  <Text className="text-[12px] font-black text-green-600">
                    Job List ({filteredLeads.length})
                  </Text>
                </View>
              </View>
              <View className="flex-row items-center gap-2">
                <TouchableOpacity
                  onPress={() => setShowFiltersModal(true)}
                  className="w-9 h-9 bg-green-600 rounded-lg items-center justify-center"
                >
                  <Icon name="filter-variant" size={18} color="white" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setIsListView(false)}
                  className="w-9 h-9 bg-green-600 rounded-lg items-center justify-center"
                >
                  <Icon name="map-outline" size={18} color="white" />
                </TouchableOpacity>
              </View>
            </View>
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ padding: 12 }}
            >
              {filteredLeads.map((item) => (
                <TouchableOpacity
                  key={item._id}
                  onPress={() => {
                    setIsListView(false);
                    setTimeout(() => handleMarkerPress(item), 300);
                  }}
                  className="bg-white dark:bg-zinc-900 rounded-[20px] p-4 mb-3 border border-slate-100 dark:border-zinc-800 shadow-sm"
                >
                  <View className="flex-row justify-between items-center mb-3">
                    <View className="px-3 py-0.5 bg-green-50 dark:bg-green-900/30 rounded-lg">
                      <Text className="text-[11px] font-black text-green-600">
                        #{item.jobNumber}
                      </Text>
                    </View>
                    <Icon name="image-outline" size={16} color="#94a3b8" />
                  </View>

                  <View className="flex-row justify-between">
                    <View>
                      <Text className="text-[10px] font-bold text-slate-400 mb-0.5">Price</Text>
                      <Text className="text-[15px] font-black text-green-600">
                        ${(item.price || 0).toLocaleString()}
                      </Text>
                    </View>
                    <View>
                      <Text className="text-[10px] font-bold text-slate-400 mb-0.5">Date</Text>
                      <View className="flex-row items-center">
                        <Icon name="calendar-outline" size={12} color="#3b82f6" />
                        <Text className="text-[12px] font-bold text-slate-700 dark:text-slate-300 ml-1">
                          {item.installationDate
                            ? format(new Date(item.installationDate), 'MM/dd/yyyy')
                            : 'N/A'}
                        </Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
              <View style={{ height: 100 }} />
            </ScrollView>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {mapVisible && (
              <>
                <MapView
                ref={mapRef}
                provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
                style={StyleSheet.absoluteFillObject}
                customMapStyle={isDark ? darkMapStyle : []}
                initialRegion={region}
                showsUserLocation={false}
                showsMyLocationButton={false}
                onMapReady={() => setIsMapReady(true)}
                onRegionChangeStart={() => {
                  if (!isInternalMove.current) {
                    setSelectedJob(null);
                  }
                }}
                onPress={() => {
                  setSelectedJob(null);
                }}
              >
                {filters.isHeatMap && heatmapData.length > 0 && (
                  <Heatmap
                    points={heatmapData}
                    radius={Platform.OS === 'ios' ? 40 : 50}
                    opacity={0.6}
                    gradient={{
                      colors: ['#74c0ff', '#0072ff', '#00c853', '#ffab00', '#ff6d00', '#d50000'],
                      startPoints: [0.1, 0.3, 0.5, 0.7, 0.85, 1],
                      colorMapSize: 2048,
                    }}
                  />
                )}

                {filters.showRoute && userLocation && selectedJob && (
                  <MapViewDirections
                    origin={userLocation}
                    destination={{
                      latitude: selectedJob.location.coordinates[1],
                      longitude: selectedJob.location.coordinates[0],
                    }}
                    apikey={GOOGLE_MAPS_API_KEY}
                    strokeWidth={4}
                    strokeColor="#3b82f6"
                    lineDashPattern={[0]}
                  />
                )}

                {!filters.isHeatMap &&
                  filteredLeads.map((job) => {
                    const coords = job.location?.coordinates;
                    if (!coords) return null;
                    const hasImages =
                      (job?.images?.beforeImages?.length || 0) > 0 ||
                      (job?.images?.afterImages?.length || 0) > 0;

                    return (
                      <Marker
                        key={job._id || job.jobNumber}
                        coordinate={{
                          latitude: job.location.coordinates[1],
                          longitude: job.location.coordinates[0],
                        }}
                        onPress={() => handleMarkerPress(job)}
                        onSelect={() => handleMarkerPress(job)}
                        anchor={{ x: 0.5, y: 1 }}
                        calloutAnchor={{ x: 0.5, y: 0.2 }}
                        tracksViewChanges={true}
                        zIndex={selectedJob?._id === job._id ? 999 : 1}
                      >
                        <View style={{ alignItems: 'center', width: 34, height: 44 }} collapsable={false}>
                          <Svg width={32} height={40} viewBox="0 0 38 48">
                            <Path
                              d="M19 0C8.5 0 0 8.5 0 19C0 32.5 19 48 19 48C19 48 38 32.5 38 19C38 8.5 29.5 0 19 0Z"
                              fill={job.isFavorite || job.isFavourite ? '#f59e0b' : '#4CBB17'}
                              stroke="white"
                              strokeWidth={2}
                            />
                            <Path
                              d="M19 28C24 28 28 24 28 19C28 14 24 10 19 10C14 10 10 14 10 19C10 24 14 28 19 28Z"
                              fill="white"
                              fillOpacity={0.3}
                            />
                          </Svg>

                          <View className="absolute top-1.5 items-center justify-center">
                            <Icon
                              name={job.isFavorite || job.isFavourite ? 'star' : 'map-marker'}
                              size={14}
                              color="white"
                            />
                          </View>

                          {hasImages && (
                            <View
                              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white items-center justify-center shadow-md border border-slate-100"
                              style={{ zIndex: 5 }}
                            >
                              <Icon name="camera" size={11} color="#3b82f6" />
                            </View>
                          )}
                        </View>

                      </Marker>
                    );
                  })}
              </MapView>
 
              {selectedJob && (
                <View 
                  className="absolute top-0 left-0 right-0 bottom-0 pointer-events-box-none items-center justify-center"
                  pointerEvents="box-none"
                  style={{ zIndex: 1000 }}
                >
                  <View style={{ width: 260, height: 360, marginTop: -60 }}>
                    <View
                      style={{
                        backgroundColor: 'white',
                        borderRadius: 24,
                        overflow: 'hidden',
                        borderWidth: 1,
                        borderColor: '#f1f5f9',
                        height: 320,
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 10 },
                        shadowOpacity: 0.2,
                        shadowRadius: 20,
                        elevation: 20,
                      }}
                    >
                        <MapJobCard
                          job={selectedJob}
                          onClose={() => setSelectedJob(null)}
                          isMyJob={user?._id === (selectedJob.salesRepId || selectedJob.salesRep?._id)}
                          onReferencePress={() => setShowReferralModal(true)}
                          onCameraPress={() => setShowImageUploadModal(true)}
                          onGalleryPress={() => {
                            setSelectedJob(null);
                            navigation.navigate('LeadCenter', { lead: selectedJob });
                          }}
                        />
                    </View>
                    
                    {/* Fixed Arrow Triangle */}
                    <View className="items-center">
                      <View
                        style={{
                          width: 0,
                          height: 0,
                          backgroundColor: 'transparent',
                          borderStyle: 'solid',
                          borderLeftWidth: 12,
                          borderRightWidth: 12,
                          borderTopWidth: 15,
                          borderLeftColor: 'transparent',
                          borderRightColor: 'transparent',
                          borderTopColor: 'white',
                          marginTop: -1,
                        }}
                      />
                    </View>
                  </View>
                </View>
                      )}
                      

            {/* Right Controls Container */}
            <View
              style={{
                position: 'absolute',
                right: 15,
                bottom: 30,
                gap: 10,
                zIndex: 10,
                alignItems: 'center',
              }}
            >
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                className="w-10 h-10 rounded-full bg-green-600 items-center justify-center shadow-lg mb-2"
              >
                <Icon name="arrow-left" size={20} color="white" />
              </TouchableOpacity>

              {/* Toggle Switches */}
              <View className="items-center bg-white/10 rounded-2xl p-1">
                <MapToggleSwitch
                  value={filters.myJobsOnly}
                  onValueChange={() => toggleFilter('myJobsOnly')}
                  activeLabel="RF"
                  inactiveLabel="DEF"
                />
                <MapToggleSwitch
                  value={filters.isHeatMap}
                  onValueChange={() => toggleFilter('isHeatMap')}
                  activeLabel="AJ"
                  inactiveLabel="AJ"
                />
                <MapToggleSwitch
                  value={filters.showRoute}
                  onValueChange={() => toggleFilter('showRoute')}
                  activeLabel="RF"
                  inactiveLabel="DEF"
                />
              </View>

              <TouchableOpacity
                onPress={startTracking}
                className="w-12 h-12 rounded-full bg-green-600 items-center justify-center shadow-lg mt-2"
              >
                <Icon name="target" size={24} color="white" />
              </TouchableOpacity>

              {/* Zoom Controls */}
              <View className="bg-white rounded-xl shadow-lg border border-slate-100 overflow-hidden mt-2">
                <TouchableOpacity
                  onPress={() => handleZoom('in')}
                  className="w-10 h-10 items-center justify-center border-b border-slate-100"
                >
                  <Icon name="plus" size={20} color="#64748b" />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleZoom('out')}
                  className="w-10 h-10 items-center justify-center"
                >
                  <Icon name="minus" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>
            </View>


        </>
      )}
    </View>
  )}
</View>

      <ReferralModal
        visible={showReferralModal}
        onClose={() => setShowReferralModal(false)}
        selectedJob={selectedJob}
      />
      <BeforeAfterModal
        visible={showImageUploadModal}
        onClose={() => setShowImageUploadModal(false)}
        selectedJob={selectedJob}
        onUploadSuccess={fetchLeads}
      />
      <MapFiltersModal
        visible={showFiltersModal}
        onClose={() => setShowFiltersModal(false)}
        filters={filters}
        onApply={(f) => {
          setFilters(f);
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
            isHeatMap: false,
            showRoute: false,
          });
          fetchLeads();
        }}
      />

      {loading && !leads.length && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: 'rgba(0,0,0,0.1)',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
            },
          ]}
        >
          <ActivityIndicator size="large" color="#4CBB17" />
        </View>
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
  absoluteControl: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
});
