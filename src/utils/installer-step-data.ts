/**
 * Body builders for `PATCH installer/v1/{jobId}`.
 *
 * One builder per timeline step, each returning `null` when the step has nothing to
 * send so a caller can skip the request entirely.
 *
 * The payload is **flat** — no `stepData` wrapper — and only the five keys the
 * server allows (`INSTALLER_PATCH_FIELDS`) may appear; anything else comes back as
 * `400 Unsupported patch fields`. That allow-list also settles which photos travel
 * how:
 *
 *  - **Pickup and Return photos are not patchable.** They reach the server only
 *    through `installer/v1/{jobId}/images`, which appends them server-side. Return
 *    still PATCHes its `materialReturnNothingToReturn` flag, which has no other route.
 *  - **Pre- and Post-install photos are patchable**, so the matched set is sent as a
 *    whole. The upload already appended each shot; this restates the current set,
 *    which is what keeps a retaken shot from leaving a stale row behind.
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
 * Pickup has nothing to PATCH.
 *
 * `installerPickupPhotos` is not in the server's allow-list (the photos arrive via
 * the images endpoint), and there is no "had material on truck" flag to mirror
 * Return's `materialReturnNothingToReturn`. Kept as a named no-op so the step wiring
 * reads uniformly and there is one place to fill in if that flag is ever added.
 */
export const buildPickupStepData = (_progress: InstallProgress): InstallerJobPatch | null =>
  null;

/** Return's photos go up via the images endpoint; only the skip flag is patchable. */
export const buildReturnStepData = (progress: InstallProgress): InstallerJobPatch | null => ({
  materialReturnNothingToReturn: progress.return.skipped,
});

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
  repPhotoIdByTag?: Map<string, string>
): InstallerJobPatch | null => {
  const photos = buildMatchedRefs(progress.preMatched, repPhotoIdByTag);
  return photos.length ? { installerPreInstallPhotos: photos } : null;
};

export const buildPostInstallStepData = (
  progress: InstallProgress,
  repPhotoIdByTag?: Map<string, string>
): InstallerJobPatch | null => {
  const photos = buildMatchedRefs(progress.postMatched, repPhotoIdByTag);
  return photos.length ? { installerPostInstallPhotos: photos } : null;
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
 * The contract has no field for the Certificate of Completion, so scanned pages stay
 * on the device. Kept as a named no-op so the step wiring reads uniformly and there
 * is one place to fill in when the backend adds it.
 */
export const buildCocStepData = (): InstallerJobPatch | null => null;

// ─────────────────────────────────────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clears everything the job has recorded, as far as the API allows.
 *
 * Sets every patchable field back to its untouched value: conditions un-checked and
 * empty, both photo arrays emptied, every product back to PENDING, the return flag
 * off.
 *
 * ⚠️ `installerPickupPhotos` and `installerReturnPhotos` are NOT in the server's
 * allow-list, so pickup and return shots already uploaded cannot be cleared from
 * here — they need a server-side delete. Everything the installer sees on the device
 * is wiped regardless (`useInstallProgress.reset`).
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
    installerPreInstallPhotos: [],
    installerPostInstallPhotos: [],
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
