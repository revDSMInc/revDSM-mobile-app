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
  /** Rep's reference shot. Populated by the API; undefined while mocked. */
  repPhotoUrl?: string;
}

export interface PhotoSection {
  id: string;
  name: string;
  /** MaterialCommunityIcons glyph name. */
  icon: string;
  tags: PhotoTag[];
}

export interface CapturedPhoto {
  id: string;
  uri: string;
  /** Tag this shot satisfies. Absent for free-shot "extras". */
  tagId?: string;
  sectionId?: string;
  phase?: PhotoPhase;
  takenAt: string;
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
  fileUrl?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Job
// ─────────────────────────────────────────────────────────────────────────────

export interface InstallerJob {
  _id: string;
  leadId?: string;
  /** Arrival window, e.g. "8AM – 12NOON ARRIVAL". */
  leadTime?: string;
  leadDate?: string;
  fullAddress?: string;
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
  status?: string;
  notes?: JobNote[];
  contract?: ContractDetails;
  products?: SoldProduct[];
  packet?: JobPacket;
}

// ─────────────────────────────────────────────────────────────────────────────
// Result
// ─────────────────────────────────────────────────────────────────────────────

export type InstallerResultType = "Can't Do Work" | 'Reset' | 'Not Hit';

export interface InstallerResultSubmission {
  jobId: string;
  result: InstallerResultType;
  reason: string;
}

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
