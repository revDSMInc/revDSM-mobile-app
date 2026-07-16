// ─── dynamic-inspection-schema-utils.ts ──────────────────────────────────────
// Pure helpers for the DYNAMIC inspection photos flow (sales side, mobile).
// A 1:1 TypeScript port of the web reference
//   src/sections/job/components/dynamic-inspection-photos/dynamic-schema-utils.js
//
// A product's inspection photo schema is a tree of `categories`. Each category's
// `type` decides WHERE its capturable slots live:
//   compass-grid     -> category.slots        [{ id, name, allowMultiple, row, col }]
//   flat-list        -> category.options      ["Front", "Back", ...]
//   grouped-list     -> category.groups       [{ title, items: [...] }]
//   context-selector -> category.contextLevels + category.contextSlots
//   tab-bar / dynamic-sub-tabs / chip-selector -> category.children (container)
//
// Every capturable slot round-trips through the existing salesPhotos backend via
// (category label, storageName) — no schema-specific storage.
// ─────────────────────────────────────────────────────────────────────────────

export interface InspectionSlot {
  id: string;
  name: string;
  storageName: string;
  allowMultiple?: boolean;
  group?: string;
  row?: number;
  col?: number;
  key?: string;
  isExtra?: boolean;
}

export interface InspectionCategory {
  id: string;
  label: string;
  icon?: string | null;
  type?: string;
  slots?: any[];
  options?: any[];
  groups?: { title?: string; items?: any[] }[];
  children?: InspectionCategory[];
  contextLevels?: { key: string; label: string; options?: string[] }[];
  contextSlots?: string[];
  allowDynamicAdd?: boolean;
  allowNewContextInstance?: boolean;
  newInstanceLabel?: string;
  photosPerSlot?: number;
  cardinality?: string;
  maxPhotos?: number;
  topLabel?: string;
  centerLabel?: string;
  bottomLabel?: string;
  path?: string[];
  [key: string]: any;
}

export interface InspectionProduct {
  id: string | null;
  name: string;
  icon: string | null;
  color: string | null;
  schemaId: string | null;
  categories: InspectionCategory[];
  hasSchema: boolean;
  raw: any;
}

const CONTAINER_TYPES = ['tab-bar', 'dynamic-sub-tabs', 'chip-selector'];

export const getChildren = (category?: InspectionCategory | null): InspectionCategory[] =>
  Array.isArray(category?.children) ? (category!.children as InspectionCategory[]) : [];

export const getSlots = (category?: InspectionCategory | null): any[] =>
  Array.isArray(category?.slots) ? (category!.slots as any[]) : [];

export const isContextSelector = (category?: InspectionCategory | null): boolean =>
  category?.type === 'context-selector';

export const isContainer = (category?: InspectionCategory | null): boolean =>
  getChildren(category).length > 0 || CONTAINER_TYPES.includes(category?.type as string);

/** True when the rep may tag photos beyond the predefined slots. */
export const allowsExtras = (category?: InspectionCategory | null): boolean =>
  !!category?.allowDynamicAdd;

export const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

/** Stable UI key (drives preview/uploading state — NOT storage). */
export const uiKey = (categoryId: string, slotId: string): string => `${categoryId}::${slotId}`;

/** Slot id for an ad-hoc "extra" slot. */
export const extraSlotId = (name: string): string => `extra::${name}`;

/**
 * Normalise a leaf category's capturable slots into a common shape regardless of
 * its type: { id, name, storageName, group?, allowMultiple? }.
 */
export function getCapturableSlots(category?: InspectionCategory | null): InspectionSlot[] {
  if (!category) return [];
  const { type } = category;

  if (type === 'compass-grid') {
    return getSlots(category).map((s: any) => ({
      id: s.id,
      name: s.name,
      storageName: s.name,
      allowMultiple: !!s.allowMultiple,
      row: s.row,
      col: s.col,
    }));
  }

  if (type === 'flat-list') {
    return (Array.isArray(category.options) ? category.options : []).map((opt: any) => ({
      id: String(opt),
      name: String(opt),
      storageName: String(opt),
    }));
  }

  if (type === 'grouped-list') {
    const out: InspectionSlot[] = [];
    (Array.isArray(category.groups) ? category.groups : []).forEach((g: any) => {
      (Array.isArray(g.items) ? g.items : []).forEach((item: any) => {
        out.push({
          id: `${g.title}::${item}`,
          name: String(item),
          group: g.title || '',
          storageName: `${g.title ? `${g.title} — ` : ''}${item}`,
        });
      });
    });
    return out;
  }

  // Fallback: some categories carry `slots` without an explicit compass type.
  if (getSlots(category).length > 0) {
    return getSlots(category).map((s: any) => ({
      id: s.id,
      name: s.name,
      storageName: s.name,
      allowMultiple: !!s.allowMultiple,
    }));
  }

  return [];
}

/** Photos a single slot may hold. */
export const slotCapacity = (category?: InspectionCategory | null, slot?: InspectionSlot | null): number => {
  const perSlot = Number(category?.photosPerSlot) > 0 ? Number(category!.photosPerSlot) : 1;
  // A slot flagged allowMultiple has no fixed cap.
  if (slot?.allowMultiple) return Infinity;
  if (category?.type === 'flat-list' && category?.cardinality === 'multiple') {
    return Math.max(Number(category.maxPhotos) || 1, 1);
  }
  return perSlot;
};

/** Does this category (a leaf) offer anything to capture? */
export function categoryHasCapturable(category?: InspectionCategory | null): boolean {
  if (!category) return false;
  if (isContextSelector(category)) {
    return (Array.isArray(category.contextSlots) ? category.contextSlots.length : 0) > 0;
  }
  if (getCapturableSlots(category).length > 0) return true;
  return allowsExtras(category);
}

/** Deep: does any category in the tree offer something to capture? */
export function hasCapturable(categories?: InspectionCategory[]): boolean {
  return (Array.isArray(categories) ? categories : []).some((c) => {
    if (isContainer(c)) return hasCapturable(getChildren(c));
    return categoryHasCapturable(c);
  });
}

export interface SchemaIndex {
  leafCategories: InspectionCategory[];
  labelSet: Set<string>;
  definedNamesByLabel: Map<string, Set<string>>;
}

/** Index the tree for fast loading/matching. */
export function indexSchema(categories: InspectionCategory[] = []): SchemaIndex {
  const leafCategories: InspectionCategory[] = [];
  const labelSet = new Set<string>();
  const definedNamesByLabel = new Map<string, Set<string>>();

  const walk = (category: InspectionCategory | undefined, ancestors: string[]) => {
    if (!category) return;
    const path = [...ancestors, category.label].filter(Boolean) as string[];

    if (isContainer(category)) {
      getChildren(category).forEach((child) => walk(child, path));
      return;
    }

    if (!categoryHasCapturable(category)) return;

    const decorated = { ...category, path };
    leafCategories.push(decorated);
    labelSet.add(norm(category.label));

    const names = new Set<string>();
    getCapturableSlots(category).forEach((s) => names.add(norm(s.storageName)));
    definedNamesByLabel.set(norm(category.label), names);
  };

  (Array.isArray(categories) ? categories : []).forEach((c) => walk(c, []));

  return { leafCategories, labelSet, definedNamesByLabel };
}

/** Next sequential "Extra N" label given the existing extras for a category. */
export function nextExtraLabel(existingExtras: InspectionSlot[] = []): string {
  return `Extra ${existingExtras.length + 1}`;
}

/**
 * Top-level categories to show as tabs. Unwraps a single root container (the
 * admin's root tab-bar) so its children become the tabs.
 */
export function getTopTabs(categories: InspectionCategory[] = []): InspectionCategory[] {
  const list = Array.isArray(categories) ? categories : [];
  if (list.length === 1 && isContainer(list[0])) return getChildren(list[0]);
  return list;
}

export interface CaptureCountApi {
  getPhotos: (label: string, storageName: string) => any[];
  countUnderLabel: (label: string) => number;
  extrasFor?: (category: InspectionCategory) => InspectionSlot[];
}

/** { filled, total } photo-slot counts for a category (recursive for containers). */
export function countCategory(
  category: InspectionCategory,
  capture: CaptureCountApi
): { filled: number; total: number } {
  if (isContainer(category)) {
    return getChildren(category).reduce(
      (acc, child) => {
        const r = countCategory(child, capture);
        return { filled: acc.filled + r.filled, total: acc.total + r.total };
      },
      { filled: 0, total: 0 }
    );
  }

  if (isContextSelector(category)) {
    const total = Array.isArray(category.contextSlots) ? category.contextSlots.length : 0;
    const filled = Math.min(capture.countUnderLabel(category.label), total || Infinity);
    return {
      filled: Number.isFinite(filled) ? filled : capture.countUnderLabel(category.label),
      total,
    };
  }

  const slots = getCapturableSlots(category);
  const extras = capture.extrasFor ? capture.extrasFor(category) : [];
  let filled = 0;
  [...slots, ...extras].forEach((s) => {
    if (capture.getPhotos(category.label, s.storageName).length > 0) filled += 1;
  });
  return { filled, total: slots.length + extras.length };
}

/** Leaf (or self) category that receives an extra photo when tagging as extra. */
export function resolveExtraTargetCategory(tab?: InspectionCategory | null): InspectionCategory | null {
  if (!tab) return null;
  if (allowsExtras(tab)) return tab;
  const leaves = indexSchema([tab]).leafCategories;
  return leaves.find((lc) => allowsExtras(lc)) || null;
}

export interface ExtraPickerCategory {
  id: string;
  label: string;
  icon: string;
  category: InspectionCategory;
}

/** Top capture tabs eligible for the extra picker. */
export function getExtraPickerCategories(tabs: InspectionCategory[] = []): ExtraPickerCategory[] {
  const list = Array.isArray(tabs) ? tabs : [];
  return list
    .map((tab): ExtraPickerCategory | null => {
      const category = resolveExtraTargetCategory(tab);
      if (!category) return null;
      return {
        id: tab.id,
        label: tab.label,
        icon: (tab.icon as string) || 'image-outline',
        category,
      };
    })
    .filter(Boolean) as ExtraPickerCategory[];
}
