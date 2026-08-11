/**
 * rehash-draft-calculators.ts — which calculators a REHASH lead may still BUILD.
 *
 * A rehash normally opens on the locked receipt view: the job was already scoped and
 * sold on the first visit, and the second visit exists to renegotiate the PRICE, not
 * to re-measure the house (see the `readOnly` note in `DynamicDealCenterScreen`).
 *
 * But a rehash can arrive with NO job scope at all. The appointment a rehash resolves
 * is not the original one, so `useDynamicCalculators` creates an empty placeholder
 * calculator for it — full field list seeded at `inputValue: 0`. Locking THAT is a
 * dead end: an empty receipt (no items, COST/PAR/RETAIL $0, end price "—" LOCKED) with
 * no way to enter the job, and nothing for the rollout step to show either, since it
 * hides calculators whose title is still a bare number. So: nothing built yet → let
 * the rep build it; already built → keep it locked.
 *
 * The answer is LATCHED the first time each calculator is seen and never re-derived
 * from the live entries. Re-deriving would flip the calculator to locked the moment
 * the rep types their first quantity, swapping the form out from under them mid-entry.
 *
 * Latching PER CALCULATOR (rather than once for the screen) is what keeps the ＋ button
 * working on a rehash: a newly added tab is empty when first seen, so it opens editable
 * while the original, already-scoped calculator stays locked.
 *
 * ⚠️ A draft OUT-RANKS the stored `isRolloutConfirmed`. That flag belongs to the
 * ORIGINAL appointment and a rehash can inherit it already `true` on a calculator that
 * carries no dynamic scope at all — e.g. the first sale was scoped in the classic deal
 * center, whose values live in the legacy top-level columns and leave `entries` all
 * zero. Honouring it there is what leaves the rep staring at a confirmed-and-locked
 * receipt of `$0` with nothing to unlock it. There is no scope on screen to protect, so
 * the confirmation protects nothing. `releaseRehashDrafts` re-locks the calculator the
 * moment the rep confirms a rollout for real.
 */
import { hasEnteredScope } from './scope-signature';

export interface RehashDraftLatch {
  /** calculator ids already judged — a second look must never change the verdict */
  seen: Set<string>;
  /** of those, the ones that held no entered scope when first seen */
  draft: Set<string>;
}

export const createRehashDraftLatch = (): RehashDraftLatch => ({ seen: new Set(), draft: new Set() });

/**
 * Judge every calculator not yet seen, mutating `latch` in place. Idempotent: calling
 * it again with the same (or grown) list re-judges nothing, which is what makes it safe
 * to run during render — a repeated or discarded render reaches the same sets.
 *
 * Call ONLY for a rehash lead, and only once the calculators have loaded. An empty
 * mid-load list is harmless (nothing is judged), but a tab judged before its saved
 * entries arrive would latch as a draft and wrongly unlock a scoped calculator.
 */
export function latchRehashDrafts(
  latch: RehashDraftLatch,
  tabs: Array<{ id: string; entries?: Record<string, any> }>,
): void {
  tabs.forEach((t) => {
    if (!t?.id || latch.seen.has(t.id)) return;
    latch.seen.add(t.id);
    if (!hasEnteredScope(t.entries)) latch.draft.add(t.id);
  });
}

/**
 * The rep has confirmed these calculators' rollouts IN THIS SESSION, so they are
 * ordinary confirmed calculators now and lock like any other.
 *
 * This is the ONLY way a draft stops being one, and it is driven by the confirm action
 * rather than by re-reading `isRolloutConfirmed`. The stored flag cannot be used: on a
 * rehash it can already be `true` on arrival — carried over from the original
 * appointment — which is precisely the state that produced the empty locked receipt
 * this module exists to unstick. A flag that is true both before and after tells you
 * nothing about what the rep just did; the confirm call does.
 */
export function releaseRehashDrafts(latch: RehashDraftLatch, ids: Array<string | undefined>): void {
  ids.forEach((id) => {
    if (id) latch.draft.delete(id);
  });
}

/** Is this calculator one the rep may still build? False for every non-rehash lead. */
export const isRehashDraftCalculator = (latch: RehashDraftLatch, id?: string): boolean =>
  !!id && latch.draft.has(id);
