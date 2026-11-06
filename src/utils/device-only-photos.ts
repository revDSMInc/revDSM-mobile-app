/**
 * Which photos survive when the SERVER says a lead has none.
 *
 * ⚠️ WHY THIS EXISTS. Reported as data loss, and the client's words were that it feels like
 * losing work: a rep shot four photos at a door with no signal, closed the camera, and watched
 * every count and grid fall to 0 - then found them again after navigating away and back.
 *
 * The photos were never lost. `JobDocsSection.handleUpload` does two things per shot: it writes
 * an optimistic entry into `sectionImages` (a local `file://` uri, no `s3url`) and it queues the
 * upload. Closing the camera fires the upload-queue listener, which calls `refetch()`; offline
 * that hydrates the lead from cache, which hands `lead.salesPhotos` a NEW ARRAY IDENTITY. The
 * effect keyed on `[lead?.salesPhotos]` re-ran, took the "no server photos" branch and called
 * `setSectionImages({})` - wiping the optimistic entries. The queue still held all four, which
 * is exactly why a remount brought them back.
 *
 * The rule: **a photo with no `s3url` has never been to the server, so the server's list is no
 * evidence about it.** Only server-backed entries may be cleared by a server read.
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */

export interface MaybeUploadedPhoto {
  s3url?: string | null;
  uri?: string | null;
  [key: string]: unknown;
}

export type PhotoSections = Record<string, Array<MaybeUploadedPhoto | null | undefined>>;

/** A photo the server has never seen - it exists only as a local file on this device. */
export const isDeviceOnlyPhoto = (photo: MaybeUploadedPhoto | null | undefined): boolean =>
  !!photo && !photo.s3url;

/**
 * Drop every server-backed photo, keep every device-only one.
 *
 * ⚠️ Returns the SAME object when there is nothing to keep AND nothing to clear, so a caller's
 * `useMemo`/`useEffect` identity does not churn on every hydrate. An empty input is already
 * empty, and rebuilding it would re-render every grid for nothing.
 */
export const keepDeviceOnlyPhotos = <T extends MaybeUploadedPhoto>(
  sections: Record<string, Array<T | null | undefined>> | null | undefined
): Record<string, T[]> => {
  const input = sections || {};
  const kept: Record<string, T[]> = {};
  let keptAny = false;
  let hadAny = false;

  Object.entries(input).forEach(([category, photos]) => {
    const list = Array.isArray(photos) ? photos : [];
    if (list.length) hadAny = true;
    const local = list.filter((p): p is T => isDeviceOnlyPhoto(p));
    if (local.length) {
      kept[category] = local;
      keptAny = true;
    }
  });

  // Nothing local to protect: fall back to the old behaviour (clear), but keep the identity
  // when the input was already empty.
  if (!keptAny) return hadAny ? ({} as Record<string, T[]>) : (input as Record<string, T[]>);
  return kept;
};
