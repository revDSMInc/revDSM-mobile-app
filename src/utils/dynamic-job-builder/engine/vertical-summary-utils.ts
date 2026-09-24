import {
  getTabSections,
  getCombinationDisplayNumber,
  getCombinationSectionHeaderFields,
  getFlattenedCombinationSectionRowFields,
  isSectionScopedCombinationField,
} from './combination-utils';
import { isAllocationField, isFieldLocked, resolveLockedValue } from './allocation-utils';
import { isPairedQuantityEmpty } from './locked-color-defaults';
import { isComboHiddenInDealEdit } from './combination-color-filter';
import {
  evaluateRuleGroup,
  isFieldVisibleWithConditions,
  resolveConditionalDefault,
} from './dependency-engine';
import {
  formatComboFieldSummaryValue,
  getSectionSummaryField,
  resolveGrandTotalColumns,
  shouldIncludeSectionInTabSummary,
} from './grand-total-utils';
import { isCombinationSummaryField, isContainerFieldType } from '../constants/field-types';
import { getFieldGridColumns } from './field-layout-utils';
import { resolveLocationGridConfig } from './location-grid-utils';
import { resolveSchemaColor } from '../../../screens/DynamicDealCenter/utils/icon-color';
import { stateHasContent, collectLockedFieldIds } from './empty-step-gate';

// Web's `theme.palette.primary.main` — the fallback `resolveSchemaColorValue` uses.
const PALETTE_PRIMARY = '#4CBB17';

// Web `PRODUCT_UI_COLORS` (product-catalog-utils.js) — the index fallback must be
// the SAME list in the SAME order, or tab N falls back to a different colour than web.
const PRODUCT_PALETTE_COLORS = ['#22c55e', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899'];

const SKIPPED_FIELD_TYPES = new Set(['sectionLabel', 'combinationSummary', 'allocation']);
const LABELED_SELECTION_TYPES = new Set(['toggle', 'optionList', 'dropdown']);

// ─── Color resolution ─────────────────────────────────────────────────────────

function normalizeComparableName(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
}

/** Web `findProductForVertical` (product-catalog-utils.js). */
function findProductForVertical(vertical: any, products: any[] = []) {
  const verticalProductId = String(vertical?.productId || vertical?.id || '');
  if (!verticalProductId) return null;
  return (products || []).find((product: any) => String(product?.id) === verticalProductId) || null;
}

/** Web `findSchemasForVertical` (vertical-summary-utils.js). */
function findSchemasForVertical(vertical: any, schemas: any[] = []) {
  const verticalProductId = String(vertical?.productId || vertical?.id || '');
  const verticalLabel = normalizeComparableName(vertical?.label);

  const matched = (schemas || []).filter((schema: any) => {
    const schemaId = String(schema?.id || schema?._id || '');
    const schemaName = normalizeComparableName(schema?.name || schema?.label || schema?.product);
    return (
      (verticalProductId && schemaId && verticalProductId === schemaId) ||
      (verticalLabel &&
        schemaName &&
        (verticalLabel === schemaName ||
          verticalLabel.includes(schemaName) ||
          schemaName.includes(verticalLabel)))
    );
  });

  return matched.length ? matched : schemas || [];
}

/** Web `extractAllCategories` (calculator-items-format-util.js). */
function extractAllCategories(schemasOrCategories: any[]): any[] {
  if (!Array.isArray(schemasOrCategories) || schemasOrCategories.length === 0) return [];

  const first = schemasOrCategories[0];
  if (first?.calculatorFormSchema || Array.isArray(first?.categories)) {
    const allCategories: any[] = [];
    schemasOrCategories.forEach((schema: any) => {
      const cats = schema.calculatorFormSchema?.categories || schema.categories || [];
      cats.forEach((cat: any) => allCategories.push({ ...cat, _productName: schema.name || '' }));
    });
    return allCategories;
  }
  return schemasOrCategories;
}

/**
 * Web `findTabCategoryColorFromSchemas`. Matches the TAB (e.g. GUTTERS / LEAFFILTER
 * / SOFFIT) to its calculator-schema CATEGORY and takes that category's colour.
 * This is the branch that gives each summary card its own colour — without it every
 * tab in a vertical falls through to the single `vertical.color` and they all match.
 */
function findTabCategoryColorFromSchemas(tab: any, vertical: any, schemas: any[] = []) {
  const tabCategory = normalizeComparableName(tab?.productCategory || tab?.label);
  if (!tabCategory || !schemas?.length) return null;

  const categories = extractAllCategories(findSchemasForVertical(vertical, schemas));
  const match = categories.find(
    (category: any) => normalizeComparableName(category?.name || category?.label) === tabCategory
  );

  return match?.color || null;
}

/**
 * Resolve the summary card header colour from runtime config only.
 * Web parity (`resolveTabAccentColor`) — priority:
 *   tab.summaryColor/tab.color → calculator schema category colour → vertical.color
 *   → product.color → palette index fallback.
 * Colours may be a hex OR an MUI token ('info', 'error.main'); `resolveSchemaColor`
 * resolves both, mirroring web's `resolveSchemaColorValue`. The previous
 * `startsWith('#')` guards silently DISCARDED token colours and skipped both the
 * schema-category and product branches entirely.
 */
export function resolveTabAccentColor(
  tab: any,
  vertical: any,
  _theme?: any,
  options: any = {}
): string {
  const { tabIndex = 0, products = [], schemas = [] } = options;
  const verticalFallback = vertical?.color
    ? resolveSchemaColor(vertical.color, PALETTE_PRIMARY)
    : PALETTE_PRIMARY;

  const configured = tab?.summaryColor || tab?.color;
  if (configured) return resolveSchemaColor(configured, verticalFallback);

  const schemaCategoryColor = findTabCategoryColorFromSchemas(tab, vertical, schemas);
  if (schemaCategoryColor) return resolveSchemaColor(schemaCategoryColor, verticalFallback);

  if (vertical?.color) return resolveSchemaColor(vertical.color, PALETTE_PRIMARY);

  const product = findProductForVertical(vertical, products);
  if (product?.color) return resolveSchemaColor(product.color, PALETTE_PRIMARY);

  return PRODUCT_PALETTE_COLORS[tabIndex % PRODUCT_PALETTE_COLORS.length];
}

// ─── Section / field visibility ───────────────────────────────────────────────

function buildFlatTabState(tabState: any, tab: any) {
  const state: any = {};
  const sections = getTabSections(tab);
  sections.forEach((s: any) => {
    if (s.sectionType === 'simple') {
      const sectionState = tabState?.sectionFields?.[s.id] || {};
      Object.keys(sectionState).forEach((key) => {
        if (key !== 'colorValues') state[key] = sectionState[key];
      });
    } else {
      const combos = tabState?.comboGroups?.[s.id]?.combinations || [];
      if (combos.length > 0) {
        Object.keys(combos[0]).forEach((key) => {
          if (key !== 'colorValues') state[key] = combos[0][key];
        });
      }
    }
  });
  return state;
}

export function isSummarySectionVisible(
  section: any,
  tabState: any,
  dealCenterData: any,
  tab: any,
  applyConditions = true
) {
  const visibleWhen = section?.dependencies?.visibleWhen;
  if (!visibleWhen) return true;
  if (!applyConditions) return true;
  const state = buildFlatTabState(tabState, tab);
  return evaluateRuleGroup(visibleWhen, {
    dealCenterData: dealCenterData || {},
    state,
    tab,
    tabState,
    section,
  });
}

function getSectionCombos(section: any, tabState: any) {
  const fromGroups = tabState?.comboGroups?.[section.id]?.combinations;
  if (fromGroups?.length) return fromGroups;
  if (section.id === 'default' && tabState?.combinations?.length) {
    return tabState.combinations;
  }
  return [{ ...(section.defaultItem || {}) }];
}

// ─── Field display state ──────────────────────────────────────────────────────

function buildComboDisplayState(combo: any = {}, colorValues: any = {}) {
  const displayState = { ...combo, colorValues: combo.colorValues || colorValues };
  Object.entries(colorValues || {}).forEach(([key, val]) => {
    if (val === '' || val === null || val === undefined) return;
    // colorValues only FILLS a field the direct state lacks — it must never
    // override a present direct value. The deal-center save hydrates colorValues
    // with every field's value (colorKey defaults to field.id), so it becomes a
    // stale mirror; overriding from it would clobber a fresh edit to the direct
    // field value (e.g. Gutter Opening Width "2.5 - 3.4" masked by a stale "> 7").
    const direct = (combo as any)[key];
    if (direct === undefined || direct === null || direct === '') {
      (displayState as any)[key] = val;
    }
  });
  return displayState;
}

function buildFieldDepCtx(ctx: any, overrides: any = {}) {
  return {
    dealCenterData: ctx.dealCenterData || {},
    tab: ctx.tab,
    tabState: ctx.tabState,
    section: ctx.section,
    sectionState: ctx.sectionState,
    sectionFields: ctx.sectionFields,
    ...overrides,
  };
}

// ─── Location grid ────────────────────────────────────────────────────────────

function buildLocationRowsFromGrid(field: any, combo: any) {
  const grid = combo?.[field.id];
  if (!grid || typeof grid !== 'object') return [];

  const config = resolveLocationGridConfig(field);
  const unit = (config.unit || 'ft').toLowerCase();
  const rows: any[] = [];

  (config.rows || []).forEach((row: any) => {
    const rowData = grid[row.key] || {};
    const entries: any[] = [];
    (config.columns || []).forEach((col: any) => {
      const val = Number(rowData[col.key]) || 0;
      if (val > 0) entries.push({ story: col.label || col.key, value: val, unit });
    });
    if (entries.length > 0) rows.push({ location: row.label || row.key, entries });
  });

  return rows;
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

function mergeSummaryContent(target: any, source: any) {
  target.parts.push(...(source.parts || []));
  target.extras.push(...(source.extras || []));
  target.detailRows.push(...(source.detailRows || []));
  target.locationRows.push(...(source.locationRows || []));
}

function isMeaningfulSummaryValue({ text, variant }: any) {
  return variant !== 'missing' && String(text || '').trim() !== '';
}

function isDisplayableFieldSummary(field: any, formatted: any) {
  if (!isMeaningfulSummaryValue(formatted)) return false;
  if (field?.type === 'number') {
    const numeric = Number(String(formatted.text).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(numeric) || numeric === 0) return false;
  }
  return true;
}

// ─── Field value formatting ───────────────────────────────────────────────────

function formatFieldSummaryValue(field: any, state: any = {}, options: any = {}) {
  const { dealCenterData, editMode, fields } = options;
  const colorValues = state?.colorValues || {};
  const resolvedState = { ...state };

  // A locked colour whose paired quantity is empty is not on the job, so it must
  // not reach the summary either — the same rule the tab's locked row applies
  // (`locked-color-defaults.ts`). Without this an Extras pair whose quantity is 0
  // (dropped by `isDisplayableFieldSummary`) still rendered as "Ground Spout —
  // Black", the colour surviving alone on a row named after the missing quantity.
  if (isPairedQuantityEmpty(field, { fields, state, dealCenterData })) {
    return { text: '', variant: 'missing' };
  }

  // Web parity (`vertical-summary-utils.js:247-255`): in deal-EDIT mode a "locked"
  // field is editable, so the rep's live value must win. Fall back to the
  // deal-center value only when they left it blank. Without this guard the summary
  // silently reverted every edited locked field to the calculator's value — the
  // rep's change was saved but never shown back to them.
  const liveValue = state?.[field.id];
  const hasLiveValue = liveValue !== undefined && liveValue !== null && liveValue !== '';

  if (
    isFieldLocked(field) &&
    dealCenterData &&
    Object.keys(dealCenterData).length &&
    !(editMode && hasLiveValue)
  ) {
    const lockedValue = resolveLockedValue(field, dealCenterData);
    if (lockedValue !== undefined && lockedValue !== null && lockedValue !== '' && lockedValue !== '—') {
      resolvedState[field.id] = lockedValue;
      return formatComboFieldSummaryValue(field, resolvedState, options);
    }
  }

  // Ticket 1063 — a DISABLED dropdown is answered by the config, not the rep.
  //
  // ⚠️ Its value is DISPLAY-ONLY in the builder: `DropdownField` resolves it for the
  // box but deliberately never writes it into job state (re-saving every submitted
  // deal because a portal default changed is not something a render should do). The
  // summary reads job state, so without this branch the row was simply MISSING —
  // reported as "Gutter Opening Width shows for Combination #2 but not #1", the
  // difference being only that #2 happened to carry a stored value.
  //
  // Kept separate from the locked branch above rather than folded into it: that one
  // is load-bearing for the deal-edit flow and passes the RAW `field.defaultValue`,
  // and this one must gate on `dependencies.defaultWhen` the same way the builder
  // box does, so a default is never shown past its own condition. Nothing about the
  // locked path changes.
  //
  // `editMode && hasLiveValue` defers to the rep for the same reason as above: in
  // the deal-edit wizard a disabled dropdown is unlocked, so their value wins.
  if (!isFieldLocked(field) && field?.disabled && !(editMode && hasLiveValue)) {
    const configValue = resolveLockedValue(field, dealCenterData || {}, {
      fallbackDefault: resolveConditionalDefault(field, state, { dealCenterData }),
    });
    if (
      configValue !== undefined &&
      configValue !== null &&
      configValue !== '' &&
      configValue !== '—'
    ) {
      resolvedState[field.id] = configValue;
      return formatComboFieldSummaryValue(field, resolvedState, options);
    }
  }

  const rawById = state?.[field.id];
  const rawByKey = field.key ? state?.[field.key] : undefined;
  const colorById = colorValues?.[field.id];
  const colorByKey = field.key ? colorValues?.[field.key] : undefined;

  if (rawById !== undefined && rawById !== null && rawById !== '') {
    resolvedState[field.id] = rawById;
  } else if (rawByKey !== undefined && rawByKey !== null && rawByKey !== '') {
    resolvedState[field.id] = rawByKey;
  } else if (colorById) {
    resolvedState[field.id] = colorById;
  } else if (colorByKey) {
    resolvedState[field.id] = colorByKey;
  }

  return formatComboFieldSummaryValue(field, resolvedState, options);
}

function isSummaryFieldVisible(field: any, state: any, ctx: any) {
  const { applyConditions = true } = ctx;
  if (!applyConditions) return true;
  return isFieldVisibleWithConditions(
    field,
    state,
    buildFieldDepCtx(ctx, { sectionState: state, sectionFields: ctx.sectionFields || [] }),
    applyConditions
  );
}

function buildSingleFieldDetailRow(field: any, state: any, ctx: any): any {
  if (!field?.id) return null;
  if (SKIPPED_FIELD_TYPES.has(field.type) || isAllocationField(field)) return null;
  if (field.key?.startsWith('_')) return null;
  if (isCombinationSummaryField(field)) return null;
  if (!isSummaryFieldVisible(field, state, ctx)) return null;

  if (field.type === 'locationGrid') {
    const locationRows = buildLocationRowsFromGrid(field, state);
    return locationRows.length ? { locationRows } : null;
  }

  const formatted = formatFieldSummaryValue(field, state, {
    dealCenterData: ctx.dealCenterData,
    editMode: ctx.editMode,
    fields: ctx.sectionFields,
  });
  if (!isDisplayableFieldSummary(field, formatted)) return null;

  return { label: field.label || field.key || '', text: formatted.text, variant: formatted.variant };
}

/**
 * Merge a bordered stack's paired children into ONE row — web parity
 * (`vertical-summary-utils.js` `buildStackRowSummary`, commit 5a54070). For an
 * "Extras" group `[Ground Spout = 4, Color = Black]` this returns
 * `{ label: 'Ground Spout', text: '4 · Black' }`: the label comes from the first
 * non-color child (the color field's own "Color" label is skipped) and the
 * formatted values are joined with " · ". Was rendering as two separate rows.
 */
function buildStackRowSummary(children: any[] = [], state: any, ctx: any): any {
  const values: string[] = [];
  let rowLabel = '';

  children.forEach((child: any) => {
    if (!child?.id || !isSummaryFieldVisible(child, state, ctx)) return;

    const formatted = formatFieldSummaryValue(child, state, {
      dealCenterData: ctx.dealCenterData,
      editMode: ctx.editMode,
      fields: children,
    });
    if (!isDisplayableFieldSummary(child, formatted)) return;

    if (
      !rowLabel &&
      child.label &&
      child.type !== 'swatch' &&
      child.type !== 'colorSelection' &&
      child.type !== 'customColor'
    ) {
      rowLabel = child.label;
    }

    values.push(formatted.text);
  });

  if (!values.length) return null;

  if (!rowLabel) {
    const labeledChild = children.find((child: any) => child?.label);
    rowLabel = labeledChild?.label || '';
  }

  return { label: rowLabel, text: values.join(' · '), variant: 'value' };
}

/**
 * A bordered, multi-column stack groups its children into rows of `columns`
 * (each group merged by `buildStackRowSummary`). A single-column / non-bordered
 * stack keeps one row per child — the original behaviour.
 */
function processStackFieldSummary(stackField: any, state: any, ctx: any): any {
  const result = { parts: [], extras: [], detailRows: [], locationRows: [] };
  const children = (stackField.fields || []).filter((child: any) =>
    isSummaryFieldVisible(child, state, ctx)
  );
  if (!children.length) return result;

  const columns = getFieldGridColumns(stackField);
  const groupSize = stackField.bordered && columns >= 2 ? columns : 1;

  for (let index = 0; index < children.length; index += groupSize) {
    const group = children.slice(index, index + groupSize);

    if (groupSize > 1) {
      const row = buildStackRowSummary(group, state, ctx);
      if (row) (result.detailRows as any[]).push(row);
      continue;
    }

    const child = group[0];
    if (isContainerFieldType(child.type)) {
      mergeSummaryContent(result, processContainerFieldSummary(child, state, ctx));
      continue;
    }

    const row = buildSingleFieldDetailRow(child, state, ctx);
    if (!row) continue;
    if (row.locationRows) (result.locationRows as any[]).push(...row.locationRows);
    else (result.detailRows as any[]).push(row);
  }

  return result;
}

function processContainerFieldSummary(field: any, state: any, ctx: any): any {
  if (field?.type === 'stack') {
    return processStackFieldSummary(field, state, ctx);
  }
  // accordion (and any other container): one row per child, no grouping.
  const result = { parts: [], extras: [], detailRows: [], locationRows: [] };
  (field.fields || []).forEach((child: any) => {
    if (!isSummaryFieldVisible(child, state, ctx)) return;
    if (isContainerFieldType(child.type)) {
      mergeSummaryContent(result, processContainerFieldSummary(child, state, ctx));
      return;
    }
    const row = buildSingleFieldDetailRow(child, state, ctx);
    if (!row) return;
    if (row.locationRows) (result.locationRows as any[]).push(...row.locationRows);
    else (result.detailRows as any[]).push(row);
  });
  return result;
}

function getCombinationSectionFields(section: any) {
  return (section?.fields || []).filter(
    (field: any) => !isSectionScopedCombinationField(field) && !isAllocationField(field)
  );
}

function processSummaryFields(fields: any[] = [], state: any = {}, ctx: any = {}) {
  const result: any = { parts: [], extras: [], detailRows: [], locationRows: [] };
  const displayState = buildComboDisplayState(state, state?.colorValues);
  const { summaryMode = 'fields' } = ctx;
  const inCombination = summaryMode === 'combination';

  (fields || []).forEach((field: any) => {
    if (!field?.id) return;
    if (isContainerFieldType(field.type)) {
      mergeSummaryContent(result, processContainerFieldSummary(field, displayState, ctx));
      return;
    }
    if (SKIPPED_FIELD_TYPES.has(field.type) || isAllocationField(field)) return;
    if (field.key?.startsWith('_')) return;
    if (isCombinationSummaryField(field)) return;
    if (isSectionScopedCombinationField(field)) return;
    if (!isSummaryFieldVisible(field, displayState, { ...ctx, sectionFields: fields })) return;

    if (field.type === 'locationGrid') {
      result.locationRows.push(...buildLocationRowsFromGrid(field, displayState));
      return;
    }

    const formatted = formatFieldSummaryValue(field, displayState, {
      dealCenterData: ctx.dealCenterData,
      editMode: ctx.editMode,
      fields,
    });
    if (!isDisplayableFieldSummary(field, formatted)) return;

    if (inCombination && !isContainerFieldType(field.type)) {
      if (field.type === 'number' && field.label) {
        result.parts.push(`${formatted.text} ${field.label}`);
      } else if (LABELED_SELECTION_TYPES.has(field.type) && field.label) {
        result.parts.push(`${field.label}: ${formatted.text}`);
      } else {
        result.parts.push(formatted.text);
      }
      return;
    }

    result.detailRows.push({ label: field.label || field.key || '', text: formatted.text, variant: formatted.variant });
  });

  return result;
}

/**
 * Ticket: *"is there any safeguards we can do that if product is <1 foot or <1 unit
 * measurement we have it so it doesn't get thru to job summary full build?"* A rep who
 * picked `Gutter Type: 6" K-Style`, left the Measurements grid on all zeros and walked
 * on to Downspouts still got a `Combination #1 - Gutter Type: 6" K-Style` card on the Job
 * Builder Summary: a line item for a product with no footage behind it.
 *
 * A selection alone was enough because `parts.length > 0` was the whole test - the grid
 * contributed nothing (`buildLocationRowsFromGrid` already drops zero cells) and a 0
 * number is already dropped by `isDisplayableFieldSummary`, so an unmeasured combination
 * looked exactly like one carrying only a colour.
 */
const MIN_MEASURED_QUANTITY = 1;

function sumGridValues(grid: any): number {
  if (!grid || typeof grid !== 'object') return 0;
  return Object.values(grid).reduce((rowSum: number, stories: any) => {
    if (stories && typeof stories === 'object') {
      return rowSum + Object.values(stories).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
    }
    return rowSum + (Number(stories) || 0);
  }, 0);
}

/**
 * How much this ONE combination measures, and whether it declares a measurement at all.
 *
 * The field precedence is `computeGroupUsed`'s verbatim - the same rule that decides how
 * much of an allocation a combination consumes - so "measured" cannot come to mean two
 * different things on the allocator bar and on the summary: grids define the quantity
 * when the section has one, and sibling numbers (miters, end caps) are add-ons that must
 * never stand in for the footage.
 *
 * WARNING: only `locationGrid` and `number` count. A footage box authored as a `text`
 * field is NOT gated - a text field holding `Versa` is a profile, not a measurement, and
 * a blank one is indistinguishable from a blank descriptive field, so treating it as a
 * measurement would hide selection-only combinations that are legitimately on the job.
 */
function measureCombo(section: any, state: any, ctx: any) {
  // Hidden fields are excluded, so a measurement a condition has switched off can never
  // hold a combination out of the summary. That is deliberately the SAFE direction: with
  // every measurement hidden the combination declares none and renders as it always did.
  const rowFields = getFlattenedCombinationSectionRowFields(section).filter((field: any) =>
    isSummaryFieldVisible(field, state, ctx)
  );

  const gridFields = rowFields.filter((f: any) => f.type === 'locationGrid');
  const measured = gridFields.length
    ? gridFields
    : rowFields.filter((f: any) => f.type === 'number');

  if (!measured.length) return { declared: false, total: 0 };

  const total = measured.reduce((sum: number, field: any) => {
    // The value may sit under the field id, its `key`, or (grids only) the legacy `grid`
    // slot - the same three places `computeGroupUsed` looks.
    const raw = state?.[field.id] ?? (field.key ? state?.[field.key] : undefined);
    if (field.type === 'locationGrid') return sum + sumGridValues(raw ?? state?.grid);
    return sum + (Number(raw) || 0);
  }, 0);

  return { declared: true, total };
}

function comboHasMeaningfulData(section: any, combo: any, ctx: any) {
  const displayState = buildComboDisplayState(combo, combo?.colorValues);
  const sectionFields = getCombinationSectionFields(section);

  // A combination that DECLARES a measurement has to carry one. A section that authors
  // none (colour-only, selection-only) is untouched and still renders on its content.
  const measurement = measureCombo(section, displayState, {
    ...ctx, section, summaryMode: 'combination', sectionFields,
  });
  if (measurement.declared && measurement.total < MIN_MEASURED_QUANTITY) return false;

  const content = processSummaryFields(sectionFields, displayState, {
    ...ctx, section, summaryMode: 'combination',
  });
  return content.parts.length > 0 || content.detailRows.length > 0 || content.locationRows.length > 0;
}

function buildCombinationEntry(section: any, combo: any, index: number, offset: number, ctx: any) {
  const displayState = buildComboDisplayState(combo, combo?.colorValues);
  const content = processSummaryFields(getCombinationSectionFields(section), displayState, {
    ...ctx, section, summaryMode: 'combination',
  });
  return {
    displayNumber: getCombinationDisplayNumber(combo, index, offset),
    summaryLine: content.parts.join(' · '),
    locationRows: content.locationRows,
    comboFieldRows: content.detailRows,
    comboExtras: content.extras,
  };
}

function buildFieldSummaryRows(fields: any[] = [], state: any = {}, ctx: any = {}) {
  const { colorValues = {} } = ctx;
  const displayState = buildComboDisplayState(state, colorValues);
  const content = processSummaryFields(fields, displayState, { ...ctx, sectionFields: fields, summaryMode: 'fields' });
  return content.detailRows.map((row: any) => ({ label: row.label, text: row.text, variant: row.variant }));
}

function buildCombinationSectionSummary(
  section: any,
  tabState: any,
  tab: any,
  ctx: any,
  combinationIndexOffset = 0
) {
  const sectionCombos = getSectionCombos(section, tabState);
  const sectionState = tabState?.comboGroups?.[section.id]?.sectionState || {};

  const combinations: any[] = [];
  sectionCombos.forEach((combo: any, index: number) => {
    // My Deals: a combination whose colour was never picked is hidden on the tab
    // (`combination-color-filter.ts`), so it must not reappear in the summary
    // either — `comboHasMeaningfulData` is a different, looser rule and lets it
    // through. Edit-mode only; the create flow is untouched.
    if (isComboHiddenInDealEdit(combo, getFlattenedCombinationSectionRowFields(section), ctx?.editMode)) {
      return;
    }
    if (!comboHasMeaningfulData(section, combo, { ...ctx, tab, tabState, section })) return;
    combinations.push(buildCombinationEntry(section, combo, index, combinationIndexOffset, { ...ctx, tab, tabState, section }));
  });

  const sectionExtras = buildFieldSummaryRows(
    getCombinationSectionHeaderFields(section),
    sectionState,
    { ...ctx, tab, tabState, section, colorValues: sectionState?.colorValues || {} }
  );

  if (!combinations.length && !sectionExtras.length) return null;

  return {
    sectionId: section.id,
    sectionLabel: section.label || '',
    combinations,
    extras: sectionExtras,
    extrasLabel: section.summaryExtrasLabel || 'Extras',
  };
}

function buildAllCombinationSectionSummaries(tab: any, tabState: any, ctx: any = {}) {
  const { dealCenterData = {}, applyConditions = true } = ctx;
  const sections = getTabSections(tab);
  const summaries: any[] = [];
  let combinationIndexOffset = 0;

  sections.forEach((section: any) => {
    if (section.sectionType === 'simple' || !(section.fields || []).length) return;
    if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab, applyConditions)) return;

    const sectionSummary = buildCombinationSectionSummary(section, tabState, tab, ctx, combinationIndexOffset);
    if (!sectionSummary) return;

    summaries.push(sectionSummary);
    combinationIndexOffset += sectionSummary.combinations.length;
  });

  return summaries;
}

export function buildSimpleSectionSummary(section: any, sectionState: any = {}, ctx: any = {}) {
  const fields = section.fields || [];
  if (!fields.length) return [];
  return buildFieldSummaryRows(fields, sectionState, { ...ctx, section, colorValues: sectionState?.colorValues || {} });
}

export function buildTabLevelFieldSummary(tab: any, tabState: any = {}, ctx: any = {}) {
  const fields = tab.fields || [];
  if (!fields.length) return [];
  return buildFieldSummaryRows(fields, tabState, { ...ctx, tab, tabState, colorValues: tabState?.colorValues || {} });
}

export function buildTabSummaryEntries(tab: any, tabState: any, ctx: any = {}) {
  const { dealCenterData = {}, applyConditions = true } = ctx;
  const sections = getTabSections(tab);
  const entries: any[] = [];
  let combinationIndexOffset = 0;

  sections.forEach((section: any) => {
    if (section.sectionType === 'simple' || !(section.fields || []).length) return;
    if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab, applyConditions)) return;
    if (!shouldIncludeSectionInTabSummary(section)) return;

    const sectionCombos = getSectionCombos(section, tabState);
    const summaryField = getSectionSummaryField(section);
    const columns = resolveGrandTotalColumns(section.fields || [], summaryField);

    sectionCombos.forEach((combo: any, index: number) => {
      entries.push({
        combo: buildComboDisplayState(combo, combo.colorValues),
        section,
        summaryField,
        columns,
        displayNumber: getCombinationDisplayNumber(combo, index, combinationIndexOffset),
      });
    });

    combinationIndexOffset += sectionCombos.length;
  });

  return entries;
}

export function buildTabSummarySection(tab: any, tabState: any = {}, ctx: any = {}) {
  const { dealCenterData = {}, applyConditions = true, vertical, tabIndex = 0, editMode = false, lockedFieldIds = null } = ctx;

  // Deal-EDIT parity with the "No details yet" step gate (`stateHasContent`): a tab
  // whose only state is deal-center-seeded (locked) values holds NO rep input, so it
  // must summarize as empty. Otherwise the summary lists auto-defined calculator
  // values (e.g. Gutters "Ground Spout", LeafFilter combinations) the rep never
  // entered — the very inconsistency where the step shows "No details yet" but the
  // summary shows data. Only user-entered values reach the summary.
  if (editMode && lockedFieldIds && !stateHasContent(tabState, lockedFieldIds)) {
    return {
      tabId: tab.id,
      tabLabel: tab.label || tab.id,
      accentColor: resolveTabAccentColor(tab, vertical, null, {
        tabIndex,
        products: ctx?.products,
        schemas: ctx?.schemas,
      }),
      combinationSections: [],
      simpleSections: [],
      tabFields: [],
      isEmpty: true,
    };
  }

  const sections = getTabSections(tab);
  const combinationSections = buildAllCombinationSectionSummaries(tab, tabState, ctx);

  const simpleSections: any[] = [];
  sections.forEach((section: any) => {
    if (section.sectionType !== 'simple' || !(section.fields || []).length) return;
    if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab, applyConditions)) return;

    const sectionState = tabState?.sectionFields?.[section.id] || {};
    const fields = buildSimpleSectionSummary(section, sectionState, ctx);
    if (!fields.length) return;

    simpleSections.push({ sectionId: section.id, sectionLabel: section.label || '', fields });
  });

  const tabFields = buildTabLevelFieldSummary(tab, tabState, ctx);
  const hasCombinationData = combinationSections.some(
    (group: any) => group.combinations.length > 0 || group.extras.length > 0
  );
  const isEmpty = !hasCombinationData && simpleSections.length === 0 && tabFields.length === 0;

  return {
    tabId: tab.id,
    tabLabel: tab.label || tab.id,
    // Web parity: `products` + `schemas` MUST reach the resolver — the schema
    // category branch is what colours each tab card individually.
    accentColor: resolveTabAccentColor(tab, vertical, null, {
      tabIndex,
      products: ctx?.products,
      schemas: ctx?.schemas,
    }),
    combinationSections,
    simpleSections,
    tabFields,
    isEmpty,
  };
}

export function buildVerticalSummarySections(vertical: any, verticalState: any = {}, ctx: any = {}) {
  const { lockedTabIds = [], editMode = false } = ctx;
  const locked = new Set(lockedTabIds || []);
  const tabs = vertical?.tabs || [];

  // In deal-edit, precompute the locked (deal-center-seeded) field ids so each tab's
  // summary can drop to empty when the rep entered nothing (see buildTabSummarySection).
  const lockedFieldIds = editMode && vertical ? collectLockedFieldIds({ verticals: [vertical] }) : null;

  return tabs
    .filter((tab: any) => !tab.isSummary && !locked.has(tab.id))
    .map((tab: any, tabIndex: number) =>
      buildTabSummarySection(tab, verticalState[tab.id] || {}, { ...ctx, vertical, tabIndex, lockedFieldIds })
    );
}
