/**
 * A photo's activity log needs the stored image url, which only exists once the upload has finished.
 *
 * ⚠️ It used to be written by a fire-and-forget call that WAITED UP TO ~2 MINUTES, in memory, for the
 * server row to appear - after the queue item had already been removed. Backgrounding or killing the
 * app in that window (the normal end of a field session), or a dead lookup on weak cellular, lost the
 * log while the photo itself arrived: "images are on the portal, the capture logs are not".
 *
 * So the log is first recorded as a durable `PendingPhotoLog` BEFORE the queue item is removed, and
 * only handed to `logEvent` (which holds it durably when offline) once its image url is known - or,
 * after `MAX_LOOKUP_PASSES`, without one. It is never simply dropped.
 */
export interface PendingPhotoLog {
  id: string;
  userId: string;
  leadId: string;
  categoryName: string;
  subcategory: string;
  /** The photo's own capture time - becomes `meta.occurredAt`. */
  timestamp: string;
  coordinates: { latitude: number; longitude: number };
  existingUrls: string[];
  s3url: string;
  bucketName: string;
  lookups: number;
}

// Passes, not seconds: one lookup per pass, passes run on reconnect / foreground / the 60 s sweep and
// a short timer. Enough for a lead whose list lags for a long time; past it the log goes without an image.
export const MAX_LOOKUP_PASSES = 30;

export const isAnnotatedPhoto = (subcategory?: string): boolean =>
  !!subcategory && subcategory.includes('(Annotated)');

export const photoLogReady = (p: PendingPhotoLog): boolean =>
  !!p.s3url || p.lookups >= MAX_LOOKUP_PASSES;

export const buildPhotoLogDetails = (p: PendingPhotoLog) => {
  const annotated = isAnnotatedPhoto(p.subcategory);
  return {
    user_id: p.userId,
    module_type: annotated ? 'annotated_photos' : 'inspection_photo',
    created_by: p.userId,
    meta: {
      leadId: p.leadId,
      category: p.categoryName,
      subcategory: p.subcategory,
      // The shared action-time key (see utils/offline-activity-log.ts); the photo's own capture time.
      occurredAt: p.timestamp,
      coordinates: p.coordinates,
      size: 0,
      action: annotated ? 'annotated_photo_uploaded' : 'photo_uploaded',
      image_url: p.s3url,
      imageData: {
        s3url: p.s3url,
        bucketName: p.bucketName,
        category: p.categoryName,
        subcategory: p.subcategory,
        timestampTaken: p.timestamp,
        coordinates: p.coordinates,
      },
    },
  };
};

export const upsertPending = (list: PendingPhotoLog[], entry: PendingPhotoLog): PendingPhotoLog[] => [
  ...list.filter((p) => p.id !== entry.id),
  entry,
];

export const removePending = (list: PendingPhotoLog[], id: string): PendingPhotoLog[] =>
  list.filter((p) => p.id !== id);
