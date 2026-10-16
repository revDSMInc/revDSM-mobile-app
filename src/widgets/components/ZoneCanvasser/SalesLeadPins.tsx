import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { View, TouchableOpacity, Animated } from 'react-native';
import { ShapeSource, SymbolLayer, MarkerView, Images, Camera } from '@rnmapbox/maps';
import { MapJobCard } from '../LeadCenter/MapJobCard';
import { MapGalleryModal } from '../LeadCenter/MapGalleryModal';
import { JobImageUploadModal } from '../../modals/JobImageUploadModal';
import { ReferralModal } from '../../modals/ReferralModal';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';
import { useAuth } from '../../../hooks/useAuth';
import { useTheme } from '../../../theme/ThemeProvider';
import { logEvent } from '../../../services/api/LoggerService';
import { logMapPinSelected, logFavoriteJobClick } from '../../../utils/activity-log/map-activity-log';
import { getPinCategory, pinSortKeyExpression } from '../../../utils/sales-pins';
import { filterMapJobs } from '../../../utils/map-job-filters';
import type { FilterState } from '../../modals/MapFiltersModal';

const MARKER_GREEN = require('../../../assets/images/map/marker-green.png');
const MARKER_INSTALLED = require('../../../assets/images/map/marker-installed.png');
const MARKER_PENDING = require('../../../assets/images/map/marker-pending.png');
const PIN_SORT_KEY = pinSortKeyExpression();

const PIN_FOCUS_ZOOM = 14;
const CARD_FOCUS_ZOOM = 15.5;

const isJobOwner = (item: any, user: any): boolean => {
  if (!user || !item) return false;
  const uid = typeof user === 'string' ? user : user._id || user.id;
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
      if (userFullName && (repName === userFullName || repName === userFirstName)) return true;
    }
  }
  return false;
};

export type SalesMapPins = ReturnType<typeof useSalesMapPins>;

export function useSalesMapPins({
  enabled,
  cameraRef,
  filters,
  userLocation,
}: {
  enabled: boolean;
  cameraRef: React.RefObject<Camera | null>;
  /** The header filter's `MapFiltersModal` state; omitted/default = show every pin. */
  filters?: FilterState;
  userLocation?: { latitude: number; longitude: number } | null;
}) {
  const { user } = useAuth();
  const [leads, setLeads] = useState<any[]>([]);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [galleryJob, setGalleryJob] = useState<any>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const fetchedRef = useRef(false);
  const lastMarkerPressRef = useRef(0);

  const fetchAllJobs = useCallback(async () => {
    try {
      const res = await LeadService.findJobs({});
      const jobs = res.data?.data || [];
      setLeads(jobs);
      setSelectedLead((prev: any) => (prev?._id ? jobs.find((j: any) => j._id === prev._id) || prev : prev));
      setGalleryJob((prev: any) => (prev?._id ? jobs.find((j: any) => j._id === prev._id) || prev : prev));
    } catch (e) {
      console.error('[ZoneCanvasser] Failed to fetch sales jobs for pins', e);
    }
  }, []);

  useEffect(() => {
    if (enabled && !fetchedRef.current) {
      fetchedRef.current = true;
      fetchAllJobs();
    }
  }, [enabled, fetchAllJobs]);

  const filteredLeads = useMemo(
    () => (filters ? filterMapJobs(leads, filters, { user, userLocation }) : leads),
    [leads, filters, user, userLocation]
  );

  const validLeads = useMemo(
    () =>
      filteredLeads.filter((l: any) => {
        const jn = l?.jobNumber;
        if (typeof jn === 'string' && jn.startsWith('TAM')) {
          const num = parseInt(jn.substring(3), 10);
          if (num >= 30000 && num <= 30032) return false;
        }
        return l?.location?.coordinates && l.location.coordinates.length >= 2;
      }),
    [filteredLeads]
  );

  const leadsByIdRef = useRef<Map<string, any>>(new Map());
  useMemo(() => {
    const m = new Map<string, any>();
    validLeads.forEach((j: any) => m.set(j._id, j));
    leadsByIdRef.current = m;
    return m;
  }, [validLeads]);

  const markersGeoJson = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: validLeads.map((job: any) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [Number(job.location.coordinates[0]), Number(job.location.coordinates[1])],
        },
        properties: { id: job._id, category: getPinCategory(job) },
      })),
    }),
    [validLeads]
  );

  useEffect(() => {
    if (selectedLead?._id) {
      const latest = validLeads.find((l: any) => l._id === selectedLead._id);
      if (latest && latest !== selectedLead) setSelectedLead(latest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validLeads]);

  useEffect(() => {
    if (!enabled) setSelectedLead(null);
  }, [enabled]);

  const handleMarkerClick = useCallback(
    (lead: any) => {
      const coords = lead.location?.coordinates;
      if (!coords) return;
      if (selectedLead?._id === lead._id) {
        setSelectedLead(null);
        return;
      }
      setSelectedLead(lead);
      cameraRef.current?.setCamera({
        centerCoordinate: [Number(coords[0]), Number(coords[1]) + 0.003],
        zoomLevel: PIN_FOCUS_ZOOM,
        animationDuration: 600,
      });
      logMapPinSelected(user, { job: lead, coordinates: { lat: coords[1], lng: coords[0] } });
    },
    [selectedLead, cameraRef, user]
  );

  const onMarkerSourcePress = useCallback(
    (e: any) => {
      if (!enabled) return;
      if (Date.now() - lastMarkerPressRef.current < 400) return;
      lastMarkerPressRef.current = Date.now();
      const id = e?.features?.[0]?.properties?.id;
      const job = id ? leadsByIdRef.current.get(id) : null;
      if (job) handleMarkerClick(job);
    },
    [enabled, handleMarkerClick]
  );

  const onBackgroundPress = useCallback(() => {
    if (Date.now() - lastMarkerPressRef.current < 400) return;
    setSelectedLead((prev: any) => (prev ? null : prev));
  }, []);

  const handleToggleFavorite = useCallback(
    async (job: any) => {
      const nextValue = !(job.isFavourite || job.isFavorite);
      try {
        await LeadService.toggleFavourite(job._id, nextValue);
        await logFavoriteJobClick(user, job, nextValue);
        if (nextValue) FlashMessage.success('Job is added to favourite');
        else FlashMessage.info('Job is removed from favourite');
        setLeads((prev: any[]) =>
          prev.map((l) => (l._id === job._id ? { ...l, isFavourite: nextValue, isFavorite: nextValue } : l))
        );
        setSelectedLead((prev: any) =>
          prev && prev._id === job._id ? { ...prev, isFavourite: nextValue, isFavorite: nextValue } : prev
        );
      } catch (e) {
        console.error('[ZoneCanvasser] Failed to toggle favorite', e);
      }
    },
    [user]
  );

  const onGalleryPress = useCallback(() => {
    setGalleryJob(selectedLead);
    setShowGallery(true);
  }, [selectedLead]);

  const onCameraPress = useCallback(() => {
    setGalleryJob(selectedLead);
    setShowUpload(true);
    logEvent('view', {
      user_id: user?._id || user?.id,
      module_type: 'upload_before_after_images',
      created_by: user?._id || user?.id,
      meta: { job_number: selectedLead?.jobNumber, company_id: selectedLead?.companyId },
    });
  }, [selectedLead, user]);

  const onReferencePress = useCallback(() => {
    setGalleryJob(selectedLead);
    setShowReferral(true);
  }, [selectedLead]);

  return {
    user,
    markersGeoJson,
    selectedLead,
    setSelectedLead,
    onMarkerSourcePress,
    onBackgroundPress,
    handleToggleFavorite,
    isMyJob: (job: any) => isJobOwner(job, user),
    onGalleryPress,
    onCameraPress,
    onReferencePress,
    galleryJob,
    showGallery,
    setShowGallery,
    showUpload,
    setShowUpload,
    showReferral,
    setShowReferral,
    fetchAllJobs,
  };
}

export function SalesLeadPinsLayer({
  pins,
  enabled,
  cameraRef,
}: {
  pins: SalesMapPins;
  enabled: boolean;
  cameraRef: React.RefObject<Camera | null>;
}) {
  const { isDark } = useTheme();
  const {
    markersGeoJson,
    selectedLead,
    setSelectedLead,
    onMarkerSourcePress,
    handleToggleFavorite,
    isMyJob,
    onGalleryPress,
    onCameraPress,
    onReferencePress,
  } = pins;

  const cardAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (selectedLead?._id) {
      cardAnim.setValue(0);
      Animated.timing(cardAnim, { toValue: 1, duration: 280, delay: 220, useNativeDriver: true }).start();
    } else {
      cardAnim.setValue(0);
    }
  }, [selectedLead?._id, cardAnim]);

  const handleCardPress = useCallback(() => {
    const coords = selectedLead?.location?.coordinates;
    if (!coords) return;
    cameraRef.current?.setCamera({
      centerCoordinate: [Number(coords[0]), Number(coords[1]) + 0.003],
      zoomLevel: CARD_FOCUS_ZOOM,
      animationDuration: 500,
    });
  }, [selectedLead, cameraRef]);

  return (
    <>
      {/* Pin images registered with the style for the SymbolLayer. */}
      <Images
        images={{
          markerGreen: MARKER_GREEN,
          markerInstalled: MARKER_INSTALLED,
          markerPending: MARKER_PENDING,
        }}
      />

      {enabled && markersGeoJson.features.length > 0 && (
        <ShapeSource
          id="sales-lead-pins-source"
          shape={markersGeoJson}
          onPress={onMarkerSourcePress}
          hitbox={{ width: 44, height: 44 }}
        >
          <SymbolLayer
            id="sales-lead-pins-symbols"
            style={{
              iconImage: [
                'match',
                ['get', 'category'],
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

      {/* Pin-anchored popup — a native MarkerView glued to the marker, centered
          right above it with a downward pointer (Sales Map parity). The camera fly
          on tap lands this centered on screen. */}
      {enabled && selectedLead?.location?.coordinates && (
        <MarkerView
          id="sales-lead-card"
          coordinate={[
            Number(selectedLead.location.coordinates[0]),
            Number(selectedLead.location.coordinates[1]),
          ]}
          anchor={{ x: 0.5, y: 1 }}
          allowOverlap
        >
          <Animated.View
            style={{
              paddingBottom: 46,
              opacity: cardAnim,
              transform: [{ scale: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) }],
            }}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={handleCardPress}
              style={{
                backgroundColor: isDark ? '#1E1E1E' : 'white',
                borderRadius: 24,
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
                isMyJob={isMyJob(selectedLead)}
                showProduct
                onReferencePress={onReferencePress}
                onCameraPress={onCameraPress}
                onGalleryPress={onGalleryPress}
                onFavoritePress={handleToggleFavorite}
              />
              {/* Downward pointer triangle to the pin. */}
              <View
                style={{
                  position: 'absolute',
                  bottom: -10,
                  left: 130,
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
    </>
  );
}

export function SalesLeadPinsModals({ pins }: { pins: SalesMapPins }) {
  const {
    user,
    galleryJob,
    showGallery,
    setShowGallery,
    showUpload,
    setShowUpload,
    showReferral,
    setShowReferral,
    isMyJob,
    fetchAllJobs,
  } = pins;

  return (
    <>
      <MapGalleryModal
        visible={showGallery}
        job={galleryJob}
        isMyJob={isMyJob(galleryJob)}
        user={user}
        onClose={() => setShowGallery(false)}
        onUploadSuccess={fetchAllJobs}
      />
      <JobImageUploadModal
        visible={showUpload}
        onClose={() => setShowUpload(false)}
        selectedJob={galleryJob}
        onUploadSuccess={() => fetchAllJobs()}
      />
      <ReferralModal
        visible={showReferral}
        onClose={() => setShowReferral(false)}
        selectedJob={galleryJob}
        isMyJob={isMyJob(galleryJob)}
        onSuccess={() => fetchAllJobs()}
      />
    </>
  );
}
