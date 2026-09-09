/**
 * offline-lead-location.ts — capturing a lead's position with NO connection.
 *
 * A rep standing at a door with no signal can still be located: `getCurrentPosition` reads the
 * device GNSS chip, which is a radio receiver and needs no network. What needs a network is turning
 * those coordinates into "161 Block F, Johar Town" — iOS `CLGeocoder` and Android `Geocoder` both
 * call a web service, so there is no offline reverse-geocoder to fall back to.
 *
 * So the split this file encodes is: **capture the coordinates now, resolve the address later.**
 *
 * ⚠️ The rule that matters most is `resolveSyncAddress`: a REP-TYPED address always beats the
 * reverse-geocoded one. A consumer GPS fix is accurate to ±5-20 m and a reverse-geocode snaps that
 * point to the nearest address it knows, which on an ordinary street is frequently the NEIGHBOUR.
 * Overwriting what the rep read off the mailbox with what Google guessed from a scatter of metres
 * would file leads against the wrong house, silently, and nobody would find out until someone
 * knocked on it. The geocode is the fallback for a blank field, never a correction.
 *
 * Pure and RN-free (no `react-native`, no `Geolocation`, no `axios`) so every rule here is testable;
 * `widgets/modals/LeadCreate` pulls in React Native and cannot be loaded under jest in this repo.
 */

export interface LeadCoords {
  latitude: number;
  longitude: number;
}

// ─── GPS acquisition ───────────────────────────────────────────────────────────

/**
 * ⚠️ These two differ by 4x, and the reason is not caution — it is that they are timing DIFFERENT
 * things. Online, the OS answers almost instantly from A-GPS (the satellite almanac fetched over
 * the network) plus Wi-Fi/cell triangulation, so 15 s is generous. With no data connection none of
 * that assistance is available and the chip has to read the almanac off the satellites themselves:
 * a genuine cold fix outdoors is typically 30-60 s. Leaving the online timeout in place offline
 * would abort nearly every first fix a few seconds before it arrived, which reads on the device as
 * "GPS does not work offline" — the thing this file exists to disprove.
 */
export const GPS_TIMEOUT_ONLINE_MS = 15_000;
export const GPS_TIMEOUT_OFFLINE_MS = 60_000;

/**
 * How stale a cached fix may be before we insist on a new one.
 *
 * Offline this is deliberately long. The OS may be holding a fix from minutes ago, and for a rep
 * walking a street that is the same house — serving it immediately beats making them watch a
 * spinner for a cold lock. Online we keep the short window, where a fresh fix is nearly free.
 */
export const GPS_MAX_AGE_ONLINE_MS = 10_000;
export const GPS_MAX_AGE_OFFLINE_MS = 120_000;

export interface GeolocationOptions {
  enableHighAccuracy: boolean;
  timeout: number;
  maximumAge: number;
}

/** `getCurrentPosition` options for the current connectivity. */
export const geolocationOptions = (online: boolean): GeolocationOptions => ({
  // Kept true on both paths: high accuracy is what selects the GNSS chip over the
  // network-location provider, and the network provider is precisely what is unavailable offline.
  enableHighAccuracy: true,
  timeout: online ? GPS_TIMEOUT_ONLINE_MS : GPS_TIMEOUT_OFFLINE_MS,
  maximumAge: online ? GPS_MAX_AGE_ONLINE_MS : GPS_MAX_AGE_OFFLINE_MS,
});

// ─── The coordinate placeholder ────────────────────────────────────────────────

/**
 * Marks an address box holding coordinates rather than an address.
 *
 * ⚠️ It has to be VISIBLE in the field, not hidden state. Offline the reverse-geocode cannot run, so
 * the alternative is an address box that stays empty after a successful fix — from which a rep can
 * only conclude the app captured nothing, and re-tap, or type the address believing there is no
 * position attached. The placeholder is the app showing its working.
 */
export const COORDS_PLACEHOLDER_PREFIX = '📍 ';

/** 5 decimal places ≈ 1.1 m — past the accuracy of the fix itself, so more digits say nothing. */
const COORD_DECIMALS = 5;

const isFiniteCoord = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** True for a coordinate pair that could exist on Earth. */
export const isValidCoords = (coords: LeadCoords | null | undefined): coords is LeadCoords =>
  !!coords &&
  isFiniteCoord(coords.latitude) &&
  isFiniteCoord(coords.longitude) &&
  Math.abs(coords.latitude) <= 90 &&
  Math.abs(coords.longitude) <= 180 &&
  // 0,0 is Null Island — the Atlantic. It is what a zeroed struct looks like, never a doorstep.
  !(coords.latitude === 0 && coords.longitude === 0);

/** The bare `lat, lng` text, with no marker. This is what ships if no geocode ever succeeds. */
export const formatCoords = (coords: LeadCoords): string =>
  `${coords.latitude.toFixed(COORD_DECIMALS)}, ${coords.longitude.toFixed(COORD_DECIMALS)}`;

/** What the address box shows after an offline fix. */
export const formatCoordsPlaceholder = (coords: LeadCoords): string =>
  `${COORDS_PLACEHOLDER_PREFIX}${formatCoords(coords)}`;

const COORDS_PLACEHOLDER_RE = new RegExp(
  `^${COORDS_PLACEHOLDER_PREFIX.trim()}\\s*(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)$`,
);

/**
 * The same value with the marker OPTIONAL.
 *
 * ⚠️ This exists because the two sides of the trip are spelled differently, which is easy to miss
 * and cost a real bug: the address BOX shows `formatCoordsPlaceholder` (with the 📍), while what is
 * FILED is `formatCoords` (without it — the marker is a device affordance and reads as corruption
 * in a portal address column). So a lead uploaded from the queue carries a bare `31.46, 74.29`, and
 * a prefix-only test reads that as an address the rep typed and refuses to resolve it — leaving the
 * lead on the server showing coordinates forever.
 */
const COORDS_ONLY_RE = new RegExp(
  `^(?:${COORDS_PLACEHOLDER_PREFIX.trim()}\\s*)?(-?\\d+(?:\\.\\d+)?)\\s*,\\s*(-?\\d+(?:\\.\\d+)?)$`,
);

/** True when the address is nothing but coordinates, however they are spelled. */
export const isCoordsOnlyAddress = (address: string | null | undefined): boolean =>
  typeof address === 'string' && COORDS_ONLY_RE.test(address.trim());

/** The coordinates back out of either spelling. */
export const parseCoordsAddress = (address: string | null | undefined): LeadCoords | null => {
  if (typeof address !== 'string') return null;
  const m = COORDS_ONLY_RE.exec(address.trim());
  if (!m) return null;
  const coords = { latitude: Number(m[1]), longitude: Number(m[2]) };
  return isValidCoords(coords) ? coords : null;
};

/**
 * True while the address box still holds the placeholder — i.e. the rep has not typed a real
 * address over it. This is the test that decides whether a reverse-geocode may fill the field.
 *
 * ⚠️ Trailing whitespace is tolerated but any other edit is NOT: the moment a rep appends so much
 * as a house number the value stops being ours and becomes theirs, and must survive the sync.
 */
export const isCoordsPlaceholder = (address: string | null | undefined): boolean =>
  typeof address === 'string' && COORDS_PLACEHOLDER_RE.test(address.trim());

/** The coordinates back out of a placeholder, so a sync can geocode without a second source. */
export const parseCoordsPlaceholder = (address: string | null | undefined): LeadCoords | null => {
  if (typeof address !== 'string') return null;
  const m = COORDS_PLACEHOLDER_RE.exec(address.trim());
  if (!m) return null;
  const coords = { latitude: Number(m[1]), longitude: Number(m[2]) };
  return isValidCoords(coords) ? coords : null;
};

// ─── The rule that decides what gets filed ─────────────────────────────────────

export interface SyncAddressInput {
  /** Whatever is in the address box at sync time. */
  address: string | null | undefined;
  /** The GPS fix captured when the lead was created, if any. */
  coords?: LeadCoords | null;
  /**
   * The reverse-geocode of `coords`, resolved once the connection is back. `null` when it was not
   * attempted or it failed.
   */
  reverseGeocoded?: string | null;
}

export interface SyncAddressResult {
  /** What to send as `fullAddress` / `customer.address`. */
  address: string;
  /** Why — for the queue's audit line, and so a caller can tell a guess from a fact. */
  source: 'typed' | 'reverse-geocoded' | 'coords' | 'empty';
}

/**
 * Resolve the address to file for a lead, at the moment it is actually sent.
 *
 * Precedence, and the whole point of this module:
 *
 * | the rep… | what ships |
 * |---|---|
 * | typed an address | **their text** — a reverse-geocode NEVER overwrites it |
 * | left the placeholder and we geocoded | the geocoded address |
 * | left the placeholder and the geocode failed | the bare coordinates |
 * | gave us neither | `''` — the caller's own validation refuses it |
 *
 * ⚠️ The bare-coordinates row is deliberate. `formatCoords`, not `formatCoordsPlaceholder`: the
 * marker is a device-side affordance and must not reach the portal, where a 📍 in an address column
 * reads as corruption. Coordinates in that field are at least true and actionable — a blank is not.
 */
export const resolveSyncAddress = ({
  address,
  coords,
  reverseGeocoded,
}: SyncAddressInput): SyncAddressResult => {
  const typed = typeof address === 'string' ? address.trim() : '';

  // A real address the rep entered outranks everything, including a geocode we just fetched.
  // ⚠️ `isCoordsOnlyAddress`, not `isCoordsPlaceholder`: by upload time the value has already lost
  // its 📍 (the marker is stripped before filing), and the strict test would read those
  // coordinates as the rep's own typing and keep them forever.
  if (typed && !isCoordsOnlyAddress(typed)) return { address: typed, source: 'typed' };

  const geocoded = typeof reverseGeocoded === 'string' ? reverseGeocoded.trim() : '';
  if (geocoded) return { address: geocoded, source: 'reverse-geocoded' };

  // Prefer the captured fix over re-parsing the field: the placeholder is rounded for display.
  const fallback = isValidCoords(coords) ? coords : parseCoordsPlaceholder(typed);
  if (fallback) return { address: formatCoords(fallback), source: 'coords' };

  return { address: '', source: 'empty' };
};

/**
 * Whether a lead still needs its address resolved once the connection returns.
 *
 * Used by the sync drain to decide which queued creates to spend a reverse-geocode on — a typed
 * address needs none, and a lead with no fix at all cannot be helped by one.
 */
export const needsAddressResolution = (
  address: string | null | undefined,
  coords?: LeadCoords | null,
): boolean => {
  const typed = typeof address === 'string' ? address.trim() : '';
  if (typed && !isCoordsOnlyAddress(typed)) return false;
  return isValidCoords(coords) || !!parseCoordsAddress(typed);
};


// ─── Resolving a QUEUED lead's address at upload time ─────────────────────────

/**
 * The GPS fix out of a queued create payload.
 *
 * ⚠️ `location.coordinates` is GeoJSON, i.e. **[longitude, latitude]** — the opposite order to
 * every `{ latitude, longitude }` in this file. Reading it the obvious way round puts a Lahore
 * lead (31.46, 74.29) at 74.29, 31.46, which is a different country.
 */
export const coordsFromLeadPayload = (payload: any): LeadCoords | null => {
  const pair = payload?.location?.coordinates;
  if (Array.isArray(pair) && pair.length >= 2) {
    const geo = { latitude: Number(pair[1]), longitude: Number(pair[0]) };
    if (isValidCoords(geo)) return geo;
  }
  // The zone-canvasser branch writes them flat alongside `location`.
  const flat = { latitude: Number(payload?.latitude), longitude: Number(payload?.longitude) };
  if (isValidCoords(flat)) return flat;
  // Last resort: the address itself is the coordinates.
  return parseCoordsAddress(payload?.fullAddress) || parseCoordsAddress(payload?.customer?.address);
};

/**
 * Write a resolved street address back onto a queued create payload.
 *
 * ⚠️ BOTH fields. The lead record reads `fullAddress` and the customer record reads
 * `customer.address`; updating one leaves the Lead Center header and the Edit Customer form
 * disagreeing about where the job is.
 */
export const applyResolvedAddress = <T extends Record<string, any>>(payload: T, address: string): T => {
  if (!address) return payload;
  return {
    ...payload,
    fullAddress: address,
    ...(payload.customer ? { customer: { ...payload.customer, address } } : {}),
  };
};
