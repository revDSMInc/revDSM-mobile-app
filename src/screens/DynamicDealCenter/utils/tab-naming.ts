import type {
  CalculatorSchema,
  CalculatorEntry,
  CalculatorField,
  CalculatorCategory,
} from '../types/calculator';
import { getCategoryAllFields } from '../types/calculator';

const SIZING_LABELS = ['SM', 'MD', 'LG', 'XL', 'XXL', 'XXL-2', 'XXL-3', 'XXL-4', 'XXL-5'];

export function getCategoryInitials(categoryName?: string): string {
  if (!categoryName) return '';
  const words = categoryName
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 1) return words[0][0].toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join('');
}

const normalizeTabKey = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const CATEGORY_TAB_KEYS: Record<string, string> = {
  gutters: 'G',
  soffit: 'S',
  additionalservices: 'Labor',
  shingles: 'Shng',
  underlaymentmoisture: 'Und',
  ridgeventilation: 'Ridge',
  flashing: 'Flash',
  decking: 'Deck',
  tearoff: 'Tear',
  labor: 'Labor',
  singlehung: 'SH',
  doublehung: 'DH',
  casement: 'Cas',
  picturefixed: 'Pic',
  slider: 'Sldr',
  awning: 'Awn',
  assemblies: 'Assy',
  laborinstallation: 'Labor',
  materialsinstalled: 'Flr',
  carpetpad: 'Pad',
  removal: 'Demo',
  subfloorprep: 'Sub',
  baseboardstransitions: 'Trim',
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

const FIELD_TAB_KEYS: Record<string, string> = {
  trim_wrap_fascia: 'FWrap',
  fascia_board: 'FBoard',
  aluminum_2_x2_fascia_board: 'FAluminum',
  number_of_screen: 'Screens',
  screens: 'Screens',
  lighting_1st_story: 'Light',
  lighting_2nd_story: 'Light',
  lighting_3rd_story: 'Light',
  control_box: 'Light Misc',
  wifi_extender: 'Light Misc',
  booster_box_s: 'Light Misc',
  electrical_outlet: 'Light Misc',
};

const catGuardFlavor = (cat: CalculatorCategory): 'versa' | 'guard' => {
  const fields = getCategoryAllFields(cat) || [];
  if (fields.some((f) => /versa/i.test(f?.label || ''))) return 'versa';
  if (fields.some((f) => /micro\s*mesh|guard/i.test(f?.label || ''))) return 'guard';
  return 'versa'; // default keeps legacy "LF Misc" naming
};

const resolveGuardCategoryKey = (cat: CalculatorCategory, label?: string): string => {
  const l = (label || '').toLowerCase();
  if (/versa\s*max/.test(l)) return 'VMax';
  if (/versa/.test(l)) return 'Versa';
  if (/special/.test(l)) return 'SpecGuard';
  if (/micro\s*mesh|guard/.test(l)) return 'Guard';
  return catGuardFlavor(cat) === 'guard' ? 'GuardMisc' : 'LF Misc';
};

const GUTTER_ROOFLINE_RESOLVERS: Record<string, (label: string) => string> = {
  soffit: () => 'S',
  fascia: (label) =>
    /trim\s*wrap/i.test(label) ? 'FWrap' : /alumin/i.test(label) ? 'FAluminum' : 'FBoard',
  lighting: (label) => (/story/i.test(label) ? 'Light' : 'Light Misc'),
  additionalservices: (label) => (/screen/i.test(label) ? 'Screens' : 'Labor'),
};

export function resolveFieldTabKey(cat: CalculatorCategory, field: CalculatorField): string {
  const name = field?.name || '';
  const label = field?.label || '';
  const catName = normalizeTabKey(cat?.name || cat?.label);

  if (name && FIELD_TAB_KEYS[name]) return FIELD_TAB_KEYS[name];

  if (catName === 'leaffilter' || catName === 'gutterguards') {
    return resolveGuardCategoryKey(cat, label);
  }

  if (GUTTER_ROOFLINE_RESOLVERS[catName]) {
    return GUTTER_ROOFLINE_RESOLVERS[catName](label);
  }

  const catKey = CATEGORY_TAB_KEYS[catName];
  if (catKey) return catKey;
  return getCategoryInitials(cat?.name || cat?.label || '');
}

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

const MISC_KEY_PARENTS: Record<string, string[]> = {
  'LF Misc': ['Versa', 'VMax'],
  GuardMisc: ['Guard', 'SpecGuard'],
};

function suppressCoveredMiscKeys(parts: string[]): string[] {
  return parts.filter((key) => {
    const parents = MISC_KEY_PARENTS[key];
    return !parents || !parents.some((parent) => parts.includes(parent));
  });
}

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

const FULL_PACKAGE_REQUIRED_KEYS = ['G', 'S', 'FWrap'];
const FULL_PACKAGE_GUARD_KEYS = ['Versa', 'VMax', 'Guard', 'SpecGuard'];

export const FULL_PACKAGE_TITLE_PREFIX = '📦 +';

export const FULL_PACKAGE_INCLUDES = ['Gutter', 'Soffit', 'FWrap', '(Versa OR VMax)'];

export function isFullPackageSelection(
  entries: Record<string, CalculatorEntry>,
  schemas?: CalculatorSchema[]
): boolean {
  return describeFullPackage(entries, schemas).isFullPackage;
}

export interface FullPackageDescription {
  isFullPackage: boolean;
  extras: string;
}

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
    extras: parts.filter((key) => !consumed.has(key)).join('+'),
  };
}

export interface TabNameInput {
  id: string;
  entries: Record<string, CalculatorEntry>;
  price: number;
  manualTitle?: string;
  storedTitle?: string;
  originalTitle?: string;
}

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

  tabs.forEach((t) => {
    const title = result[t.id];
    if (!title || t.manualTitle) return;
    if (title.startsWith(FULL_PACKAGE_TITLE_PREFIX)) return;
    if (!describeFullPackage(t.entries, schemas).isFullPackage) return;
    result[t.id] = `${FULL_PACKAGE_TITLE_PREFIX}${title}`;
  });

  return result;
}
