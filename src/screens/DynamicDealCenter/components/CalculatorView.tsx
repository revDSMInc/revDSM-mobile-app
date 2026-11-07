import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { TabContextMenu, type TabContextMenuHandle } from './TabContextMenu';
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
import { computeCalculatorTiers } from '../utils/dynamic-rollout-pricing';
import { unitSuffix, labelWithSection, buildSectionLabelMap } from '../utils/item-format';
import { withPlanFee, type DealPlan } from '../hooks/useDealPricing';
import { describeFullPackage, getPackageSizeLabel } from '../utils/tab-naming';
import { fieldTextFor, shouldAcceptExternalValue } from '../utils/field-sync';
import { FullPackageTitle, FullPackageInfoModal, type PackageAnchorRect } from './FullPackageBadge';
import { useAuth } from '../../../hooks/useAuth';
import { NUMERIC_KEYBOARD } from '../../../utils/keyboard-type';
import { useNumPadActive } from '../../../widgets/common/keyboard/NumPad';
import { useNumPadScrollIntoView } from '../../../hooks/useNumPadScrollIntoView';
import {
  ADD_TAB_BLOCKED_MESSAGE,
  ADD_TAB_BLOCKED_TITLE,
  canAddCalculatorTab,
  canDuplicateCalculatorTab,
  DUPLICATE_TAB_BLOCKED_MESSAGE,
  DUPLICATE_TAB_BLOCKED_TITLE,
} from '../../../utils/calculator-tab-gate';
import { FlashMessage } from '../../../config/message';
import {
  changeKind,
  formatMessage,
  normalizeAutoQuantity,
  quantityForTotal,
  sumSources,
} from '../utils/auto-quantity';

interface CalculatorTabLite {
  id: string;
  title: string;
  isRolloutConfirmed?: boolean;
  paymentMethod?: string;
  entries?: Record<string, CalculatorEntry>;
}

interface CalculatorViewProps {
  verticals: CalculatorSchema[];
  entries: Record<string, CalculatorEntry>;
  onEntryChange: (fieldId: string, entry: CalculatorEntry) => void;
  onClearSection?: (categoryId: string, categoryLabel: string) => void;
  totals: CalculatorTotals;
  readOnly?: boolean;
  tabs?: CalculatorTabLite[];
  activeTabId?: string;
  onTabSelect?: (id: string) => void;
  onAddTab?: () => void;
  onRenameTab?: (id: string, name: string) => void;
  onDuplicateTab?: (id: string) => void;
  onDeleteTab?: (id: string) => void;
  onReorderTabs?: (orderedIds: string[], activeId: string) => void;
  onViewAll?: () => void;
  price?: number;
  drops?: any[];
  pricingConfig?: PricingConfig | null;
  plans?: Record<string, DealPlan>;
  defaultMethod?: string;
  appointmentId?: string;
  isLowesLead?: boolean;
  customerTabName?: string;
}

type CatStyle = SchemaStyle;

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

function FieldRow({ field, value, onChange, readOnly, highlightColor, isFixed, fixedValue }: {
  field: CalculatorField;
  value: number;
  /**
   * ⚠️ `isEmpty` says the BOX IS BLANK, as distinct from a typed `0`. The value stays a number
   * (pricing and totals need one), but an emptied field must LOG as `''` so the portal shows it
   * struck through as DELETED - web sends the raw `''` for exactly this. See
   * `utils/activity-log/pending-field-logs.ts`.
   */
  onChange: (val: number, isEmpty?: boolean) => void;
  readOnly?: boolean;
  highlightColor?: string | null;
  isFixed?: boolean;
  fixedValue?: number;
}) {
  const [text, setText] = useState(value > 0 ? String(value) : '');
  const [focused, setFocused] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  /**
   * ⚠️ The number this field itself last reported upwards.
   *
   * It is what separates the parent ECHOING the user's own keystroke from the parent being changed
   * from OUTSIDE (the category's Clear button). Without that distinction the sync effect could
   * only do one of two wrong things while the box had focus: ignore everything - which is why
   * pressing Clear left the focused field showing `66` until the rep tapped away - or accept
   * everything, which rewrites in-progress input (`6.` becomes `6` the moment the dot is typed).
   */
  const lastReported = useRef<number>(value);

  useEffect(() => {
    if (!isFixed) return;
    const fv = fixedValue || 0;
    if (value !== fv) onChangeRef.current(fv);
  }, [isFixed, fixedValue, value]);

  useEffect(() => {
    /**
     * ⚠️ A focused field still accepts an EXTERNAL change, which is what makes Clear work on the
     * box the rep is typing in. `value === lastReported.current` means the parent is only
     * reflecting this field's own last keystroke, so the local text (which may be mid-entry, like
     * `6.` or a leading `0`) is left exactly as typed.
     */
    if (!shouldAcceptExternalValue({ focused, incoming: value, lastReported: lastReported.current })) return;
    const next = fieldTextFor(value);
    lastReported.current = value;
    if (next !== text) setText(next);
  }, [value, focused, text]);

  const disabled = !!readOnly || !!field.disabled || !!isFixed;
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
            const num = parseFloat(cleaned) || 0;
            lastReported.current = num;
            // ⚠️ The number is still `0` for an empty box - only the LOG is told it was blank.
            onChange(num, cleaned.trim() === '');
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder=""
          placeholderTextColor="#919EAB"
          keyboardType={NUMERIC_KEYBOARD}
          returnKeyType="done"
        />
        {/* Right block: green retail PRICE with the measurement unit joined by a
            slash — "$650/unit" (web `dynamic-field.js` parity). A unit-less field
            shows just the price ("$650"); a price-less field shows the bare unit. */}
        {(!!field.price || !!field.unit) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
            {!!field.price ? (
              <Text style={{ fontSize: 10, fontWeight: '700', color: '#16a34a' }}>
                ${field.price.retail}
                {!!field.unit && <Text style={{ color: '#919EAB' }}>/{field.unit}</Text>}
              </Text>
            ) : (
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#919EAB' }}>{field.unit}</Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

function CategoryCard({ category, entries, onEntryChange, onClearSection, readOnly, expanded, onToggle, allFields, formState }: {
  category: CalculatorCategory;
  entries: Record<string, CalculatorEntry>;
  onEntryChange: (fieldId: string, entry: CalculatorEntry) => void;
  onClearSection?: (categoryId: string, categoryLabel: string) => void;
  readOnly?: boolean;
  expanded: boolean;
  onToggle: () => void;
  allFields: CalculatorField[];
  formState: Record<string, number>;
}) {
  const style = getCategoryStyle(category);
  const directFields = getCategoryDirectFields(category);
  const categoryFields = [...directFields, ...getCategorySectionFields(category)];
  const filledCount = categoryFields.filter((f) => (entries[f.id]?.inputValue || 0) > 0).length;

  const handleFieldChange = useCallback((field: CalculatorField, sectionId: string, value: number, isEmpty?: boolean) => {
    const price = field.price || { cost: 0, par: 0, retail: 0 };
    const productName = (entries[field.id] as any)?.productName ?? (category as any)._productName ?? (category as any).productName ?? '';
    onEntryChange(field.id, {
      fieldId: field.id, categoryId: category.id, sectionId, productName,
      name: field.name, label: field.label, unit: field.unit || '',
      inputValue: value,
      // ⚠️ LOG-ONLY marker: the box was blank, not set to zero. Nothing that prices reads it.
      ...(isEmpty ? { inputCleared: true } : null),
      computed: { cost: value * price.cost, par: value * price.par, retail: value * price.retail },
      pricingAtTimeOfEntry: { cost: String(price.cost), par: String(price.par), retail: String(price.retail) },
    });
  }, [category, onEntryChange, entries]);

  const clearCategory = useCallback(() => {
    if (onClearSection) {
      onClearSection(category.id, category.label);
      return;
    }
    directFields.forEach((f) => handleFieldChange(f, directSectionId(category.id), 0));
    (category.sections || []).forEach((s) => s.fields.forEach((f) => handleFieldChange(f, s.id, 0)));
  }, [onClearSection, category.id, category.label, directFields, category.sections, handleFieldChange]);

  const renderField = (field: CalculatorField, sectionId: string) => {
    const highlightColor = resolveConditionalFieldHighlight(field, formState, allFields);
    const fixed = isConditionalFieldFixed(field, formState, allFields);
    const fixedValue = fixed ? resolveConditionalFixedValue(field, formState, allFields) : 0;
    return (
      <FieldRow
        key={field.id}
        field={field}
        value={entries[field.id]?.inputValue || 0}
        onChange={(val, isEmpty) => handleFieldChange(field, sectionId, val, isEmpty)}
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

function JobSummary({ entries, catMeta, sectionLabelMap }: { entries: Record<string, CalculatorEntry>; catMeta: Record<string, { label: string; style: CatStyle }>; sectionLabelMap: Record<string, string> }) {
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

function LockedCalculatorView({ name, entries, catMeta, price, drops, pricingConfig, verticals, plans, method, onShowPackageInfo }: {
  name: string;
  entries: Record<string, CalculatorEntry>;
  catMeta: Record<string, { label: string; style: CatStyle }>;
  price: number;
  drops: any[];
  pricingConfig?: PricingConfig | null;
  verticals: CalculatorSchema[];
  plans?: Record<string, DealPlan>;
  method?: string;
  onShowPackageInfo?: (rect: PackageAnchorRect | null) => void;
}) {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  const metaFor = (categoryId: string) =>
    catMeta[categoryId] || { label: categoryId, style: { color: '#637381', icon: 'list', bg: '#F4F6F8' } as CatStyle };

  const items = useMemo(() => (
    Object.values(entries)
      .filter((e) => e && e.inputValue > 0)
      .map((e) => ({ value: e.inputValue, unit: e.unit, label: e.label, categoryId: e.categoryId, sectionId: e.sectionId }))
  ), [entries]);

  const sectionLabelMap = useMemo(() => buildSectionLabelMap(verticals), [verticals]);

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

  const floorTier = (v: number) => (liveTotals.retail > 0 && v < 200 ? 200 : v);
  const tierValue = (v: number, key: 'cost' | 'par' | 'retail') => {
    const withFee = applyFeesToTier(v, key, pricingConfig, { hasLineItems: v > 0 });
    return floorTier(withPlanFee(plans || {}, withFee, method));
  };
  const tiers = [
    { label: 'COST', value: tierValue(liveTotals.cost, 'cost'), isRetail: false },
    { label: 'PAR', value: tierValue(liveTotals.par, 'par'), isRetail: false },
    { label: 'RETAIL', value: tierValue(liveTotals.retail, 'retail'), isRetail: true },
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
        {/* Calculator name — or the package badge, same swap as the tab that opened it */}
        <View style={{ paddingHorizontal: 18, paddingTop: 18, paddingBottom: 14 }}>
          <FullPackageTitle
            {...describeFullPackage(entries, verticals)}
            title={name}
            size={20}
            color="#1C252E"
            iconColor="#16A34A"
            onInfo={onShowPackageInfo}
          />
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
  verticals, entries, onEntryChange, onClearSection, readOnly = false,
  tabs = [], activeTabId, onTabSelect, onAddTab, onDuplicateTab, onDeleteTab, onReorderTabs, onViewAll,
  price = 0, drops = [], appointmentId, isLowesLead = false, pricingConfig, plans, defaultMethod,
  customerTabName = '',
}: CalculatorViewProps) {
  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  /**
   * ⚠️ The ACTIVE tab is judged on the live `entries` prop, not on its copy inside `tabs`.
   * `entries` is what the rep is typing into right now; the `tabs` entry for it is written
   * by the same render, but reading the prop makes the gate independent of that ordering.
   * A gate that lags one keystroke behind is a gate that blocks a tab the rep just filled.
   */
  const liveTabs = useMemo(
    () =>
      (tabs || []).map((t) =>
        t && t.id === activeTabId ? { ...t, entries: entries || t.entries } : t
      ),
    [tabs, activeTabId, entries]
  );
  /**
   * ⚠️ Looks at EVERY tab, not just the active one. The rep can add a tab, switch away
   * and press plus again from elsewhere - gating on the active tab alone would still
   * leave blanks behind, which is the thing being prevented.
   */
  const addTabGate = useMemo(
    () => canAddCalculatorTab(liveTabs as any, activeTabId),
    [liveTabs, activeTabId]
  );
  const { user } = useAuth();
  const numPadActive = useNumPadActive();
  const bodyScrollRef = useRef<ScrollView>(null);
  const bodyContentRef = useRef<View>(null);
  useNumPadScrollIntoView(bodyScrollRef, bodyContentRef, 16);
  const lockedMethod = activeTab?.paymentMethod || user?.defaultPaymentMethod || defaultMethod || 'check';
  const sectionLabelMap = useMemo(() => buildSectionLabelMap(verticals), [verticals]);
  const tabMenuRef = useRef<TabContextMenuHandle>(null);
  const [packageInfoVisible, setPackageInfoVisible] = useState(false);
  const [packageAnchor, setPackageAnchor] = useState<PackageAnchorRect | null>(null);
  const openPackageInfo = useCallback((rect: PackageAnchorRect | null) => {
    setPackageAnchor(rect);
    setPackageInfoVisible(true);
  }, []);
  const [deleteModal, setDeleteModal] = useState<{ visible: boolean; tabId: string; name: string }>({ visible: false, tabId: '', name: '' });
  const [selectedVerticalId, setSelectedVerticalId] = useState<string | undefined>(verticals[0]?.id);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [contentWidth, setContentWidth] = useState(0);
  const [scrollViewWidth, setScrollViewWidth] = useState(0);
  const tabsScrollRef = useRef<ScrollView>(null);
  const scrollXRef = useRef(0);

  useEffect(() => {
    if (!verticals.some((v) => v.id === selectedVerticalId)) {
      setSelectedVerticalId(verticals[0]?.id);
    }
  }, [verticals, selectedVerticalId]);

  const selectedVertical = verticals.find((v) => v.id === selectedVerticalId) || verticals[0];

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

  const catMeta = useMemo(() => {
    const map: Record<string, { label: string; style: CatStyle }> = {};
    verticals.forEach((v) => (v.categories || []).forEach((c) => {
      map[c.id] = { label: c.label, style: getCategoryStyle(c) };
    }));
    return map;
  }, [verticals]);

  const allFields = useMemo(() => {
    const list: CalculatorField[] = [];
    verticals.forEach((v) => (v.categories || []).forEach((c) => {
      getCategoryDirectFields(c).forEach((f) => list.push(f));
      getCategorySectionFields(c).forEach((f) => list.push(f));
    }));
    return list;
  }, [verticals]);

  const formState = useMemo(() => {
    const map: Record<string, number> = {};
    Object.values(entries).forEach((e) => {
      if (!e) return;
      if (e.fieldId) map[e.fieldId] = e.inputValue;
      if (e.name) map[e.name] = e.inputValue;
    });
    return map;
  }, [entries]);

  const autoFields = useMemo(() => {
    const out: { field: CalculatorField; config: NonNullable<ReturnType<typeof normalizeAutoQuantity>>; categoryId: string; sectionId: string }[] = [];
    verticals.forEach((v) => (v.categories || []).forEach((c) => {
      const add = (f: CalculatorField, sectionId: string) => {
        const config = normalizeAutoQuantity((f as any).conditional);
        if (config) out.push({ field: f, config, categoryId: c.id, sectionId });
      };
      getCategoryDirectFields(c).forEach((f) => add(f, directSectionId(c.id)));
      (c.sections || []).forEach((s) => s.fields.forEach((f) => add(f, s.id)));
    }));
    return out;
  }, [verticals]);

  const lastTotalsRef = useRef<Record<string, number>>({});
  const burstRef = useRef<Record<string, { start: number; latest: number; total: number; timer: ReturnType<typeof setTimeout> | null }>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    if (readOnly || !autoFields.length) return;
    autoFields.forEach(({ field, config, categoryId, sectionId }) => {
      const key = `${activeTabId || 'default'}:${field.id}`;
      const total = sumSources(config, formState, allFields);
      const prevTotal = lastTotalsRef.current[key];
      lastTotalsRef.current[key] = total;
      if (prevTotal === undefined || prevTotal === total) return;

      const current = formState[field.id] || 0;
      if (current !== quantityForTotal(config, prevTotal)) return;
      const next = quantityForTotal(config, total);
      if (next === current) return;

      const price = field.price || { cost: 0, par: 0, retail: 0 };
      const existing: any = entriesRef.current[field.id];
      onEntryChange(field.id, {
        fieldId: field.id, categoryId, sectionId,
        productName: existing?.productName ?? '',
        name: field.name, label: field.label, unit: field.unit || '',
        inputValue: next,
        computed: { cost: next * price.cost, par: next * price.par, retail: next * price.retail },
        pricingAtTimeOfEntry: { cost: String(price.cost), par: String(price.par), retail: String(price.retail) },
      });

      const burst = burstRef.current[key] || { start: current, latest: current, total, timer: null };
      if (!burst.timer) burst.start = current;
      burst.latest = next;
      burst.total = total;
      if (burst.timer) clearTimeout(burst.timer);
      burst.timer = setTimeout(() => {
        burst.timer = null;
        const kind = changeKind(burst.start, burst.latest);
        const template = !config.notify
          ? undefined
          : kind === 'added'
            ? config.addedMessage
            : kind === 'removed'
              ? config.removedMessage
              : kind === 'updated'
                ? config.updatedMessage
                : undefined;
        if (template) {
          FlashMessage.info(
            field.label,
            formatMessage(template, { value: burst.latest, total: burst.total, previous: burst.start, field: field.label })
          );
        }
      }, 700);
      burstRef.current[key] = burst;
    });
  }, [formState, autoFields, allFields, activeTabId, readOnly, onEntryChange]);

  useEffect(() => () => {
    Object.values(burstRef.current).forEach((b) => b.timer && clearTimeout(b.timer));
  }, []);

  const tabCalcs = useMemo(() => tabs.map((t, idx) => {
    const pkg = describeFullPackage(t.entries || {}, verticals);
    return {
    _id: t.id,
    name: /^\d+$/.test(t.title) ? (idx === 0 ? customerTabName || '' : '') : t.title,
    isRolloutConfirmed: t.isRolloutConfirmed,
    isFullPackage: pkg.isFullPackage,
    packageExtras: pkg.extras,
    packageSize: pkg.isFullPackage ? getPackageSizeLabel(t.title) : '',
    };
  }), [tabs, verticals, customerTabName]);
  const activeIdx = Math.max(0, tabs.findIndex((t) => t.id === activeTabId));

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

      <ScrollView ref={bodyScrollRef} style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View ref={bodyContentRef} collapsable={false}>
        {readOnly ? (
          <LockedCalculatorView
            name={tabs.find((t) => t.id === activeTabId)?.title || 'Calculator'}
            onShowPackageInfo={openPackageInfo}
            entries={entries}
            catMeta={catMeta}
            price={price}
            drops={drops}
            pricingConfig={pricingConfig}
            verticals={verticals}
            plans={plans}
            method={lockedMethod}
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
                  onClearSection={onClearSection}
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
          </>
        )}
        </View>
      </ScrollView>

      {/* Calculator tabs footer — draggable tabs + add + view-all (rollout), matching the deal center */}
      <View style={{ backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0', paddingHorizontal: 16, paddingTop: 8, paddingBottom: numPadActive ? 8 : 12 }}>
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
                setMenuVisible={(idx) => tabMenuRef.current?.open(idx)}
                onDragStateChange={setIsDragging}
                tabsScrollViewRef={tabsScrollRef}
                scrollXRef={scrollXRef}
                getIsDuplicate={() => false}
                onShowPackageInfo={(_calc, _idx, rect) => openPackageInfo(rect)}
              />
            </ScrollView>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {onAddTab && (
              /**
               * ⚠️ `Pressable`, not `TouchableOpacity`, and never `disabled`.
               *
               * A disabled button swallows the tap and the rep learns nothing - they press it
               * again, then ask why the app is broken. The whole point of the gate is the
               * explanation, which can only fire if the press lands. `hitSlop` matters too:
               * this sits in a 44pt row beside a draggable tab strip, where a few stray pixels
               * are the difference between a tap and nothing at all.
               *
               * ⚠️ The style is a plain OBJECT, never Pressable's `({ pressed }) => ({...})`
               * form. The chrome here (grey fill, border, radius) is the same as the original
               * TouchableOpacity and must stay byte-identical - a style callback rendered the
               * button as a bare icon with no card behind it.
               */
              <Pressable
                onPress={() => {
                  const gate = addTabGate;
                  if (!gate.allowed) {
                    FlashMessage.warning(
                      gate.title || ADD_TAB_BLOCKED_TITLE,
                      gate.message || ADD_TAB_BLOCKED_MESSAGE
                    );
                    return;
                  }
                  onAddTab();
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Add calculator"
                accessibilityState={{ disabled: !addTabGate.allowed }}
                style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#F4F6F8', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center', opacity: addTabGate.allowed ? 1 : 0.4 }}
              >
                <Ionicons name="add" size={24} color="#1C252E" />
              </Pressable>
            )}
            <TouchableOpacity onPress={onViewAll} style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#2169f3', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="grid" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Full-package contents — opened by the ⓘ on a package tab or on the locked
          receipt heading. Anchored above the footer tab bar it belongs to. */}
      <FullPackageInfoModal
        visible={packageInfoVisible}
        onClose={() => setPackageInfoVisible(false)}
        anchorRect={packageAnchor}
      />

      {/* Tab context menu (duplicate / delete) - self-contained so opening it does not re-render this screen. */}
      <TabContextMenu
        ref={tabMenuRef}
        tabs={liveTabs}
        onDuplicateTab={
          onDuplicateTab
            ? (id) => {
                const gate = canDuplicateCalculatorTab(liveTabs as any, id);
                if (!gate.allowed) {
                  FlashMessage.warning(
                    gate.title || DUPLICATE_TAB_BLOCKED_TITLE,
                    gate.message || DUPLICATE_TAB_BLOCKED_MESSAGE
                  );
                  return;
                }
                onDuplicateTab(id);
              }
            : undefined
        }
        onDeleteRequest={onDeleteTab ? (id, name) => setDeleteModal({ visible: true, tabId: id, name }) : undefined}
      />

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
