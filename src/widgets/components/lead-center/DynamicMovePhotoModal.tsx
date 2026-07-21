// ─── DynamicMovePhotoModal.tsx ───────────────────────────────────────────────
// Re-tag a stored inspection photo into a different slot, without re-shooting it.
// Mobile port of the web reference
//   src/sections/job/components/dynamic-inspection-photos/move-photo-dialog.js
//
// The whole design point (web's too) is that it REUSES the capture grid
// (`CategoryTabStrip` + `CategoryBody`), so re-filing looks exactly like tagging:
// the rep sees the same slot pills and taps the destination. `moveFromKey` marks
// the source slot so it reads as the "FROM" tile.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image, Modal } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getTopTabs,
  indexSchema,
  uiKey,
  norm,
  type InspectionCategory,
  type InspectionSlot,
} from './dynamic-inspection-schema-utils';
import { CategoryTabStrip, CategoryBody } from './DynamicInspectionRenderer';
import type { CapturedPhoto } from './useDynamicInspectionCapture';

const GREEN = '#4CBB17';

export interface MoveState {
  photo: CapturedPhoto;
  fromCategory: InspectionCategory;
  fromSlot: InspectionSlot;
  /** The manage-card key, so the spinner shows on the originating card. */
  key: string;
}

interface DynamicMovePhotoModalProps {
  visible: boolean;
  moveState: MoveState | null;
  categories: InspectionCategory[];
  capture: any;
  onClose: () => void;
  onDelete?: () => void;
}

export function DynamicMovePhotoModal({
  visible,
  moveState,
  categories,
  capture,
  onClose,
  onDelete,
}: DynamicMovePhotoModalProps) {
  const insets = useSafeAreaInsets();
  const topTabs = useMemo(() => getTopTabs(categories), [categories]);

  const fromKey = useMemo(() => {
    if (!moveState) return '';
    const { fromCategory, fromSlot } = moveState;
    return fromSlot.isExtra
      ? (fromSlot.key as string)
      : uiKey(fromCategory.id as string, fromSlot.id as string);
  }, [moveState]);

  // Open on the tab that contains the source slot (web parity), so the rep starts
  // where the photo currently lives rather than always on tab 0.
  const initialTab = useMemo(() => {
    if (!moveState) return 0;
    const idx = topTabs.findIndex((tab) => {
      const leafs = indexSchema([tab]).leafCategories;
      return leafs.some((c) => norm(c.label as string) === norm(moveState.fromCategory.label as string));
    });
    return idx >= 0 ? idx : 0;
  }, [topTabs, moveState]);

  const [activeTab, setActiveTab] = useState(initialTab);
  // Re-seat the tab whenever a new move begins.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (moveState && seededFor !== moveState.key) {
    setSeededFor(moveState.key);
    setActiveTab(initialTab);
  }

  const tabIndex = Math.min(activeTab, Math.max(topTabs.length - 1, 0));
  const activeCategory = topTabs[tabIndex] || null;

  const handleSlotClick = (category: InspectionCategory, slot: InspectionSlot) => {
    if (!moveState) return;
    const targetKey = slot.isExtra
      ? (slot.key as string)
      : uiKey(category.id as string, slot.id as string);
    if (targetKey === fromKey) return; // same slot — no-op

    // Close first so the rep sees the manage grid update, then fire the move.
    onClose();
    capture.movePhoto({
      photo: moveState.photo,
      fromCategoryLabel: moveState.fromCategory.label as string,
      fromSubcategory: moveState.fromSlot.storageName as string,
      toCategoryLabel: category.label as string,
      toSubcategory: slot.storageName as string,
      key: moveState.key,
    });
  };

  const previewUri = moveState?.photo?.secureUrl || undefined;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      {/* Web parity (move-photo-dialog.js:88-97): the move screen uses the ambient
          dark theme (`background.paper` = #0D1F1A), not a white sheet. The reused
          slot grid pills are tuned for this dark background. */}
      <View style={{ flex: 1, backgroundColor: '#0D1F1A' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: insets.top + 12, paddingBottom: 12, backgroundColor: GREEN }}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: '700', fontSize: 15 }}>
            Move Photo
          </Text>
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11 }}>
            {capture.progress.filled}/{capture.progress.total}
          </Text>
        </View>

        {/* RE-TAGGING banner */}
        <View style={{ backgroundColor: 'rgba(76,187,23,0.08)', paddingHorizontal: 16, paddingVertical: 10 }}>
          <Text style={{ color: GREEN, fontWeight: '900', fontSize: 10, letterSpacing: 1, marginBottom: 2 }}>
            RE-TAGGING
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
            Moving photo from{' '}
            <Text style={{ fontWeight: '800', color: '#fff' }}>{moveState?.fromSlot?.name}</Text>. Pick a new slot.
          </Text>
        </View>

        {/* The photo being moved, on a black backdrop */}
        <View style={{ backgroundColor: '#000', height: 170, alignItems: 'center', justifyContent: 'center' }}>
          {previewUri ? (
            <Image source={{ uri: previewUri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
          ) : (
            <Icon name="image-outline" size={32} color="#637381" />
          )}
          {!!onDelete && (
            <TouchableOpacity
              onPress={onDelete}
              style={{ position: 'absolute', top: 8, right: 8, width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="trash-can-outline" size={18} color="#EF4444" />
            </TouchableOpacity>
          )}
        </View>
        <Text style={{ textAlign: 'center', color: '#919EAB', fontSize: 11, paddingVertical: 8 }}>
          Tag this photo below
        </Text>

        {topTabs.length > 0 && (
          <CategoryTabStrip
            categories={topTabs}
            capture={capture}
            active={tabIndex}
            onChange={setActiveTab}
          />
        )}

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
          {!!activeCategory && (
            <CategoryBody
              category={activeCategory}
              capture={capture}
              onSlotClick={handleSlotClick}
              moveFromKey={fromKey}
            />
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
