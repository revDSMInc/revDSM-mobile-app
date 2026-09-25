/**
 * Thin wrappers over the Google Places / Geocoding REST APIs.
 *
 * The same three calls were being written inline in every screen that needed an
 * address box (MapFiltersModal, LeadCreate, AddAppointmentModal, …); this keeps
 * the URL building, key handling and error swallowing in one place.
 *
 * Note: no country restriction — customer addresses are not US-only.
 */
import axios from 'axios';
import { ENV } from '../config/env';

const GOOGLE_MAPS_BASE = 'https://maps.googleapis.com/maps/api';

export interface PlacePrediction {
  placeId: string;
  description: string;
}

export interface PlaceCoords {
  latitude: number;
  longitude: number;
}

export interface ResolvedPlace extends PlaceCoords {
  formattedAddress: string | null;
}

/**
 * Address suggestions for what the user has typed so far. Never throws.
 * `types` restricts the prediction kind (e.g. `'address'`, as web's Places Autocomplete
 * uses for the zone canvasser search); omit it for no restriction.
 */
export const fetchPlacePredictions = async (
  input: string,
  options?: { types?: string }
): Promise<PlacePrediction[]> => {
  const query = input?.trim();
  if (!query) return [];

  try {
    const url =
      `${GOOGLE_MAPS_BASE}/place/autocomplete/json` +
      `?input=${encodeURIComponent(query)}` +
      (options?.types ? `&types=${encodeURIComponent(options.types)}` : '') +
      `&key=${ENV.GOOGLE_MAPS_API_KEY}`;
    const res = await axios.get(url);

    return (res.data?.predictions || []).map((p: any) => ({
      placeId: p.place_id,
      description: p.description,
    }));
  } catch (error) {
    console.log('[Places] Autocomplete failed:', error);
    return [];
  }
};

/** Coordinates for a place the user picked from the suggestions. */
export const geocodePlaceId = async (placeId: string): Promise<PlaceCoords | null> => {
  if (!placeId) return null;

  try {
    const url =
      `${GOOGLE_MAPS_BASE}/geocode/json` +
      `?place_id=${encodeURIComponent(placeId)}&key=${ENV.GOOGLE_MAPS_API_KEY}`;
    const res = await axios.get(url);
    const location = res.data?.results?.[0]?.geometry?.location;
    if (!location) return null;

    return { latitude: location.lat, longitude: location.lng };
  } catch (error) {
    console.log('[Places] Geocode failed:', error);
    return null;
  }
};

/**
 * Coordinates for an address the rep TYPED and never picked from the suggestions. Null when
 * Google cannot place it (or the request fails), so the caller decides what to do instead of
 * silently keeping some other location. Never throws.
 */
export const geocodeAddress = async (address: string): Promise<PlaceCoords | null> => {
  const query = address?.trim();
  if (!query) return null;

  try {
    const url =
      `${GOOGLE_MAPS_BASE}/geocode/json` +
      `?address=${encodeURIComponent(query)}&key=${ENV.GOOGLE_MAPS_API_KEY}`;
    const res = await axios.get(url);
    const location = res.data?.results?.[0]?.geometry?.location;
    if (!location) return null;

    return { latitude: location.lat, longitude: location.lng };
  } catch (error) {
    console.log('[Places] Address geocode failed:', error);
    return null;
  }
};

/**
 * Coordinates AND the formatted address for a picked place — web's `place_changed`
 * reads both (`geometry.location` + `formatted_address`). Null when either is missing,
 * matching web, which ignores a place that lacks them.
 */
export const resolvePlace = async (placeId: string): Promise<ResolvedPlace | null> => {
  if (!placeId) return null;

  try {
    const url =
      `${GOOGLE_MAPS_BASE}/geocode/json` +
      `?place_id=${encodeURIComponent(placeId)}&key=${ENV.GOOGLE_MAPS_API_KEY}`;
    const res = await axios.get(url);
    const result = res.data?.results?.[0];
    const location = result?.geometry?.location;
    if (!location || !result?.formatted_address) return null;

    return {
      latitude: location.lat,
      longitude: location.lng,
      formattedAddress: result.formatted_address,
    };
  } catch (error) {
    console.log('[Places] Resolve place failed:', error);
    return null;
  }
};

/** Street address for a GPS fix — used by "use my current location". */
export const reverseGeocode = async (coords: PlaceCoords): Promise<string | null> => {
  try {
    const url =
      `${GOOGLE_MAPS_BASE}/geocode/json` +
      `?latlng=${coords.latitude},${coords.longitude}&key=${ENV.GOOGLE_MAPS_API_KEY}`;
    const res = await axios.get(url);

    return res.data?.results?.[0]?.formatted_address || null;
  } catch (error) {
    console.log('[Places] Reverse geocode failed:', error);
    return null;
  }
};
