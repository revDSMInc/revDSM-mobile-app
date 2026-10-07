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

export function saveZoneMapState(state: ZoneMapSavedState): void {
  Storage.setItem(ZONE_MAP_STATE_KEY, JSON.stringify(state));
}

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

export function getAndClearZoneMapState(): ZoneMapSavedState | null {
  const saved = peekZoneMapState();
  if (saved) clearZoneMapState();
  return saved;
}

export function markZoneCanvasserShouldReopen(): void {
  Storage.setItem(ZONE_CANVASSER_OPEN_KEY, 'true');
}

export function peekZoneCanvasserReopen(): boolean {
  return Storage.getItem(ZONE_CANVASSER_OPEN_KEY) === 'true';
}

export function consumeZoneCanvasserReopen(): boolean {
  if (Storage.getItem(ZONE_CANVASSER_OPEN_KEY) === 'true') {
    Storage.removeItem(ZONE_CANVASSER_OPEN_KEY);
    return true;
  }
  return false;
}
