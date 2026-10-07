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
  Animated,
  DeviceEventEmitter,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';
import { ENV } from '../../../config/env';
import { MapJobCard } from './MapJobCard';
import { useAuth } from '../../../hooks/useAuth';
import { logEvent } from '../../../services/api/LoggerService';
import { logFavoriteJobClick, logMapPinSelected } from '../../../utils/activity-log/map-activity-log';
import { getOfficeCoords, OFFICE_ZOOM } from '../../../utils/office-location';
import { MapGalleryModal } from './MapGalleryModal';
import { MapToggleSwitch } from '../../common/MapToggleSwitch';
import { JobImageUploadModal } from '../../modals/JobImageUploadModal';
import { ReferralModal } from '../../modals/ReferralModal';
import { MapLegendToggle } from '../ZoneCanvasser/MapLegend';
import {
  PIN_CATEGORY_META,
  countPinCategories,
  getPinCategory,
  jobNumberMatches,
  legendRows,
  pinSortKeyExpression,
} from '../../../utils/sales-pins';

const PIN_SORT_KEY = pinSortKeyExpression();

Mapbox.setAccessToken(ENV.MAPBOX_ACCESS_TOKEN);

const MARKER_IMAGES = {
  default: require('../../../assets/images/map/marker-green.png'),
  searched: require('../../../assets/images/map/marker-red.png'),
  favorite: require('../../../assets/images/map/marker-amber.png'),
  selected: require('../../../assets/images/map/marker-selected.png'),
  installed: require('../../../assets/images/map/marker-installed.png'),
  pendingInstall: require('../../../assets/images/map/marker-pending.png'),
};

const { width, height } = Dimensions.get('window');

const TAMPA_COORDS = {
  latitude: 27.9506,
  longitude: -82.4572,
};

const MAP_BOUNDS = {
  ne: [-40, 85] as [number, number],
  sw: [-180, 15] as [number, number],
};

const isWithinMapBounds = (longitude: number, latitude: number) =>
  longitude >= MAP_BOUNDS.sw[0] &&
  longitude <= MAP_BOUNDS.ne[0] &&
  latitude >= MAP_BOUNDS.sw[1] &&
  latitude <= MAP_BOUNDS.ne[1];

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
  isInstalledOnlyFilter?: boolean;
  isPendingInstallOnlyFilter?: boolean;
  onToggleFilter?: (
    filterType: 'heatmap' | 'myjobs' | 'referral' | 'favorite' | 'installed' | 'pendingInstall'
  ) => void;
  searchedJobNumber?: string;
  onFavoriteToggle?: (jobId: string, isFavorite: boolean) => void;
  showProduct?: boolean;
  isSatelliteView?: boolean;
  showRoute?: boolean;
  updatedJob?: any;
  focusOfficeOnOpen?: boolean;
  focusUserLocationOnOpen?: boolean;
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
  isInstalledOnlyFilter,
  isPendingInstallOnlyFilter,
  onToggleFilter,
  searchedJobNumber,
  onFavoriteToggle,
  showProduct = true,
  isSatelliteView = false,
  showRoute: showRouteProp = false,
  updatedJob,
  focusOfficeOnOpen = false,
  focusUserLocationOnOpen = false,
}: LeadMapProps) => {

  const navigation = useNavigation<any>();
  const { colors, isDark } = useTheme();
  const [isFetching, setIsFetching] = useState(false);
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const mapViewRef = useRef<MapView>(null);
  const cameraRef = useRef<Camera>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const zoomRef = useRef(10); // tracks current zoom for +/- buttons

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

  const prevLeadsHashRef = useRef('');
  useEffect(() => {
    if (externalLeads) {
      const currentHash = externalLeads.map(l => `${l._id}-${l.isFavourite || l.isFavorite}`).join(',');
      if (prevLeadsHashRef.current !== currentHash) {
        prevLeadsHashRef.current = currentHash;
        setDataVersion((v) => v + 1);
      }
    } else {
      fetchAllJobs();
    }
  }, [externalLeads]);

  const [userLocation, setUserLocation] = useState<any>(null);
  const [showRoute, setShowRoute] = useState(false);
  useEffect(() => {
    setShowRoute(showRouteProp);
  }, [showRouteProp]);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryJob, setGalleryJob] = useState<any>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const [activeFilters, setActiveFilters] = useState(['DEF-0', 'AJ-1', 'DEF-3']);

  useEffect(() => {
    if (selectedLead?._id) {
      const latest = allLeads.find((l: any) => l._id === selectedLead._id);
      if (latest && latest !== selectedLead) {
        setSelectedLead(latest);
      }
    }
    if (galleryJob?._id) {
      const latest = allLeads.find((l: any) => l._id === galleryJob._id);
      if (latest && latest !== galleryJob) {
        setGalleryJob(latest);
      }
    }
  }, [allLeads, selectedLead?._id, galleryJob?._id]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('OFFLINE_UPLOAD_SUCCESS', (data) => {
      if (!externalLeads) {
        fetchAllJobs();
      }
    });
    return () => sub.remove();
  }, [externalLeads]);

  useEffect(() => {
    if (updatedJob && selectedLead && updatedJob._id === selectedLead._id) {
      setSelectedLead(updatedJob);
    }
  }, [updatedJob, selectedLead]);

  const { isHeatMapActive, isMyJobsOnly, isReferralOnly, isFavoriteOnly, isInstalledOnly, isPendingOnly } = useMemo(() => {
    if (onToggleFilter) {
      return {
        isHeatMapActive: !!isHeatMapFilter,
        isMyJobsOnly: !!isMyJobsFilter,
        isReferralOnly: !!isReferralFilter,
        isFavoriteOnly: !!isFavoriteFilter,
        isInstalledOnly: !!isInstalledOnlyFilter,
        isPendingOnly: !!isPendingInstallOnlyFilter,
      };
    }
    return {
      isHeatMapActive: activeFilters.includes('HT-0'),
      isMyJobsOnly: activeFilters.includes('MJ-1'),
      isReferralOnly: activeFilters.includes('RF-2'),
      isFavoriteOnly: activeFilters.includes('FV-3') || !!isFavoriteFilter,
      isInstalledOnly: false,
      isPendingOnly: false,
    };
  }, [
    activeFilters,
    isFavoriteFilter,
    isReferralFilter,
    isMyJobsFilter,
    isHeatMapFilter,
    isInstalledOnlyFilter,
    isPendingInstallOnlyFilter,
    onToggleFilter,
  ]);

  const filteredLeads = useMemo(() => {
    let result = [...allLeads];

    result = result.filter((item: any) => {
      const jobNumber = item?.jobNumber;
      if (typeof jobNumber === 'string' && jobNumber.startsWith('TAM')) {
        const num = parseInt(jobNumber.substring(3), 10);
        if (num >= 30000 && num <= 30032) return false;
      }

      if (isMyJobsOnly) {
        const isOwner = isJobOwner(item, user);
        if (!isOwner) return false;
      }

      if (isReferralOnly) {
        const isMine = isJobOwner(item, user);
        const hasReferrals = item.jobReferrals && item.jobReferrals.length > 0;
        if (!hasReferrals) return false;

        if (!isMine) {
          const activeToggle = item.jobReferrals[0]?.referralToggle === true || item.jobReferrals[0]?.referralToggle === 'true';
          if (!activeToggle) return false;
        }
      }

      if (isFavoriteOnly) {
        const isFav = item.isFavorite === true || item.isFavourite === true;
        if (!isFav) return false;
      }

      return true;
    });

    return result;
  }, [allLeads, user, isMyJobsOnly, isReferralOnly, isFavoriteOnly, externalLeads, dataVersion]);

  const { searchedLeads, favoriteLeads, defaultLeads } = useMemo(() => {
    const searched: any[] = [];
    const favorites: any[] = [];
    const defaults: any[] = [];

    filteredLeads.forEach(job => {
      const isSearchedJob = !!searchedJobNumber && jobNumberMatches(job, searchedJobNumber);

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

  const leadsByIdRef = useRef<Map<string, any>>(new Map());
  useMemo(() => {
    const m = new Map<string, any>();
    filteredLeads.forEach(j => m.set(j._id, j));
    leadsByIdRef.current = m;
    return m;
  }, [filteredLeads]);

  const markersGeoJson = useMemo(() => {
    const defaultCategory = (job: any) => {
      const c = getPinCategory(job);
      return c === 'uploaded' ? 'default' : c;
    };
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
        ...defaultLeads.filter(hasCoords).map(j => toFeature(j, defaultCategory(j))),
        ...favoriteLeads.filter(hasCoords).map(j => toFeature(j, 'favorite')),
        ...searchedLeads.filter(hasCoords).map(j => toFeature(j, 'searched')),
      ],
    };
  }, [defaultLeads, favoriteLeads, searchedLeads]);

  const pinCategoryCounts = useMemo(
    () =>
      countPinCategories(
        filteredLeads.filter((j: any) => j.location?.coordinates && j.location.coordinates.length >= 2)
      ),
    [filteredLeads]
  );

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
      const hasLocation = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      if (hasLocation) {
        startTracking();
      } else {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        if (granted === PermissionsAndroid.RESULTS.GRANTED) {
          startTracking();
        }
      }
    }
  };

  useEffect(() => {
    if (currentLead?.location?.coordinates) {
      if (currentLead._id) {
        setSelectedLead(currentLead);
      }
    } else if (currentLead?.latitude && currentLead?.longitude) {
      cameraRef.current?.setCamera({
        centerCoordinate: [currentLead.longitude, currentLead.latitude],
        zoomLevel: 13,
        animationDuration: 800,
      });
    }
  }, [currentLead]);

  const officeCoords = useMemo(() => {
    const coords = getOfficeCoords(user);
    if (!coords) {
      if (focusOfficeOnOpen) {
        console.log('[LeadMap] No locatable office on the profile — opening on the rep instead.', {
          office: user?.office,
        });
      }
      return null;
    }
    if (!isWithinMapBounds(coords.longitude, coords.latitude)) {
      console.log('[LeadMap] Office coordinates are outside the map bounds — ignoring.', coords);
      return null;
    }
    if (focusOfficeOnOpen) {
      console.log('[LeadMap] Opening on office:', coords);
    }
    return coords;
  }, [user, focusOfficeOnOpen]);

  const hasExplicitTarget = !!(currentLead || focusLead);
  const hasSearchCenter = !!(
    focusLead ||
    (currentLead?.latitude != null && currentLead?.longitude != null && !currentLead?._id)
  );
  const didFrameOfficeRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const suppressInitialRecenterRef = useRef(false);

  const officeCoordsRef = useRef(officeCoords);

  useEffect(() => {
    officeCoordsRef.current = officeCoords;
    suppressInitialRecenterRef.current =
      (focusOfficeOnOpen && !!officeCoords && !hasExplicitTarget) ||
      (focusUserLocationOnOpen && hasSearchCenter);
  }, [focusOfficeOnOpen, focusUserLocationOnOpen, officeCoords, hasExplicitTarget, hasSearchCenter]);

  const defaultCameraSettings = useMemo(() => {
    if (focusOfficeOnOpen && officeCoords && !hasExplicitTarget) {
      return {
        centerCoordinate: [officeCoords.longitude, officeCoords.latitude],
        zoomLevel: OFFICE_ZOOM,
      };
    }
    return {
      centerCoordinate: [TAMPA_COORDS.longitude, TAMPA_COORDS.latitude],
      zoomLevel: 10,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!focusOfficeOnOpen || didFrameOfficeRef.current) return;
    if (hasExplicitTarget || !officeCoords) return;
    if (!mapReady) return;

    didFrameOfficeRef.current = true;
    cameraRef.current?.setCamera({
      centerCoordinate: [officeCoords.longitude, officeCoords.latitude],
      zoomLevel: OFFICE_ZOOM,
      animationMode: 'moveTo',
      animationDuration: 300,
    });
  }, [focusOfficeOnOpen, hasExplicitTarget, officeCoords, mapReady]);

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

  const didFocusUserRef = useRef(false);
  useEffect(() => {
    if (!focusUserLocationOnOpen || didFocusUserRef.current) return;
    if (!mapReady || !userLocation) return;
    const isSearchCenter =
      currentLead?.latitude != null && currentLead?.longitude != null && !currentLead?._id;
    const hasSearchTarget = !!(focusLead || isSearchCenter);
    if (hasSearchTarget) return;
    if (!isWithinMapBounds(userLocation.longitude, userLocation.latitude)) return;
    didFocusUserRef.current = true;
    cameraRef.current?.setCamera({
      centerCoordinate: [userLocation.longitude, userLocation.latitude],
      zoomLevel: 13,
      animationMode: 'moveTo',
      animationDuration: 400,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusUserLocationOnOpen, mapReady, userLocation, focusLead, currentLead?._id, currentLead?.latitude, currentLead?.longitude]);

  const startTracking = (forceAnimate = false) => {
    const successCallback = (position: any) => {
      const { latitude, longitude } = position.coords;
      setUserLocation({ latitude, longitude });

      if (!forceAnimate && suppressInitialRecenterRef.current) return;

      if (!isWithinMapBounds(longitude, latitude)) {
        console.log('[LeadMap] Current position is outside the map bounds — not recentring.', {
          latitude,
          longitude,
        });
        if (officeCoordsRef.current) {
          cameraRef.current?.setCamera({
            centerCoordinate: [
              officeCoordsRef.current.longitude,
              officeCoordsRef.current.latitude,
            ],
            zoomLevel: OFFICE_ZOOM,
            animationMode: 'moveTo',
            animationDuration: 300,
          });
        } else if (forceAnimate) {
          FlashMessage.warning('Your current location is outside the coverage area');
        }
        return;
      }

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

    Geolocation.getCurrentPosition(
      successCallback,
      errorCallback,
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
    );
  };

  const [loadingDetail, setLoadingDetail] = useState(false);

  const cardAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (selectedLead?._id) {
      cardAnim.setValue(0);
      Animated.timing(cardAnim, {
        toValue: 1,
        duration: 280,
        delay: 220,
        useNativeDriver: true,
      }).start();
    } else {
      cardAnim.setValue(0);
    }
  }, [selectedLead?._id, cardAnim]);

  useEffect(() => {
    if (selectedLead && !filteredLeads.some(job => job._id === selectedLead._id)) {
      setSelectedLead(null);
    }
  }, [filteredLeads, selectedLead]);

  const handleToggleFavorite = async (job: any) => {
    const nextValue = !(job.isFavourite || job.isFavorite);
    try {
      await LeadService.toggleFavourite(job._id, nextValue);

      await logFavoriteJobClick(user, job, nextValue);

      if (nextValue) {
        FlashMessage.success('Job is added to favourite');
      } else {
        FlashMessage.info('Job is removed from favourite');
      }

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
        zoomLevel: 14,
        animationDuration: 600,
      });

      const targetLat = coords[1];
      const targetLng = coords[0];
      logMapPinSelected(user, {
        job: lead,
        coordinates: { lat: targetLat, lng: targetLng },
        userLocation,
        currentLead,
      });
    }
  };

  const handleMarkerClickRef = useRef<(job: any) => void>(handleMarkerClick);
  handleMarkerClickRef.current = handleMarkerClick;

  const lastMarkerPressRef = useRef(0);

  const selectJob = (job: any) => {
    lastMarkerPressRef.current = Date.now();
    handleMarkerClickRef.current(job);
  };

  const onMarkerSourcePress = useCallback((e: any) => {
    if (isHeatMapActive) return;
    if (Date.now() - lastMarkerPressRef.current < 400) return;
    const id = e?.features?.[0]?.properties?.id;
    const job = id ? leadsByIdRef.current.get(id) : null;
    if (job) selectJob(job);
  }, [isHeatMapActive]);

  const CARD_FOCUS_ZOOM = 15.5;
  const handleCardPress = useCallback(() => {
    if (!selectedLead?.location?.coordinates) return;
    if (zoomRef.current >= CARD_FOCUS_ZOOM - 0.05) return; // already zoomed in
    const coords = selectedLead.location.coordinates;
    cameraRef.current?.setCamera({
      centerCoordinate: [Number(coords[0]), Number(coords[1]) + 0.003],
      zoomLevel: CARD_FOCUS_ZOOM,
      animationDuration: 600,
    });
  }, [selectedLead]);

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

  const handleMapPress = useCallback(
    (feature: any) => {
      if (Date.now() - lastMarkerPressRef.current < 400) return;

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
              zoomLevel: 14,
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

  const isNearSearchedLocation = (jobLat: number, jobLng: number) => {
    if (!currentLead?.latitude || !currentLead?.longitude) return false;
    const dist = getDistanceInKm(jobLat, jobLng, currentLead.latitude, currentLead.longitude);
    return dist <= 2;
  };

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
        styleURL={
          isSatelliteView
            ? Mapbox.StyleURL.SatelliteStreet
            : isDark
              ? Mapbox.StyleURL.Dark
              : Mapbox.StyleURL.Street
        }
        scaleBarEnabled={false}
        logoEnabled={true}
        compassEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onPress={handleMapPress}
        onDidFinishLoadingMap={() => setMapReady(true)}
        onCameraChanged={(e: any) => {
          if (e?.properties?.zoom != null) zoomRef.current = e.properties.zoom;
        }}
      >
        <Camera
          ref={cameraRef}
          maxBounds={MAP_BOUNDS}
          maxZoomLevel={20}
          defaultSettings={defaultCameraSettings}
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

        {/* Heatmap Layer — smooth, large-radius gradient matching the web app.
             Kept mounted at all times; we only flip `visibility` on toggle so
             switching modes is instant instead of rebuilding the native layer. */}
        {heatmapGeoJson.features.length > 0 && (
          <ShapeSource id="heatmap-source" shape={heatmapGeoJson}>
            <HeatmapLayer
              id="heatmap-layer"
              sourceID="heatmap-source"
              style={{
                visibility: isHeatMapActive ? 'visible' : 'none',
                heatmapWeight: ['interpolate', ['linear'], ['get', 'weight'], 0, 0, 1.5, 1],
                heatmapIntensity: ['interpolate', ['linear'], ['zoom'], 0, 0.25, 9, 0.38, 13, 0.5, 16, 0.6],
                heatmapRadius: ['interpolate', ['linear'], ['zoom'], 0, 16, 9, 22, 13, 40, 16, 60],
                heatmapOpacity: ['interpolate', ['linear'], ['zoom'], 7, 0.9, 16, 0.7],
                heatmapColor: [
                  'interpolate',
                  ['linear'],
                  ['heatmap-density'],
                  0, 'rgba(0, 0, 255, 0)',
                  0.15, 'rgba(0, 0, 255, 0.7)',
                  0.3, 'rgba(0, 255, 255, 0.8)',
                  0.45, 'rgba(0, 255, 0, 0.85)',
                  0.6, 'rgba(255, 255, 0, 0.9)',
                  0.75, 'rgba(255, 165, 0, 0.95)',
                  1, 'rgba(255, 0, 0, 1)',
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
            markerInstalled: MARKER_IMAGES.installed,
            markerPending: MARKER_IMAGES.pendingInstall,
          }}
        />

        {/* Lead Markers — teardrop pins (green/amber/red) anchored at their tip,
             matching the previous Google Maps look. A single SymbolLayer renders
             thousands of points performantly. Kept mounted with `visibility`
             toggled (instant heatmap switch) and an enlarged hitbox so taps land
             reliably at any zoom. */}
        {markersGeoJson.features.length > 0 && (
          <ShapeSource
            id="job-markers-source"
            shape={markersGeoJson}
            onPress={onMarkerSourcePress}
            hitbox={{ width: 44, height: 44 }}
          >
            <SymbolLayer
              id="job-markers-symbols"
              style={{
                visibility: isHeatMapActive ? 'none' : 'visible',
                iconImage: [
                  'match',
                  ['get', 'category'],
                  'favorite', 'markerAmber',
                  'searched', 'markerRed',
                  'installed', 'markerInstalled',
                  'pendingInstall', 'markerPending',
                  'markerGreen',
                ],
                symbolSortKey: PIN_SORT_KEY,
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

        {/* Pin-anchored popup — rendered as a native MarkerView so it stays glued
             to the marker through any pan/zoom (no JS projection, no lag). Sits
             directly above the marker with a downward pointer triangle, and
             fades/scales in smoothly after the camera glides to the marker. */}
        {selectedLead?.location?.coordinates && (
          <MarkerView
            id="selected-lead-card"
            coordinate={[
              Number(selectedLead.location.coordinates[0]),
              Number(selectedLead.location.coordinates[1]),
            ]}
            anchor={{ x: 0.5, y: 1 }}
            allowOverlap
          >
            <Animated.View
              style={{
                paddingBottom: 46, // lift the card above the pin + leave room for the triangle
                opacity: cardAnim,
                transform: [
                  { scale: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                ],
              }}
            >
              <TouchableOpacity
                activeOpacity={1}
                onPress={handleCardPress}
                style={{
                  backgroundColor: isDark ? '#1E1E1E' : 'white',
                  borderRadius: 24,
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
                    showProduct={showProduct}
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
                      logEvent('view', {
                        user_id: user?._id || user?.id,
                        module_type: 'upload_before_after_images',
                        created_by: user?._id || user?.id,
                        meta: {
                          job_number: selectedLead?.jobNumber,
                          company_id: selectedLead?.companyId,
                        },
                      });
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

                {/* Anchor Triangle pointing down to the marker */}
                <View
                  style={{
                    position: 'absolute',
                    bottom: -10,
                    left: 130, // centered (140 - 10)
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
              </TouchableOpacity>
            </Animated.View>
          </MarkerView>
        )}
      </MapView>


      {/* Back Button on Top Left Corner */}
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        className="absolute top-5 left-5 w-12 h-12 rounded-full bg-[#4cbb17] items-center justify-center shadow-xl"
        style={{ zIndex: 20 }}
      >
        <Icon name="arrow-left" size={24} color="white" />
      </TouchableOpacity>

      {/* Right Side Vertical Controls (Toggles) — TOP-right, not bottom.
          Ticket: "change the toggle position from bottom to top." Offset clears the
          status bar / notch via `insets.top` (same pattern the old `bottom` position
          used with `insets.bottom`) plus enough margin for the screen's own header
          overlay (back button top-left, list/filter icons from `HeaderContext` — see
          `widgets/common/MainHeader.tsx`) so the stack doesn't start under it. */}
      <View 
        className="absolute right-5 gap-3 items-center" 
        style={{ 
          zIndex: 10,
          top: Platform.OS === 'android' ? 100 + insets.top : 100,
        }}
      >
        <View className="gap-2">
          {(
            [
              {
                active: 'INS', inactive: 'DEF', id: 'IN-4', type: 'installed' as const,
                activeColor: PIN_CATEGORY_META.installed.color,
              },
              {
                active: 'PI', inactive: 'DEF', id: 'PD-5', type: 'pendingInstall' as const,
                activeColor: PIN_CATEGORY_META.pendingInstall.color,
                activeDotColor: '#FFF176',
                activeLabelColor: '#1C252E',
              },
              { active: 'HM', inactive: 'DEF', id: 'HT-0', type: 'heatmap' as const },
              { active: 'MJ', inactive: 'AJ', id: 'MJ-1', type: 'myjobs' as const },
              { active: 'RF', inactive: 'DEF', id: 'RF-2', type: 'referral' as const },
              { active: 'FV', inactive: 'star', id: 'FV-3', type: 'favorite' as const },
            ] as Array<{
              active: string;
              inactive: string;
              id: string;
              type: 'heatmap' | 'myjobs' | 'referral' | 'favorite' | 'installed' | 'pendingInstall';
              activeColor?: string;
              activeDotColor?: string;
              activeLabelColor?: string;
            }>
          ).map((btn) => {
            const isFilterActive = onToggleFilter
              ? (btn.type === 'heatmap' ? isHeatMapActive
                : btn.type === 'myjobs' ? isMyJobsOnly
                : btn.type === 'referral' ? isReferralOnly
                : btn.type === 'favorite' ? isFavoriteOnly
                : btn.type === 'installed' ? isInstalledOnly
                : isPendingOnly)
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
                activeColor={btn.activeColor}
                activeDotColor={btn.activeDotColor}
                activeLabelColor={btn.activeLabelColor}
              />
            );
          })}
        </View>
      </View>

      {/* Bottom-left: pin-colour legend (same pattern as the footsteps map — palette
          button, card opens IN FLOW above it, button becomes a close ✕ while open).
          In flow rather than an absolute popover off the button so the ✕ stays inside
          its parent's bounds — Android does not deliver touches outside them.
          Hidden with the pins in heatmap mode. */}
      {!isHeatMapActive && (
        <View
          className="absolute left-6"
          style={{
            zIndex: 10,
            bottom: Platform.OS === 'android' ? 40 + insets.bottom : 40,
          }}
          pointerEvents="box-none"
        >
          {legendOpen && (
            <View
              style={{
                alignSelf: 'flex-start',
                minWidth: 170,
                marginBottom: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 12,
                gap: 6,
                backgroundColor: isDark ? 'rgba(30,30,30,0.96)' : '#FFFFFF',
                borderWidth: 1,
                borderColor: isDark ? '#333' : '#e2e8f0',
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.15,
                shadowRadius: 4,
                elevation: 6,
              }}
            >
              {/* Uploaded merged into Installed here — the two pins are colour- and
                  shape-identical on the map now, so a separate "Uploaded" row was
                  explaining a distinction the rep can no longer see. See `legendRows`. */}
              {legendRows(pinCategoryCounts).map((row) => (
                <View key={row.key} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: row.color,
                      marginRight: 8,
                    }}
                  />
                  <Text
                    numberOfLines={1}
                    style={{ flex: 1, fontSize: 12, fontWeight: '700', color: isDark ? '#e2e8f0' : '#334155' }}
                  >
                    {row.label}
                  </Text>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: isDark ? '#ffffff' : '#0f172a', marginLeft: 12 }}>
                    {row.count}
                  </Text>
                </View>
              ))}
            </View>
          )}
          <View className="self-start">
            <MapLegendToggle open={legendOpen} onPress={() => setLegendOpen((prev) => !prev)} />
          </View>
        </View>
      )}

      {/* Bottom Right Controls (GPS & Zoom) */}
      <View 
        className="absolute right-6 flex-row items-end gap-3" 
        style={{ 
          zIndex: 10,
          bottom: Platform.OS === 'android' ? 40 + insets.bottom : 40,
        }}
      >
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
        user={user}
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
        onSuccess={(referralData) => {
          setGalleryJob((prev: any) => {
            if (!prev) return prev;
            const existing: any[] = prev.jobReferrals || [];
            const idx = existing.findIndex((r: any) => r._id === referralData._id);
            const updated =
              idx >= 0
                ? existing.map((r: any) => (r._id === referralData._id ? referralData : r))
                : [referralData, ...existing];
            return { ...prev, jobReferrals: updated };
          });

          setInternalLeads((prev: any[]) =>
            prev.map((job: any) => {
              if (job._id !== galleryJob?._id) return job;
              const existing: any[] = job.jobReferrals || [];
              const idx = existing.findIndex((r: any) => r._id === referralData._id);
              const updated =
                idx >= 0
                  ? existing.map((r: any) => (r._id === referralData._id ? referralData : r))
                  : [referralData, ...existing];
              return { ...job, jobReferrals: updated };
            })
          );

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
