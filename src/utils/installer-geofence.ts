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
import { arrivalWindowMessage } from './installer-schedule';
import { isJobBypassActive } from './job-bypass';

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

/**
 * Where the installer was allowed to check in from.
 *
 * `bypass` is not a place — it is the answer for a job whose `gpsBypass` override made
 * the question moot. It is a distinct value rather than a reused `'customer'` so the
 * check-in log records that an override let this one through, and never claims the crew
 * was measured at the address when nothing was measured.
 */
export type CheckInMatch = 'customer' | 'office' | 'bypass';

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
  /**
   * Heading for the refusal. Carried here rather than fixed at the call site because
   * the two refusals are different problems — being far away and having location
   * switched off — and "Too far to check in" is simply wrong for the second.
   */
  title: string;
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

/**
 * Past this, "move closer" is useless advice — the crew has to drive, and naming the
 * radius would only be noise. Inside it, they are basically there and nudging them a few
 * steps is the whole fix.
 */
const NEARBY_METERS = 500;

/**
 * The one-line refusal.
 *
 * **The job's arrival window is the answer whenever it has one** — "This job will be
 * available between 12:00 - 4:00 PM when you arrive on site." It tells the crew the two
 * things they can act on, that the job opens on arrival and when it is theirs to work,
 * and it does not read as an accusation the way a distance does.
 *
 * Distance is the fallback for a job with no usable `leadTime`. It says only what is
 * useful at that distance: 24 km away needs a destination, 45 m away needs a nudge. It is
 * a poor primary message at the radius itself — a fix drifting 25–50 m is ordinary, so
 * "You're 47 m away. Move a bit closer" was routinely shown to a crew standing in the
 * driveway (`CHECK_IN_RADIUS_METERS` is deliberately tight; see its note).
 */
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

/** One reference point measured against the device fix. */
interface Candidate {
  kind: CheckInMatch;
  distance: number;
}

/**
 * Every accepted place, measured from `fix`. Empty when the job was never geocoded AND
 * the profile carries no locatable office — the "nothing to compare against" case both
 * callers below have to treat as open rather than as a refusal.
 *
 * Job site first, so a tie names the job rather than an office that happens to sit
 * next door.
 */
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

/**
 * Is this device fix at the job site, or at one of the company's offices?
 *
 * The synchronous, no-side-effects half of the gate below: it asks for no permission and
 * requests no fix, so it is safe to run on every render for every visible card. The
 * dashboard uses it to decide what the action button should SAY (see
 * `hooks/useInstallerProximity.ts`); `resolveCheckInEligibility` is what decides whether
 * the tap is actually allowed to check in.
 *
 * `inRange` is deliberately three-valued — `null` means there was nothing to compare
 * against, which must not be presented as "you're too far away". It is still a REFUSAL
 * (the gate below rejects that case), just a different one: the card shows Preview and
 * the gate's own message names the missing address rather than a distance.
 */
export interface Proximity {
  /** `true` in range, `false` out of range, `null` when there are no reference points. */
  inRange: boolean | null;
  /** Which reference point cleared the radius, when one did. */
  matched: CheckInMatch | null;
  /** Distance to the nearest reference point in metres, or null when there are none. */
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

// ─────────────────────────────────────────────────────────────────────────────
// Device fix
// ─────────────────────────────────────────────────────────────────────────────

export interface DeviceFix {
  coords: GeoCoordinates;
  /** Horizontal accuracy in metres, when the platform reports one. */
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
 * The verdict for a job carrying a manager's bypass: allowed, whatever was or wasn't
 * measured.
 *
 * Shared by the three ways a bypassed job reaches an allow — no reference points, no
 * device fix, and out of range — so none of them can drift into reporting a bypassed
 * check-in as an ordinary on-site one.
 */
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

/**
 * Decides whether this installer may check in to this job, right now.
 *
 * Order matters: the job site is checked before the offices, so `matched` names the
 * job when the installer is at the address (the normal case) rather than an office that
 * happens to sit next door.
 *
 * Everything that cannot be verified is REFUSED:
 *  - **No fix** → refused. An unverifiable location is the thing this gate exists to
 *    catch.
 *  - **No reference points at all** (job never geocoded AND the profile carries no
 *    locatable office) → refused. This used to be allowed, on the reasoning that
 *    refusing would strand a crew over a data gap they cannot fix from a roof — but it
 *    also meant any job the backend failed to geocode (a Plus Code address, say) opened
 *    from anywhere in the world, which is the rule this gate exists to enforce. The
 *    office is the fallback for a job with no point of its own; when there is no office
 *    either, there is no way to establish the crew is anywhere near the work.
 *
 *    ⚠️ This makes an ungeocoded job UNOPENABLE until its address is fixed. That is the
 *    intended trade-off, but it means a bad address is now a field-blocking bug, not a
 *    cosmetic one. A manager's bypass is the office's way out of it without a redeploy.
 *
 * **A bypass clears every one of those refusals** (`utils/job-bypass.ts`). Someone has
 * already decided the automatic checks are getting this job wrong — one of the reasons in
 * hand is literally "job address incorrect in system: installer is at the correct physical
 * location, system has wrong coordinates", which is a statement that the number this gate
 * computes is meaningless for this job. Measuring is then not merely unnecessary, it is the
 * thing producing the wrong answer.
 *
 * A fix is still REQUESTED, because the backend re-runs its own check on the coordinates
 * this sends and a bypassed check-in is worth recording the position of; it just cannot
 * refuse. So a job with no fix, no coordinates and no office still opens under the
 * override, which is the whole point of filing one.
 */
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
      // Names the real problem — the office has to fix the address; nothing the crew
      // does on site will change the outcome, so "move closer" would waste their time.
      title: "Can't verify this location",
      reason:
        "This job has no map location on file, so we can't confirm you're on site. Ask the office to add the address.",
    };
  }

  const fix = await getDeviceFix();
  if (!fix) {
    // Under a bypass, a missing fix is not a refusal — nothing was going to be measured
    // against it. `coords: null` then travels on: the check-in payload omits the location
    // rather than inventing one, and the server sees the same absence the phone did.
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
  // Guarded, not asserted: with a bypass in play the "no reference points" refusal above
  // is skipped, so this is the one path that can reach here with nothing to compare
  // against — and `reduce` on an empty array throws.
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

  // Out of range on the measurement, but the override says the measurement doesn't decide
  // this job. The distance is still reported — it is true, and it is what makes a bypassed
  // check-in reviewable afterwards — but `matched: 'bypass'` records that it did not
  // authorise anything.
  if (bypassed) {
    return allowedByBypass(
      fix.coords,
      nearest ? Math.round(nearest.distance) : null,
      job,
      fix.accuracy
    );
  }

  // Unreachable with no candidates: without a bypass, the empty case returned above.
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
