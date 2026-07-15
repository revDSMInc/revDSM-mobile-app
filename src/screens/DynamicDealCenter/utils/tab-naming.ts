/**
 * Schema-aware dynamic tab naming — mirrors the web deal center, which names a
 * calculator after the *products/components* whose fields have values (e.g.
 * "VMax", "Versa", "LF Misc", "G Misc"), NOT the category initials:
 *   - values in "Versa Max"             → VMax
 *   - values in "C-S-R" / LF extras     → LF Misc
 *   - values in "6\"/7\"/4\"&5\" Versa"  → Versa
 *   - values in gutters                 → G
 *   - values in gutter extras           → G Misc
 *   - values in Lighting 1st/2nd/3rd    → Light
 *   - values in Control Box / WiFi /    → Light Misc
 *     Booster Box / Electrical Outlet
 *   - values in Extra Labor             → Labor
 *   - values in Number of Screen        → Screens
 * so gutters + Versa Max + C-S-R reads "G+VMax+LF Misc" (matching web). Unlike
 * the regular deal center's `getPresentComponents`, the dynamic flow does NOT
 * suppress the "misc" components when a primary product is present — the web
 * shows every present component (e.g. VMax and LF Misc together), so this lists
 * them all, joined in a fixed display order.
 *
 * Detection is driven off each entry's field id / name / label, so it works
 * whether the backend keys a field by its stable regular key (`versaMaxFt1`,
 * `csr`, …) or only carries a human label ("Versa Max").
 *
 * Duplicate names are disambiguated by retail price with SM/MD/LG… suffixes, or
 * flagged "⚠️ base ⚠️" when two calculators share the same base name AND price.
 */

import type { CalculatorSchema, CalculatorEntry } from '../types/calculator';

const SIZING_LABELS = ['SM', 'MD', 'LG', 'XL', 'XXL', 'XXL-2', 'XXL-3', 'XXL-4', 'XXL-5'];

/**
 * Display order for the component parts. The dynamic deal center orders them by
 * the schema's on-screen CATEGORY order (Gutters → LeafFilter → Soffit → Fascia
 * → Lighting → Additional Services) — matching web, e.g. "Light+Light Misc+Labor
 * +Screens". (This differs from the regular deal center's ORDER, which lists
 * Labor before Lighting.)
 */
const COMPONENT_ORDER = [
  // Gutters
  'G',
  'G Misc',
  // LeafFilter
  'Versa',
  'VMax',
  'LF Misc',
  // Soffit
  'S',
  // Fascia
  'FWrap',
  'FBoard',
  'FAluminum',
  // Lighting
  'Light',
  'Light Misc',
  // Additional Services
  'Labor',
  'Screens',
];

/** Exact stable field keys → component, for schemas that key fields the regular way. */
const KEY_COMPONENT: Record<string, string> = {
  versaMaxFt1: 'VMax',
  versa6Ft1: 'Versa', versa6Ft2: 'Versa', versa6Ft3: 'Versa',
  versa7Ft1: 'Versa', versa7Ft2: 'Versa', versa7Ft3: 'Versa',
  filter45Ft1: 'Versa', filter45Ft2: 'Versa', filter45Ft3: 'Versa',
  gutter5DsE: 'G', gutter6Ft1: 'G', gutter7DsE: 'G',
  vinylSoffit: 'S', porchCeiling: 'S', nailerBuildOut: 'S',
  trimWrap: 'FWrap',
  fasciaBoard: 'FBoard',
  aluminumFasciaBoard: 'FAluminum',
  extraLabor: 'Labor',
  numberOfScreen: 'Screens', screens: 'Screens', numberOfScreens: 'Screens',
  cornersFilter: 'LF Misc', sawzallHanger: 'LF Misc', removeProtection: 'LF Misc',
  csr: 'LF Misc', ribbedRoof: 'LF Misc',
  wedges: 'G Misc', straps: 'G Misc', modifyHeight: 'G Misc', groundSpout: 'G Misc',
  replaceCorner: 'G Misc', extendedSplashGuard: 'G Misc', extendedSplashGuard032: 'G Misc',
  // Lighting stories → "Light"; lighting accessories → "Light Misc" (web parity).
  lighting1stStory: 'Light', lighting2ndStory: 'Light', lighting3rdStory: 'Light',
  lightingControlBox: 'Light Misc', controlBox: 'Light Misc',
  lightingWifiExtender: 'Light Misc', lightingBoosterBox: 'Light Misc', lightingElectricalOutlet: 'Light Misc',
  wifiExtender: 'Light Misc', boosterBox: 'Light Misc', electricalOutlet: 'Light Misc',
};

/**
 * Label-pattern → component fallback (order matters: more specific first —
 * "Versa Max" before "Versa", "Replace Corner" (G Misc) before the LF-Misc
 * "Corners", "Aluminum Fascia" before "Fascia Board").
 */
const LABEL_RULES: Array<{ test: RegExp; component: string }> = [
  { test: /versa\s*max|micro\s*mesh\s*special/i, component: 'VMax' },
  { test: /wedge|strap|ground\s*spout|modify\s*height|replace\s*corner|splash\s*guard/i, component: 'G Misc' },
  { test: /\bc[-\s]?s[-\s]?r\b|sawzall|remove\s*protection|ribbed\s*roof|corners?\s*filter/i, component: 'LF Misc' },
  { test: /versa|micro\s*mesh/i, component: 'Versa' },
  { test: /soffit|porch\s*ceiling|nailer/i, component: 'S' },
  // "Aluminum 2\"x2\" Fascia Board" — the size text between "Aluminum" and
  // "Fascia" breaks a simple `aluminum\s*fascia`, so match aluminum + fascia/board
  // loosely. Kept BEFORE the generic fascia-board rule so it wins.
  { test: /aluminum.*(fascia|board)/i, component: 'FAluminum' },
  { test: /fascia\s*board/i, component: 'FBoard' },
  { test: /trim\s*wrap/i, component: 'FWrap' },
  { test: /labor/i, component: 'Labor' },
  { test: /number\s*of\s*screen|screen/i, component: 'Screens' },
  // Lighting accessories (Control Box / WiFi Extender / Booster Box / Electrical
  // Outlet) carry no "light" text — match them explicitly, BEFORE the general
  // lighting rule, so they read "Light Misc" (web parity).
  { test: /control\s*box|wifi\s*extender|booster\s*box|electrical\s*outlet/i, component: 'Light Misc' },
  { test: /light/i, component: 'Light' },
  { test: /gutter/i, component: 'G' },
];

/** Resolve a single entry to its component name (or undefined). */
function entryToComponent(entry: CalculatorEntry): string | undefined {
  if (KEY_COMPONENT[entry.fieldId]) return KEY_COMPONENT[entry.fieldId];
  if (entry.name && KEY_COMPONENT[entry.name]) return KEY_COMPONENT[entry.name];
  const text = `${entry.label || ''} ${entry.name || ''}`;
  const rule = LABEL_RULES.find((r) => r.test.test(text));
  return rule?.component;
}

/**
 * Base name from the live entries map (keyed by field id). Collects every
 * present component and joins them in display order — no suppression, matching
 * web. `schemas` is accepted for signature parity but the naming is driven
 * purely by the entered values.
 */
export function getLiveSchemaBaseName(
  entries: Record<string, CalculatorEntry>,
  _schemas?: CalculatorSchema[]
): string {
  const present = new Set<string>();
  Object.values(entries || {}).forEach((entry) => {
    if (!entry || Number(entry.inputValue) <= 0) return;
    const component = entryToComponent(entry);
    if (component) present.add(component);
  });
  return COMPONENT_ORDER.filter((c) => present.has(c)).join('+');
}

export interface TabNameInput {
  id: string;
  entries: Record<string, CalculatorEntry>;
  /** retail total, used only to disambiguate same-named calculators */
  price: number;
  /** a manual (session) rename that overrides the derived name */
  manualTitle?: string;
}

/**
 * Computes the display title for every calculator: id → title.
 * Manual renames win; empty (no entries) calculators fall back to their 1-based
 * position; otherwise the schema-derived base name + collision suffix is used.
 */
export function computeDerivedTitles(tabs: TabNameInput[], schemas: CalculatorSchema[]): Record<string, string> {
  const result: Record<string, string> = {};
  const withBase: Array<{ id: string; base: string; price: number }> = [];

  tabs.forEach((t, i) => {
    if (t.manualTitle) {
      result[t.id] = t.manualTitle;
      return;
    }
    const base = getLiveSchemaBaseName(t.entries, schemas);
    if (!base) {
      result[t.id] = String(i + 1);
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

  return result;
}
