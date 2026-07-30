/**
 * SalesLeadPins — the Sales Map's lead/job pins + tap-to-open job card, ported into
 * the Zone Canvasser's Mapbox map. It is a trimmed copy of `LeadMap.tsx`'s pin
 * machinery: same data source (`LeadService.findJobs`), same teardrop pin, same
 * `MapJobCard` popup and the same gallery / upload / referral secondary modals.
 *
 * Differences from the Sales Map (by request):
 *   - NO filter set — a single show/hide toggle drives everything (`enabled`).
 *   - All pins are the default green marker (the Sales Map only tints amber/red
 *     when its favorite/search filters are active, which we don't have here).
 *
 * The job card is a native `MarkerView` anchored CENTERED right above the tapped pin
 * (with a downward pointer), exactly like the Sales Map. On tap the camera flies to
 * `[lng, lat + 0.003]` at zoomLevel 14 — the same "shift center north to center the
 * card vertically" the Sales Map uses (`LeadMap.handleMarkerClick`) — so the card
 * lands centered on screen.
 *
 * Split into three exports because Mapbox layers must live INSIDE the `<MapView>`
 * while RN `<Modal>`s must NOT (same split `LeadMap` uses):
 *   - `useSalesMapPins`    — owns the state + data + handlers.
 *   - `SalesLeadPinsLayer` — Mapbox `Images`/`ShapeSource`/`SymbolLayer` + the
 *                            selected-lead `MarkerView` card. Render inside MapView.
 *   - `SalesLeadPinsModals`— the gallery/upload/referral modals. Render outside MapView.
 */
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

const MARKER_GREEN = require('../../../assets/images/map/marker-green.png');

// Zoom the camera flies to on pin tap — matches the Sales Map (`LeadMap`), which at
// this zoom lands the anchored card centered on screen. (Zoom 16 pushed it low.)
const PIN_FOCUS_ZOOM = 14;
// Zoom when the (already-open) card is tapped — matches the Sales Map's CARD_FOCUS_ZOOM.
const CARD_FOCUS_ZOOM = 15.5;

/** Job ownership check — same logic as `LeadMap.isJobOwner` (id then name match). */
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

/**
 * Owns the sales-pin state. Fetches all jobs once (the first time `enabled` is true —
 * i.e. the Zone Canvasser is open and the toggle is on), then keeps them; the toggle
 * only flips visibility, so switching it is instant and never re-fetches.
 */
export function useSalesMapPins({
  enabled,
  cameraRef,
}: {
  enabled: boolean;
  cameraRef: React.RefObject<Camera | null>;
}) {
  const { user } = useAuth();
  const [leads, setLeads] = useState<any[]>([]);
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [galleryJob, setGalleryJob] = useState<any>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showReferral, setShowReferral] = useState(false);
  const fetchedRef = useRef(false);
  // A single tap fires both ShapeSource.onPress AND MapView.onPress; this timestamp
  // guard makes a tap select-once and stops the map press deselecting right after.
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

  // Exclude the reserved TAM30000–30032 range (web/Sales-Map parity) and anything
  // without usable coordinates.
  const validLeads = useMemo(
    () =>
      leads.filter((l: any) => {
        const jn = l?.jobNumber;
        if (typeof jn === 'string' && jn.startsWith('TAM')) {
          const num = parseInt(jn.substring(3), 10);
          if (num >= 30000 && num <= 30032) return false;
        }
        return l?.location?.coordinates && l.location.coordinates.length >= 2;
      }),
    [leads]
  );

  // id → full lead: markers only carry the id in their (flattened) GeoJSON props,
  // so the tap handler resolves the full object from here.
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
        properties: { id: job._id },
      })),
    }),
    [validLeads]
  );

  // Keep the open card / gallery job pointing at the freshest data.
  useEffect(() => {
    if (selectedLead?._id) {
      const latest = validLeads.find((l: any) => l._id === selectedLead._id);
      if (latest && latest !== selectedLead) setSelectedLead(latest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validLeads]);

  // Toggling the pins off closes any open card.
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
      // Sales Map parity (`LeadMap.handleMarkerClick`): shift the center north so the
      // anchored card is centered vertically on screen.
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

  // Called from the MapView background press — dismiss the card unless a pin was
  // just tapped (the guard) so selecting a pin doesn't immediately close it.
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

/**
 * The Mapbox pin layer + selected-lead card. MUST be rendered as a child of the
 * Zone Canvasser `<MapView>`. `enabled` gates the SymbolLayer visibility + the card
 * (when off, the pins hide but the fetched data is retained by the hook).
 */
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

  // Card fade + scale in, delayed so the camera starts gliding first (LeadMap parity).
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
      {/* Pin image registered with the style for the SymbolLayer. */}
      <Images images={{ markerGreen: MARKER_GREEN }} />

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
              iconImage: 'markerGreen',
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

/**
 * The gallery / upload / referral modals opened from the job card. MUST be rendered
 * OUTSIDE the `<MapView>` (RN Modals can't live inside it) — same as `LeadMap`.
 */
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
