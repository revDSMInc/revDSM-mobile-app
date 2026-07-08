import React, { useMemo, Fragment } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import {
  getTabSections,
  getCombinationSectionRowFields,
  canAddMoreCombinations,
  createNextCombinationItem,
  getCombinationDisplayNumber,
  getCombinationSectionHeaderFields,
  buildComboGroupSectionState,
} from '../../../utils/dynamic-job-builder/engine/combination-utils';
import {
  shouldShowTabGrandTotalSummary,
  resolveGrandTotalColumns,
  formatComboFieldSummaryValue,
} from '../../../utils/dynamic-job-builder/engine/grand-total-utils';
import {
  isFieldVisibleWithConditions,
  isAllocationExcluded,
  evaluateRuleGroup,
} from '../../../utils/dynamic-job-builder/engine/dependency-engine';
import { isAllocationField } from '../../../utils/dynamic-job-builder/engine/allocation-utils';
import { resolveAllocationMetrics } from '../../../utils/dynamic-job-builder/engine/allocation-value-resolver';
import { filterVisibleToggleOptions } from '../../../utils/dynamic-job-builder/engine/toggle-utils';
import { getEffectiveDropdownOptions } from '../../../utils/dynamic-job-builder/engine/dropdown-utils';
import { getWarningConfig } from '../../../utils/dynamic-job-builder/engine/field-layout-utils';
import { resolveColorPalette } from '../../../utils/dynamic-job-builder/constants/color-palettes';
import { buildTabSummaryEntries, isSummarySectionVisible } from '../../../utils/dynamic-job-builder/engine/vertical-summary-utils';
import { SectionCard } from './SectionCard';
import { SectionLabel } from './SectionLabel';
import { InputField } from './InputField';
import { TextField } from './TextField';
import { TextareaField } from './TextareaField';
import { ToggleGroup } from './ToggleGroup';
import { OptionList } from './OptionList';
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
// resolveAllocationMetrics (dealCenterData + contributors + computed), and a card
// whose Deal Center budget resolves to 0 is dropped (isAllocationExcluded).
// This is what makes "which sizes appear" + allocation balancing backend-driven.
function renderAllocationCard(field: any, ctx: any = {}) {
  const {
    dealCenterData = {},
    tab,
    tabState,
    section,
    sectionState,
    combos = [],
  } = ctx;

  if (isAllocationExcluded(field, dealCenterData)) return null;

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

  const unit = field.unit || field.allocUnit || 'ft';
  return (
    <AllocatorBar
      key={field.id}
      label={field.label}
      avail={Number(resolved?.available) || 0}
      used={Number(resolved?.allocated) || 0}
      unit={unit}
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
  verticalId?: string;
  verticalColor?: string;
  products?: any[];
  schemas?: any[];
}

function renderField(
  field: any,
  value: any,
  onChange: (val: any) => void,
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
    combos?: any[];
    sectionFields?: any[];
  }
) {
  const {
    readOnly = false,
    verticalColor = '#22c55e',
    dealCenterData = {},
    applyConditions = true,
    state = {},
  } = ctx || {};

  if (readOnly || field.locked) {
    if (field.colorKey && (field.palette || field.colors)) {
      return (
        <LockedFieldWithColor
          key={field.id}
          label={field.label}
          value={value ?? field.defaultValue ?? '—'}
          colorValue={value}
          colors={field.palette ? resolveColorPalette(field.palette) : field.colors}
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

  const normalizedType = field.widget || field.inputType || field.type;

  switch (normalizedType) {
    case 'text':
    case 'input':
      if (field.palette || field.colors?.length) {
        return (
          <SwatchPicker
            key={field.id}
            label={field.label}
            value={value || ''}
            onChange={onChange}
            colors={field.palette ? resolveColorPalette(field.palette) : field.colors}
            accentColor={verticalColor}
          />
        );
      }
      if ((field.options || field.choices || field.items)?.length) {
        const baseOpts = field.options || field.choices || field.items;
        const visOpts = filterVisibleToggleOptions({ ...field, options: baseOpts }, dealCenterData, state, applyConditions);
        return (
          <OptionList
            key={field.id}
            label={field.label}
            options={visOpts}
            value={value || ''}
            onChange={onChange}
            color={verticalColor}
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

    case 'number':
      return (
        <InputField
          key={field.id}
          label={field.label}
          placeholder={field.placeholder}
          value={value != null ? String(value) : ''}
          onChange={onChange}
          unit={field.unit}
          editable={!readOnly}
        />
      );

    case 'textarea':
      return (
        <TextareaField
          key={field.id}
          label={field.label}
          placeholder={field.placeholder}
          value={value != null ? String(value) : ''}
          onChange={onChange}
          rows={field.rows || 3}
        />
      );

    case 'toggle': {
      const baseOpts = field.options || field.choices || field.items || [];
      const visOpts = filterVisibleToggleOptions({ ...field, options: baseOpts }, dealCenterData, state, applyConditions);
      return (
        <ToggleGroup
          key={field.id}
          label={field.label}
          options={visOpts}
          value={value || ''}
          onChange={onChange}
          color={verticalColor}
        />
      );
    }

    case 'optionList': {
      const baseOpts = field.options || field.choices || field.items || [];
      const visOpts = filterVisibleToggleOptions({ ...field, options: baseOpts }, dealCenterData, state, applyConditions);
      return (
        <OptionList
          key={field.id}
          label={field.label}
          options={visOpts}
          value={value || ''}
          onChange={onChange}
          color={verticalColor}
        />
      );
    }

    case 'dropdown':
    case 'select': {
      const dOpts = getEffectiveDropdownOptions(field);
      const opts = (dOpts && dOpts.length ? dOpts : field.options || field.choices || field.items) || [];
      return (
        <OptionList
          key={field.id}
          label={field.label}
          options={opts}
          value={value || ''}
          onChange={onChange}
          color={verticalColor}
        />
      );
    }

    case 'swatch':
    case 'colorSelection':
    case 'color':
      return (
        <SwatchPicker
          key={field.id}
          label={field.label}
          value={value || ''}
          onChange={onChange}
          colors={field.palette ? resolveColorPalette(field.palette) : field.colors || undefined}
          accentColor={verticalColor}
        />
      );

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
          label={field.label}
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

      if (field.locked || field.type === 'lockedWithColor') {
        if (field.colorKey && (field.palette || field.colors)) {
          return (
            <LockedFieldWithColor
              key={field.id}
              label={field.label}
              value={value ?? field.defaultValue ?? '—'}
              colorValue={colorVal}
              colors={field.palette ? resolveColorPalette(field.palette) : field.colors}
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
                colors={field.palette ? resolveColorPalette(field.palette) : field.colors}
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

      // Per-child visibility from the schema (visibleWhen / dropdown reveal), scoped
      // to the container's own children so intra-container dropdown reveal resolves.
      const visibleChildren = childFields.filter((child: any) =>
        !applyConditions ||
        isFieldVisibleWithConditions(
          child,
          parentState,
          {
            dealCenterData,
            tab: ctx?.tab,
            tabState: ctx?.tabState,
            section: ctx?.section,
            sectionState: ctx?.sectionState,
            sectionFields: childFields,
            combos: ctx?.combos,
          },
          applyConditions
        )
      );

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

      return (
        <View key={field.id} className={field.label ? 'mb-4' : ''}>
          {field.label && <SectionLabel title={field.label} />}
          {visibleChildren.map((child: any) => {
            const childVal = parentState?.[child.id];
            const childOnChange = (v: any) => writeChild(child.id, v);
            return renderField(child, childVal, childOnChange, {
              ...(ctx || {}),
              sectionFields: childFields,
            });
          })}
          {showWarning && (
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
          )}
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
}) {
  const applyDep = applyConditions !== false;
  const allFields = section.fields || [];

  const headerFields = getCombinationSectionHeaderFields(section);
  const visibleHeaderFields = filterFields(headerFields, tabState, tab, section, sectionState, combos, dealCenterData, applyDep);
  // Section-level allocation trackers (aggregate across all combos), rendered once.
  const allocationFields = filterFields(allFields.filter(isAllocationField), tabState, tab, section, sectionState, combos, dealCenterData, applyDep);
  // Per-combo repeatable fields (excludes allocation / section-scoped / summary / label).
  // Visibility is resolved per-combo below so combo-sibling visibleWhen rules work.
  const baseRowFields = getCombinationSectionRowFields(section);
  const canAddCombo = canAddMoreCombinations(section);

  const allocCtx = {
    dealCenterData,
    tab,
    tabState,
    section,
    sectionState,
    combos,
    sectionFields: allFields,
  };

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
    onUpdateCombos([...combos, createNextCombinationItem(section, combos, comboIndexOffset)]);
  };

  const handleRemoveCombo = (index: number) => {
    if (readOnly) return;
    const next = combos
      .filter((_, i) => i !== index)
      .map((combo, idx) => ({ ...combo, _combinationNumber: comboIndexOffset + idx + 1 }));
    onUpdateCombos(next);
  };

  return (
    <View className="mb-3">
      {section.label && <SectionLabel title={section.label} />}

      {allocationFields.map((field: any) => renderAllocationCard(field, allocCtx))}

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
        });
      })}

      {combos.map((combo: any, comboIndex: number) => {
        const borderThemeColor = COMBINATION_COLORS[comboIndex % COMBINATION_COLORS.length];
        const combinationNumber = getCombinationDisplayNumber(combo, comboIndex, comboIndexOffset);

        return (
          <SectionCard key={combo._combinationNumber ?? comboIndex} borderColor={borderThemeColor}>
            <View className="flex-row items-center justify-between mb-3">
              <View className="px-3 py-1 rounded-lg" style={{ backgroundColor: `${borderThemeColor}1A` }}>
                <Text className="text-[10px] font-black" style={{ color: borderThemeColor }}>
                  Combination #{combinationNumber}
                </Text>
              </View>
              {combos.length > 1 && !readOnly && (
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
              });
            })}
          </SectionCard>
        );
      })}

      {!readOnly && canAddCombo && (
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
}) {
  const applyDep = applyConditions !== false;

  const handleFieldChange = (fieldId: string, val: any) => {
    if (readOnly) return;
    onSectionStateChange((prev: any) => ({ ...prev, [fieldId]: val }));
  };

  const allFields = section.fields || [];
  const allocationFields = filterFields(allFields.filter(isAllocationField), tabState, tab, section, sectionState, [], dealCenterData, applyDep);
  const otherFields = filterFields(allFields.filter((f: any) => !isAllocationField(f)), tabState, tab, section, sectionState, [], dealCenterData, applyDep);

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
}: DynamicTabRendererProps) {
  if (tab.isSummary) {
    return (
      <VerticalSummaryTab
        vertical={vertical || { id: verticalId, tabs: [tab], color: verticalColor }}
        verticalState={verticalState}
        lockedTabIds={lockedTabIds}
        dealCenterData={dealCenterData}
        applyConditions={applyConditions}
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

  const updateSectionCombos = (sectionId: string, combos: any[]) => {
    if (readOnly || !onStateChange) return;
    onStateChange((prev: any) => ({
      ...prev,
      comboGroups: {
        ...(prev.comboGroups || {}),
        [sectionId]: {
          ...(prev.comboGroups?.[sectionId] || {}),
          combinations: combos,
        },
      },
    }));
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

  const getSectionCombos = (section: any) => {
    const fromGroups = tabState?.comboGroups?.[section.id]?.combinations;
    if (fromGroups?.length) return fromGroups;
    if (section.id === 'default' && tabState?.combinations?.length) {
      return tabState.combinations;
    }
    return [{ ...(section.defaultItem || {}) }];
  };

  const getSimpleSectionState = (section: any) =>
    tabState?.sectionFields?.[section.id] || {};

  const getComboGroupSectionState = (section: any) =>
    tabState?.comboGroups?.[section.id]?.sectionState || {};

  const tabSummaryEntries = useMemo(() => buildTabSummaryEntries(tab, tabState, {
    dealCenterData,
    applyConditions,
    products,
  }), [tab, tabState, dealCenterData, applyConditions, products]);

  const lastVisibleCombinationSectionId = useMemo(() => {
    return sections.reduce((lastId: string | null, section: any) => {
      if (!(section.fields || []).length) return lastId;
      if (applyConditions && !isSummarySectionVisible(section, tabState, dealCenterData, tab)) return lastId;
      if (section.sectionType === 'simple') return lastId;
      return section.id;
    }, null);
  }, [sections, tabState, dealCenterData, tab, applyConditions]);

  const showTabGrandTotal = shouldShowTabGrandTotalSummary(tab, tabSummaryEntries);

  return (
    <View className="p-3">
      {hasTabFields && (
        <SectionCard>
          {filterFields(tabFields, tabState, tab, null, tabState, [], dealCenterData, applyConditions).map((field: any) => {
            if (isAllocationField(field)) {
              return renderAllocationCard(field, {
                dealCenterData,
                tab,
                tabState,
                section: null,
                sectionState: tabState,
                combos: [],
                sectionFields: tabFields,
              });
            }
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
            });
          })}
        </SectionCard>
      )}

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
            />
          );
        }

        const combos = getSectionCombos(section);
        const firstSectionEntry = tabSummaryEntries.find((entry) => entry.section.id === section.id);
        const comboIndexOffset = firstSectionEntry ? firstSectionEntry.displayNumber - 1 : 0;
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
            />
            {isLastCombinationSection && showTabGrandTotal && (
              <GrandTotalCard
                combinations={combos}
                fields={section.fields || []}
                sectionLabel={tab.label}
                accentColor={verticalColor}
              />
            )}
          </Fragment>
        );
      })}
    </View>
  );
}
