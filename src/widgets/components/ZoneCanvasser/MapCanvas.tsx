import React, { useMemo, useState, useCallback, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Marker, Polygon, Polyline, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import type Supercluster from 'supercluster';
import {
  clusterBuildings,
  getClusterExpansionZoom,
} from '../../../utils/zone-canvasser-cluster';
import type { MapCoordinate, ZoneCanvasserBuilding } from '../../../types/zone-canvasser';
import { BuildingMapMarker } from './BuildingMapMarker';
import { ClusterMapMarker } from './ClusterMapMarker';

type Props = {
  mapRef: React.RefObject<MapView | null>;
  mapType: 'standard' | 'satellite';
  initialRegion: any;
  isDrawingMode: boolean;
  drawType: 'polygon' | 'rectangle';
  drawCoordinates: MapCoordinate[];
  zones: any[];
  allBuildings: ZoneCanvasserBuilding[];
  searchCoords: MapCoordinate | null;
  onMapPress: (e: any) => void;
  onBuildingPress: (building: ZoneCanvasserBuilding) => void;
  onPolygonPress: (zone: any) => void;
  onTouchStart: (e: any) => void;
  onTouchMove: (e: any) => void;
  onTouchEnd: () => void;
  onRegionChangeComplete?: (region: Region) => void;
};

const DEFAULT_REGION: Region = {
  latitude: 27.9506,
  longitude: -82.4572,
  latitudeDelta: 0.0922,
  longitudeDelta: 0.0421,
};

function getZonePolygonCoords(zone: any): MapCoordinate[] {
  if (zone.geoJSON?.geometry?.coordinates) {
    return zone.geoJSON.geometry.coordinates[0].map((coord: any) => ({
      latitude: coord[1],
      longitude: coord[0],
    }));
  }
  if (zone.coordinates) {
    return zone.coordinates.map((coord: any) => ({
      latitude: coord[0],
      longitude: coord[1],
    }));
  }
  return [];
}

/** Convert Leaflet zoom to react-native-maps latitudeDelta (zoomToBoundsOnClick parity). */
function zoomToLatitudeDelta(zoom: number): number {
  return 360 / Math.pow(2, zoom);
}

export function MapCanvas({
  mapRef,
  mapType,
  initialRegion,
  isDrawingMode,
  drawType,
  drawCoordinates,
  zones,
  allBuildings,
  searchCoords,
  onMapPress,
  onBuildingPress,
  onPolygonPress,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onRegionChangeComplete,
}: Props) {
  const rectangleDrawing = isDrawingMode && drawType === 'rectangle';
  const [mapRegion, setMapRegion] = useState<Region>(
    initialRegion ?? DEFAULT_REGION
  );
  const clusterIndexRef = useRef<Supercluster | null>(null);

  const handleRegionChangeComplete = useCallback(
    (region: Region) => {
      setMapRegion(region);
      onRegionChangeComplete?.(region);
    },
    [onRegionChangeComplete]
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

        mapRef.current?.animateToRegion(
          {
            latitude: centerLat,
            longitude: centerLng,
            latitudeDelta: zoomToLatitudeDelta(expansionZoom + 1),
            longitudeDelta: zoomToLatitudeDelta(expansionZoom + 1),
          },
          400
        );
        return;
      }

      const coords = buildings.map((b) => ({
        latitude: b.position[0],
        longitude: b.position[1],
      }));
      if (coords.length > 0) {
        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 100, right: 60, bottom: 120, left: 60 },
          animated: true,
        });
      }
    },
    [mapRef]
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
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFillObject}
          mapType={mapType}
          initialRegion={initialRegion}
          onPress={onMapPress}
          onRegionChangeComplete={handleRegionChangeComplete}
          showsUserLocation
          showsMyLocationButton={false}
          scrollEnabled={!rectangleDrawing}
          zoomEnabled={!rectangleDrawing}
          pitchEnabled={!rectangleDrawing}
          rotateEnabled={!rectangleDrawing}
        >
          {isDrawingMode && drawCoordinates.length > 0 && (
            <>
              <Polyline
                key="draft-polyline"
                coordinates={drawCoordinates}
                strokeColor="#FF5630"
                strokeWidth={3}
              />
              {drawCoordinates.length >= 3 && (
                <Polygon
                  key="draft-polygon"
                  coordinates={drawCoordinates}
                  fillColor="rgba(255, 86, 48, 0.2)"
                  strokeColor="#FF5630"
                  strokeWidth={1}
                />
              )}
              {drawType === 'polygon' && drawCoordinates.map((coord, idx) =>
                coord?.latitude != null && coord?.longitude != null ? (
                  <Marker
                    key={`draft-dot-${idx}`}
                    coordinate={coord}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                  >
                    <View style={styles.draftDot} />
                  </Marker>
                ) : null
              )}
            </>
          )}

          {!isDrawingMode &&
            Array.isArray(zones) &&
            zones.map((zone) => {
              const polygonCoords = getZonePolygonCoords(zone);
              if (polygonCoords.length < 3) return null;
              return (
                <Polygon
                  key={zone._id || zone.zoneId}
                  coordinates={polygonCoords}
                  fillColor={`${zone.color || '#99FFB1'}30`}
                  strokeColor={zone.color || '#99FFB1'}
                  strokeWidth={2}
                  tappable
                  onPress={() => onPolygonPress(zone)}
                />
              );
            })}

          {searchCoords && !isDrawingMode && (
            <Marker coordinate={searchCoords} anchor={{ x: 0.5, y: 1 }}>
              <MaterialCommunityIcons name="map-marker" size={36} color="#e53935" />
            </Marker>
          )}

          {!isDrawingMode &&
            clusteredMarkers.map((item) => {
              if (item.kind === 'single') {
                const building = item.building;
                return (
                  <Marker
                    key={`building-${building.id}-${building.leadStatus || 'none'}`}
                    coordinate={{
                      latitude: building.position[0],
                      longitude: building.position[1],
                    }}
                    onPress={() => onBuildingPress(building)}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                  >
                    <BuildingMapMarker status={building.leadStatus} />
                  </Marker>
                );
              }

              return (
                <Marker
                  key={`cluster-${item.clusterId}`}
                  coordinate={{ latitude: item.latitude, longitude: item.longitude }}
                  onPress={() => handleClusterPress(item.clusterId, item.buildings)}
                  anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={true}
                >
                  <ClusterMapMarker count={item.count} size={item.size} />
                </Marker>
              );
            })}
        </MapView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  draftDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FF5630',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
});
