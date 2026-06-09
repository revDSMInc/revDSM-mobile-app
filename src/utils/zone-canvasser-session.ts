import { Storage } from './storage';

const ZONE_CANVASSER_OPEN_KEY = 'zoneCanvasserOpen';
const ZONE_MAP_STATE_KEY = 'zoneMapState';

export type ZoneMapSavedState = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
  buildingId: string | number;
};

/** Persist map camera + building so the zone map can restore after Lead Center (web sessionStorage parity). */
export function saveZoneMapState(state: ZoneMapSavedState): void {
  Storage.setItem(ZONE_MAP_STATE_KEY, JSON.stringify(state));
}

/** Read saved map state without clearing (restore may retry until buildings load). */
export function peekZoneMapState(): ZoneMapSavedState | null {
  const raw = Storage.getItem(ZONE_MAP_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ZoneMapSavedState;
  } catch {
    return null;
  }
}

export function clearZoneMapState(): void {
  Storage.removeItem(ZONE_MAP_STATE_KEY);
}

/** Read and clear saved map state (one-time restore). */
export function getAndClearZoneMapState(): ZoneMapSavedState | null {
  const saved = peekZoneMapState();
  if (saved) clearZoneMapState();
  return saved;
}

/** Flag that zone canvasser should reopen when Leads screen regains focus. */
export function markZoneCanvasserShouldReopen(): void {
  Storage.setItem(ZONE_CANVASSER_OPEN_KEY, 'true');
}

/** Check reopen flag without consuming. */
export function peekZoneCanvasserReopen(): boolean {
  return Storage.getItem(ZONE_CANVASSER_OPEN_KEY) === 'true';
}

/** Consume reopen flag (returns true once). */
export function consumeZoneCanvasserReopen(): boolean {
  if (Storage.getItem(ZONE_CANVASSER_OPEN_KEY) === 'true') {
    Storage.removeItem(ZONE_CANVASSER_OPEN_KEY);
    return true;
  }
  return false;
}
