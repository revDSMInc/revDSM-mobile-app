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

const readStored = (jobId: string): InstallProgress => {
  try {
    const raw = Storage.getItem(storageKey(jobId));
    if (!raw) return emptyProgress(jobId);
    return { ...emptyProgress(jobId), ...(JSON.parse(raw) as InstallProgress) };
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
   * A step-completion handler runs in the same tick as the mutation that satisfied
   * the step (skip the return, confirm the last product, …) and has to build its
   * server payload from the *post*-mutation state — which `progress` won't hold
   * until the next render. Every mutator goes through `commit` below, which updates
   * this ref as it produces the next state, so `progressRef.current` is correct
   * immediately. Assigning inside the updater is idempotent, so a StrictMode
   * double-invoke is harmless.
   */
  const progressRef = useRef(progress);

  const commit = useCallback(
    (updater: (previous: InstallProgress) => InstallProgress) => {
      setProgress((previous) => {
        const next = updater(previous);
        progressRef.current = next;
        return next;
      });
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
    try {
      Storage.setItem(storageKey(jobId), JSON.stringify(progress));
    } catch {
      // A serialization failure must not take the screen down.
    }
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      InstallerService.saveProgress(jobId, progress).catch(() => {});
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
          if (productIds.length === 0) return false;
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

  const completeStep = useCallback(
    (key: InstallStepKey) =>
      commit((p) => ({ ...p, completedSteps: { ...p.completedSteps, [key]: true } })),
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
    completeStep,
    patchPhoto,
    reset,
  };
}
