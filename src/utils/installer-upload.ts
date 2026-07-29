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
}

/**
 * Uploads one photo and returns the fields to merge onto it.
 *
 * Never throws: a failed upload resolves to `{ uploadStatus: 'failed' }` so the
 * capture stays on screen and the rep can retake. The caller decides what to show.
 *
 * `buildDescriptor` receives the resolved fix so each phase can shape its own
 * descriptor without every caller re-fetching the location.
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

  try {
    const result = await InstallerService.uploadImages(
      jobId,
      phase,
      [toUploadFile(photo, phase)],
      [buildDescriptor(coordinates)]
    );
    const stored = result.appended[0];
    if (!stored?.s3url) {
      console.warn('[InstallerUpload] Upload returned no image for', phase);
      return { patch: { uploadStatus: 'failed', coordinates }, size, coordinates };
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
    };
  } catch (err) {
    console.warn(`[InstallerUpload] ${phase} upload failed:`, err);
    return { patch: { uploadStatus: 'failed', coordinates }, size, coordinates };
  }
};
