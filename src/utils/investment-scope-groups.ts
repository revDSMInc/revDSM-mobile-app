/**
 * "Includes the Following" on the Investment Center, grouped by category.
 *
 * The API now returns `descriptionsByCategory` beside the flat `descriptions` list:
 *
 *   [{ categoryId: "category_..._2", categoryName: "Soffit",  descriptions: [...] },
 *    { categoryId: "category_..._0", categoryName: "Gutter",  descriptions: [...] },
 *    { categoryId: "",               categoryName: "",        descriptions: [...] }]
 *
 * Each named group gets a "<categoryName> Installation:" heading above its bullets. A group
 * with NO category name keeps the old look - plain bullets, no heading - which is also what the
 * whole panel falls back to when the API sends nothing but the flat list.
 */

export interface ScopeCategoryInput {
  categoryId?: string;
  categoryName?: string;
  descriptions?: unknown;
}

export interface ScopeGroup {
  /** The heading to print, or null for loose bullets under no heading. */
  heading: string | null;
  lines: string[];
}

const HEADING_SUFFIX = 'Installation:';

const cleanLines = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [])
    .filter((d): d is string => typeof d === 'string' && d.trim().length > 0)
    .map((d) => d.trim());

/**
 * "Soffit" -> "Soffit Installation:".
 *
 * ⚠️ A name that already ends in "Installation" (any case, with or without the colon) is NOT
 * doubled up - the portal lets the category be named anything, and "Soffit Installation
 * Installation:" is the kind of thing a customer sees on a signed quote.
 */
export const scopeHeadingFor = (categoryName?: string): string | null => {
  const name = (categoryName || '').trim();
  if (!name) return null;
  const bare = name.replace(/\s*:\s*$/, '');
  if (/installation$/i.test(bare)) return `${bare}:`;
  return `${bare} ${HEADING_SUFFIX}`;
};

/**
 * Group the bullets for display.
 *
 * ⚠️ Order is the API's, untouched. The server decides which trade leads the quote, and
 * re-sorting here (alphabetically, or named-before-unnamed) would silently reorder what the
 * customer reads.
 *
 * ⚠️ Groups with no usable line are dropped, so an empty category cannot print a bare heading
 * with nothing under it.
 */
export const buildScopeGroups = (
  byCategory: ScopeCategoryInput[] | undefined | null,
  fallbackLines: string[] | undefined | null = [],
): ScopeGroup[] => {
  const groups: ScopeGroup[] = [];

  (byCategory || []).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const lines = cleanLines(entry.descriptions);
    if (!lines.length) return;
    groups.push({ heading: scopeHeadingFor(entry.categoryName), lines });
  });

  if (groups.length) return groups;

  // No grouped data (older API, or an offline cache from before it existed): render exactly as
  // the panel always has.
  const flat = cleanLines(fallbackLines);
  return flat.length ? [{ heading: null, lines: flat }] : [];
};

/** Every line that will be shown, in order - for counting and for the empty check. */
export const flattenScopeGroups = (groups: ScopeGroup[]): string[] =>
  groups.flatMap((g) => g.lines);
