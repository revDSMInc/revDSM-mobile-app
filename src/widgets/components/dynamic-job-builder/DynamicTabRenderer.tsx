import React, { useMemo, Fragment } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import {
  getTabSections,
  getCombinationSectionRowFields,
  canAddMoreCombinations,
  createNextCombinationItem,
  isParentCombination,
  getRenderedSectionCombos,
  renumberTabCombinations,
  getCombinationSectionHeaderFields,
  getFlattenedCombinationSectionRowFields,
  buildComboGroupSectionState,
} from '../../../utils/dynamic-job-builder/engine/combination-utils';
import {
  shouldShowTabGrandTotalSummary,
  resolveGrandTotalColumns,
  formatComboFieldSummaryValue,
} from '../../../utils/dynamic-job-builder/engine/grand-total-utils';
import {
  isFieldVisibleWithConditions,
  evaluateRuleGroup,
  isAllocationExcluded,
  isDefaultColorActive,
  isFieldRequired,
  resolveConditionalDefault,
  resolveEffectiveDefaultValue,
} from '../../../utils/dynamic-job-builder/engine/dependency-engine';
import { isRequiredFieldValueMissing } from '../../../utils/dynamic-job-builder/engine/field-value-utils';
import { isAllocationField, computeGridTotal, resolveLockedValue } from '../../../utils/dynamic-job-builder/engine/allocation-utils';
import {
  findPairedColorFields,
  hasEnteredQuantity,
  isPairedQuantityEmpty,
  resolveLockedColorFallbackDefault,
} from '../../../utils/dynamic-job-builder/engine/locked-color-defaults';
import { isAllocationCardActive } from '../../../utils/dynamic-job-builder/engine/allocation-config-utils';
import { resolveAllocationMetrics } from '../../../utils/dynamic-job-builder/engine/allocation-value-resolver';
import { resolveAccordionAllocationStatus } from '../../../utils/dynamic-job-builder/engine/accordion-allocation-utils';
import {
  filterVisibleToggleOptions,
  getVisibleFieldOptions,
} from '../../../utils/dynamic-job-builder/engine/toggle-utils';
import { ADDED_IN_EDIT_KEY, isComboHiddenInDealEdit } from '../../../utils/dynamic-job-builder/engine/combination-color-filter';
import {
  getWarningConfig,
  getOptionGridSize,
  getEffectiveBorderColor,
  resolveMobileGridColumns,
  getAllocationGridFineColumns,
  getAllocationGridItemSpan,
} from '../../../utils/dynamic-job-builder/engine/field-layout-utils';

// Web parity: optionList/select render in a wrapping grid whose columns come from
// `field.columns` (`getOptionGridSize` → a 12-col span; 12/span = columns per row).
// When the schema leaves `columns` unset we return undefined so `OptionList` can
// auto-size from the option count/length the way web's `option-selector.js`
// `getGridSize()` does (3 short options → one row of 3).
/**
 * The title to print on a read-only VALUE BOX (`LockedField`).
 *
 * ⚠️ Falls back to the containing stack/accordion's label. `containerLabel` is
 * computed in the container branch and passed down as `ctx.parentLabel`, but it is
 * only ever used to SUPPRESS a duplicate child label — it is never rendered as a
 * heading. So a field authored with no `label` of its own, sitting inside a stack
 * that carries the name (the LeafFilter "Gutter Opening Width" / "LeafFilter
 * Profile" shape), printed a completely untitled box. `title` is in the `Field`
 * type but nothing else reads it; `label` is the canonical key.
 *
 * Only for the boxed presentation — an inline chooser keeps the renderer's
 * `visibleLabel`, whose suppression rules exist precisely to stop it repeating a
 * heading that is already on screen.
 */
const boxTitleFor = (field: any, ctx?: any): string | undefined =>
  field?.label || field?.title || ctx?.parentLabel || undefined;

const optionColumnsFor = (field: any): number | undefined => {
  const span = getOptionGridSize(field?.columns);
  return span ? Math.max(1, Math.round(12 / span)) : undefined;
};
import { resolveColorPalette } from '../../../utils/dynamic-job-builder/constants/color-palettes';
import { resolveColorsForField } from '../../../utils/dynamic-job-builder/engine/product-catalog-utils';
import { buildTabSummaryEntries, isSummarySectionVisible } from '../../../utils/dynamic-job-builder/engine/vertical-summary-utils';
import { SectionCard } from './SectionCard';
import { SectionLabel } from './SectionLabel';
import { InputField } from './InputField';
import { IncompleteWarning } from './IncompleteWarning';
import { TextField } from './TextField';
import { TextareaField } from './TextareaField';
import { ToggleGroup } from './ToggleGroup';
import { DynamicOptionField } from './DynamicOptionField';
import { DropdownField } from './DropdownField';
import { OptionToggleField } from './OptionToggleField';
import { SwatchPicker } from './SwatchPicker';
import { LockedField } from './LockedField';
import { LockedFieldWithColor } from './LockedFieldWithColor';
import { AllocatorBar } from './AllocatorBar';
import { LocationGrid } from './LocationGrid';
import { RoomPicker } from './RoomPicker';
import { AddCombinationButton } from './AddCombinationButton';
import { AccordionSection } from './AccordionSection';
import { GrandTotalCard } from './GrandTotalCard';
import { VerticalSummaryTab } from './VerticalSummaryTab';

const COMBINATION_COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#ec4899', // pink
];

// Selected toggle / option / swatch state always uses the normal Job Builder's
// green, regardless of the vertical's own accent color — matches GutterSection /
// LeafFilterSection where every selected control is #22C55E.
const SELECTED_ACCENT = '#22C55E';

/**
 * Port of web `field-registry.js` → `resolveEffectiveColorBehavior`.
 *
 * Opt-in (colorSelection only): when the field's requiredWhen condition is not
 * met (its linked deal-center value — e.g. the gutter Extra — is empty), render
 * it as a read-only "—" locked field instead of an editable colour picker.
 * Portal-controlled via `lockWhenNotRequired`; defaults off, and `required ===
 * false` guards it so fields that don't pass a required flag (e.g. plain
 * `swatch`) are never affected.
 */
function resolveEffectiveColorBehavior(field: any, state: any, depCtx: any, required?: boolean, unlockAll?: boolean) {
  // Edit mode (web `unlockAll`) makes every field editable, so a colour is never
  // locked-by-not-required when reopening a deal to edit — the rep must be able to
  // change the colour of an already-configured Extra (this was the "colours locked
  // in the Extras section after reschedule" bug).
  const lockWhenNotRequired =
    !unlockAll &&
    field.type === 'colorSelection' && field.lockWhenNotRequired === true && required === false;

  if (!isDefaultColorActive(field, state, depCtx)) {
    return { effectiveDefault: '', effectiveLocked: lockWhenNotRequired };
  }
  return {
    effectiveDefault: field.defaultValue ?? '',
    effectiveLocked: Boolean(field.locked) || field.type === 'locked' || lockWhenNotRequired,
  };
}

// `stateObj` MUST be the full state object at this field's level (tabState /
// sectionState / the combo) — the engine's resolveSourceValue (source:'state')
// and dropdown reveal (isVisibleByDropdownMapping reads state[dropdown.id]) look
// up sibling values on it. Passing a single field value here silently breaks
// combo-sibling visibleWhen rules (e.g. leaffilter exactSize / Versa-Max reveal).
function isFieldVisible(field: any, stateObj: any, tab: any, tabState: any, section: any, sectionState: any, combos: any[], dealCenterData: any, applyConditions: boolean, sectionFieldsOverride?: any[]) {
  if (!applyConditions) return true;
  return isFieldVisibleWithConditions(field, stateObj || {}, {
    dealCenterData,
    tab,
    tabState,
    section,
    sectionState,
    sectionFields: sectionFieldsOverride || section?.fields || tab?.fields || [],
    combos,
  }, applyConditions);
}

function filterFields(fields: any[], tabState: any, tab: any, section: any, stateObj: any, combos: any[], dealCenterData: any, applyConditions: boolean, sectionFieldsOverride?: any[]) {
  return (fields || []).filter((f: any) =>
    isFieldVisible(f, stateObj, tab, tabState, section, stateObj, combos, dealCenterData, applyConditions, sectionFieldsOverride)
  );
}

// Engine-driven allocation card: budget/used/remaining come from
// resolveAllocationMetrics (dealCenterData + contributors + computed). Instead of
// hiding cards with 0 budget (isAllocationExcluded), cards with optionBindings
// that don't match show as inactive (greyed out) — matching web behaviour.
// An allocation-tracker accordion shows its cards inline (no accordion wrapper)
// when it has this many or fewer visible cards; only more than this collapses
// them behind the accordion header. Web ref: field-registry.js.
const ALLOCATION_INLINE_MAX = 4;

// Allocation cards sit two-up per row. The schema's "Mobile Layout" setting
// (`mobileColumns`) overrides this when the portal configures one.
const ALLOCATION_GRID_COLS = 2;

const ALLOCATION_GRID_GAP = 8;

/**
 * A child renders as an allocation card when its NORMALIZED type is 'allocation'
 * — `isAllocationField` only checks `field.type`, but `renderField` routes on
 * `widget || inputType || type`, so a card authored as `widget: 'allocation'`
 * renders as one while failing the strict check.
 */
const isAllocationChild = (f: any) =>
  isAllocationField(f) || (f?.widget || f?.inputType || f?.type) === 'allocation';

/**
 * Lays allocation cards out two-up, with the LAST ROW STRETCHED to fill the
 * width when it holds fewer cards than the column count:
 *   4 → [c c] [c c]     3 → [c c] [ c——— ]
 *   2 → [c c]           1 → [ c——— ]
 * The span math is web's (`getAllocationGridFineColumns` / `…ItemSpan`): it
 * scales the grid to an LCM of the column count and the last row's item count,
 * then spans each card across its share. Cards in a row are equal height — the
 * row stretches the cells to the tallest, and each card is rendered with
 * `fillHeight` so it fills its cell.
 */
function AllocationCardGrid({ columns, children }: { columns: number; children: React.ReactNode }) {
  const cells = React.Children.toArray(children);
  const cols = Math.max(1, Math.round(columns));
  const count = cells.length;
  const fineColumns = getAllocationGridFineColumns(count, cols);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -ALLOCATION_GRID_GAP / 2 }}>
      {cells.map((cell, i) => {
        const span = getAllocationGridItemSpan(i, count, cols);
        return (
          <View
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            style={{
              width: `${(span / fineColumns) * 100}%`,
              paddingHorizontal: ALLOCATION_GRID_GAP / 2,
            }}
          >
            {cell}
          </View>
        );
      })}
    </View>
  );
}

/**
 * Lays a stack's child fields into an equal-column grid — mobile's equivalent of
 * web `getFieldGridSx(columns, mobileColumns)` at the `xs` breakpoint. Children
 * flow in document order into the columns, so an extras stack authored as
 * [extra, color, extra, color, …] with `mobileColumns: 2` pairs each Extra with
 * its Color on one row (web parity). Cells align to the top so a tall colour
 * picker doesn't stretch its short locked-field neighbour.
 */
function StackFieldGrid({ columns, children }: { columns: number; children: React.ReactNode }) {
  const cells = React.Children.toArray(children);
  const cols = Math.max(1, Math.round(columns));
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', marginHorizontal: -ALLOCATION_GRID_GAP / 2 }}>
      {cells.map((cell, i) => (
        <View
          // eslint-disable-next-line react/no-array-index-key
          key={i}
          style={{ width: `${100 / cols}%`, paddingHorizontal: ALLOCATION_GRID_GAP / 2 }}
        >
          {cell}
        </View>
      ))}
    </View>
  );
}

function renderAllocationCard(field: any, ctx: any = {}) {
  const {
    dealCenterData = {},
    tab,
    tabState,
    section,
    sectionState,
    combos = [],
  } = ctx;

  const fields = ctx.sectionFields?.length ? ctx.sectionFields : section?.fields || tab?.fields || [];
  const idx = fields.findIndex((f: any) => f.id === field.id);

  const resolved = resolveAllocationMetrics(field, {
    field,
    tabState,
    tab,
    section,
    sectionState,
    combos,
    fields,
    fieldIndex: idx >= 0 ? idx : 0,
    dealCenterData,
  });

  const active = isAllocationCardActive(field, tabState, tab);
  const inactive = field?.optionBinding?.enabled && !active;

  const unit = field.unit || field.allocUnit || 'ft';
  return (
    <AllocatorBar
      key={field.id}
      label={field.label}
      avail={Number(resolved?.available) || 0}
      used={Number(resolved?.allocated) || 0}
      unit={unit}
      inactive={inactive}
      // Set by the `accordion` container for its allocation children: drop the
      // card's own outer margin (the container spaces them) and stretch to the
      // grid cell so a row of cards shares one height.
      compact={!!ctx.compactAllocation}
      fillHeight={!!ctx.allocationFillHeight}
    />
  );
}

interface DynamicTabRendererProps {
  tab: any;
  vertical?: any;
  tabState: any;
  verticalState?: any;
  lockedTabIds?: string[];
  onStateChange?: (tabStateOrUpdater: any) => void;
  dealCenterData?: any;
  readOnly?: boolean;
  applyConditions?: boolean;
  // Deal-edit flow (web `hideAllocationTrackers`): hide the pinned footage
  // allocation grid + accordion tracker. Field sections already render without
  // their own allocation UI, so this is the only allocation chrome to suppress.
  hideAllocationTrackers?: boolean;
  /**
   * Spread onto this tab's `ScrollView` so the SCREEN's step header can collapse as the
   * rep scrolls (`hooks/useCollapsingHeader`). The scroll that drives it lives here, two
   * components below the header it moves, so it has to be handed down.
   *
   * Every tab wires it: the field ScrollView below, and `VerticalSummaryTab`, which owns
   * its own and returns before that one.
   *
   * ⚠️ SPREAD it whole. It carries the touch/momentum handlers as well as `onScroll`,
   * and without them the header blinks — see `userDriven` in `utils/collapsing-header.ts`.
   *
   * ⚠️ The pinned allocation trackers sit ABOVE the field ScrollView and must NOT take
   * it — that is the half of the ticket that says the tracker always stays.
   */
  collapsingScrollProps?: Record<string, any>;
  /**
   * Animated top padding for the PINNED allocation tracker, from
   * `useCollapsingHeader().underHeaderStyle`.
   *
   * ⚠️ The tracker sits directly under the collapsing header and does not move with it.
   * With a fixed `paddingTop` the gap above the tracker stayed at its full open size once
   * the header had gone, leaving the cards stranded below a band of white. This closes it
   * over the same travel, so header + tracker read as one block.
   */
  collapsingUnderHeaderStyle?: Record<string, any>;
  verticalId?: string;
  verticalColor?: string;
  products?: any[];
  schemas?: any[];
  repDetails?: any;
  /** Web `useDealEditMode()` — editing an already-resulted deal. */
  editMode?: boolean;
  // Summary-tab (isSummary) extras — forwarded to VerticalSummaryTab for the
  // appointment / agreement / order-sheet cards. Ignored on product tabs.
  leadId?: string;
  calculatorResultData?: any;
  customerName?: string;
  isSale?: boolean;
  isDemo?: boolean;
  scheduleTime?: any;
  agreements?: any[];
  orderSheets?: any[];
  rootJobState?: any;
  onUpdateRootState?: (key: string, value: any) => void;
  resolvedDocuments?: { agreements: any[]; orderSheets: any[] };
  setResolvedDocuments?: React.Dispatch<React.SetStateAction<{ agreements: any[]; orderSheets: any[] }>>;
  isDocUploadingRef?: React.MutableRefObject<boolean>;
  /** Resolves to the category's server documents (signed URLs), or null on failure. */
  onUploadDocs?: (cat: 'agreement' | 'orderSheet', payloads: any[]) => Promise<any[] | null>;
  /** Re-reads the lead's stored documents for a category (no upload). */
  onRefreshDocs?: (cat: 'agreement' | 'orderSheet') => Promise<any[] | null>;
}

function renderField(
  field: any,
  value: any,
  onFieldValueChange: (val: any) => void,
  ctx?: {
    readOnly?: boolean;
    dealCenterData?: any;
    applyConditions?: boolean;
    verticalColor?: string;
    state?: Record<string, any>;
    onFieldChange?: (fieldId: string, val: any) => void;
    tab?: any;
    tabState?: any;
    section?: any;
    sectionState?: any;
    /** All sections on the tab — completes the rule context (ticket 1063 §3.1). */
    sections?: any[];
    combos?: any[];
    sectionFields?: any[];
    products?: any[];
    /** Edit mode (web `unlockAll`) — bypasses the colorSelection lock-when-not-required. */
    editMode?: boolean;
    /**
     * Label of the field's containing section / stack / accordion, when that
     * container already prints it as a heading. An interactive child whose own
     * label is identical (e.g. a Flooring "Existing Flooring Type" optionList
     * inside an "Existing Flooring Type" group) suppresses its own label so the
     * title isn't shown twice — the schema-driven `showLabel: false` case
     * generalised to catch containers that repeat their single field's name.
     */
    parentLabel?: string;
  }
) {
  const {
    readOnly = false,
    dealCenterData = {},
    applyConditions = true,
    state = {},
    editMode = false,
  } = ctx || {};

  // Zeroing an Extras quantity clears the colour that belongs to it. Ticket:
  // *"currently when user change the value from 1 to 0 the colour still available
  // but i dont need color if the ground spout value is 0."* In the deal-edit
  // wizard both fields are editable, so the read-only suppression in the locked
  // branch below never runs — the colour has to be CLEARED, not just hidden, or a
  // colour for an extra that is no longer on the job rides along into the
  // addendum. `findPairedColorFields` scopes this to the Extras convention — the
  // colour must FOLLOW A QUANTITY, so a combination's own picker (which follows a
  // size/type toggle) is never cleared — and skips an unconditionally-required
  // colour, which would otherwise disable Next. See `locked-color-defaults.ts`.
  const onChange = (val: any) => {
    onFieldValueChange(val);
    if (hasEnteredQuantity(val) || !ctx?.onFieldChange) return;
    findPairedColorFields(field, ctx?.sectionFields).forEach((colorField: any) => {
      if (!hasEnteredQuantity(state?.[colorField.id])) return;
      ctx.onFieldChange?.(colorField.id, '');
    });
  };
  // Selected controls are always green (normal-JB parity), not the vertical color.
  const verticalColor = SELECTED_ACCENT;

  // Shared dependency-rule context — drives conditional defaults (isDefaultColorActive)
  // and conditional required-ness (isFieldRequired → `dependencies.requiredWhen`).
  const depCtx = {
    dealCenterData,
    sectionFields: ctx?.sectionFields,
    tab: ctx?.tab,
    tabState: ctx?.tabState,
    section: ctx?.section,
    sectionState: ctx?.sectionState ?? state,
    combos: ctx?.combos,
    // Ticket 1063 §3.1 — `sections` completes the rule context that
    // `buildRuleEvaluationContext` expects; `findFieldContextOnTab` feeds it to
    // `buildTabForFieldOptions` when resolving a compound `sectionId:fieldId` ref.
    // ⚠️ On mobile this is belt-and-braces, NOT the fix the spec expects it to be:
    // `findFieldContextOnTab` already falls back to `getTabSections(tab)`, so a
    // compound ref resolves correctly without it (verified against the live
    // LeafFilter shape — width gated on profile, both nested in a stack). It is
    // read straight off `tab` rather than via `getTabSections` because this runs
    // per field and that call normalizes every section.
    sections: ctx?.sections ?? ctx?.tab?.sections,
    // Carries the flow (create vs My Deals edit) through to `flow` rules.
    editMode: Boolean(editMode),
  };

  // Web parity (resolveEffectiveColorBehavior): a color field with an active
  // configured default shows that default as its selected swatch when the rep
  // hasn't picked one — so a field that validation counts as complete (via
  // isDefaultColorActive) is not rendered blank.
  const resolveSwatchValue = () => {
    // Same rule as the locked row, for the EDITABLE picker: a colour whose paired
    // quantity is empty is not on the job, so it shows nothing — including a
    // phantom already stored on a deal saved before this rule existed.
    // NOT gated on `isFieldLocked` — the Extras colour is authored as a plain
    // editable swatch on the live config, which is why the first pass did nothing
    // on device. `isPairedQuantityEmpty` scopes it instead: it only pairs a colour
    // that FOLLOWS A QUANTITY, so a combination's own picker (which follows a size
    // or type toggle) is untouched.
    if (field.required !== true) {
      const quantityEmpty = isPairedQuantityEmpty(field, {
        fields: ctx?.sectionFields,
        state,
        dealCenterData,
      });
      if (quantityEmpty) return '';
    }
    if (value) return value;
    return (isDefaultColorActive(field, state, depCtx) ? field.defaultValue : '') || '';
  };

  // Web parity: swatch colors come from the tab's product colors first (attached
  // by `enrichConfigWithProductColors`), then the legacy field palette/colors.
  // These carry imageUrl/bucketName/filePath so the picker can show a product image.
  const resolveSwatchColors = () => {
    const fromProduct = resolveColorsForField(field, ctx?.tab, ctx?.products);
    if (fromProduct.length) return fromProduct;
    return field.palette ? resolveColorPalette(field.palette) : field.colors || undefined;
  };

  // Web parity (`field-registry.js`): a locked field is read-only ONLY when NOT in
  // edit mode. In the My Deals deal-EDIT flow (`editMode`/`unlockAll`) EVERY field is
  // editable — the rep can override any calculator-locked value — so a locked field
  // must fall through to its editable widget instead of rendering a read-only box.
  if (readOnly || (field.locked && !editMode)) {
    // Web parity: EVERY LockedField call site in field-registry.js resolves its
    // display value with `resolveLockedValue(field, dealCenterData)` — the field's
    // `dcField`/`dcFields` deal-center reference, falling back to `defaultValue`
    // then '—'. Reading the raw `value` (the combination's OWN state) meant a
    // locked field only showed a value in the combination that happened to carry
    // one in state — e.g. LeafFilter Profile rendered blank on Combination #2
    // while #1 showed "Versa Max". resolveLockedValue is combination-independent.
    // A locked COLOUR slot whose paired quantity is empty must not paint the
    // portal's configured default (see `locked-color-defaults.ts`): an Extras row
    // reading `Ground Spout 0` beside `Color Black` describes a colour for an extra
    // that is not on the job. Suppressed → the same '—' its unconfigured neighbour
    // (`Replace Corner ▸ Color`) already shows, and the saved-state fallback below
    // is skipped too — a lead saved BEFORE this fix still carries the phantom
    // colour in its stored state.
    const colorSuppressed = isPairedQuantityEmpty(field, {
      fields: ctx?.sectionFields,
      state,
      dealCenterData,
    });
    const lockedValue = resolveLockedValue(field, dealCenterData, {
      fallbackDefault: resolveLockedColorFallbackDefault(field, {
        fields: ctx?.sectionFields,
        state,
        dealCenterData,
        depCtx,
      }),
    });
    if (field.colorKey && (field.palette || field.colors)) {
      return (
        <LockedFieldWithColor
          key={field.id}
          label={field.label}
          value={colorSuppressed ? '—' : lockedValue}
          colorValue={colorSuppressed ? '' : value}
          colors={resolveSwatchColors()}
        />
      );
    }
    // resolveLockedValue reads ONLY the calculator snapshot (dealCenterData) via the
    // field's dcField/dcFields — combination-independent, which is why it's used here
    // (a per-combination `value` read once blanked Profile on Combination #2). But some
    // locked fields' saved entries are NOT in that snapshot on reopen: picked colours,
    // and calculator Extras (LeafFilter C-S-R / Corners / Sawzall Hanger / … and gutter
    // Extras) the rebuilt dealCenterData no longer carries — those surfaced blank ('—'
    // or empty). Their saved value DOES survive in state (the `value` arg). So prefer
    // the deal-center value when it resolves; ONLY when it is empty fall back to the
    // saved state value. This keeps the Profile fix intact (Profile still resolves via
    // dealCenterData) while restoring submitted Extras/colours that would show blank.
    const dcResolved = lockedValue !== undefined && lockedValue !== '—' && lockedValue !== '';
    const stateFallback =
      !colorSuppressed && (typeof value === 'string' || typeof value === 'number') && value !== ''
        ? value
        : undefined;
    const lockedDisplay = colorSuppressed
      ? '—'
      : dcResolved
        ? lockedValue
        : stateFallback ?? lockedValue;
    return <LockedField key={field.id} label={boxTitleFor(field, ctx)} value={lockedDisplay} />;
  }

  const normalizedType = field.widget || field.inputType || field.type;

  // Web parity (field-registry.js): interactive fields hide their own label when
  // `showLabel === false` (e.g. a `sectionLabel` already titles the group above the
  // control — Roofing → Shingles "Shingle Type"). Mobile ignored this, so the
  // option/toggle/swatch printed a SECOND, duplicate label under the section title.
  // Also hide it when the field's label exactly repeats its container's heading
  // (`parentLabel`) — e.g. Flooring → Removal, an "Existing Flooring Type"
  // optionList sitting inside an "Existing Flooring Type" group showed the title
  // twice even when the schema didn't set `showLabel: false`.
  const repeatsParentLabel =
    !!ctx?.parentLabel && !!field.label && field.label === ctx.parentLabel;
  const visibleLabel = field.showLabel === false || repeatsParentLabel ? undefined : field.label;

  switch (normalizedType) {
    case 'text':
    case 'input':
      if (field.palette || field.colors?.length) {
        return (
          <SwatchPicker
            key={field.id}
            label={visibleLabel}
            value={resolveSwatchValue()}
            onChange={onChange}
            colors={resolveSwatchColors()}
            accentColor={verticalColor}
          />
        );
      }
      if ((field.options || field.choices || field.items)?.length) {
        const baseOpts = field.options || field.choices || field.items;
        // ⚠️ 2nd arg is the FULL rule context, never `dealCenterData` — see toggle-utils.
        const visOpts = filterVisibleToggleOptions({ ...field, options: baseOpts }, depCtx, state, applyConditions);
        return (
          <DynamicOptionField
            key={field.id}
            field={field}
            label={visibleLabel}
            options={visOpts}
            value={field.multiSelect ? (Array.isArray(value) ? value : []) : (value || '')}
            onChange={onChange}
            color={verticalColor}
            columns={optionColumnsFor(field)}
            isMulti={!!field.multiSelect}
          />
        );
      }
      return (
        <TextField
          key={field.id}
          label={field.label}
          placeholder={field.placeholder}
          value={value != null ? String(value) : ''}
          onChange={onChange}
          editable={!readOnly}
        />
      );

    case 'number': {
      // Web parity (field-registry.js `case 'number'`): a field that is required —
      // either statically (`field.required`) or conditionally via
      // `dependencies.requiredWhen` (e.g. Miters becomes required once measurements
      // are entered) — shows an "INCOMPLETE — Value Required" warning above it and
      // a ` *` on its label until a value is entered. `isRequiredFieldValueMissing`
      // treats 0/'0' as missing for number fields — EXCEPT miters/end caps, where a
      // typed 0 is a valid count (a straight run has none) and only a blank blocks.
      const showRequired =
        isFieldRequired(field, state, depCtx) && isRequiredFieldValueMissing(field, value);
      // Ticket "Job builder > Gutter > Downspout combination > Remove the required
      // message": suppress the amber "INCOMPLETE — Value Required" banner ONLY for the
      // Downspout combination (its section is labelled "Downspout & Accessories"),
      // while KEEPING it for every other required number field — e.g. the Measurements
      // combination. Commenting the banner out unconditionally (the earlier attempt)
      // stripped it from those other validations too. This is a deliberate mobile-only
      // divergence: the schema marks these fields required, so the shared render path
      // shows the banner everywhere unless scoped here. The ` *` on the label is left
      // as-is (still driven by showRequired), matching the ticket's "message"-only scope.
      const sectionLabel = String(
        ctx?.section?.label ?? ctx?.section?.name ?? ctx?.section?.title ?? ''
      );
      const inDownspoutCombination = /downspout/i.test(sectionLabel);
      const showRequiredWarning = showRequired && !inDownspoutCombination;
      return (
        <View key={field.id}>
          {showRequiredWarning && <IncompleteWarning message="INCOMPLETE — Value Required" />}
          <InputField
            label={field.label ? `${field.label}${showRequired ? ' *' : ''}` : undefined}
            placeholder={field.placeholder}
            value={value != null ? String(value) : ''}
            onChange={onChange}
            unit={field.unit}
            editable={!readOnly}
          />
        </View>
      );
    }

    case 'textarea': {
      // Web parity (field-registry textarea): show the amber "INCOMPLETE — Reason
      // Required" state when the reason is still needed. A reason field can signal
      // that two ways, so we honour BOTH:
      //   1. `required`/`requiredWhen` (via isFieldRequired) — Extra Labor Reason is
      //      only required once Extra Labor > 0.
      //   2. an authored `warningConfig` whose `visibleWhen` is satisfied — this is
      //      where the "Why is there additional labor?" copy comes from (same path
      //      the stack/accordion cases use).
      const taDepCtx = {
        dealCenterData,
        tab: ctx?.tab,
        tabState: ctx?.tabState,
        section: ctx?.section,
        sectionState: ctx?.sectionState,
        combos: ctx?.combos,
        sectionFields: ctx?.sectionFields,
      };
      const taRuleCtx = {
        dealCenterData,
        state,
        tab: ctx?.tab,
        tabState: ctx?.tabState,
        section: ctx?.section,
        sectionState: ctx?.sectionState,
        combos: ctx?.combos,
      };
      // isFieldRequired covers `required` + `dependencies.requiredWhen`; some schemas
      // author the rule at the top level (`field.requiredWhen`), so honour that too.
      const taTopRequiredWhen = field?.requiredWhen;
      const taRequired =
        isFieldRequired(field, state, taDepCtx) ||
        (!!taTopRequiredWhen && evaluateRuleGroup(taTopRequiredWhen, taRuleCtx));
      const taEmpty = value == null || String(value).trim() === '';
      const taWarning = getWarningConfig(field);
      const taWarningVisible =
        !!taWarning &&
        (!taWarning.visibleWhen ||
          evaluateRuleGroup(taWarning.visibleWhen, {
            dealCenterData,
            state,
            tab: ctx?.tab,
            tabState: ctx?.tabState,
            section: ctx?.section,
            sectionState: ctx?.sectionState,
          }));
      const taIncomplete = !readOnly && ((taRequired && taEmpty) || taWarningVisible);
      return (
        <TextareaField
          key={field.id}
          label={field.label}
          placeholder={field.placeholder}
          value={value != null ? String(value) : ''}
          onChange={onChange}
          rows={field.rows || 3}
          incomplete={taIncomplete}
          incompleteMessage={taWarning?.message || 'Reason Required'}
        />
      );
    }

    case 'toggle': {
      const baseOpts = field.options || field.choices || field.items || [];
      // ⚠️ 2nd arg is the FULL rule context, never `dealCenterData` — see toggle-utils.
      const visOpts = filterVisibleToggleOptions({ ...field, options: baseOpts }, depCtx, state, applyConditions);
      const toggleValue = field.multiSelect ? (Array.isArray(value) ? value : []) : (value || '');
      return (
        <OptionToggleField
          key={field.id}
          label={visibleLabel}
          options={visOpts}
          value={toggleValue}
          onChange={onChange}
          isMulti={!!field.multiSelect}
        >
          <ToggleGroup
            label={visibleLabel}
            options={visOpts}
            value={toggleValue}
            onChange={onChange}
            color={verticalColor}
            isMulti={!!field.multiSelect}
          />
        </OptionToggleField>
      );
    }

    case 'optionList': {
      const baseOpts = field.options || field.choices || field.items || [];
      // ⚠️ 2nd arg is the FULL rule context, never `dealCenterData` — see toggle-utils.
      const visOpts = filterVisibleToggleOptions({ ...field, options: baseOpts }, depCtx, state, applyConditions);
      const listValue = field.multiSelect ? (Array.isArray(value) ? value : []) : (value || '');
      return (
        <OptionToggleField
          key={field.id}
          label={visibleLabel}
          options={visOpts}
          value={listValue}
          onChange={onChange}
          isMulti={!!field.multiSelect}
        >
          <DynamicOptionField
            field={field}
            label={visibleLabel}
            options={visOpts}
            value={listValue}
            onChange={onChange}
            color={verticalColor}
            columns={optionColumnsFor(field)}
            isMulti={!!field.multiSelect}
          />
        </OptionToggleField>
      );
    }

    case 'dropdown':
    case 'select': {
      // Ticket 1063. `getVisibleFieldOptions` does BOTH jobs in one call: it reads
      // `optionShowFields` KEYS for a dependency-mode dropdown (`field.options` is
      // stale for those) and then applies the per-option `optionVisibility` rules
      // against the full `depCtx`. The `choices`/`items` fallback is kept only for
      // non-standard `select` shapes that carry neither `options` nor
      // `optionShowFields`.
      const ruleOpts = getVisibleFieldOptions(field, depCtx, state, applyConditions);
      // ⚠️ The `choices`/`items` fallback is for a non-standard `select` that carries
      // NEITHER `options` NOR `optionShowFields` — it must never fire because the
      // RULES said no. Ungated, a field that deliberately ruled every option out
      // would fall back to its full raw list. Nothing in the DB hits that today, but
      // the two cases are opposites and the gate keeps them apart.
      const hasAuthoredOptions = !!field.options?.length || !!field.optionShowFields;
      const opts =
        (ruleOpts.length || hasAuthoredOptions ? ruleOpts : field.choices || field.items) || [];

      // A dropdown that rules out every option renders NOTHING, by design — but on
      // screen that is indistinguishable from a field the config forgot, and it
      // cost several rounds of guessing from screenshots to tell the two apart.
      // This says which rule did it and what the referenced field actually held.
      if (__DEV__ && !opts.length && hasAuthoredOptions) {
        const why = Object.entries(field.optionVisibility || {}).map(([opt, group]: [string, any]) => {
          const refs = ((group?.rules || [group]) as any[])
            .filter(Boolean)
            .flatMap((r: any) => (r?.fieldIds?.length ? r.fieldIds : r?.fieldId ? [r.fieldId] : r?.fields?.length ? r.fields : r?.field ? [r.field] : []))
            .map((ref: string) => {
              const id = ref.includes(':') ? ref.split(':').pop() : ref;
              return `${ref}=${JSON.stringify(state?.[id as string])}`;
            });
          return `${opt} needs [${refs.join(', ')}]`;
        });
        console.log(
          `[Dropdown] "${field.label || field.id}" hidden — 0 of ${(field.options || Object.keys(field.optionShowFields || {})).length} options visible. ${why.join(' | ')}`
        );
      }
      // Web parity: `disabled` ("Rep can use this dropdown → No") greys the field
      // out everywhere EXCEPT the deal-edit wizard, which unlocks every field —
      // same `&& !editMode` rule as the `colorSelection` lock below.
      const dropdownDisabled = Boolean(field.disabled) && !editMode;
      return (
        <DropdownField
          key={field.id}
          field={field}
          label={visibleLabel}
          options={opts}
          value={field.multiSelect ? (Array.isArray(value) ? value : []) : (value || '')}
          onChange={onChange}
          color={verticalColor}
          columns={optionColumnsFor(field)}
          isMulti={!!field.multiSelect}
          disabled={dropdownDisabled || readOnly}
          // Title for the DISABLED box only; the chip grid / picker keeps
          // `visibleLabel` above, whose suppression rules still apply there.
          boxLabel={boxTitleFor(field, ctx)}
          defaultValue={resolveEffectiveDefaultValue(field, state, depCtx)}
          // Display-only fallback for the disabled box: the SAME resolution the
          // locked branch uses, so a dropdown the calculator answers shows its
          // value instead of '—'. '—' is that helper's "unresolvable" marker.
          fallbackValue={(() => {
            const dc = resolveLockedValue(field, dealCenterData, {
              fallbackDefault: resolveConditionalDefault(field, state, depCtx),
            });
            return dc === undefined || dc === '—' || dc === '' ? undefined : String(dc);
          })()}
          readOnly={readOnly}
        />
      );
    }

    // Web parity (field-registry.js `case 'colorSelection'`): the colour slot for a
    // gutter Extra is locked while its linked extra has no value — the portal opts
    // in per-field via `lockWhenNotRequired`, and the field's `requiredWhen` decides
    // when it becomes editable. Locked → the compact "—" + padlock row instead of
    // the editable picker, so an untouched Extra no longer shows a colour selector.
    // Only `colorSelection` is gated; plain `swatch`/`color` fields are untouched.
    case 'colorSelection': {
      const { effectiveDefault, effectiveLocked } = resolveEffectiveColorBehavior(
        field,
        state,
        depCtx,
        isFieldRequired(field, state, depCtx),
        editMode
      );
      // Web parity: render the read-only colour ONLY outside the edit flow — in edit
      // mode every colour is editable (`effectiveLocked && !editMode`).
      if (effectiveLocked && !editMode) {
        // The rep's picked colour lives in state (`value` = item[field.id]) and
        // survives the save round-trip; it is NOT a deal-center value, so
        // resolveLockedValue returns '—'. Prefer the saved colour so a submitted
        // Extra's colour shows on reopen (previously showed '—').
        // Web parity (`resolveLockedColorValue`): the fallback default is the
        // CONDITION-RESOLVED one, never the raw `field.defaultValue` — and it is ''
        // when the colour's paired quantity is empty, so an unquoted Extra reads '—'
        // instead of the portal's default colour (`locked-color-defaults.ts`).
        const quantityEmpty = isPairedQuantityEmpty(field, {
          fields: ctx?.sectionFields,
          state,
          dealCenterData,
        });
        const colorFallbackDefault = quantityEmpty
          ? ''
          : resolveConditionalDefault(field, state, depCtx);
        const lockedColor =
          (quantityEmpty ? '' : value) ||
          resolveLockedValue(field, dealCenterData, { fallbackDefault: colorFallbackDefault }) ||
          (quantityEmpty ? '' : effectiveDefault) ||
          '—';
        return (
          <LockedField
            key={field.id}
            label={field.showLabel === false ? undefined : field.label || 'Color'}
            value={lockedColor}
          />
        );
      }
      // Web parity (`case 'colorSelection'` unlocked): render the compact
      // `CompactColorPicker` — a "Color (Required)" caption over a single "＋ Color"
      // box that opens the colour sheet — NOT the full inline swatch grid. The
      // "(Required)" suffix (warning amber) shows only while required + empty.
      const colorRequired = isFieldRequired(field, state, depCtx);
      const colorValue = resolveSwatchValue();
      const showColorLabel = field.showLabel !== false || (colorRequired && !colorValue);
      return (
        <View key={field.id}>
          {showColorLabel && (
            <Text className="text-[11px] font-black text-slate-400 mb-2">
              {field.showLabel !== false ? field.label || 'Color' : ''}
              {colorRequired && !colorValue && (
                <Text style={{ color: '#FFAB00' }}>
                  {field.showLabel !== false ? ' ' : ''}(Required)
                </Text>
              )}
            </Text>
          )}
          <SwatchPicker
            compact
            value={colorValue}
            onChange={onChange}
            colors={resolveSwatchColors()}
            accentColor={verticalColor}
          />
        </View>
      );
    }

    case 'swatch':
    case 'color':
      return (
        <SwatchPicker
          key={field.id}
          label={visibleLabel}
          value={resolveSwatchValue()}
          onChange={onChange}
          colors={resolveSwatchColors()}
          accentColor={verticalColor}
        />
      );

    // Widget-owned palette (web `customColor`, field-registry.js:451) — its own
    // admin-defined swatches (e.g. the Lightning "wire box" selection), NOT product
    // colors. Was unhandled → fell through to `default: null`, so the selection UI
    // was missing while a required message for it still showed elsewhere.
    case 'customColor': {
      const customColors = field.customColors || [];
      if (!customColors.length) return null;
      return (
        <SwatchPicker
          key={field.id}
          label={field.showLabel === false ? undefined : field.label}
          value={resolveSwatchValue()}
          onChange={onChange}
          colors={customColors}
          accentColor={verticalColor}
        />
      );
    }

    case 'locationGrid':
    case 'grid':
      return (
        <LocationGrid
          key={field.id}
          label={field.label}
          value={value || {}}
          onChange={onChange}
          field={field}
          singleStory={field.singleStory}
          dealCenterData={dealCenterData}
          state={state}
          applyConditions={applyConditions}
        />
      );

    case 'roomPicker':
    case 'room':
      return (
        <RoomPicker
          key={field.id}
          label={visibleLabel}
          value={value || []}
          onChange={onChange}
          roomSet={field.roomSet}
          color={verticalColor}
        />
      );

    case 'sectionLabel':
      return (
        <SectionLabel key={field.id} title={field.title || field.label || ''} />
      );

    case 'allocation':
      return renderAllocationCard(field, ctx || {});

    case 'locked':
      // Edit flow (web `case 'locked'` + editMode): render an editable input so the
      // rep can override the calculator-locked value; read-only otherwise.
      if (editMode) {
        return (
          <View key={field.id} className="mb-4">
            <TextField
              label={field.label}
              placeholder={field.placeholder}
              value={value != null ? String(value) : ''}
              onChange={onChange}
              editable={!readOnly}
            />
          </View>
        );
      }
      return (
        <LockedField
          key={field.id}
          label={field.label}
          value={value ?? field.defaultValue ?? '—'}
        />
      );

    case 'inputWithColor':
    case 'lockedWithColor': {
      const colorFromState = field.colorKey ? ctx?.state?.[field.colorKey] : undefined;
      const colorVal = colorFromState ?? value;
      const handleColorChange = field.colorKey && ctx?.onFieldChange
        ? (v: any) => ctx.onFieldChange!(field.colorKey, v)
        : onChange;

      // Web parity (`lockedWithColor` → `{ ...field, locked: !editMode }`): locked
      // only outside the edit flow; in edit mode it falls through to the editable
      // input + swatch picker below so the rep can change the value AND the color.
      if ((field.locked || field.type === 'lockedWithColor') && !editMode) {
        if (field.colorKey && (field.palette || field.colors)) {
          return (
            <LockedFieldWithColor
              key={field.id}
              label={field.label}
              value={value ?? field.defaultValue ?? '—'}
              colorValue={colorVal}
              colors={resolveSwatchColors()}
            />
          );
        }
        return (
          <LockedField
            key={field.id}
            label={field.label}
            value={value ?? field.defaultValue ?? '—'}
          />
        );
      }
      return (
        <View key={field.id} className="mb-4">
          <TextField
            label={field.label}
            placeholder={field.placeholder}
            value={value != null ? String(value) : ''}
            onChange={onChange}
            editable={!readOnly}
          />
          {(field.palette || field.colors?.length) && (
            <View className="mt-2">
              <SwatchPicker
                label="Color"
                value={colorVal || ''}
                onChange={handleColorChange}
                colors={resolveSwatchColors()}
                accentColor={verticalColor}
              />
            </View>
          )}
        </View>
      );
    }

    case 'combinationSummary':
      return null;

    case 'stack':
    case 'accordion': {
      const childFields = field.fields || [];
      if (!childFields.length) return null;

      // Container children live FLAT in the parent state: buildDefaultItemFromFields
      // seeds them via flattenLeafFields (combo[childId], not combo[containerId][childId])
      // and tab-validation reads them flat. So read children from `state` (the flat
      // parent) and write via the flat `onFieldChange` — NOT a nested container slot.
      // Matches web field-registry (containers are pure layout). Using the nested
      // `value` slot here would make required container children uncompletable.
      const parentState = state || {};
      const writeChild = ctx?.onFieldChange || onChange;
      const childDepCtx = {
        dealCenterData,
        tab: ctx?.tab,
        tabState: ctx?.tabState,
        section: ctx?.section,
        sectionState: ctx?.sectionState,
        sectionFields: childFields,
        combos: ctx?.combos,
      };

      // Per-child visibility from the schema (visibleWhen / dropdown reveal), scoped
      // to the container's own children so intra-container dropdown reveal resolves.
      // Render eagerly and drop nulls so we can tell whether the container is empty.
      const isChildRenderable = (child: any) => {
        if (!applyConditions) return true;
        return isFieldVisibleWithConditions(child, parentState, childDepCtx, applyConditions);
      };

      // An allocation tracker (every VISIBLE child is an allocation card) lays its
      // cards out in a grid instead of a stack, so they need compact + fill-height.
      // Judging this on the visible children — not every authored child — means a
      // card hidden by a condition can't force the whole tracker into the dropdown.
      const visibleChildFields = childFields.filter(isChildRenderable);
      const isAllocationTracker =
        visibleChildFields.length > 0 && visibleChildFields.every(isAllocationChild);
      const allocationChildCtx =
        isAllocationTracker && normalizedType === 'accordion'
          ? { compactAllocation: true, allocationFillHeight: true }
          : null;

      // Heading this container prints for itself — a child whose label repeats it
      // suppresses its own duplicate label (see `parentLabel` in renderField).
      const containerLabel =
        field.label && field.showLabel !== false ? field.label : undefined;
      const renderedChildren = visibleChildFields
        .map((child: any) => {
          const childVal = parentState?.[child.id];
          const childOnChange = (v: any) => writeChild(child.id, v);
          return renderField(child, childVal, childOnChange, {
            ...(ctx || {}),
            sectionFields: childFields,
            parentLabel: containerLabel,
            ...(allocationChildCtx || {}),
          });
        })
        .filter(Boolean);

      const warning = getWarningConfig(field);
      const showWarning =
        !!warning &&
        (!warning.visibleWhen ||
          evaluateRuleGroup(warning.visibleWhen, {
            dealCenterData,
            state: parentState,
            tab: ctx?.tab,
            tabState: ctx?.tabState,
            section: ctx?.section,
          }));

      // The accordion keeps its existing filled banner.
      const warningBanner = showWarning ? (
        <View
          className="mt-1 mb-2 px-3 py-2 rounded-lg"
          style={{
            backgroundColor: `${warning.color || '#f59e0b'}1A`,
            borderWidth: 1,
            borderColor: warning.color || '#f59e0b',
          }}
        >
          <Text className="text-[12px] font-semibold" style={{ color: warning.color || '#b45309' }}>
            ⚠️ {warning.message}
          </Text>
        </View>
      ) : null;

      // Web parity (field-registry `case 'stack'`): the stack's warning is PLAIN
      // amber text rendered inside the bordered container above the fields — web
      // gives it no fill/border of its own (the filled banner was a mobile-only
      // divergence). Colour + weight mirror web's `<Typography variant="caption"
      // fontWeight={700} color={warning.color}>`.
      const warningNode = showWarning ? (
        <Text className="text-[12px] font-bold mb-2" style={{ color: warning.color || '#f59e0b' }}>
          ⚠️ {warning.message}
        </Text>
      ) : null;

      // `accordion` → collapsible card with an allocation status badge in the header
      // (web JobBuilderFieldAccordion + resolveAccordionAllocationStatus). `stack` →
      // a plain inline group (web renders it as a bordered/plain Box).
      if (normalizedType === 'accordion') {
        // Hide-when-empty: no renderable children and no active warning → drop the
        // whole accordion card rather than show an empty titled shell (footage
        // accordion tracker returns empty in this section → no card).
        if (!renderedChildren.length && !showWarning) return null;

        const status = resolveAccordionAllocationStatus(field, {
          ...(ctx || {}),
          value: parentState,
          sectionState: ctx?.sectionState ?? parentState,
          sectionFields: childFields,
          applyConditions,
        });
        const badge = status ? { type: status.type, message: status.label } : null;

        // Allocation cards render two-up in a grid (equal heights) rather than
        // one per row. Non-allocation accordions keep their plain stack.
        const contents = isAllocationTracker ? (
          <AllocationCardGrid columns={resolveMobileGridColumns(field.mobileColumns) ?? ALLOCATION_GRID_COLS}>
            {renderedChildren}
          </AllocationCardGrid>
        ) : (
          renderedChildren
        );

        // Web parity (field-registry `case 'accordion'`): an allocation tracker
        // shows its cards INLINE — no accordion chrome — when it has
        // ALLOCATION_INLINE_MAX (4) or fewer visible cards, so the rep sees them
        // at a glance. Only MORE than that collapses behind the header.
        if (isAllocationTracker && renderedChildren.length <= ALLOCATION_INLINE_MAX) {
          return (
            <View key={field.id} className="px-3 mb-3">
              {contents}
              {warningBanner}
            </View>
          );
        }

        return (
          <AccordionSection
            key={field.id}
            label={field.label}
            icon={field.icon || 'chart-box-outline'}
            defaultExpanded={field.defaultExpanded !== false}
            badge={badge}
          >
            {contents}
            {warningBanner}
          </AccordionSection>
        );
      }

      // Web parity (field-registry `labelNode`): a stack/layout container only shows
      // its label when `showLabel !== false`. Containers authored with showLabel:false
      // (e.g. the Fascia Wrap "Stack" group) are pure layout — no heading is drawn.
      const showStackLabel = !!field.label && field.showLabel !== false;
      const labelNode = showStackLabel ? <SectionLabel title={field.label} /> : null;

      // Web parity (field-registry `case 'stack'`): a stack renders inside a
      // bordered container when it's explicitly `bordered` OR currently warning.
      // The warning colour wins for the border, and the container carries a very
      // faint tint of it (`${color}08`). Colours only — child field layout/sizing
      // is untouched.
      const showContainer = field.bordered === true || showWarning;
      const effectiveBorderColor =
        (showWarning && warning?.color ? warning.color : getEffectiveBorderColor(field)) || undefined;

      // Web parity (`getFieldGridSx` at the `xs` breakpoint): a stack lays its
      // children into a `mobileColumns`-wide grid, falling back to a single
      // stacked column when the schema doesn't configure one — so nothing changes
      // for stacks that aren't grid-configured. This is what pairs each gutter
      // Extra with its Color on one row (extras stack → mobileColumns: 2).
      const stackCols = resolveMobileGridColumns(field.mobileColumns);
      const stackContent = stackCols && stackCols > 1
        ? <StackFieldGrid columns={stackCols}>{renderedChildren}</StackFieldGrid>
        : renderedChildren;

      /**
       * ⚠️ ONE container, styled conditionally — NOT two different JSX trees, and the
       * children must keep FIXED POSITIONS.
       *
       * This branch used to return a bare `<View>` when there was no warning and a
       * bordered one when there was, with `warningNode` inserted between the label and
       * the fields only in the second. React reconciles unkeyed children BY INDEX, so
       * the moment a warning cleared, `stackContent` moved from index 1 to index 2 and
       * React tore the whole subtree down and rebuilt it.
       *
       * What that looked like: in Lighting ▸ Measurements, typing the FIRST digit takes
       * the grid total from 0 to non-zero, which satisfies "Allocate remaining footage",
       * so the warning cleared, the grid remounted, the `TextInput` was destroyed
       * mid-edit and the keyboard dismissed. Every keystroke after that was
       * warning-off → warning-off, nothing moved, and it behaved — which is exactly the
       * "only the first time" the ticket describes.
       *
       * `labelNode` and `warningNode` are rendered unconditionally (they are `null` when
       * absent). A `null` child still OCCUPIES its slot in the children array, so
       * `stackContent` now sits at index 2 whatever the warning does, and the grid is
       * never remounted. Do not collapse these back into `&&` short-circuits or move
       * them behind an early return.
       */
      return (
        <View
          key={field.id}
          className={showContainer || showStackLabel ? 'mb-4' : ''}
          style={
            showContainer
              ? {
                borderWidth: 2,
                borderColor: effectiveBorderColor || 'rgba(0,0,0,0.08)',
                borderRadius: 8,
                padding: 12,
                backgroundColor: showWarning && effectiveBorderColor ? `${effectiveBorderColor}08` : '#fff',
              }
              : undefined
          }
        >
          {labelNode}
          {warningNode}
          {stackContent}
        </View>
      );
    }

    default:
      return null;
  }
}

function CombinationSectionBlock({
  section,
  combos,
  comboIndexOffset = 0,
  sectionState,
  onSectionStateChange,
  readOnly,
  onUpdateCombos,
  verticalColor,
  tab,
  tabState,
  dealCenterData,
  applyConditions,
  hideAllocations,
  editMode,
}: {
  section: any;
  combos: any[];
  comboIndexOffset: number;
  sectionState: any;
  onSectionStateChange: (stateOrUpdater: any) => void;
  readOnly?: boolean;
  onUpdateCombos: (combos: any[]) => void;
  verticalColor?: string;
  tab?: any;
  tabState?: any;
  dealCenterData?: any;
  applyConditions?: boolean;
  hideAllocations?: boolean;
  editMode?: boolean;
}) {
  const applyDep = applyConditions !== false;
  const allFields = section.fields || [];

  const headerFields = getCombinationSectionHeaderFields(section).filter((f: any) => f.type !== 'accordion');
  const visibleHeaderFields = filterFields(headerFields, tabState, tab, section, sectionState, combos, dealCenterData, applyDep);
  // Per-combo repeatable fields (excludes allocation / section-scoped / summary / label).
  // Visibility is resolved per-combo below so combo-sibling visibleWhen rules work.
  const baseRowFields = getCombinationSectionRowFields(section).filter((f: any) => f.type !== 'accordion');
  const canAddCombo = canAddMoreCombinations(section);

  // My Deals: a SAVED combination whose colour was never picked is hidden (see
  // `combination-color-filter.ts`); one the rep adds here is not. Computed ONCE here
  // so the render loop, the numbering and the "Add Combination" button below cannot
  // disagree about which combos are on screen.
  const isComboHidden = (combo: any) =>
    isComboHiddenInDealEdit(combo, getFlattenedCombinationSectionRowFields(section), editMode);
  const visibleComboCount = combos.filter((combo: any) => !isComboHidden(combo)).length;
  // The parent is the first combination SHOWN (a hidden saved one can precede it).
  const firstShownIndex = Math.max(0, combos.findIndex((combo: any) => !isComboHidden(combo)));
  // Chip numbers by position among the SHOWN combinations only, so a hidden one
  // leaves no gap (`-1` for a hidden combination, which never renders).
  let shownCount = 0;
  const chipNumbers = combos.map((combo: any) =>
    isComboHidden(combo) ? -1 : comboIndexOffset + ++shownCount
  );
  // Portal-controlled: whether the "Combination #N" chip is shown on Sales
  // (web `dynamic-tab-renderer.js:233`). Sections that hold a single logical
  // configuration — Downspout & Accessories, Measurements — switch it off in the
  // admin portal, where numbering the lone card reads as noise. Defaults to
  // shown, so schemas without the flag are unaffected.
  const showCombinationLabel = (section as any)?.showCombinationLabel !== false;
  // Web parity (dynamic-tab-renderer.js): each combination shows its own footage
  // total, read from the combo's locationGrid field, under that combo's fields.
  const gridField = getFlattenedCombinationSectionRowFields(section).find((f: any) => f.type === 'locationGrid');
  const gridKey = gridField?.id || gridField?.key || 'grid';

  const handleSectionStateChange = (fieldId: string, val: any) => {
    if (readOnly) return;
    onSectionStateChange((prev: any) => ({ ...prev, [fieldId]: val }));
  };

  const handleComboFieldChange = (comboIndex: number, fieldId: string, val: any) => {
    if (readOnly) return;
    const next = [...combos];
    next[comboIndex] = { ...next[comboIndex], [fieldId]: val };
    onUpdateCombos(next);
  };

  const handleAddCombo = () => {
    if (readOnly || !canAddCombo) return;
    const added = createNextCombinationItem(section, combos, comboIndexOffset);
    // My Deals: mark it so the colour filter does not hide it before a colour is
    // picked — that is what made this button look dead. Session-only, never saved.
    onUpdateCombos([...combos, editMode ? { ...added, [ADDED_IN_EDIT_KEY]: true } : added]);
  };

  const handleRemoveCombo = (index: number) => {
    if (readOnly || isParentCombination(index, firstShownIndex)) return;
    const next = combos
      .filter((_, i) => i !== index)
      .map((combo, idx) => ({ ...combo, _combinationNumber: comboIndexOffset + idx + 1 }));
    onUpdateCombos(next);
  };

  return (
    <View className="mb-3">
      {section.label && <SectionLabel title={section.label} />}

      {!hideAllocations && filterFields(allFields.filter(isAllocationField), tabState, tab, section, sectionState, combos, dealCenterData, applyDep)
        .map((field: any) => renderAllocationCard(field, {
          dealCenterData,
          tab,
          tabState,
          section,
          sectionState,
          combos,
          sectionFields: allFields,
        }))}

      {visibleHeaderFields.map((field: any) => {
        const val = sectionState?.[field.id];
        return renderField(field, val, (v) => handleSectionStateChange(field.id, v), {
          readOnly,
          verticalColor,
          dealCenterData,
          applyConditions: applyDep,
          state: sectionState,
          onFieldChange: handleSectionStateChange,
          tab,
          tabState,
          section,
          sectionState,
          combos,
          sectionFields: allFields,
          parentLabel: section.label,
          editMode,
        });
      })}

      {combos.map((combo: any, comboIndex: number) => {
        // My Deals only: a combination whose colour was never picked is unfinished
        // and is hidden from the edit wizard. DISPLAY ONLY — the combination stays
        // in job state and round-trips untouched, and the create flow (where the
        // rep is still filling colours in) is deliberately not filtered.
        //
        // ⚠️ Returning null INSIDE the map rather than filtering `combos` first:
        // every handler below is bound to `comboIndex`, and `handleRemoveCombo`
        // renumbers by position, so a filtered array would edit and delete the
        // wrong combination.
        if (isComboHidden(combo)) return null;

        const borderThemeColor = COMBINATION_COLORS[comboIndex % COMBINATION_COLORS.length];
        // By position, so the chip is right at run time even before a stale stored
        // number has been rewritten by the next edit.
        const combinationNumber = chipNumbers[comboIndex];
        const comboTotal = gridField ? computeGridTotal(combo[gridKey]) : 0;
        // The first combination is the section's PARENT — the one hydration seeds
        // (locked from the Job Summary). Only rep-added combinations after it can be
        // removed. Positional on purpose: hydration keeps only known
        // keys plus `_combinationNumber`, so a marker flag would not survive a reload.
        const canEditCombo = !readOnly && !isParentCombination(comboIndex, firstShownIndex);

        return (
          <SectionCard key={combo._combinationNumber ?? comboIndex} borderColor={borderThemeColor}>
            <View className="flex-row items-center justify-between mb-3">
              {showCombinationLabel ? (
                <View className="px-3 py-1 rounded-lg" style={{ backgroundColor: `${borderThemeColor}1A` }}>
                  <Text className="text-[10px] font-black" style={{ color: borderThemeColor }}>
                    Combination #{combinationNumber}
                  </Text>
                </View>
              ) : (
                // Spacer keeps Remove right-aligned when the chip is hidden (web parity).
                <View />
              )}
              {canEditCombo && (
                <TouchableOpacity onPress={() => handleRemoveCombo(comboIndex)}>
                  <Text className="text-xs text-red-500 font-black">Remove</Text>
                </TouchableOpacity>
              )}
            </View>

            {filterFields(baseRowFields, tabState, tab, section, combo, combos, dealCenterData, applyDep, allFields).map((field: any) => {
              const val = combo?.[field.id];
              const comboOnFieldChange = (fieldId: string, v: any) => handleComboFieldChange(comboIndex, fieldId, v);
              return renderField(field, val, (v) => handleComboFieldChange(comboIndex, field.id, v), {
                readOnly,
                verticalColor,
                dealCenterData,
                applyConditions: applyDep,
                state: combo,
                onFieldChange: comboOnFieldChange,
                tab,
                tabState,
                section,
                sectionState: combo,
                combos,
                sectionFields: allFields,
                parentLabel: section.label,
                editMode,
              });
            })}

            {comboTotal > 0 && (
              <Text className="text-[11px] font-bold mt-3" style={{ color: SELECTED_ACCENT }}>
                Combination total: {comboTotal} ft
              </Text>
            )}
          </SectionCard>
        );
      })}

      {/*
        ⚠️ Hidden when the colour filter has emptied the section. Once every
        combination is filtered out, the bare "Add Combination" button was the only
        thing left of the section — the reported row of orphaned buttons under an
        otherwise empty LeafFilter tab. Adding one there would also create a
        combination with no colour, which the same filter hides the instant it is
        made, so the button could not do anything useful either.

        The CREATE flow is untouched: `isComboHidden` is false outside `editMode`,
        so `visibleComboCount` is simply `combos.length` there.
      */}
      {!readOnly && canAddCombo && visibleComboCount > 0 && (
        <AddCombinationButton onClick={handleAddCombo} />
      )}
    </View>
  );
}

function SimpleSectionBlock({
  section,
  sectionState,
  onSectionStateChange,
  readOnly,
  verticalColor,
  tab,
  tabState,
  dealCenterData,
  applyConditions,
  hideAllocations,
  editMode,
}: {
  section: any;
  sectionState: any;
  onSectionStateChange: (stateOrUpdater: any) => void;
  readOnly?: boolean;
  verticalColor?: string;
  tab?: any;
  tabState?: any;
  dealCenterData?: any;
  applyConditions?: boolean;
  hideAllocations?: boolean;
  editMode?: boolean;
}) {
  const applyDep = applyConditions !== false;

  const handleFieldChange = (fieldId: string, val: any) => {
    if (readOnly) return;
    onSectionStateChange((prev: any) => ({ ...prev, [fieldId]: val }));
  };

  const allFields = section.fields || [];
  const otherFields = filterFields(
    allFields.filter((f: any) => !isAllocationField(f) && f.type !== 'accordion'),
    tabState, tab, section, sectionState, [], dealCenterData, applyDep
  );

  if (!hideAllocations) {
    const allocationFields = filterFields(allFields.filter(isAllocationField), tabState, tab, section, sectionState, [], dealCenterData, applyDep);
    const allocCtx = {
      dealCenterData,
      tab,
      tabState,
      section,
      sectionState,
      combos: [],
      sectionFields: allFields,
    };

    return (
      <SectionCard>
        {section.label && <SectionLabel title={section.label} />}

        {allocationFields.map((field: any) => renderAllocationCard(field, allocCtx))}

        {otherFields.map((field: any) => {
          const val = sectionState[field.id];
          return renderField(field, val, (v) => handleFieldChange(field.id, v), {
            readOnly,
            verticalColor,
            dealCenterData,
            applyConditions: applyDep,
            state: sectionState,
            onFieldChange: handleFieldChange,
            tab,
            tabState,
            section,
            sectionState,
            combos: [],
            sectionFields: allFields,
            parentLabel: section.label,
            editMode,
          });
        })}
      </SectionCard>
    );
  }

  if (!otherFields.length) return null;

  return (
    <SectionCard>
      {section.label && <SectionLabel title={section.label} />}

      {otherFields.map((field: any) => {
        const val = sectionState[field.id];
        return renderField(field, val, (v) => handleFieldChange(field.id, v), {
          readOnly,
          verticalColor,
          dealCenterData,
          applyConditions: applyDep,
          state: sectionState,
          onFieldChange: handleFieldChange,
          tab,
          tabState,
          section,
          sectionState,
          combos: [],
          sectionFields: allFields,
          parentLabel: section.label,
          editMode,
        });
      })}
    </SectionCard>
  );
}

export function DynamicTabRenderer({
  tab,
  vertical,
  tabState,
  verticalState = {},
  lockedTabIds = [],
  onStateChange,
  dealCenterData,
  readOnly = false,
  applyConditions = true,
  verticalId,
  verticalColor = '#22c55e',
  products = [],
  schemas = [],
  repDetails,
  editMode,
  hideAllocationTrackers = false,
  collapsingScrollProps,
  collapsingUnderHeaderStyle,
  leadId,
  calculatorResultData,
  customerName,
  isSale,
  isDemo,
  scheduleTime,
  agreements = [],
  orderSheets = [],
  rootJobState,
  onUpdateRootState,
  resolvedDocuments,
  setResolvedDocuments,
  isDocUploadingRef,
  onUploadDocs,
  onRefreshDocs,
}: DynamicTabRendererProps) {
  if (tab.isSummary) {
    return (
      <VerticalSummaryTab
        vertical={vertical || { id: verticalId, tabs: [tab], color: verticalColor }}
        verticalState={verticalState}
        lockedTabIds={lockedTabIds}
        dealCenterData={dealCenterData}
        applyConditions={applyConditions}
        products={products}
        schemas={schemas}
        repDetails={repDetails}
        editMode={editMode}
        leadId={leadId}
        calculatorResultData={calculatorResultData}
        customerName={customerName}
        isSale={isSale}
        isDemo={isDemo}
        scheduleTime={scheduleTime}
        agreements={agreements}
        orderSheets={orderSheets}
        rootJobState={rootJobState}
        onUpdateRootState={onUpdateRootState}
        resolvedDocuments={resolvedDocuments}
        setResolvedDocuments={setResolvedDocuments}
        isDocUploadingRef={isDocUploadingRef}
        onUploadDocs={onUploadDocs}
        onRefreshDocs={onRefreshDocs}
        collapsingScrollProps={collapsingScrollProps}
      />
    );
  }

  const sections = getTabSections(tab);
  const tabFields = tab.fields || [];
  const hasTabFields = tabFields.length > 0;

  const updateField = (key: string, val: any) => {
    if (readOnly || !onStateChange) return;
    onStateChange((prev: any) => ({ ...prev, [key]: val }));
  };

  // My Deals: whether a combination is on screen (the colour filter hides unfinished
  // SAVED ones). Hidden combinations take no number, so the chips run with no gap.
  const isComboShown = (combo: any, section: any) =>
    !isComboHiddenInDealEdit(combo, getFlattenedCombinationSectionRowFields(section), editMode);

  // The combination sections that render, in order — the order the chips count in.
  const getRenderedCombinationSections = (state: any) =>
    sections.filter((section: any) =>
      section.sectionType !== 'simple' &&
      (section.fields || []).length > 0 &&
      !(applyConditions && !isSummarySectionVisible(section, state, dealCenterData, tab))
    );

  const updateSectionCombos = (sectionId: string, combos: any[]) => {
    if (readOnly || !onStateChange) return;
    onStateChange((prev: any) => {
      const next = {
        ...prev,
        comboGroups: {
          ...(prev.comboGroups || {}),
          [sectionId]: {
            ...(prev.comboGroups?.[sectionId] || {}),
            combinations: combos,
          },
        },
      };
      // Numbers run across sections, so a change in one section re-counts the
      // sections after it (see `renumberTabCombinations`).
      return renumberTabCombinations(getRenderedCombinationSections(next), next, isComboShown);
    });
  };

  const updateComboGroupSectionState = (sectionId: string, sectionStateOrUpdater: any) => {
    if (readOnly || !onStateChange) return;
    onStateChange((prev: any) => {
      const currentSectionState = prev.comboGroups?.[sectionId]?.sectionState || {};
      const nextSectionState =
        typeof sectionStateOrUpdater === 'function'
          ? sectionStateOrUpdater(currentSectionState)
          : sectionStateOrUpdater;
      return {
        ...prev,
        comboGroups: {
          ...(prev.comboGroups || {}),
          [sectionId]: {
            ...(prev.comboGroups?.[sectionId] || {}),
            sectionState: nextSectionState,
          },
        },
      };
    });
  };

  const updateSimpleSection = (sectionId: string, sectionStateOrUpdater: any) => {
    if (readOnly || !onStateChange) return;
    onStateChange((prev: any) => {
      const currentSectionState = prev.sectionFields?.[sectionId] || {};
      const nextSectionState =
        typeof sectionStateOrUpdater === 'function'
          ? sectionStateOrUpdater(currentSectionState)
          : sectionStateOrUpdater;
      return {
        ...prev,
        sectionFields: {
          ...(prev.sectionFields || {}),
          [sectionId]: nextSectionState,
        },
      };
    });
  };

  const getSectionCombos = (section: any) => getRenderedSectionCombos(section, tabState);

  // Each section's first chip number, by POSITION: the combinations rendered in the
  // sections above it. Not read from the first combo's stored number — a stale one
  // (a draft saved before tab-wide renumbering) would repeat another section's chip.
  const comboIndexOffsets: Record<string, number> = {};
  getRenderedCombinationSections(tabState).reduce((count: number, section: any) => {
    comboIndexOffsets[section.id] = count;
    return count + getSectionCombos(section).filter((combo: any) => isComboShown(combo, section)).length;
  }, 0);

  const getSimpleSectionState = (section: any) =>
    tabState?.sectionFields?.[section.id] || {};

  const getComboGroupSectionState = (section: any) =>
    tabState?.comboGroups?.[section.id]?.sectionState || {};

  const tabSummaryEntries = useMemo(() => buildTabSummaryEntries(tab, tabState, {
    dealCenterData,
    applyConditions,
    products,
  }), [tab, tabState, dealCenterData, applyConditions, products]);

  // My Deals: the "Grand Total - All Combinations" card reads its own entries from
  // `tabState`, NOT from the render loop, so the combinations hidden by the colour
  // filter came straight back at the bottom of the tab — listing "Not Selected"
  // against every field, which is exactly what hiding them was meant to stop.
  //
  // Filtered BEFORE `shouldShowTabGrandTotalSummary` below, so a tab whose every
  // combination is hidden drops the card entirely instead of rendering an empty one.
  //
  // Each entry carries its own `section`, so the field list is resolved per entry —
  // sections have different row fields and a shared list would test the wrong ones.
  //
  // Then the "#N" badges take the same positional numbers as the chips above them, so
  // the two can never disagree (entries arrive section by section, in each section's
  // combination order; numbered AFTER filtering, as the chips are).
  const visibleSummaryEntries = useMemo(() => {
    const seen: Record<string, number> = {};
    return tabSummaryEntries
      .filter((entry: any) => isComboShown(entry.combo, entry.section))
      .map((entry: any) => {
        const offset = comboIndexOffsets[entry.section.id];
        if (offset === undefined) return entry;
        const index = seen[entry.section.id] ?? 0;
        seen[entry.section.id] = index + 1;
        return { ...entry, displayNumber: offset + index + 1 };
      });
    // `isComboShown` / `comboIndexOffsets` derive from `tabState` (inside
    // `tabSummaryEntries`) and `editMode`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabSummaryEntries, editMode]);

  const lastVisibleCombinationSectionId = useMemo(() => {
    return sections.reduce((lastId: string | null, section: any) => {
      if (!(section.fields || []).length) return lastId;
      if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab)) return lastId;
      if (section.sectionType === 'simple') return lastId;
      return section.id;
    }, null);
  }, [sections, tabState, dealCenterData, tab, applyConditions]);

  const hasRenderableSections = sections.some((section: any) => {
    if (!(section.fields || []).length) return false;
    if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab)) return false;
    return true;
  });
  const hasAllocationOnly = hasTabFields && tabFields.every(isAllocationField) && !hasRenderableSections;

  const showTabGrandTotal = shouldShowTabGrandTotalSummary(tab, visibleSummaryEntries);

  // Collect all allocation field contexts from tab-level + all sections so they
  // render in a single sticky grid at the top of the tab (max 3 per row).
  const allocationItems = useMemo(() => {
    const items: { field: any; ctx: any }[] = [];

    (tab.fields || []).forEach((field: any) => {
      if (isAllocationField(field)) {
        items.push({
          field,
          ctx: {
            dealCenterData,
            tab,
            tabState,
            section: null,
            sectionState: tabState,
            combos: [],
            sectionFields: tab.fields,
          },
        });
      }
    });

    sections.forEach((section: any) => {
      if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab)) return;
      (section.fields || []).forEach((field: any) => {
        if (!isAllocationField(field)) return;
        if (section.sectionType === 'simple') {
          items.push({
            field,
            ctx: {
              dealCenterData,
              tab,
              tabState,
              section,
              sectionState: getSimpleSectionState(section),
              combos: [],
              sectionFields: section.fields,
            },
          });
        } else {
          const sectionCombos = getSectionCombos(section);
          items.push({
            field,
            ctx: {
              dealCenterData,
              tab,
              tabState,
              section,
              sectionState: getComboGroupSectionState(section),
              combos: sectionCombos,
              sectionFields: section.fields,
            },
          });
        }
      });
    });

    return items;
  }, [tab, tabState, sections, dealCenterData, applyConditions]);

  const visibleAllocationItems = useMemo(() => {
    return allocationItems.filter(({ field, ctx }) => {
      const stateObj = ctx.sectionState || tabState;
      return !applyConditions || isFieldVisibleWithConditions(field, stateObj, {
        dealCenterData,
        tab,
        tabState,
        section: ctx.section,
        sectionState: ctx.sectionState,
        sectionFields: ctx.sectionFields || ctx.section?.fields || tab?.fields || [],
        combos: ctx.combos || [],
      }, applyConditions);
    });
  }, [allocationItems, tab, tabState, dealCenterData, applyConditions]);

  const showAllocationGrid = visibleAllocationItems.length > 0;
  const allocGridColumns = showAllocationGrid
    ? Math.min(visibleAllocationItems.length, 3)
    : 1;
  // 3 cards per row; anything beyond wraps to the next row (33% each). 2 → half,
  // 1 → full. Matches the requested "three per row, then wrap" tracker layout.
  const trackerItemWidth =
    allocGridColumns >= 3 ? '33.333%' : allocGridColumns === 2 ? '50%' : '100%';

  // Resolve every visible allocation card once so the collapsible header can show
  // the "X/Y Done" count and the body can render the cards without recomputing.
  const trackerCards = useMemo(() => {
    return visibleAllocationItems.map(({ field, ctx }) => {
      const fields = ctx.sectionFields?.length ? ctx.sectionFields : ctx.section?.fields || tab?.fields || [];
      const idx = fields.findIndex((f: any) => f.id === field.id);
      const resolved = resolveAllocationMetrics(field, {
        field,
        tabState,
        tab,
        section: ctx.section,
        sectionState: ctx.sectionState,
        combos: ctx.combos || [],
        fields,
        fieldIndex: idx >= 0 ? idx : 0,
        dealCenterData,
      });
      const avail = Number(resolved?.available) || 0;
      const used = Number(resolved?.allocated) || 0;
      const active = isAllocationCardActive(field, tabState, tab);
      const inactive = !!(field?.optionBinding?.enabled && !active);
      const unit = field.unit || field.allocUnit || 'ft';
      return { field, avail, used, unit, inactive };
    });
  }, [visibleAllocationItems, tabState, tab, dealCenterData]);

  // Collect accordion fields from tab-level + sections for fixed header rendering
  const accordionItems = useMemo(() => {
    const items: { field: any; ctx: any }[] = [];
    (tab.fields || []).forEach((field: any) => {
      if (field.type === 'accordion') {
        items.push({ field, ctx: { dealCenterData, section: null, sectionState: tabState, combos: [], sectionFields: tab.fields, state: tabState, onFieldChange: updateField } });
      }
    });
    sections.forEach((section: any) => {
      if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab)) return;
      (section.fields || []).forEach((field: any) => {
        if (field.type !== 'accordion') return;
        const sectionState = section.sectionType === 'simple' ? getSimpleSectionState(section) : getComboGroupSectionState(section);
        const secCombos = section.sectionType !== 'simple' ? getSectionCombos(section) : [];
        items.push({ field, ctx: { dealCenterData, section, sectionState, combos: secCombos, sectionFields: section.fields, state: sectionState, onFieldChange: (fid: string, val: any) => section.sectionType === 'simple' ? updateSimpleSection(section.id, (p: any) => ({ ...p, [fid]: val })) : updateComboGroupSectionState(section.id, (p: any) => ({ ...p, [fid]: val })) } });
      });
    });
    return items;
  }, [tab, tabState, sections, dealCenterData, applyConditions]);

  return (
    <View style={{ flex: 1 }}>
      {/* FIXED footage allocation tracker — pinned ABOVE the scroll so it does NOT
          move while the user scrolls the measurement fields. Just the tracker cards
          (no header bar, no collapse); 3 per row, wrapping. Each card shows its own
          Avail / Used / Left + status banner, matching the normal JB. */}
      {!hideAllocationTrackers && showAllocationGrid && (
        <Animated.View
          className="bg-white border-b border-slate-100"
          // ⚠️ `paddingTop` comes LAST so the animated value wins over the static one.
          // Spreading the style first would pin the gap open again.
          style={[
            { zIndex: 50, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 2 },
            collapsingUnderHeaderStyle,
          ]}
        >
          <View className="flex-row flex-wrap">
            {trackerCards.map((card) => (
              <View
                key={card.field.id}
                style={{ width: trackerItemWidth, paddingHorizontal: 4 }}
              >
                <AllocatorBar
                  label={card.field.label}
                  avail={card.avail}
                  used={card.used}
                  unit={card.unit}
                  inactive={card.inactive}
                  compact
                />
              </View>
            ))}
          </View>
        </Animated.View>
      )}

      {/* FIXED footage accordion tracker — pinned below the allocation grid, same
          fixed position so it does NOT scroll. Collapsible card wrapping the same
          allocation fields for an open/close view. */}
      {!hideAllocationTrackers && accordionItems.length > 0 && (
        <View className="bg-white border-b border-slate-100" style={{ zIndex: 50, paddingHorizontal: 8, paddingTop: 4, paddingBottom: 4 }}>
          {accordionItems.map(({ field, ctx }) => {
            const childFields = field.fields || [];
            const parentState = ctx.state || {};
            const childDepCtx = {
              dealCenterData, tab, tabState, section: ctx.section, sectionState: ctx.sectionState,
              sectionFields: childFields, combos: ctx.combos,
            };
            const visibleChildFields = childFields.filter(
              (child: any) => !applyConditions || isFieldVisibleWithConditions(child, parentState, childDepCtx, applyConditions),
            );
            // Web parity (field-registry `case 'accordion'`): a tracker whose visible
            // children are ALL allocation cards shows them inline — no accordion
            // chrome — at ALLOCATION_INLINE_MAX (4) or fewer cards. Only more than
            // that collapses behind the header.
            const isTracker =
              visibleChildFields.length > 0 && visibleChildFields.every(isAllocationChild);
            const renderedChildren = visibleChildFields
              .map((child: any) => renderField(child, parentState?.[child.id], (v: any) => ctx.onFieldChange(child.id, v), { readOnly, verticalColor, dealCenterData, applyConditions, state: parentState, onFieldChange: ctx.onFieldChange, tab, tabState, section: ctx.section, sectionState: ctx.sectionState, combos: ctx.combos, sectionFields: childFields, editMode, ...(isTracker ? { compactAllocation: true, allocationFillHeight: true } : {}) }))
              .filter(Boolean);
            const status = resolveAccordionAllocationStatus(field, { ...ctx, tab, tabState, value: parentState, sectionState: ctx.sectionState ?? parentState, sectionFields: childFields, applyConditions });
            const badge = status ? { type: status.type, message: status.label } : null;
            if (!renderedChildren.length) return null;

            const contents = isTracker ? (
              <AllocationCardGrid columns={resolveMobileGridColumns(field.mobileColumns) ?? ALLOCATION_GRID_COLS}>
                {renderedChildren}
              </AllocationCardGrid>
            ) : (
              renderedChildren
            );

            if (isTracker && renderedChildren.length <= ALLOCATION_INLINE_MAX) {
              return (
                <View key={field.id} className="px-1 py-1">
                  {contents}
                </View>
              );
            }

            return (
              <AccordionSection key={field.id} label={field.label} icon={field.icon || 'chart-box-outline'} defaultExpanded={field.defaultExpanded !== false} badge={badge}>
                {contents}
              </AccordionSection>
            );
          })}
        </View>
      )}

      <KeyboardAwareScrollView
        className="flex-1"
        // `KeyboardAwareScrollView` (not a plain `ScrollView` + `adjustResize`) so the
        // FOCUSED field stays scrolled into view both while typing AND after the keyboard
        // is dismissed. Ticket: on Android, tapping "Done" closed the keyboard and the
        // scroll offset stayed put, so a field entered near the bottom (e.g. "# of End
        // Caps (Lefts)") scrolled out from under the fold the instant the window resized
        // back to full height — the rep had no way to see what they'd just typed.
        // `bottomOffset` matches the pattern already used for this in
        // `DynamicDealEditScreen`'s Job Price / Addendum steps.
        contentContainerStyle={{ padding: 12, paddingBottom: 160 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={24}
        {...collapsingScrollProps}
      >
      {!hasAllocationOnly && hasTabFields && (() => {
        const nonAllocFields = filterFields(
          tabFields.filter((f: any) => !isAllocationField(f) && f.type !== 'accordion'),
          tabState, tab, null, tabState, [], dealCenterData, applyConditions
        );
        if (!nonAllocFields.length) return null;
        return (
          <SectionCard>
            {nonAllocFields.map((field: any) => {
              const val = tabState?.[field.id];
              return renderField(field, val, (v) => updateField(field.id, v), {
                readOnly,
                verticalColor,
                dealCenterData,
                applyConditions,
                state: tabState,
                onFieldChange: updateField,
                tab,
                tabState,
                section: null,
                sectionState: tabState,
                combos: [],
                sectionFields: tabFields,
                editMode,
              });
            })}
          </SectionCard>
        );
      })()}

      {sections.map((section: any) => {
        if (!(section.fields || []).length) return null;
        if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab)) return null;

        if (section.sectionType === 'simple') {
          return (
            <SimpleSectionBlock
              key={section.id}
              section={section}
              sectionState={getSimpleSectionState(section)}
              onSectionStateChange={(state) => updateSimpleSection(section.id, state)}
              readOnly={readOnly}
              verticalColor={verticalColor}
              tab={tab}
              tabState={tabState}
              dealCenterData={dealCenterData}
              applyConditions={applyConditions}
              hideAllocations
              editMode={editMode}
            />
          );
        }

        const combos = getSectionCombos(section);
        const comboIndexOffset = comboIndexOffsets[section.id] ?? 0;
        const isLastCombinationSection = section.id === lastVisibleCombinationSectionId;

        return (
          <Fragment key={section.id}>
            <CombinationSectionBlock
              section={section}
              combos={combos}
              comboIndexOffset={comboIndexOffset}
              sectionState={getComboGroupSectionState(section)}
              onSectionStateChange={(state) => updateComboGroupSectionState(section.id, state)}
              readOnly={readOnly}
              onUpdateCombos={(nextCombos) => updateSectionCombos(section.id, nextCombos)}
              verticalColor={verticalColor}
              tab={tab}
              tabState={tabState}
              dealCenterData={dealCenterData}
              applyConditions={applyConditions}
              hideAllocations
              editMode={editMode}
            />
            {isLastCombinationSection && showTabGrandTotal && (
              <GrandTotalCard
                entries={visibleSummaryEntries}
                tabLabel={tab.label}
                accentColor={verticalColor}
              />
            )}
          </Fragment>
        );
      })}
      </KeyboardAwareScrollView>
    </View>
  );
}
