/**
 * Check-in geofence — the installer must physically be at the job (or at a company
 * office) before the job will open.
 *
 * Two accepted places, both compared against the device's own fix:
 *   1. the customer's job site — `location.coordinates` on the `my-jobs` row, GeoJSON
 *      `[longitude, latitude]` (NOT lat/lng — the order is the usual trap here);
 *   2. any company office — `user.office[]` from `GET /company`, where the real point
 *      lives on `verifiedAddress.lat/lon` and the top-level `lat`/`long` are usually null.
 *
 * The device fix is the reference for BOTH, so a crew that stages at the office in the
 * morning can still check in, and a crew standing on the driveway can too — but nobody
 * can open a job from home.
 *
 * The gate runs on-device so the installer gets an immediate, explanatory refusal
 * instead of a round-trip and a 4xx; the same coordinates and `radius` are then sent on
 * the check-in request so the backend can enforce it independently. Client-side
 * distance is a convenience, not the authority — a rooted phone can lie about its fix.
 */

import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import type { GeoCoordinates, InstallerJob } from '../config/types/installer';
import { getAllOfficeCoords, type OfficeCoords } from './office-location';

/**
 * How close is close enough, in metres.
 *
 * ⚠️ 20 m is tighter than a consumer GPS fix is reliably accurate (a phone under tree
 * cover or beside a two-storey wall commonly reports ±15–30 m), so expect some
 * legitimate on-site check-ins to be refused. Widen here if the field reports it —
 * this constant is the only place the radius is defined, and it is what travels to the
 * backend as `radius`.
 */
export const CHECK_IN_RADIUS_METERS = 20;

/** Where the installer was allowed to check in from. */
export type CheckInMatch = 'customer' | 'office';

export interface CheckInEligibility {
  allowed: boolean;
  /** The device fix used for the comparison. Null when none could be obtained. */
  coords: GeoCoordinates | null;
  /** Which reference point cleared the radius. Null when none did. */
  matched: CheckInMatch | null;
  /** Distance to the nearest reference point, in metres. Null when there were none. */
  distanceMeters: number | null;
  /** Reported horizontal accuracy of the fix, in metres, when the platform gives one. */
  accuracyMeters: number | null;
  /** Installer-facing explanation. Empty when allowed. */
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Distance
// ─────────────────────────────────────────────────────────────────────────────

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. Haversine — exact enough well below a kilometre. */
export const distanceMeters = (a: GeoCoordinates, b: GeoCoordinates): number => {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** Metres → the phrasing the installer sees ("18 m" / "1.4 km"). */
export const formatDistance = (meters: number): string =>
  meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;

// ─────────────────────────────────────────────────────────────────────────────
// Reference points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The job site, out of the `my-jobs` row.
 *
 * `location.coordinates` is GeoJSON — `[longitude, latitude]`. Returns null for a job
 * the API never geocoded, and for the (0,0) the API uses to mean "unset".
 */
export const getJobCoords = (job?: InstallerJob | null): GeoCoordinates | null => {
  const pair = job?.location?.coordinates;
  if (!Array.isArray(pair) || pair.length < 2) return null;

  const longitude = Number(pair[0]);
  const latitude = Number(pair[1]);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  return { latitude, longitude };
};

// ─────────────────────────────────────────────────────────────────────────────
// Device fix
// ─────────────────────────────────────────────────────────────────────────────

export interface DeviceFix {
  coords: GeoCoordinates;
  /** Horizontal accuracy in metres, when the platform reports one. */
  accuracy: number | null;
}

const ensureLocationPermission = async (): Promise<boolean> => {
  if (Platform.OS === 'ios') {
    const status = await Geolocation.requestAuthorization('whenInUse');
    return status === 'granted';
  }
  const already = await PermissionsAndroid.check(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
  );
  if (already) return true;

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location required to check in',
      message:
        'revDSM confirms you are at the job site before opening an install. Please allow location access.',
      buttonPositive: 'Allow',
      buttonNegative: 'Cancel',
    }
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
};

/**
 * A FRESH high-accuracy fix — `maximumAge: 0` deliberately.
 *
 * The photo-capture helper caches a fix for five minutes because a burst of shots comes
 * from one spot; a check-in cannot, because a five-minute-old fix is exactly the one
 * taken in the van two streets away. Resolves null when permission is refused or the
 * fix times out.
 */
export const getDeviceFix = async (timeoutMs = 15000): Promise<DeviceFix | null> => {
  const permitted = await ensureLocationPermission().catch(() => false);
  if (!permitted) return null;

  return new Promise<DeviceFix | null>((resolve) => {
    Geolocation.getCurrentPosition(
      (position) =>
        resolve({
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          accuracy: Number.isFinite(position.coords.accuracy)
            ? position.coords.accuracy
            : null,
        }),
      (err) => {
        console.warn('[InstallerGeofence] Could not get a fix:', err?.code, err?.message);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// The gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decides whether this installer may check in to this job, right now.
 *
 * Order matters: the job site is checked before the offices, so `matched` names the
 * job when the installer is at the address (the normal case) rather than an office that
 * happens to sit next door.
 *
 * Two deliberate open cases:
 *  - **No reference points at all** (job never geocoded AND the profile carries no
 *    locatable office) → allowed. There is nothing to compare against, and refusing
 *    would strand a crew over a data gap they cannot fix from a roof.
 *  - **No fix** → refused, since an unverifiable location is the thing this gate exists
 *    to catch.
 */
export const resolveCheckInEligibility = async (
  job: InstallerJob,
  user: any,
  radiusMeters: number = CHECK_IN_RADIUS_METERS
): Promise<CheckInEligibility> => {
  const jobCoords = getJobCoords(job);
  const offices: OfficeCoords[] = getAllOfficeCoords(user);

  if (!jobCoords && offices.length === 0) {
    console.warn(
      '[InstallerGeofence] No job coordinates and no locatable office — check-in not gated.'
    );
    return {
      allowed: true,
      coords: null,
      matched: null,
      distanceMeters: null,
      accuracyMeters: null,
      reason: '',
    };
  }

  const fix = await getDeviceFix();
  if (!fix) {
    return {
      allowed: false,
      coords: null,
      matched: null,
      distanceMeters: null,
      accuracyMeters: null,
      reason:
        'Turn on location and allow revDSM to use it, then try again. You must be at the job site or a company office to check in.',
    };
  }

  const candidates: { kind: CheckInMatch; distance: number }[] = [];
  if (jobCoords) {
    candidates.push({ kind: 'customer', distance: distanceMeters(fix.coords, jobCoords) });
  }
  offices.forEach((office) => {
    candidates.push({ kind: 'office', distance: distanceMeters(fix.coords, office) });
  });

  const within = candidates.find((c) => c.distance <= radiusMeters);
  const nearest = candidates.reduce((a, b) => (b.distance < a.distance ? b : a));

  if (__DEV__) {
    console.log(
      `[InstallerGeofence] fix ${fix.coords.latitude.toFixed(5)}, ` +
        `${fix.coords.longitude.toFixed(5)} (±${fix.accuracy ?? '?'} m) · ` +
        candidates
          .map((c) => `${c.kind} ${Math.round(c.distance)} m`)
          .join(' · ') +
        ` · radius ${radiusMeters} m → ${within ? 'ALLOW' : 'BLOCK'}`
    );
  }

  if (within) {
    return {
      allowed: true,
      coords: fix.coords,
      matched: within.kind,
      distanceMeters: Math.round(within.distance),
      accuracyMeters: fix.accuracy,
      reason: '',
    };
  }

  return {
    allowed: false,
    coords: fix.coords,
    matched: null,
    distanceMeters: Math.round(nearest.distance),
    accuracyMeters: fix.accuracy,
    reason:
      `You're ${formatDistance(nearest.distance)} from the ` +
      `${nearest.kind === 'customer' ? 'job site' : 'nearest office'}. ` +
      `Check in within ${radiusMeters} m of the customer's address or a company office.`,
  };
};
