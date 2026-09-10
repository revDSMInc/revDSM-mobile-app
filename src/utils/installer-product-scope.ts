/**
 * `productDetails` (API) -> the sold scope the installer reads.
 *
 * The backend already sends the rep's build as STRUCTURE — product > subcategory >
 * section > combination > field — and this turns it into the shape the scope cards
 * draw: sections keep their heading, each combination keeps its own block, and every
 * field keeps its label beside its value. Flattening it into one bullet list (which is
 * what this used to do) loses the two facts an installer needs most on site: which
 * measurement belongs to which run, and how many runs there are.
 *
 * Pure, with a type-only import and nothing else — `services/api/installer.ts` pulls in
 * the axios wrapper (and MMKV through it) and cannot be loaded under jest here, the same
 * reason `utils/installer-coc-scan.ts` and `utils/installer-coc-pdf.ts` exist.
 */

import type {
  ScopeCombination,
  ScopeFieldRow,
  ScopeSection,
  SoldProduct,
} from '../config/types/installer';

/**
 * Auto-generated schema ids leak through as field/section labels (e.g.
 * "section_1781585651515", "selection_ycsmh"). They carry no meaning to the installer,
 * so a label matching this pattern is dropped and only the value shown.
 */
const AUTO_LABEL = /^(section_|field_|selection_)/i;

/**
 * A locationGrid column key as the portal stores it — `1st`, `2nd`, `3rd`.
 *
 * ⚠️ The suffix is added for DISPLAY only, and only to a bare ordinal: the sales card
 * the installer is being shown alongside reads "1st Story", while the grid stores just
 * "1st". A key that is already spelled out ("1st Story") fails this test and is printed
 * verbatim, as is any column a config names something else.
 */
const STORY_KEY = /^\d+(st|nd|rd|th)$/i;

const storyLabel = (key: string): string => (STORY_KEY.test(key) ? `${key} Story` : key);

const text = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

/** A cell the rep left blank, or measured as nothing, is not part of the scope. */
const isEnteredCell = (value: unknown): boolean => {
  const raw = text(value);
  if (!raw) return false;
  const n = Number(raw);
  return Number.isNaN(n) ? true : n > 0;
};

/**
 * A `locationGrid` measurement — `{"Left Side":{"1st":5}}` — as one row PER STORY.
 *
 * The story names the row and the sides measured on it are the value
 * (`1st Story · Left Side: 5`), which is how the sales summary lays the same grid out.
 * Anything unparseable is handed back as a single row carrying the raw value, so a
 * shape this does not recognise is still shown rather than dropped.
 */
export const measurementRows = (raw: string, label: string): ScopeFieldRow[] => {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [{ label, value: raw }];
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [{ label, value: raw }];
  }

  // Stored location-first; read story-first, so one row can carry every side measured
  // on that storey. Insertion order is the config's own column order.
  const byStory = new Map<string, string[]>();
  const push = (story: string, part: string) => {
    const parts = byStory.get(story);
    if (parts) parts.push(part);
    else byStory.set(story, [part]);
  };

  Object.entries(parsed).forEach(([location, stories]) => {
    if (stories && typeof stories === 'object' && !Array.isArray(stories)) {
      Object.entries(stories as Record<string, unknown>).forEach(([story, value]) => {
        if (isEnteredCell(value)) push(story, `${location}: ${text(value)}`);
      });
    } else if (isEnteredCell(stories)) {
      // A flat `{ "Left Side": 5 }` grid — no storey to name the row, so the field's own
      // label carries it.
      push('', `${location}: ${text(stories)}`);
    }
  });

  return [...byStory.entries()].map(([story, parts]) => ({
    label: storyLabel(story) || label,
    value: parts.join(', '),
  }));
};

/**
 * One `{ label, value }` schema field -> the rows it contributes, or `[]` when it is
 * empty. A measurement expands to several; everything else is exactly one.
 */
export const fieldRows = (field: any): ScopeFieldRow[] => {
  const value = text(field?.value);
  if (!value) return [];

  const rawLabel = text(field?.label);
  // A swatch authored with no label falls back to its schema KEY (`color`,
  // `color_gem7v`), which is not something to print at an installer.
  const label = !rawLabel || AUTO_LABEL.test(rawLabel)
    ? ''
    : BARE_COLOR_KEY.test(rawLabel)
    ? 'Color'
    : rawLabel;

  const isMeasurement =
    rawLabel.toLowerCase() === 'measurements' ||
    (value.startsWith('{') && value.endsWith('}'));

  return isMeasurement ? measurementRows(value, label) : [{ label, value }];
};

/**
 * A field whose label reads as a colour — `color`, `color_gem7v`, "LeafFilter Color".
 *
 * The portal falls back to the schema field's KEY when a swatch is authored with no
 * label, and a swatch's key is `color…` by convention, so both spellings arrive here.
 */
const COLOR_LABEL = /colou?r/i;

/** The bare colour KEY, i.e. an unlabelled swatch — displayed as "Color". */
const BARE_COLOR_KEY = /^colou?r([-_][a-z0-9]+)*$/i;

/**
 * Is this value a plain quantity?
 *
 * ⚠️ This is the whole guard on the pairing below, so it is deliberately strict: a bare
 * number and nothing else. `Yes`, `1 x 4`, `6"`, `White 80` and `Left Side: 5` are all
 * NOT quantities, which is what keeps a standalone swatch — the one that follows a
 * selection rather than a count — reading as its own row.
 */
const isQuantityValue = (value: string): boolean =>
  value !== '' && Number.isFinite(Number(value));

/**
 * A section's fields -> its rows, with each colour folded into the quantity it belongs to
 * (`Ground Spout · 3 · Black`).
 *
 * ⚠️ **The pairing is POSITIONAL, and it has to be**: the colour is its own field with its
 * own id, and it carries nothing linking it back — no `dcField`, no parent id. The
 * authoring convention is a quantity immediately followed by its swatch, which is exactly
 * what the Extras section stores (`…__textvalue-uuu1l: 2`, `…__color-gem7v: "Forest
 * Green"`, alternating). `utils/dynamic-job-builder/engine/locked-color-defaults.ts`
 * relies on the same convention on the sales side, for the same absence of a link.
 *
 * ⚠️ **A colour only folds into a QUANTITY.** A swatch that follows a SELECTION is a
 * product choice in its own right — the gutter combination's `color: White 80` sits after
 * `Gutter Partial?: Yes` — and folding that one in would read as though the selection had
 * been measured. A colour therefore also never folds into another colour, which falls out
 * of the same test: a merged or standalone colour's value is not a number.
 */
export const buildFieldRows = (fields: any[]): ScopeFieldRow[] => {
  const out: ScopeFieldRow[] = [];

  (Array.isArray(fields) ? fields : []).forEach((field: any) => {
    const rows = fieldRows(field);
    // A measurement expands to several rows and is never a colour — nothing to fold.
    if (rows.length !== 1) {
      out.push(...rows);
      return;
    }

    const [row] = rows;
    const previous = out[out.length - 1];

    if (COLOR_LABEL.test(text(field?.label)) && previous && isQuantityValue(previous.value)) {
      out[out.length - 1] = { ...previous, value: `${previous.value} · ${row.value}` };
      return;
    }

    out.push(row);
  });

  return out;
};

const toCombination = (combo: any, index: number): ScopeCombination | null => {
  const rows: ScopeFieldRow[] = [];
  const headline: string[] = [];

  buildFieldRows(combo?.fields).forEach((row) => {
    if (row.label) rows.push(row);
    else headline.push(row.value);
  });

  if (rows.length === 0 && headline.length === 0) return null;

  // Numbered by `renumberScopeCombinations` once the whole card is built — see there.
  return { number: index + 1, headline: headline.join(' · '), rows };
};

const toSection = (section: any): ScopeSection | null => {
  const combinations = (Array.isArray(section?.combinations) ? section.combinations : [])
    .map(toCombination)
    .filter((c: ScopeCombination | null): c is ScopeCombination => !!c);

  const rows = buildFieldRows(section?.fields);

  if (combinations.length === 0 && rows.length === 0) return null;

  const rawLabel = text(section?.label);
  return {
    id: text(section?.id) || rawLabel || `section-${combinations.length}-${rows.length}`,
    label: !rawLabel || AUTO_LABEL.test(rawLabel) ? '' : rawLabel,
    combinations,
    rows,
  };
};

/**
 * Combinations are numbered ACROSS THE WHOLE CARD, in the order they arrive.
 *
 * ⚠️ The payload's own `combo.index` restarts at 1 in every section, and a subcategory is
 * routinely authored as several one-combination sections — LeafFilter arrives as four —
 * so trusting it printed "Combination #1" three times on one card, over three different
 * gutter widths. Position within the card is the only number that reads as an ordinal to
 * the installer, and it is what the sales card shows (Soffit: Vinyl Soffit #1, Porch
 * Ceiling #2, Nailer Build Out #3).
 */
export const renumberScopeCombinations = (sections: ScopeSection[]): ScopeSection[] => {
  let n = 0;
  return sections.map((section) => ({
    ...section,
    combinations: section.combinations.map((combo) => ({ ...combo, number: ++n })),
  }));
};

/** Every combination on the card, however its sections are split. */
const countCombinations = (sections: ScopeSection[]): number =>
  sections.reduce((total, section) => total + section.combinations.length, 0);

/** A row as one line of text — the flat `lines` form, and the bullet the cards draw. */
export const rowText = (row: ScopeFieldRow): string =>
  row.label ? `${row.label}: ${row.value}` : row.value;

/** Every section flattened to one string per entered value. */
export const flattenScopeSections = (sections: ScopeSection[]): string[] => {
  const lines: string[] = [];
  // Counted across the card, like the numbering itself — otherwise four one-combination
  // sections would each read as a lone unnumbered run.
  const multi = countCombinations(sections) > 1;
  sections.forEach((section) => {
    section.combinations.forEach((combo) => {
      const parts = [
        ...(combo.headline ? [combo.headline] : []),
        ...combo.rows.map(rowText),
      ];
      if (parts.length === 0) return;
      if (multi) lines.push(`Combination #${combo.number} — ${parts.join(' · ')}`);
      else lines.push(...parts);
    });
    lines.push(...section.rows.map(rowText));
  });
  return lines;
};

/**
 * `productDetails` (API) -> `SoldProduct[]` (app).
 *
 * The sold scope the installer confirms is the set of SUBCATEGORIES (e.g. "Gutters",
 * "Gutter Guards"), so each subcategory becomes one card — that is the unit a
 * discrepancy is raised against, and it is what `scopeItems` is keyed by.
 *
 * A subcategory whose sections hold nothing entered still yields a card: the product was
 * sold, and an empty card says so where a missing one would read as "not on this job".
 */
export const normalizeProductDetails = (raw: any): SoldProduct[] | undefined => {
  const products: any[] = Array.isArray(raw?.products) ? raw.products : [];
  if (products.length === 0) return undefined;

  const out: SoldProduct[] = [];

  products.forEach((product) => {
    const subs: any[] = Array.isArray(product?.subcategories) ? product.subcategories : [];

    if (subs.length === 0) {
      out.push({
        id: text(product?.id) || text(product?.verticalId) || text(product?.name),
        name: text(product?.name) || 'Product',
        lines: [],
        sections: [],
      });
      return;
    }

    subs.forEach((sub) => {
      const sections = renumberScopeCombinations(
        (Array.isArray(sub?.sections) ? sub.sections : [])
          .map(toSection)
          .filter((s: ScopeSection | null): s is ScopeSection => !!s)
      );

      out.push({
        id: text(sub?.id) || `${text(product?.id)}__${text(sub?.label)}`,
        name: text(sub?.label) || text(product?.name) || 'Product',
        lines: flattenScopeSections(sections),
        sections,
      });
    });
  });

  return out.length ? out : undefined;
};
