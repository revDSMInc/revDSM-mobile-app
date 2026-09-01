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
 *   pre / post      → `{ <id key>, category, subcategory, timestampTaken }`, where the
 *                     id key is `salesPhotoId` or `preInstallPhotoId` — see
 *                     `matchedPhotoIdRef`
 * `coordinates` is appended to all of them when the device can produce a fix.
 */

import Geolocation from 'react-native-geolocation-service';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { InstallerService } from '../services/api/installer';
import type {
  CapturedPhoto,
  CocScanFields,
  GeoCoordinates,
  InstallerImageDescriptor,
  InstallerImagePhase,
  InstallerUploadFile,
  PhotoSection,
  PhotoTag,
  PhotoPhase,
  StatusReasonImage,
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
 * Is the tag ghosting an INSTALLER capture rather than the rep's sales photo?
 *
 * Read off the API row's own `source` field, case- and whitespace-insensitively —
 * anything that is not `"installer"` (including a row that carries no `source` at all,
 * which is every pre-existing record) is treated as a sales photo, so the historic
 * behaviour is the default.
 */
export const isInstallerSourcedPhoto = (source?: string): boolean =>
  (source ?? '').trim().toLowerCase() === 'installer';

/**
 * The id key the paired reference photo must be sent under.
 *
 * ⚠️ The reference set (`job.preInstallPhotos`) holds rows from TWO collections and
 * each row says which it came from. An id from the installer's own pre-install capture
 * sent as `salesPhotoId` points the backend at a row that does not exist in the sales
 * collection — the upload still succeeds, so nothing looks wrong on the device, and the
 * before/after pairing simply never forms on the portal.
 *
 * Exactly one key is ever emitted, and NEITHER when the tag has no reference photo (a
 * free shot on a tag the rep never covered) — an explicit `undefined` id would read as
 * a claim that the row exists.
 */
export const matchedPhotoIdRef = (
  tag: PhotoTag
): Pick<InstallerImageDescriptor, 'salesPhotoId' | 'preInstallPhotoId'> => {
  if (!tag.repPhotoId) return {};
  return isInstallerSourcedPhoto(tag.repPhotoSource)
    ? { preInstallPhotoId: tag.repPhotoId }
    : { salesPhotoId: tag.repPhotoId };
};

/**
 * A matched ghost shot. The id ref is the reference photo this one pairs with — the
 * link the portal uses to show them side by side.
 */
export const matchedPhotoDescriptor = (
  tag: PhotoTag,
  photo: CapturedPhoto,
  coordinates: GeoCoordinates | null
): InstallerImageDescriptor => ({
  ...matchedPhotoIdRef(tag),
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

/** A free shot with no rep counterpart — carries the section, no reference id. */
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
  /**
   * The certificate read off a scanned page — `cocPaperFallback` only, `null` on
   * every other phase and on a page the backend could not read.
   */
  scan: CocScanFields | null;
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
 * are resolved ONCE, outside the retry loop — a retry re-sends the original capture,
 * including where and when it was taken, not a fresh fix from wherever the crew has
 * walked to since.
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
    scan: null,
  });

  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    try {
      const result = await InstallerService.uploadImages(jobId, phase, [file], [descriptor]);
      const stored = result.appended[0];

      if (!stored?.s3url) {
        // A 2xx that stored nothing. The server has answered, and it answers the same
        // way every time for the same body, so this is final — retrying would only
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
        scan: result.scan ?? null,
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
