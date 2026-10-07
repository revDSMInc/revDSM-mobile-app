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
const UNWRAP_ROOT_TYPES = ['tab-bar', 'dynamic-sub-tabs'];

export const SCOPE_SEP = ' · ';

export const getChildren = (category?: InspectionCategory | null): InspectionCategory[] =>
  Array.isArray(category?.children) ? (category!.children as InspectionCategory[]) : [];

export const getSlots = (category?: InspectionCategory | null): any[] =>
  Array.isArray(category?.slots) ? (category!.slots as any[]) : [];

export const isContextSelector = (category?: InspectionCategory | null): boolean =>
  category?.type === 'context-selector';

export const isChipSelector = (category?: InspectionCategory | null): boolean =>
  category?.type === 'chip-selector';

export const getChipOptions = (category?: InspectionCategory | null): string[] =>
  (Array.isArray(category?.options) ? category!.options : []).map((o: any) => String(o));

export const isChipContainer = (category?: InspectionCategory | null): boolean =>
  isChipSelector(category) && getChildren(category).length > 0;

export const isTabContainer = (category?: InspectionCategory | null): boolean =>
  category?.type === 'tab-bar' || category?.type === 'dynamic-sub-tabs';

export const getChipLabel = (category?: InspectionCategory | null): string =>
  (category?.chipLabel != null && String(category.chipLabel).trim()) || category?.label || '';

export const usesPerChipContent = (category?: InspectionCategory | null): boolean =>
  isChipSelector(category) && !!category?.perChipContent && getChildren(category).length > 0;

export const isContainer = (category?: InspectionCategory | null): boolean =>
  getChildren(category).length > 0 || CONTAINER_TYPES.includes(category?.type as string);

export const allowsExtras = (category?: InspectionCategory | null): boolean =>
  !!category?.allowDynamicAdd;

export const norm = (v: unknown): string => String(v ?? '').trim().toLowerCase();

export const uiKey = (categoryId: string, slotId: string): string => `${categoryId}::${slotId}`;

export const extraSlotId = (name: string): string => `extra::${name}`;

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

function capturableBase(category?: InspectionCategory | null): InspectionSlot[] {
  if (!category) return [];
  const { type } = category;

  if (type === 'chip-selector') {
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

export function getCapturableSlots(category?: InspectionCategory | null): InspectionSlot[] {
  if (!category) return [];
  return applyScope(category._scope, capturableBase(category));
}

export const slotCapacity = (category?: InspectionCategory | null, slot?: InspectionSlot | null): number => {
  const perSlot = Number(category?.photosPerSlot) > 0 ? Number(category!.photosPerSlot) : 1;
  if (slot?.allowMultiple) return Infinity;
  if (category?.type === 'flat-list' && category?.cardinality === 'multiple') {
    return Math.max(Number(category.maxPhotos) || 1, 1);
  }
  if (category?.type === 'chip-selector' && category?.cardinality === 'multiple') {
    return Math.max(Number(category.maxPhotos) || 1, 1);
  }
  return perSlot;
};

export function categoryHasCapturable(category?: InspectionCategory | null): boolean {
  if (!category) return false;
  if (isContextSelector(category)) {
    return (Array.isArray(category.contextSlots) ? category.contextSlots.length : 0) > 0;
  }
  if (getCapturableSlots(category).length > 0) return true;
  return allowsExtras(category);
}

export function hasCapturable(categories?: InspectionCategory[]): boolean {
  return (Array.isArray(categories) ? categories : []).some((c) => {
    if (isContainer(c) && getChildren(c).length > 0) return hasCapturable(getChildren(c));
    return categoryHasCapturable(c);
  });
}

export interface SchemaIndex {
  leafCategories: InspectionCategory[];
  labelSet: Set<string>;
  definedNamesByLabel: Map<string, Set<string>>;
}

export function indexSchema(categories: InspectionCategory[] = []): SchemaIndex {
  const leafCategories: InspectionCategory[] = [];
  const labelSet = new Set<string>();
  const definedNamesByLabel = new Map<string, Set<string>>();

  const walk = (category: InspectionCategory | undefined, ancestors: string[], scope: string[]) => {
    if (!category) return;
    const path = [...ancestors, category.label].filter(Boolean) as string[];

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

    if (categoryHasCapturable(category)) {
      const decorated = { ...category, path, _scope: scope };
      leafCategories.push(decorated);
      labelSet.add(norm(category.label));

      const names = definedNamesByLabel.get(norm(category.label)) || new Set<string>();
      getCapturableSlots(decorated).forEach((s) => names.add(norm(s.storageName)));
      definedNamesByLabel.set(norm(category.label), names);
    }

    if (getChildren(category).length > 0 && !isChipSelector(category)) {
      getChildren(category).forEach((child) => walk(child, path, scope));
    }
  };

  (Array.isArray(categories) ? categories : []).forEach((c) => walk(c, [], []));

  return { leafCategories, labelSet, definedNamesByLabel };
}

export function nextExtraLabel(existingExtras: InspectionSlot[] = []): string {
  return `Extra ${existingExtras.length + 1}`;
}

export function getTopTabs(categories: InspectionCategory[] = []): InspectionCategory[] {
  const list = Array.isArray(categories) ? categories : [];
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

  const decorated = scope.length ? { ...category, _scope: scope } : category;
  const slots = getCapturableSlots(decorated);
  const extras = capture.extrasFor ? capture.extrasFor(category) : [];
  let filled = 0;
  [...slots, ...extras].forEach((s) => {
    if (capture.getPhotos(category.label, s.storageName).length > 0) filled += 1;
  });
  let result = { filled, total: slots.length + extras.length };

  if (getChildren(category).length > 0 && !isChipSelector(category)) {
    getChildren(category).forEach((child) => {
      result = add(result, countCategory(child, capture, scope));
    });
  }
  return result;
}

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
