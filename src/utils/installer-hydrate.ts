import { PEC_AREAS } from '../constants/installer';
import type {
  CapturedPhoto,
  InstallProgress,
  CocSignOff,
  InstallerStoredImage,
  InstallerStoredRecords,
  PECEntry,
  ScopeStatus,
} from '../config/types/installer';

export type SecureUrlMap = Record<string, string>;

export const normalizeKey = (value?: string): string => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const storedPhotoAssets = (
  records: InstallerStoredRecords | undefined,
  fallbackBucket: string
): { bucketName: string; filePath: string }[] => {
  if (!records) return [];
  const all = [
    ...records.pickupPhotos,
    ...records.returnPhotos,
    ...records.cocPhotos,
    ...records.preInstallPhotos,
    ...records.postInstallPhotos,
    ...(records.preExistingConditions?.conditions ?? []).flatMap((c) => c.photos ?? []),
    ...[records.coc?.installerSignature, records.coc?.customerSignature].filter(
      Boolean
    ),
  ];

  const seen = new Set<string>();
  const assets: { bucketName: string; filePath: string }[] = [];
  all.forEach((photo: any) => {
    const filePath = photo?.s3url;
    if (!filePath || seen.has(filePath)) return;
    seen.add(filePath);
    assets.push({ bucketName: photo.bucketName || fallbackBucket, filePath });
  });
  return assets;
};

const toCapturedPhoto = (
  image: InstallerStoredImage,
  urls: SecureUrlMap
): CapturedPhoto | null => {
  const uri = urls[normalizeKey(image.s3url)];
  if (!uri) return null;

  return {
    id: image._id || image.s3url,
    uri,
    takenAt: image.timestampTaken || '',
    uploadStatus: 'uploaded',
    s3url: image.s3url,
    bucketName: image.bucketName,
    serverId: image._id,
    coordinates: image.coordinates ?? null,
  };
};

const missingFrom = (
  local: CapturedPhoto[],
  serverImages: InstallerStoredImage[],
  urls: SecureUrlMap
): CapturedPhoto[] => {
  const have = new Set(local.map((p) => p.s3url).filter(Boolean) as string[]);
  return serverImages
    .filter((image) => image.s3url && !have.has(image.s3url))
    .map((image) => toCapturedPhoto(image, urls))
    .filter((p): p is CapturedPhoto => !!p);
};

const withRefreshedUris = (photos: CapturedPhoto[], urls: SecureUrlMap): CapturedPhoto[] => {
  let changed = false;
  const next = photos.map((photo) => {
    if (!photo.s3url || photo.uri?.startsWith('file://')) return photo;
    const fresh = urls[normalizeKey(photo.s3url)];
    if (!fresh || fresh === photo.uri) return photo;
    changed = true;
    return { ...photo, uri: fresh };
  });
  return changed ? next : photos;
};

const byTakenAt = (a: CapturedPhoto, b: CapturedPhoto): number =>
  (a.takenAt || '').localeCompare(b.takenAt || '');

const areaIdForLabel = (label: string): string | undefined =>
  PEC_AREAS.find((area) => area.label.toLowerCase() === label.trim().toLowerCase())?.id;

const toScopeStatus = (item: any): ScopeStatus | null => {
  if (item?.status === 'CORRECT') return { state: 'confirmed' };
  if (item?.status === 'DISCREPANCY') {
    return {
      state: 'pending',
      issue: item.discrepancy?.category,
      note: item.discrepancy?.details,
    };
  }
  return null;
};

export interface HydrateOptions {
  tagIdBySalesPhotoId?: Map<string, string>;
  tagIdBySubcategory?: Map<string, string>;
}

export const subcategoryKey = (value?: string): string => (value ?? '').trim().toLowerCase();

export const cocSignatureUrls = (signOff?: CocSignOff): Set<string> =>
  new Set(
    [signOff?.installerSignature?.s3url, signOff?.customerSignature?.s3url].filter(
      Boolean
    ) as string[]
  );

export const isCocSignatureImage = (s3url?: string, signatureUrls?: Set<string>): boolean =>
  !!s3url && !!signatureUrls?.has(s3url);

export const mergeServerProgress = (
  previous: InstallProgress,
  records: InstallerStoredRecords | undefined,
  urls: SecureUrlMap,
  options: HydrateOptions = {}
): InstallProgress => {
  if (!records) return previous;

  let changed = false;
  const next: InstallProgress = { ...previous };

  (['pickup', 'return'] as const).forEach((mode) => {
    const serverImages = mode === 'pickup' ? records.pickupPhotos : records.returnPhotos;
    const refreshed = withRefreshedUris(previous[mode].photos, urls);
    const additions = missingFrom(refreshed, serverImages, urls);
    if (additions.length === 0 && refreshed === previous[mode].photos) return;
    changed = true;
    next[mode] = {
      ...previous[mode],
      photos: [...refreshed, ...additions].sort(byTakenAt),
    };
  });

  if (
    records.materialReturnNothingToReturn === true &&
    !previous.return.skipped &&
    next.return.photos.length === 0
  ) {
    changed = true;
    next.return = { ...next.return, skipped: true };
  }

  const storedCoc = records.coc;
  if (storedCoc) {
    const merged: CocSignOff = {
      ...storedCoc,
      ...(previous.cocSignOff ?? {}),
      installerSignature:
        storedCoc.installerSignature ?? previous.cocSignOff?.installerSignature,
      customerSignature:
        storedCoc.customerSignature ?? previous.cocSignOff?.customerSignature,
      installerSignatureUrl: urls[storedCoc.installerSignature?.s3url ?? ""],
      customerSignatureUrl: urls[storedCoc.customerSignature?.s3url ?? ""],
    };
    if (JSON.stringify(merged) !== JSON.stringify(previous.cocSignOff)) {
      changed = true;
      next.cocSignOff = merged;
    }
  }

  const knownSignatures = new Set(previous.cocSignatureS3Urls ?? []);
  cocSignatureUrls(next.cocSignOff ?? previous.cocSignOff).forEach((url) =>
    knownSignatures.add(url)
  );
  if (knownSignatures.size !== (previous.cocSignatureS3Urls ?? []).length) {
    changed = true;
    next.cocSignatureS3Urls = [...knownSignatures];
  }

  const keptCoc = knownSignatures.size
    ? previous.cocPages.filter((page) => !isCocSignatureImage(page.s3url, knownSignatures))
    : previous.cocPages;
  const cocServerPages = knownSignatures.size
    ? records.cocPhotos.filter((image) => !isCocSignatureImage(image.s3url, knownSignatures))
    : records.cocPhotos;

  const refreshedCoc = withRefreshedUris(keptCoc, urls);
  const cocAdditions = missingFrom(refreshedCoc, cocServerPages, urls);
  if (cocAdditions.length > 0 || refreshedCoc !== previous.cocPages) {
    changed = true;
    next.cocPages = [...refreshedCoc, ...cocAdditions].sort(byTakenAt);
  }

  const { tagIdBySalesPhotoId, tagIdBySubcategory } = options;
  if (tagIdBySalesPhotoId?.size || tagIdBySubcategory?.size) {
    (['pre', 'post'] as const).forEach((phase) => {
      const field = phase === 'pre' ? 'preMatched' : 'postMatched';
      const serverImages =
        phase === 'pre' ? records.preInstallPhotos : records.postInstallPhotos;

      let matchedChanged = false;
      const matched = { ...previous[field] };

      Object.entries(matched).forEach(([tagId, photo]) => {
        const [fresh] = withRefreshedUris([photo], urls);
        if (fresh !== photo) {
          matched[tagId] = fresh;
          matchedChanged = true;
        }
      });

      serverImages.forEach((image) => {
        const referenceId = image.salesPhotoId || image.preInstallPhotoId;
        const tagId =
          (referenceId ? tagIdBySalesPhotoId?.get(referenceId) : undefined) ??
          tagIdBySubcategory?.get(subcategoryKey(image.subcategory));
        if (!tagId || matched[tagId]) return;
        const photo = toCapturedPhoto(image, urls);
        if (!photo) return;
        matched[tagId] = { ...photo, tagId, phase };
        matchedChanged = true;
      });

      if (matchedChanged) {
        changed = true;
        next[field] = matched;
      }
    });
  }

  const conditions = records.preExistingConditions;
  if (previous.pecHasConditions === null && conditions && conditions.status !== 'NOT_CHECKED') {
    changed = true;
    next.pecHasConditions = conditions.status === 'CONDITIONS_PRESENT';

    if (next.pecHasConditions) {
      const entries: Record<string, PECEntry> = { ...previous.pecEntries };
      (conditions.conditions ?? []).forEach((condition) => {
        const areaId = areaIdForLabel(condition.label);
        if (!areaId || entries[areaId]) return;
        entries[areaId] = {
          areaId,
          note: condition.description ?? '',
          photos: (condition.photos ?? [])
            .map((p) => toCapturedPhoto(p as InstallerStoredImage, urls))
            .filter((p): p is CapturedPhoto => !!p),
        };
      });
      next.pecEntries = entries;
    }
  }

  const scopeItems = records.jobScopeVerification?.scopeItems ?? [];
  if (scopeItems.length > 0) {
    let scopeChanged = false;
    const scope: Record<string, ScopeStatus> = { ...previous.scope };
    scopeItems.forEach((item: any) => {
      if (!item?.productId || scope[item.productId]) return;
      const status = toScopeStatus(item);
      if (!status) return;
      scope[item.productId] = status;
      scopeChanged = true;
    });
    if (scopeChanged) {
      changed = true;
      next.scope = scope;
    }
  }

  return changed ? next : previous;
};
