import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Storage } from '../utils/storage';
import { InstallerService } from '../services/api/installer';
import { INSTALL_STEPS, STEP_DEPENDENCIES, REQUIRED_PHOTO_TAGS } from '../constants/installer';
import type {
  InstallProgress,
  InstallStepKey,
  InstallStepStatus,
  CapturedPhoto,
  PhotoPhase,
  ScopeStatus,
  PECEntry,
} from '../config/types/installer';

const storageKey = (jobId: string) => `installer:progress:${jobId}`;

const emptyProgress = (jobId: string): InstallProgress => ({
  jobId,
  pickup: { photos: [], skipped: false },
  return: { photos: [], skipped: false },
  pecHasConditions: null,
  pecEntries: {},
  preMatched: {},
  postMatched: {},
  preExtras: {},
  postExtras: {},
  scope: {},
  cocPages: [],
  resultPhotos: [],
  completedSteps: {},
});

/**
 * Applies `patch` to whichever photo carries `photoId`, wherever it lives.
 *
 * Uploads resolve after the shot is already on screen, so the s3url has to find its
 * way back to a photo that may sit in any of eight collections. Walking them here
 * keeps every caller from having to remember where it put the capture. Collections
 * with no match are returned by reference, so unrelated state stays identity-stable.
 */
const applyPhotoPatch = (
  progress: InstallProgress,
  photoId: string,
  patch: Partial<CapturedPhoto>
): InstallProgress => {
  let hit = false;

  const one = (photo?: CapturedPhoto) => {
    if (!photo || photo.id !== photoId) return photo;
    hit = true;
    return { ...photo, ...patch };
  };

  const many = (photos: CapturedPhoto[]) =>
    photos.some((p) => p.id === photoId) ? photos.map((p) => one(p) as CapturedPhoto) : photos;

  const mapRecord = <T,>(
    record: Record<string, T>,
    fn: (value: T) => T
  ): Record<string, T> => {
    let changed = false;
    const next: Record<string, T> = {};
    Object.entries(record).forEach(([key, value]) => {
      const mapped = fn(value);
      if (mapped !== value) changed = true;
      next[key] = mapped;
    });
    return changed ? next : record;
  };

  const next: InstallProgress = {
    ...progress,
    pickup: { ...progress.pickup, photos: many(progress.pickup.photos) },
    return: { ...progress.return, photos: many(progress.return.photos) },
    cocPages: many(progress.cocPages),
    resultPhotos: many(progress.resultPhotos ?? []),
    pecEntries: mapRecord(progress.pecEntries, (entry) => {
      const photos = many(entry.photos);
      return photos === entry.photos ? entry : { ...entry, photos };
    }),
    preMatched: mapRecord(progress.preMatched, (p) => one(p) as CapturedPhoto),
    postMatched: mapRecord(progress.postMatched, (p) => one(p) as CapturedPhoto),
    preExtras: mapRecord(progress.preExtras, many),
    postExtras: mapRecord(progress.postExtras, many),
  };

  return hit ? next : progress;
};

/**
 * Result evidence is SESSION-ONLY — it is never written to the device and never read
 * back from it.
 *
 * The rest of `InstallProgress` is deliberately cached: an installer can lose signal on
 * a roof, and their step captures have to survive leaving a sub-screen or the app.
 * Result photos are the opposite case. They belong to ONE result attempt: they are
 * uploaded to S3 and then referenced by that result's `statusReason.images`, after
 * which the server copy is the record and the device copy is nothing but a stale
 * duplicate. Keeping them produced exactly the reported bug — shots taken for Can't Do
 * Work reappeared under Not Hit, because both results read the same cached array.
 *
 * Stripped at BOTH ends on purpose: not writing them means nothing lingers on the
 * device after the app closes, and not reading them means an entry written by an older
 * build still can't resurface.
 */
const withoutResultPhotos = (progress: InstallProgress): InstallProgress => ({
  ...progress,
  resultPhotos: [],
});

const readStored = (jobId: string): InstallProgress => {
  try {
    const raw = Storage.getItem(storageKey(jobId));
    if (!raw) return emptyProgress(jobId);
    return withoutResultPhotos({
      ...emptyProgress(jobId),
      ...(JSON.parse(raw) as InstallProgress),
    });
  } catch {
    return emptyProgress(jobId);
  }
};

/**
 * Owns install-timeline state for one job.
 *
 * Progress is written to MMKV so a rep can leave a sub-screen (or the app) without
 * losing captures, and mirrored through `InstallerService.saveProgress` — a no-op
 * against mocks today, a real PUT once the endpoint lands.
 */
const DEFAULT_REQUIRED_TAG_IDS = REQUIRED_PHOTO_TAGS.map((t) => t.id);

export function useInstallProgress(
  jobId: string,
  productIds: string[] = [],
  /** Tag ids the installer must match — from the job's real rep photos when available. */
  requiredPhotoTagIds: string[] = DEFAULT_REQUIRED_TAG_IDS
) {
  const [progress, setProgress] = useState<InstallProgress>(() => readStored(jobId));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Synchronous mirror of `progress`.
   *
   * A handler often runs in the same tick as the mutation it depends on — a step
   * completion right after the capture that satisfied it, or a step-data PATCH built
   * the instant an upload wrote its `s3url` back — and has to see the *post*-mutation
   * state, which `progress` won't hold until the next render.
   *
   * So `commit` derives the next state from the REF and assigns it before calling
   * `setProgress`, rather than assigning inside a `setProgress` updater. React runs
   * an updater during the render pass, i.e. a tick or more later: an upload that
   * resolved and immediately handed control back to `sendStepData` would have found
   * the ref still holding the pre-upload photo, with no `s3url` — so the step built
   * an empty body and no PATCH went out at all. Reading and writing the ref here
   * keeps it correct the moment the mutator returns.
   */
  const progressRef = useRef(progress);

  const commit = useCallback(
    (updater: (previous: InstallProgress) => InstallProgress) => {
      const next = updater(progressRef.current);
      progressRef.current = next;
      setProgress(next);
    },
    []
  );

  // Re-read when switching jobs.
  useEffect(() => {
    const stored = readStored(jobId);
    progressRef.current = stored;
    setProgress(stored);
  }, [jobId]);

  // Persist locally on every change; debounce the server mirror.
  useEffect(() => {
    // Result evidence is excluded from both — see `withoutResultPhotos`. It reaches the
    // server as `statusReason.images` on the result itself, not as install progress.
    const persisted = withoutResultPhotos(progress);
    try {
      Storage.setItem(storageKey(jobId), JSON.stringify(persisted));
    } catch {
      // A serialization failure must not take the screen down.
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      InstallerService.saveProgress(jobId, persisted).catch(() => {});
    }, 1500);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [progress, jobId]);

  const patch = useCallback(
    (next: Partial<InstallProgress>) => {
      commit((p) => ({ ...p, ...next, updatedAt: new Date().toISOString() }));
    },
    [commit]
  );

  // ── Step completion ───────────────────────────────────────────────────────
  // Material, PEC, photo, scope and CoC steps derive from their own data rather
  // than a flag, so a step can never read "done" while its evidence is missing.

  const isStepDone = useCallback(
    (key: InstallStepKey): boolean => {
      switch (key) {
        case 'pickup':
          return progress.pickup.photos.length > 0 || progress.pickup.skipped;
        case 'return':
          return progress.return.photos.length > 0 || progress.return.skipped;
        case 'coc':
          return progress.cocPages.length > 0;
        case 'pre':
          return (
            requiredPhotoTagIds.length > 0 &&
            requiredPhotoTagIds.every((id) => !!progress.preMatched[id])
          );
        case 'post':
          return (
            requiredPhotoTagIds.length > 0 &&
            requiredPhotoTagIds.every((id) => !!progress.postMatched[id])
          );
        case 'pec':
          if (progress.pecHasConditions === false) return true;
          if (progress.pecHasConditions !== true) return false;
          return !!progress.completedSteps.pec;
        case 'measure':
          // No sold products on the job — there is nothing to verify, so the step is
          // done once the installer has acknowledged that. It must NOT be a hard
          // `false`: `measure` gates Post-Install, CoC and Return, so a job whose
          // check-in carried no `productDetails` could never be completed at all.
          // Not auto-true either — the installer should see the step and confirm the
          // scope really is empty rather than have it silently tick itself off.
          if (productIds.length === 0) return !!progress.completedSteps.measure;
          // Every product must be settled — a pending discrepancy blocks the step.
          return productIds.every((id) => {
            const s = progress.scope[id];
            return s && s.state !== 'pending';
          });
        default:
          return !!progress.completedSteps[key];
      }
    },
    [progress, productIds, requiredPhotoTagIds]
  );

  const stepStatus = useMemo(() => {
    const map: Record<InstallStepKey, InstallStepStatus> = {} as any;
    for (const step of INSTALL_STEPS) {
      if (isStepDone(step.key)) map[step.key] = 'done';
      else {
        map[step.key] = STEP_DEPENDENCIES[step.key].every((dep) => isStepDone(dep))
          ? 'active'
          : 'locked';
      }
    }
    return map;
  }, [isStepDone]);

  const completedCount = useMemo(
    () => INSTALL_STEPS.filter((s) => stepStatus[s.key] === 'done').length,
    [stepStatus]
  );

  // ── Mutators ──────────────────────────────────────────────────────────────

  const addMaterialPhoto = useCallback(
    (mode: 'pickup' | 'return', photo: CapturedPhoto) =>
      commit((p) => ({
        ...p,
        [mode]: { ...p[mode], photos: [...p[mode].photos, photo] },
      })),
    [commit]
  );

  const removeMaterialPhoto = useCallback(
    (mode: 'pickup' | 'return', photoId: string) =>
      commit((p) => ({
        ...p,
        [mode]: { ...p[mode], photos: p[mode].photos.filter((x) => x.id !== photoId) },
      })),
    [commit]
  );

  const skipMaterial = useCallback(
    (mode: 'pickup' | 'return') =>
      commit((p) => ({ ...p, [mode]: { ...p[mode], skipped: true } })),
    [commit]
  );

  const setPecHasConditions = useCallback(
    (value: boolean | null) =>
      commit((p) => ({
        ...p,
        pecHasConditions: value,
        pecEntries: value === false ? {} : p.pecEntries,
        completedSteps: { ...p.completedSteps, pec: false },
      })),
    [commit]
  );

  const setPecEntry = useCallback(
    (areaId: string, entry: PECEntry | null) =>
      commit((p) => {
        const next = { ...p.pecEntries };
        if (entry) next[areaId] = entry;
        else delete next[areaId];
        return { ...p, pecEntries: next };
      }),
    [commit]
  );

  const matchPhoto = useCallback(
    (phase: PhotoPhase, tagId: string, photo: CapturedPhoto) =>
      commit((p) => {
        const field = phase === 'pre' ? 'preMatched' : 'postMatched';
        return { ...p, [field]: { ...p[field], [tagId]: photo } };
      }),
    [commit]
  );

  const addExtraPhoto = useCallback(
    (phase: PhotoPhase, sectionId: string, photo: CapturedPhoto) =>
      commit((p) => {
        const field = phase === 'pre' ? 'preExtras' : 'postExtras';
        return {
          ...p,
          [field]: { ...p[field], [sectionId]: [...(p[field][sectionId] ?? []), photo] },
        };
      }),
    [commit]
  );

  const setScopeStatus = useCallback(
    (productId: string, status: ScopeStatus | null) =>
      commit((p) => {
        const next = { ...p.scope };
        if (status) next[productId] = status;
        else delete next[productId];
        return { ...p, scope: next };
      }),
    [commit]
  );

  const addCocPage = useCallback(
    (page: CapturedPhoto) => commit((p) => ({ ...p, cocPages: [...p.cocPages, page] })),
    [commit]
  );

  const removeCocPage = useCallback(
    (pageId: string) =>
      commit((p) => ({ ...p, cocPages: p.cocPages.filter((x) => x.id !== pageId) })),
    [commit]
  );

  // ── Result evidence ───────────────────────────────────────────────────────
  // `?? []` throughout: progress persisted before this field existed rehydrates
  // without it, and MMKV keeps that shape until the job is next written.

  const addResultPhoto = useCallback(
    (photo: CapturedPhoto) =>
      commit((p) => ({ ...p, resultPhotos: [...(p.resultPhotos ?? []), photo] })),
    [commit]
  );

  const removeResultPhoto = useCallback(
    (photoId: string) =>
      commit((p) => ({
        ...p,
        resultPhotos: (p.resultPhotos ?? []).filter((x) => x.id !== photoId),
      })),
    [commit]
  );

  /**
   * Drops every result photo from local state.
   *
   * Called once a result has been accepted by the server — the s3urls are on the job
   * now, so the local copies are duplicates that would otherwise be offered as evidence
   * for the NEXT result — and when the installer switches to a different result type,
   * where they were never evidence in the first place.
   */
  const clearResultPhotos = useCallback(
    () => commit((p) => (p.resultPhotos?.length ? { ...p, resultPhotos: [] } : p)),
    [commit]
  );

  const completeStep = useCallback(
    (key: InstallStepKey) =>
      commit((p) => ({ ...p, completedSteps: { ...p.completedSteps, [key]: true } })),
    [commit]
  );

  /**
   * Folds server-held state into local progress (`installer-hydrate.ts`).
   *
   * Separate from `patch` because the merge has to read the current state to decide
   * what is missing, and separate from the mutators because it must be able to no-op:
   * returning the same object leaves React's state untouched and the persist effect
   * idle, so a hydrate that finds nothing new costs nothing.
   */
  const hydrate = useCallback(
    (merge: (previous: InstallProgress) => InstallProgress) => commit(merge),
    [commit]
  );

  /** Merges an upload result (s3url / bucket / server id) onto an existing capture. */
  const patchPhoto = useCallback(
    (photoId: string, photoPatch: Partial<CapturedPhoto>) =>
      commit((p) => applyPhotoPatch(p, photoId, photoPatch)),
    [commit]
  );

  /**
   * Wipes every capture, note and selection for this job.
   *
   * Goes through `commit` so `progressRef` is cleared in the same tick — a reset
   * handler that immediately builds a server payload must not read the old state.
   * The persist effect then overwrites the MMKV entry with the empty progress.
   */
  const reset = useCallback(
    () => commit(() => emptyProgress(jobId)),
    [commit, jobId]
  );

  return {
    progress,
    /** Synchronous mirror of `progress` — read this from step-completion handlers. */
    progressRef,
    patch,
    stepStatus,
    isStepDone,
    completedCount,
    totalSteps: INSTALL_STEPS.length,
    addMaterialPhoto,
    removeMaterialPhoto,
    skipMaterial,
    setPecHasConditions,
    setPecEntry,
    matchPhoto,
    addExtraPhoto,
    setScopeStatus,
    addCocPage,
    removeCocPage,
    addResultPhoto,
    removeResultPhoto,
    clearResultPhotos,
    completeStep,
    patchPhoto,
    hydrate,
    reset,
  };
}
