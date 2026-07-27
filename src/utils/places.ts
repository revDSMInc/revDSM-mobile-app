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

/** Address suggestions for what the user has typed so far. Never throws. */
export const fetchPlacePredictions = async (input: string): Promise<PlacePrediction[]> => {
  const query = input?.trim();
  if (!query) return [];

  try {
    const url =
      `${GOOGLE_MAPS_BASE}/place/autocomplete/json` +
      `?input=${encodeURIComponent(query)}&key=${ENV.GOOGLE_MAPS_API_KEY}`;
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
