/**
 * Schema-aware dynamic tab naming — a 1:1 port of the web deal center's
 * `tab-name-utils.js` schema section. A calculator is named after the CSV "Tab
 * Name Key" of every FILLED field, resolved from the field's LABEL + its
 * CATEGORY (both server-authored, so renamed/duplicated fields still resolve),
 * joined in schema/field order, e.g. gutters + Versa Max → "G+VMax", roofing
 * shingles + underlayment → "Shng+Und".
 *
 * Unlike a fixed field-name list, the keys are derived dynamically so ALL FIVE
 * verticals name correctly — gutter-roofline (G/Versa/VMax/S/FWrap/Light/…),
 * Roofing (Shng/Und/Ridge/Flash/Deck/Tear), Windows (SH/DH/Cas/…), Flooring
 * (Flr/Pad/Demo/Sub/Trim) and Home Remodeling (Wet/Sur/Door/Fix/…).
 *
 * Duplicate names are disambiguated by retail price with SM/MD/LG… suffixes, or
 * flagged "⚠️ base ⚠️" when two calculators share the same base name AND price
 * (see `computeDerivedTitles`).
 */

import type {
  CalculatorSchema,
  CalculatorEntry,
  CalculatorField,
  CalculatorCategory,
} from '../types/calculator';
import { getCategoryAllFields } from '../types/calculator';

const SIZING_LABELS = ['SM', 'MD', 'LG', 'XL', 'XXL', 'XXL-2', 'XXL-3', 'XXL-4', 'XXL-5'];

/**
 * Derives short initials from a category name.
 * "Gutters" → "G", "LeafFilter" → "LF", "Soffit" → "S",
 * "Fascia" → "F", "Additional Services" → "AS", "Roofing" → "R", etc.
 */
export function getCategoryInitials(categoryName?: string): string {
  if (!categoryName) return '';
  // Split on spaces and camelCase word boundaries.
  const words = categoryName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 1) return words[0][0].toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join('');
}

// ─── CSV-driven Tab Name Keys (RevDSM-Products, all 5 verticals) ──────────────
// Normalizes a name for lookup: lowercase, drop everything but a-z0-9. Robust to
// the em-dash mojibake in the seeded catalog ("Materials — Installed").
const normalizeTabKey = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Category name (normalized) → CSV "Tab Name Key". One key per category covers
 * flooring, roofing, windows and home-remodeling cleanly; gutter-roofline's
 * Fascia / Gutter Guards / Lighting split further per-field (FIELD_TAB_KEYS +
 * the resolvers below).
 */
const CATEGORY_TAB_KEYS: Record<string, string> = {
  // Gutters / Roofline
  gutters: 'G',
  soffit: 'S',
  additionalservices: 'Labor',
  // Roofing
  shingles: 'Shng',
  underlaymentmoisture: 'Und',
  ridgeventilation: 'Ridge',
  flashing: 'Flash',
  decking: 'Deck',
  tearoff: 'Tear',
  labor: 'Labor',
  // Windows
  singlehung: 'SH',
  doublehung: 'DH',
  casement: 'Cas',
  picturefixed: 'Pic',
  slider: 'Sldr',
  awning: 'Awn',
  assemblies: 'Assy',
  laborinstallation: 'Labor',
  // Flooring
  materialsinstalled: 'Flr',
  carpetpad: 'Pad',
  removal: 'Demo',
  subfloorprep: 'Sub',
  baseboardstransitions: 'Trim',
  // Home Remodeling
  wetspace: 'Wet',
  surroundupgrades: 'Sur',
  showerdoorenclosure: 'Door',
  fixtures: 'Fix',
  accessibilityaddons: 'ADA',
  vanity: 'Van',
  toilet: 'Tlt',
  lightingelectrical: 'Elec',
  bathroomflooring: 'BthFlr',
};

/**
 * Explicit field.name → tab key overrides. A stable fast-path for the canonical
 * seeded catalog; the category label-resolvers below are the dynamic source of
 * truth and cover renamed/duplicated fields when these names miss.
 */
const FIELD_TAB_KEYS: Record<string, string> = {
  // Fascia
  trim_wrap_fascia: 'FWrap',
  fascia_board: 'FBoard',
  aluminum_2_x2_fascia_board: 'FAluminum',
  // Additional Services — screens gets its own key (category default is Labor).
  number_of_screen: 'Screens',
  screens: 'Screens',
  // Lighting
  lighting_1st_story: 'Light',
  lighting_2nd_story: 'Light',
  lighting_3rd_story: 'Light',
  control_box: 'Light Misc',
  wifi_extender: 'Light Misc',
  booster_box_s: 'Light Misc',
  electrical_outlet: 'Light Misc',
};

// ── Dynamic, schema-label-driven tab keys ─────────────────────────────────────
// The deal-center schema is server-authored: field IDs/names can be renamed or
// carry per-story suffixes, and the same product reads "Versa" in a LeafFilter
// catalog but "Micro Mesh" in a generic one. So the keys below derive from the
// field LABEL + its CATEGORY (both always present) rather than a fixed
// field.name list — one schema shape, every catalog names its own tabs.

/**
 * Detects whether a gutter-guard category is LeafFilter "Versa" flavored or
 * generic "Micro Mesh / Guard" flavored, by scanning its field labels. Drives
 * the misc add-on key so "Corners (Filter)" etc. follow their siblings.
 */
const catGuardFlavor = (cat: CalculatorCategory): 'versa' | 'guard' => {
  const fields = getCategoryAllFields(cat) || [];
  if (fields.some((f) => /versa/i.test(f?.label || ''))) return 'versa';
  if (fields.some((f) => /micro\s*mesh|guard/i.test(f?.label || ''))) return 'guard';
  return 'versa'; // default keeps legacy "LF Misc" naming
};

/**
 * Gutter-guard (LeafFilter) category: main products keyed off wording
 * (Versa/VMax vs Guard/SpecGuard), everything else treated as a misc add-on
 * following the category flavor (LF Misc vs GuardMisc).
 */
const resolveGuardCategoryKey = (cat: CalculatorCategory, label?: string): string => {
  const l = (label || '').toLowerCase();
  if (/versa\s*max/.test(l)) return 'VMax';
  if (/versa/.test(l)) return 'Versa';
  if (/special/.test(l)) return 'SpecGuard';
  if (/micro\s*mesh|guard/.test(l)) return 'Guard';
  // Misc add-on (corners, sawzall, remove protection, ribbed roof, C-S-R, …)
  return catGuardFlavor(cat) === 'guard' ? 'GuardMisc' : 'LF Misc';
};

/**
 * Per-category label resolvers for the gutter-roofline vertical. Keyed by the
 * normalized category name; each maps a field's LABEL to its tab key so the
 * result tracks the schema instead of hardcoded field ids.
 */
const GUTTER_ROOFLINE_RESOLVERS: Record<string, (label: string) => string> = {
  soffit: () => 'S',
  fascia: (label) =>
    /trim\s*wrap/i.test(label) ? 'FWrap' : /alumin/i.test(label) ? 'FAluminum' : 'FBoard',
  lighting: (label) => (/story/i.test(label) ? 'Light' : 'Light Misc'),
  additionalservices: (label) => (/screen/i.test(label) ? 'Screens' : 'Labor'),
};

/**
 * Resolves the tab-name key for a single schema field.
 * Priority: explicit field.name override → gutter-guard label logic →
 * per-category label resolver → category-name map → derived initials.
 * Every step reads from the schema (name / label / category), so a dynamic or
 * renamed schema still produces correct, non-breaking tab names.
 */
export function resolveFieldTabKey(cat: CalculatorCategory, field: CalculatorField): string {
  const name = field?.name || '';
  const label = field?.label || '';
  const catName = normalizeTabKey(cat?.name || cat?.label);

  // 1) Stable, explicit field-name overrides.
  if (name && FIELD_TAB_KEYS[name]) return FIELD_TAB_KEYS[name];

  // 2) Gutter-guard / LeafFilter category — derive from label wording.
  if (catName === 'leaffilter' || catName === 'gutterguards') {
    return resolveGuardCategoryKey(cat, label);
  }

  // 3) Other gutter-roofline categories — label-driven within the category.
  if (GUTTER_ROOFLINE_RESOLVERS[catName]) {
    return GUTTER_ROOFLINE_RESOLVERS[catName](label);
  }

  // 4) Every other vertical/category — category map → derived initials.
  const catKey = CATEGORY_TAB_KEYS[catName];
  if (catKey) return catKey;
  return getCategoryInitials(cat?.name || cat?.label || '');
}

/**
 * Collects the ordered, de-duplicated list of tab keys across all schemas.
 * `isFilled(field)` decides whether a field counts as selected. Iterating at the
 * field level (not the category level) lets one category emit several keys
 * (e.g. Fascia → FWrap+FBoard+FAlum) while preserving schema/field order, which
 * matches the CSV ordering.
 */
function collectTabKeys(
  schemas: CalculatorSchema[] | undefined,
  isFilled: (field: CalculatorField) => boolean,
): string[] {
  const parts: string[] = [];
  (schemas || []).forEach((schema) => {
    (schema.categories || []).forEach((cat) => {
      getCategoryAllFields(cat).forEach((field) => {
        if (!isFilled(field)) return;
        const key = resolveFieldTabKey(cat, field);
        if (key && !parts.includes(key)) parts.push(key);
      });
    });
  });
  return suppressCoveredMiscKeys(parts);
}

/**
 * A gutter-guard "misc" key only labels STANDALONE add-ons (corners, sawzall,
 * remove protection, ribbed roof, C-S-R…). When the calculator already carries a
 * main guard of that family, those add-ons belong to it, so the misc key is
 * dropped from the tab name: "Versa"/"VMax" not "Versa+LF Misc", and
 * "Guard"/"SpecGuard" (micro mesh / micro mesh special) not "Guard+GuardMisc".
 *
 * Each entry is `misc key → the main keys of the same family that suppress it`.
 * Families are independent, so a calculator carrying both flavors only loses the
 * misc key of the flavor whose main product is present.
 *
 * Mirrors web `tab-naming.utils.js#MISC_KEY_SUPPRESSED_BY`. `GuardMisc` was
 * previously commented out here because the web pull at the time suppressed only
 * `LF Misc`; web has since added it, so mobile follows. `Light Misc` is still
 * absent on both — web emits `Light+Light Misc` — and is left as a commented row
 * so the omission reads as a decision, not an oversight.
 */
const MISC_KEY_PARENTS: Record<string, string[]> = {
  'LF Misc': ['Versa', 'VMax'],
  GuardMisc: ['Guard', 'SpecGuard'],
  // 'Light Misc': ['Light'],               // web does not suppress this (yet)
};

function suppressCoveredMiscKeys(parts: string[]): string[] {
  return parts.filter((key) => {
    const parents = MISC_KEY_PARENTS[key];
    return !parents || !parents.some((parent) => parts.includes(parent));
  });
}

/**
 * Base name from the live entries map (keyed by field id): collects the CSV tab
 * key of every filled field in schema order and joins with "+". Empty when
 * nothing is entered (the caller falls back to position).
 */
export function getLiveSchemaBaseName(
  entries: Record<string, CalculatorEntry>,
  schemas?: CalculatorSchema[]
): string {
  if (!schemas || schemas.length === 0) return '';
  const parts = collectTabKeys(schemas, (f) => {
    const entry = entries?.[f.id];
    return !!entry && Number(entry.inputValue) > 0;
  });
  return parts.join('+');
}

// ─── Full Package ─────────────────────────────────────────────────────────────

/**
 * The keys a calculator must carry to BE a full package: gutter + soffit + the
 * Fascia tab's trim-wrap field + a LeafFilter product.
 *
 * Expressed as TAB KEYS rather than field ids on purpose — they are what
 * `resolveFieldTabKey` already derives from the server-authored label + category,
 * so a renamed or duplicated field still resolves (`Trim wrap [Fascia]` →
 * `FWrap` via the Fascia resolver's `/trim\s*wrap/i`) and the rule cannot drift
 * away from the name it replaces.
 *
 * The LeafFilter slot is a CHOICE, matching the tooltip's `(Versa OR VMax)`. It
 * accepts the generic-catalog mains (`Guard` / `SpecGuard`) as well, because
 * `resolveGuardCategoryKey` names the same product that way in a micro-mesh catalog —
 * requiring the literal Versa keys would silently exclude those companies.
 *
 * ⚠️ `LF Misc` / `GuardMisc` do NOT satisfy it: those are standalone add-ons (corners,
 * sawzall, remove protection…), not the guard product itself, so a calculator carrying
 * only an add-on is not a package.
 */
const FULL_PACKAGE_REQUIRED_KEYS = ['G', 'S', 'FWrap'];
const FULL_PACKAGE_GUARD_KEYS = ['Versa', 'VMax', 'Guard', 'SpecGuard'];

/**
 * Marks a full package on the calculator's STORED title, so the portal can tell one
 * from a plain multi-product job.
 *
 * The mobile surfaces swap the derived name for a package icon + `ⓘ`; the portal has
 * no such rendering and only ever sees this string, so the badge has to travel WITH
 * the name. It is applied in `computeDerivedTitles`, which is the single source both
 * the `PUT /lfcalculators/{id}` payload (`resolveSafeTitle`) and the `calculator
 * viewed` activity log read from — naming it at the source is what stops the saved
 * calculator and its own log from reporting two different names for one job.
 */
export const FULL_PACKAGE_TITLE_PREFIX = '📦 +';

/** The tooltip's bullet list. Lives here so it can never drift from the rule above. */
export const FULL_PACKAGE_INCLUDES = ['Gutter', 'Soffit', 'FWrap', '(Versa OR VMax)'];

/**
 * Does this calculator's live entries make up a full package?
 *
 * Derived from the same filled-field pass as `getLiveSchemaBaseName`, so it tracks
 * the rep's typing in real time and flips the moment the last of the three fields
 * gets a value — the badge replaces the `G+VMax+S+FWrap` name rather than being a
 * stored flag anyone has to maintain.
 */
export function isFullPackageSelection(
  entries: Record<string, CalculatorEntry>,
  schemas?: CalculatorSchema[]
): boolean {
  return describeFullPackage(entries, schemas).isFullPackage;
}

export interface FullPackageDescription {
  isFullPackage: boolean;
  /**
   * The tab keys the package does NOT account for, joined with "+" — e.g. a package
   * calculator that also carries lighting reads `Light`, and the tab renders
   * `📦 +Light`. Empty when the calculator is exactly a package.
   */
  extras: string;
}

/**
 * The package verdict AND whatever the calculator carries beyond it, from ONE pass
 * over the filled fields.
 *
 * The extras exist because a rep duplicates a package tab and adds a product to it:
 * collapsing that to a bare package icon would show two tabs that look identical and
 * quote different jobs. So the icon stands for the four package components only, and
 * anything else keeps the letters it always had.
 *
 * ⚠️ EVERY guard key present is consumed by the package, not just the one that
 * satisfied it. A calculator carrying both `Versa` and `VMax` is still exactly a
 * package — the tooltip's `(Versa OR VMax)` is about which one qualifies, not a limit
 * of one. Treating the second as an extra would put `📦 +Versa` on a calculator the
 * rep already accepts as a plain package.
 */
export function describeFullPackage(
  entries: Record<string, CalculatorEntry>,
  schemas?: CalculatorSchema[]
): FullPackageDescription {
  if (!schemas || schemas.length === 0) return { isFullPackage: false, extras: '' };
  const parts = collectTabKeys(schemas, (f) => {
    const entry = entries?.[f.id];
    return !!entry && Number(entry.inputValue) > 0;
  });
  const isFullPackage =
    FULL_PACKAGE_REQUIRED_KEYS.every((key) => parts.includes(key)) &&
    FULL_PACKAGE_GUARD_KEYS.some((key) => parts.includes(key));
  if (!isFullPackage) return { isFullPackage: false, extras: '' };

  const consumed = new Set([...FULL_PACKAGE_REQUIRED_KEYS, ...FULL_PACKAGE_GUARD_KEYS]);
  return {
    isFullPackage: true,
    // Schema order is preserved (`collectTabKeys` builds it in schema/field order),
    // so the extras read in the same sequence the full name used to.
    extras: parts.filter((key) => !consumed.has(key)).join('+'),
  };
}

export interface TabNameInput {
  id: string;
  entries: Record<string, CalculatorEntry>;
  /** retail total, used only to disambiguate same-named calculators */
  price: number;
  /** a manual (session) rename that overrides the derived name */
  manualTitle?: string;
  /**
   * The calculator's own stored title (web `calc.title`) — the fallback when
   * nothing has been entered yet. See `computeDerivedTitles`.
   */
  storedTitle?: string;
  /**
   * The name this calculator was CREATED with -- the customer's name on the first
   * calculator, absent on the rest.
   *
   * ⚠️ Distinct from `storedTitle` on purpose, and the difference is the whole point:
   * `storedTitle` is whatever was last SAVED, which after any entry is a DERIVED name
   * (`Labor`, `LF Misc`). Falling back to it when the rep clears every field leaves the
   * tab wearing a name for products that are no longer on it. This carries the original
   * instead, so clearing returns the tab to the customer's name rather than stranding it
   * on the last thing that happened to be entered.
   */
  originalTitle?: string;
}

/**
 * Computes the display title for every calculator: id → title.
 *
 * Manual renames win; otherwise the schema-derived base name + collision suffix is
 * used AS SOON AS any field is filled — including on the first calculator. With
 * nothing entered the calculator falls back to its **stored title**, and only then
 * to its 1-based position.
 *
 * That stored-title step is web's, verbatim — `getSchemaUpdatedCalculatorTitles`
 * resolves `getLiveSchemaBaseName(...) || getSchemaCalculatorBaseName(...) ||
 * calc.title || String(calc._id)`. It is what makes the FIRST calculator show the
 * customer's name: web creates it titled `"{firstName} {lastName}"`
 * (`job-capture-images-view.js` › the Dynamic Deal Center tool handler), and this
 * chain preserves that name until the rep's own values derive one (`G+LF`).
 *
 * ⚠️ Mobile previously went straight to the position here, which DISCARDED the
 * stored title — so a customer-named calculator was renamed to `"1"` on the first
 * `retitle` pass and the tab rendered blank. Every calculator after the first is
 * still created with a numeric placeholder, so it keeps falling through to the
 * blank tab exactly as before.
 */
export function computeDerivedTitles(
  tabs: TabNameInput[],
  schemas: CalculatorSchema[],
): Record<string, string> {
  const result: Record<string, string> = {};
  const withBase: Array<{ id: string; base: string; price: number }> = [];

  tabs.forEach((t, i) => {
    if (t.manualTitle) {
      result[t.id] = t.manualTitle;
      return;
    }
    const base = getLiveSchemaBaseName(t.entries, schemas);
    if (!base) {
      // Nothing entered → the name this calculator STARTED with (the customer's name on
      // the first one), else the 1-based position. A purely numeric title renders as a
      // BLANK tab (the `/^\d+$/` check in CalculatorView and web `TabLabel`), so every
      // calculator after the first shows no name until values are entered — unchanged.
      //
      // ⚠️ `originalTitle`, NOT `storedTitle`. `storedTitle` is the LAST SAVED name, which
      // after any entry is a DERIVED one (`Labor`, `LF Misc`) — so clearing every field
      // used to leave the tab labelled for products it no longer contains, and the rep had
      // no way to get the customer's name back. Reported as "tab naming not removed when
      // the data is cleared". Falling back to the ORIGINAL name makes clearing symmetrical
      // with entering: the tab returns to exactly what it showed before anything was typed.
      //
      // ⚠️ A manual rename is unaffected — `manualTitle` returns above, before this.
      result[t.id] = (t.originalTitle || '').trim() || String(i + 1);
      return;
    }
    withBase.push({ id: t.id, base, price: t.price || 0 });
  });

  const groups: Record<string, Array<{ id: string; base: string; price: number }>> = {};
  withBase.forEach((item) => {
    (groups[item.base] = groups[item.base] || []).push(item);
  });

  Object.keys(groups).forEach((base) => {
    const group = groups[base];
    const priceCounts: Record<string, number> = {};
    group.forEach((it) => {
      priceCounts[it.price] = (priceCounts[it.price] || 0) + 1;
    });
    const levels = [...new Set(group.map((it) => it.price))].sort((a, b) => a - b);

    group.forEach((it) => {
      if (priceCounts[it.price] > 1) {
        result[it.id] = `⚠️ ${it.base} ⚠️`;
      } else if (levels.length > 1) {
        const idx = levels.indexOf(it.price);
        const label = SIZING_LABELS[idx] || `XXL-${idx - 4}`;
        const suffix = levels.length === 2 ? ` (${idx === 0 ? 'SM' : 'LG'})` : ` (${label})`;
        result[it.id] = `${it.base}${suffix}`;
      } else {
        result[it.id] = it.base;
      }
    });
  });

  // A full package carries the box on its NAME as well as on its badge — see
  // FULL_PACKAGE_TITLE_PREFIX. Applied LAST, after the (SM)/(LG) and duplicate-price
  // disambiguation above, so the prefix decorates the finished title and can never
  // become part of a grouping key.
  //
  // ⚠️ A MANUAL rename is left alone: the rep chose that name, and prefixing it would
  // overwrite their wording. (Rename is not reachable in the dynamic deal center — its
  // tab menu offers only Duplicate/Delete — so this is a guard, not a live case.)
  tabs.forEach((t) => {
    const title = result[t.id];
    if (!title || t.manualTitle) return;
    if (title.startsWith(FULL_PACKAGE_TITLE_PREFIX)) return;
    if (!describeFullPackage(t.entries, schemas).isFullPackage) return;
    result[t.id] = `${FULL_PACKAGE_TITLE_PREFIX}${title}`;
  });

  return result;
}
