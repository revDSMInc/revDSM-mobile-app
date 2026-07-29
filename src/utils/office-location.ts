/**
 * The rep's office coordinates, read from the `/company` (getMe) profile.
 *
 * Web parity: `src/sections/map/map.js` → `getOfficeLngLat`, which reads
 * `user.office[0]` and prefers `verifiedAddress.lat/lon` over the office's own
 * `lat`/`long` — those top-level fields are frequently `null` in the API while
 * the geocoded `verifiedAddress` carries the real point.
 */

export interface OfficeCoords {
  latitude: number;
  longitude: number;
}

/** Zoom used when framing the office — web's `OFFICE_FRAME_ZOOM`. */
export const OFFICE_ZOOM = 13;

const toNumber = (value: any): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/** Usable coordinates for one office entry, or null. */
const readOfficeCoords = (office: any): OfficeCoords | null => {
  const latitude = toNumber(office?.verifiedAddress?.lat) ?? toNumber(office?.lat);
  const longitude = toNumber(office?.verifiedAddress?.lon) ?? toNumber(office?.long);

  if (latitude === null || longitude === null) return null;
  // (0,0) is the API's "unset" value, not a real office in the Gulf of Guinea.
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { latitude, longitude };
};

/**
 * Every office the profile can locate.
 *
 * `getOfficeCoords` picks ONE office to frame a map on; the check-in geofence needs all
 * of them, because a multi-office company must accept a crew staging at any of its
 * depots. Offices without usable coordinates are dropped rather than defaulted.
 */
export const getAllOfficeCoords = (user: any): OfficeCoords[] => {
  const raw = user?.office;
  const offices: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return offices
    .map(readOfficeCoords)
    .filter((coords): coords is OfficeCoords => coords !== null);
};

/**
 * The office the map should open on. Prefers the rep's assigned office, then
 * falls back to the first office that has usable coordinates (web reads
 * `office[0]`; preferring `assigned` only matters for multi-office reps).
 * Returns null when the profile carries no locatable office.
 */
export const getOfficeCoords = (user: any): OfficeCoords | null => {
  const raw = user?.office;
  const offices: any[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  if (!offices.length) return null;

  const locatable = offices
    .map((office) => ({ office, coords: readOfficeCoords(office) }))
    .filter((entry) => entry.coords !== null);

  if (!locatable.length) return null;

  const assigned = locatable.find((entry) => entry.office?.assigned === true);
  return (assigned ?? locatable[0]).coords;
};
