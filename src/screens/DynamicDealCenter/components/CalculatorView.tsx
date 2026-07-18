import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, Modal, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Feather from 'react-native-vector-icons/Feather';
import type { CalculatorCategory, CalculatorField, CalculatorEntry, CalculatorTotals, CalculatorSchema } from '../types/calculator';
import { getCategoryDirectFields, getCategorySectionFields } from '../types/calculator';
import { HorizontalDraggableTabs } from '../../../widgets/components/dealcenter/HorizontalDraggableTabs';
import { resolveSchemaStyle, type SchemaStyle } from '../utils/icon-color';
import {
  resolveConditionalFieldHighlight,
  isConditionalFieldFixed,
  resolveConditionalFixedValue,
} from '../utils/field-dependency';
import { directSectionId } from '../utils/build-all-entries';
import { applyFeesToTier, type PricingConfig } from '../utils/pricing-config-util';
import { JobTrackerButton } from './JobTrackerButton';
import { computeCalculatorTiers } from '../utils/dynamic-rollout-pricing';
import { unitSuffix, labelWithSection, buildSectionLabelMap } from '../utils/item-format';

interface CalculatorTabLite {
  id: string;
  title: string;
  isRolloutConfirmed?: boolean;
  paymentMethod?: string;
}

interface CalculatorViewProps {
  /** All configured verticals (products) rendered as the top horizontal scroller. */
  verticals: CalculatorSchema[];
  entries: Record<string, CalculatorEntry>;
  onEntryChange: (fieldId: string, entry: CalculatorEntry) => void;
  totals: CalculatorTotals;
  readOnly?: boolean;
  tabs?: CalculatorTabLite[];
  activeTabId?: string;
  onTabSelect?: (id: string) => void;
  onAddTab?: () => void;
  onRenameTab?: (id: string, name: string) => void;
  onDuplicateTab?: (id: string) => void;
  onDeleteTab?: (id: string) => void;
  /** Reorder tabs via drag: receives the new id order + the id that should stay active. */
  onReorderTabs?: (orderedIds: string[], activeId: string) => void;
  onViewAll?: () => void;
  /** Confirmed rollout end price — shown in the locked receipt's green sub-card. */
  price?: number;
  /** Confirmed drop-price list — the last drop shows as "Updated End Price". */
  drops?: any[];
  /** Company pricing config — the locked receipt adds the per-tier static fee (web parity). */
  pricingConfig?: PricingConfig | null;
  /** Resolved appointment id — enables the "Add This Job to Job Tracker" button. */
  appointmentId?: string;
  /** Lowe's lead flag — drives the job-tracker modal's payment-method grouping. */
  isLowesLead?: boolean;
}

type CatStyle = SchemaStyle;

// Name-keyed fallback palette (used only when the backend schema doesn't supply
// `icon`/`color`), mirroring the old mobile deal center visual language.
const CATEGORY_STYLE_MAP: Record<string, CatStyle> = {
  gutters: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
  gutter: { color: '#00B8D9', icon: 'home', bg: '#E0F8FB' },
  leaffilter: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
  'leaf filter': { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
  leaf: { color: '#4CBB17', icon: 'shield-checkmark', bg: '#EBF9E1' },
  soffit: { color: '#00B8D9', icon: 'build', bg: '#E0F8FB' },
  fascia: { color: '#8E33FF', icon: 'layers', bg: '#F2E8FF' },
  lighting: { color: '#FFAB00', icon: 'bulb', bg: '#FFF8E6' },
  additional: { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
  'additional services': { color: '#FFAB00', icon: 'add-circle', bg: '#FFF8E6' },
  miscellaneous: { color: '#637381', icon: 'ellipsis-horizontal-circle', bg: '#F4F6F8' },
};

// Icon + color are read from the schema first (Iconify → Ionicons + hex/token
// resolution), falling back to the name-based palette above.
function getCategoryStyle(category: CalculatorCategory): CatStyle {
  const named = CATEGORY_STYLE_MAP[(category.name || '').toLowerCase()]
    || CATEGORY_STYLE_MAP[(category.label || '').toLowerCase()];
  return resolveSchemaStyle({ icon: category.icon, color: category.color }, named);
}

function getVerticalStyle(schema: CalculatorSchema): CatStyle {
  return resolveSchemaStyle(
    { icon: schema.icon || schema.product?.icon, color: schema.color || schema.product?.color },
    { color: '#4CBB17', icon: 'home', bg: '#EBF9E1' }
  );
}

/**
 * Field input row — visually mirrors the old deal center `InputField`
 * (`SharedElements.tsx`): a floating top-left label, a bordered rounded input,
 * and a right-aligned unit + green retail-price badge.
 *
 * Matches web field behavior exactly:
 *   - On focus the border turns GREEN (`#4CBB17`); the background never changes
 *     just from entering a value.
 *   - A conditional "highlight" dependent field tints its background
 *     (`highlightColor`) while its parent field is filled.
 *   - A conditional "fixed" field is auto-filled with its fixed value and locked.
 */
function FieldRow({ field, value, onChange, readOnly, highlightColor, isFixed, fixedValue }: {
  field: CalculatorField;
  value: number;
  onChange: (val: number) => void;
  readOnly?: boolean;
  highlightColor?: string | null;
  isFixed?: boolean;
  fixedValue?: number;
}) {
  const [text, setText] = useState(value > 0 ? String(value) : '');
  const [focused, setFocused] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Fixed (auto-filled) dependent fields: force the schema fixed value and keep
  // it synced whenever the field becomes/stays fixed.
  useEffect(() => {
    if (!isFixed) return;
    const fv = fixedValue || 0;
    if (value !== fv) onChangeRef.current(fv);
  }, [isFixed, fixedValue, value]);

  // Field rows are keyed by field.id (stable across tabs); resync the displayed
  // text to the active tab's value whenever the field isn't being edited so
  // switching / duplicating / confirming a tab never shows a stale value.
  useEffect(() => {
    if (focused) return;
    const next = value > 0 ? String(value) : '';
    if (next !== text) setText(next);
  }, [value, focused, text]);

  const disabled = !!readOnly || !!field.disabled || !!isFixed;
  // Background stays white on normal value entry (matches web). Only a
  // conditional-highlight dependent field tints its background.
  const bg = highlightColor || '#fff';
  const borderColor = focused ? '#4CBB17' : '#919EAB33';

  return (
    <View style={{ position: 'relative', marginTop: 10, marginBottom: 12 }}>
      <View style={{ position: 'absolute', top: -7, left: 12, zIndex: 10, paddingHorizontal: 4, backgroundColor: bg }}>
        <Text style={{ fontSize: 10, fontWeight: '900', color: '#1C252E' }}>{field.label}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor, borderRadius: 8, backgroundColor: bg, paddingVertical: 2, paddingHorizontal: 14 }}>
        <TextInput
          style={{ flex: 1, height: 44, fontSize: 14, fontWeight: '900', color: disabled ? '#94A3B8' : '#1C252E' }}
          value={text}
          editable={!disabled}
          onChangeText={(t) => {
            const cleaned = t.replace(/[^0-9.]/g, '');
            setText(cleaned);
            onChange(parseFloat(cleaned) || 0);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder=""
          placeholderTextColor="#919EAB"
          keyboardType="numeric"
        />
        {/* Expected measurement unit (ft, sq ft, ea, lin ft, …) shown as a grey
            suffix right after the entered value so reps know what the field expects. */}
        {!!field.unit && (
          <Text style={{ fontSize: 12, fontWeight: '700', color: '#919EAB', marginLeft: 6 }}>{field.unit}</Text>
        )}
        {/* Right side shows the green retail price. */}
        {!!field.price && (
          <View style={{ flexDirection: 'row', alignItems: 'center', borderLeftWidth: 1, borderLeftColor: '#919EAB33', paddingLeft: 12, marginLeft: 8 }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#16a34a' }}>${field.price.retail}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * One collapsible category card — mirrors the old deal center `Section`
 * (rounded white card, icon-circle header, chevron toggle) with schema-driven
 * `FieldRow` inputs stacked inside.
 */
function CategoryCard({ category, entries, onEntryChange, readOnly, expanded, onToggle, allFields, formState }: {
  category: CalculatorCategory;
  entries: Record<string, CalculatorEntry>;
  onEntryChange: (fieldId: string, entry: CalculatorEntry) => void;
  readOnly?: boolean;
  expanded: boolean;
  onToggle: () => void;
  /** flattened fields across ALL verticals (for conditional dependency resolution) */
  allFields: CalculatorField[];
  /** live value map keyed by field id AND name (drives conditional highlight/fixed) */
  formState: Record<string, number>;
}) {
  const style = getCategoryStyle(category);
  const directFields = getCategoryDirectFields(category);
  const categoryFields = [...directFields, ...getCategorySectionFields(category)];
  const filledCount = categoryFields.filter((f) => (entries[f.id]?.inputValue || 0) > 0).length;

  const handleFieldChange = useCallback((field: CalculatorField, sectionId: string, value: number) => {
    const price = field.price || { cost: 0, par: 0, retail: 0 };
    // Preserve the seeded `productName` (build-all-entries sets it from schema.name)
    // instead of reading a non-existent `category.productName`, which blanked it on
    // every touched field and diverged from the zero-seed for the same field.
    const productName = (entries[field.id] as any)?.productName ?? (category as any)._productName ?? (category as any).productName ?? '';
    onEntryChange(field.id, {
      fieldId: field.id, categoryId: category.id, sectionId, productName,
      name: field.name, label: field.label, unit: field.unit || '',
      inputValue: value,
      computed: { cost: value * price.cost, par: value * price.par, retail: value * price.retail },
      pricingAtTimeOfEntry: { cost: String(price.cost), par: String(price.par), retail: String(price.retail) },
    });
  }, [category, onEntryChange, entries]);

  // Clear all fields in this category (mirrors web's category "Clear" button).
  const clearCategory = useCallback(() => {
    directFields.forEach((f) => handleFieldChange(f, directSectionId(category.id), 0));
    (category.sections || []).forEach((s) => s.fields.forEach((f) => handleFieldChange(f, s.id, 0)));
  }, [directFields, category.sections, category.id, handleFieldChange]);

  const renderField = (field: CalculatorField, sectionId: string) => {
    const highlightColor = resolveConditionalFieldHighlight(field, formState, allFields);
    const fixed = isConditionalFieldFixed(field, formState, allFields);
    const fixedValue = fixed ? resolveConditionalFixedValue(field, formState, allFields) : 0;
    return (
      <FieldRow
        key={field.id}
        field={field}
        value={entries[field.id]?.inputValue || 0}
        onChange={(val) => handleFieldChange(field, sectionId, val)}
        readOnly={readOnly}
        highlightColor={highlightColor}
        isFixed={fixed}
        fixedValue={fixedValue}
      />
    );
  };

  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#F1F5F9', overflow: 'hidden', marginBottom: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 1 }}>
      <TouchableOpacity onPress={onToggle} activeOpacity={0.8} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: `${style.color}15`, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
            <Ionicons name={style.icon} size={20} color={style.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '900', color: '#1C252E' }}>{category.label}</Text>
            {!!(category.description) && <Text style={{ fontSize: 9, fontWeight: '700', color: '#94A3B8' }}>{category.description}</Text>}
          </View>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          {/* Clear button — shown (like web) only when the category has values */}
          {filledCount > 0 && !readOnly && (
            <TouchableOpacity
              onPress={clearCategory}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, borderColor: '#FF563040', backgroundColor: '#FF56300D', marginRight: 10 }}
            >
              <Ionicons name="close" size={12} color="#FF5630" style={{ marginRight: 3 }} />
              <Text style={{ fontSize: 11, fontWeight: '800', color: '#FF5630' }}>Clear</Text>
            </TouchableOpacity>
          )}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="#637381" />
        </View>
      </TouchableOpacity>
      {expanded && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
          {directFields.map((field) => renderField(field, directSectionId(category.id)))}
          {category.sections?.map((section) => (
            <View key={section.id}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#637381', marginTop: 24, marginBottom: 4 }}>{section.label}</Text>
              {section.fields.map((field) => renderField(field, section.id))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Job Summary card — matches the web deal center summary block: one card with a
 * header + item-count badge, a single row of category pills across every vertical
 * with entries, then a FLAT list of the entered items (each row carries its own
 * category icon/color). The items are NOT split into separate per-category
 * sub-sections (that was the mobile-only divergence). Spans every vertical the
 * calculator has entries in.
 */
function JobSummary({ entries, catMeta, sectionLabelMap }: { entries: Record<string, CalculatorEntry>; catMeta: Record<string, { label: string; style: CatStyle }>; sectionLabelMap: Record<string, string> }) {
  // Entered items ordered by category (so rows of the same category stay
  // together), flattened into a single list — web parity.
  const { items, categories } = useMemo(() => {
    const grouped: Record<string, CalculatorEntry[]> = {};
    const order: string[] = [];
    Object.values(entries).forEach((e) => {
      if (!e || e.inputValue <= 0) return;
      const key = e.categoryId || 'other';
      if (!grouped[key]) { grouped[key] = []; order.push(key); }
      grouped[key].push(e);
    });
    return {
      items: order.flatMap((key) => grouped[key]),
      categories: order,
    };
  }, [entries]);

  const metaFor = (catId: string) =>
    catMeta[catId] || { label: catId, style: { color: '#637381', icon: 'list', bg: '#F4F6F8' } };
  const totalItems = items.length;

  return (
    <View style={{ marginBottom: 24, backgroundColor: '#F8F7FF', borderRadius: 32, borderWidth: 1, borderColor: '#E5D9FF' }}>
      <View style={{ padding: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: '#E5D9FF', alignItems: 'center', justifyContent: 'center', marginRight: 16 }}>
            <Ionicons name="receipt" size={24} color="#6B46C1" />
          </View>
          <View>
            <Text style={{ fontSize: 20, fontWeight: '800', color: '#1C252E' }}>Job Summary</Text>
            <Text style={{ fontSize: 13, color: '#637381', fontWeight: '500' }}>{totalItems} items</Text>
          </View>
        </View>
        <View style={{ backgroundColor: '#E5D9FF', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: '#6B46C1', letterSpacing: 0.5 }}>{totalItems} Items</Text>
        </View>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 20 }}>
        {totalItems === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 24, paddingBottom: 32 }}>
            <Ionicons name="cube-outline" size={30} color="#CBD5E1" />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', marginTop: 8 }}>No items yet — enter values above</Text>
          </View>
        ) : (
          <>
            {/* All category pills in a single row (web parity) */}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              {categories.map((catId) => {
                const meta = metaFor(catId);
                return (
                  <View key={catId} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: meta.style.bg }}>
                    <Ionicons name={meta.style.icon} size={13} color={meta.style.color} />
                    <Text style={{ marginLeft: 6, fontSize: 11, fontWeight: '900', color: meta.style.color }}>{meta.label}</Text>
                  </View>
                );
              })}
            </View>

            {/* Flat list of entered items */}
            <View style={{ gap: 12 }}>
              {items.map((item) => {
                const meta = metaFor(item.categoryId || 'other');
                return (
                  <View key={item.fieldId} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#F4F6F8' }}>
                    <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 16, backgroundColor: meta.style.bg }}>
                      <Ionicons name={meta.style.icon} size={18} color={meta.style.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#1C252E' }}>{item.inputValue}{unitSuffix(item)} {labelWithSection(item.label, item.sectionId, sectionLabelMap)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </View>
    </View>
  );
}

/**
 * Receipt-style locked (confirmed) view — a faithful port of the regular deal
 * center `LockedCalculatorView` (`CalculatorForm.tsx`). Rendered instead of the
 * editable category list once a tab's rollout price is confirmed (`readOnly`).
 */
function LockedCalculatorView({ name, entries, catMeta, price, drops, pricingConfig, verticals }: {
  name: string;
  entries: Record<string, CalculatorEntry>;
  catMeta: Record<string, { label: string; style: CatStyle }>;
  price: number;
  drops: any[];
  pricingConfig?: PricingConfig | null;
  verticals: CalculatorSchema[];
}) {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const metaFor = (categoryId: string) =>
    catMeta[categoryId] || { label: categoryId, style: { color: '#637381', icon: 'list', bg: '#F4F6F8' } as CatStyle };

  // Entered item rows (value > 0), each carrying its category for style/label lookup.
  const items = useMemo(() => (
    Object.values(entries)
      .filter((e) => e && e.inputValue > 0)
      .map((e) => ({ value: e.inputValue, unit: e.unit, label: e.label, categoryId: e.categoryId, sectionId: e.sectionId }))
  ), [entries]);

  // sectionId → label, so item rows read "5' 5" Gutter/DS/E (All Stories)" (web parity).
  const sectionLabelMap = useMemo(() => buildSectionLabelMap(verticals), [verticals]);

  // Distinct categories among entered items + per-category counts.
  const categoryCounts = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach((it) => { map[it.categoryId] = (map[it.categoryId] || 0) + 1; });
    return map;
  }, [items]);
  const uniqueCategories = useMemo(() => Object.keys(categoryCounts), [categoryCounts]);

  const visibleItems = selectedCat ? items.filter((it) => it.categoryId === selectedCat) : items;

  const liveTotals = useMemo(
    () => computeCalculatorTiers(entries, verticals, pricingConfig),
    [entries, verticals, pricingConfig],
  );

  // $200 job-minimum floor per tile (only once there's a real retail total).
  const floorTier = (v: number) => (liveTotals.retail > 0 && v < 200 ? 200 : v);
  // Web `calculateResultUtil` adds the per-tier static company fee (e.g. a par-only
  // fee) on top of the stored pure `totals` before the floor — the same fee applied
  // in the rollout tiles. (Bank-fee gross-up for `check` is 0; a financing method
  // would gross up in the rollout step, not this locked receipt.)
  const withFee = (v: number, key: 'cost' | 'par' | 'retail') =>
    applyFeesToTier(v, key, pricingConfig, { hasLineItems: v > 0 });
  const tiers = [
    { label: 'COST', value: floorTier(withFee(liveTotals.cost, 'cost')), isRetail: false },
    { label: 'PAR', value: floorTier(withFee(liveTotals.par, 'par')), isRetail: false },
    { label: 'RETAIL', value: floorTier(withFee(liveTotals.retail, 'retail')), isRetail: true },
  ];

  const lastDrop = drops.length > 0 ? drops[drops.length - 1] : null;
  const updated = lastDrop ? (lastDrop.dropedPrice ?? lastDrop.price ?? 0) : 0;

  return (
    <View style={{ marginBottom: 24 }}>
      {/* Amber "locked" banner */}
      <View style={{ backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 14, padding: 14, marginBottom: 14, flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name="lock-closed" size={16} color="#D97706" style={{ marginRight: 10 }} />
        <Text style={{ flex: 1, fontSize: 12, fontWeight: '600', color: '#92400E', lineHeight: 18 }}>
          Rollout price confirmed — this calculator is locked and cannot be edited. Duplicate this job tab or create a new one to edit a new job scope.
        </Text>
      </View>

      {/* Main receipt card */}
      <View style={{ backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#4CBB17', borderRadius: 20, paddingBottom: 16 }}>
        {/* Calculator name */}
        <View style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14 }}>
          <Text style={{ fontSize: 20, fontWeight: '900', color: '#1C252E' }}>{name}</Text>
        </View>

        {/* Category filter pills */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
          {uniqueCategories.map((catId) => {
            const style = metaFor(catId).style;
            const isActive = selectedCat === catId;
            return (
              <TouchableOpacity
                key={catId}
                onPress={() => setSelectedCat(isActive ? null : catId)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: isActive ? style.color : style.bg }}
              >
                <Ionicons name={style.icon} size={11} color={isActive ? '#FFF' : style.color} style={{ marginRight: 4 }} />
                <Text style={{ fontSize: 11, fontWeight: '900', color: isActive ? '#FFF' : style.color }}>{metaFor(catId).label} {categoryCounts[catId]}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Item rows / empty state */}
        {visibleItems.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 28 }}>
            <Ionicons name="cube-outline" size={32} color="#CBD5E1" />
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', marginTop: 8 }}>No items in this category</Text>
          </View>
        ) : (
          visibleItems.map((item, i) => {
            const style = metaFor(item.categoryId).style;
            return (
              <View key={i}>
                <View style={{ height: 1, backgroundColor: '#F1F5F9' }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 13 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: style.bg, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                    <Ionicons name={style.icon} size={18} color={style.color} />
                  </View>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#1C252E', flex: 1 }}>
                    <Text style={{ fontWeight: '900' }}>{item.value}{unitSuffix(item)}</Text>{'  '}{labelWithSection(item.label, item.sectionId, sectionLabelMap)}
                  </Text>
                </View>
              </View>
            );
          })
        )}

        {/* Divider before pricing */}
        <View style={{ height: 1, backgroundColor: '#F1F5F9', marginTop: 8, marginBottom: 14 }} />

        {/* COST / PAR / RETAIL tiles */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, marginBottom: 14 }}>
          {tiers.map((tier, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 12, borderWidth: tier.isRetail ? 1.5 : 1, borderColor: tier.isRetail ? '#4CBB17' : '#E2E8F0' }}>
              <Text style={{ fontSize: 9, fontWeight: '900', letterSpacing: 1.5, marginBottom: 4, color: '#94A3B8', textTransform: 'uppercase' }}>{tier.label}</Text>
              <Text style={{ fontSize: 14, fontWeight: '900', color: tier.isRetail ? '#444c97' : '#1C252E' }}>${Math.round(tier.value).toLocaleString()}</Text>
            </View>
          ))}
        </View>

        {/* Green price sub-card — Rollout End Price + optional Updated End Price */}
        <View style={{ marginHorizontal: 14, backgroundColor: '#F0FDF4', borderRadius: 14, borderWidth: 1.5, borderColor: '#4CBB17', overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 }}>
            <View>
              <Text style={{ fontSize: 11, fontWeight: '600', color: '#64748B', marginBottom: 2 }}>Rollout End Price</Text>
              <Text style={{ fontSize: 22, fontWeight: '900', color: '#15803D' }}>{price > 0 ? `$${Math.round(price).toLocaleString()}` : '—'}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="lock-closed" size={14} color="#ffb300" style={{ marginRight: 4 }} />
              <Text style={{ fontSize: 11, fontWeight: '900', color: '#4baf51', letterSpacing: 0.5 }}>LOCKED</Text>
            </View>
          </View>
          {drops.length > 0 && (
            <>
              <View style={{ height: 1, backgroundColor: '#BBF7D0' }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 }}>
                <View>
                  <Text style={{ fontSize: 11, fontWeight: '600', color: '#64748B', marginBottom: 2 }}>Updated End Price</Text>
                  <Text style={{ fontSize: 22, fontWeight: '900', color: '#15803D' }}>${Math.round(updated).toLocaleString()}</Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="lock-closed" size={14} color="#ffb300" style={{ marginRight: 4 }} />
                  <Text style={{ fontSize: 11, fontWeight: '900', color: '#4baf51', letterSpacing: 0.5 }}>LOCKED</Text>
                </View>
              </View>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

export function CalculatorView({
  verticals, entries, onEntryChange, readOnly = false,
  tabs = [], activeTabId, onTabSelect, onAddTab, onDuplicateTab, onDeleteTab, onReorderTabs, onViewAll,
  price = 0, drops = [], appointmentId, isLowesLead = false, pricingConfig,
}: CalculatorViewProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  // sectionId → label so Job Summary rows read "5' 5" Gutter/DS/E (All Stories)".
  const sectionLabelMap = useMemo(() => buildSectionLabelMap(verticals), [verticals]);
  const [menuIdx, setMenuIdx] = useState<number | null>(null);
  const [deleteModal, setDeleteModal] = useState<{ visible: boolean; tabId: string; name: string }>({ visible: false, tabId: '', name: '' });
  const [selectedVerticalId, setSelectedVerticalId] = useState<string | undefined>(verticals[0]?.id);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const tabsScrollRef = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);

  // Keep the selected vertical valid if the verticals list changes.
  useEffect(() => {
    if (!verticals.some((v) => v.id === selectedVerticalId)) {
      setSelectedVerticalId(verticals[0]?.id);
    }
  }, [verticals, selectedVerticalId]);

  const selectedVertical = verticals.find((v) => v.id === selectedVerticalId) || verticals[0];

  // On (re)open, jump to the vertical that already has entered values so the rep
  // immediately SEES what was added earlier instead of an empty first vertical.
  // One-shot per mount — it never fights a later manual vertical switch.
  const didAutoSelectRef = useRef(false);
  useEffect(() => {
    if (didAutoSelectRef.current) return;
    const enteredCatIds = new Set(
      Object.values(entries)
        .filter((e) => e && e.inputValue > 0)
        .map((e) => e.categoryId)
    );
    if (enteredCatIds.size === 0) return; // nothing entered yet — keep waiting
    const currentHasData = (selectedVertical?.categories || []).some((c) => enteredCatIds.has(c.id));
    if (!currentHasData) {
      const target = verticals.find((v) => (v.categories || []).some((c) => enteredCatIds.has(c.id)));
      if (target) setSelectedVerticalId(target.id);
    }
    didAutoSelectRef.current = true;
  }, [entries, verticals, selectedVertical]);

  // categoryId -> { label, style } across ALL verticals (drives the Job Summary).
  const catMeta = useMemo(() => {
    const map: Record<string, { label: string; style: CatStyle }> = {};
    verticals.forEach((v) => (v.categories || []).forEach((c) => {
      map[c.id] = { label: c.label, style: getCategoryStyle(c) };
    }));
    return map;
  }, [verticals]);

  // Flattened field list across every vertical — conditional `dependsOn`
  // references can point at fields in other categories, so resolution needs the
  // full set (mirrors web passing the whole form's `fields`).
  const allFields = useMemo(() => {
    const list: CalculatorField[] = [];
    verticals.forEach((v) => (v.categories || []).forEach((c) => {
      getCategoryDirectFields(c).forEach((f) => list.push(f));
      getCategorySectionFields(c).forEach((f) => list.push(f));
    }));
    return list;
  }, [verticals]);

  // Live value map keyed by field id AND name → the numeric value entered.
  const formState = useMemo(() => {
    const map: Record<string, number> = {};
    Object.values(entries).forEach((e) => {
      if (!e) return;
      if (e.fieldId) map[e.fieldId] = e.inputValue;
      if (e.name) map[e.name] = e.inputValue;
    });
    return map;
  }, [entries]);

  // Adapt the id-based tab model to the index-based draggable-tabs component.
  const tabCalcs = useMemo(() => tabs.map((t) => ({
    _id: t.id,
    // Numeric draft titles are internal identifiers. New tabs intentionally
    // remain untitled and display only their overflow menu.
    name: /^\d+$/.test(t.title) ? '' : t.title,
    isRolloutConfirmed: t.isRolloutConfirmed,
  })), [tabs]);
  const activeIdx = Math.max(0, tabs.findIndex((t) => t.id === activeTabId));
  const menuTab = menuIdx !== null ? tabs[menuIdx] : null;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: '#fff' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 90}
    >
      {/* Vertical horizontal scroller — select a vertical to reveal its categories.
          Matches web: only shown when more than one vertical is configured.
          Hidden entirely once the tab is locked (receipt view). */}
      {!readOnly && verticals.length > 1 && (
        <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEF2F6', backgroundColor: '#fff' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center' }}>
            {verticals.map((v) => {
              const style = getVerticalStyle(v);
              const isActive = v.id === selectedVertical?.id;
              const name = v.product?.name || 'Calculator';
              return (
                <TouchableOpacity
                  key={v.id}
                  onPress={() => setSelectedVerticalId(v.id)}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, marginRight: 8, backgroundColor: isActive ? style.color : '#F1F3F5' }}
                >
                  <Ionicons name={style.icon} size={15} color={isActive ? '#fff' : style.color} style={{ marginRight: 6 }} />
                  <Text style={{ fontSize: 13, fontWeight: isActive ? '800' : '600', color: isActive ? '#fff' : '#637381' }}>{name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 140 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {readOnly ? (
          <LockedCalculatorView
            name={tabs.find((t) => t.id === activeTabId)?.title || 'Calculator'}
            entries={entries}
            catMeta={catMeta}
            price={price}
            drops={drops}
            pricingConfig={pricingConfig}
            verticals={verticals}
          />
        ) : (
          <>
            {selectedVertical && (selectedVertical.categories || []).length > 0 ? (
              selectedVertical.categories.map((cat) => (
                <CategoryCard
                  key={cat.id}
                  category={cat}
                  entries={entries}
                  onEntryChange={onEntryChange}
                  readOnly={readOnly}
                  expanded={expanded[cat.id] !== false}
                  onToggle={() => setExpanded((p) => ({ ...p, [cat.id]: p[cat.id] === false }))}
                  allFields={allFields}
                  formState={formState}
                />
              ))
            ) : (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Ionicons name="cube-outline" size={32} color="#CBD5E1" />
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#94A3B8', marginTop: 8 }}>No categories configured</Text>
              </View>
            )}

            <JobSummary entries={entries} catMeta={catMeta} sectionLabelMap={sectionLabelMap} />

            {/* Add This Job to Job Tracker — web parity (rendered under the Job
                Summary in the editable calculator view, hidden when locked). */}
            {appointmentId && (
              <JobTrackerButton
                appointmentId={appointmentId}
                calculatorId={activeTabId}
                title={activeTab?.title}
                endPrice={price}
                paymentMethod={activeTab?.paymentMethod}
                isLowesLead={isLowesLead}
              />
            )}
          </>
        )}
      </ScrollView>

      {/* Calculator tabs footer — draggable tabs + add + view-all (rollout), matching the deal center */}
      <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 44 }}>
          <View style={{ flex: 1, marginRight: 12, height: 44, justifyContent: 'center', overflow: isDragging ? 'visible' : 'hidden' }}>
            <ScrollView
              ref={tabsScrollRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              scrollEnabled={!isDragging}
              onScroll={(e) => { scrollXRef.current = e.nativeEvent.contentOffset.x; setScrollOffset(e.nativeEvent.contentOffset.x); }}
              onContentSizeChange={(w) => setContentWidth(w)}
              onLayout={(e) => setScrollViewWidth(e.nativeEvent.layout.width)}
              scrollEventThrottle={16}
              style={{ flex: 1, overflow: isDragging ? 'visible' : 'hidden'}}
              contentContainerStyle={{ alignItems: 'center', flexGrow: 0,paddingEnd:20 }}
            >
              <HorizontalDraggableTabs
                calculators={tabCalcs}
                activeIdx={activeIdx}
                setActiveIdx={(idx) => tabs[idx] && onTabSelect?.(tabs[idx].id)}
                onReorder={(newOrder, newActiveIdx) => onReorderTabs?.(newOrder.map((c: any) => c._id), newOrder[newActiveIdx]?._id)}
                setMenuVisible={(idx) => setMenuIdx(idx)}
                onDragStateChange={setIsDragging}
                tabsScrollViewRef={tabsScrollRef}
                scrollXRef={scrollXRef}
                getIsDuplicate={() => false}
              />
            </ScrollView>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {onAddTab && (
              <TouchableOpacity onPress={onAddTab} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#F4F6F8', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="add" size={24} color="#1C252E" />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onViewAll} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#2169f3', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="grid" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Tab context menu (duplicate / rename / delete) */}
      <Modal transparent visible={menuIdx !== null} animationType="fade" onRequestClose={() => setMenuIdx(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.2)' }} onPress={() => setMenuIdx(null)}>
          <View style={{ position: 'absolute', bottom: 90, left: 20, right: 20, backgroundColor: '#fff', borderRadius: 16, padding: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 12, elevation: 10 }}>
            {onDuplicateTab && menuTab && (
              <TouchableOpacity onPress={() => { onDuplicateTab(menuTab.id); setMenuIdx(null); }} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12 }}>
                <Feather name="copy" size={18} color="#637381" />
                <Text style={{ marginLeft: 12, fontSize: 14, fontWeight: '600', color: '#1C252E' }}>Duplicate</Text>
              </TouchableOpacity>
            )}
            {onDeleteTab && menuTab && tabs.length > 1 && (
              <TouchableOpacity onPress={() => { setDeleteModal({ visible: true, tabId: menuTab.id, name: menuTab.title }); setMenuIdx(null); }} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12 }}>
                <Feather name="trash-2" size={18} color="#FF5630" />
                <Text style={{ marginLeft: 12, fontSize: 14, fontWeight: '600', color: '#FF5630' }}>Delete</Text>
              </TouchableOpacity>
            )}
            <View style={{ height: 1, backgroundColor: '#F1F5F9', marginVertical: 4 }} />
            <TouchableOpacity onPress={() => setMenuIdx(null)} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 12 }}>
              <Feather name="x" size={18} color="#919EAB" />
              <Text style={{ marginLeft: 12, fontSize: 14, fontWeight: '600', color: '#919EAB' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* Delete confirmation */}
      <Modal transparent visible={deleteModal.visible} animationType="fade" onRequestClose={() => setDeleteModal({ visible: false, tabId: '', name: '' })}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', padding: 24 }} onPress={() => setDeleteModal({ visible: false, tabId: '', name: '' })}>
          <Pressable style={{ width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 24, padding: 24 }}>
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#FF563020', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
              <Feather name="trash-2" size={22} color="#FF5630" />
            </View>
            <Text style={{ fontSize: 18, fontWeight: '900', color: '#1C252E', marginBottom: 8 }}>Delete Calculator?</Text>
            <Text style={{ fontSize: 14, color: '#637381', marginBottom: 24, lineHeight: 20 }}>Are you sure you want to delete "{deleteModal.name}"? This action cannot be undone.</Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => setDeleteModal({ visible: false, tabId: '', name: '' })} style={{ flex: 1, height: 48, borderRadius: 14, borderWidth: 1.5, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: '#637381' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { onDeleteTab?.(deleteModal.tabId); setDeleteModal({ visible: false, tabId: '', name: '' }); }} style={{ flex: 1, height: 48, borderRadius: 14, backgroundColor: '#FF5630', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14, fontWeight: '900', color: '#fff' }}>Delete</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}
