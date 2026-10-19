/**
 * Two calculator tabs that resolve to the SAME title cannot both be saved.
 *
 * The server enforces it: `POST /appointments/{id}/lfcalculators` answers
 *
 *   409 { code: 409, message: "LFCalculator title must be unique within this appointment
 *                              for the current user" }
 *
 * Duplicating a tab is the way in. `handleDuplicateTab` deliberately copies the source's
 * totals so both tabs price identically (see `useDynamicCalculators.ts`), and
 * `computeDerivedTitles` derives a tab's title from its base name plus a size suffix ranked
 * BY PRICE. Equal price means no rank to separate them, so both land on the same name and the
 * function marks the pair `⚠️ G ⚠️` — the warning the rep sees on the tab strip.
 *
 * ⚠️ OFFLINE IS WHERE IT HURTS. Online the 409 comes back while the rep is still on the
 * screen. Offline the POST is queued, the rep finishes the job, and the 409 only surfaces when
 * the queue drains — by which time the lead is stuck at "Couldn't be uploaded, 1 of 3
 * uploaded" with no way forward, because retrying replays the same duplicate title.
 *
 * So the check belongs BEFORE the rollout, where the rep can still rename a tab. The rule is
 * the same online and offline on purpose: one behaviour, and nothing reaches the queue that
 * the server is going to refuse.
 */

/** The marker `computeDerivedTitles` wraps an ambiguous pair in. */
const WARNING_MARK = '⚠️';

export interface TitledTab {
  id: string;
  title?: string;
}

/**
 * Compare titles the way the server's uniqueness check does.
 *
 * ⚠️ The decorations are stripped first. `⚠️ G ⚠️` and `G` are the SAME title to the server —
 * the warning marks are a UI affordance, not part of the name — so a comparison that kept them
 * would miss the very collision this exists to catch. Case and surrounding space are ignored
 * for the same reason.
 */
export const normalizeTitleForUniqueness = (title?: string): string =>
  (title || '')
    .replace(/⚠️/g, '')
    .replace(/\u{1F4E6}\s*\+/gu, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/**
 * The groups of tabs sharing one title, each group newest-last so the caller can point at the
 * copy rather than the original. A tab with no resolvable title is not a conflict: it has not
 * been named yet, and `computeDerivedTitles` falls back to its index.
 */
export const findTitleConflicts = (tabs: TitledTab[] | undefined | null): TitledTab[][] => {
  const byTitle = new Map<string, TitledTab[]>();

  (tabs || []).forEach((tab) => {
    if (!tab) return;
    const key = normalizeTitleForUniqueness(tab.title);
    if (!key) return;
    const group = byTitle.get(key);
    if (group) group.push(tab);
    else byTitle.set(key, [tab]);
  });

  return [...byTitle.values()].filter((group) => group.length > 1);
};

export const hasTitleConflict = (tabs: TitledTab[] | undefined | null): boolean =>
  findTitleConflicts(tabs).length > 0;

/** The duplicated name, shown back to the rep so they know which tabs to look at. */
export const conflictingTitle = (tabs: TitledTab[] | undefined | null): string | null => {
  const [group] = findTitleConflicts(tabs);
  if (!group) return null;
  const withMark = group.find((t) => (t.title || '').includes(WARNING_MARK));
  const raw = (withMark?.title || group[0].title || '').replace(/⚠️/g, '').trim();
  return raw || null;
};

/**
 * The tabs the rep should rename: every member of a conflicting group except the first. The
 * original keeps its name, the copies are what need changing.
 */
export const tabsNeedingRename = (tabs: TitledTab[] | undefined | null): TitledTab[] =>
  findTitleConflicts(tabs).flatMap((group) => group.slice(1));

/** Small counts read better as words; past that the digit is clearer. */
const numberWord = (n: number): string =>
  ['', '', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'][n] || String(n);

export const TITLE_CONFLICT_HEADING = 'Calculators must be different';

/**
 * ⚠️ Says what to DO, not what went wrong, and only names actions the rep can actually take.
 *
 * The raw server string ("LFCalculator title must be unique within this appointment for the
 * current user") names an internal type and gives a rep no action.
 *
 * ⚠️ Do NOT tell the rep to rename the tab. There is no rename in the UI - `TabContextMenu`
 * offers Duplicate and Delete only (`onRenameTab` is plumbed through but unreachable), and by
 * this point both tabs are usually rollout-confirmed and LOCKED, so even editing is refused.
 * A title is DERIVED from the products and their prices (`computeDerivedTitles`), so the only
 * real fixes are to make the scopes differ or to drop the spare tab.
 *
 * The cause is the same online and offline, so the wording does not change between them.
 */
export const titleConflictMessage = (tabs: TitledTab[] | undefined | null): string => {
  const [group = []] = findTitleConflicts(tabs);
  const title = conflictingTitle(tabs);

  // ⚠️ COUNT THE GROUP, never assume a pair. Duplicating twice gives three identical tabs, and
  // "Two calculators" in front of three of them reads as a different problem than the one on
  // screen. The spares are everything past the first, so that plural has to follow the count too.
  const count = Math.max(group.length, 2);
  const subject = `${numberWord(count)} calculators are`;
  const quantifier = count === 2 ? 'both' : 'all';
  const named = title
    ? `${subject} ${quantifier} "${title}" with the same products and pricing.`
    : `${subject} ${quantifier} the same products and pricing.`;
  const spares = count > 2 ? 'delete the spare tabs' : 'delete the spare tab';

  return `${named} Each one must be a different job scope — change the products or quantities so they differ, or ${spares}.`;
};

/**
 * The same 409, translated for a rep reading the pending-uploads list.
 *
 * A queued lead that hits this is STUCK: "Try again" replays the identical title, so it will
 * fail forever. The rep has to open the deal and make the two scopes differ, and the message has
 * to say so —
 * the raw server string names an internal type and reads like a crash.
 *
 * ⚠️ Matched on the server's wording rather than a status code, because `lastError` is the only
 * thing the queue keeps. Both halves must match, so an unrelated 409 is left alone.
 */
export const isTitleConflictError = (error?: string | null): boolean => {
  const text = (error || '').toLowerCase();
  return text.includes('lfcalculator') && text.includes('title must be unique');
};

export const TITLE_CONFLICT_QUEUE_MESSAGE =
  'Two calculators on this deal have the same products and pricing, so they end up identical. Open the deal and change the products on one of them, or delete the spare — retrying as-is will keep failing.';

/** `lastError` as the rep should read it. Anything unrecognised is passed through untouched. */
export const describeQueueError = (error?: string | null): string | undefined => {
  if (!error) return undefined;
  return isTitleConflictError(error) ? TITLE_CONFLICT_QUEUE_MESSAGE : error;
};
