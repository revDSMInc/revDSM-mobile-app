/**
 * Installer module domain types.
 *
 * Field names intentionally mirror `./lead` (customerDetails / fullAddress / leadTime /
 * leadDate / leadId) because both surface the same backend lead model — keeping the
 * shapes aligned means the real endpoints drop in without a remapping layer.
 */

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
  title: string;
  desc: string;
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
  label: string;
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
 * Statuses accepted by `PUT installer/v1/update-job-status/{jobId}`.
 *
 * The workflow statuses move a job through the schedule; the three result statuses
 * are the button labels verbatim — `"Can't Do Work"`, `"Reset"`, `"Not Hit"` — and
 * each must be sent with the reason the installer picked.
 */
export type JobWorkflowStatus = 'scheduled' | 'inProgress' | 'completed' | 'onHold';

export type JobStatus = JobWorkflowStatus | InstallerResultType;

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
  /** Rep capture set. Only returned when the job is started (`update-job-status`). */
  preInstallPhotos?: PreInstallPhotos;
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

export type InstallerResultType = "Can't Do Work" | 'Reset' | 'Not Hit';

export interface InstallerResultSubmission {
  jobId: string;
  /** The button the installer pressed — kept for logging and copy. */
  result: InstallerResultType;
  /** Sent as `status` — the same string as `result`, which is what the API takes. */
  status: JobStatus;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Image upload — `installer/v1/{jobId}/images` (multipart)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `phase` form field. One per capture surface; the backend routes each to its own
 * array (`installerPickupPhotos`, `installerPreInstallPhotos`, …).
 *
 * There is no phase for CoC — the backend has no field for it yet.
 */
export type InstallerImagePhase = 'pickup' | 'preExisting' | 'pre' | 'post' | 'return';

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
// Step data — `PATCH installer/v1/{jobId}`
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
 * Body of `PATCH installer/v1/{jobId}`.
 *
 * **Flat — there is no `stepData` wrapper.** The server rejects anything outside its
 * allow-list with `400 Unsupported patch fields`, and that list is exactly the five
 * keys below (see `INSTALLER_PATCH_FIELDS`). Notably absent, and therefore *not*
 * patchable: `installerPickupPhotos` and `installerReturnPhotos` — those reach the
 * server only through the multipart images endpoint — and `status`, which moves
 * through `PUT installer/v1/update-job-status/{jobId}`.
 *
 * Every key is optional: one step's worth of data per request.
 */
export interface InstallerJobPatch {
  preExistingConditions?: PreExistingConditionsPayload;
  installerPreInstallPhotos?: StepPhotoRef[];
  installerPostInstallPhotos?: StepPhotoRef[];
  jobScopeVerification?: JobScopeVerificationPayload;
  materialReturnNothingToReturn?: boolean;
}

/**
 * The server's allow-list, verbatim from its 400 message. Used to strip unknown keys
 * before sending, so one stray field can't fail a whole step's save.
 */
export const INSTALLER_PATCH_FIELDS: (keyof InstallerJobPatch)[] = [
  'preExistingConditions',
  'installerPreInstallPhotos',
  'installerPostInstallPhotos',
  'jobScopeVerification',
  'materialReturnNothingToReturn',
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
  /** Steps completed explicitly (photo/material steps derive from their own data). */
  completedSteps: Partial<Record<InstallStepKey, boolean>>;
  updatedAt?: string;
}
