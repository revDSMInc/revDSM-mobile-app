import React, { useMemo, useRef, useState, Fragment } from 'react';
import Reanimated from 'react-native-reanimated';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useNumPadScrollIntoView } from '../../../hooks/useNumPadScrollIntoView';
import {
  getTabSections,
  getCombinationSectionRowFields,
  canAddMoreCombinations,
  createBlankCombinationItem,
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
import { FieldNoticeHost } from './FieldNoticeModal';
import { useFieldNoticeWatcher } from '../../../hooks/useFieldNoticeWatcher';
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

const SELECTED_ACCENT = '#22C55E';

function resolveEffectiveColorBehavior(field: any, state: any, depCtx: any, required?: boolean, unlockAll?: boolean) {
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

const ALLOCATION_INLINE_MAX = 4;

const ALLOCATION_GRID_COLS = 2;

const ALLOCATION_GRID_GAP = 8;

const isAllocationChild = (f: any) =>
  isAllocationField(f) || (f?.widget || f?.inputType || f?.type) === 'allocation';

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
  hideAllocationTrackers?: boolean;
  collapsingScrollProps?: Record<string, any>;
  collapsingUnderHeaderStyle?: Record<string, any>;
  collapsingTrackerStyle?: any;
  collapsingTopInset?: number;
  verticalId?: string;
  verticalColor?: string;
  products?: any[];
  schemas?: any[];
  repDetails?: any;
  editMode?: boolean;
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
  onUploadDocs?: (cat: 'agreement' | 'orderSheet', payloads: any[]) => Promise<any[] | null>;
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
    sections?: any[];
    combos?: any[];
    sectionFields?: any[];
    products?: any[];
    editMode?: boolean;
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

  const onChange = (val: any) => {
    onFieldValueChange(val);
    if (hasEnteredQuantity(val) || !ctx?.onFieldChange) return;
    findPairedColorFields(field, ctx?.sectionFields).forEach((colorField: any) => {
      if (!hasEnteredQuantity(state?.[colorField.id])) return;
      ctx.onFieldChange?.(colorField.id, '');
    });
  };
  const verticalColor = SELECTED_ACCENT;

  const depCtx = {
    dealCenterData,
    sectionFields: ctx?.sectionFields,
    tab: ctx?.tab,
    tabState: ctx?.tabState,
    section: ctx?.section,
    sectionState: ctx?.sectionState ?? state,
    combos: ctx?.combos,
    sections: ctx?.sections ?? ctx?.tab?.sections,
    editMode: Boolean(editMode),
  };

  const resolveSwatchValue = () => {
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

  const resolveSwatchColors = () => {
    const fromProduct = resolveColorsForField(field, ctx?.tab, ctx?.products);
    if (fromProduct.length) return fromProduct;
    return field.palette ? resolveColorPalette(field.palette) : field.colors || undefined;
  };

  if (readOnly || (field.locked && !editMode)) {
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
      const showRequired =
        isFieldRequired(field, state, depCtx) && isRequiredFieldValueMissing(field, value);
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
      const ruleOpts = getVisibleFieldOptions(field, depCtx, state, applyConditions);
      const hasAuthoredOptions = !!field.options?.length || !!field.optionShowFields;
      const opts =
        (ruleOpts.length || hasAuthoredOptions ? ruleOpts : field.choices || field.items) || [];

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
      const dropdownDisabled = Boolean(field.disabled) && !editMode;
      // A combination added in My Deals opens with nothing selected: the dropdown must not seed its default.
      const noSeed = !!state?.[ADDED_IN_EDIT_KEY];
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
          boxLabel={boxTitleFor(field, ctx)}
          defaultValue={noSeed ? undefined : resolveEffectiveDefaultValue(field, state, depCtx)}
          fallbackValue={noSeed ? undefined : (() => {
            const dc = resolveLockedValue(field, dealCenterData, {
              fallbackDefault: resolveConditionalDefault(field, state, depCtx),
            });
            return dc === undefined || dc === '—' || dc === '' ? undefined : String(dc);
          })()}
          readOnly={readOnly}
        />
      );
    }

    case 'colorSelection': {
      const { effectiveDefault, effectiveLocked } = resolveEffectiveColorBehavior(
        field,
        state,
        depCtx,
        isFieldRequired(field, state, depCtx),
        editMode
      );
      if (effectiveLocked && !editMode) {
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

      const isChildRenderable = (child: any) => {
        if (!applyConditions) return true;
        return isFieldVisibleWithConditions(child, parentState, childDepCtx, applyConditions);
      };

      const visibleChildFields = childFields.filter(isChildRenderable);
      const isAllocationTracker =
        visibleChildFields.length > 0 && visibleChildFields.every(isAllocationChild);
      const allocationChildCtx =
        isAllocationTracker && normalizedType === 'accordion'
          ? { compactAllocation: true, allocationFillHeight: true }
          : null;

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

      const warningNode = showWarning ? (
        <Text className="text-[12px] font-bold mb-2" style={{ color: warning.color || '#f59e0b' }}>
          ⚠️ {warning.message}
        </Text>
      ) : null;

      if (normalizedType === 'accordion') {
        if (!renderedChildren.length && !showWarning) return null;

        const status = resolveAccordionAllocationStatus(field, {
          ...(ctx || {}),
          value: parentState,
          sectionState: ctx?.sectionState ?? parentState,
          sectionFields: childFields,
          applyConditions,
        });
        const badge = status ? { type: status.type, message: status.label } : null;

        const contents = isAllocationTracker ? (
          <AllocationCardGrid columns={resolveMobileGridColumns(field.mobileColumns) ?? ALLOCATION_GRID_COLS}>
            {renderedChildren}
          </AllocationCardGrid>
        ) : (
          renderedChildren
        );

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

      const showStackLabel = !!field.label && field.showLabel !== false;
      const labelNode = showStackLabel ? <SectionLabel title={field.label} /> : null;

      const showContainer = field.bordered === true || showWarning;
      const effectiveBorderColor =
        (showWarning && warning?.color ? warning.color : getEffectiveBorderColor(field)) || undefined;

      const stackCols = resolveMobileGridColumns(field.mobileColumns);
      const stackContent = stackCols && stackCols > 1
        ? <StackFieldGrid columns={stackCols}>{renderedChildren}</StackFieldGrid>
        : renderedChildren;

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
  const baseRowFields = getCombinationSectionRowFields(section).filter((f: any) => f.type !== 'accordion');
  const canAddCombo = canAddMoreCombinations(section);

  const isComboHidden = (combo: any) =>
    isComboHiddenInDealEdit(combo, getFlattenedCombinationSectionRowFields(section), editMode);
  const firstShownIndex = Math.max(0, combos.findIndex((combo: any) => !isComboHidden(combo)));
  let shownCount = 0;
  const chipNumbers = combos.map((combo: any) =>
    isComboHidden(combo) ? -1 : comboIndexOffset + ++shownCount
  );
  const showCombinationLabel = (section as any)?.showCombinationLabel !== false;
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
        if (isComboHidden(combo)) return null;

        const borderThemeColor = COMBINATION_COLORS[comboIndex % COMBINATION_COLORS.length];
        const combinationNumber = chipNumbers[comboIndex];
        const comboTotal = gridField ? computeGridTotal(combo[gridKey]) : 0;
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
        ⚠️ Edit mode (My Deals) has ONE universal Add Combination button for the whole tab
        (`UniversalAddCombination`), so a section never shows its own there — a tab with
        several combination sections, or one the colour filter emptied, would otherwise
        show a row of identical buttons.
      */}
      {!readOnly && canAddCombo && !editMode && (
        <AddCombinationButton onClick={handleAddCombo} />
      )}
    </View>
  );
}

function UniversalAddCombination({ onAdd, disabled }: { onAdd: () => void; disabled?: boolean }) {
  if (disabled) return null;
  // marginTop cancels the section block's own mb-3, so the gap above matches the gap between cards.
  return (
    <View style={{ marginTop: -12 }}>
      <AddCombinationButton onClick={onAdd} compact />
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
  collapsingTrackerStyle,
  collapsingTopInset = 0,
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
  const [trackerHeight, setTrackerHeight] = useState(0);
  useFieldNoticeWatcher(tab, tabState);

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
        collapsingTopInset={collapsingTrackerStyle !== undefined ? collapsingTopInset : 0}
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

  const isComboShown = (combo: any, section: any) =>
    !isComboHiddenInDealEdit(combo, getFlattenedCombinationSectionRowFields(section), editMode);

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
  const trackerItemWidth =
    allocGridColumns >= 3 ? '33.333%' : allocGridColumns === 2 ? '50%' : '100%';

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

  const trackerBlocks = (
    <>
      {/* FIXED footage allocation tracker — pinned ABOVE the scroll so it does NOT
          move while the user scrolls the measurement fields. Just the tracker cards
          (no header bar, no collapse); 3 per row, wrapping. Each card shows its own
          Avail / Used / Left + status banner, matching the normal JB. */}
      {!hideAllocationTrackers && showAllocationGrid && (
        <Animated.View
          className="bg-white border-b border-slate-100"
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

    </>
  );

  const collapsingOverlay = collapsingTrackerStyle !== undefined;

  // My Deals: ONE Add Combination for the tab, placed directly BELOW the last combination section (above its Grand
  // Total card), so a new combination appears above it. `universalAddPlaced` is flipped while the sections render.
  const universalAdd =
    editMode && !readOnly ? (
      <UniversalAddCombination
        disabled={!getRenderedCombinationSections(tabState).some((section: any) => canAddMoreCombinations(section))}
        onAdd={() => {
          const addable = getRenderedCombinationSections(tabState).filter((section: any) => canAddMoreCombinations(section));
          // A section with nothing showing is filled first; otherwise the first section with room.
          const target =
            addable.find((section: any) => !getSectionCombos(section).some((combo: any) => isComboShown(combo, section))) ||
            addable[0];
          if (!target) return;
          const combos = getSectionCombos(target);
          const added = createBlankCombinationItem(target, combos, comboIndexOffsets[target.id] ?? 0);
          updateSectionCombos(target.id, [...combos, { ...added, [ADDED_IN_EDIT_KEY]: true }]);
        }}
      />
    ) : null;
  const renderedCombinationSections = getRenderedCombinationSections(tabState);
  const lastCombinationSectionId = renderedCombinationSections[renderedCombinationSections.length - 1]?.id;
  let universalAddPlaced = false;

  const numPadScrollRef = useRef<any>(null);
  const numPadContentRef = useRef<View>(null);
  useNumPadScrollIntoView(numPadScrollRef, numPadContentRef, 12 + (collapsingOverlay ? collapsingTopInset + trackerHeight : 0));

  return (
    <View style={{ flex: 1 }}>
      <FieldNoticeHost />
      {collapsingOverlay ? (
        <Reanimated.View
          onLayout={(e) => {
            const h = Math.round(e.nativeEvent.layout.height);
            setTrackerHeight((prev) => (prev === h ? prev : h));
          }}
          style={[{ position: 'absolute', top: collapsingTopInset, left: 0, right: 0, zIndex: 50 }, collapsingTrackerStyle]}
        >
          {trackerBlocks}
        </Reanimated.View>
      ) : (
        trackerBlocks
      )}

      <KeyboardAwareScrollView
        ref={numPadScrollRef}
        className="flex-1"
        contentContainerStyle={{
          padding: 12,
          paddingBottom: 160,
          ...(collapsingOverlay ? { paddingTop: 12 + collapsingTopInset + trackerHeight } : null),
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        bottomOffset={72}
        {...collapsingScrollProps}
      >
      <View ref={numPadContentRef} collapsable={false}>
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
            <Fragment key={section.id}>
            <SimpleSectionBlock
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
            </Fragment>
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
            {section.id === lastCombinationSectionId ? (universalAddPlaced = true, universalAdd) : null}
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
      {universalAddPlaced ? null : universalAdd}
      </View>
      </KeyboardAwareScrollView>
    </View>
  );
}
