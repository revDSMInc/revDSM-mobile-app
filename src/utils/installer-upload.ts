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
        resolve(cachedFix?.coords ?? null);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: LOCATION_TTL_MS }
    );
  });

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
  webp: 'image/webp',
};

export const toUploadFile = (photo: CapturedPhoto, phase: InstallerImagePhase): InstallerUploadFile => {
  const rawName = photo.uri.split('?')[0].split('/').pop() || '';
  const ext = (rawName.split('.').pop() || '').toLowerCase();
  const known = MIME_BY_EXT[ext];

  return {
    uri: photo.uri,
    name: known ? rawName : `${phase}-${photo.id}.jpg`,
    type: known ?? 'image/jpeg',
  };
};

export const getPhotoSize = async (uri: string): Promise<number> => {
  if (!uri.startsWith('file://') && !uri.startsWith('/')) return 0;
  try {
    const stat = await ReactNativeBlobUtil.fs.stat(uri.replace('file://', ''));
    return Number(stat?.size) || 0;
  } catch {
    return 0;
  }
};

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

export const isInstallerSourcedPhoto = (source?: string): boolean =>
  (source ?? '').trim().toLowerCase() === 'installer';

export const matchedPhotoIdRef = (
  tag: PhotoTag
): Pick<InstallerImageDescriptor, 'salesPhotoId' | 'preInstallPhotoId'> => {
  if (!tag.repPhotoId) return {};
  return isInstallerSourcedPhoto(tag.repPhotoSource)
    ? { preInstallPhotoId: tag.repPhotoId }
    : { salesPhotoId: tag.repPhotoId };
};

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

export const cocDescriptor = (
  photo: CapturedPhoto,
  coordinates: GeoCoordinates | null
): InstallerImageDescriptor => ({
  subcategory: 'coc',
  timestampTaken: photo.takenAt,
  coordinates,
});

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

export const imagePhaseOf = (phase: PhotoPhase): InstallerImagePhase =>
  phase === 'pre' ? 'pre' : 'post';

export interface UploadedPhotoPatch {
  uploadStatus: 'uploaded' | 'failed';
  s3url?: string;
  bucketName?: string;
  serverId?: string;
  coordinates?: GeoCoordinates | null;
}

export interface UploadOutcome {
  patch: UploadedPhotoPatch;
  size: number;
  coordinates: GeoCoordinates | null;
  attempts: number;
  scan: CocScanFields | null;
}

const UPLOAD_ATTEMPTS = 3;

const RETRY_DELAY_MS = [2000, 6000];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isRetryableUploadError = (err: any): boolean => {
  const status = Number(err?.httpStatus ?? err?.response?.status ?? err?.code);
  if (!Number.isFinite(status) || status === 0) return true;
  if (status === 408 || status === 429) return true;
  return status >= 500;
};

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

      console.warn(
        `[InstallerUpload] ${phase} upload attempt ${attempt} failed, retrying:`,
        err
      );
      await wait(RETRY_DELAY_MS[attempt - 1] ?? RETRY_DELAY_MS[RETRY_DELAY_MS.length - 1]);
    }
  }

  return failed(UPLOAD_ATTEMPTS);
};
