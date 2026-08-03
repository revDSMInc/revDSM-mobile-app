/**
 * Installer module domain types.
 *
 * Field names intentionally mirror `./lead` (customerDetails / fullAddress / leadTime /
 * leadDate / leadId) because both surface the same backend lead model — keeping the
 * shapes aligned means the real endpoints drop in without a remapping layer.
 */

import type { TranslationKey } from '../../i18n/translations';

// ─────────────────────────────────────────────────────────────────────────────
// Install timeline
// ─────────────────────────────────────────────────────────────────────────────

export type InstallStepKey =
  | 'pickup'
  | 'pec'
  | 'pre'
  | 'measure'
  | 'post'
  | 'coc'
  | 'return';

/** `locked` = dependencies unmet, `active` = ready to start, `done` = satisfied. */
export type InstallStepStatus = 'done' | 'active' | 'locked';

export interface InstallStep {
  key: InstallStepKey;
  n: number;
  /** English source string. The UI renders `titleKey` through `t()` instead. */
  title: string;
  titleKey: TranslationKey;
  desc: string;
  descKey: TranslationKey;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Photo matching (pre / post install ghost overlay)
// ─────────────────────────────────────────────────────────────────────────────

export type PhotoPhase = 'pre' | 'post';

export interface PhotoTag {
  id: string;
  label: string;
  /**
   * Whether the rep captured this tag at sale time. Tags without a rep photo have
   * nothing to ghost-match against, so they are optional (rendered dimmed / N/A).
   */
  hasRep: boolean;
  /**
   * `_id` of the rep's `salesPhotos` entry this tag ghosts against. Sent as
   * `salesPhotoId` when uploading the installer's pre/post shot, which is how the
   * backend pairs the two images.
   */
  repPhotoId?: string;
  /** Rep category this tag belongs to, e.g. "Flooring — EXT". Sent as `category`. */
  categoryLabel?: string;
  /**
   * Rep's reference shot as a displayable URL. For real jobs this is a short-lived
   * signed S3 URL resolved from `repPhotoS3Url` (see `useRepPhotoSections`); undefined
   * until it resolves, so the ghost placeholder shows meanwhile.
   */
  repPhotoUrl?: string;
  /** Raw bucket-relative S3 key of the rep shot, resolved to a signed URL on demand. */
  repPhotoS3Url?: string;
  repPhotoBucket?: string;
}

export interface PhotoSection {
  id: string;
  name: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
  /** Raw rep-category label (un-uppercased), e.g. "Flooring — EXT". */
  categoryLabel?: string;
  tags: PhotoTag[];
}

/**
 * A photo the rep captured at sale time, as returned by the API.
 *
 * `s3url` is a bucket-relative key — run it through `resolveS3Url` (or pair it with
 * `bucketName`) before handing it to an `<Image>`.
 */
export interface RepPhoto {
  _id: string;
  s3url: string;
  bucketName?: string;
  timestampTaken?: string;
  coordinates?: { latitude: number; longitude: number };
  isAnnotated?: boolean;
}

/** One cell of a rep photo grid. `hasSalesPhoto` = there is something to ghost against. */
export interface PhotoSlot {
  id: string;
  name: string;
  storageName?: string;
  row: number;
  col: number;
  allowMultiple?: boolean;
  isExtra: boolean;
  hasSalesPhoto: boolean;
  photos: RepPhoto[];
}

export interface PhotoCategoryGroup {
  label: string;
  /** Layout hint from the job-builder schema, e.g. "compass-grid". */
  type: string;
  path: string[];
  storageCategory: string | null;
  slots: PhotoSlot[];
}

export interface PhotoProductGroup {
  product: string;
  schemaResolved: boolean;
  categories: PhotoCategoryGroup[];
}

/** The rep's capture set for this job — the reference for the pre-install ghost pass. */
export interface PreInstallPhotos {
  totalPhotos: number;
  filledSlots: number;
  products: PhotoProductGroup[];
}

export type PhotoUploadStatus = 'pending' | 'uploading' | 'uploaded' | 'failed';

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface CapturedPhoto {
  id: string;
  uri: string;
  /** Tag this shot satisfies. Absent for free-shot "extras". */
  tagId?: string;
  sectionId?: string;
  phase?: PhotoPhase;
  takenAt: string;

  // ── Server round-trip ──────────────────────────────────────────────────────
  // Filled in once `installer/v1/{jobId}/images` accepts the shot. The step-data
  // PATCH references these, so a photo without `s3url` has not been persisted yet.
  /** Undefined for shots that are never uploaded (CoC pages — no backend field). */
  uploadStatus?: PhotoUploadStatus;
  /** Bucket-relative S3 key returned by the upload. */
  s3url?: string;
  bucketName?: string;
  /** `_id` the API assigned to the stored image. */
  serverId?: string;
  /** Fix at capture time; `null` when the device could not produce one. */
  coordinates?: GeoCoordinates | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job scope (sold products the installer verifies)
// ─────────────────────────────────────────────────────────────────────────────

export interface SoldProduct {
  id: string;
  name: string;
  /** Accent hex. Falls back to a palette rotation when the API omits it. */
  color?: string;
  lines: string[];
}

export type ScopeItemState = 'confirmed' | 'pending' | 'resolved';

export interface ScopeStatus {
  state: ScopeItemState;
  issue?: string;
  note?: string;
  /** Ids of job photos attached as evidence. */
  attachments?: string[];
}

export interface DiscrepancyReport {
  productId: string;
  issue: string;
  note: string;
  attachments: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-existing conditions
// ─────────────────────────────────────────────────────────────────────────────

export interface PECArea {
  id: string;
  /**
   * English label. Authoritative — it travels to the server as the condition's `label`
   * and is what hydration matches on. The UI renders `labelKey` instead.
   */
  label: string;
  labelKey: TranslationKey;
}

export interface PECEntry {
  areaId: string;
  note: string;
  photos: CapturedPhoto[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Job reference data
// ─────────────────────────────────────────────────────────────────────────────

export interface JobNote {
  id: string;
  /** Display name of the author, e.g. "Rep" or "IM". */
  author: string;
  /** When it was written, e.g. "at job build" or "today 7:02 AM". */
  at: string;
  body: string;
  pinned?: boolean;
}

export interface ContractDetails {
  contractPrice?: number;
  downPayment?: number;
  downPaymentMethod?: string;
  remainingBalance?: number;
  balanceMethod?: string;
  loanAuth?: string;
}

export interface JobPacket {
  fileName: string;
  pages?: number;
  /** Ready-to-open URL, when one is served directly. */
  fileUrl?: string;
  /**
   * Bucket-relative S3 key (`submissionPdf.url`). S3 objects are private, so this
   * has to be exchanged for a signed URL before it can be opened.
   */
  s3url?: string;
  bucketName?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Statuses the API takes on `installer/v1/update/{jobId}`.
 *
 * These are wire codes, NOT the button labels the UI shows — `RESULT_STATUS_CODE`
 * (`constants/installer.ts`) maps `"Can't Do Work"` → `cantDoWork` and `"Not Hit"` →
 * `notHit`. `"Reset"` has no code here: reset is its own endpoint
 * (`PUT installer/v1/{jobId}/reset`).
 */
export type JobWorkflowStatus = 'scheduled' | 'inProgress' | 'completed' | 'onHold';

/** Result actions, as the API spells them. */
export type JobResultStatus = 'cantDoWork' | 'notHit';

export type JobStatus = JobWorkflowStatus | JobResultStatus;

export interface InstallerJob {
  _id: string;
  /** Mongo id of the lead. Not the human-facing number — see `leadDisplayId`. */
  leadId?: string;
  /** Human-facing lead number. Undefined when the API sends "N/A". */
  leadDisplayId?: string;
  jobNumber?: string;
  /** Arrival window, e.g. "8AM – 12NOON ARRIVAL". */
  leadTime?: string;
  leadDate?: string;
  fullAddress?: string;
  customerId?: string;
  /** Single-string name as sent by the API; also split into `customerDetails`. */
  customerName?: string;
  customerDetails?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
  };
  location?: {
    type: string;
    coordinates: [number, number];
  };
  /** True once the job has been resulted (can't-do-work / reset / not-hit / complete). */
  resulted?: boolean;
  status?: JobStatus | string;
  /** Position in the installer workflow, e.g. "start". */
  workflowState?: string;
  companyName?: string;
  notes?: JobNote[];
  contract?: ContractDetails;
  products?: SoldProduct[];
  packet?: JobPacket;
  /** Rep capture set. Only returned by the check-in response (`{jobId}/work`). */
  preInstallPhotos?: PreInstallPhotos;
  /**
   * What the server already holds for this job's install — the other half of the
   * timeline. Without it, a job opened on a second phone (or after a reinstall) shows
   * an empty timeline while the work sits in the database.
   */
  stored?: InstallerStoredRecords;
}

/**
 * Body of `PUT installer/v1/{jobId}/work` — the installer's check-in.
 *
 * Everything here describes WHERE the check-in was made, so the server can re-run the
 * geofence the app applied in `utils/installer-geofence.ts` rather than trusting it.
 * The endpoint also still accepts no body at all.
 */
export interface InstallerCheckInPayload {
  /** The job address the check-in was matched against. */
  address?: string;
  /**
   * The DEVICE's position at the moment of check-in, GeoJSON — `[longitude, latitude]`,
   * in that order. Not the job's own coordinates.
   */
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
  /** Tolerance the app allowed, in metres (`CHECK_IN_RADIUS_METERS`). */
  radius: number;
}

/**
 * The install record as the API keeps it, straight off the check-in response.
 *
 * Kept raw rather than folded into `InstallProgress` here: hydrating needs signed URLs
 * (the arrays carry bucket keys, not displayable URLs), which is a network call, so the
 * merge happens in `installer-hydrate.ts` once those resolve.
 */
export interface InstallerStoredRecords {
  pickupPhotos: InstallerStoredImage[];
  returnPhotos: InstallerStoredImage[];
  cocPhotos: InstallerStoredImage[];
  preInstallPhotos: InstallerStoredImage[];
  postInstallPhotos: InstallerStoredImage[];
  preExistingConditions?: PreExistingConditionsPayload;
  jobScopeVerification?: JobScopeVerificationPayload;
  materialReturnNothingToReturn?: boolean;
}

export interface JobPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface JobSummaryCounts {
  scheduled: number;
  inProgress: number;
  completed: number;
  onHold: number;
  total: number;
}

/** `GET installer/v1/my-jobs` payload, normalized. */
export interface InstallerJobsResult {
  jobs: InstallerJob[];
  pagination?: JobPagination;
  summaryCounts?: JobSummaryCounts;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result
// ─────────────────────────────────────────────────────────────────────────────

/** The button labels, as the installer reads them. Never sent to the API verbatim. */
export type InstallerResultType = "Can't Do Work" | 'Reset' | 'Not Hit';

/** One image attached to a result's `statusReason`. */
export interface StatusReasonImage {
  s3url: string;
  bucketName?: string;
}

/**
 * The new `statusReason` payload sent on result/reset actions.
 *
 * `reason` is mandatory; `images` is required only for "Can't Do Work"
 * (enforced in the modal) and optional for Reset / Not Hit.
 */
export interface StatusReasonPayload {
  reason: string;
  images?: StatusReasonImage[];
}

export interface InstallerResultSubmission {
  jobId: string;
  /** The button the installer pressed — kept for logging and copy. */
  result: InstallerResultType;
  /** The wire code for that button (`RESULT_STATUS_CODE`), e.g. `notHit`. */
  status: JobResultStatus;
  /** Travels as `statusReason` — now an object with `reason` + optional `images`. */
  reason: StatusReasonPayload;
}

// ─────────────────────────────────────────────────────────────────────────────
// Image upload — `installer/v1/{jobId}/images` (multipart)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `phase` form field. One per capture surface; the backend routes each to its own
 * array (`installerPickupPhotos`, `installerCocPhotos`, …).
 */
export type InstallerImagePhase =
  | 'pickup'
  | 'preExisting'
  | 'pre'
  | 'post'
  | 'return'
  | 'coc'
  | 'result';

/**
 * `phase` of `DELETE installer/v1/{jobId}/images`.
 *
 * A superset of the upload phases: the delete route also takes `scope`, which nothing
 * uploads under. Kept as its own union so that stays true if the two lists diverge again.
 */
export type InstallerDeletePhase = InstallerImagePhase | 'scope';

/**
 * Body of `DELETE installer/v1/{jobId}/images`.
 *
 * `s3urls` are the bucket-relative keys the upload returned (`InstallerStoredImage.
 * s3url`), NOT displayable URLs — a signed URL resolved for rendering will not match.
 * Batched, so removing several shots at once is one request.
 */
export interface InstallerImageDeletePayload {
  phase: InstallerDeletePhase;
  s3urls: string[];
}

/**
 * One entry of the `images` form field (sent as a JSON array alongside `files`).
 * Which keys are present depends on the phase:
 *  - `pickup` / `return` → `subcategory` = the phase name
 *  - `preExisting`       → `conditionLabel` + `subcategory` = the flagged area
 *  - `pre` / `post`      → `salesPhotoId` (+ `category` / `subcategory` from the slot)
 */
export interface InstallerImageDescriptor {
  subcategory?: string;
  conditionLabel?: string;
  salesPhotoId?: string;
  category?: string;
  timestampTaken: string;
  coordinates?: GeoCoordinates | null;
}

/** A stored image as the API returns it. */
export interface InstallerStoredImage {
  _id: string;
  s3url: string;
  bucketName: string;
  subcategory?: string;
  conditionLabel?: string;
  salesPhotoId?: string;
  category?: string;
  timestampTaken?: string;
  coordinates?: GeoCoordinates | null;
}

/** `data` of the upload response, normalized. */
export interface InstallerImageUploadResult {
  jobId?: string;
  leadId?: string;
  phase: InstallerImagePhase;
  /** Just-added images, in request order. */
  appended: InstallerStoredImage[];
  /** The full array for this phase after the append. */
  photos: InstallerStoredImage[];
}

/** A local file ready for multipart. */
export interface InstallerUploadFile {
  uri: string;
  name: string;
  type: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Step data — `PATCH installer/v1/update/{jobId}`
// ─────────────────────────────────────────────────────────────────────────────

export type PreExistingConditionsStatus =
  | 'NOT_CHECKED'
  | 'NO_CONDITIONS_FOUND'
  | 'CONDITIONS_PRESENT';

/** Photo reference as the step-data payload carries it (no local uri). */
export interface StepPhotoRef {
  s3url: string;
  bucketName?: string;
  salesPhotoId?: string;
  category?: string;
  subcategory?: string;
  timestampTaken?: string;
  coordinates?: GeoCoordinates | null;
}

export interface PreExistingConditionPayload {
  label: string;
  isSelected: boolean;
  description: string;
  photos: StepPhotoRef[];
}

export interface PreExistingConditionsPayload {
  status: PreExistingConditionsStatus;
  /** Server fills these in when omitted. */
  checkedBy?: string;
  checkedAt?: string;
  conditions: PreExistingConditionPayload[];
}

export type ScopeItemPayloadStatus = 'PENDING' | 'CORRECT' | 'DISCREPANCY';

export type DiscrepancyCategory =
  | 'MEASUREMENT'
  | 'COLOR'
  | 'WRONG_PRODUCT'
  | 'MISSING_ITEM'
  | 'OTHER';

export interface ScopeDiscrepancyPayload {
  category: DiscrepancyCategory;
  details: string;
  referenceImages: { id: string; s3url: string; bucketName?: string }[];
  reportedAt: string;
  reportedBy?: string;
}

export interface ScopeItemPayload {
  scopeId: string;
  productId: string;
  productName: string;
  status: ScopeItemPayloadStatus;
  discrepancy: ScopeDiscrepancyPayload | null;
}

export interface JobScopeVerificationPayload {
  verificationStatus: 'IN_PROGRESS' | 'COMPLETED' | 'DISCREPANCY_FOUND';
  scopeItems: ScopeItemPayload[];
}

/**
 * The `stepData` object of `PATCH installer/v1/update/{jobId}`.
 *
 * The request body wraps these keys — `{ stepData: { … } }` — with only `status`
 * allowed alongside it at the top level; `InstallerService.updateJob` adds the
 * wrapper, so builders return the inner object. (The predecessor route,
 * `PATCH installer/v1/{jobId}`, took the same keys FLAT.)
 *
 * Every photo array is sent as the step's CURRENT full set, not as an increment: the
 * multipart upload already appended each shot, and restating the whole set is what
 * keeps a retaken or deleted photo from leaving a stale row behind. That relies on the
 * server treating these arrays as a replace, the same way it replaces
 * `preExistingConditions` and `jobScopeVerification`.
 *
 * Every key is optional: one step's worth of data per request.
 */
export interface InstallerJobPatch {
  /** Step 1 · Pickup. */
  installerPickupPhotos?: StepPhotoRef[];
  /** Step 2 · Pre-Existing Conditions. */
  preExistingConditions?: PreExistingConditionsPayload;
  /** Step 3 · Pre-Install. */
  installerPreInstallPhotos?: StepPhotoRef[];
  /** Step 4 · Verify Job Scope. */
  jobScopeVerification?: JobScopeVerificationPayload;
  /** Step 5 · Post-Install. */
  installerPostInstallPhotos?: StepPhotoRef[];
  /** Step 6 · CoC — the scanned pages of the signed Certificate of Completion. */
  installerCocPhotos?: StepPhotoRef[];
  /** Step 7 · Return — the "used all material" flag and the returned-stock shots. */
  materialReturnNothingToReturn?: boolean;
  installerReturnPhotos?: StepPhotoRef[];
}

/**
 * The keys the server stores from `stepData`. Used to strip unknown ones before
 * sending, so one stray field can't fail a whole step's save.
 */
export const INSTALLER_PATCH_FIELDS: (keyof InstallerJobPatch)[] = [
  'installerPickupPhotos',
  'preExistingConditions',
  'installerPreInstallPhotos',
  'jobScopeVerification',
  'installerPostInstallPhotos',
  'installerCocPhotos',
  'materialReturnNothingToReturn',
  'installerReturnPhotos',
];

// ─────────────────────────────────────────────────────────────────────────────
// Per-job progress (persisted locally today, server-backed later)
// ─────────────────────────────────────────────────────────────────────────────

export interface MaterialStepState {
  photos: CapturedPhoto[];
  /** "Had material on truck" (pickup) / "Used all material" (return). */
  skipped: boolean;
}

export interface InstallProgress {
  jobId: string;
  pickup: MaterialStepState;
  return: MaterialStepState;
  /** null = not yet answered, false = none found, true = conditions present. */
  pecHasConditions: boolean | null;
  pecEntries: Record<string, PECEntry>;
  /** tagId -> captured shot. */
  preMatched: Record<string, CapturedPhoto>;
  postMatched: Record<string, CapturedPhoto>;
  /** sectionId -> free-shot extras. */
  preExtras: Record<string, CapturedPhoto[]>;
  postExtras: Record<string, CapturedPhoto[]>;
  /** productId -> verification state. */
  scope: Record<string, ScopeStatus>;
  cocPages: CapturedPhoto[];
  /**
   * Evidence attached to a Can't Do Work / Not Hit result.
   *
   * **On-device only.** There is no agreed wire contract for these yet — no `phase` on
   * the image upload and no field on the step-data PATCH — so nothing is invented here:
   * the shots are held in progress (and MMKV, so a crash mid-result doesn't lose them)
   * and wait for the payload the backend defines. `handleSubmitResult` in
   * `screens/Installer/JobDetail.tsx` is the single place to wire it up.
   *
   * Kept in `InstallProgress` rather than the modal's own state so that when it is
   * wired, it already shares the upload queue (`waitForUploads`) and the `patchPhoto`
   * write-back every other capture uses.
   */
  resultPhotos: CapturedPhoto[];
  /** Steps completed explicitly (photo/material steps derive from their own data). */
  completedSteps: Partial<Record<InstallStepKey, boolean>>;
  updatedAt?: string;
}
