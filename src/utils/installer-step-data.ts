import {
  DISCREPANCY_ISSUE_TYPES,
  PEC_AREAS,
} from '../constants/installer';
import {
  INSTALLER_PATCH_FIELDS,
  type CapturedPhoto,
  type DiscrepancyCategory,
  type CocRelationshipType,
  type CocSignOff,
  type CocStepPayload,
  type InstallProgress,
  type InstallerJobPatch,
  type JobScopeVerificationPayload,
  type PECEntry,
  type PreExistingConditionPayload,
  type PreExistingConditionsPayload,
  type ScopeItemPayload,
  type ScopeItemPayloadStatus,
  type ScopeStatus,
  type SoldProduct,
  type StepPhotoRef,
} from '../config/types/installer';

export const stripUnsupportedFields = (patch: InstallerJobPatch): InstallerJobPatch => {
  const clean: InstallerJobPatch = {};
  INSTALLER_PATCH_FIELDS.forEach((key) => {
    const value = patch[key];
    if (value !== undefined) (clean as any)[key] = value;
  });
  return clean;
};

export const isEmptyPatch = (patch: InstallerJobPatch | null): boolean =>
  !patch || Object.keys(patch).length === 0;

export const isUploaded = (photo?: CapturedPhoto | null): boolean => !!photo?.s3url;

export const toPhotoRef = (
  photo: CapturedPhoto,
  extra: Partial<StepPhotoRef> = {}
): StepPhotoRef => ({
  s3url: photo.s3url!,
  bucketName: photo.bucketName,
  timestampTaken: photo.takenAt,
  coordinates: photo.coordinates ?? null,
  ...extra,
});

export const toPhotoRefs = (photos: CapturedPhoto[]): StepPhotoRef[] =>
  photos.filter(isUploaded).map((p) => toPhotoRef(p));

export interface StepDataOptions {
  includeEmptyPhotos?: boolean;
}

export const buildPickupStepData = (
  progress: InstallProgress,
  options: StepDataOptions = {}
): InstallerJobPatch | null => {
  const photos = toPhotoRefs(progress.pickup.photos).map((ref) => ({
    ...ref,
    subcategory: 'pickup',
  }));
  return photos.length || options.includeEmptyPhotos
    ? { installerPickupPhotos: photos }
    : null;
};

export const buildReturnStepData = (
  progress: InstallProgress,
  options: StepDataOptions = {}
): InstallerJobPatch | null => {
  const photos = toPhotoRefs(progress.return.photos).map((ref) => ({
    ...ref,
    subcategory: 'return',
  }));
  return {
    materialReturnNothingToReturn: progress.return.skipped,
    ...(photos.length || options.includeEmptyPhotos
      ? { installerReturnPhotos: photos }
      : {}),
  };
};

const areaLabel = (areaId: string): string =>
  PEC_AREAS.find((a) => a.id === areaId)?.label ?? areaId;

const toCondition = (areaId: string, entry: PECEntry): PreExistingConditionPayload => ({
  label: areaLabel(areaId),
  isSelected: true,
  description: entry.note?.trim() ?? '',
  photos: toPhotoRefs(entry.photos ?? []).map((ref) => ({
    ...ref,
    subcategory: areaLabel(areaId),
  })),
});

export const buildPecStepData = (
  progress: InstallProgress,
  userId?: string
): InstallerJobPatch | null => {
  if (progress.pecHasConditions === null) return null;

  const conditions =
    progress.pecHasConditions === true
      ? Object.entries(progress.pecEntries).map(([areaId, entry]) =>
          toCondition(areaId, entry)
        )
      : [];

  const preExistingConditions: PreExistingConditionsPayload = {
    status: progress.pecHasConditions ? 'CONDITIONS_PRESENT' : 'NO_CONDITIONS_FOUND',
    checkedAt: new Date().toISOString(),
    conditions,
  };
  if (userId) preExistingConditions.checkedBy = userId;

  return { preExistingConditions };
};

const buildMatchedRefs = (
  matched: Record<string, CapturedPhoto>,
  repPhotoIdByTag: Map<string, string> = new Map()
): StepPhotoRef[] =>
  Object.entries(matched)
    .filter(([, photo]) => isUploaded(photo))
    .map(([tagId, photo]) =>
      toPhotoRef(photo, {
        subcategory: tagId,
        salesPhotoId: repPhotoIdByTag.get(tagId),
      })
    );

export const buildPreInstallStepData = (
  progress: InstallProgress,
  repPhotoIdByTag?: Map<string, string>,
  options: StepDataOptions = {}
): InstallerJobPatch | null => {
  const photos = buildMatchedRefs(progress.preMatched, repPhotoIdByTag);
  return photos.length || options.includeEmptyPhotos
    ? { installerPreInstallPhotos: photos }
    : null;
};

export const buildPostInstallStepData = (
  progress: InstallProgress,
  repPhotoIdByTag?: Map<string, string>,
  options: StepDataOptions = {}
): InstallerJobPatch | null => {
  const photos = buildMatchedRefs(progress.postMatched, repPhotoIdByTag);
  return photos.length || options.includeEmptyPhotos
    ? { installerPostInstallPhotos: photos }
    : null;
};

export const toDiscrepancyCategory = (issue?: string): DiscrepancyCategory => {
  const match = DISCREPANCY_ISSUE_TYPES.find(
    (t) => t.toLowerCase() === (issue ?? '').trim().toLowerCase()
  );
  if (!match) return 'OTHER';
  return match.toUpperCase().replace(/\s+/g, '_') as DiscrepancyCategory;
};

const toScopeStatus = (status?: ScopeStatus): ScopeItemPayloadStatus => {
  if (!status) return 'PENDING';
  if (status.state === 'pending') return 'DISCREPANCY';
  return 'CORRECT';
};

const toScopeItem = (
  product: SoldProduct,
  status: ScopeStatus | undefined,
  photosById: Map<string, CapturedPhoto>,
  userId?: string
): ScopeItemPayload => {
  const payloadStatus = toScopeStatus(status);

  const referenceImages = (status?.attachments ?? [])
    .map((id) => photosById.get(id))
    .filter((p): p is CapturedPhoto => isUploaded(p))
    .map((p) => ({ id: p.serverId ?? p.id, s3url: p.s3url!, bucketName: p.bucketName }));

  return {
    scopeId: `scope_${product.id}`,
    productId: product.id,
    productName: product.name,
    status: payloadStatus,
    discrepancy:
      payloadStatus === 'DISCREPANCY'
        ? {
            category: toDiscrepancyCategory(status?.issue),
            details: status?.note?.trim() || status?.issue || '',
            referenceImages,
            reportedAt: new Date().toISOString(),
            ...(userId ? { reportedBy: userId } : {}),
          }
        : null,
  };
};

export const buildScopeStepData = (
  products: SoldProduct[],
  progress: InstallProgress,
  photosById: Map<string, CapturedPhoto>,
  userId?: string
): InstallerJobPatch | null => {
  if (products.length === 0) return null;

  const scopeItems = products.map((product) =>
    toScopeItem(product, progress.scope[product.id], photosById, userId)
  );

  const hasOpenDiscrepancy = scopeItems.some((i) => i.status === 'DISCREPANCY');
  const allSettled = scopeItems.every((i) => i.status !== 'PENDING');

  const jobScopeVerification: JobScopeVerificationPayload = {
    verificationStatus: hasOpenDiscrepancy
      ? 'DISCREPANCY_FOUND'
      : allSettled
      ? 'COMPLETED'
      : 'IN_PROGRESS',
    scopeItems,
  };

  return { jobScopeVerification };
};

export const buildCocSignOffPayload = (
  signOff?: CocSignOff | null
): CocStepPayload | null => {
  if (!signOff) return null;

  const relationshipType: CocRelationshipType =
    signOff.customer?.relationshipType === 'other'
      ? 'other'
      : signOff.customer?.relationshipType === 'spouse'
      ? 'spouse'
      : 'homeowner';
  const isOther = relationshipType === 'other';
  const other = (signOff.customer?.otherRelationship ?? '').trim();

  const payload: CocStepPayload = {
    confirmations: {
      is18OrOlder: !!signOff.confirmations?.is18OrOlder,
      isHomeownerOrAuthorized: !!signOff.confirmations?.isHomeownerOrAuthorized,
      installationCompletedAsPerContract:
        !!signOff.confirmations?.installationCompletedAsPerContract,
    },
    customer: {
      relationshipType,
      otherRelationship: isOther && other ? other : null,
    },
  };

  if (signOff.installerSignature?.s3url) payload.installerSignature = signOff.installerSignature;
  if (signOff.customerSignature?.s3url) payload.customerSignature = signOff.customerSignature;

  return payload;
};

export const buildCocStepData = (
  progress: InstallProgress,
  options: StepDataOptions = {}
): InstallerJobPatch | null => {
  const photos = toPhotoRefs(progress.cocPages).map((ref) => ({
    ...ref,
    subcategory: 'coc',
  }));

  const patch: InstallerJobPatch = {};
  if (photos.length || options.includeEmptyPhotos) patch.installerCocPhotos = photos;

  const coc = buildCocSignOffPayload(progress.cocSignOff);
  if (coc) patch.coc = coc;

  return Object.keys(patch).length ? patch : null;
};

export const buildResetPatch = (
  products: SoldProduct[],
  userId?: string
): InstallerJobPatch => {
  const preExistingConditions: PreExistingConditionsPayload = {
    status: 'NOT_CHECKED',
    checkedAt: new Date().toISOString(),
    conditions: [],
  };
  if (userId) preExistingConditions.checkedBy = userId;

  return {
    preExistingConditions,
    installerPickupPhotos: [],
    installerPreInstallPhotos: [],
    installerPostInstallPhotos: [],
    installerCocPhotos: [],
    installerReturnPhotos: [],
    jobScopeVerification: {
      verificationStatus: 'IN_PROGRESS',
      scopeItems: products.map((product) => ({
        scopeId: `scope_${product.id}`,
        productId: product.id,
        productName: product.name,
        status: 'PENDING' as ScopeItemPayloadStatus,
        discrepancy: null,
      })),
    },
    materialReturnNothingToReturn: false,
  };
};

export const indexPhotosById = (progress: InstallProgress): Map<string, CapturedPhoto> => {
  const map = new Map<string, CapturedPhoto>();
  const add = (photos?: CapturedPhoto[]) =>
    (photos ?? []).forEach((p) => p && map.set(p.id, p));

  add(progress.pickup.photos);
  add(progress.return.photos);
  add(progress.cocPages);
  Object.values(progress.pecEntries).forEach((e) => add(e.photos));
  add(Object.values(progress.preMatched));
  add(Object.values(progress.postMatched));
  Object.values(progress.preExtras).forEach(add);
  Object.values(progress.postExtras).forEach(add);

  return map;
};
