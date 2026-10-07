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
  type UploadedPhotoPatch,
} from '../utils/installer-upload';
import {
  logInstallerPhotoFailed,
  logInstallerPhotoReplaced,
  logInstallerPhotoUploaded,
  type InstallerPhotoLogMeta,
} from '../utils/activity-log/installer-log';
import type {
  CapturedPhoto,
  CocScanFields,
  InstallerImagePhase,
  InstallStepKey,
  PhotoPhase,
  PhotoSection,
  PhotoTag,
} from '../config/types/installer';

export interface InstallerUploadResult {
  patch: UploadedPhotoPatch;
  scan: CocScanFields | null;
}

interface PhotoDescriptorContext {
  step: InstallStepKey;
  category?: string;
  subcategory?: string;
  replacing?: boolean;
}

export function useInstallerPhotoUpload(
  jobId: string | undefined,
  patchPhoto: (photoId: string, patch: Partial<CapturedPhoto>) => void
) {
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;

  const inFlight = useRef<Map<string, Promise<void>>>(new Map());
  const [uploadingCount, setUploadingCount] = useState(0);

  const run = useCallback(
    (
      phase: InstallerImagePhase,
      photo: CapturedPhoto,
      buildDescriptor: Parameters<typeof uploadInstallerPhoto>[3],
      context: PhotoDescriptorContext,
      failureLabel: string
    ): Promise<InstallerUploadResult | null> => {
      if (!jobId) return Promise.resolve(null);

      patchPhoto(photo.id, { uploadStatus: 'uploading' });
      setUploadingCount((n) => n + 1);

      const task = uploadInstallerPhoto(jobId, phase, photo, buildDescriptor)
        .then(({ patch, size, coordinates, attempts, scan }) => {
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
              `Tried ${attempts} times. The photo is saved on this device — retake it once you have signal.`
            );
            return null;
          }

          if (context.replacing) logInstallerPhotoReplaced(userRef.current, meta);
          else logInstallerPhotoUploaded(userRef.current, meta);
          return { patch, scan };
        })
        .finally(() => {
          inFlight.current.delete(photo.id);
          setUploadingCount((n) => Math.max(0, n - 1));
        });

      inFlight.current.set(photo.id, task.then(() => undefined));
      return task;
    },
    [jobId, patchPhoto]
  );

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

  const uploadCocSignature = useCallback(
    (photo: CapturedPhoto, who: 'installer' | 'customer') =>
      run(
        'coc',
        photo,
        (coords) => cocDescriptor(photo, coords),
        {
          step: 'coc',
          category: 'Certificate of Completion',
          subcategory: who === 'installer' ? "Installer's Signature" : "Customer's Signature",
        },
        who === 'installer' ? "the installer's signature" : "the customer's signature"
      ),
    [run]
  );

  const uploadCoc = useCallback(
    (photo: CapturedPhoto, index: number) =>
      run(
        'cocPaperFallback',
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

  const waitForUploads = useCallback(async () => {
    while (inFlight.current.size > 0) {
      await Promise.all([...inFlight.current.values()]);
    }
  }, []);

  return useMemo(
    () => ({
      uploadMaterial,
      uploadPreExisting,
      uploadMatched,
      uploadCoc,
      uploadCocSignature,
      uploadExtra,
      uploadResult,
      waitForUploads,
      uploadingCount,
    }),
    [
      uploadMaterial,
      uploadPreExisting,
      uploadMatched,
      uploadCoc,
      uploadCocSignature,
      uploadExtra,
      uploadResult,
      waitForUploads,
      uploadingCount,
    ]
  );
}
