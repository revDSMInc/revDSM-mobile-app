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

import MapView, { Marker, Polyline, PROVIDER_GOOGLE, Heatmap, Callout, Polygon, Geojson } from 'react-native-maps';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Geolocation from 'react-native-geolocation-service';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../../theme/ThemeProvider';
import { useLeadsData } from '../../../hooks/useLeadsData';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';
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

const TRANSPARENT_IMAGE = require('../../../assets/images/map/transparent.png');

const { width, height } = Dimensions.get('window');

// STATIC TAMPA DATA
const TAMPA_COORDS = {
  latitude: 27.9506,
  longitude: -82.4572,
};

// Match web app logic exactly - check salesRepId and name-based properties
const isJobOwner = (item: any, user: any): boolean => {
  if (!user || !item) return false;
  const uid = typeof user === 'string' ? user : (user._id || user.id);
  if (!uid) return false;

  const matchesId = !!(
    item.salesRepId === uid ||
    item.salesRep === uid ||
    (item.salesRep && typeof item.salesRep === 'object' && (item.salesRep._id === uid || item.salesRep.id === uid)) ||
    (item.salesRep && typeof item.salesRep === 'object' && (item.salesRep.id === uid)) ||
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
  onToggleFilter?: (filterType: 'heatmap' | 'myjobs' | 'referral' | 'favorite') => void;
  searchedJobNumber?: string;
  onFavoriteToggle?: (jobId: string, isFavorite: boolean) => void;
}



interface MemoizedGeojsonOverlayProps {
  geojson: any;
  color: string;
  tracksViewChanges: boolean;
  onPress: (event: any) => void;
}

const MemoizedGeojsonOverlay = React.memo(
  ({ geojson, color, tracksViewChanges, onPress }: MemoizedGeojsonOverlayProps) => {
    return (
      <Geojson
        geojson={geojson}
        color={color}
        // @ts-ignore
        markerColor={color}
        tracksViewChanges={tracksViewChanges}
        onPress={onPress}
      />
    );
  },
  (prev, next) => {
    return (
      prev.geojson === next.geojson &&
      prev.color === next.color &&
      prev.onPress === next.onPress &&
      prev.tracksViewChanges === next.tracksViewChanges
    );
  }
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
  searchedJobNumber,
  onFavoriteToggle,
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
  const [visibleRegion, setVisibleRegion] = useState(region);

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
        const isOwner = isJobOwner(item, user);
        if (!isOwner) return false;
      }

      // 4. Reference Filter (match web app logic)
      if (isReferralOnly) {
        const isMine = isJobOwner(item, user);
        const hasReferrals = item.jobReferrals && item.jobReferrals.length > 0;
        if (!hasReferrals) return false;

        if (!isMine) {
          const activeToggle = item.jobReferrals[0]?.referralToggle === true || item.jobReferrals[0]?.referralToggle === 'true';
          if (!activeToggle) return false;
        }
      }

      // 5. Favorite Job Filter
      if (isFavoriteOnly) {
        const isFav = item.isFavorite === true || item.isFavourite === true;
        if (!isFav) return false;
      }

      return true;
    });

    return result;
  }, [allLeads, user, isMyJobsOnly, isReferralOnly, isFavoriteOnly, externalLeads]);

  // ─── Separate searched, favorite and default leads ────────────────────────
  const { searchedLeads, favoriteLeads, defaultLeads } = useMemo(() => {
    const searched: any[] = [];
    const favorites: any[] = [];
    const defaults: any[] = [];

    filteredLeads.forEach(job => {
      const isSearchedJob = searchedJobNumber && job.jobNumber &&
        job.jobNumber.toLowerCase().trim().includes(searchedJobNumber.toLowerCase().trim());

      if (isSearchedJob) {
        searched.push(job);
      } else {
        const isFavJob = job.isFavorite || job.isFavourite;
        if (isFavJob && isFavoriteOnly) {
          favorites.push(job);
        } else {
          defaults.push(job);
        }
      }
    });
    return { searchedLeads: searched, favoriteLeads: favorites, defaultLeads: defaults };
  }, [filteredLeads, isFavoriteOnly, searchedJobNumber]);

  // ─── Create native GeoJSON objects ─────────────────────────────────────────
  const searchedGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: searchedLeads
        .filter(job => job.location?.coordinates && job.location.coordinates.length >= 2)
        .map(job => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [Number(job.location.coordinates[0]), Number(job.location.coordinates[1])]
          },
          properties: job
        }))
    };
  }, [searchedLeads]);

  const favoriteGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: favoriteLeads
        .filter(job => job.location?.coordinates && job.location.coordinates.length >= 2)
        .map(job => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [Number(job.location.coordinates[0]), Number(job.location.coordinates[1])]
          },
          properties: job
        }))
    };
  }, [favoriteLeads]);

  const defaultGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: defaultLeads
        .filter(job => job.location?.coordinates && job.location.coordinates.length >= 2)
        .map(job => ({
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [Number(job.location.coordinates[0]), Number(job.location.coordinates[1])]
          },
          properties: job
        }))
    };
  }, [defaultLeads]);

  // filterKey changes on every filter toggle.
  // This forces a clean remount of ALL markers, which prevents phantom duplicates from prior async renders,
  // but does not include dataVersion so that updating/favoriting single leads does not trigger a full remount.
  const filterKey = `${isFavoriteOnly}-${isReferralOnly}-${isMyJobsOnly}-${isHeatMapActive}-${searchedJobNumber || ''}`;

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
        latitude: coords[1] + 0.003, // shift center north to center card vertically matching marker click
        longitude: coords[0],
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
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
  const [loadingDetail, setLoadingDetail] = useState(false);
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

      if (nextValue) {
        FlashMessage.success('Job is added to favourite');
      } else {
        FlashMessage.info('Job is removed from favourite');
      }

      // Mutate the lead object inside allLeads array in-place so both internal/external lists and clicked markers reference the fresh state!
      const target = allLeads.find((l) => l._id === job._id);
      if (target) {
        target.isFavourite = nextValue;
        target.isFavorite = nextValue;
      }

      if (onFavoriteToggle) {
        onFavoriteToggle(job._id, nextValue);
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
      mapRef.current?.animateCamera({
        center: {
          latitude: coords[1] + 0.003, // shift center north to center card vertically
          longitude: coords[0],
        },
        zoom: 15.5,
      }, { duration: 600 });
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
      .map((l: any) => {
        const price = l.price || 0;
        let intensity = 0.3; // Default low density for jobs under $5000 (increased from 0.1)
        if (price > 5000) {
          // Scale intensity based on price for jobs over $5000 (increased multiplier from 0.9 to 1.2)
          intensity = 0.3 + Math.min(1.2, ((price - 5000) / 15000) * 1.2);
        }
        return {
          latitude: l.location.coordinates[1],
          longitude: l.location.coordinates[0],
          weight: intensity,
        };
      });
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


  const handleMarkerClickRef = useRef<(job: any, e?: any) => void>(handleMarkerClick);
  handleMarkerClickRef.current = handleMarkerClick;

  const stableMarkerPress = useCallback((event: any) => {
    const job = event.feature.properties;
    handleMarkerClickRef.current(job);
  }, []);

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
          setVisibleRegion(r); // Trigger viewport markers recalculation

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
        onPress={(event) => {
          if (markerPressedRef.current) {
            markerPressedRef.current = false;
            return;
          }

          // When heatmap is active, tapping the map should select the closest lead if it is nearby (within 2 km)
          if (isHeatMapActive && filteredLeads.length > 0) {
            const tapCoord = event.nativeEvent.coordinate;
            let closestLead = null;
            let minDistance = Infinity;

            for (const lead of filteredLeads) {
              if (lead.location?.coordinates) {
                const leadLng = lead.location.coordinates[0];
                const leadLat = lead.location.coordinates[1];
                const distance = getDistanceInKm(tapCoord.latitude, tapCoord.longitude, leadLat, leadLng);
                if (distance < minDistance) {
                  minDistance = distance;
                  closestLead = lead;
                }
              }
            }

            if (closestLead && minDistance <= 2) {
              setSelectedLead(closestLead);
              mapRef.current?.animateCamera({
                center: {
                  latitude: closestLead.location.coordinates[1] + 0.003, // shift center north to center card vertically
                  longitude: closestLead.location.coordinates[0],
                },
                zoom: 15.5,
              }, { duration: 600 });
              return;
            }
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
        {isHeatMapActive && heatmapPoints.length > 0 && (
          <Heatmap
            points={heatmapPoints}
            radius={30}
            opacity={1.0}
            gradient={{
              colors: ['rgba(116, 192, 255, 0)', 'rgba(116, 192, 255, 0.8)', '#0072ff', '#00c853', '#ffab00', '#ff6d00', '#d50000'],
              startPoints: [0.01, 0.15, 0.3, 0.5, 0.7, 0.85, 1.0],
              colorMapSize: 256,
            }}
          />
        )}

        {/* Lead Markers — ALL leads rendered as memoized native Markers. */}
        {!isHeatMapActive && defaultLeads.length > 0 && (
          <MemoizedGeojsonOverlay
            key="default-geojson-overlay"
            geojson={defaultGeoJson}
            color="#4CBB17"
            tracksViewChanges={false}
            onPress={stableMarkerPress}
          />
        )}
        {!isHeatMapActive && favoriteLeads.length > 0 && (
          <MemoizedGeojsonOverlay
            key="fav-geojson-overlay"
            geojson={favoriteGeoJson}
            color="#FFA500"
            tracksViewChanges={false}
            onPress={stableMarkerPress}
          />
        )}
        {!isHeatMapActive && searchedLeads.length > 0 && (
          <MemoizedGeojsonOverlay
            key="searched-geojson-overlay"
            geojson={searchedGeoJson}
            color="#2390ff"
            tracksViewChanges={false}
            onPress={stableMarkerPress}
          />
        )}
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


      {selectedLead && selectedLeadPoint && (
        <View
          style={{
            position: 'absolute',
            left: selectedLeadPoint.x - 140, // Centered horizontally (280 / 2)
            top: selectedLeadPoint.y - cardHeight - 58, // Sit above the 40px tall marker + 10px triangle + 8px gap
            zIndex: 1000,
          }}
          pointerEvents="auto"
        >
          <View
            onLayout={(e) => setCardHeight(e.nativeEvent.layout.height)}
            style={{
              backgroundColor: isDark ? '#1E1E1E' : 'white',
              borderRadius: 20,
              padding: loadingDetail ? 20 : 0,
              width: 280,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.3,
              shadowRadius: 20,
              elevation: 20,
              borderWidth: 1,
              borderColor: isDark ? '#333' : '#f1f5f9',
              minHeight: loadingDetail ? 100 : undefined,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {loadingDetail ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <ActivityIndicator size="small" color="#4CBB17" />
                <Text style={{ color: isDark ? '#ffffff' : '#1C252E', fontSize: 12, fontWeight: '700' }}>
                  Loading Job details...
                </Text>
              </View>
            ) : (
              <MapJobCard
                job={selectedLead}
                onClose={() => setSelectedLead(null)}
                isMyJob={isJobOwner(selectedLead, user)}
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
            )}

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


      {/* Back Button on Top Left Corner */}
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        className="absolute top-5 left-5 w-12 h-12 rounded-full bg-[#4cbb17] items-center justify-center shadow-xl"
        style={{ zIndex: 20 }}
      >
        <Icon name="arrow-left" size={24} color="white" />
      </TouchableOpacity>

      {/* Right Side Vertical Controls (Toggles) */}
      <View className="absolute bottom-[120px] right-5 gap-3 items-center" style={{ zIndex: 10 }}>
        <View className="gap-2">
          {[
            { active: 'HM', inactive: 'DEF', id: 'HT-0', type: 'heatmap' as const },
            { active: 'MJ', inactive: 'AJ', id: 'MJ-1', type: 'myjobs' as const },
            { active: 'RF', inactive: 'DEF', id: 'RF-2', type: 'referral' as const },
            { active: 'FV', inactive: 'star', id: 'FV-3', type: 'favorite' as const }
          ].map((btn) => {
            const isFilterActive = onToggleFilter
              ? (btn.type === 'heatmap' ? isHeatMapActive : btn.type === 'myjobs' ? isMyJobsOnly : btn.type === 'referral' ? isReferralOnly : isFavoriteOnly)
              : activeFilters.includes(btn.id);
            return (
              <MapToggleSwitch
                key={btn.id}
                value={isFilterActive}
                onValueChange={(val) => {
                  requestAnimationFrame(() => {
                    if (onToggleFilter) {
                      onToggleFilter(btn.type);
                    } else {
                      if (!val) setActiveFilters(activeFilters.filter(f => f !== btn.id));
                      else setActiveFilters([...activeFilters, btn.id]);
                    }
                  });
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
        isMyJob={isJobOwner(galleryJob, user)}
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
        isMyJob={isJobOwner(galleryJob, user)}
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
