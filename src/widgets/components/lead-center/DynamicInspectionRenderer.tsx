// ─── DynamicInspectionRenderer.tsx ───────────────────────────────────────────
// Photo-first tagging UI for the dynamic inspection flow (mobile). Port of the
// web reference `dynamic-schema-renderer.js`:
//   CategoryTabStrip — the top category tab row (controlled)
//   CategoryBody     — renders one category's slots (dispatch by type)
//
// Compass-grid categories lay out by row/col; flat/grouped lists render as a
// 2-col pill grid; context-selector resolves levels then shows its slots;
// container categories nest into their own tab strip.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  getChildren,
  getCapturableSlots,
  isContainer,
  isContextSelector,
  allowsExtras,
  countCategory,
  uiKey,
  type InspectionCategory,
  type InspectionSlot,
} from './dynamic-inspection-schema-utils';
import type { DynamicInspectionCapture } from './useDynamicInspectionCapture';

const GREEN = '#4CBB17';
const AMBER = '#F59E0B';

/** Iconify string (e.g. "mdi:home-outline") → MaterialCommunityIcons name. */
export const iconifyToMdi = (raw?: string | null, fallback = 'image-outline'): string => {
  if (!raw) return fallback;
  const s = String(raw).trim();
  const stripped = s.includes(':') ? s.split(':').pop() || fallback : s;
  return stripped || fallback;
};

const slugify = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, '_').toLowerCase();

interface SlotClick {
  (category: InspectionCategory, slot: InspectionSlot, key: string): void;
}

interface CommonBodyProps {
  capture: DynamicInspectionCapture;
  onSlotClick: SlotClick;
  onTagAsExtra?: (category: InspectionCategory) => void;
  /**
   * Move-photo flow only: the ui-key of the slot the photo is being moved FROM.
   * That slot renders as an amber "FROM" tile so the rep can see the origin while
   * picking a destination (web `move-photo-dialog` parity).
   */
  moveFromKey?: string;
}

// ─── One slot as a wide tap-to-tag pill ───────────────────────────────────────

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
  const uploading = !!capture.uploadingKeys[key];
  const deleting = !!capture.deletingKeys[key];
  const moving = !!capture.movingKeys?.[key];
  const busy = uploading || deleting || moving;
  const filled = photos.length > 0;
  // The slot this photo is being moved out of — amber, and not tappable.
  const isMoveSource = !!moveFromKey && moveFromKey === key;

  return (
    <View style={{ flex: 1, minWidth: 0 }}>
      <TouchableOpacity
        activeOpacity={0.7}
        disabled={busy || isMoveSource}
        onPress={() => onSlotClick(category, slot, key)}
        style={{
          minHeight: 52,
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1.5,
          borderColor: isMoveSource ? AMBER : filled ? GREEN : 'rgba(255,255,255,0.12)',
          backgroundColor: isMoveSource ? 'rgba(245,158,11,0.12)' : filled ? GREEN : '#16302A',
        }}
      >
        {busy ? (
          <ActivityIndicator size="small" color={filled ? '#fff' : GREEN} />
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            {filled && !isMoveSource && <Icon name="check" size={13} color="#fff" />}
            <Text
              numberOfLines={2}
              style={{
                fontWeight: '600',
                fontSize: 13,
                textAlign: 'center',
                color: isMoveSource ? AMBER : filled ? '#fff' : '#1C252E',
              }}
            >
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

// ─── Simple 2-col pill grid ───────────────────────────────────────────────────

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

// ─── Compass layout (row/col positioned) ──────────────────────────────────────

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

// ─── Leaf body ────────────────────────────────────────────────────────────────

function LeafBody({ category, capture, onSlotClick, onTagAsExtra, moveFromKey }: CommonBodyProps & { category: InspectionCategory }) {
  const definedSlots = getCapturableSlots(category);
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

// ─── Context selector body ────────────────────────────────────────────────────

function ContextBody({ category, capture, onSlotClick, moveFromKey }: CommonBodyProps & { category: InspectionCategory }) {
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
  const contextSlotObjects: InspectionSlot[] = allResolved
    ? contextSlots.map((slotName) => ({
        id: `ctx::${slugify(path)}::${slugify(slotName)}`,
        name: slotName,
        storageName: `${path} — ${slotName}`,
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
                    <Text style={{ fontWeight: selected ? '700' : '500', color: selected ? '#fff' : '#1C252E', fontSize: 12 }}>
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

// ─── Category body dispatcher (container -> nested tabs) ───────────────────────

export function CategoryBody({ category, capture, onSlotClick, onTagAsExtra, moveFromKey }: CommonBodyProps & { category: InspectionCategory }) {
  if (isContainer(category)) {
    return (
      <NestedCategoryTabs
        categories={getChildren(category)}
        capture={capture}
        onSlotClick={onSlotClick}
        onTagAsExtra={onTagAsExtra}
        moveFromKey={moveFromKey}
      />
    );
  }
  if (isContextSelector(category)) {
    return <ContextBody category={category} capture={capture} onSlotClick={onSlotClick} moveFromKey={moveFromKey} />;
  }
  return <LeafBody category={category} capture={capture} onSlotClick={onSlotClick} onTagAsExtra={onTagAsExtra} moveFromKey={moveFromKey} />;
}

// ─── Tab strip (controlled) ───────────────────────────────────────────────────

export function CategoryTabStrip({
  categories,
  capture,
  active,
  onChange,
}: {
  categories: InspectionCategory[];
  capture: DynamicInspectionCapture;
  active: number;
  onChange: (i: number) => void;
}) {
  const list = Array.isArray(categories) ? categories : [];
  return (
    <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.12)' }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {list.map((cat, i) => {
          const { filled, total } = countCategory(cat, capture);
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

// ─── Nested tabs (for container categories inside a body) ─────────────────────

function NestedCategoryTabs({ categories, capture, onSlotClick, onTagAsExtra, moveFromKey }: CommonBodyProps & { categories: InspectionCategory[] }) {
  const [active, setActive] = useState(0);
  const list = Array.isArray(categories) ? categories : [];
  if (list.length === 0) return null;
  const idx = Math.min(active, list.length - 1);
  const current = list[idx];

  return (
    <View>
      <View style={{ marginBottom: 16 }}>
        <CategoryTabStrip categories={list} capture={capture} active={idx} onChange={setActive} />
      </View>
      <CategoryBody key={current.id} category={current} capture={capture} onSlotClick={onSlotClick} onTagAsExtra={onTagAsExtra} moveFromKey={moveFromKey} />
    </View>
  );
}
