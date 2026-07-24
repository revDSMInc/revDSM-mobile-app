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

  // Re-read when switching jobs.
  useEffect(() => {
    setProgress(readStored(jobId));
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

  const patch = useCallback((next: Partial<InstallProgress>) => {
    setProgress((p) => ({ ...p, ...next, updatedAt: new Date().toISOString() }));
  }, []);

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
      setProgress((p) => ({
        ...p,
        [mode]: { ...p[mode], photos: [...p[mode].photos, photo] },
      })),
    []
  );

  const removeMaterialPhoto = useCallback(
    (mode: 'pickup' | 'return', photoId: string) =>
      setProgress((p) => ({
        ...p,
        [mode]: { ...p[mode], photos: p[mode].photos.filter((x) => x.id !== photoId) },
      })),
    []
  );

  const skipMaterial = useCallback(
    (mode: 'pickup' | 'return') =>
      setProgress((p) => ({ ...p, [mode]: { ...p[mode], skipped: true } })),
    []
  );

  const setPecHasConditions = useCallback(
    (value: boolean | null) =>
      setProgress((p) => ({
        ...p,
        pecHasConditions: value,
        pecEntries: value === false ? {} : p.pecEntries,
        completedSteps: { ...p.completedSteps, pec: false },
      })),
    []
  );

  const setPecEntry = useCallback(
    (areaId: string, entry: PECEntry | null) =>
      setProgress((p) => {
        const next = { ...p.pecEntries };
        if (entry) next[areaId] = entry;
        else delete next[areaId];
        return { ...p, pecEntries: next };
      }),
    []
  );

  const matchPhoto = useCallback(
    (phase: PhotoPhase, tagId: string, photo: CapturedPhoto) =>
      setProgress((p) => {
        const field = phase === 'pre' ? 'preMatched' : 'postMatched';
        return { ...p, [field]: { ...p[field], [tagId]: photo } };
      }),
    []
  );

  const addExtraPhoto = useCallback(
    (phase: PhotoPhase, sectionId: string, photo: CapturedPhoto) =>
      setProgress((p) => {
        const field = phase === 'pre' ? 'preExtras' : 'postExtras';
        return {
          ...p,
          [field]: { ...p[field], [sectionId]: [...(p[field][sectionId] ?? []), photo] },
        };
      }),
    []
  );

  const setScopeStatus = useCallback(
    (productId: string, status: ScopeStatus | null) =>
      setProgress((p) => {
        const next = { ...p.scope };
        if (status) next[productId] = status;
        else delete next[productId];
        return { ...p, scope: next };
      }),
    []
  );

  const addCocPage = useCallback(
    (page: CapturedPhoto) => setProgress((p) => ({ ...p, cocPages: [...p.cocPages, page] })),
    []
  );

  const removeCocPage = useCallback(
    (pageId: string) =>
      setProgress((p) => ({ ...p, cocPages: p.cocPages.filter((x) => x.id !== pageId) })),
    []
  );

  const completeStep = useCallback(
    (key: InstallStepKey) =>
      setProgress((p) => ({ ...p, completedSteps: { ...p.completedSteps, [key]: true } })),
    []
  );

  const reset = useCallback(() => setProgress(emptyProgress(jobId)), [jobId]);

  return {
    progress,
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
    reset,
  };
}
