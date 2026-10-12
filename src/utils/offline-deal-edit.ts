/**
 * The My Deals edit screen, opened at a door with no signal.
 *
 * The screen reads four server queries (outcome, calculator, portal job-builder, refund
 * approvers) plus the funding record. Every one of them is wrapped in `try/catch -> return null`,
 * so offline they RESOLVE rather than throw - and the rep gets a half-seeded wizard with no
 * explanation instead of an error.
 *
 * ⚠️ That is the bug this file exists for: the screen is currently BROKEN offline, not blocked.
 * A wizard that opens with blank prices is worse than one that refuses, because the rep cannot
 * tell which fields are genuinely empty.
 *
 * Pure on purpose (CLAUDE.md section 6): no React Native import, so the rules are testable.
 */

/** One envelope per lead - one read, one write, one eviction story. */
export interface CachedDealEdit {
  outcome: unknown | null;
  calculator: unknown | null;
  portalJobBuilder: unknown | null;
  /** Refund approvers. Without this `refundBlockers` fails on `!approverId` and blocks every refund. */
  approvers: unknown | null;
  /** The funding record - a refund needs its payment rows to pick a source. */
  funding: unknown | null;
}

export const dealEditCacheName = (leadId: string | null | undefined): string | null => {
  const id = typeof leadId === 'string' ? leadId.trim() : '';
  return id ? `deal-edit:${id}` : null;
};

/**
 * Is this snapshot worth seeding the wizard from?
 *
 * ⚠️ The job-builder record is the ONLY required field. Without it there is nothing to edit, and
 * a wizard seeded from the other three would show a price with no build behind it. The rest are
 * genuinely optional - a deal with no refund approvers configured still edits fine.
 */
export const isUsableDealEditCache = (
  cached: CachedDealEdit | null | undefined
): cached is CachedDealEdit => !!cached && cached.portalJobBuilder != null;

/**
 * Should the screen read the device instead of the network?
 *
 * ⚠️ Mirrors `deviceIsAuthoritative` in `useDynamicCalculators`, including the weak-signal case:
 * `isOnline()` is false for `degraded`, so one bar routes here too rather than hanging on a
 * request that will not finish.
 */
export const shouldUseDealEditCache = (online: boolean, preferDevice: boolean): boolean =>
  preferDevice || !online;

export type DealEditOfflineState = 'ready' | 'unavailable' | 'online';

/**
 * What the screen should do on open.
 *
 * `unavailable` is a REFUSAL, not a failure - the deal was never opened on this device, so there
 * is nothing honest to show. It is a better outcome than a blank wizard.
 */
export const dealEditOfflineState = (
  online: boolean,
  preferDevice: boolean,
  cached: CachedDealEdit | null | undefined
): DealEditOfflineState => {
  if (!shouldUseDealEditCache(online, preferDevice)) return 'online';
  return isUsableDealEditCache(cached) ? 'ready' : 'unavailable';
};

/**
 * Build the snapshot to store after a successful online open.
 *
 * ⚠️ Returns null unless the job-builder record is present, so a half-loaded screen never
 * overwrites a good snapshot with a worse one. A rep who opens the deal on a flaky line keeps
 * the copy that actually works.
 */
export const buildDealEditCache = (parts: Partial<CachedDealEdit>): CachedDealEdit | null => {
  if (parts.portalJobBuilder == null) return null;
  return {
    outcome: parts.outcome ?? null,
    calculator: parts.calculator ?? null,
    portalJobBuilder: parts.portalJobBuilder,
    approvers: parts.approvers ?? null,
    funding: parts.funding ?? null,
  };
};

/**
 * Has anything actually changed since the stored snapshot?
 *
 * ⚠️ The performance guard. MMKV rewrites its WHOLE store on every write, and this screen
 * re-renders constantly, so writing on each render would tax every unrelated write in the app.
 * Reopening an unchanged deal must cost nothing.
 */
export const dealEditCacheChanged = (
  next: CachedDealEdit,
  prev: CachedDealEdit | null | undefined
): boolean => {
  if (!prev) return true;
  // ⚠️ IDENTITY FIRST, and that is the point. These five values come straight out of TanStack
  // Query, which hands back the SAME object until the data actually changes - so a reopen of an
  // unchanged deal settles here without serialising anything. The deep compare below is the
  // fallback for a refetch that produced equal-but-new objects, and it only runs once per open.
  if (
    next.portalJobBuilder === prev.portalJobBuilder &&
    next.outcome === prev.outcome &&
    next.calculator === prev.calculator &&
    next.approvers === prev.approvers &&
    next.funding === prev.funding
  ) {
    return false;
  }
  return JSON.stringify(next) !== JSON.stringify(prev);
};
