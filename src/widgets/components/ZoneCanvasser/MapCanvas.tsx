import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Mapbox, {
  MapView,
  Camera,
  ShapeSource,
  FillLayer,
  LineLayer,
  CircleLayer,
  MarkerView,
  UserLocation,
} from '@rnmapbox/maps';
import type { Region } from 'react-native-maps';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import type Supercluster from 'supercluster';
import { ENV } from '../../../config/env';
import {
  clusterBuildings,
  getClusterExpansionZoom,
} from '../../../utils/zone-canvasser-cluster';
import type { MapCoordinate, ZoneCanvasserBuilding } from '../../../types/zone-canvasser';
import { BuildingMapMarker } from './BuildingMapMarker';
import { ClusterMapMarker } from './ClusterMapMarker';
import { UserLocationMarker } from './UserLocationMarker';
import { useSalesMapPins, SalesLeadPinsLayer, SalesLeadPinsModals } from './SalesLeadPins';

// Mapbox access token (idempotent — safe to set from multiple map screens).
Mapbox.setAccessToken(ENV.MAPBOX_ACCESS_TOKEN);

type Props = {
  mapRef: React.RefObject<MapView | null>;
  cameraRef: React.RefObject<Camera | null>;
  mapType: 'standard' | 'satellite';
  initialRegion: any;
  isDrawingMode: boolean;
  drawType: 'polygon' | 'rectangle';
  drawCoordinates: MapCoordinate[];
  zones: any[];
  allBuildings: ZoneCanvasserBuilding[];
  searchCoords: MapCoordinate | null;
  /** Web `searchAddress` — shown in a callout when the search pin is tapped. */
  searchAddress?: string;
  liveLocation?: {
    latitude: number;
    longitude: number;
    heading: number | null;
    accuracy: number | null;
  } | null;
  onMapPress: (e: any) => void;
  onBuildingPress: (building: ZoneCanvasserBuilding) => void;
  onPolygonPress: (zone: any) => void;
  onTouchStart: (e: any) => void;
  onTouchMove: (e: any) => void;
  onTouchEnd: () => void;
  onRegionChangeComplete?: (region: Region) => void;
  /** Show the Sales Map lead/job pins overlay (single show/hide toggle). Also gates
   *  the one-time job fetch, so nothing is requested until the Zone Canvasser is
   *  open AND the toggle is on. */
  leadPinsEnabled?: boolean;
};

const DEFAULT_REGION: Region = {
  latitude: 27.9506,
  longitude: -82.4572,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

/** Region latitudeDelta → Mapbox zoom level. */
function regionToZoomLevel(region: Region): number {
  const latDelta = region.latitudeDelta > 0 ? region.latitudeDelta : 0.0922;
  return Math.max(0, Math.min(20, Math.log2(360 / latDelta)));
}

/** Zone polygon as a closed ring of [lng, lat] pairs for Mapbox. */
function getZoneRing(zone: any): [number, number][] {
  let ring: [number, number][] = [];
  if (zone.geoJSON?.geometry?.coordinates) {
    // geoJSON coordinates are already [lng, lat]
    ring = zone.geoJSON.geometry.coordinates[0].map(
      (c: any) => [c[0], c[1]] as [number, number]
    );
  } else if (zone.coordinates) {
    // zone.coordinates are [lat, lng]
    ring = zone.coordinates.map((c: any) => [c[1], c[0]] as [number, number]);
  }
  if (ring.length >= 3) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
  }
  return ring;
}

export function MapCanvas({
  mapRef,
  cameraRef,
  mapType,
  initialRegion,
  isDrawingMode,
  drawType,
  drawCoordinates,
  zones,
  allBuildings,
  searchCoords,
  searchAddress = '',
  liveLocation,
  onMapPress,
  onBuildingPress,
  onPolygonPress,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onRegionChangeComplete,
  leadPinsEnabled = false,
}: Props) {
  const rectangleDrawing = isDrawingMode && drawType === 'rectangle';
  // Sales Map lead pins overlay (single show/hide toggle). Owns its own state/data.
  // Suppressed while drawing a zone so pin taps can't steal polygon-vertex taps
  // (the building/cluster markers are hidden the same way).
  const salesPinsEnabled = leadPinsEnabled && !isDrawingMode;
  const salesPins = useSalesMapPins({ enabled: salesPinsEnabled, cameraRef });
  const [mapRegion, setMapRegion] = useState<Region>(
    initialRegion ?? DEFAULT_REGION
  );
  const clusterIndexRef = useRef<Supercluster | null>(null);
  // Web: the search pin's address popup is closed for every fresh search and opens
  // only when the pin itself is tapped.
  const [searchPopupOpen, setSearchPopupOpen] = useState(false);
  useEffect(() => {
    setSearchPopupOpen(false);
  }, [searchCoords]);

  const cameraDefault = useMemo(() => {
    const r: Region = initialRegion ?? DEFAULT_REGION;
    return {
      centerCoordinate: [r.longitude, r.latitude] as [number, number],
      zoomLevel: regionToZoomLevel(r),
    };
  }, [initialRegion]);

  const handleRegionChangeComplete = useCallback(
    (region: Region) => {
      setMapRegion(region);
      onRegionChangeComplete?.(region);
    },
    [onRegionChangeComplete]
  );

  // Mapbox fires onCameraChanged/onMapIdle instead of onRegionChangeComplete.
  // Synthesize a react-native-maps Region (center + deltas) from the camera
  // bounds so the existing supercluster logic keeps working unchanged.
  const handleMapIdle = useCallback(
    async (state: any) => {
      try {
        let region: Region | null = null;
        const props = state?.properties;
        if (props?.bounds?.ne && props?.bounds?.sw && props?.center) {
          const ne = props.bounds.ne; // [lng, lat]
          const sw = props.bounds.sw; // [lng, lat]
          region = {
            latitude: props.center[1],
            longitude: props.center[0],
            latitudeDelta: Math.abs(ne[1] - sw[1]),
            longitudeDelta: Math.abs(ne[0] - sw[0]),
          };
        } else if (mapRef.current) {
          const bounds = await mapRef.current.getVisibleBounds(); // [[neLng,neLat],[swLng,swLat]]
          const center = await mapRef.current.getCenter(); // [lng, lat]
          if (bounds && center) {
            region = {
              latitude: center[1],
              longitude: center[0],
              latitudeDelta: Math.abs(bounds[0][1] - bounds[1][1]),
              longitudeDelta: Math.abs(bounds[0][0] - bounds[1][0]),
            };
          }
        }
        if (region) handleRegionChangeComplete(region);
      } catch (err) {
        // ignore — keep last region
      }
    },
    [handleRegionChangeComplete, mapRef]
  );

  const clusteredMarkers = useMemo(() => {
    const region = mapRegion ?? initialRegion ?? DEFAULT_REGION;
    const { clusters, index } = clusterBuildings(allBuildings, region);
    clusterIndexRef.current = index;
    return clusters;
  }, [allBuildings, mapRegion, initialRegion]);

  const handleClusterPress = useCallback(
    (clusterId: number, buildings: ZoneCanvasserBuilding[]) => {
      const index = clusterIndexRef.current;
      if (index) {
        const expansionZoom = getClusterExpansionZoom(index, clusterId);
        const centerLat =
          buildings.reduce((s, b) => s + b.position[0], 0) / buildings.length;
        const centerLng =
          buildings.reduce((s, b) => s + b.position[1], 0) / buildings.length;

        cameraRef.current?.setCamera({
          centerCoordinate: [centerLng, centerLat],
          zoomLevel: Math.min(20, expansionZoom + 1),
          animationDuration: 400,
        });
        return;
      }

      if (buildings.length > 0) {
        let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
        buildings.forEach((b) => {
          minLat = Math.min(minLat, b.position[0]);
          maxLat = Math.max(maxLat, b.position[0]);
          minLng = Math.min(minLng, b.position[1]);
          maxLng = Math.max(maxLng, b.position[1]);
        });
        cameraRef.current?.fitBounds(
          [maxLng, maxLat],
          [minLng, minLat],
          [100, 60, 120, 60],
          400
        );
      }
    },
    [cameraRef]
  );

  // Polygon-mode taps come through Mapbox as a GeoJSON feature; adapt to the
  // { nativeEvent: { coordinate } } shape the hook's handleMapPress expects.
  const handleMapboxPress = useCallback(
    (feature: any) => {
      // A background tap dismisses the open lead-pin card (guarded so tapping a pin
      // doesn't immediately close it), then runs the existing zone/building logic.
      salesPins.onBackgroundPress();
      const c = feature?.geometry?.coordinates;
      if (!c) return;
      onMapPress({ nativeEvent: { coordinate: { latitude: c[1], longitude: c[0] } } });
    },
    [onMapPress, salesPins]
  );

  // ─── Zones → FillLayer + LineLayer ─────────────────────────────────────────
  const zonesById = useRef<Map<string, any>>(new Map());
  const zonesFC = useMemo(() => {
    const map = new Map<string, any>();
    const features = (Array.isArray(zones) ? zones : [])
      .map((zone) => {
        const ring = getZoneRing(zone);
        if (ring.length < 4) return null; // need closed ring (>=3 distinct + closure)
        const id = String(zone._id || zone.zoneId);
        map.set(id, zone);
        return {
          type: 'Feature' as const,
          id,
          properties: { id, color: zone.color || '#99FFB1' },
          geometry: { type: 'Polygon' as const, coordinates: [ring] },
        };
      })
      .filter(Boolean) as any[];
    zonesById.current = map;
    return { type: 'FeatureCollection' as const, features };
  }, [zones]);

  const handleZonePress = useCallback(
    (event: any) => {
      const id = event?.features?.[0]?.properties?.id;
      const zone = id ? zonesById.current.get(id) : null;
      if (zone) onPolygonPress(zone);
    },
    [onPolygonPress]
  );

  // ─── Draft drawing geometry ────────────────────────────────────────────────
  const draftLineCoords = useMemo(
    () =>
      drawCoordinates
        .filter((c) => c?.latitude != null && c?.longitude != null)
        .map((c) => [c.longitude, c.latitude] as [number, number]),
    [drawCoordinates]
  );

  const draftDotsFC = useMemo(
    () => ({
      type: 'FeatureCollection' as const,
      features: draftLineCoords.map((coordinates, idx) => ({
        type: 'Feature' as const,
        id: `draft-dot-${idx}`,
        properties: {},
        geometry: { type: 'Point' as const, coordinates },
      })),
    }),
    [draftLineCoords]
  );

  return (
    <View className="flex-1 relative" style={{ flex: 1 }}>
      <View
        style={StyleSheet.absoluteFillObject}
        onStartShouldSetResponder={() => rectangleDrawing}
        onMoveShouldSetResponder={() => rectangleDrawing}
        onResponderGrant={onTouchStart}
        onResponderMove={onTouchMove}
        onResponderRelease={onTouchEnd}
      >
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          styleURL={mapType === 'satellite' ? Mapbox.StyleURL.SatelliteStreet : Mapbox.StyleURL.Street}
          onPress={handleMapboxPress}
          onMapIdle={handleMapIdle}
          scaleBarEnabled={false}
          logoEnabled={true}
          attributionEnabled={true}
          scrollEnabled={!rectangleDrawing}
          zoomEnabled={!rectangleDrawing}
          pitchEnabled={!rectangleDrawing}
          rotateEnabled={!rectangleDrawing}
        >
          <Camera ref={cameraRef} defaultSettings={cameraDefault} />
          {/* Custom live blue-dot marker (web parity: user-location-marker.js). Falls
              back to Mapbox's native dot until the first live fix arrives. */}
          {liveLocation ? (
            <UserLocationMarker
              latitude={liveLocation.latitude}
              longitude={liveLocation.longitude}
              heading={liveLocation.heading}
              accuracy={liveLocation.accuracy}
            />
          ) : (
            <UserLocation visible={true} />
          )}

          {/* Saved zones */}
          {!isDrawingMode && zonesFC.features.length > 0 && (
            <ShapeSource id="zones-source" shape={zonesFC} onPress={handleZonePress}>
              <FillLayer
                id="zones-fill"
                style={{ fillColor: ['get', 'color'], fillOpacity: 0.19 }}
              />
              <LineLayer
                id="zones-line"
                style={{ lineColor: ['get', 'color'], lineWidth: 2 }}
              />
            </ShapeSource>
          )}

          {/* Draft drawing (in-progress zone) */}
          {isDrawingMode && draftLineCoords.length > 0 && (
            <>
              {draftLineCoords.length >= 3 && (
                <ShapeSource
                  id="draft-fill-source"
                  shape={{
                    type: 'Feature',
                    properties: {},
                    geometry: {
                      type: 'Polygon',
                      coordinates: [[...draftLineCoords, draftLineCoords[0]]],
                    },
                  }}
                >
                  <FillLayer
                    id="draft-fill"
                    style={{ fillColor: 'rgba(255, 86, 48, 0.2)' }}
                  />
                </ShapeSource>
              )}
              <ShapeSource
                id="draft-line-source"
                shape={{
                  type: 'Feature',
                  properties: {},
                  geometry: { type: 'LineString', coordinates: draftLineCoords },
                }}
              >
                <LineLayer
                  id="draft-line"
                  style={{ lineColor: '#FF5630', lineWidth: 3, lineCap: 'round', lineJoin: 'round' }}
                />
              </ShapeSource>
              {drawType === 'polygon' && (
                <ShapeSource id="draft-dots-source" shape={draftDotsFC}>
                  <CircleLayer
                    id="draft-dots"
                    style={{
                      circleRadius: 6,
                      circleColor: '#FF5630',
                      circleStrokeWidth: 2,
                      circleStrokeColor: '#FFFFFF',
                    }}
                  />
                </ShapeSource>
              )}
            </>
          )}

          {/* Search-location marker */}
          {searchCoords && !isDrawingMode && (
            <MarkerView
              coordinate={[searchCoords.longitude, searchCoords.latitude]}
              anchor={{ x: 0.5, y: 1 }}
              allowOverlap={true}
            >
              {/* The callout is part of the marker's own content (column, pin last), so
                  the bottom anchor stays on the pin's tip whether it is open or not. */}
              <View style={styles.searchMarker}>
                {searchAddress && searchPopupOpen ? (
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => setSearchPopupOpen(false)}
                    style={styles.searchCallout}
                  >
                    <Text style={styles.searchCalloutText}>{searchAddress}</Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => setSearchPopupOpen((v) => !v)}
                >
                  <MaterialCommunityIcons name="map-marker" size={36} color="#e53935" />
                </TouchableOpacity>
              </View>
            </MarkerView>
          )}

          {/* Building + cluster markers */}
          {!isDrawingMode &&
            clusteredMarkers.map((item) => {
              if (item.kind === 'single') {
                const building = item.building;
                return (
                  <MarkerView
                    key={`building-${building.id}-${building.leadStatus || 'none'}`}
                    coordinate={[building.position[1], building.position[0]]}
                    anchor={{ x: 0.5, y: 0.5 }}
                    allowOverlap={true}
                  >
                    <TouchableOpacity activeOpacity={0.8} onPress={() => onBuildingPress(building)}>
                      <BuildingMapMarker status={building.leadStatus} />
                    </TouchableOpacity>
                  </MarkerView>
                );
              }

              return (
                <MarkerView
                  key={`cluster-${item.clusterId}`}
                  coordinate={[item.longitude, item.latitude]}
                  anchor={{ x: 0.5, y: 0.5 }}
                  allowOverlap={true}
                >
                  <TouchableOpacity
                    activeOpacity={0.8}
                    onPress={() => handleClusterPress(item.clusterId, item.buildings)}
                  >
                    <ClusterMapMarker count={item.count} size={item.size} />
                  </TouchableOpacity>
                </MarkerView>
              );
            })}

          {/* Sales Map lead/job pins overlay (green teardrop pins + anchored job card). */}
          <SalesLeadPinsLayer pins={salesPins} enabled={salesPinsEnabled} cameraRef={cameraRef} />
        </MapView>
      </View>

      {/* Gallery / upload / referral modals for the lead card — must sit OUTSIDE MapView. */}
      <SalesLeadPinsModals pins={salesPins} />
    </View>
  );
}

const styles = StyleSheet.create({
  searchMarker: {
    alignItems: 'center',
  },
  // Web mapbox Popup: white card over the pin, text wrapping at a fixed width.
  searchCallout: {
    maxWidth: 220,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 4,
  },
  searchCalloutText: {
    fontSize: 12,
    color: '#1E293B',
  },
});
