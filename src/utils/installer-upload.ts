/**
 * Installer photo upload — `installer/v1/{jobId}/images`.
 *
 * Every install photo takes the same path: capture → S3 (multipart, this file) →
 * the returned `s3url` is stored back on the local `CapturedPhoto` → the step-data
 * PATCH (`installer-step-data.ts`) references it. A photo with no `s3url` has not
 * been persisted, which is why the descriptor builders and the phase are kept here
 * rather than inline in the screens.
 *
 * Descriptor shapes are per-phase and mirror the payloads the backend already
 * accepts:
 *   pickup / return → `{ subcategory: <phase>, timestampTaken }`
 *   preExisting     → `{ conditionLabel, subcategory, timestampTaken }`
 *   pre / post      → `{ salesPhotoId, category, subcategory, timestampTaken }`
 * `coordinates` is appended to all of them when the device can produce a fix.
 */

import Geolocation from 'react-native-geolocation-service';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { InstallerService } from '../services/api/installer';
import type {
  CapturedPhoto,
  GeoCoordinates,
  InstallerImageDescriptor,
  InstallerImagePhase,
  InstallerUploadFile,
  PhotoSection,
  PhotoTag,
  PhotoPhase,
} from '../config/types/installer';

// ─────────────────────────────────────────────────────────────────────────────
// Location
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fixes are cached for 5 minutes, matching `uploadQueue`. An installer shoots a
 * burst of photos from roughly one spot, so re-powering GPS per shot would only add
 * seconds to each capture.
 */
const LOCATION_TTL_MS = 5 * 60 * 1000;
let cachedFix: { coords: GeoCoordinates; at: number } | null = null;

export const getCaptureCoordinates = (): Promise<GeoCoordinates | null> =>
  new Promise((resolve) => {
    if (cachedFix && Date.now() - cachedFix.at < LOCATION_TTL_MS) {
      resolve(cachedFix.coords);
      return;
    }
    Geolocation.getCurrentPosition(
      (position) => {
        cachedFix = {
          coords: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          at: Date.now(),
        };
        resolve(cachedFix.coords);
      },
      (err) => {
        console.warn('[InstallerUpload] Could not get location:', err);
        // A missing fix must never block the upload — the field is nullable.
        resolve(cachedFix?.coords ?? null);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: LOCATION_TTL_MS }
    );
  });

// ─────────────────────────────────────────────────────────────────────────────
// File part
// ─────────────────────────────────────────────────────────────────────────────

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  webp: 'image/webp',
};

/** `file:///…/abc.jpg` → `{ uri, name: 'abc.jpg', type: 'image/jpeg' }`. */
export const toUploadFile = (photo: CapturedPhoto, phase: InstallerImagePhase): InstallerUploadFile => {
  const rawName = photo.uri.split('?')[0].split('/').pop() || '';
  const ext = (rawName.split('.').pop() || '').toLowerCase();
  const known = MIME_BY_EXT[ext];

  return {
    uri: photo.uri,
    // Vision-camera paths are already unique; the fallback keeps remote/mock URIs
    // (which have no filename) from colliding.
    name: known ? rawName : `${phase}-${photo.id}.jpg`,
    type: known ?? 'image/jpeg',
  };
};

/**
 * Bytes on disk, for the activity log's `size` field.
 *
 * Returns 0 rather than throwing: a remote/simulator stand-in URI has no local file,
 * and a missing size must never stop the upload.
 */
export const getPhotoSize = async (uri: string): Promise<number> => {
  if (!uri.startsWith('file://') && !uri.startsWith('/')) return 0;
  try {
    const stat = await ReactNativeBlobUtil.fs.stat(uri.replace('file://', ''));
    return Number(stat?.size) || 0;
  } catch {
    return 0;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Descriptors
// ─────────────────────────────────────────────────────────────────────────────

export const materialDescriptor = (
  phase: 'pickup' | 'return',
  photo: CapturedPhoto,
  coordinates: GeoCoordinates | null
): InstallerImageDescriptor => ({
  subcategory: phase,
  timestampTaken: photo.takenAt,
  coordinates,
});

export const preExistingDescriptor = (
  areaLabel: string,
  photo: CapturedPhoto,
  coordinates: GeoCoordinates | null
): InstallerImageDescriptor => ({
  conditionLabel: areaLabel,
  subcategory: areaLabel,
  timestampTaken: photo.takenAt,
  coordinates,
});

/**
 * A matched ghost shot. `salesPhotoId` is the rep photo this one pairs with — the
 * link the portal uses to show them side by side.
 */
export const matchedPhotoDescriptor = (
  tag: PhotoTag,
  photo: CapturedPhoto,
  coordinates: GeoCoordinates | null
): InstallerImageDescriptor => ({
  salesPhotoId: tag.repPhotoId,
  category: tag.categoryLabel,
  subcategory: tag.label,
  timestampTaken: photo.takenAt,
  coordinates,
});

/**
 * A scanned page of the signed Certificate of Completion.
 *
 * `subcategory: 'coc'` matches the pickup/return convention — the phase name doubles
 * as the subcategory where there is no finer grouping. Page ORDER is carried by
 * `timestampTaken`, not by an index: the scanner stamps each page as it is produced
 * and the hydrate sorts on it, so a rescanned page lands where it belongs.
 */
export const cocDescriptor = (
  photo: CapturedPhoto,
  coordinates: GeoCoordinates | null
): InstallerImageDescriptor => ({
  subcategory: 'coc',
  timestampTaken: photo.takenAt,
  coordinates,
});

/** A free shot with no rep counterpart — carries the section, no `salesPhotoId`. */
export const extraPhotoDescriptor = (
  section: PhotoSection,
  photo: CapturedPhoto,
  coordinates: GeoCoordinates | null
): InstallerImageDescriptor => ({
  category: section.categoryLabel ?? section.name,
  subcategory: 'Extras',
  timestampTaken: photo.takenAt,
  coordinates,
});

/**
 * A result-evidence shot — Can't Do Work / Not Hit / Reset.
 *
 * Carries the reason label as `conditionLabel` and `'result'` as subcategory,
 * so the IM can see what the photo was attached to.
 */
export const resultDescriptor = (
  reasonLabel: string,
  photo: CapturedPhoto,
  coordinates: GeoCoordinates | null
): InstallerImageDescriptor => ({
  conditionLabel: `Result — ${reasonLabel}`,
  subcategory: 'result',
  timestampTaken: photo.takenAt,
  coordinates,
});

/** `PhotoPhase` (UI) → `InstallerImagePhase` (API). Same words, distinct unions. */
export const imagePhaseOf = (phase: PhotoPhase): InstallerImagePhase =>
  phase === 'pre' ? 'pre' : 'post';

// ─────────────────────────────────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────────────────────────────────

export interface UploadedPhotoPatch {
  uploadStatus: 'uploaded' | 'failed';
  s3url?: string;
  bucketName?: string;
  serverId?: string;
  coordinates?: GeoCoordinates | null;
}

/** Everything the activity log needs about an upload, alongside the state patch. */
export interface UploadOutcome {
  patch: UploadedPhotoPatch;
  size: number;
  coordinates: GeoCoordinates | null;
  /** How many times the photo was sent — 1 when it landed first try. */
  attempts: number;
}

/**
 * How many times one photo is sent before the installer is told to retake it.
 *
 * A single attempt was the original behaviour, and it is why a crew on a roof saw
 * "Couldn't upload the Roofline Front photo" for what was usually one bad moment on a
 * job-site LTE cell. The bytes are already on the device — resending them costs the
 * installer nothing, while a retake costs them a climb.
 */
const UPLOAD_ATTEMPTS = 3;

/**
 * Waits before attempts 2 and 3.
 *
 * Short enough that a recovered connection is used almost immediately, long enough that
 * three attempts on a genuinely dead network don't all burn inside the same dead second.
 * The photo stays marked `uploading` for the whole run, so the header count and the
 * leave-guard both keep covering it.
 */
const RETRY_DELAY_MS = [2000, 6000];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tail of the upload chain — **one installer photo is sent at a time, app-wide**.
 *
 * Captures were previously fired the instant the shutter closed, so a crew working
 * through the ghost tagger had three or four multipart PUTs in the air at once, all
 * appending to the SAME job document. That is a read-modify-write race: the server
 * reads the photo array, appends one shot, writes it back — and the write that lands
 * second has a copy of the array from before the first, so one upload silently loses
 * its entry (or the write is rejected outright). Which is exactly what the field saw:
 * several photos land, one comes back "Couldn't upload …" after a single attempt, and
 * the step-data PATCH then has nothing to reference for it.
 *
 * Serializing costs nothing an installer notices — the bytes go out over one cell
 * connection either way, and the queue drains in the background while they keep
 * shooting — and it removes the race rather than papering over it with more retries.
 */
let uploadChain: Promise<unknown> = Promise.resolve();

/**
 * Runs `task` after everything already queued, whatever happened to it.
 *
 * The chain is advanced with a SWALLOWED copy of the result, so one photo's failure
 * can never reject the chain and take the queue down with it; the real promise, with
 * its real outcome, is what the caller gets back.
 */
const enqueueUpload = <T,>(task: () => Promise<T>): Promise<T> => {
  const run = uploadChain.then(task, task);
  uploadChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
};

/**
 * Is sending the same bytes again worth anything?
 *
 * Yes for the failures that are about the moment — no response at all (offline,
 * timeout, dropped cell), 408, 429, and any 5xx. No for a verdict the server has
 * already reached about this request: 401/403 (the session), 413 (too big), 422/400
 * (malformed). Retrying those just makes the installer wait longer for the same answer.
 *
 * The axios interceptor rejects with the server's own body, so the status can arrive as
 * `httpStatus`, as `code`, or on `response`. A transport failure has none of them and a
 * non-numeric axios `code` (`ECONNABORTED`, `ERR_NETWORK`) — both land on retryable,
 * which is the safe default here.
 */
const isRetryableUploadError = (err: any): boolean => {
  const status = Number(err?.httpStatus ?? err?.response?.status ?? err?.code);
  if (!Number.isFinite(status) || status === 0) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500;
};

/**
 * Uploads one photo and returns the fields to merge onto it.
 *
 * Retries a transient failure up to `UPLOAD_ATTEMPTS` times (see above) before giving
 * up. Never throws: an exhausted upload resolves to `{ uploadStatus: 'failed' }` so the
 * capture stays on screen and the rep can retake. The caller decides what to show.
 *
 * `buildDescriptor` receives the resolved fix so each phase can shape its own
 * descriptor without every caller re-fetching the location. Both it and the location
 * are resolved ONCE, **before the photo is queued** — so a shot that waits behind two
 * others is still stamped with where and when IT was taken, not with wherever the crew
 * had walked to by the time the queue reached it. The same resolved pair is reused
 * across retries for the same reason.
 */
export const uploadInstallerPhoto = async (
  jobId: string,
  phase: InstallerImagePhase,
  photo: CapturedPhoto,
  buildDescriptor: (coordinates: GeoCoordinates | null) => InstallerImageDescriptor
): Promise<UploadOutcome> => {
  const [coordinates, size] = await Promise.all([
    getCaptureCoordinates(),
    getPhotoSize(photo.uri),
  ]);

  const file = toUploadFile(photo, phase);
  const descriptor = buildDescriptor(coordinates);
  const failed = (attempts: number): UploadOutcome => ({
    patch: { uploadStatus: 'failed', coordinates },
    size,
    coordinates,
    attempts,
  });

  return enqueueUpload(() => sendPhoto(jobId, phase, file, descriptor, coordinates, size, failed));
};

/**
 * The request half of `uploadInstallerPhoto`, run one at a time by `enqueueUpload`.
 *
 * Split out so the location fix, the file part and the descriptor are all built at
 * CAPTURE time while everything about the shot is still true, and only the network
 * work waits its turn in the queue.
 */
const sendPhoto = async (
  jobId: string,
  phase: InstallerImagePhase,
  file: InstallerUploadFile,
  descriptor: InstallerImageDescriptor,
  coordinates: GeoCoordinates | null,
  size: number,
  failed: (attempts: number) => UploadOutcome
): Promise<UploadOutcome> => {
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      const result = await InstallerService.uploadImages(jobId, phase, [file], [descriptor]);
      // `appended` is the contract, but a response carrying only the full post-append
      // list still says what landed: uploads are serialized, so exactly one photo is in
      // flight and the TAIL of that list is this one. Without the fallback a perfectly
      // good upload was reported to the installer as "Couldn't upload …" after a single
      // attempt, purely because the field it was read from was absent.
      const stored = result.appended[0] ?? result.photos[result.photos.length - 1];

      if (!stored?.s3url) {
        // A 2xx that stored nothing at all. The server has answered, and it answers the
        // same way every time for the same body, so this is final — retrying would only
        // delay the message by two more round-trips.
        console.warn('[InstallerUpload] Upload returned no image for', phase);
        return failed(attempt);
      }

      if (attempt > 1) {
        console.log(`[InstallerUpload] ${phase} upload recovered on attempt ${attempt}.`);
      }

      return {
        patch: {
          uploadStatus: 'uploaded',
          s3url: stored.s3url,
          bucketName: stored.bucketName,
          serverId: stored._id,
          coordinates,
        },
        size,
        coordinates,
        attempts: attempt,
      };
    } catch (err) {
      const isLast = attempt === UPLOAD_ATTEMPTS;
      if (isLast || !isRetryableUploadError(err)) {
        console.warn(
          `[InstallerUpload] ${phase} upload failed after ${attempt} attempt(s):`,
          err
        );
        return failed(attempt);
      }

      // `warn`, not `error`: LogBox pops a full-screen red overlay on console.error in
      // a dev build, which would alarm the rep over a blip that is about to fix itself
      // — the same reasoning as `uploadQueue`'s retry logging.
      console.warn(
        `[InstallerUpload] ${phase} upload attempt ${attempt} failed, retrying:`,
        err
      );
      await wait(RETRY_DELAY_MS[attempt - 1] ?? RETRY_DELAY_MS[RETRY_DELAY_MS.length - 1]);
    }
  }

  // Unreachable — every path inside the loop returns. Here for the type checker.
  return failed(UPLOAD_ATTEMPTS);
};
