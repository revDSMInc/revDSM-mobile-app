import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Storage } from '../utils/storage';
import { InstallerService } from '../services/api/installer';
import { INSTALL_STEPS, STEP_DEPENDENCIES, REQUIRED_PHOTO_TAGS } from '../constants/installer';
import type {
  InstallProgress,
  InstallStepKey,
  InstallStepStatus,
  CapturedPhoto,
  CocSignOff,
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

const DEFAULT_REQUIRED_TAG_IDS = REQUIRED_PHOTO_TAGS.map((t) => t.id);

export function useInstallProgress(
  jobId: string,
  productIds: string[] = [],
  requiredPhotoTagIds: string[] = DEFAULT_REQUIRED_TAG_IDS
) {
  const [progress, setProgress] = useState<InstallProgress>(() => readStored(jobId));
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const progressRef = useRef(progress);

  const commit = useCallback(
    (updater: (previous: InstallProgress) => InstallProgress) => {
      const next = updater(progressRef.current);
      progressRef.current = next;
      setProgress(next);
    },
    []
  );

  useEffect(() => {
    const stored = readStored(jobId);
    progressRef.current = stored;
    setProgress(stored);
  }, [jobId]);

  useEffect(() => {
    const persisted = withoutResultPhotos(progress);
    try {
      Storage.setItem(storageKey(jobId), JSON.stringify(persisted));
    } catch {
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

  const photoPhaseDone = useCallback(
    (
      requiredIds: string[],
      matchedMap: Record<string, CapturedPhoto>,
      extrasMap: Record<string, CapturedPhoto[]>
    ): boolean =>
      requiredIds.length > 0
        ? requiredIds.every((id) => !!matchedMap[id])
        : Object.keys(matchedMap).length > 0 ||
          Object.values(extrasMap).some((list) => (list?.length ?? 0) > 0),
    []
  );

  const isStepDone = useCallback(
    (key: InstallStepKey): boolean => {
      switch (key) {
        case 'pickup':
          return progress.pickup.photos.length > 0 || progress.pickup.skipped;
        case 'return':
          return progress.return.photos.length > 0 || progress.return.skipped;
        case 'coc':
          return progress.cocPages.length > 0 || !!progress.cocSignOff;
        case 'pre':
          return photoPhaseDone(
            requiredPhotoTagIds,
            progress.preMatched,
            progress.preExtras
          );
        case 'post':
          return photoPhaseDone(
            Object.keys(progress.preMatched),
            progress.postMatched,
            progress.postExtras
          );
        case 'pec':
          if (progress.pecHasConditions === false) return true;
          if (progress.pecHasConditions !== true) return false;
          return !!progress.completedSteps.pec;
        case 'measure':
          if (productIds.length === 0) return !!progress.completedSteps.measure;
          return productIds.every((id) => {
            const s = progress.scope[id];
            return s && s.state !== 'pending';
          });
        default:
          return !!progress.completedSteps[key];
      }
    },
    [progress, productIds, requiredPhotoTagIds, photoPhaseDone]
  );

  const hasStepWork = useCallback(
    (key: InstallStepKey): boolean => {
      const anyExtras = (map: Record<string, CapturedPhoto[]>) =>
        Object.values(map).some((list) => (list?.length ?? 0) > 0);

      switch (key) {
        case 'pickup':
          return progress.pickup.photos.length > 0;
        case 'return':
          return progress.return.photos.length > 0;
        case 'pec':
          return (
            progress.pecHasConditions !== null ||
            Object.keys(progress.pecEntries).length > 0
          );
        case 'pre':
          return Object.keys(progress.preMatched).length > 0 || anyExtras(progress.preExtras);
        case 'post':
          return Object.keys(progress.postMatched).length > 0 || anyExtras(progress.postExtras);
        case 'measure':
          return Object.keys(progress.scope).length > 0;
        case 'coc':
          return progress.cocPages.length > 0 || !!progress.cocSignOff;
        default:
          return false;
      }
    },
    [progress]
  );

  const stepHasWork = useMemo(() => {
    const map: Partial<Record<InstallStepKey, boolean>> = {};
    for (const step of INSTALL_STEPS) {
      map[step.key] = !isStepDone(step.key) && hasStepWork(step.key);
    }
    return map;
  }, [isStepDone, hasStepWork]);

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

  const rememberCocSignature = useCallback(
    (s3url: string) =>
      commit((p) =>
        !s3url || (p.cocSignatureS3Urls ?? []).includes(s3url)
          ? p
          : {
              ...p,
              cocSignatureS3Urls: [...(p.cocSignatureS3Urls ?? []), s3url],
              cocPages: p.cocPages.filter((page) => page.s3url !== s3url),
            }
      ),
    [commit]
  );

  const setCocSignOff = useCallback(
    (signOff: CocSignOff | null) =>
      commit((p) => ({ ...p, cocSignOff: signOff ?? undefined })),
    [commit]
  );

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

  const clearResultPhotos = useCallback(
    () => commit((p) => (p.resultPhotos?.length ? { ...p, resultPhotos: [] } : p)),
    [commit]
  );

  const completeStep = useCallback(
    (key: InstallStepKey) =>
      commit((p) => ({ ...p, completedSteps: { ...p.completedSteps, [key]: true } })),
    [commit]
  );

  const hydrate = useCallback(
    (merge: (previous: InstallProgress) => InstallProgress) => commit(merge),
    [commit]
  );

  const patchPhoto = useCallback(
    (photoId: string, photoPatch: Partial<CapturedPhoto>) =>
      commit((p) => applyPhotoPatch(p, photoId, photoPatch)),
    [commit]
  );

  const reset = useCallback(
    () => commit(() => emptyProgress(jobId)),
    [commit, jobId]
  );

  return {
    progress,
    progressRef,
    patch,
    stepStatus,
    stepHasWork,
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
    rememberCocSignature,
    setCocSignOff,
    addResultPhoto,
    removeResultPhoto,
    clearResultPhotos,
    completeStep,
    patchPhoto,
    hydrate,
    reset,
  };
}
