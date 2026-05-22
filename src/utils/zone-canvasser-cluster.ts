import Supercluster from 'supercluster';
import type { Region } from 'react-native-maps';
import type { ZoneCanvasserBuilding } from '../types/zone-canvasser';

/** Parity with web buildings-layer.js (leaflet.markercluster) */
export const CLUSTER_MAX_RADIUS = 50;
export const CLUSTER_DISABLE_AT_ZOOM = 18;

export type ClusterSize = 'small' | 'medium' | 'large';

export type BuildingMapCluster =
  | { kind: 'single'; building: ZoneCanvasserBuilding }
  | {
      kind: 'cluster';
      clusterId: number;
      count: number;
      latitude: number;
      longitude: number;
      size: ClusterSize;
      buildings: ZoneCanvasserBuilding[];
    };

export function getClusterSize(count: number): ClusterSize {
  if (count < 10) return 'small';
  if (count < 100) return 'medium';
  return 'large';
}

/** Convert map region to Leaflet-style zoom (used by supercluster). */
export function regionToZoom(region: Region): number {
  const delta = region.latitudeDelta > 0 ? region.latitudeDelta : 0.05;
  const zoom = Math.log2(360 / delta);
  return Math.max(0, Math.min(20, Math.round(zoom)));
}

function regionToBbox(region: Region): [number, number, number, number] {
  const halfLat = region.latitudeDelta / 2;
  const halfLng = region.longitudeDelta / 2;
  return [
    region.longitude - halfLng,
    region.latitude - halfLat,
    region.longitude + halfLng,
    region.latitude + halfLat,
  ];
}

function createClusterIndex(buildings: ZoneCanvasserBuilding[]): Supercluster {
  const index = new Supercluster({
    radius: CLUSTER_MAX_RADIUS,
    maxZoom: CLUSTER_DISABLE_AT_ZOOM - 1,
    minZoom: 0,
  });

  const points = buildings.map((building) => ({
    type: 'Feature' as const,
    properties: { building },
    geometry: {
      type: 'Point' as const,
      coordinates: [building.position[1], building.position[0]] as [number, number],
    },
  }));

  index.load(points);
  return index;
}

export function clusterBuildings(
  buildings: ZoneCanvasserBuilding[],
  region: Region
): { clusters: BuildingMapCluster[]; index: Supercluster } {
  if (!buildings.length) {
    return { clusters: [], index: createClusterIndex([]) };
  }

  const index = createClusterIndex(buildings);
  const zoom = regionToZoom(region);
  const bbox = regionToBbox(region);
  const features = index.getClusters(bbox, zoom);

  const clusters: BuildingMapCluster[] = features.map((feature) => {
    const [longitude, latitude] = feature.geometry.coordinates;

    if (feature.properties.cluster) {
      const clusterId = feature.properties.cluster_id as number;
      const count = feature.properties.point_count as number;
      const leaves = index.getLeaves(clusterId, Infinity);
      const clusterBuildings = leaves.map(
        (leaf) => leaf.properties.building as ZoneCanvasserBuilding
      );

      return {
        kind: 'cluster' as const,
        clusterId,
        count,
        latitude,
        longitude,
        size: getClusterSize(count),
        buildings: clusterBuildings,
      };
    }

    const building = feature.properties.building as ZoneCanvasserBuilding;
    return { kind: 'single' as const, building };
  });

  return { clusters, index };
}

/** Web: zoomToBoundsOnClick — zoom until cluster breaks apart. */
export function getClusterExpansionZoom(
  index: Supercluster,
  clusterId: number
): number {
  try {
    return index.getClusterExpansionZoom(clusterId);
  } catch {
    return CLUSTER_DISABLE_AT_ZOOM;
  }
}
