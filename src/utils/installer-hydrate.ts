/**
 * Server install record → local `InstallProgress`.
 *
 * The timeline renders from `useInstallProgress`, which lives in this device's MMKV.
 * That is fine for one installer on one phone and wrong for everything else: a job
 * already worked from another phone — or reopened after a reinstall — showed an empty
 * timeline while its photos, conditions and scope sat in the database. Check-in returns
 * all of it (`InstallerJob.stored`), so this merges it back in.
 *
 * Two rules make the merge safe to run more than once:
 *
 *  1. **Photos are added, never replaced.** A server shot whose `s3url` is already on
 *     the device is skipped, so a capture still uploading is never duplicated and a
 *     retake is never undone.
 *  2. **Non-photo state only fills gaps.** Conditions, scope and the return flag are
 *     taken from the server ONLY where this device has no answer yet — otherwise a
 *     re-run would overwrite what the installer just entered.
 *
 * Deleting still works: removing a photo and leaving the step PATCHes the step's full
 * remaining set, so the server drops it too and a later hydrate can't bring it back.
 */

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

/** Signed URL per bucket key, from `url/v1/secure/multiple`. */
export type SecureUrlMap = Record<string, string>;

/** Keys mismatch on encoding often enough to be worth normalizing both sides. */
export const normalizeKey = (value?: string): string => {
  if (!value) return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Every bucket key in the record, for one batched signed-URL request. */
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
    // The certificate's two signatures — the form shows them back, so they need a
    // signed URL like any other stored image.
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

/**
 * One stored image → a `CapturedPhoto` the UI can render.
 *
 * `id` is the server's `_id` so a re-hydrate maps onto the same photo, and `uri` is the
 * signed URL — without one the tile would render a bucket key and show nothing.
 */
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

/** Server photos this device doesn't already hold, by `s3url`. */
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

/**
 * Re-points already-hydrated photos at a fresh signed URL.
 *
 * Signed URLs expire in an hour but progress is persisted to MMKV, so a photo hydrated
 * yesterday would render a dead link today. Anything captured on this device keeps its
 * own `file://` path — that doesn't expire and must not be replaced.
 */
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

/** Photos in capture order — the server keeps them appended, so timestamps decide. */
const byTakenAt = (a: CapturedPhoto, b: CapturedPhoto): number =>
  (a.takenAt || '').localeCompare(b.takenAt || '');

const areaIdForLabel = (label: string): string | undefined =>
  PEC_AREAS.find((area) => area.label.toLowerCase() === label.trim().toLowerCase())?.id;

/** `CORRECT` → confirmed, `DISCREPANCY` → pending. `PENDING` stays unanswered. */
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
  /**
   * Reference photo id → tag id, so a matched shot lands back on the slot it came from.
   *
   * Keyed by the id itself, NOT by which field carried it: the same row is sent as
   * `salesPhotoId` or `preInstallPhotoId` depending on its `source`
   * (`utils/installer-upload.ts` › `matchedPhotoIdRef`), and both spellings must land
   * on the same tag.
   */
  tagIdBySalesPhotoId?: Map<string, string>;
  /**
   * Fallback for a shot with NO `salesPhotoId`: the stored `subcategory` → tag id.
   *
   * Needed because the pre pass lets the installer shoot tags the rep never covered
   * (`PhotoMatchStep.isTagOpen`). Those shots pair with no rep photo, so the id map above
   * can never place them and a second device would show the tag empty while the photo sat
   * in the record.
   *
   * Keyed BOTH ways — see `tagIdBySubcategory` in `JobDetail` — because the two writers
   * disagree: the step PATCH stores the tag ID, the image upload stores the tag LABEL.
   */
  tagIdBySubcategory?: Map<string, string>;
}

/** Case/space-insensitive, so a label lookup isn't defeated by "Back-Left " vs "back-left". */
export const subcategoryKey = (value?: string): string => (value ?? '').trim().toLowerCase();

/** The s3urls the signed certificate claims as its two signatures. */
export const cocSignatureUrls = (signOff?: CocSignOff): Set<string> =>
  new Set(
    [signOff?.installerSignature?.s3url, signOff?.customerSignature?.s3url].filter(
      Boolean
    ) as string[]
  );

/**
 * Is this stored CoC image one of the certificate's signatures rather than a page?
 *
 * A page with no `s3url` has not been uploaded, so it cannot be a signature — it is
 * a local scan and is always kept.
 */
export const isCocSignatureImage = (s3url?: string, signatureUrls?: Set<string>): boolean =>
  !!s3url && !!signatureUrls?.has(s3url);

/**
 * Merges the server's record into local progress. Returns `previous` unchanged when
 * there is nothing to add, so callers can skip a pointless state write.
 */
export const mergeServerProgress = (
  previous: InstallProgress,
  records: InstallerStoredRecords | undefined,
  urls: SecureUrlMap,
  options: HydrateOptions = {}
): InstallProgress => {
  if (!records) return previous;

  let changed = false;
  const next: InstallProgress = { ...previous };

  // ── Material steps ────────────────────────────────────────────────────────
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

  // "Used all material" — only when this device has no photos and hasn't skipped, so a
  // stale server flag can't override what the installer is doing right now.
  if (
    records.materialReturnNothingToReturn === true &&
    !previous.return.skipped &&
    next.return.photos.length === 0
  ) {
    changed = true;
    next.return = { ...next.return, skipped: true };
  }

  // ── CoC pages ─────────────────────────────────────────────────────────────
  //
  // ⚠️ The two SIGNATURES come back in this same array. They are uploaded with the
  // phase and subcategory the backend specified for this step (`coc`/`coc`), which is
  // exactly what a scanned page carries — so nothing in the stored row tells them
  // apart. Without this they hydrate as pages: the grid shows the signatures, the Done
  // button counts them, and the tile's ✕ would delete a signature off the certificate.
  //
  // The certificate itself is the discriminator: it records which two s3urls are its
  // signatures. (A device with no stored sign-off — a reinstall, or cleared storage —
  // has nothing to match on and will show them as pages again; naming them in the
  // upload is the only real fix, and that needs the backend to agree a subcategory.)
  // ── The signed certificate ────────────────────────────────────────────────
  //
  // Restored from the server so the form can be reopened with what was actually
  // filed — including on a device that never signed it. The strokes are NOT on the
  // server (they only exist where they were drawn), so the images stand in for them:
  // `installerSignatureUrl` / `customerSignatureUrl`.
  //
  // The DEVICE's own record wins where it has one: it holds the strokes, and it is
  // also the newer of the two for the installer who has just signed.
  const storedCoc = records.coc;
  if (storedCoc) {
    const merged: CocSignOff = {
      ...storedCoc,
      ...(previous.cocSignOff ?? {}),
      // Signature refs come from whichever side has them, server first — a re-upload
      // is what the server holds, and the device copy may predate it.
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

  // ⚠️ The CURRENT pair is not enough, and that was the bug: `cocSignOff` holds only
  // the latest signatures, so every RE-SIGN orphaned the previous pair and it came
  // back from the server as a page. A job signed three times showed six "pages",
  // each a duplicate of a signature already drawn on the card above them.
  //
  // The remembered set is therefore unioned with the current pair and persisted, so
  // a superseded signature stays known for the life of the job.
  const knownSignatures = new Set(previous.cocSignatureS3Urls ?? []);
  cocSignatureUrls(next.cocSignOff ?? previous.cocSignOff).forEach((url) =>
    knownSignatures.add(url)
  );
  if (knownSignatures.size !== (previous.cocSignatureS3Urls ?? []).length) {
    changed = true;
    next.cocSignatureS3Urls = [...knownSignatures];
  }

  // Pruned on BOTH sides. Filtering only the server additions leaves the ones a
  // previous open already merged into progress — they are in MMKV, so they survive
  // every relaunch and the fix would look like it had done nothing.
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

  // ── Matched pre/post shots ────────────────────────────────────────────────
  // Keyed by the reference photo each pairs with (`salesPhotoId` / `preInstallPhotoId`),
  // which is stable and exact.
  // `subcategory` is the fallback, and only that: it is written by two different paths
  // (the upload puts the tag LABEL there, the step PATCH the tag ID), so it is matched
  // through a map that carries both spellings and drops any that are ambiguous.
  const { tagIdBySalesPhotoId, tagIdBySubcategory } = options;
  if (tagIdBySalesPhotoId?.size || tagIdBySubcategory?.size) {
    (['pre', 'post'] as const).forEach((phase) => {
      const field = phase === 'pre' ? 'preMatched' : 'postMatched';
      const serverImages =
        phase === 'pre' ? records.preInstallPhotos : records.postInstallPhotos;

      let matchedChanged = false;
      const matched = { ...previous[field] };

      // Refresh the slots already filled from the server before adding new ones.
      Object.entries(matched).forEach(([tagId, photo]) => {
        const [fresh] = withRefreshedUris([photo], urls);
        if (fresh !== photo) {
          matched[tagId] = fresh;
          matchedChanged = true;
        }
      });

      serverImages.forEach((image) => {
        // Either id field identifies the same reference row — see the map's own note.
        const referenceId = image.salesPhotoId || image.preInstallPhotoId;
        const tagId =
          (referenceId ? tagIdBySalesPhotoId?.get(referenceId) : undefined) ??
          // Only reached for a shot the rep set can't identify — an added tag. A row
          // that HAS a reference id is never resolved this way, so the weaker key
          // can't override the exact one.
          tagIdBySubcategory?.get(subcategoryKey(image.subcategory));
        // An already-filled slot is left alone: the local shot is the newer one.
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

  // ── Pre-existing conditions ───────────────────────────────────────────────
  // Only when this device hasn't answered the question yet.
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

  // ── Job scope ─────────────────────────────────────────────────────────────
  // Per product, and only where this device has no verdict.
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
