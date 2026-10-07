export interface LeadCoords {
  latitude: number;
  longitude: number;
}

export const GPS_TIMEOUT_ONLINE_MS = 15_000;
export const GPS_TIMEOUT_OFFLINE_MS = 60_000;

export const GPS_MAX_AGE_ONLINE_MS = 10_000;
export const GPS_MAX_AGE_OFFLINE_MS = 120_000;

export interface GeolocationOptions {
  enableHighAccuracy: boolean;
  timeout: number;
  maximumAge: number;
}

export const geolocationOptions = (online: boolean): GeolocationOptions => ({
  enableHighAccuracy: true,
  timeout: online ? GPS_TIMEOUT_ONLINE_MS : GPS_TIMEOUT_OFFLINE_MS,
  maximumAge: online ? GPS_MAX_AGE_ONLINE_MS : GPS_MAX_AGE_OFFLINE_MS,
});

export const COORDS_PLACEHOLDER_PREFIX = '📍 ';

const COORD_DECIMALS = 5;

const isFiniteCoord = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export const isValidCoords = (coords: LeadCoords | null | undefined): coords is LeadCoords =>
  !!coords &&
  isFiniteCoord(coords.latitude) &&
  isFiniteCoord(coords.longitude) &&
  Math.abs(coords.latitude) <= 90 &&
  Math.abs(coords.longitude) <= 180 &&
  !(coords.latitude === 0 && coords.longitude === 0);

export const formatCoords = (coords: LeadCoords): string =>
  `${coords.latitude.toFixed(COORD_DECIMALS)}, ${coords.longitude.toFixed(COORD_DECIMALS)}`;

export const formatCoordsPlaceholder = (coords: LeadCoords): string =>
  `${COORDS_PLACEHOLDER_PREFIX}${formatCoords(coords)}`;

const COORDS_PLACEHOLDER_RE = new RegExp(
  `^${COORDS_PLACEHOLDER_PREFIX.trim()}\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)$`,
);

const COORDS_ONLY_RE = new RegExp(
  `^(?:${COORDS_PLACEHOLDER_PREFIX.trim()}\\s*)?(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)$`,
);

export const isCoordsOnlyAddress = (address: string | null | undefined): boolean =>
  typeof address === 'string' && COORDS_ONLY_RE.test(address.trim());

export const parseCoordsAddress = (address: string | null | undefined): LeadCoords | null => {
  if (typeof address !== 'string') return null;
  const m = COORDS_ONLY_RE.exec(address.trim());
  if (!m) return null;
  const coords = { latitude: Number(m[1]), longitude: Number(m[2]) };
  return isValidCoords(coords) ? coords : null;
};

export const isCoordsPlaceholder = (address: string | null | undefined): boolean =>
  typeof address === 'string' && COORDS_PLACEHOLDER_RE.test(address.trim());

export const parseCoordsPlaceholder = (address: string | null | undefined): LeadCoords | null => {
  if (typeof address !== 'string') return null;
  const m = COORDS_PLACEHOLDER_RE.exec(address.trim());
  if (!m) return null;
  const coords = { latitude: Number(m[1]), longitude: Number(m[2]) };
  return isValidCoords(coords) ? coords : null;
};

export interface SyncAddressInput {
  address: string | null | undefined;
  coords?: LeadCoords | null;
  reverseGeocoded?: string | null;
}

export interface SyncAddressResult {
  address: string;
  source: 'typed' | 'reverse-geocoded' | 'coords' | 'empty';
}

export const resolveSyncAddress = ({
  address,
  coords,
  reverseGeocoded,
}: SyncAddressInput): SyncAddressResult => {
  const typed = typeof address === 'string' ? address.trim() : '';

  if (typed && !isCoordsOnlyAddress(typed)) return { address: typed, source: 'typed' };

  const geocoded = typeof reverseGeocoded === 'string' ? reverseGeocoded.trim() : '';
  if (geocoded) return { address: geocoded, source: 'reverse-geocoded' };

  const fallback = isValidCoords(coords) ? coords : parseCoordsPlaceholder(typed);
  if (fallback) return { address: formatCoords(fallback), source: 'coords' };

  return { address: '', source: 'empty' };
};

export const needsAddressResolution = (
  address: string | null | undefined,
  coords?: LeadCoords | null,
): boolean => {
  const typed = typeof address === 'string' ? address.trim() : '';
  if (typed && !isCoordsOnlyAddress(typed)) return false;
  return isValidCoords(coords) || !!parseCoordsAddress(typed);
};


export const coordsFromLeadPayload = (payload: any): LeadCoords | null => {
  const pair = payload?.location?.coordinates;
  if (Array.isArray(pair) && pair.length >= 2) {
    const geo = { latitude: Number(pair[1]), longitude: Number(pair[0]) };
    if (isValidCoords(geo)) return geo;
  }
  const flat = { latitude: Number(payload?.latitude), longitude: Number(payload?.longitude) };
  if (isValidCoords(flat)) return flat;
  return parseCoordsAddress(payload?.fullAddress) || parseCoordsAddress(payload?.customer?.address);
};

export const applyResolvedAddress = <T extends Record<string, any>>(payload: T, address: string): T => {
  if (!address) return payload;
  return {
    ...payload,
    fullAddress: address,
    ...(payload.customer ? { customer: { ...payload.customer, address } } : {}),
  };
};

export interface FormAddressInput {
  address: unknown;
  leadAddress?: unknown;
  reverseGeocoded?: string | null;
}

export const resolveFormAddress = ({
  address,
  leadAddress,
  reverseGeocoded,
}: FormAddressInput): string | null => {
  const current = typeof address === 'string' ? address.trim() : '';
  if (!current || !isCoordsOnlyAddress(current)) return null;

  const lead = typeof leadAddress === 'string' ? leadAddress.trim() : '';
  if (lead && !isCoordsOnlyAddress(lead)) return lead;

  const geocoded = typeof reverseGeocoded === 'string' ? reverseGeocoded.trim() : '';
  return geocoded || null;
};
