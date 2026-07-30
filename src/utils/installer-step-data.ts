/**
 * `stepData` builders for `PATCH installer/v1/update/{jobId}`.
 *
 * One builder per timeline step, each returning `null` when the step has nothing to
 * send so a caller can skip the request entirely. Each returns the INNER object;
 * `InstallerService.updateJob` wraps it in `{ stepData: … }`.
 *
 * Only the keys the server stores (`INSTALLER_PATCH_FIELDS`) may appear — anything
 * else is stripped before sending.
 *
 *  - **Every photo array is sent whole**, not as an increment. The multipart upload
 *    already appended each shot; restating the current set is what keeps a retaken or
 *    deleted photo from leaving a stale row behind.
 *  - A photo joins its array only once its upload returned an `s3url`.
 *  - **Pre-existing conditions** carry their photos nested per area — the only place
 *    the server learns which shot documents which condition.
 */

import {
  DISCREPANCY_ISSUE_TYPES,
  PEC_AREAS,
} from '../constants/installer';
import {
  INSTALLER_PATCH_FIELDS,
  type CapturedPhoto,
  type DiscrepancyCategory,
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

/**
 * Drops any key the server doesn't accept. Cheap insurance: a field added to a
 * builder before the backend supports it degrades to "not sent" instead of failing
 * the whole step's save with a 400.
 */
export const stripUnsupportedFields = (patch: InstallerJobPatch): InstallerJobPatch => {
  const clean: InstallerJobPatch = {};
  INSTALLER_PATCH_FIELDS.forEach((key) => {
    const value = patch[key];
    if (value !== undefined) (clean as any)[key] = value;
  });
  return clean;
};

/** True when a patch would send nothing. */
export const isEmptyPatch = (patch: InstallerJobPatch | null): boolean =>
  !patch || Object.keys(patch).length === 0;

// ─────────────────────────────────────────────────────────────────────────────
// Photo references
// ─────────────────────────────────────────────────────────────────────────────

/** A photo only becomes referenceable once the upload gave it an `s3url`. */
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 · Pickup / Step 7 · Return
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether an empty photo array is meaningful.
 *
 * An untouched step and a step whose last photo was just deleted both hold zero
 * photos, and they must not send the same thing: omitting the key leaves the server's
 * copy alone (right for the first), sending `[]` clears it (right for the second). The
 * builders can't tell the two apart, so the caller says — only a delete passes
 * `includeEmptyPhotos`, which keeps an un-hydrated device from wiping a set it simply
 * hasn't loaded yet.
 */
export interface StepDataOptions {
  includeEmptyPhotos?: boolean;
}

/**
 * Pickup — the loaded-material shots, as the set currently stands.
 *
 * A photo joins the array only once its upload returned an `s3url`. "Had material on
 * truck" (`skipped`) has no backend field, so a skipped pickup PATCHes nothing.
 */
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

/** Return — the "used all material" flag plus the returned-stock shots. */
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 · Pre-Existing Conditions
// ─────────────────────────────────────────────────────────────────────────────

const areaLabel = (areaId: string): string =>
  PEC_AREAS.find((a) => a.id === areaId)?.label ?? areaId;

const toCondition = (areaId: string, entry: PECEntry): PreExistingConditionPayload => ({
  label: areaLabel(areaId),
  isSelected: true,
  description: entry.note?.trim() ?? '',
  // Nested here rather than in a flat array — this is the only place the backend
  // learns which shot documents which area.
  photos: toPhotoRefs(entry.photos ?? []).map((ref) => ({
    ...ref,
    subcategory: areaLabel(areaId),
  })),
});

export const buildPecStepData = (
  progress: InstallProgress,
  userId?: string
): InstallerJobPatch | null => {
  // `null` = the installer never answered the question; nothing to record yet.
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 · Pre-Install / Step 5 · Post-Install
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The matched set as photo refs.
 *
 * Keyed by tag, so a retake replaces its predecessor rather than adding to it — which
 * is why sending the whole set is right here: the PATCH restates what the installer
 * actually ended up with, independent of how many shots were appended along the way.
 * `salesPhotoId` is the rep photo each one pairs with.
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 · Verify Job Scope
// ─────────────────────────────────────────────────────────────────────────────

/** "Wrong Product" → "WRONG_PRODUCT". Anything unrecognised falls to OTHER. */
export const toDiscrepancyCategory = (issue?: string): DiscrepancyCategory => {
  const match = DISCREPANCY_ISSUE_TYPES.find(
    (t) => t.toLowerCase() === (issue ?? '').trim().toLowerCase()
  );
  if (!match) return 'OTHER';
  return match.toUpperCase().replace(/\s+/g, '_') as DiscrepancyCategory;
};

/**
 * `resolved` maps to CORRECT, not DISCREPANCY: the Install Manager settled it, so the
 * scope as sold is what gets installed. The discrepancy itself was already routed
 * through `installer/v1/jobs/{id}/discrepancy` when it was raised.
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Step 6 · CoC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * CoC — the scanned pages of the signed Certificate of Completion.
 *
 * Same contract as the material arrays: whole set every time, and a page joins it only
 * once its upload returned an `s3url`. `subcategory: 'coc'` matches what the upload
 * descriptor stamped, so the two records agree.
 *
 * Page order rides on `timestampTaken` rather than an index, because the scanner can
 * add several pages in one pass and a rescan has to slot back in at the right place —
 * an index would renumber every page after it.
 */
export const buildCocStepData = (
  progress: InstallProgress,
  options: StepDataOptions = {}
): InstallerJobPatch | null => {
  const photos = toPhotoRefs(progress.cocPages).map((ref) => ({
    ...ref,
    subcategory: 'coc',
  }));
  return photos.length || options.includeEmptyPhotos
    ? { installerCocPhotos: photos }
    : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clears everything the job has recorded, as far as the API allows.
 *
 * Sets every patchable field back to its untouched value: conditions un-checked and
 * empty, all five photo arrays emptied, every product back to PENDING, the return
 * flag off. Everything the installer sees on the device is wiped alongside it
 * (`useInstallProgress.reset`).
 */
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

// ─────────────────────────────────────────────────────────────────────────────
// Lookup helper
// ─────────────────────────────────────────────────────────────────────────────

/** Every captured photo on a job, by local id — used to resolve scope attachments. */
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
