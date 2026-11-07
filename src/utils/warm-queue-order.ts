/**
 * In what order should a screen warm its pictures to disk? (REVUIUX-586)
 *
 * Only a few downloads run at once (`MAX_CONCURRENT_WARMS` in `utils/imageFileCache.ts`), so
 * for any screen that queues several at mount the ORDER decides which are ready when the rep
 * taps. This is a product rule, not an implementation detail, so it lives here and is tested.
 *
 * The RevRender list got it wrong in a way nobody could see: it queued every run's BEFORE and
 * then every run's AFTER. The thumbnails only need the AFTER, so the strip looked completely
 * loaded while the before images were still queued - and the comparison viewer, which needs
 * BOTH, waited on a download that had not started. Reported as "it says they're loaded already
 * and I can see on the thumbnails it's loaded".
 *
 * Pure - no React Native imports - so it can be tested. See CLAUDE.md section 6.
 */

export interface WarmPair {
  /** The "before" picture, if the row has one. */
  before?: string | null;
  /** The "after" picture, if the row has one. */
  after?: string | null;
}

/**
 * Flatten rows into the order their pictures should be warmed.
 *
 * WARNING: PAIR-FIRST, not column-first. A viewer that shows two pictures together cannot open
 * until both are on disk, so finishing one row completely beats starting every row. Row order
 * is preserved: callers pass them newest-first, which is the order the rep reads them in.
 *
 * Empty urls are dropped, and the same url is never queued twice - a row whose before and
 * after are the same picture should cost one download, not two.
 */
export const warmOrderForPairs = (rows: readonly WarmPair[] | null | undefined): string[] => {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const row of rows || []) {
    for (const url of [row?.before, row?.after]) {
      const clean = typeof url === 'string' ? url.trim() : '';
      if (!clean || seen.has(clean)) continue;
      seen.add(clean);
      out.push(clean);
    }
  }

  return out;
};

/**
 * How many downloads must finish before row `index` can be opened, given `concurrency`
 * parallel slots. Used to reason about (and test) the ordering, not called in the render path.
 */
export const downloadsBeforeRowReady = (
  rows: readonly WarmPair[] | null | undefined,
  index: number,
  concurrency = 3
): number => {
  const order = warmOrderForPairs(rows);
  const row = (rows || [])[index];
  if (!row) return 0;

  const wanted = [row.before, row.after]
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter(Boolean);
  if (!wanted.length) return 0;

  const last = Math.max(...wanted.map((u) => order.indexOf(u)));
  return Math.ceil((last + 1) / Math.max(1, concurrency));
};
