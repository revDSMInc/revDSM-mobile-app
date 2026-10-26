/**
 * What the sync strip across the top of the home screen says.
 *
 * Replaces the expandable "N leads waiting to sync" CARD, which put queue mechanics - per-lead
 * rows, progress counts, retry buttons and raw API errors - on the screen a rep uses to do
 * their job. A sync is background work: it earns one line, and the detail belongs in Profile
 * where someone can go looking for it.
 *
 * WARNING: FAILURES ARE DELIBERATELY SILENT HERE. The home screen never shows an error, a
 * count of errors, or a retry control. A rep standing on a driveway cannot act on "the
 * calculator conflicted", and a red card on the lead list reads as "the app is broken" when
 * the work is safe on the device and will go out. Anything needing a human lives in Profile ->
 * pending uploads. This is a product decision, not an oversight: do not add an error state to
 * this strip.
 *
 * Mirrors `utils/connection-banner.ts` (same three-state shape, same hysteresis idea) so the
 * two strips behave alike and can stack.
 *
 * Pure - no React Native imports - so the rules are testable. See CLAUDE.md section 6.
 */

export type SyncTone = 'none' | 'syncing' | 'done';

export interface SyncCopy {
  tone: SyncTone;
  icon: string;
  title: string;
}

/** Green, matching the app's success colour; the connection strip owns amber. */
export const SYNC_DONE_BG = '#DCFCE7';
export const SYNC_DONE_FG = '#166534';

/** Neutral while in flight: work in progress is not a warning. */
export const SYNCING_BG = '#E8F0FE';
export const SYNCING_FG = '#1E40AF';

/** How long "Syncing done" stays up before the strip clears itself. */
export const SYNC_DONE_HOLD_MS = 3_000;

export interface SyncCounts {
  /** Queued items that can still go out: draft or uploading. */
  pending: number;
  /** Items parked for a human (failed / needs-review). NOT shown - see the warning above. */
  blocked: number;
}

export const countSyncWork = (
  items: ReadonlyArray<{ status?: string }> | null | undefined
): SyncCounts => {
  let pending = 0;
  let blocked = 0;
  for (const w of items || []) {
    if (w?.status === 'failed' || w?.status === 'needs-review') blocked += 1;
    else if (w?.status === 'draft' || w?.status === 'uploading') pending += 1;
  }
  return { pending, blocked };
};

/**
 * The tone to show.
 *
 * WARNING: `justFinished` is the caller's memory that pending went from >0 to 0 in THIS
 * session. Without it a cold start with an empty queue would greet the rep with "Syncing
 * done" for something they never saw start.
 *
 * WARNING: blocked work shows NOTHING, by design. It is not `none` because of an oversight -
 * see the module note.
 */
export const syncBannerFor = (
  counts: SyncCounts,
  justFinished: boolean,
  online: boolean
): SyncCopy => {
  // Offline, the connection strip is already saying the useful thing; two stacked strips
  // about the same situation is noise.
  if (counts.pending > 0 && online) {
    return { tone: 'syncing', icon: 'cloud-upload-outline', title: 'Syncing your work...' };
  }
  if (counts.pending === 0 && justFinished) {
    return { tone: 'done', icon: 'cloud-check-outline', title: 'Syncing done' };
  }
  return { tone: 'none', icon: '', title: '' };
};
