import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  StyleSheet,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  Alert,
  Image,
  Modal,
} from 'react-native';

import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Heatmap, Callout } from 'react-native-maps';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Geolocation from 'react-native-geolocation-service';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { useLeadsData } from '../../../hooks/useLeadsData';
import { LeadService } from '../../../services/api/leads';
import { ENV } from '../../../config/env';
import { MapJobCard } from './MapJobCard';
import { useAuth } from '../../../hooks/useAuth';
import { MapGalleryModal } from './MapGalleryModal';
import { MapToggleSwitch } from '../../common/MapToggleSwitch';
import { JobImageUploadModal } from '../../modals/JobImageUploadModal';
import { ReferralModal } from '../../modals/ReferralModal';



const markerImg = require('../../../assets/images/map/marker.png');

const { width, height } = Dimensions.get('window');

// STATIC TAMPA DATA
const TAMPA_COORDS = {
  latitude: 27.9506,
  longitude: -82.4572,
};

interface LeadMapProps {
  currentLead?: any;
  fullScreen?: boolean;
  onGalleryPress?: (job: any) => void;
  onCameraPress?: (job: any) => void;
  onReferencePress?: (job: any) => void;
  leads?: any[];
  isFavoriteFilter?: boolean;
  isReferralFilter?: boolean;
}

export const LeadMap = ({
  currentLead,
  fullScreen = false,
  onGalleryPress,
  onCameraPress,
  onReferencePress,
  leads: externalLeads,
  isFavoriteFilter,
  isReferralFilter,
}: LeadMapProps) => {

  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const [isFetching, setIsFetching] = useState(false);
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);
  const isInternalMove = useRef(false);

  // ─── Data source ─────────────────────────────────────────────────────────
  // `internalLeads` is only used when no externalLeads prop is provided
  // (standalone LeadMap without MapDetail). When MapDetail passes `leads`,
  // we use that directly — synchronously — with NO intermediate setState.
  // This eliminates the async render gap that caused phantom duplicate markers.
  const [internalLeads, setInternalLeads] = useState<any[]>([]);
  const [dataVersion, setDataVersion] = useState(0); // increments on every data refresh

  const allLeads: any[] = externalLeads ?? internalLeads;

  const fetchAllJobs = async () => {
    try {
      setIsFetching(true);
      const res = await LeadService.findJobs({});
      const jobs = res.data?.data || [];
      setInternalLeads(jobs);
      setDataVersion((v) => v + 1); // force marker remount after data refresh

      // Refresh active selections to show new images/referrals immediately
      if (selectedLead?._id) {
        const updated = jobs.find((j: any) => j._id === selectedLead._id);
        if (updated) setSelectedLead(updated);
      }
      if (galleryJob?._id) {
        const updated = jobs.find((j: any) => j._id === galleryJob._id);
        if (updated) setGalleryJob(updated);
      }
    } catch (error) {
      console.error('Failed to fetch jobs for map', error);
    } finally {
      setIsFetching(false);
    }
  };

  // When externalLeads change (MapDetail refreshed data after referral/gallery action),
  // bump the version so markers remount fresh and tintColors update.
  useEffect(() => {
    if (externalLeads) {
      setDataVersion((v) => v + 1);
    } else {
      // Standalone mode — fetch our own data
      fetchAllJobs();
    }
  }, [externalLeads]);


  const [userLocation, setUserLocation] = useState<any>(null);
  const markerPressedRef = useRef(false);
  const [isHeatMap, setIsHeatMap] = useState(false);
  const [showRoute, setShowRoute] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<any[]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryJob, setGalleryJob] = useState<any>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [activeFilters, setActiveFilters] = useState(['DEF-0', 'AJ-1', 'DEF-3']);

  const [region, setRegion] = useState({
    ...TAMPA_COORDS,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });
  const currentRegion = useRef(region);

  const { isHeatMapActive, isMyJobsOnly, isReferralOnly, isFavoriteOnly } = useMemo(() => ({
    isHeatMapActive: activeFilters.includes('HT-0'),
    isMyJobsOnly: activeFilters.includes('MJ-1'),
    // Respect both the internal map toggle (RF-2) AND the external filter prop from MapFiltersModal
    isReferralOnly: activeFilters.includes('RF-2') || !!isReferralFilter,
    isFavoriteOnly: activeFilters.includes('FV-3') || !!isFavoriteFilter,
  }), [activeFilters, isFavoriteFilter, isReferralFilter]);

  // ─── filteredLeads is synchronous (useMemo) ───────────────────────────────
  // CRITICAL: Do NOT use useState + useEffect here. Two async state updates
  // (allLeads → filteredLeads) cause React Native Maps to render markers in two
  // passes, creating phantom duplicate markers that can't be tapped.
  const filteredLeads = useMemo(() => {
    let result = [...allLeads];

    result = result.filter((item: any) => {
      // 1. TAM Range Filter (Excludes TAM30000-30032)
      const jobNumber = item?.jobNumber;
      if (typeof jobNumber === 'string' && jobNumber.startsWith('TAM')) {
        const num = parseInt(jobNumber.substring(3), 10);
        if (num >= 30000 && num <= 30032) return false;
      }

      // 2. Favorite Filter
      if (isFavoriteOnly && !(item.isFavorite || item.isFavourite)) return false;

      // 3. My Jobs Filter (map toggle only — skip if external leads already filtered by MapDetail)
      if (isMyJobsOnly && !externalLeads) {
        const uid = (user as any)?._id || (user as any)?.id;
        const isOwner = !!uid && (
          item.salesRepId === uid ||
          item.salesRep?._id === uid ||
          item.userId === uid ||
          item.salesRep === uid ||
          item.salesRepName === (user as any)?.fullName ||
          item.salesRepName === (user as any)?.firstName ||
          item.salesRep === (user as any)?.userName ||
          item.userName === (user as any)?.userName
        );
        if (!isOwner) return false;
      }

      // 4. Reference Filter
      if (isReferralOnly) {
        const hasReference = item.jobReferrals?.some((r: any) => r.referralToggle === true);
        if (!hasReference) return false;
      }

      return true;
    });

    return result;
  }, [allLeads, user, isMyJobsOnly, isReferralOnly, isFavoriteOnly, externalLeads]);

  // Sync heatmap state when toggle changes
  useEffect(() => {
    if (isHeatMap !== isHeatMapActive) setIsHeatMap(isHeatMapActive);
  }, [isHeatMapActive]);

  // filterKey changes on every filter toggle OR data refresh.
  // This forces a clean remount of ALL markers, which:
  //   (a) eliminates stale tintColor (yellow staying after filter off)
  //   (b) prevents phantom duplicates from prior async renders
  const filterKey = `${isFavoriteOnly}-${isReferralOnly}-${isMyJobsOnly}-${isHeatMapActive}-${dataVersion}`;


  useEffect(() => {
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') {
      try {
        const auth = await Geolocation.requestAuthorization('whenInUse');
        startTracking();
      } catch (err) {
        console.log('Error requesting iOS location permission:', err);
        startTracking();
      }
    } else {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      if (granted === PermissionsAndroid.RESULTS.GRANTED) {
        startTracking();
      }
    }
  };

  useEffect(() => {
    if (currentLead?.location?.coordinates) {
      const coords = currentLead.location.coordinates;
      mapRef.current?.animateToRegion({
        latitude: coords[1],
        longitude: coords[0],
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }, 1000);
    } else if (currentLead?.latitude && currentLead?.longitude) {
      // Handle direct coordinate objects — used for location search navigation from MapFiltersModal
      mapRef.current?.animateToRegion({
        latitude: currentLead.latitude,
        longitude: currentLead.longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }, 800);
    }
  }, [currentLead]);

  const startTracking = () => {
    const successCallback = (position: any) => {
      const { latitude, longitude } = position.coords;
      setUserLocation({ latitude, longitude });

      mapRef.current?.animateToRegion({
        latitude,
        longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      });
    };

    const errorCallback = (error: any) => {
      console.log('High accuracy location failed, falling back to low accuracy:', error);
      Geolocation.getCurrentPosition(
        successCallback,
        (err) => console.log('Low accuracy location failed:', err),
        { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 }
      );
    };

    // Try high accuracy first, but timeout after 5 seconds to fallback to low accuracy
    Geolocation.getCurrentPosition(
      successCallback,
      errorCallback,
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
    );
  };

  const [selectedLeadPoint, setSelectedLeadPoint] = useState<{ x: number, y: number } | null>(null);

  const updateSelectedPoint = async () => {
    if (selectedLead?.location?.coordinates && mapRef.current) {
      try {
        const point = await mapRef.current.pointForCoordinate({
          latitude: selectedLead.location.coordinates[1],
          longitude: selectedLead.location.coordinates[0],
        });
        setSelectedLeadPoint(point);
      } catch (e) {
        console.log('Error getting point:', e);
      }
    } else {
      setSelectedLeadPoint(null);
    }
  };

  useEffect(() => {
    // Initial update
    updateSelectedPoint();
    // Retry after animation stabilization
    const timer = setTimeout(updateSelectedPoint, 500);
    return () => clearTimeout(timer);
  }, [selectedLead]);

  const handleToggleFavorite = async (job: any) => {
    const nextValue = !(job.isFavourite || job.isFavorite);
    try {
      await LeadService.toggleFavourite(job._id, nextValue);

      // Optimistic update: mutate internalLeads if we own the data,
      // or bump dataVersion to force a remount when using externalLeads.
      if (!externalLeads) {
        setInternalLeads((prev: any[]) =>
          prev.map((l) =>
            l._id === job._id ? { ...l, isFavourite: nextValue, isFavorite: nextValue } : l
          )
        );
      }
      // Always bump version so filterKey changes → markers remount → tintColor resets
      setDataVersion((v) => v + 1);

      if (selectedLead && selectedLead._id === job._id) {
        setSelectedLead({
          ...selectedLead,
          isFavourite: nextValue,
          isFavorite: nextValue,
        });
      }
    } catch (error) {
      console.error('Failed to toggle favorite', error);
    }
  };



  const handleMarkerClick = (lead: any, event?: any) => {
    markerPressedRef.current = true;
    if (event && event.stopPropagation) {
      event.stopPropagation();
    }
    
    const coords = lead.location?.coordinates;
    if (!coords) return;

    if (selectedLead?._id === lead._id) {
       setSelectedLead(null);
    } else {
       setSelectedLead(lead);
       mapRef.current?.animateToRegion({
         latitude: coords[1],
         longitude: coords[0],
         latitudeDelta: 0.01,
         longitudeDelta: 0.01,
       }, 800);
    }
  };

  const fetchRoute = async () => {
    if (!userLocation || !currentLead?.location?.coordinates) return;

    const start = `${userLocation.longitude},${userLocation.latitude}`;
    const end = `${currentLead.location.coordinates[0]},${currentLead.location.coordinates[1]}`;
    
    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start};${end}?geometries=geojson&access_token=${ENV.MAPBOX_ACCESS_TOKEN}`;
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.routes && data.routes.length > 0) {
        const coords = data.routes[0].geometry.coordinates.map((c: any) => ({
          longitude: c[0],
          latitude: c[1],
        }));
        setRouteCoordinates(coords);
      }
    } catch (error) {
      console.error('Error fetching route:', error);
    }
  };

  useEffect(() => {
    if (showRoute) {
      fetchRoute();
    } else {
      setRouteCoordinates([]);
    }
  }, [showRoute, userLocation, currentLead]);

  const heatmapPoints = useMemo(() => {
    return filteredLeads
      .filter((l: any) => l.location?.coordinates)
      .map((l: any) => ({
        latitude: l.location.coordinates[1],
        longitude: l.location.coordinates[0],
        weight: (l.price || 0) / 1000 || 1,
      }));
  }, [filteredLeads]);

  return (
    <View
      className={fullScreen ? 'flex-1' : 'rounded-[32px] overflow-hidden border-2 shadow-2xl mt-4'}
      style={{
        borderColor: colors.border,
        height: fullScreen ? '100%' : 420,
        width: '100%',
        backgroundColor: isDark ? '#121212' : '#f0f0f0',
      }}
    >
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        initialRegion={region}
        onRegionChange={(r) => {
          currentRegion.current = r;
          updateSelectedPoint();
        }}
        onRegionChangeComplete={(r) => {
          currentRegion.current = r;
          updateSelectedPoint();
        }}
        onPress={() => {
          if (markerPressedRef.current) {
            markerPressedRef.current = false;
            return;
          }
          setSelectedLead(null);
        }}
        customMapStyle={isDark ? darkMapStyle : []}
      >

        {/* Route Polyline */}
        {routeCoordinates.length > 0 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor={colors.primary.main}
            strokeWidth={4}
          />
        )}

        {/* Heatmap Layer - Rendered before markers to avoid blocking touch events */}
        {isHeatMap && heatmapPoints.length > 0 && (
          <Heatmap
            points={heatmapPoints}
            radius={40}
            opacity={0.7}
            gradient={{
              colors: ['#74c0ff', '#0072ff', '#00c853', '#ffab00', '#ff6d00', '#d50000'],
              startPoints: [0.1, 0.3, 0.5, 0.7, 0.85, 1],
              colorMapSize: 256,
            }}
          />
        )}

        {/* Individual Markers */}
        {filteredLeads.map((job) => {
          if (!job.location?.coordinates) return null;
          const isSelected = selectedLead?._id === job._id;
          const uid = (user as any)?._id || (user as any)?.id;
          const isOwner = uid && (
            job.salesRepId === uid ||
            job.salesRep?._id === uid ||
            job.userId === uid ||
            job.salesRepName === (user as any)?.fullName ||
            job.userName === (user as any)?.userName
          );
          const hasActiveReferral = job.jobReferrals?.some((r: any) => r.referralToggle === true);
          const isFavJob = job.isFavorite || job.isFavourite;

          // Tint only for special states; default uses the PNG as-is
          const tintColor = (isFavoriteOnly && isFavJob)
            ? '#F59E0B'   // amber for favorite filter
            : undefined;  // no tint — use original green PNG

          return (
            <Marker
              key={`${job._id}-${filterKey}`}
              coordinate={{
                latitude: job.location.coordinates[1],
                longitude: job.location.coordinates[0],
              }}
              onPress={(e) => handleMarkerClick(job, e)}
              tracksViewChanges={isSelected}
              anchor={{ x: 0.5, y: 1 }}
              zIndex={isSelected ? 100 : 1}
              opacity={isHeatMap ? 0 : 1}
            >
              <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                <Image
                  source={markerImg}
                  style={{
                    width: 36,
                    height: 44,
                    ...(tintColor ? { tintColor } : {}),
                  }}
                  resizeMode="contain"
                />
                {/* Selected ring */}
                {isSelected && (
                  <View style={{
                    position: 'absolute',
                    top: -4,
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    borderWidth: 2.5,
                    borderColor: '#4CBB17',
                    backgroundColor: 'transparent',
                  }} />
                )}
              </View>
            </Marker>
          );
        })}
        {/* User Location Marker */}
        {userLocation && (
          <Marker
            coordinate={userLocation}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View className="items-center justify-center">
              <View className="w-8 h-8 rounded-full bg-blue-500/20 border-2 border-white items-center justify-center shadow-lg">
                <View className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-sm" />
              </View>
            </View>
          </Marker>
        )}
      </MapView>

      {/* Anchored Interactive Job Card (InfoWindow Style but fully interactive) */}
      {/* Anchored Interactive Job Card (InfoWindow Style but fully interactive) */}
      {selectedLead && selectedLeadPoint && (
        <View 
          style={{
            position: 'absolute',
            left: selectedLeadPoint.x - 140, // Centered horizontally (280 / 2)
            top: selectedLeadPoint.y - 325, // Positioned above the marker
            zIndex: 1000,
          }}
          pointerEvents="auto"
        >
          <View 
            style={{
              backgroundColor: isDark ? '#1E1E1E' : 'white',
              borderRadius: 20,
              padding: 0,
              width: 280,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.3,
              shadowRadius: 20,
              elevation: 20,
              borderWidth: 1,
              borderColor: isDark ? '#333' : '#f1f5f9',
            }}
          >
            <MapJobCard
              job={selectedLead}
              onClose={() => setSelectedLead(null)}
              isMyJob={
                (() => {
                  const uid = (user as any)?._id || (user as any)?.id;
                  if (!uid) return false;
                  return (
                    selectedLead.salesRepId === uid ||
                    selectedLead.salesRep?._id === uid ||
                    selectedLead.userId === uid ||
                    selectedLead.salesRep === uid ||
                    selectedLead.salesRepName === (user as any)?.fullName ||
                    selectedLead.salesRepName === (user as any)?.firstName ||
                    selectedLead.salesRep === (user as any)?.userName ||
                    selectedLead.userName === (user as any)?.userName
                  );
                })()
              }
              onReferencePress={() => {
                // If a parent handler exists (e.g. MapDetail), use it.
                // MapDetail's handler opens a ReferralModal with onSuccess={fetchLeads},
                // which refreshes externalLeads → allLeads → instant fresh data.
                // Only fall back to internal modal in standalone (no parent) mode.
                if (onReferencePress) {
                  onReferencePress(selectedLead);
                } else {
                  setGalleryJob(selectedLead);
                  setShowReferral(true);
                }
              }}
              onCameraPress={() => {
                setGalleryJob(selectedLead);
                setShowUpload(true);
              }}
              onGalleryPress={() => {
                if (onGalleryPress) onGalleryPress(selectedLead);
                else {
                  setGalleryJob(selectedLead);
                  setShowGallery(true);
                }
              }}
              onFavoritePress={handleToggleFavorite}
            />
            
            {/* Anchor Triangle */}
            <View 
              style={{
                position: 'absolute',
                bottom: -10,
                left: 130, // Centered (140 - 10)
                width: 0,
                height: 0,
                backgroundColor: 'transparent',
                borderStyle: 'solid',
                borderLeftWidth: 10,
                borderRightWidth: 10,
                borderTopWidth: 10,
                borderLeftColor: 'transparent',
                borderRightColor: 'transparent',
                borderTopColor: isDark ? '#1E1E1E' : 'white',
              }}
            />
          </View>
        </View>
      )}


      {/* Right Side Vertical Controls (Back + Toggles) */}
      <View className="absolute bottom-[120px] right-5 gap-3 items-center" style={{ zIndex: 10 }}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          className="w-12 h-12 rounded-full bg-[#4cbb17] items-center justify-center shadow-xl mb-2"
        >
          <Icon name="arrow-left" size={24} color="white" />
        </TouchableOpacity>

        <View className="gap-2">
          {[
            { active: 'HM', inactive: 'DEF', id: 'HT-0' },
            { active: 'MJ', inactive: 'AJ', id: 'MJ-1' },
            { active: 'RF', inactive: 'DEF', id: 'RF-2' },
            { active: 'FV', inactive: 'DEF', id: 'FV-3' }
          ].map((btn) => {
            const isFilterActive = activeFilters.includes(btn.id);
            return (
              <MapToggleSwitch
                key={btn.id}
                value={isFilterActive}
                onValueChange={(val) => {
                  if (!val) setActiveFilters(activeFilters.filter(f => f !== btn.id));
                  else setActiveFilters([...activeFilters, btn.id]);
                }}
                activeLabel={btn.active}
                inactiveLabel={btn.inactive}
              />
            );
          })}
        </View>
      </View>

      {/* Bottom Right Controls (GPS & Zoom) */}
      <View className="absolute bottom-10 right-6 flex-row items-end gap-3" style={{ zIndex: 10 }}>
        <TouchableOpacity
          onPress={startTracking}
          className="w-12 h-12 rounded-full bg-[#4cbb17] items-center justify-center shadow-xl"
        >
          <Icon name="crosshairs-gps" size={24} color="white" />
        </TouchableOpacity>

        <View className="bg-white rounded-xl shadow-xl overflow-hidden border border-slate-100">
          <TouchableOpacity
            onPress={() => {
              const r = currentRegion.current;
              mapRef.current?.animateToRegion({
                ...r,
                latitudeDelta: r.latitudeDelta / 2,
                longitudeDelta: r.longitudeDelta / 2,
              }, 300);
            }}
            className="w-10 h-10 items-center justify-center border-b border-slate-100"
          >
            <Icon name="plus" size={24} color="#64748b" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              const r = currentRegion.current;
              mapRef.current?.animateToRegion({
                ...r,
                latitudeDelta: r.latitudeDelta * 2,
                longitudeDelta: r.longitudeDelta * 2,
              }, 300);
            }}
            className="w-10 h-10 items-center justify-center"
          >
            <Icon name="minus" size={24} color="#64748b" />
          </TouchableOpacity>
        </View>
      </View>


      <MapGalleryModal
        visible={showGallery}
        job={galleryJob}
        onClose={() => setShowGallery(false)}
        onCameraPress={(job) => {
          setGalleryJob(job);
          setShowUpload(true);
        }}
      />




      <JobImageUploadModal
        visible={showUpload}
        onClose={() => setShowUpload(false)}
        selectedJob={galleryJob}
        onUploadSuccess={() => {
          fetchAllJobs();
        }}
      />

      <ReferralModal
        visible={showReferral}
        onClose={() => setShowReferral(false)}
        selectedJob={galleryJob}
        onSuccess={() => {
          // Refresh data so jobReferrals / referralToggle state is up-to-date.
          // In standalone mode this fetches fresh data.
          // In external-leads mode, bump dataVersion so markers remount.
          if (!externalLeads) {
            fetchAllJobs();
          } else {
            setDataVersion((v) => v + 1);
          }
        }}
        isMyJob={
          (() => {
            const uid = (user as any)?._id || (user as any)?.id;
            if (!uid) return false;
            return (
              galleryJob?.salesRepId === uid ||
              galleryJob?.salesRep?._id === uid ||
              galleryJob?.userId === uid ||
              galleryJob?.salesRep === uid ||
              galleryJob?.salesRepName === (user as any)?.fullName ||
              galleryJob?.salesRepName === (user as any)?.firstName ||
              galleryJob?.salesRep === (user as any)?.userName ||
              galleryJob?.userName === (user as any)?.userName
            );
          })()
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  cardOverlay: {
    position: 'absolute',
    top: 40,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 20,
  }
});

const darkMapStyle = [
  {
    "elementType": "geometry",
    "stylers": [{ "color": "#212121" }]
  },
  {
    "elementType": "labels.icon",
    "stylers": [{ "visibility": "off" }]
  },
  {
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#757575" }]
  },
  {
    "elementType": "labels.text.stroke",
    "stylers": [{ "color": "#212121" }]
  },
  {
    "featureType": "administrative",
    "elementType": "geometry",
    "stylers": [{ "color": "#757575" }]
  },
  {
    "featureType": "administrative.country",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#9e9e9e" }]
  },
  {
    "featureType": "administrative.land_parcel",
    "stylers": [{ "visibility": "off" }]
  },
  {
    "featureType": "administrative.locality",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#bdbdbd" }]
  },
  {
    "featureType": "poi",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#757575" }]
  },
  {
    "featureType": "poi.park",
    "elementType": "geometry",
    "stylers": [{ "color": "#181818" }]
  },
  {
    "featureType": "poi.park",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#616161" }]
  },
  {
    "featureType": "poi.park",
    "elementType": "labels.text.stroke",
    "stylers": [{ "color": "#1b1b1b" }]
  },
  {
    "featureType": "road",
    "elementType": "geometry.fill",
    "stylers": [{ "color": "#2c2c2c" }]
  },
  {
    "featureType": "road",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#8a8a8a" }]
  },
  {
    "featureType": "road.arterial",
    "elementType": "geometry",
    "stylers": [{ "color": "#373737" }]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry",
    "stylers": [{ "color": "#3c3c3c" }]
  },
  {
    "featureType": "road.highway.controlled_access",
    "elementType": "geometry",
    "stylers": [{ "color": "#4e4e4e" }]
  },
  {
    "featureType": "road.local",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#616161" }]
  },
  {
    "featureType": "transit",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#757575" }]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [{ "color": "#000000" }]
  },
  {
    "featureType": "water",
    "elementType": "labels.text.fill",
    "stylers": [{ "color": "#3d3d3d" }]
  }
];
