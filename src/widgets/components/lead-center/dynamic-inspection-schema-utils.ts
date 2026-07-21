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
// Only these container types are unwrapped when they are the sole root category
// (the admin's root tab bar). A chip-selector root must stay a real tab so its
// chips render in the body. Web parity (dynamic-schema-utils.js:27).
const UNWRAP_ROOT_TYPES = ['tab-bar', 'dynamic-sub-tabs'];

/** Separator that encodes a chip selection into a scoped storage name / id.
 *  Web parity (dynamic-schema-utils.js:30) — a chip selection is embedded in the
 *  photo's `subcategory` so each chip owns its own photos with NO new server storage. */
export const SCOPE_SEP = ' · ';

export const getChildren = (category?: InspectionCategory | null): InspectionCategory[] =>
  Array.isArray(category?.children) ? (category!.children as InspectionCategory[]) : [];

export const getSlots = (category?: InspectionCategory | null): any[] =>
  Array.isArray(category?.slots) ? (category!.slots as any[]) : [];

export const isContextSelector = (category?: InspectionCategory | null): boolean =>
  category?.type === 'context-selector';

export const isChipSelector = (category?: InspectionCategory | null): boolean =>
  category?.type === 'chip-selector';

/** Chip labels of a chip-selector (its `options`). */
export const getChipOptions = (category?: InspectionCategory | null): string[] =>
  (Array.isArray(category?.options) ? category!.options : []).map((o: any) => String(o));

/** A chip-selector that behaves as a SELECTOR (picking a chip reveals children).
 *  A chip-selector with no children is a plain slot list, not a selector. */
export const isChipContainer = (category?: InspectionCategory | null): boolean =>
  isChipSelector(category) && getChildren(category).length > 0;

/** Tab-style container: its children render as switchable tabs. */
export const isTabContainer = (category?: InspectionCategory | null): boolean =>
  category?.type === 'tab-bar' || category?.type === 'dynamic-sub-tabs';

/** Header shown above a chip row: dedicated `chipLabel`, else the category name. */
export const getChipLabel = (category?: InspectionCategory | null): string =>
  (category?.chipLabel != null && String(category.chipLabel).trim()) || category?.label || '';

/** A chip-selector whose CHILDREN are the chips — each child is one chip carrying
 *  its own (per-chip distinct) content. Otherwise the chips are the string `options`
 *  and any children are shared beneath every chip (legacy). */
export const usesPerChipContent = (category?: InspectionCategory | null): boolean =>
  isChipSelector(category) && !!category?.perChipContent && getChildren(category).length > 0;

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
 * Apply a chip scope (ordered list of chosen chip labels) to a leaf's base slots:
 * the storage name is prefixed so each chip owns its own photos, and the id is made
 * scope-unique so per-slot UI state never collides across chips. Web parity
 * (dynamic-schema-utils.js:87).
 */
function applyScope(scope: any, base: InspectionSlot[]): InspectionSlot[] {
  const list = Array.isArray(scope) ? scope.filter((v) => v != null && String(v) !== '') : [];
  if (list.length === 0 || base.length === 0) return base;
  const namePrefix = list.join(SCOPE_SEP);
  const idPrefix = list.join('||');
  return base.map((s) => ({
    ...s,
    id: `${idPrefix}::${s.id}`,
    storageName: `${namePrefix}${SCOPE_SEP}${s.storageName}`,
  }));
}

/** A leaf's base (unscoped) capturable slots by type. */
function capturableBase(category?: InspectionCategory | null): InspectionSlot[] {
  if (!category) return [];
  const { type } = category;

  if (type === 'chip-selector') {
    // A chip-selector WITH children is a selector — its chips aren't slots.
    if (getChildren(category).length > 0) return [];
    return getChipOptions(category).map((opt) => ({
      id: String(opt),
      name: String(opt),
      storageName: String(opt),
    }));
  }

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

/**
 * Normalise a leaf category's capturable slots into a common shape regardless of
 * its type: { id, name, storageName, group?, allowMultiple? }. If the category
 * carries a chip scope (`_scope`, set during indexing/rendering under a
 * chip-selector), the storage names are prefixed by that scope so each chip owns
 * its own photos. Web parity (dynamic-schema-utils.js:168).
 */
export function getCapturableSlots(category?: InspectionCategory | null): InspectionSlot[] {
  if (!category) return [];
  return applyScope(category._scope, capturableBase(category));
}

/** Photos a single slot may hold. */
export const slotCapacity = (category?: InspectionCategory | null, slot?: InspectionSlot | null): number => {
  const perSlot = Number(category?.photosPerSlot) > 0 ? Number(category!.photosPerSlot) : 1;
  // A slot flagged allowMultiple has no fixed cap.
  if (slot?.allowMultiple) return Infinity;
  if (category?.type === 'flat-list' && category?.cardinality === 'multiple') {
    return Math.max(Number(category.maxPhotos) || 1, 1);
  }
  if (category?.type === 'chip-selector' && category?.cardinality === 'multiple') {
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
    // A childless chip-selector is itself capturable (its chips ARE the slots), so
    // only recurse containers that actually have children. Web parity (:199).
    if (isContainer(c) && getChildren(c).length > 0) return hasCapturable(getChildren(c));
    return categoryHasCapturable(c);
  });
}

export interface SchemaIndex {
  leafCategories: InspectionCategory[];
  labelSet: Set<string>;
  definedNamesByLabel: Map<string, Set<string>>;
}

/**
 * Index the tree for fast loading/matching. Web parity (dynamic-schema-utils.js:216):
 *  - a chip-selector WITH children is fanned out into one scoped branch per chip
 *    (each descendant leaf appears once per chip, `_scope` = chosen chip labels);
 *  - a category may own capturable slots AND carry sub-categories (composite) — both
 *    are indexed;
 *  - leaves carry a display `path` and a `_scope` array.
 */
export function indexSchema(categories: InspectionCategory[] = []): SchemaIndex {
  const leafCategories: InspectionCategory[] = [];
  const labelSet = new Set<string>();
  const definedNamesByLabel = new Map<string, Set<string>>();

  const walk = (category: InspectionCategory | undefined, ancestors: string[], scope: string[]) => {
    if (!category) return;
    const path = [...ancestors, category.label].filter(Boolean) as string[];

    // Chip-selector with children = selector: fan out one scoped branch per chip.
    if (isChipContainer(category)) {
      const kids = getChildren(category);
      if (usesPerChipContent(category)) {
        kids.forEach((child) => walk(child, path, [...scope, child.label]));
      } else {
        getChipOptions(category).forEach((opt) => {
          kids.forEach((child) => walk(child, [...path, opt], [...scope, opt]));
        });
      }
      return;
    }

    // A category may own capturable slots (compass/grouped/flat/chip-no-children)
    // AND still carry sub-categories — index both.
    if (categoryHasCapturable(category)) {
      const decorated = { ...category, path, _scope: scope };
      leafCategories.push(decorated);
      labelSet.add(norm(category.label));

      const names = definedNamesByLabel.get(norm(category.label)) || new Set<string>();
      getCapturableSlots(decorated).forEach((s) => names.add(norm(s.storageName)));
      definedNamesByLabel.set(norm(category.label), names);
    }

    // Recurse sub-categories (tab-bar children, or a leaf's extra sub-sections).
    if (getChildren(category).length > 0 && !isChipSelector(category)) {
      getChildren(category).forEach((child) => walk(child, path, scope));
    }
  };

  (Array.isArray(categories) ? categories : []).forEach((c) => walk(c, [], []));

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
  // Unwrap ONLY a root tab container — a chip-selector root must stay so its chips
  // render in the body (web parity, getTopTabs:276).
  if (
    list.length === 1 &&
    UNWRAP_ROOT_TYPES.includes(list[0]?.type as string) &&
    getChildren(list[0]).length > 0
  ) {
    return getChildren(list[0]);
  }
  return list;
}

export interface CaptureCountApi {
  getPhotos: (label: string, storageName: string) => any[];
  countUnderLabel: (label: string) => number;
  extrasFor?: (category: InspectionCategory) => InspectionSlot[];
}

/**
 * { filled, total } photo-slot counts for a category (recursive for containers),
 * used for tab badges. `scope` carries the chip selections of any chip-selector
 * ancestors. Web parity (dynamic-schema-utils.js:293).
 */
export function countCategory(
  category: InspectionCategory,
  capture: CaptureCountApi,
  scope: string[] = []
): { filled: number; total: number } {
  const add = (a: { filled: number; total: number }, b: { filled: number; total: number }) => ({
    filled: a.filled + b.filled,
    total: a.total + b.total,
  });
  const ZERO = { filled: 0, total: 0 };

  // Chip-selector selector: count every chip's branch (all chips, scoped).
  if (isChipContainer(category)) {
    const kids = getChildren(category);
    if (usesPerChipContent(category)) {
      return kids.reduce((acc, child) => add(acc, countCategory(child, capture, [...scope, child.label])), ZERO);
    }
    return getChipOptions(category).reduce(
      (acc, opt) => add(acc, kids.reduce((a, child) => add(a, countCategory(child, capture, [...scope, opt])), ZERO)),
      ZERO
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

  // This category's OWN slots …
  const decorated = scope.length ? { ...category, _scope: scope } : category;
  const slots = getCapturableSlots(decorated);
  const extras = capture.extrasFor ? capture.extrasFor(category) : [];
  let filled = 0;
  [...slots, ...extras].forEach((s) => {
    if (capture.getPhotos(category.label, s.storageName).length > 0) filled += 1;
  });
  let result = { filled, total: slots.length + extras.length };

  // … plus any sub-categories (tab-bar children or a leaf's extra sub-sections).
  if (getChildren(category).length > 0 && !isChipSelector(category)) {
    getChildren(category).forEach((child) => {
      result = add(result, countCategory(child, capture, scope));
    });
  }
  return result;
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
