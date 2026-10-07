import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, Modal } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  getChildren,
  getCapturableSlots,
  isContextSelector,
  isChipContainer,
  isTabContainer,
  getChipOptions,
  getChipLabel,
  usesPerChipContent,
  allowsExtras,
  countCategory,
  uiKey,
  SCOPE_SEP,
  type InspectionCategory,
  type InspectionSlot,
} from './dynamic-inspection-schema-utils';
import type { DynamicInspectionCapture } from './useDynamicInspectionCapture';

const GREEN = '#4CBB17';
const FROM_YELLOW = '#FACC15';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const MDI_GLYPHS: Record<string, number> = require('react-native-vector-icons/glyphmaps/MaterialCommunityIcons.json');
const isValidMdi = (name: string): boolean =>
  !!name && Object.prototype.hasOwnProperty.call(MDI_GLYPHS, name);

const MDI_ALIASES: Record<string, string> = {
  house: 'home',
  search: 'magnify',
  magnifier: 'magnify',
  magnifer: 'magnify', // solar's spelling
  settings: 'cog',
  gear: 'cog',
  trash: 'trash-can',
  edit: 'pencil',
  photo: 'image',
  picture: 'image',
  window: 'window-closed-variant',
  windows: 'window-closed-variant',
  floor: 'floor-plan',
  flooring: 'floor-plan',
  roof: 'home-roof',
  roofing: 'home-roof',
  gutter: 'home-roof',
  location: 'map-marker',
  marker: 'map-marker',
  pin: 'map-marker',
};

const KEYWORD_MDI: Array<[RegExp, string]> = [
  [/window/, 'window-closed-variant'],
  [/door/, 'door'],
  [/floor/, 'floor-plan'],
  [/roof|gutter|soffit|fascia/, 'home-roof'],
  [/remodel|renovat/, 'home-edit-outline'],
  [/kitchen/, 'silverware-fork-knife'],
  [/bath|shower/, 'shower'],
  [/home|house/, 'home'],
  [/hammer|tool|build|construct|repair|contractor/, 'hammer-wrench'],
  [/paint/, 'format-paint'],
  [/location|map|marker|\bpin\b|geo|place|address/, 'map-marker'],
  [/ruler|measure|tape/, 'ruler'],
  [/camera|photo|image|picture/, 'image'],
  [/search|inspect|magnif/, 'magnify'],
  [/leaf|plant|eco|garden/, 'leaf'],
  [/solar|panel/, 'solar-panel'],
  [/electric|bolt|flash|power|light/, 'flash'],
  [/water|plumb|drop/, 'water'],
  [/sun|weather|sky/, 'white-balance-sunny'],
  [/document|file|paper|note|form/, 'file-document-outline'],
];

export const iconifyToMdi = (raw?: string | null, fallback = 'image-outline'): string => {
  if (!raw) return fallback;
  const s = String(raw).trim();
  let name = (s.includes(':') ? s.split(':').pop() || '' : s).trim().toLowerCase();

  const STYLE_SUFFIX =
    /-(filled|regular|color|colored|duotone|twotone|solid|light|thin|bold|linear|broken|sharp|fill)$/;
  let prev = '';
  while (name && name !== prev) {
    prev = name;
    name = name.replace(/-\d+$/, '').replace(STYLE_SUFFIX, '');
  }

  const aliased = MDI_ALIASES[name] || name;
  if (isValidMdi(aliased)) return aliased;

  const haystack = `${name} ${s}`.toLowerCase();
  for (const [re, mdi] of KEYWORD_MDI) {
    if (re.test(haystack) && isValidMdi(mdi)) return mdi;
  }

  return isValidMdi(fallback) ? fallback : 'help-circle-outline';
};

const slugify = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, '_').toLowerCase();

export interface InspectionProduct {
  id: string;
  name: string;
  icon?: string | null;
}

export function ProductDropdown({
  products,
  selectedProductId,
  onSelect,
}: {
  products: InspectionProduct[];
  selectedProductId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = React.useRef<View>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const selected = products.find((p) => p.id === selectedProductId) || products[0];

  const openMenu = () => {
    const node = btnRef.current as any;
    if (node?.measureInWindow) {
      node.measureInWindow((x: number, y: number, width: number, height: number) => {
        setAnchor({ x, y: y + height + 6, width });
        setOpen(true);
      });
    } else {
      setOpen(true);
    }
  };

  return (
    <>
      {/* Compact header pill — a green-outlined product button with a MUI dropdown caret. */}
      <View ref={btnRef} collapsable={false}>
        <TouchableOpacity
          onPress={openMenu}
          activeOpacity={0.7}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            paddingHorizontal: 14,
            height: 34,
            borderRadius: 17,
            borderWidth: 1,
            borderColor: 'rgba(76,187,23,0.5)',
          }}
        >
          {selected?.icon ? <Icon name={iconifyToMdi(selected.icon)} size={16} color={GREEN} /> : null}
          <Text style={{ color: GREEN, fontWeight: '800', fontSize: 14 }} numberOfLines={1}>
            {selected?.name || 'Select product'}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity activeOpacity={1} onPress={() => setOpen(false)} style={{ flex: 1 }}>
          {/* Menu sits directly below the button (measured), not centered. */}
          <View
            style={{
              position: 'absolute',
              top: anchor?.y ?? 100,
              left: anchor?.x ?? 24,
              minWidth: anchor?.width ?? 200,
              backgroundColor: '#0D1F1A',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: 'rgba(76,187,23,0.25)',
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 6 },
              shadowOpacity: 0.35,
              shadowRadius: 14,
              elevation: 12,
            }}
          >
            {products.map((p, idx) => {
              const isActive = p.id === (selected?.id);
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => { onSelect(p.id); setOpen(false); }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingHorizontal: 16,
                    paddingVertical: 14,
                    borderTopWidth: idx === 0 ? 0 : 1,
                    borderColor: 'rgba(255,255,255,0.08)',
                    backgroundColor: isActive ? 'rgba(76,187,23,0.12)' : 'transparent',
                  }}
                >
                  {p.icon ? <Icon name={iconifyToMdi(p.icon)} size={18} color={isActive ? GREEN : 'rgba(255,255,255,0.85)'} /> : null}
                  <Text style={{ color: isActive ? GREEN : 'rgba(255,255,255,0.9)', fontWeight: isActive ? '800' : '600', fontSize: 15 }} numberOfLines={1}>
                    {p.name}
                  </Text>
                  {isActive && <Icon name="check" size={18} color={GREEN} style={{ marginLeft: 'auto' }} />}
                </TouchableOpacity>
              );
            })}
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

interface SlotClick {
  (category: InspectionCategory, slot: InspectionSlot, key: string): void;
}

interface CommonBodyProps {
  capture: DynamicInspectionCapture;
  onSlotClick: SlotClick;
  onTagAsExtra?: (category: InspectionCategory) => void;
  moveFromKey?: string;
  scope?: string[];
}

function SlotButton({
  slot,
  category,
  capture,
  onSlotClick,
  moveFromKey,
}: {
  slot: InspectionSlot;
  category: InspectionCategory;
  capture: DynamicInspectionCapture;
  onSlotClick: SlotClick;
  moveFromKey?: string;
}) {
  const key = slot.isExtra ? (slot.key as string) : uiKey(category.id, slot.id);
  const photos = capture.getPhotos(category.label, slot.storageName);
  const uploading = capture.online !== false && !!capture.uploadingKeys[key];
  const deleting = !!capture.deletingKeys[key];
  const moving = !!capture.movingKeys?.[key];
  const filled = photos.length > 0;
  const showSpinner = deleting || moving || (uploading && !filled);
  const disabled = deleting || moving || (!!moveFromKey && moveFromKey === key);
  const isMoveSource = !!moveFromKey && moveFromKey === key;

  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={disabled}
        onPress={() => onSlotClick(category, slot, key)}
        style={{
          minHeight: 52,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: isMoveSource ? FROM_YELLOW : filled ? GREEN : 'rgba(255,255,255,0.12)',
          backgroundColor: isMoveSource
            ? 'rgba(250,204,21,0.18)'
            : filled
              ? 'rgba(76,187,23,0.8)'
              : 'rgba(0,120,103,0.1)',
        }}
      >
        {showSpinner ? (
          <ActivityIndicator size="small" color={filled ? '#fff' : GREEN} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            {uploading && (
              <ActivityIndicator size="small" color="#fff" style={{ marginRight: 2 }} />
            )}
            <Text
              numberOfLines={2}
              style={{
                flexShrink: 1,
                fontWeight: '600',
                fontSize: 13,
                textAlign: 'center',
                color: isMoveSource ? FROM_YELLOW : '#fff',
              }}
            >
              {/* The tick is INSIDE the label, not a sibling. As a sibling it was laid
                  out against the WHOLE two-line text block — vertically centred between
                  the lines and pushed to the pill's left edge, because a wrapped Text
                  takes the full width it was measured against. Inline, it is simply the
                  first glyph of the first line and stays beside the label however many
                  lines it wraps to. `Icon` renders a Text, so nesting is legal and it
                  already forces `fontWeight: 'normal'` — the glyph is unchanged. */}
              {filled && !isMoveSource && <Icon name="check" size={13} color="#fff" />}
              {filled && !isMoveSource ? ' ' : ''}
              {isMoveSource ? `FROM · ${slot.name}` : slot.name}
            </Text>
            {photos.length > 1 && (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: 8,
                  backgroundColor: 'rgba(0,0,0,0.2)',
                }}
              >
                <Text style={{ fontSize: 10, fontWeight: '700', color: '#fff' }}>{photos.length}</Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
      {slot.isExtra && !filled && (
        <TouchableOpacity
          onPress={() => capture.removeExtra(category, slot)}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#0D1F1A', borderRadius: 10 }}
        >
          <Icon name="close-circle" size={18} color="#94A3B8" />
        </TouchableOpacity>
      )}
    </View>
  );
}

function PillGrid({
  category,
  slots,
  capture,
  onSlotClick,
  moveFromKey,
}: {
  category: InspectionCategory;
  slots: InspectionSlot[];
  capture: DynamicInspectionCapture;
  onSlotClick: SlotClick;
  moveFromKey?: string;
}) {
  const rows: InspectionSlot[][] = [];
  for (let i = 0; i < slots.length; i += 2) rows.push(slots.slice(i, i + 2));
  return (
    <View style={{ gap: 8 }}>
      {rows.map((row, rIdx) => (
        <View key={rIdx} style={{ flexDirection: 'row', gap: 8 }}>
          {row.map((slot) => (
            <SlotButton
              key={slot.isExtra ? (slot.key as string) : uiKey(category.id, slot.id)}
              slot={slot}
              category={category}
              capture={capture}
              onSlotClick={onSlotClick}
              moveFromKey={moveFromKey}
            />
          ))}
          {row.length === 1 && <View style={{ flex: 1 }} />}
        </View>
      ))}
    </View>
  );
}

function CompassLayout({
  category,
  slots,
  capture,
  onSlotClick,
  moveFromKey,
}: {
  category: InspectionCategory;
  slots: InspectionSlot[];
  capture: DynamicInspectionCapture;
  onSlotClick: SlotClick;
  moveFromKey?: string;
}) {
  const haveCoords = slots.every((s) => Number.isInteger(s.row) && Number.isInteger(s.col));
  if (!haveCoords) {
    return <PillGrid category={category} slots={slots} capture={capture} onSlotClick={onSlotClick} moveFromKey={moveFromKey} />;
  }

  const cols = Math.max(...slots.map((s) => s.col as number)) + 1;
  const rows = Math.max(...slots.map((s) => s.row as number)) + 1;
  const grid: (InspectionSlot | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null)
  );
  slots.forEach((s) => {
    grid[s.row as number][s.col as number] = s;
  });

  return (
    <View>
      {category.topLabel && (
        <Text style={{ textAlign: 'center', fontWeight: '700', color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
          ↑ {category.topLabel}
        </Text>
      )}
      <View style={{ gap: 8 }}>
        {grid.map((row, rIdx) => (
          <View key={rIdx} style={{ flexDirection: 'row', gap: 8 }}>
            {row.map((slot, cIdx) =>
              slot ? (
                <SlotButton
                  key={slot.id}
                  slot={slot}
                  category={category}
                  capture={capture}
                  onSlotClick={onSlotClick}
                  moveFromKey={moveFromKey}
                />
              ) : (
                <View key={`empty-${rIdx}-${cIdx}`} style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' }}>
                  {category.centerLabel && rIdx === Math.floor(rows / 2) && cIdx === Math.floor(cols / 2) ? (
                    <Text style={{ color: 'rgba(255,255,255,0.12)', fontWeight: '700', letterSpacing: 1 }}>
                      {category.centerLabel}
                    </Text>
                  ) : null}
                </View>
              )
            )}
          </View>
        ))}
      </View>
      {category.bottomLabel && (
        <Text style={{ textAlign: 'center', fontWeight: '700', color: 'rgba(255,255,255,0.7)', marginTop: 8 }}>
          ↓ {category.bottomLabel}
        </Text>
      )}
    </View>
  );
}

function groupSlots(slots: InspectionSlot[]): [string, InspectionSlot[]][] {
  const groups = new Map<string, InspectionSlot[]>();
  slots.forEach((s) => {
    const g = s.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(s);
  });
  return Array.from(groups.entries());
}

function LeafBody({ category, capture, onSlotClick, onTagAsExtra, moveFromKey, scope = [] }: CommonBodyProps & { category: InspectionCategory }) {
  const scopedCategory = scope.length ? { ...category, _scope: scope } : category;
  const definedSlots = getCapturableSlots(scopedCategory);
  const extras = capture.extrasFor(category);
  const compass = category.type === 'compass-grid';
  const grouped = groupSlots(definedSlots);

  return (
    <View>
      {definedSlots.length > 0 &&
        (compass ? (
          <CompassLayout category={category} slots={definedSlots} capture={capture} onSlotClick={onSlotClick} moveFromKey={moveFromKey} />
        ) : (
          grouped.map(([groupTitle, groupSlotList]) => (
            <View key={groupTitle || '_'} style={{ marginBottom: groupTitle ? 12 : 0 }}>
              {!!groupTitle && (
                <Text
                  style={{
                    fontWeight: '700',
                    color: 'rgba(255,255,255,0.7)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                    marginBottom: 6,
                    fontSize: 11,
                  }}
                >
                  {groupTitle}
                </Text>
              )}
              <PillGrid category={category} slots={groupSlotList} capture={capture} onSlotClick={onSlotClick} moveFromKey={moveFromKey} />
            </View>
          ))
        ))}

      {/* Extra photos section (below defined slots) */}
      {extras.length > 0 && (
        <View style={{ marginTop: definedSlots.length > 0 ? 14 : 0 }}>
          <Text style={{ fontWeight: '700', color: GREEN, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, fontSize: 11 }}>
            Extra photos ({extras.length})
          </Text>
          <PillGrid category={category} slots={extras} capture={capture} onSlotClick={onSlotClick} moveFromKey={moveFromKey} />
        </View>
      )}

      {definedSlots.length === 0 && extras.length === 0 && !allowsExtras(category) && (
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>No photo slots configured.</Text>
      )}

      {allowsExtras(category) && (
        <TouchableOpacity
          onPress={() => (onTagAsExtra ? onTagAsExtra(category) : capture.addExtra(category))}
          style={{
            marginTop: 16,
            minHeight: 48,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: 'rgba(76, 187, 23, 0.4)',
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 6,
          }}
        >
          <Icon name="plus" size={16} color={GREEN} />
          <Text style={{ color: GREEN, fontWeight: '700', fontSize: 13 }}>Tag as Extra</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function ContextBody({ category, capture, onSlotClick, moveFromKey, scope = [] }: CommonBodyProps & { category: InspectionCategory }) {
  const levels = Array.isArray(category.contextLevels) ? category.contextLevels : [];
  const contextSlots = Array.isArray(category.contextSlots) ? category.contextSlots : [];
  const [resolved, setResolved] = useState<Record<string, string | null>>({});

  const setLevel = (key: string, value: string) => {
    const idx = levels.findIndex((l) => l.key === key);
    setResolved((prev) => {
      const next: Record<string, string | null> = { ...prev, [key]: value };
      levels.slice(idx + 1).forEach((l) => delete next[l.key]);
      return next;
    });
  };

  const resolvedValues = levels.map((l) => resolved[l.key] || null);
  const allResolved = levels.length > 0 && resolvedValues.every(Boolean);
  const path = resolvedValues.filter(Boolean).join(' › ');
  const scopePrefix = scope.length ? `${scope.join(SCOPE_SEP)}${SCOPE_SEP}` : '';
  const scopeIdPrefix = scope.length ? `${scope.join('||')}::` : '';
  const contextSlotObjects: InspectionSlot[] = allResolved
    ? contextSlots.map((slotName) => ({
        id: `${scopeIdPrefix}ctx::${slugify(path)}::${slugify(slotName)}`,
        name: slotName,
        storageName: `${scopePrefix}${path} — ${slotName}`,
      }))
    : [];

  return (
    <View>
      {levels.map((level, lIdx) => {
        const prevResolved = lIdx === 0 || resolvedValues[lIdx - 1];
        return (
          <View key={level.key} style={{ marginBottom: 12, opacity: prevResolved ? 1 : 0.4 }} pointerEvents={prevResolved ? 'auto' : 'none'}>
            <Text style={{ fontWeight: '700', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontSize: 11 }}>
              {level.label}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {(level.options || []).map((opt) => {
                const selected = resolved[level.key] === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    onPress={() => setLevel(level.key, opt)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      borderWidth: 1,
                      borderColor: selected ? GREEN : 'rgba(255,255,255,0.12)',
                      backgroundColor: selected ? GREEN : 'transparent',
                    }}
                  >
                    <Text style={{ fontWeight: selected ? '700' : '500', color: selected ? '#fff' : 'rgba(255,255,255,0.85)', fontSize: 12 }}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}

      {allResolved && contextSlotObjects.length > 0 && (
        <View style={{ marginTop: 4 }}>
          <Text style={{ fontWeight: '700', color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontSize: 11 }}>
            Photos — {path}
          </Text>
          <PillGrid category={category} slots={contextSlotObjects} capture={capture} onSlotClick={onSlotClick} moveFromKey={moveFromKey} />
        </View>
      )}

      {!allResolved && (
        <View style={{ padding: 16, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center' }}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>Complete the selections above to tag photos.</Text>
        </View>
      )}

      {category.allowNewContextInstance && allResolved && (
        <TouchableOpacity
          onPress={() => setResolved({})}
          style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(76,187,23,0.4)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
        >
          <Icon name="plus" size={16} color={GREEN} />
          <Text style={{ color: GREEN, fontWeight: '700', fontSize: 12 }}>{category.newInstanceLabel || 'New Instance'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function CategoryBody({ category, capture, onSlotClick, onTagAsExtra, moveFromKey, scope = [] }: CommonBodyProps & { category: InspectionCategory }) {
  if (isChipContainer(category)) {
    return (
      <ChipSelectorBody
        category={category}
        capture={capture}
        scope={scope}
        onSlotClick={onSlotClick}
        onTagAsExtra={onTagAsExtra}
        moveFromKey={moveFromKey}
      />
    );
  }
  if (isContextSelector(category)) {
    return <ContextBody category={category} capture={capture} scope={scope} onSlotClick={onSlotClick} moveFromKey={moveFromKey} />;
  }
  if (isTabContainer(category) && getChildren(category).length > 0) {
    return (
      <NestedCategoryTabs
        categories={getChildren(category)}
        capture={capture}
        scope={scope}
        onSlotClick={onSlotClick}
        onTagAsExtra={onTagAsExtra}
        moveFromKey={moveFromKey}
      />
    );
  }
  return (
    <CompositeBody
      category={category}
      capture={capture}
      scope={scope}
      onSlotClick={onSlotClick}
      onTagAsExtra={onTagAsExtra}
      moveFromKey={moveFromKey}
    />
  );
}

function ChipSelectorBody({ category, capture, scope = [], onSlotClick, moveFromKey, onTagAsExtra }: CommonBodyProps & { category: InspectionCategory }) {
  const perChip = usesPerChipContent(category);
  const kids = getChildren(category);
  const header = getChipLabel(category);

  const chips = perChip
    ? kids.map((child) => ({ key: child.id, label: child.label, contentCategories: [child] }))
    : getChipOptions(category).map((opt) => ({ key: opt, label: opt, contentCategories: kids }));

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const activeChip = chips.find((c) => c.key === selectedKey) || null;
  const chipScope = activeChip ? [...scope, activeChip.label] : scope;
  const activeIsChip = activeChip ? activeChip.contentCategories.some((c) => isChipContainer(c)) : false;

  const countChip = (chip: { label: string; contentCategories: InspectionCategory[] }) =>
    chip.contentCategories.reduce(
      (acc, c) => {
        const r = countCategory(c, capture, [...scope, chip.label]);
        return { filled: acc.filled + r.filled, total: acc.total + r.total };
      },
      { filled: 0, total: 0 }
    );

  const selCount = activeChip ? countChip(activeChip) : { filled: 0, total: 0 };

  return (
    <View>
      {!!header && (
        <Text style={{ fontWeight: '700', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontSize: 11 }}>
          {header}
        </Text>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: activeChip ? 12 : 0 }}>
        {chips.map((chip) => {
          const isSel = activeChip?.key === chip.key;
          const { filled, total } = countChip(chip);
          const done = total > 0 && filled >= total;
          return (
            <TouchableOpacity
              key={chip.key}
              onPress={() => setSelectedKey(isSel ? null : chip.key)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 4,
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: isSel ? GREEN : done ? 'rgba(76,187,23,0.5)' : 'rgba(255,255,255,0.2)',
                backgroundColor: isSel ? GREEN : 'transparent',
              }}
            >
              {done && !isSel && <Icon name="check-circle" size={14} color={GREEN} />}
              <Text style={{ fontWeight: isSel ? '700' : '500', color: isSel ? '#fff' : '#fff', fontSize: 12 }}>
                {chip.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {!activeChip && (
        <View style={{ padding: 16, borderRadius: 12, borderWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center' }}>
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
            Select a {String(header || 'option').toLowerCase()} to continue.
          </Text>
        </View>
      )}

      {activeChip && (
        <View>
          {!activeIsChip && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 12, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(76,187,23,0.4)', backgroundColor: 'rgba(76,187,23,0.06)' }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="check" size={18} color="#fff" />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 14, color: '#fff' }}>
                  {[...scope, activeChip.label].join(SCOPE_SEP)}
                </Text>
                <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
                  {selCount.filled}/{selCount.total} tagged
                </Text>
              </View>
            </View>
          )}

          {activeChip.contentCategories.map((child) => (
            <View key={child.id} style={{ marginBottom: 12 }}>
              <CategoryBody
                category={child}
                capture={capture}
                scope={chipScope}
                onSlotClick={onSlotClick}
                moveFromKey={moveFromKey}
                onTagAsExtra={onTagAsExtra}
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function CompositeBody({ category, capture, scope = [], onSlotClick, moveFromKey, onTagAsExtra }: CommonBodyProps & { category: InspectionCategory }) {
  const kids = getChildren(category);
  const scopedCategory = scope.length ? { ...category, _scope: scope } : category;
  const ownSlots = getCapturableSlots(scopedCategory);

  const leaf = (
    <LeafBody category={category} capture={capture} scope={scope} onSlotClick={onSlotClick} moveFromKey={moveFromKey} onTagAsExtra={onTagAsExtra} />
  );

  if (kids.length === 0) return leaf;

  return (
    <View>
      {ownSlots.length > 0 && (
        <View style={{ marginBottom: 16 }}>
          {!!category.label && (
            <Text style={{ fontWeight: '700', color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, fontSize: 11 }}>
              {category.label}
            </Text>
          )}
          {leaf}
        </View>
      )}
      {kids.map((child) => (
        <View key={child.id} style={{ marginBottom: 12 }}>
          <CategoryBody
            category={child}
            capture={capture}
            scope={scope}
            onSlotClick={onSlotClick}
            moveFromKey={moveFromKey}
            onTagAsExtra={onTagAsExtra}
          />
        </View>
      ))}
    </View>
  );
}

export function CategoryTabStrip({
  categories,
  capture,
  active,
  onChange,
  scope = [],
}: {
  categories: InspectionCategory[];
  capture: DynamicInspectionCapture;
  active: number;
  onChange: (i: number) => void;
  scope?: string[];
}) {
  const list = Array.isArray(categories) ? categories : [];
  return (
    <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {list.map((cat, i) => {
          const { filled, total } = countCategory(cat, capture, scope);
          const isActive = i === active;
          const color = isActive ? GREEN : 'rgba(255,255,255,0.7)';
          return (
            <TouchableOpacity
              key={cat.id}
              onPress={() => onChange(i)}
              style={{
                minWidth: 72,
                paddingHorizontal: 14,
                paddingVertical: 10,
                alignItems: 'center',
                gap: 2,
                borderBottomWidth: 2,
                borderBottomColor: isActive ? GREEN : 'transparent',
              }}
            >
              <Icon name={iconifyToMdi(cat.icon)} size={22} color={color} />
              <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color, maxWidth: 90 }}>
                {cat.label}
              </Text>
              <Text style={{ fontSize: 9, fontWeight: '600', color }}>
                {filled}/{total}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function NestedCategoryTabs({ categories, capture, onSlotClick, onTagAsExtra, moveFromKey, scope = [] }: CommonBodyProps & { categories: InspectionCategory[] }) {
  const [active, setActive] = useState(0);
  const list = Array.isArray(categories) ? categories : [];
  if (list.length === 0) return null;
  const idx = Math.min(active, list.length - 1);
  const current = list[idx];

  return (
    <View>
      <View style={{ marginBottom: 16 }}>
        <CategoryTabStrip categories={list} capture={capture} active={idx} onChange={setActive} scope={scope} />
      </View>
      <CategoryBody key={current.id} category={current} capture={capture} scope={scope} onSlotClick={onSlotClick} onTagAsExtra={onTagAsExtra} moveFromKey={moveFromKey} />
    </View>
  );
}
