import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import type { GeoCoordinates, InstallerJob } from '../config/types/installer';
import { getAllOfficeCoords, type OfficeCoords } from './office-location';
import { arrivalWindowMessage } from './installer-schedule';
import { isJobBypassActive } from './job-bypass';

export const CHECK_IN_RADIUS_METERS = 20;

export type CheckInMatch = 'customer' | 'office' | 'bypass';

export interface CheckInEligibility {
  allowed: boolean;
  coords: GeoCoordinates | null;
  matched: CheckInMatch | null;
  distanceMeters: number | null;
  accuracyMeters: number | null;
  title: string;
  reason: string;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export const distanceMeters = (a: GeoCoordinates, b: GeoCoordinates): number => {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
};

export const formatDistance = (meters: number): string =>
  meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;

const NEARBY_METERS = 500;

const tooFarMessage = (
  meters: number,
  nearest: CheckInMatch,
  job?: InstallerJob | null
): string => {
  const window = arrivalWindowMessage(job);
  if (window) return window;

  const away = `You're ${formatDistance(meters)} away.`;
  if (meters < NEARBY_METERS) return `${away} Move a bit closer and try again.`;
  return nearest === 'office'
    ? `${away} Check in at the job site or a company office.`
    : `${away} Head to the job site to check in.`;
};

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

interface Candidate {
  kind: CheckInMatch;
  distance: number;
}

const buildCandidates = (
  fix: GeoCoordinates,
  jobCoords: GeoCoordinates | null,
  offices: OfficeCoords[]
): Candidate[] => {
  const candidates: Candidate[] = [];
  if (jobCoords) {
    candidates.push({ kind: 'customer', distance: distanceMeters(fix, jobCoords) });
  }
  offices.forEach((office) => {
    candidates.push({ kind: 'office', distance: distanceMeters(fix, office) });
  });
  return candidates;
};

export interface Proximity {
  inRange: boolean | null;
  matched: CheckInMatch | null;
  nearestMeters: number | null;
}

export const resolveProximity = (
  fix: GeoCoordinates,
  job: InstallerJob,
  user: any,
  radiusMeters: number = CHECK_IN_RADIUS_METERS
): Proximity => {
  const candidates = buildCandidates(fix, getJobCoords(job), getAllOfficeCoords(user));
  if (!candidates.length) {
    return { inRange: null, matched: null, nearestMeters: null };
  }

  const within = candidates.find((c) => c.distance <= radiusMeters);
  const nearest = candidates.reduce((a, b) => (b.distance < a.distance ? b : a));

  return {
    inRange: !!within,
    matched: within?.kind ?? null,
    nearestMeters: Math.round(nearest.distance),
  };
};

export interface DeviceFix {
  coords: GeoCoordinates;
  accuracy: number | null;
}

export const ensureLocationPermission = async (): Promise<boolean> => {
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

const allowedByBypass = (
  coords: GeoCoordinates | null,
  distance: number | null,
  job: InstallerJob,
  accuracy: number | null = null
): CheckInEligibility => {
  if (__DEV__) {
    const why = [
      job.installerBypass?.gpsBypassReason,
      job.installerBypass?.earlyStartReason,
    ]
      .filter(Boolean)
      .join(' · ');
    console.log(
      '[InstallerGeofence] bypass active → check-in allowed without a radius check' +
        (why ? ` (${why})` : '')
    );
  }

  return {
    allowed: true,
    coords,
    matched: 'bypass',
    distanceMeters: distance,
    accuracyMeters: accuracy,
    title: '',
    reason: '',
  };
};

export const resolveCheckInEligibility = async (
  job: InstallerJob,
  user: any,
  radiusMeters: number = CHECK_IN_RADIUS_METERS
): Promise<CheckInEligibility> => {
  const jobCoords = getJobCoords(job);
  const offices: OfficeCoords[] = getAllOfficeCoords(user);
  const bypassed = isJobBypassActive(job);

  if (!jobCoords && offices.length === 0 && !bypassed) {
    console.warn(
      '[InstallerGeofence] No job coordinates and no locatable office — check-in refused.'
    );
    return {
      allowed: false,
      coords: null,
      matched: null,
      distanceMeters: null,
      accuracyMeters: null,
      title: "Can't verify this location",
      reason:
        "This job has no map location on file, so we can't confirm you're on site. Ask the office to add the address.",
    };
  }

  const fix = await getDeviceFix();
  if (!fix) {
    if (bypassed) return allowedByBypass(null, null, job);

    return {
      allowed: false,
      coords: null,
      matched: null,
      distanceMeters: null,
      accuracyMeters: null,
      title: 'Location needed',
      reason: 'Turn on location for revDSM, then try again.',
    };
  }

  const candidates = buildCandidates(fix.coords, jobCoords, offices);

  const within = candidates.find((c) => c.distance <= radiusMeters);
  const nearest = candidates.length
    ? candidates.reduce((a, b) => (b.distance < a.distance ? b : a))
    : null;

  if (__DEV__) {
    console.log(
      `[InstallerGeofence] fix ${fix.coords.latitude.toFixed(5)}, ` +
        `${fix.coords.longitude.toFixed(5)} (±${fix.accuracy ?? '?'} m) · ` +
        candidates
          .map((c) => `${c.kind} ${Math.round(c.distance)} m`)
          .join(' · ') +
        ` · radius ${radiusMeters} m → ` +
        (within ? 'ALLOW' : bypassed ? 'ALLOW (bypass)' : 'BLOCK')
    );
  }

  if (within) {
    return {
      allowed: true,
      coords: fix.coords,
      matched: within.kind,
      distanceMeters: Math.round(within.distance),
      accuracyMeters: fix.accuracy,
      title: '',
      reason: '',
    };
  }

  if (bypassed) {
    return allowedByBypass(
      fix.coords,
      nearest ? Math.round(nearest.distance) : null,
      job,
      fix.accuracy
    );
  }

  return {
    allowed: false,
    coords: fix.coords,
    matched: null,
    distanceMeters: nearest ? Math.round(nearest.distance) : null,
    accuracyMeters: fix.accuracy,
    title: 'Too far to check in',
    reason: nearest
      ? tooFarMessage(nearest.distance, nearest.kind, job)
      : "This job has no map location on file, so we can't confirm you're on site.",
  };
};
