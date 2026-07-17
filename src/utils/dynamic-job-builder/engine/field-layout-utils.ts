export const STICKY_POSITIONS = [
  { value: 'none', label: 'None' },
  { value: 'top', label: 'Sticky to Top' },
  { value: 'bottom', label: 'Sticky to Bottom' },
];

export const ALLOCATION_GRID_COLUMN_OPTIONS = [1, 2, 3, 4];

export const FIELD_GRID_COLUMN_OPTIONS = [1, 2, 3];

export function sectionShowsBorder(section: any) {
  return section?.bordered !== false;
}

export function getEffectiveBorderColor(config: any) {
  return config?.borderColor || undefined;
}

export function getWarningConfig(config: any) {
  const warning = config?.warningConfig;
  if (!warning?.enabled || !warning?.message) return null;
  return {
    message: warning.message,
    color: warning.color || '#f59e0b',
    visibleWhen: warning.visibleWhen || null,
  };
}

export const OPTION_GRID_COLUMN_OPTIONS = [0, 1, 2, 3, 4];

export function getOptionGridSize(columns: number | undefined | null, { legacyStackedDefault = false } = {}) {
  if (columns === undefined || columns === null) {
    return legacyStackedDefault ? 12 : undefined;
  }
  const normalized = Number(columns);
  if (!Number.isFinite(normalized) || normalized <= 0) return undefined;
  const map: Record<number, number> = { 1: 12, 2: 6, 3: 4, 4: 3 };
  return map[normalized];
}

export function resolveStickyPosition(field: any, legacySticky = false) {
  if (field?.stickyPosition && field.stickyPosition !== 'none') {
    return field.stickyPosition;
  }
  if (legacySticky) return 'top';
  return 'none';
}

export function getStickySx(stickyPosition: string) {
  if (stickyPosition === 'top') {
    return { position: 'sticky' as const, top: 8, zIndex: 10, paddingTop: 4 };
  }
  if (stickyPosition === 'bottom') {
    return { position: 'sticky' as const, bottom: 0, zIndex: 10 };
  }
  return null;
}

export function resolveSectionStickyPosition(section: any) {
  return resolveStickyPosition(section);
}

export function getSectionStickySx(section: any) {
  const stickySx = getStickySx(resolveSectionStickyPosition(section));
  if (!stickySx) return null;

  return {
    ...stickySx,
    backgroundColor: '#ffffff',
  };
}

export function getAllocationGridColumns(layoutConfig: any = {}) {
  const columns = Number(
    layoutConfig.allocationGridColumns ?? layoutConfig?.allocationLayout?.columns
  );
  if (!Number.isFinite(columns) || columns < 2) return 1;
  return Math.min(Math.round(columns), 4);
}

function allocationGridGcd(a: number, b: number) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

function allocationGridLcm(a: number, b: number) {
  return (a * b) / allocationGridGcd(a, b);
}

export function getAllocationGridFineColumns(visibleCount: number, columns: number) {
  if (visibleCount <= 0 || columns <= 1) return columns;

  const remainder = visibleCount % columns;
  if (remainder === 0) return columns;

  return allocationGridLcm(columns, remainder);
}

export function getAllocationGridRowItemCount(rowIndex: number, visibleCount: number, columns: number) {
  const remainder = visibleCount % columns;
  const totalRows = Math.ceil(visibleCount / columns);
  const isLastRow = rowIndex === totalRows - 1;

  if (isLastRow && remainder !== 0) return remainder;
  return columns;
}

export function getAllocationGridItemSpan(index: number, visibleCount: number, columns: number) {
  if (visibleCount <= 0 || columns <= 1) return 1;

  const fineColumns = getAllocationGridFineColumns(visibleCount, columns);
  const rowIndex = Math.floor(index / columns);
  const itemsInRow = getAllocationGridRowItemCount(rowIndex, visibleCount, columns);

  return fineColumns / itemsInRow;
}

export function getAllocationGridSx(columns: number, visibleCount = 0) {
  if (columns <= 1) return null;

  const fineColumns =
    visibleCount > 0 ? getAllocationGridFineColumns(visibleCount, columns) : columns;

  return {
    display: 'grid' as const,
    gridTemplateColumns: `repeat(${fineColumns}, minmax(0, 1fr))`,
    gap: 12,
    width: '100%' as const,
    marginTop: 8,
    marginBottom: 16,
  };
}

export function getAllocationGridItemSx(index: number, visibleCount: number, columns: number) {
  const baseSx = { minWidth: 0, width: '100%' as const };

  if (visibleCount <= 0 || columns <= 1) return baseSx;

  const span = getAllocationGridItemSpan(index, visibleCount, columns);
  if (span <= 1) return baseSx;

  return {
    ...baseSx,
    gridColumn: `span ${span}`,
  };
}

export function groupFieldBlocksForLayout(blocks: any[] = []) {
  const grouped: any[] = [];
  let allocationRun: any[] = [];

  const flushAllocations = () => {
    if (!allocationRun.length) return;
    grouped.push({ type: 'allocationGroup', blocks: allocationRun });
    allocationRun = [];
  };

  blocks.forEach((block) => {
    if (block.type === 'allocation') {
      allocationRun.push(block);
      return;
    }
    flushAllocations();
    grouped.push(block);
  });

  flushAllocations();
  return grouped;
}

export function getFieldGridColumns(layoutConfig: any = {}) {
  const columns = Number(
    layoutConfig.fieldGridColumns ?? layoutConfig.columns
  );
  if (!Number.isFinite(columns) || columns < 2) return 1;
  return Math.min(Math.round(columns), 3);
}

/**
 * Resolve the portal "Mobile Layout" setting to a column count for the `xs`
 * breakpoint. Returns null when unset or stacked (1) so callers keep their own
 * default — nothing changes for existing schemas.
 * Port of web `field-layout-utils.js` `resolveMobileGridColumns`.
 */
export function resolveMobileGridColumns(mobileColumns: any): number | null {
  const normalized = Number(mobileColumns);
  if (!Number.isFinite(normalized) || normalized < 2) return null;
  return Math.min(Math.round(normalized), 3);
}

export function getFieldGridSx(columns: number) {
  if (columns <= 1) return null;
  return {
    display: 'grid' as const,
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    gap: 12,
  };
}
