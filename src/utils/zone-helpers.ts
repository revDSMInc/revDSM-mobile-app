/**
 * Zone Canvasser — pure zone rules, ported from web.
 *
 * Web refs (mhalt-revDSM-sales-frontend):
 *  - src/utils/zone-helpers.js                              → payload build + validation
 *  - src/sections/map/zone-canvasser/zone-stats-popup.js    → getZoneStats / canDelete / canArchive
 *  - src/sections/map/zone-canvasser/archived-zones-panel.js → zoneLabel / knockedCount
 *  - src/sections/map/zone-canvasser/zone-canvasser-map.js  → create/delete/archive/unarchive handling
 *
 * Kept free of React Native so it is testable under jest — the hook and the widgets
 * that consume it all pull in RN / Mapbox and cannot be loaded there.
 */

export type LatLngTuple = [number, number];

export type ZoneBuilding = {
  id?: string | number;
  position: LatLngTuple;
  label: string;
  type: string;
};

export type ZonePayload = {
  zoneId: string;
  zoneName: string;
  assignedUsers: any[];
  layerType: string;
  color: string;
  geoJSON: {
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'Polygon'; coordinates: number[][][] };
  };
  coordinates: LatLngTuple[];
  buildingDetails: (ZoneBuilding & { id: string | number })[];
  userId: string | undefined;
  companyId: string | undefined;
};

export const DEFAULT_ZONE_COLOR = '#99FFB1';

/** Web `createZone` error the backend returns when a zone holds no buildings. */
export const NO_BUILDING_API_MESSAGE = 'Cannot create revzone without a building';

/** Timestamp + 3-digit random suffix (web `generateZoneId`). */
export function generateZoneId(now: number = Date.now(), random: number = Math.random()): string {
  const suffix = Math.floor(random * 1000);
  return `${now}${suffix.toString().padStart(3, '0')}`;
}

/** Web `generateZoneName`. */
export function generateZoneName(zoneId: string): string {
  return `REV-${zoneId}`;
}

/** Web `generateBuildingId` — only used for a building the Overpass read gave no id. */
export function generateBuildingId(zoneId: string, index: number): number {
  const baseId = 800400000;
  const zoneHash = parseInt(zoneId.slice(-3), 10) || 0;
  return baseId + zoneHash * 100 + index + 1;
}

/** Web `processBuildingsWithIds`. */
export function processBuildingsWithIds(buildings: ZoneBuilding[], zoneId: string) {
  return buildings.map((building, index) => ({
    ...building,
    id: building.id || generateBuildingId(zoneId, index),
  }));
}

/**
 * The drawn ring as web's `handleZoneCreated` hands it on: `[lat, lng]` pairs with the
 * duplicate CLOSING vertex dropped. The rectangle tool closes its own loop, so without
 * this a rectangle would reach the API as five corners where web sends four.
 */
export function toZoneCoordinates(
  points: { latitude: number; longitude: number }[]
): LatLngTuple[] {
  const coordinates: LatLngTuple[] = (points || []).map((p) => [p.latitude, p.longitude]);
  if (coordinates.length > 1) {
    const first = coordinates[0];
    const last = coordinates[coordinates.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) coordinates.pop();
  }
  return coordinates;
}

/** Web `createZonePayload`. `coordinates` are `[lat, lng]`; geoJSON is `[lng, lat]` and closed. */
export function createZonePayload({
  coordinates,
  buildingDetails = [],
  assignedUsers = [],
  color = DEFAULT_ZONE_COLOR,
  layerType = 'rectangle',
  userId,
  companyId,
  zoneId = generateZoneId(),
}: {
  coordinates: LatLngTuple[];
  buildingDetails?: ZoneBuilding[];
  assignedUsers?: any[];
  color?: string;
  layerType?: string;
  userId?: string;
  companyId?: string;
  zoneId?: string;
}): ZonePayload {
  const zoneName = generateZoneName(zoneId);
  const processedBuildings = processBuildingsWithIds(buildingDetails, zoneId);

  const geoJSONCoordinates = coordinates.map((coord) => [coord[1], coord[0]]);
  if (geoJSONCoordinates.length > 0) {
    const firstCoord = geoJSONCoordinates[0];
    const lastCoord = geoJSONCoordinates[geoJSONCoordinates.length - 1];
    if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
      geoJSONCoordinates.push(firstCoord);
    }
  }

  return {
    zoneId,
    zoneName,
    assignedUsers,
    layerType,
    color,
    geoJSON: {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: [geoJSONCoordinates] },
    },
    coordinates,
    buildingDetails: processedBuildings,
    userId,
    companyId,
  };
}

/** Web `validateZonePayload`. */
export function validateZonePayload(payload: Partial<ZonePayload> | null | undefined) {
  const errors: string[] = [];
  if (!payload?.zoneId) errors.push('Zone ID is required');
  if (!payload?.zoneName) errors.push('Zone name is required');
  if (!payload?.geoJSON?.geometry?.coordinates) errors.push('Valid GeoJSON is required');
  if (!Array.isArray(payload?.coordinates) || payload!.coordinates!.length < 3) {
    errors.push('At least 3 coordinates are required');
  }
  if (!payload?.userId) errors.push('User ID is required');
  if (!payload?.companyId) errors.push('Company ID is required');
  return { isValid: errors.length === 0, errors };
}

/** Web `fetchBuildingsInPolygon`'s Overpass element → building mapping + residential filter. */
export function overpassElementsToHouses(elements: any[], idSeed: string | number = Date.now()) {
  return (Array.isArray(elements) ? elements : [])
    .filter((el) => el?.center)
    .map((element, index) => ({
      id: element.id || `building-${idSeed}-${index}`,
      position: [element.center?.lat, element.center?.lon] as LatLngTuple,
      label: element.tags?.name || `Building ${index + 1}`,
      type: element.tags?.building || 'yes',
    }))
    .filter((b) => ['house', 'yes', 'detached', 'residential'].includes(b.type));
}

/** Web `handleZoneCreated`'s catch block, message for message. */
export function resolveZoneCreateError(apiMessage?: string | null): string {
  if (apiMessage === NO_BUILDING_API_MESSAGE) {
    return 'No building data available for this area. Failed to create zone.';
  }
  if (apiMessage) return `Failed to create zone: ${apiMessage}`;
  return 'Failed to create zone - unknown error';
}

/** The id the sales-rep zone routes take. Web sends `zone.zoneId` (unarchive falls back to `_id`). */
export function zoneApiId(zone: any): string | undefined {
  const id = zone?.zoneId || zone?._id;
  return id != null ? String(id) : undefined;
}

/**
 * Delete / archive answer `code: 200`; the archive route documents `success: true`.
 * Web's unarchive handler accepts either, so a shape difference can't swallow a result.
 */
export function isZoneActionSuccess(response: any): boolean {
  return response?.success === true || response?.code === 200;
}

function zoneLeads(zone: any): any[] {
  if (Array.isArray(zone?.salesRepBuildingLeads)) return zone.salesRepBuildingLeads.flat();
  if (Array.isArray(zone?.buildingLeads)) return zone.buildingLeads.flat();
  return [];
}

/** Web archived-zones-panel `knockedCount`. */
export function zoneKnockedCount(zone: any): number {
  return zoneLeads(zone).length;
}

/** Web archived-zones-panel `zoneLabel` — long REV ids are elided to their last 4 digits. */
export function zoneLabel(zone: any): string {
  const name = zone?.zoneName || zone?.zoneId || zone?._id || 'Zone';
  return String(name).replace(/^(REV-)(\d+)(\d{4})$/, '$1...$3');
}

/** Web zone-stats-popup `getZoneStats`, plus the two action gates derived from it. */
export function getZoneStats(zone: any) {
  const totalHomes = zone?.buildingDetails?.length || 0;
  const allLeads = zoneLeads(zone);
  const count = (...statuses: string[]) =>
    allLeads.filter((lead) => statuses.includes(lead?.status)).length;

  const homesKnocked = allLeads.length;
  return {
    totalHomes,
    homesKnocked,
    notHome: count('not_home'),
    noAnswer: count('no_answer'),
    notQualified: count('not_qualified'),
    leadsCreated: count('create_lead', 'selfGenerated'),
    goBack: count('go_back'),
    interestedNoTime: count('interested_no_time'),
    notInterested: count('not_interested'),
    noSoliciting: count('no_soliciting'),
    percentage: totalHomes > 0 ? Math.round((homesKnocked / totalHomes) * 100) : 0,
    // A zone nobody has knocked can be deleted outright; one with knock history is
    // archived instead, so that history is preserved. Never both, never neither.
    canDelete: homesKnocked === 0,
    canArchive: homesKnocked > 0,
  };
}
