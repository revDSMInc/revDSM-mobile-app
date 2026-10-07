import type { TranslationKey } from '../../i18n/translations';

export type InstallStepKey =
  | 'pickup'
  | 'pec'
  | 'pre'
  | 'measure'
  | 'post'
  | 'coc'
  | 'return';

export type InstallStepStatus = 'done' | 'active' | 'locked';

export interface InstallStep {
  key: InstallStepKey;
  n: number;
  title: string;
  titleKey: TranslationKey;
  desc: string;
  descKey: TranslationKey;
  icon: string;
}

export type PhotoPhase = 'pre' | 'post';

export interface PhotoTag {
  id: string;
  label: string;
  hasRep: boolean;
  repPhotoId?: string;
  repPhotoSource?: string;
  categoryLabel?: string;
  repPhotoUrl?: string;
  repPhotoS3Url?: string;
  repPhotoBucket?: string;
}

export interface PhotoSection {
  id: string;
  name: string;
  icon: string;
  categoryLabel?: string;
  tags: PhotoTag[];
}

export interface RepPhoto {
  _id: string;
  s3url: string;
  bucketName?: string;
  timestampTaken?: string;
  coordinates?: { latitude: number; longitude: number };
  isAnnotated?: boolean;
  source?: string;
}

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
  tagId?: string;
  sectionId?: string;
  phase?: PhotoPhase;
  takenAt: string;

  uploadStatus?: PhotoUploadStatus;
  s3url?: string;
  bucketName?: string;
  serverId?: string;
  coordinates?: GeoCoordinates | null;
}

export interface ScopeFieldRow {
  label: string;
  value: string;
}

export interface ScopeCombination {
  number: number;
  headline: string;
  rows: ScopeFieldRow[];
}

export interface ScopeSection {
  id: string;
  label: string;
  combinations: ScopeCombination[];
  rows: ScopeFieldRow[];
}

export interface SoldProduct {
  id: string;
  name: string;
  color?: string;
  lines: string[];
  sections?: ScopeSection[];
}

export type ScopeItemState = 'confirmed' | 'pending' | 'resolved';

export interface ScopeStatus {
  state: ScopeItemState;
  issue?: string;
  note?: string;
  attachments?: string[];
}

export interface DiscrepancyReport {
  productId: string;
  issue: string;
  note: string;
  attachments: string[];
}

export interface PECArea {
  id: string;
  label: string;
  labelKey: TranslationKey;
}

export interface PECEntry {
  areaId: string;
  note: string;
  photos: CapturedPhoto[];
}

export interface JobNote {
  id: string;
  author: string;
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
  fileUrl?: string;
  s3url?: string;
  bucketName?: string;
}

export type JobWorkflowStatus = 'scheduled' | 'rescheduled' | 'inProgress' | 'completed' | 'onHold';

export type JobResultStatus = 'cantDoWork' | 'notHit';

export type JobResetStatus = 'reset';

export type JobStatus = JobWorkflowStatus | JobResultStatus | JobResetStatus;

export interface InstallerBypass {
  gpsBypass?: boolean;
  gpsBypassReason?: string | null;
  earlyStart?: boolean;
  earlyStartReason?: string | null;
}

export interface InstallerJob {
  _id: string;
  leadId?: string;
  leadDisplayId?: string;
  jobNumber?: string;
  leadTime?: string;
  leadDate?: string;
  fullAddress?: string;
  customerId?: string;
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
  resulted?: boolean;
  status?: JobStatus | string;
  workflowState?: string;
  installerBypass?: InstallerBypass;
  companyName?: string;
  notes?: JobNote[];
  contract?: ContractDetails;
  products?: SoldProduct[];
  packet?: JobPacket;
  cocPacket?: JobPacket;
  preInstallPhotos?: PreInstallPhotos;
  stored?: InstallerStoredRecords;
}

export interface InstallerCheckInPayload {
  address?: string;
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
  radius: number;
}

export interface InstallerStoredRecords {
  pickupPhotos: InstallerStoredImage[];
  returnPhotos: InstallerStoredImage[];
  cocPhotos: InstallerStoredImage[];
  preInstallPhotos: InstallerStoredImage[];
  postInstallPhotos: InstallerStoredImage[];
  preExistingConditions?: PreExistingConditionsPayload;
  jobScopeVerification?: JobScopeVerificationPayload;
  materialReturnNothingToReturn?: boolean;
  coc?: CocStepPayload;
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

export interface InstallerJobsResult {
  jobs: InstallerJob[];
  pagination?: JobPagination;
  summaryCounts?: JobSummaryCounts;
}

export type InstallerResultType = "Can't Do Work" | 'Reset' | 'Not Hit';

export interface StatusReasonImage {
  s3url: string;
  bucketName?: string;
}

export interface StatusReasonPayload {
  reason: string;
  images?: StatusReasonImage[];
}

export interface StatusRequestImage {
  s3url: string;
  bucketName?: string;
  timestampTaken?: string;
  coordinates?: GeoCoordinates | null;
}

export type StatusRequestType = 'CANT_DO_WORK' | 'NOT_HIT' | 'RESET';

export interface ProposedSchedulePayload {
  date: string;
  timeWindow?: string | null;
  reason?: string | null;
}

export interface StatusRequestPayload {
  reason: string;
  images?: StatusRequestImage[];
  requestType?: StatusRequestType;
  proposedSchedule?: ProposedSchedulePayload;
}

export interface InstallerResultSubmission {
  jobId: string;
  result: InstallerResultType;
  status: JobStatus;
  reason: StatusReasonPayload;
}

export type InstallerImagePhase =
  | 'pickup'
  | 'preExisting'
  | 'pre'
  | 'post'
  | 'return'
  | 'coc'
  | 'cocPaperFallback'
  | 'result';

export type InstallerDeletePhase = InstallerImagePhase | 'scope';

export interface InstallerImageDeletePayload {
  phase: InstallerDeletePhase;
  s3urls: string[];
}

export interface InstallerImageDescriptor {
  subcategory?: string;
  conditionLabel?: string;
  salesPhotoId?: string;
  preInstallPhotoId?: string;
  category?: string;
  timestampTaken: string;
  coordinates?: GeoCoordinates | null;
}

export interface InstallerStoredImage {
  _id: string;
  s3url: string;
  bucketName: string;
  subcategory?: string;
  conditionLabel?: string;
  salesPhotoId?: string;
  preInstallPhotoId?: string;
  category?: string;
  timestampTaken?: string;
  coordinates?: GeoCoordinates | null;
}

export interface CocScanFields {
  jobNumber?: string;
  date?: string;
  relationship?: CocRelationshipType;
  relationshipOther?: string;
  isAdult?: boolean;
  isAuthorizedSigner?: boolean;
  installedPerContract?: boolean;
}

export interface InstallerImageUploadResult {
  jobId?: string;
  leadId?: string;
  phase: InstallerImagePhase;
  appended: InstallerStoredImage[];
  photos: InstallerStoredImage[];
  scan?: CocScanFields | null;
}

export interface InstallerUploadFile {
  uri: string;
  name: string;
  type: string;
}

export type PreExistingConditionsStatus =
  | 'NOT_CHECKED'
  | 'NO_CONDITIONS_FOUND'
  | 'CONDITIONS_PRESENT';

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

export interface CocSignatureRef {
  s3url: string;
  bucketName?: string;
}

export type CocRelationshipType = 'homeowner' | 'spouse' | 'other';

export interface CocStepPayload {
  confirmations: {
    is18OrOlder: boolean;
    isHomeownerOrAuthorized: boolean;
    installationCompletedAsPerContract: boolean;
  };
  customer: {
    relationshipType: CocRelationshipType;
    otherRelationship: string | null;
  };
  installerSignature?: CocSignatureRef;
  customerSignature?: CocSignatureRef;
}

export interface CocSignOff extends CocStepPayload {
  jobNumber?: string;
  date?: string;
  signedAt?: string;
  installerSignaturePaths?: string[];
  customerSignaturePaths?: string[];
  signatureSize?: { width: number; height: number };
  installerSignatureUrl?: string;
  customerSignatureUrl?: string;
  document?: JobPacket;
}

export interface InstallerJobPatch {
  installerPickupPhotos?: StepPhotoRef[];
  preExistingConditions?: PreExistingConditionsPayload;
  installerPreInstallPhotos?: StepPhotoRef[];
  jobScopeVerification?: JobScopeVerificationPayload;
  installerPostInstallPhotos?: StepPhotoRef[];
  installerCocPhotos?: StepPhotoRef[];
  coc?: CocStepPayload;
  materialReturnNothingToReturn?: boolean;
  installerReturnPhotos?: StepPhotoRef[];
}

export const INSTALLER_PATCH_FIELDS: (keyof InstallerJobPatch)[] = [
  'installerPickupPhotos',
  'preExistingConditions',
  'installerPreInstallPhotos',
  'jobScopeVerification',
  'installerPostInstallPhotos',
  'installerCocPhotos',
  'coc',
  'materialReturnNothingToReturn',
  'installerReturnPhotos',
];

export interface MaterialStepState {
  photos: CapturedPhoto[];
  skipped: boolean;
}

export interface InstallProgress {
  jobId: string;
  pickup: MaterialStepState;
  return: MaterialStepState;
  pecHasConditions: boolean | null;
  pecEntries: Record<string, PECEntry>;
  preMatched: Record<string, CapturedPhoto>;
  postMatched: Record<string, CapturedPhoto>;
  preExtras: Record<string, CapturedPhoto[]>;
  postExtras: Record<string, CapturedPhoto[]>;
  scope: Record<string, ScopeStatus>;
  cocPages: CapturedPhoto[];
  cocSignatureS3Urls?: string[];
  cocSignOff?: CocSignOff;
  resultPhotos: CapturedPhoto[];
  completedSteps: Partial<Record<InstallStepKey, boolean>>;
  updatedAt?: string;
}
