import { useCallback, useMemo, useRef, useState } from 'react';
import { FlashMessage } from '../config/message';
import { useAuth } from './useAuth';
import {
  cocDescriptor,
  extraPhotoDescriptor,
  imagePhaseOf,
  materialDescriptor,
  matchedPhotoDescriptor,
  preExistingDescriptor,
  resultDescriptor,
  uploadInstallerPhoto,
} from '../utils/installer-upload';
import {
  logInstallerPhotoFailed,
  logInstallerPhotoReplaced,
  logInstallerPhotoUploaded,
  type InstallerPhotoLogMeta,
} from '../utils/activity-log/installer-log';
import type {
  CapturedPhoto,
  InstallerImagePhase,
  InstallStepKey,
  PhotoPhase,
  PhotoSection,
  PhotoTag,
} from '../config/types/installer';

/** What each caller knows about the shot, before the upload fills in the rest. */
interface PhotoDescriptorContext {
  step: InstallStepKey;
  category?: string;
  subcategory?: string;
  /** True when this shot replaces one already recorded — logs `update`, not `add`. */
  replacing?: boolean;
}

/**
 * Sends install captures to `installer/v1/{jobId}/images`, writes the result back
 * onto the local photo, and logs the upload.
 *
 * Uploads are fire-and-forget from the screen's point of view — the capture is
 * already in `InstallProgress` when this is called, so the rep keeps shooting while
 * the previous shot is in flight. The upload then merges `{ s3url, bucketName,
 * serverId }` onto that same photo, which is what makes the shot referenceable in
 * the step-data PATCH. The sends themselves are SERIALIZED one job-wide
 * (`installer-upload.ts`), so a burst of captures queues rather than racing.
 *
 * A send that exhausts its retries is not the end of the photo: the arguments are kept
 * so `retryFailed()` can send the very same capture again, which the job screen does
 * every time it comes back into focus.
 *
 * Photo activity logs are emitted from HERE rather than from the capture handlers,
 * because the portal's payload needs `s3url`, `bucketName` and the byte size — none
 * of which exist until the upload comes back.
 *
 * `waitForUploads()` lets a step-completion handler drain what is still in flight,
 * so a PATCH never goes out referencing a photo whose s3url hasn't arrived.
 */
export function useInstallerPhotoUpload(
  jobId: string | undefined,
  patchPhoto: (photoId: string, patch: Partial<CapturedPhoto>) => void
) {
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;

  // Keyed by photo id so a retake doesn't leave an orphan entry behind.
  const inFlight = useRef<Map<string, Promise<void>>>(new Map());
  const [uploadingCount, setUploadingCount] = useState(0);

  /**
   * Everything needed to send a photo AGAIN, kept from the moment it is first queued
   * and dropped only once it lands.
   *
   * A failed upload used to be the end of the road: the installer was told to retake a
   * shot whose bytes were sitting on the device the whole time, which on a job site
   * means climbing back up a ladder for a photo that would upload fine thirty seconds
   * later. Holding the arguments means the same capture can simply be re-sent — by
   * `retryFailed()`, which the job screen calls whenever it comes back into focus.
   */
  const retryable = useRef<Map<string, () => void>>(new Map());
  const [failedCount, setFailedCount] = useState(0);

  /**
   * Re-counts the photos that are waiting on a retry — held in `retryable` and not
   * currently in the air.
   *
   * Derived rather than incremented, because `retryable` is written from three places
   * (queue, success, retry) and a drifting counter would offer the installer a Retry
   * chip for photos that are already on the server. Always called AFTER the `inFlight`
   * entry is dropped, or the photo that just failed would still look in-flight and be
   * counted as fine.
   */
  const syncFailedCount = useCallback(() => {
    setFailedCount(
      [...retryable.current.keys()].filter((id) => !inFlight.current.has(id)).length
    );
  }, []);

  const run = useCallback(
    (
      phase: InstallerImagePhase,
      photo: CapturedPhoto,
      buildDescriptor: Parameters<typeof uploadInstallerPhoto>[3],
      context: PhotoDescriptorContext,
      failureLabel: string,
      /** Set when this is `retryFailed()` re-sending, not a fresh capture. */
      isRetry = false
    ) => {
      if (!jobId) return;
      // Already queued or in the air — a second send would put two copies in S3.
      if (inFlight.current.has(photo.id)) return;

      patchPhoto(photo.id, { uploadStatus: 'uploading' });
      setUploadingCount((n) => n + 1);
      retryable.current.set(photo.id, () =>
        run(phase, photo, buildDescriptor, context, failureLabel, true)
      );

      const task = uploadInstallerPhoto(jobId, phase, photo, buildDescriptor)
        .then(({ patch, size, coordinates, attempts }) => {
          patchPhoto(photo.id, patch);

          const meta: InstallerPhotoLogMeta = {
            step: context.step,
            category: context.category,
            subcategory: context.subcategory,
            timestamp: photo.takenAt,
            coordinates,
            size,
            s3url: patch.s3url,
            bucketName: patch.bucketName,
          };

          if (patch.uploadStatus === 'failed') {
            logInstallerPhotoFailed(userRef.current, meta);
            // Only reached once the retries in `uploadInstallerPhoto` are exhausted, so
            // this is now a real failure rather than one bad moment on a job-site cell.
            // The count is said out loud because it is the difference between "wait a
            // second" and "this is not going to fix itself".
            //
            // A RETRY that fails again is deliberately silent: the installer was already
            // told about this photo once, and repeating it every time they walk back
            // onto the job screen turns a standing problem into a stream of alarms.
            if (!isRetry) {
              FlashMessage.error(
                `Couldn't upload ${failureLabel}`,
                `Tried ${attempts} times. The photo is saved on this device and will be ` +
                  'sent again automatically — or tap Retry at the top of the job.'
              );
            }
            return;
          }

          // It landed, so there is nothing left to re-send.
          retryable.current.delete(photo.id);

          if (context.replacing) logInstallerPhotoReplaced(userRef.current, meta);
          else logInstallerPhotoUploaded(userRef.current, meta);
        })
        .finally(() => {
          inFlight.current.delete(photo.id);
          setUploadingCount((n) => Math.max(0, n - 1));
          // After the `inFlight` delete, never before — see `syncFailedCount`.
          syncFailedCount();
        });

      inFlight.current.set(photo.id, task);
    },
    [jobId, patchPhoto, syncFailedCount]
  );

  /**
   * Re-sends every photo whose upload gave up.
   *
   * Called when the job screen regains focus — leaving a step and coming back is the
   * natural "try that again" gesture, and by then the crew has usually moved or the
   * cell has recovered — and from the Retry chip in the header. Safe to call at any
   * time: `run` refuses a photo that is already queued, and anything that has landed is
   * no longer in the map.
   *
   * `stillWanted` is how a photo the installer DELETED gets forgotten. Removing a
   * capture drops it from progress but says nothing to this map, so without the check a
   * retry would put a deleted shot back in S3 — and the step-data PATCH, which restates
   * only what is left, would never reference it again. One predicate from the screen
   * that owns the state beats a `forget()` call in each of the six removal paths, where
   * the one that got missed would be the bug.
   */
  const retryFailed = useCallback(
    (stillWanted?: (photoId: string) => boolean) => {
      const pending = [...retryable.current.entries()].filter(
        ([id]) => !inFlight.current.has(id)
      );
      if (pending.length === 0) return;

      const [live, gone] = [
        pending.filter(([id]) => !stillWanted || stillWanted(id)),
        pending.filter(([id]) => stillWanted && !stillWanted(id)),
      ];
      gone.forEach(([id]) => retryable.current.delete(id));
      if (gone.length) syncFailedCount();

      if (live.length === 0) return;
      console.log(`[InstallerUpload] Retrying ${live.length} failed photo(s).`);
      live.forEach(([, resend]) => resend());
    },
    [syncFailedCount]
  );

  /** Material pickup / return. */
  const uploadMaterial = useCallback(
    (mode: 'pickup' | 'return', photo: CapturedPhoto, index: number) =>
      run(
        mode,
        photo,
        (coords) => materialDescriptor(mode, photo, coords),
        {
          step: mode,
          category: mode === 'pickup' ? 'Material Pickup' : 'Material Return',
          subcategory: `${mode} #${index}`,
        },
        mode === 'pickup' ? 'the pickup photo' : 'the return photo'
      ),
    [run]
  );

  /** A pre-existing condition shot, tagged with the area it documents. */
  const uploadPreExisting = useCallback(
    (areaLabel: string, photo: CapturedPhoto) =>
      run(
        'preExisting',
        photo,
        (coords) => preExistingDescriptor(areaLabel, photo, coords),
        { step: 'pec', category: 'Pre-Existing Conditions', subcategory: areaLabel },
        `the ${areaLabel} condition photo`
      ),
    [run]
  );

  /** A ghost-matched pre/post shot, linked to the rep photo it pairs with. */
  const uploadMatched = useCallback(
    (phase: PhotoPhase, tag: PhotoTag, photo: CapturedPhoto, replacing: boolean) =>
      run(
        imagePhaseOf(phase),
        photo,
        (coords) => matchedPhotoDescriptor(tag, photo, coords),
        {
          step: phase,
          category: tag.categoryLabel,
          subcategory: tag.label,
          replacing,
        },
        `the ${tag.label} photo`
      ),
    [run]
  );

  /** A scanned CoC page. */
  const uploadCoc = useCallback(
    (photo: CapturedPhoto, index: number) =>
      run(
        'coc',
        photo,
        (coords) => cocDescriptor(photo, coords),
        {
          step: 'coc',
          category: 'Certificate of Completion',
          subcategory: `Page ${index}`,
        },
        `page ${index} of the CoC`
      ),
    [run]
  );

  /** A result-evidence shot (Can't Do Work / Reset / Not Hit). */
  const uploadResult = useCallback(
    (reasonLabel: string, photo: CapturedPhoto) =>
      run(
        'result',
        photo,
        (coords) => resultDescriptor(reasonLabel, photo, coords),
        { step: 'coc', category: 'Result', subcategory: reasonLabel },
        'the result photo'
      ),
    [run]
  );

  /** A free shot with no rep counterpart. */
  const uploadExtra = useCallback(
    (phase: PhotoPhase, section: PhotoSection, photo: CapturedPhoto) =>
      run(
        imagePhaseOf(phase),
        photo,
        (coords) => extraPhotoDescriptor(section, photo, coords),
        {
          step: phase,
          category: section.categoryLabel ?? section.name,
          subcategory: 'Extras',
        },
        'the extra photo'
      ),
    [run]
  );

  /**
   * Resolves once nothing is in flight. Individual uploads never reject, so this
   * settles even when a photo failed — the caller checks `s3url`, not this promise.
   */
  const waitForUploads = useCallback(async () => {
    while (inFlight.current.size > 0) {
      await Promise.all([...inFlight.current.values()]);
    }
  }, []);

  // Memoized so the screen's capture/step handlers keep stable identities between
  // renders — otherwise every re-render would rebuild all of them.
  return useMemo(
    () => ({
      uploadMaterial,
      uploadPreExisting,
      uploadMatched,
      uploadCoc,
      uploadExtra,
      uploadResult,
      waitForUploads,
      retryFailed,
      /** > 0 while any capture is queued or in the air. */
      uploadingCount,
      /** Captures that gave up and are waiting to be re-sent. */
      failedCount,
    }),
    [
      uploadMaterial,
      uploadPreExisting,
      uploadMatched,
      uploadCoc,
      uploadExtra,
      uploadResult,
      waitForUploads,
      retryFailed,
      uploadingCount,
      failedCount,
    ]
  );
}
