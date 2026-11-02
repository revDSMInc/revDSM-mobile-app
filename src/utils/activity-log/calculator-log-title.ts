/**
 * The calculator title as the REP SEES IT, for activity logs.
 *
 * ⚠️ WHY. A full-package tab stores a long expansion - `📦 +G+Versa+S+FWrap+Light+Light Misc` -
 * but `FullPackageTitle` (`components/FullPackageBadge.tsx`) renders a cube glyph plus the
 * EXTRAS only: the rep's chip reads `+Light+Light Misc`. Every activity log sent the stored
 * string, so the portal's timeline showed a name no rep ever saw, and the same tab appeared under
 * two different names depending on which screen you read.
 *
 * The rule: the log carries what the chip carries. The keys the box glyph already stands for
 * (`G`, `S`, `FWrap` and whichever guard is present) are dropped, exactly as the chip drops them,
 * while the 📦 glyph is KEPT - the chip draws that cube icon, and without it a package reads
 * as an ordinary tab that happens to have those extras.
 *
 * ⚠️ Derived from the TITLE STRING ALONE, deliberately. `describeFullPackage` needs `entries` and
 * `schemas`, which a logger reached from a dozen call sites does not have (and must not start
 * threading through). The stored title already encodes the selection - `collectTabKeys` joined it
 * with `+` - so the extras can be recovered by splitting it back apart. Keep the key lists below
 * in step with `screens/DynamicDealCenter/utils/tab-naming.ts`.
 *
 * ⚠️ NOT a full-package title => returned unchanged (minus the usual cleanup). A plain tab's name
 * is already what the rep sees.
 *
 * Pure and RN-free so it can be tested here (CLAUDE.md section 6).
 */

/** Mirrors `FULL_PACKAGE_REQUIRED_KEYS` in `screens/DynamicDealCenter/utils/tab-naming.ts`. */
const FULL_PACKAGE_REQUIRED_KEYS = ['G', 'S', 'FWrap'];
/** Mirrors `FULL_PACKAGE_GUARD_KEYS` there. */
const FULL_PACKAGE_GUARD_KEYS = ['Versa', 'VMax', 'Guard', 'SpecGuard'];

/** The `📦 +` the tab prepends once a selection qualifies as a full package. */
const FULL_PACKAGE_PREFIX_RE = /^\s*\u{1F4E6}\s*\+?/u;

const SIZE_SUFFIX_RE = /\s*\((SM|MD|LG|XL|XXL(?:-\d+)?)\)\s*$/i;

/**
 * The package marker, KEPT in the logged name.
 *
 * ⚠️ The chip renders a cube ICON next to the extras, so the glyph is part of what the rep
 * sees - dropping it threw away the one mark that says "this is a full package" and made a
 * package indistinguishable from a tab that merely happens to have those extras. An earlier
 * pass removed it on the theory that a web timeline should not carry an emoji; the client's
 * answer was to put it back.
 */
const FULL_PACKAGE_GLYPH = '📦';

/**
 * Strip the noise every calculator log strips: the duplicate-warning glyphs, the literal words
 * "new"/"tab" a created tab carries, and runs of whitespace.
 *
 * ⚠️ The size suffix (`(SM)`, `(LG)`...) is KEPT here - it is the only thing distinguishing two
 * packages quoted at different prices, and the chip shows it too.
 */
const stripNoise = (title: string): string =>
  String(title || '')
    .replace(/⚠️?/g, '')
    .replace(/\bnew\b/gi, '')
    .replace(/\btab\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Does this title carry the full-package marker the tab adds? */
export const isFullPackageTitle = (title?: string | null): boolean =>
  FULL_PACKAGE_PREFIX_RE.test(String(title || ''));

/**
 * The title a rep would read off the tab chip.
 *
 * `'📦 +G+Versa+S+FWrap+Light+Light Misc'` -> `'+Light+Light Misc'`
 * `'📦 +G+Versa+S+FWrap (LG)'`             -> `'(LG)'`  (a bare package: no extras, rank only)
 * `'FWrap+Light (SM)'`                     -> `'FWrap+Light (SM)'`  (not a package: unchanged)
 */
export const calculatorLogTitle = (title?: string | null): string => {
  const cleaned = stripNoise(String(title || ''));
  if (!cleaned) return '';
  if (!isFullPackageTitle(cleaned)) return cleaned;

  // Hold the rank aside: it sits after the keys and must survive the rebuild.
  const rankMatch = cleaned.match(SIZE_SUFFIX_RE);
  const rank = rankMatch ? rankMatch[1].toUpperCase() : '';

  const bare = cleaned.replace(FULL_PACKAGE_PREFIX_RE, '').replace(SIZE_SUFFIX_RE, '').trim();

  const consumed = new Set(
    [...FULL_PACKAGE_REQUIRED_KEYS, ...FULL_PACKAGE_GUARD_KEYS].map((k) => k.toLowerCase())
  );
  const extras = bare
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part && !consumed.has(part.toLowerCase()));

  const extrasLabel = extras.length ? `+${extras.join('+')}` : '';
  const rankLabel = rank ? `(${rank})` : '';

  /**
   * The chip's own order: glyph, then extras, then rank. A package with neither extras nor a rank
   * is the glyph ALONE on the chip, and that is exactly what goes out.
   */
  return [FULL_PACKAGE_GLYPH, extrasLabel, rankLabel].filter(Boolean).join(' ');
};
