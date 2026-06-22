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

import Mapbox, {
  MapView,
  Camera,
  ShapeSource,
  SymbolLayer,
  HeatmapLayer,
  LineLayer,
  MarkerView,
  Images,
} from '@rnmapbox/maps';
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

// Mapbox uses an access token initialized once at module load.
Mapbox.setAccessToken(ENV.MAPBOX_ACCESS_TOKEN);

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

// Boundary lock — same bounds as the web app Leaflet MAP_BOUNDS.
// Mapbox uses [longitude, latitude] order. SW [15, -180] NE [85, -40].
const MAP_BOUNDS = {
  ne: [-40, 85] as [number, number],
  sw: [-180, 15] as [number, number],
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
  const mapViewRef = useRef<MapView>(null);
  const cameraRef = useRef<Camera>(null);
  const zoomRef = useRef(10); // tracks current zoom for +/- buttons

  // ─── Data source ─────────────────────────────────────────────────────────
  // `internalLeads` is only used when no externalLeads prop is provided
  // (standalone LeadMap without MapDetail). When MapDetail passes `leads`,
  // we use that directly — synchronously — with NO intermediate setState.
  const [internalLeads, setInternalLeads] = useState<any[]>([]);
  const [dataVersion, setDataVersion] = useState(0); // increments on every data refresh

  const allLeads: any[] = externalLeads ?? internalLeads;

  const fetchAllJobs = async () => {
    try {
      setIsFetching(true);
      const res = await LeadService.findJobs({});
      const jobs = res.data?.data || [];
      setInternalLeads(jobs);
      setDataVersion((v) => v + 1);

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
  // bump the version so markers re-render and colors update.
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
  const [showRoute, setShowRoute] = useState(false);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryJob, setGalleryJob] = useState<any>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [activeFilters, setActiveFilters] = useState(['DEF-0', 'AJ-1', 'DEF-3']);

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
  }, [allLeads, user, isMyJobsOnly, isReferralOnly, isFavoriteOnly, externalLeads, dataVersion]);

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

  // Fast lookup of a job by id — markers only carry the id in their GeoJSON
  // properties (Mapbox flattens/serializes feature properties), so we resolve
  // the full lead object on press from this map.
  const leadsByIdRef = useRef<Map<string, any>>(new Map());
  useMemo(() => {
    const m = new Map<string, any>();
    filteredLeads.forEach(j => m.set(j._id, j));
    leadsByIdRef.current = m;
    return m;
  }, [filteredLeads]);

  // ─── Combined GeoJSON for all job markers ──────────────────────────────────
  // One FeatureCollection with a `category` property so a single SymbolLayer can
  // pick the right pin image. SymbolLayer renders thousands of points smoothly.
  const markersGeoJson = useMemo(() => {
    const toFeature = (job: any, category: string) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'Point' as const,
        coordinates: [Number(job.location.coordinates[0]), Number(job.location.coordinates[1])],
      },
      properties: { id: job._id, category },
    });

    const hasCoords = (job: any) => job.location?.coordinates && job.location.coordinates.length >= 2;

    return {
      type: 'FeatureCollection' as const,
      features: [
        ...defaultLeads.filter(hasCoords).map(j => toFeature(j, 'default')),
        ...favoriteLeads.filter(hasCoords).map(j => toFeature(j, 'favorite')),
        ...searchedLeads.filter(hasCoords).map(j => toFeature(j, 'searched')),
      ],
    };
  }, [defaultLeads, favoriteLeads, searchedLeads]);

  // ─── Heatmap GeoJSON ───────────────────────────────────────────────────────
  // Each point carries a numeric `weight` derived from price: a 0.3 baseline for
  // jobs under $5000, scaling up for higher-value jobs.
  const heatmapGeoJson = useMemo(() => {
    return {
      type: 'FeatureCollection' as const,
      features: filteredLeads
        .filter((l: any) => l.location?.coordinates && l.location.coordinates.length >= 2)
        .map((l: any) => {
          const price = l.price || 0;
          let intensity = 0.3; // baseline density for jobs under $5000
          if (price > 5000) {
            intensity = 0.3 + Math.min(1.2, ((price - 5000) / 15000) * 1.2);
          }
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [Number(l.location.coordinates[0]), Number(l.location.coordinates[1])],
            },
            properties: { weight: intensity },
          };
        }),
    };
  }, [filteredLeads]);


  useEffect(() => {
    requestLocationPermission();
  }, []);

  const requestLocationPermission = async () => {
    if (Platform.OS === 'ios') {
      try {
        await Geolocation.requestAuthorization('whenInUse');
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
      cameraRef.current?.setCamera({
        centerCoordinate: [currentLead.longitude, currentLead.latitude],
        zoomLevel: 13,
        animationDuration: 800,
      });
    }
  }, [currentLead]);

  useEffect(() => {
    if (focusLead?.location?.coordinates) {
      const coords = focusLead.location.coordinates;
      cameraRef.current?.setCamera({
        centerCoordinate: [Number(coords[0]), Number(coords[1]) + 0.003],
        zoomLevel: 14,
        animationDuration: 1000,
      });
      setSelectedLead(focusLead);
    }
  }, [focusLead]);

  const startTracking = (forceAnimate = false) => {
    const successCallback = (position: any) => {
      const { latitude, longitude } = position.coords;
      setUserLocation({ latitude, longitude });

      // Always animate to user's current location when opening map or clicking GPS
      cameraRef.current?.setCamera({
        centerCoordinate: [longitude, latitude],
        zoomLevel: 13,
        animationDuration: 600,
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

  // Guards against overlapping getPointInView() bridge calls when this is fired
  // rapidly from onCameraChanged during a camera animation.
  const pointUpdateInFlight = useRef(false);

  const updateSelectedPoint = async () => {
    if (selectedLead?.location?.coordinates && mapViewRef.current) {
      if (pointUpdateInFlight.current) return;
      pointUpdateInFlight.current = true;
      try {
        const point = await mapViewRef.current.getPointInView([
          Number(selectedLead.location.coordinates[0]),
          Number(selectedLead.location.coordinates[1]),
        ]);
        if (point) setSelectedLeadPoint({ x: point[0], y: point[1] });
      } catch (e) {
        // ignore
      } finally {
        pointUpdateInFlight.current = false;
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

      // Always bump version so markers re-render and update their colors
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

  const handleMarkerClick = (lead: any) => {
    const coords = lead.location?.coordinates;
    if (!coords) return;

    if (selectedLead?._id === lead._id) {
      setSelectedLead(null);
    } else {
      setSelectedLead(lead);
      cameraRef.current?.setCamera({
        centerCoordinate: [Number(coords[0]), Number(coords[1]) + 0.003], // shift center north to center card vertically
        zoomLevel: Math.max(zoomRef.current, 15.5),
        animationDuration: 600,
      });
    }
  };

  const handleMarkerClickRef = useRef<(job: any) => void>(handleMarkerClick);
  handleMarkerClickRef.current = handleMarkerClick;

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

  // Single tap handler for the whole map.
  //  • When pins are shown, we hit-test a generous rect around the tap point and
  //    resolve the closest marker. This is far more forgiving than relying on the
  //    icon's own (tiny, zoom-scaled) touch area, so taps no longer "sometimes"
  //    miss when zoomed out.
  //  • When the heatmap is active there are no pins, so a tap selects the closest
  //    lead within 2km.
  //  • Otherwise it deselects.
  const handleMapPress = useCallback(
    async (feature: any) => {
      const tap = feature?.geometry?.coordinates;
      const screenX = feature?.properties?.screenPointX;
      const screenY = feature?.properties?.screenPointY;

      // ── Pin hit-test ──────────────────────────────────────────────────────
      if (!isHeatMapActive && screenX != null && screenY != null && mapViewRef.current) {
        const HIT = 22; // px radius around the tap — comfortable finger target
        try {
          const fc = await mapViewRef.current.queryRenderedFeaturesInRect(
            [screenY - HIT, screenX + HIT, screenY + HIT, screenX - HIT], // [top, right, bottom, left]
            undefined,
            ['job-markers-symbols']
          );
          const features = fc?.features || [];
          if (features.length && tap) {
            // Pick the pin geographically closest to the tap point.
            let best: any = null;
            let bestD = Infinity;
            for (const f of features as any[]) {
              const c = f?.geometry?.coordinates;
              if (!c) continue;
              const d = (c[0] - tap[0]) ** 2 + (c[1] - tap[1]) ** 2;
              if (d < bestD) { bestD = d; best = f; }
            }
            const id = best?.properties?.id;
            const job = id ? leadsByIdRef.current.get(id) : null;
            if (job) {
              handleMarkerClickRef.current(job);
              return;
            }
          }
        } catch (e) {
          // fall through to deselect on any query failure
        }
      }

      if (isHeatMapActive && filteredLeads.length > 0) {
        const c = feature?.geometry?.coordinates;
        if (c) {
          const tapLng = c[0];
          const tapLat = c[1];
          let closestLead: any = null;
          let minDistance = Infinity;

          for (const lead of filteredLeads) {
            if (lead.location?.coordinates) {
              const leadLng = lead.location.coordinates[0];
              const leadLat = lead.location.coordinates[1];
              const distance = getDistanceInKm(tapLat, tapLng, leadLat, leadLng);
              if (distance < minDistance) {
                minDistance = distance;
                closestLead = lead;
              }
            }
          }

          if (closestLead && minDistance <= 2) {
            setSelectedLead(closestLead);
            cameraRef.current?.setCamera({
              centerCoordinate: [
                Number(closestLead.location.coordinates[0]),
                Number(closestLead.location.coordinates[1]) + 0.003,
              ],
              zoomLevel: Math.max(zoomRef.current, 15.5),
              animationDuration: 600,
            });
            return;
          }
        }
      }

      setSelectedLead(null);
    },
    [isHeatMapActive, filteredLeads]
  );

  const fetchRoute = async () => {
    if (!userLocation || !currentLead?.location?.coordinates) return;

    const start = `${userLocation.longitude},${userLocation.latitude}`;
    const end = `${currentLead.location.coordinates[0]},${currentLead.location.coordinates[1]}`;

    try {
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${start};${end}?geometries=geojson&access_token=${ENV.MAPBOX_ACCESS_TOKEN}`;
      const response = await fetch(url);
      const data = await response.json();

      if (data.routes && data.routes.length > 0) {
        // Mapbox LineLayer expects [lng, lat] coordinate pairs.
        const coords: [number, number][] = data.routes[0].geometry.coordinates.map(
          (c: any) => [c[0], c[1]] as [number, number]
        );
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

  const handleZoom = (delta: number) => {
    const next = Math.min(Math.max(zoomRef.current + delta, 0), 20);
    zoomRef.current = next;
    cameraRef.current?.zoomTo(next, 300);
  };

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
        ref={mapViewRef}
        style={StyleSheet.absoluteFillObject}
        styleURL={isDark ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Street}
        scaleBarEnabled={false}
        logoEnabled={true}
        compassEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onPress={handleMapPress}
        onCameraChanged={(e: any) => {
          if (e?.properties?.zoom != null) zoomRef.current = e.properties.zoom;
          // Keep the popup anchored to its marker throughout pan/zoom animations
          // (e.g. the zoom-in triggered when a marker is tapped), so it never gets
          // stranded mid-flight near the screen center.
          if (selectedLead) updateSelectedPoint();
        }}
        onMapIdle={() => {
          updateSelectedPoint();
        }}
      >
        <Camera
          ref={cameraRef}
          maxBounds={MAP_BOUNDS}
          maxZoomLevel={20}
          defaultSettings={{
            centerCoordinate: [TAMPA_COORDS.longitude, TAMPA_COORDS.latitude],
            zoomLevel: 10,
          }}
        />

        {/* Route line */}
        {routeCoordinates.length > 0 && (
          <ShapeSource
            id="route-source"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: routeCoordinates },
            }}
          >
            <LineLayer
              id="route-line"
              style={{
                lineColor: colors.primary.main,
                lineWidth: 4,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </ShapeSource>
        )}

        {/* Heatmap Layer — smooth, large-radius gradient matching the web app. */}
        {isHeatMapActive && heatmapGeoJson.features.length > 0 && (
          <ShapeSource id="heatmap-source" shape={heatmapGeoJson}>
            <HeatmapLayer
              id="heatmap-layer"
              sourceID="heatmap-source"
              style={{
                heatmapWeight: ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 1.5, 1],
                heatmapIntensity: ['interpolate', ['linear'], ['zoom'], 0, 1, 9, 2, 13, 3],
                heatmapRadius: ['interpolate', ['linear'], ['zoom'], 0, 18, 9, 30, 13, 45, 16, 60],
                heatmapOpacity: ['interpolate', ['linear'], ['zoom'], 7, 0.85, 16, 0.6],
                heatmapColor: [
                  'interpolate',
                  ['linear'],
                  ['heatmap-density'],
                  0, 'rgba(116, 192, 255, 0)',
                  0.15, 'rgba(116, 192, 255, 0.8)',
                  0.3, '#0072ff',
                  0.5, '#00c853',
                  0.7, '#ffab00',
                  0.85, '#ff6d00',
                  1, '#d50000',
                ],
              }}
            />
          </ShapeSource>
        )}

        {/* Pin marker images registered with the style for the SymbolLayer below. */}
        <Images
          images={{
            markerGreen: MARKER_IMAGES.default,
            markerRed: MARKER_IMAGES.searched,
            markerAmber: MARKER_IMAGES.favorite,
          }}
        />

        {/* Lead Markers — teardrop pins (green/amber/red) anchored at their tip,
             matching the previous Google Maps look. A single SymbolLayer renders
             thousands of points performantly. */}
        {!isHeatMapActive && markersGeoJson.features.length > 0 && (
          <ShapeSource id="job-markers-source" shape={markersGeoJson}>
            <SymbolLayer
              id="job-markers-symbols"
              style={{
                iconImage: [
                  'match',
                  ['get', 'category'],
                  'favorite', 'markerAmber',
                  'searched', 'markerRed',
                  /* default */ 'markerGreen',
                ],
                iconSize: ['interpolate', ['linear'], ['zoom'], 8, 0.7, 12, 0.9, 16, 1.1],
                iconAnchor: 'bottom',
                iconAllowOverlap: true,
                iconIgnorePlacement: true,
              }}
            />
          </ShapeSource>
        )}

        {/* User Location Marker */}
        {userLocation && (
          <MarkerView
            coordinate={[userLocation.longitude, userLocation.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View className="items-center justify-center">
              <View className="w-8 h-8 rounded-full bg-blue-500/20 border-2 border-white items-center justify-center shadow-lg">
                <View className="w-4 h-4 rounded-full bg-blue-500 border-2 border-white shadow-sm" />
              </View>
            </View>
          </MarkerView>
        )}

        {/* Location-search center marker */}
        {currentLead?.latitude && currentLead?.longitude && (
          <MarkerView
            coordinate={[currentLead.longitude, currentLead.latitude]}
            anchor={{ x: 0.5, y: 1 }}
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
          </MarkerView>
        )}
      </MapView>


      {selectedLead && selectedLeadPoint && (
        <View
          style={{
            position: 'absolute',
            left: selectedLeadPoint.x - 140, // Centered horizontally (280 / 2)
            top: selectedLeadPoint.y - cardHeight - 58, // Sit above the marker + triangle + gap
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
            onPress={() => handleZoom(1)}
            className="w-10 h-10 items-center justify-center border-b border-slate-100"
          >
            <Icon name="plus" size={24} color="#64748b" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleZoom(-1)}
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
          // In external-leads mode, bump dataVersion so markers re-render.
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
