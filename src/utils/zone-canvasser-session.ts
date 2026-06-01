import AsyncStorage from '@react-native-async-storage/async-storage';

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
export async function saveZoneMapState(state: ZoneMapSavedState): Promise<void> {
  await AsyncStorage.setItem(ZONE_MAP_STATE_KEY, JSON.stringify(state));
}

/** Read saved map state without clearing (restore may retry until buildings load). */
export async function peekZoneMapState(): Promise<ZoneMapSavedState | null> {
  const raw = await AsyncStorage.getItem(ZONE_MAP_STATE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ZoneMapSavedState;
  } catch {
    return null;
  }
}

export async function clearZoneMapState(): Promise<void> {
  await AsyncStorage.removeItem(ZONE_MAP_STATE_KEY);
}

/** Read and clear saved map state (one-time restore). */
export async function getAndClearZoneMapState(): Promise<ZoneMapSavedState | null> {
  const saved = await peekZoneMapState();
  if (saved) await clearZoneMapState();
  return saved;
}

/** Flag that zone canvasser should reopen when Leads screen regains focus. */
export async function markZoneCanvasserShouldReopen(): Promise<void> {
  await AsyncStorage.setItem(ZONE_CANVASSER_OPEN_KEY, 'true');
}

/** Check reopen flag without consuming. */
export async function peekZoneCanvasserReopen(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ZONE_CANVASSER_OPEN_KEY);
  return value === 'true';
}

/** Consume reopen flag (returns true once). */
export async function consumeZoneCanvasserReopen(): Promise<boolean> {
  const value = await AsyncStorage.getItem(ZONE_CANVASSER_OPEN_KEY);
  if (value === 'true') {
    await AsyncStorage.removeItem(ZONE_CANVASSER_OPEN_KEY);
    return true;
  }
  return false;
}
