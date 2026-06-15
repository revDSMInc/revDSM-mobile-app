import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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

import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Heatmap, Callout, Polygon } from 'react-native-maps';
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



const MARKER_IMAGES = {
  default: require('../../../assets/images/map/marker-green.png'),
  searched: require('../../../assets/images/map/marker-red.png'),
  favorite: require('../../../assets/images/map/marker-amber.png'),
  selected: require('../../../assets/images/map/marker-selected.png'),
};

const { width, height } = Dimensions.get('window');

// STATIC TAMPA DATA
const TAMPA_COORDS = {
  latitude: 27.9506,
  longitude: -82.4572,
};

// Match web app logic exactly - ONLY check salesRepId
const isJobOwner = (item: any, uid: string | undefined): boolean => {
  if (!uid || !item) return false;
  return item.salesRepId === uid;
};

interface LeadMapProps {
  currentLead?: any;
  focusLead?: any;
  fullScreen?: boolean;
  onGalleryPress?: (job: any) => void;
  onCameraPress?: (job: any) => void;
  onReferencePress?: (job: any) => void;
  leads?: any[];
  isFavoriteFilter?: boolean;
  isReferralFilter?: boolean;
  isMyJobsFilter?: boolean;
  isHeatMapFilter?: boolean;
  onToggleFilter?: (filterType: 'heatmap' | 'myjobs' | 'referral') => void;
}

/**
 * Memoized single-lead marker. React.memo with custom comparator means this
 * component NEVER re-renders during map pan/zoom (when only selectedLeadPoint
 * or other parent state changes). Only re-renders when its own props change:
 * marker image source, heatmap visibility, or the stable onPress callback.
 * This eliminates the JS diffing overhead that caused lag with 3,000+ markers.
 */
const LeadMarkerMemo = React.memo(
  ({
    job,
    markerSource,
    isHeatMap,
    onPress,
  }: {
    job: any;
    markerSource: any;
    isHeatMap: boolean;
    onPress: (job: any, e: any) => void;
  }) => {
    if (!job?.location?.coordinates) return null;
    const lat = job.location.coordinates[1];
    const lng = job.location.coordinates[0];
    return (
      <Marker
        coordinate={{ latitude: lat, longitude: lng }}
        onPress={(e) => onPress(job, e)}
        image={markerSource}
        anchor={{ x: 0.5, y: 1 }}
        zIndex={1}
        opacity={isHeatMap ? 0 : 1}
        tracksViewChanges={false}
      />
    );
  },
  (prev, next) =>
    prev.markerSource === next.markerSource &&
    prev.isHeatMap === next.isHeatMap &&
    prev.onPress === next.onPress
);


export const LeadMap = ({
  currentLead,
  focusLead,
  fullScreen = false,
  onGalleryPress,
  onCameraPress,
  onReferencePress,
  leads: externalLeads,
  isFavoriteFilter,
  isReferralFilter,
  isMyJobsFilter,
  isHeatMapFilter,
  onToggleFilter,
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
  const prevLeadsHashRef = useRef('');
  useEffect(() => {
    if (externalLeads) {
      const currentHash = externalLeads.map(l => `${l._id}-${l.isFavourite || l.isFavorite}`).join(',');
      if (prevLeadsHashRef.current !== currentHash) {
        prevLeadsHashRef.current = currentHash;
        setDataVersion((v) => v + 1);
      }
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

  // Boundary lock — same bounds as the web app Leaflet MAP_BOUNDS
  // SW [15, -180]  NE [85, -40]
  const [mapScrollEnabled, setMapScrollEnabled] = useState(true);
  const isOutOfBoundsRef = useRef(false);

  const [region, setRegion] = useState({
    ...TAMPA_COORDS,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });
  const currentRegion = useRef(region);

  const { isHeatMapActive, isMyJobsOnly, isReferralOnly, isFavoriteOnly } = useMemo(() => {
    if (onToggleFilter) {
      return {
        isHeatMapActive: !!isHeatMapFilter,
        isMyJobsOnly: !!isMyJobsFilter,
        isReferralOnly: !!isReferralFilter,
        isFavoriteOnly: !!isFavoriteFilter,
      };
    }
    return {
      isHeatMapActive: activeFilters.includes('HT-0'),
      isMyJobsOnly: activeFilters.includes('MJ-1'),
      isReferralOnly: activeFilters.includes('RF-2'),
      isFavoriteOnly: activeFilters.includes('FV-3') || !!isFavoriteFilter,
    };
  }, [
    activeFilters,
    isFavoriteFilter,
    isReferralFilter,
    isMyJobsFilter,
    isHeatMapFilter,
    onToggleFilter,
  ]);

  const filteredLeads = useMemo(() => {
    let result = [...allLeads];

    result = result.filter((item: any) => {
      // 1. TAM Range Filter (Excludes TAM30000-30032)
      const jobNumber = item?.jobNumber;
      if (typeof jobNumber === 'string' && jobNumber.startsWith('TAM')) {
        const num = parseInt(jobNumber.substring(3), 10);
        if (num >= 30000 && num <= 30032) return false;
      }



      // 3. My Jobs Filter
      if (isMyJobsOnly) {
        const uid = (user as any)?._id || (user as any)?.id;
        const isOwner = isJobOwner(item, uid);
        if (!isOwner) return false;
      }

      // 4. Reference Filter (match web app logic)
      if (isReferralOnly) {
        const uid = (user as any)?._id || (user as any)?.id;
        const isMine = isJobOwner(item, uid);
        const hasReferrals = item.jobReferrals && item.jobReferrals.length > 0;
        if (!hasReferrals) return false;

        if (!isMine) {
          const activeToggle = item.jobReferrals[0]?.referralToggle === true || item.jobReferrals[0]?.referralToggle === 'true';
          if (!activeToggle) return false;
        }
      }

      return true;
    });

    return result;
  }, [allLeads, user, isMyJobsOnly, isReferralOnly, isFavoriteOnly, externalLeads]);

  // ─── Spatial grid index ───────────────────────────────────────────────────
  // Divides all leads into 0.1° grid cells (~11km each). Built once per filter
  // change. Viewport query = look up only intersecting cells → O(1) not O(n).
  const CELL_SIZE = 0.1;
  const spatialIndex = useMemo(() => {
    const grid = new Map<string, any[]>();
    filteredLeads.forEach(job => {
      if (!job.location?.coordinates) return;
      const lat = job.location.coordinates[1];
      const lng = job.location.coordinates[0];
      const key = `${Math.floor(lat / CELL_SIZE)},${Math.floor(lng / CELL_SIZE)}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(job);
    });
    return grid;
  }, [filteredLeads]);

  // ─── Viewport region — updated ONLY after pan/zoom ends ──────────────────
  // Never updates during active gesture so zero JS work while dragging.
  const [viewportRegion, setViewportRegion] = useState({
    ...TAMPA_COORDS,
    latitudeDelta: 0.0922,
    longitudeDelta: 0.0421,
  });

  // ─── Visible leads — only markers within 2× the current viewport ─────────
  // At any zoom level, only ~20-200 markers are ever in view.
  // MAX_VISIBLE caps render at low zoom (zoomed far out = many cells visible).
  const MAX_VISIBLE = 400;
  const visibleLeads = useMemo(() => {
    const { latitude, longitude, latitudeDelta, longitudeDelta } = viewportRegion;
    const PAD = 2.0; // prefetch 2× viewport → markers ready before user pans to edge
    const minLat = latitude - (latitudeDelta * PAD / 2);
    const maxLat = latitude + (latitudeDelta * PAD / 2);
    const minLng = longitude - (longitudeDelta * PAD / 2);
    const maxLng = longitude + (longitudeDelta * PAD / 2);

    const minCLat = Math.floor(minLat / CELL_SIZE);
    const maxCLat = Math.floor(maxLat / CELL_SIZE);
    const minCLng = Math.floor(minLng / CELL_SIZE);
    const maxCLng = Math.floor(maxLng / CELL_SIZE);

    const result: any[] = [];
    for (let clat = minCLat; clat <= maxCLat; clat++) {
      for (let clng = minCLng; clng <= maxCLng; clng++) {
        if (result.length >= MAX_VISIBLE) break;
        const cell = spatialIndex.get(`${clat},${clng}`);
        if (cell) result.push(...cell);
      }
      if (result.length >= MAX_VISIBLE) break;
    }

    // Always include selected lead even if outside viewport
    if (selectedLead?._id && !result.some(j => j._id === selectedLead._id)) {
      result.push(selectedLead);
    }

    return result;
  }, [spatialIndex, viewportRegion, selectedLead?._id]);

  // Sync heatmap state when toggle changes
  useEffect(() => {
    if (isHeatMap !== isHeatMapActive) setIsHeatMap(isHeatMapActive);
  }, [isHeatMapActive]);

  // filterKey changes on every filter toggle.
  // This forces a clean remount of ALL markers, which prevents phantom duplicates from prior async renders,
  // but does not include dataVersion so that updating/favoriting single leads does not trigger a full remount.
  const filterKey = `${isFavoriteOnly}-${isReferralOnly}-${isMyJobsOnly}-${isHeatMapActive}`;

  const [isMapMoving, setIsMapMoving] = useState(false);


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
      if (currentLead._id) {
        setSelectedLead(currentLead);
      }
    } else if (currentLead?.latitude && currentLead?.longitude) {
      // Handle direct coordinate objects — used for location search navigation from MapFiltersModal
      mapRef.current?.animateToRegion({
        latitude: currentLead.latitude,
        longitude: currentLead.longitude,
        latitudeDelta: currentLead.latitudeDelta || 0.05,
        longitudeDelta: currentLead.longitudeDelta || 0.05,
      }, 800);
    }
  }, [currentLead]);

  useEffect(() => {
    if (focusLead?.location?.coordinates) {
      const coords = focusLead.location.coordinates;
      mapRef.current?.animateToRegion({
        latitude: coords[1],
        longitude: coords[0],
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      }, 1000);
      setSelectedLead(focusLead);
    }
  }, [focusLead]);

  const startTracking = (forceAnimate = false) => {
    const successCallback = (position: any) => {
      const { latitude, longitude } = position.coords;
      setUserLocation({ latitude, longitude });

      // Always animate to user's current location when opening map or clicking GPS
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
  const [cardHeight, setCardHeight] = useState(380);

  const updateSelectedPoint = async () => {
    if (selectedLead?.location?.coordinates && mapRef.current) {
      try {
        const point = await mapRef.current.pointForCoordinate({
          latitude: selectedLead.location.coordinates[1],
          longitude: selectedLead.location.coordinates[0],
        });
        setSelectedLeadPoint(point);
      } catch (e) {
        // ignore
      }
    } else {
      setSelectedLeadPoint(null);
    }
  };

  useEffect(() => {
    updateSelectedPoint();
    const timer = setTimeout(updateSelectedPoint, 150);
    return () => clearTimeout(timer);
  }, [selectedLead]);

  useEffect(() => {
    if (selectedLead && !filteredLeads.some(job => job._id === selectedLead._id)) {
      setSelectedLead(null);
    }
  }, [filteredLeads, selectedLead]);

  const handleToggleFavorite = async (job: any) => {
    const nextValue = !(job.isFavourite || job.isFavorite);
    try {
      await LeadService.toggleFavourite(job._id, nextValue);

      // Mutate the lead object inside allLeads array in-place so both internal/external lists and clicked markers reference the fresh state!
      const target = allLeads.find((l) => l._id === job._id);
      if (target) {
        target.isFavourite = nextValue;
        target.isFavorite = nextValue;
      }

      if (!externalLeads) {
        setInternalLeads((prev: any[]) =>
          prev.map((l) =>
            l._id === job._id ? { ...l, isFavourite: nextValue, isFavorite: nextValue } : l
          )
        );
      }

      // Always bump version so markers rerender and update their colors
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
        latitude: coords[1] + 0.003, // shift center north to center card vertically
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

  // Haversine formula to compute great-circle distance in kilometers
  const getDistanceInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371; // Radius of the earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
  };

  // Check if a job is near the searched location (within 2 km radius)
  const isNearSearchedLocation = (jobLat: number, jobLng: number) => {
    if (!currentLead?.latitude || !currentLead?.longitude) return false;
    const dist = getDistanceInKm(jobLat, jobLng, currentLead.latitude, currentLead.longitude);
    return dist <= 2;
  };

  // Debug: Log when search location changes
  useEffect(() => {
    if (currentLead?.latitude && currentLead?.longitude) {
      console.log('[SearchLocation] Search location set to:', { lat: currentLead.latitude, lng: currentLead.longitude });
      console.log('[SearchLocation] Total markers displayed:', filteredLeads.length);
      const nearbyMarkers = filteredLeads.filter(job => {
        if (!job.location?.coordinates) return false;
        return isNearSearchedLocation(job.location.coordinates[1], job.location.coordinates[0]);
      });
      console.log('[SearchLocation] Markers within 2km of search location:', nearbyMarkers.length, nearbyMarkers.map((m: any) => m.jobNumber));
    }
  }, [currentLead?.latitude, currentLead?.longitude, filteredLeads]);

  // ─── Optimised marker rendering ───────────────────────────────────────────
  // handleMarkerClickRef: a ref-backed stable callback so stableMarkerPress
  // never changes identity, preventing LeadMarkerMemo from re-rendering when
  // selectedLead (captured inside handleMarkerClick) changes.
  const handleMarkerClickRef = useRef<(job: any, e?: any) => void>(handleMarkerClick);
  handleMarkerClickRef.current = handleMarkerClick;
  const stableMarkerPress = useCallback((job: any, e: any) => {
    handleMarkerClickRef.current(job, e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally empty — stability guaranteed via ref

  // All lead markers pre-computed. Only recalculates when data/filter changes,
  // NOT when selectedLeadPoint/selectedLead changes — zero diffing during pan.
  const markerElements = useMemo(() => {
    return visibleLeads.map((job) => {
      if (!job.location?.coordinates) return null;
      const isFavJob = job.isFavorite || job.isFavourite;
      const markerSource =
        isFavJob ? MARKER_IMAGES.favorite : MARKER_IMAGES.default;
      return (
        <LeadMarkerMemo
          key={job._id}
          job={job}
          markerSource={markerSource}
          isHeatMap={isHeatMap}
          onPress={stableMarkerPress}
        />
      );
    });
  }, [visibleLeads, isHeatMap, stableMarkerPress, dataVersion]);



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
        maxZoomLevel={20}
        scrollEnabled={mapScrollEnabled}
        onRegionChange={(r) => {
          // Boundary lock: same as Leaflet maxBoundsViscosity=1.0
          // The instant the center crosses the US/Canada border, kill the gesture
          // by flipping scrollEnabled=false. Can't use animateToRegion here
          // because the native gesture overrides it while the finger is down.
          const MIN_LAT = 15, MAX_LAT = 85, MIN_LNG = -180, MAX_LNG = -40;
          const isOut =
            r.latitude < MIN_LAT || r.latitude > MAX_LAT ||
            r.longitude < MIN_LNG || r.longitude > MAX_LNG;

          if (isOut && !isOutOfBoundsRef.current) {
            isOutOfBoundsRef.current = true;
            setMapScrollEnabled(false); // kills the active drag gesture immediately
          }

          currentRegion.current = r;
          if (!isMapMoving) {
            setIsMapMoving(true);
          }
        }}
        onRegionChangeComplete={(r) => {
          currentRegion.current = r;
          setIsMapMoving(false);
          setViewportRegion(r);

          // Snap back and re-enable scrolling after gesture was killed
          if (isOutOfBoundsRef.current) {
            const MIN_LAT = 15, MAX_LAT = 85, MIN_LNG = -180, MAX_LNG = -40;
            const clampedLat = Math.min(Math.max(r.latitude, MIN_LAT), MAX_LAT);
            const clampedLng = Math.min(Math.max(r.longitude, MIN_LNG), MAX_LNG);
            mapRef.current?.animateToRegion(
              {
                latitude: clampedLat,
                longitude: clampedLng,
                latitudeDelta: r.latitudeDelta,
                longitudeDelta: r.longitudeDelta,
              },
              250
            );
            setTimeout(() => {
              isOutOfBoundsRef.current = false;
              setMapScrollEnabled(true);
            }, 300);
          }
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
        onMapReady={() => {
          // Matches Leaflet MAP_BOUNDS: SW [15,-180], NE [85,-40]
          mapRef.current?.setMapBoundaries(
            { latitude: 85, longitude: -40 },
            { latitude: 15, longitude: -180 }
          );
        }}
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

        {/* Lead Markers — ALL leads rendered as memoized native Markers.
             filterKey on the Fragment forces a complete atomic remount of ALL markers
             when any filter or data version changes. This prevents the ghost/phantom
             marker effect that occurs when React incrementally adds/removes markers
             during filter transitions. During pan/zoom (filterKey unchanged),
             LeadMarkerMemo's custom comparator skips all 3,000 markers entirely. */}
        <React.Fragment key={filterKey}>
          {markerElements}
        </React.Fragment>
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

        {/* Location-search center marker */}
        {currentLead?.latitude && currentLead?.longitude && (
          <Marker
            coordinate={{
              latitude: currentLead.latitude,
              longitude: currentLead.longitude,
            }}
            anchor={{ x: 0.5, y: 1 }}
            zIndex={999}
          >
            <View style={{ alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="map-marker" size={34} color="#FF3B30" />
              <View
                style={{
                  position: 'absolute',
                  bottom: -2,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: '#FF3B30',
                  borderWidth: 1,
                  borderColor: '#fff',
                }}
              />
            </View>
          </Marker>
        )}
      </MapView>


      {/* Anchored Interactive Job Card (InfoWindow Style but fully interactive) */}
      {selectedLead && selectedLeadPoint && !isMapMoving && (
        <View
          style={{
            position: 'absolute',
            left: selectedLeadPoint.x - 140, // Centered horizontally (280 / 2)
            top: selectedLeadPoint.y - cardHeight - 110, // Sit above the 100px tall marker + 10px triangle
            zIndex: 1000,
          }}
          pointerEvents="auto"
        >
          <View
            onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
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
              isMyJob={isJobOwner(selectedLead, (user as any)?._id || (user as any)?.id)}
              onReferencePress={() => {
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
            { active: 'HM', inactive: 'DEF', id: 'HT-0', type: 'heatmap' as const },
            { active: 'MJ', inactive: 'AJ', id: 'MJ-1', type: 'myjobs' as const },
            { active: 'RF', inactive: 'DEF', id: 'RF-2', type: 'referral' as const }
          ].map((btn) => {
            const isFilterActive = onToggleFilter
              ? (btn.type === 'heatmap' ? isHeatMapActive : btn.type === 'myjobs' ? isMyJobsOnly : isReferralOnly)
              : activeFilters.includes(btn.id);
            return (
              <MapToggleSwitch
                key={btn.id}
                value={isFilterActive}
                onValueChange={(val) => {
                  if (onToggleFilter) {
                    onToggleFilter(btn.type);
                  } else {
                    if (!val) setActiveFilters(activeFilters.filter(f => f !== btn.id));
                    else setActiveFilters([...activeFilters, btn.id]);
                  }
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
          onPress={() => startTracking(true)}
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
        isMyJob={isJobOwner(galleryJob, (user as any)?._id || (user as any)?.id)}
        onClose={() => setShowGallery(false)}
        onUploadSuccess={fetchAllJobs}
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
        isMyJob={isJobOwner(galleryJob, (user as any)?._id || (user as any)?.id)}
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
