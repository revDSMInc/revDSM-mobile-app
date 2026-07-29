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
 * the step-data PATCH.
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

  const run = useCallback(
    (
      phase: InstallerImagePhase,
      photo: CapturedPhoto,
      buildDescriptor: Parameters<typeof uploadInstallerPhoto>[3],
      context: PhotoDescriptorContext,
      failureLabel: string
    ) => {
      if (!jobId) return;

      patchPhoto(photo.id, { uploadStatus: 'uploading' });
      setUploadingCount((n) => n + 1);

      const task = uploadInstallerPhoto(jobId, phase, photo, buildDescriptor)
        .then(({ patch, size, coordinates }) => {
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
            FlashMessage.error(
              `Couldn't upload ${failureLabel}`,
              'The photo is saved on this device — retake it once you have signal.'
            );
            return;
          }

          if (context.replacing) logInstallerPhotoReplaced(userRef.current, meta);
          else logInstallerPhotoUploaded(userRef.current, meta);
        })
        .finally(() => {
          inFlight.current.delete(photo.id);
          setUploadingCount((n) => Math.max(0, n - 1));
        });

      inFlight.current.set(photo.id, task);
    },
    [jobId, patchPhoto]
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
      waitForUploads,
      /** > 0 while any capture is still being sent. */
      uploadingCount,
    }),
    [
      uploadMaterial,
      uploadPreExisting,
      uploadMatched,
      uploadCoc,
      uploadExtra,
      waitForUploads,
      uploadingCount,
    ]
  );
}
