// ─── DynamicManagePhotosView.tsx ─────────────────────────────────────────────
// Schema-driven ("dynamic") MANAGE PHOTOS screen for the mobile lead-center.
// Mobile port of the web reference
//   src/sections/job/components/dynamic-inspection-photos/manage-photos-view.js
//   src/sections/job/components/dynamic-inspection-photos/dynamic-manage-photos-dialog.js
//
// This is deliberately NOT the capture view. `DynamicInspectionView` renders every
// schema SLOT as a tappable pill (including the empty ones) so the rep knows where
// a photo still needs shooting. Manage Photos is the opposite: it renders ONE CARD
// PER PHOTO THAT ACTUALLY EXISTS — a thumbnail grid — and categories with no photos
// disappear entirely. That mirrors web's `sections.filter(s => s.cards.length > 0)`.
//
// Feature parity with the web dialog: per-photo delete (with confirm), move to
// another slot, full-screen preview, the "+ EXTRAS" and "+ ANNOTATED" sections,
// and annotate select-mode. Layout follows web's MOBILE breakpoints (2-column
// grids, header controls stacked rather than inline).
// ─────────────────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Modal,
  useWindowDimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAuth } from '../../../hooks/useAuth';
import {
  getTopTabs,
  indexSchema,
  getCapturableSlots,
  uiKey,
  type InspectionProduct,
  type InspectionCategory,
  type InspectionSlot,
} from './dynamic-inspection-schema-utils';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryTabStrip, ProductDropdown } from './DynamicInspectionRenderer';
import { useDynamicInspectionCapture, type CapturedPhoto } from './useDynamicInspectionCapture';
import { DynamicMovePhotoModal, type MoveState } from './DynamicMovePhotoModal';

const GREEN = '#4CBB17';
const RED = '#EF4444';

interface PhotoCard {
  cat: InspectionCategory;
  /** Display label above the card — the slot name (or the extra's name). */
  label: string;
  /** Storage name used for delete/move lookups. */
  storageName: string;
  key: string;
  photo: CapturedPhoto;
}

interface PendingDelete {
  categoryLabel: string;
  subcategory: string;
  key: string;
  photo: CapturedPhoto;
}

interface DynamicManagePhotosViewProps {
  lead: any;
  products: InspectionProduct[];
  onClose: () => void;
  refetch?: () => void | Promise<void>;
  /**
   * Re-open Manage Photos after the annotation editor closes. Annotating leaves
   * this screen (ImageAnnotation is a route, not a modal), so the host has to put
   * the rep back where they were — same contract as the static ManagePhotosModal.
   */
  onReopen?: () => void;
}

export function DynamicManagePhotosView({
  lead,
  products,
  onClose,
  refetch,
  onReopen,
}: DynamicManagePhotosViewProps) {
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    products.length ? (products[0].id as string) : null,
  );
  const [activeTab, setActiveTab] = useState(0);
  const [preview, setPreview] = useState<{ uri: string; label: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Annotate select-mode (web: the header pencil). selectedMap is keyed by card
  // key so the same photo can't be picked twice.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMap, setSelectedMap] = useState<Map<string, PhotoCard>>(new Map());
  const [moveState, setMoveState] = useState<MoveState | null>(null);

  // Total photos across ALL products, deduped by s3url and including annotated
  // copies — mirrors web's `managePhotosCount`, so the title matches the count on
  // the "Manage Photos (N)" button that opened this screen. Deliberately NOT
  // capture.totalPhotos, which is scoped to the selected product.
  const managePhotosCount = useMemo(() => {
    const photos = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];
    const seen = new Set<string>();
    photos.forEach((p: any) => {
      if (!p?.s3url || seen.has(p.s3url)) return;
      seen.add(p.s3url);
    });
    return seen.size;
  }, [lead?.salesPhotos]);

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedMap(new Map());
  };

  const toggleSelect = (card: PhotoCard) => {
    setSelectedMap((prev) => {
      const next = new Map(prev);
      if (next.has(card.key)) next.delete(card.key);
      else next.set(card.key, card);
      return next;
    });
  };

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || products[0] || null,
    [products, selectedProductId],
  );

  const activeCategories = useMemo(
    () => selectedProduct?.categories || [],
    [selectedProduct],
  );

  // Same product scoping as the capture view, so both read the same photo buckets.
  const capture = useDynamicInspectionCapture({
    lead,
    categories: activeCategories,
    productKey: (selectedProduct?.name as string) || (selectedProduct?.id as string) || undefined,
    userId: user?._id || user?.id,
    refreshLeadData: refetch ? () => refetch() : undefined,
  });
  const topTabs = useMemo(() => getTopTabs(activeCategories), [activeCategories]);
  const tabIndex = Math.min(activeTab, Math.max(topTabs.length - 1, 0));
  const activeCategory = topTabs[tabIndex] || null;

  // Every leaf category under the active tab (container tabs resolve to their
  // children), exactly as web does via indexSchema().leafCategories.
  const leafs = useMemo(
    () => indexSchema(activeCategory ? [activeCategory] : []).leafCategories,
    [activeCategory],
  );

  // ONE CARD PER EXISTING PHOTO. A slot with no photos contributes nothing, and a
  // category whose cards are all empty is dropped — no placeholder boxes.
  const sections = useMemo(
    () =>
      leafs
        .map((cat) => {
          const cards: PhotoCard[] = [];
          getCapturableSlots(cat).forEach((slot: InspectionSlot) => {
            const base = uiKey(cat.id as string, slot.id as string);
            capture.getPhotos(cat.label as string, slot.storageName as string).forEach((photo, i) => {
              cards.push({
                cat,
                label: slot.name as string,
                storageName: slot.storageName as string,
                key: `${base}-${photo.s3url || photo._id || i}`,
                photo,
              });
            });
          });
          return { cat, cards };
        })
        .filter((s) => s.cards.length > 0),
    [leafs, capture],
  );

  const extraCards = useMemo(
    () =>
      leafs.flatMap((cat) =>
        capture.extrasFor(cat).flatMap((slot: InspectionSlot) =>
          capture
            .getPhotos(cat.label as string, slot.storageName as string)
            .map((photo, i) => ({
              cat,
              label: slot.name as string,
              storageName: slot.storageName as string,
              key: `${slot.key || slot.id}-${photo.s3url || photo._id || i}`,
              photo,
            })),
        ),
      ),
    [leafs, capture],
  );

  // Annotated copies for the active tab, across every leaf category. Marked by a
  // " (Annotated)" suffix on the subcategory — there is no separate field.
  const annotated = useMemo(
    () =>
      leafs.flatMap((cat) =>
        (capture.getAnnotatedFor?.(cat.label as string) || []).map(({ subcategory, photo }, i) => ({
          cat,
          label: subcategory.replace(/\(Annotated\)/i, '').trim() || subcategory,
          storageName: subcategory,
          key: `annotated-${cat.id}-${photo.s3url || photo._id || i}`,
          photo,
        })),
      ),
    [leafs, capture],
  );

  // Base names (per category) that already have an annotated copy. The matching
  // ORIGINAL must not be selectable again — mobile's annotation screen always
  // appends " (Annotated)", so re-selecting would produce "X (Annotated) (Annotated)".
  const annotatedBaseKeys = useMemo(
    () =>
      new Set(
        annotated.map(
          ({ cat, storageName }) =>
            `${cat.id}::${storageName.replace(/\(Annotated\)/i, '').trim().toLowerCase()}`,
        ),
      ),
    [annotated],
  );

  // Move is only worth offering when there is at least one OTHER slot to move to.
  // Counted across every category of the product, not just the active tab.
  const moveTargetCount = useMemo(() => {
    const { leafCategories } = indexSchema(activeCategories);
    return leafCategories.reduce(
      (n, cat) => n + getCapturableSlots(cat).length + capture.extrasFor(cat).length,
      0,
    );
  }, [activeCategories, capture]);

  const multiLeaf = sections.length > 1;
  const isEmpty = sections.length === 0 && extraCards.length === 0 && annotated.length === 0;

  // Two columns, matching web's `xs: repeat(2, 1fr)` mobile breakpoint.
  const GAP = 12;
  const H_PADDING = 16;
  const cardWidth = (width - H_PADDING * 2 - GAP) / 2;

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await capture.deletePhoto(pendingDelete);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  // Open the shared annotation editor for the current selection. Mobile's
  // ImageAnnotation screen uploads the annotated copies itself (appending
  // " (Annotated)" to each subcategory), so there is nothing to persist here.
  // `categoryName` MUST be the product-scoped category the photo is stored under,
  // or the annotated copy lands outside this product's buckets.
  const openAnnotationForSelection = () => {
    const cards = [...selectedMap.values()].filter((c) => c.photo.secureUrl);
    if (!cards.length) return;
    const selectedPhotos = cards.map((c) => ({
      uri: c.photo.secureUrl as string,
      index: 0,
      s3url: c.photo.s3url,
      id: c.photo._id || c.photo.s3url || c.key,
      subcategory: c.storageName,
      categoryName: c.photo.category || (c.cat.label as string),
    }));
    onClose();
    navigation.navigate('ImageAnnotation', {
      selectedPhotos,
      lead,
      onSaveSuccess: () => {
        exitSelectMode();
        refetch?.();
        onReopen?.();
      },
      onCancel: () => {
        exitSelectMode();
        onReopen?.();
      },
    });
  };

  const renderCard = (
    card: PhotoCard,
    { showLabel = true, canMove = false, selectable = false }: { showLabel?: boolean; canMove?: boolean; selectable?: boolean } = {},
  ) => {
    const uri = card.photo.secureUrl || undefined;
    const busy = !!capture.deletingKeys[card.key] || !!capture.movingKeys?.[card.key];
    const isSelected = selectedMap.has(card.key);
    // An original that already has an annotated copy can't be re-annotated.
    const alreadyAnnotated = annotatedBaseKeys.has(
      `${card.cat.id}::${card.label.trim().toLowerCase()}`,
    );
    const lockedFromSelect = selectMode && selectable && alreadyAnnotated;
    const selectableNow = selectMode && selectable && !lockedFromSelect;

    return (
      <View key={card.key} style={{ width: cardWidth, marginBottom: 16, opacity: lockedFromSelect ? 0.45 : 1 }}>
        {showLabel && (
          <Text
            numberOfLines={1}
            style={{ fontWeight: '700', fontSize: 12, color: '#FFFFFF', marginBottom: 6, paddingHorizontal: 2 }}
          >
            {card.label}
          </Text>
        )}
        <View
          style={{
            borderRadius: 8,
            borderWidth: isSelected ? 2 : 1.5,
            borderColor: isSelected ? GREEN : 'rgba(255,255,255,0.12)',
            overflow: 'hidden',
            backgroundColor: '#16302A',
          }}
        >
          <TouchableOpacity
            activeOpacity={uri ? 0.8 : 1}
            disabled={!uri || lockedFromSelect}
            onPress={() => {
              if (!uri) return;
              if (selectableNow) toggleSelect(card);
              else if (!selectMode) setPreview({ uri, label: card.label });
            }}
            style={{ width: '100%', aspectRatio: 1.6, alignItems: 'center', justifyContent: 'center' }}
          >
            {uri ? (
              <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
            ) : (
              <Icon name="image-outline" size={24} color="#C4CDD5" />
            )}

            {/* Selection bubble / already-annotated badge */}
            {selectMode && selectable && (
              <View
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  borderWidth: 2,
                  borderColor: '#fff',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: lockedFromSelect
                    ? 'rgba(0,0,0,0.5)'
                    : isSelected
                      ? GREEN
                      : 'rgba(0,0,0,0.5)',
                }}
              >
                {lockedFromSelect ? (
                  <Icon name="check-decagram" size={16} color={GREEN} />
                ) : isSelected ? (
                  <Icon name="check" size={16} color="#fff" />
                ) : null}
              </View>
            )}
          </TouchableOpacity>

          {/* Actions are hidden in select mode (web parity) */}
          {!selectMode && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, padding: 8 }}>
              {canMove && moveTargetCount > 1 ? (
                <TouchableOpacity
                  disabled={busy}
                  onPress={() =>
                    setMoveState({
                      photo: card.photo,
                      fromCategory: card.cat,
                      fromSlot: { name: card.label, storageName: card.storageName } as InspectionSlot,
                      key: card.key,
                    })
                  }
                  style={{
                    flex: 1,
                    height: 32,
                    borderRadius: 8,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 4,
                    borderWidth: 1.5,
                    borderStyle: 'dashed',
                    borderColor: 'rgba(76,187,23,0.4)',
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  {capture.movingKeys?.[card.key] ? (
                    <ActivityIndicator size="small" color={GREEN} />
                  ) : (
                    <>
                      <Icon name="folder-move-outline" size={14} color={GREEN} />
                      <Text style={{ color: GREEN, fontWeight: '700', fontSize: 11 }}>Move</Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : (
                <View style={{ flex: 1 }} />
              )}
              <TouchableOpacity
                disabled={busy}
                onPress={() =>
                  setPendingDelete({
                    categoryLabel: card.cat.label as string,
                    subcategory: card.storageName,
                    key: card.key,
                    photo: card.photo,
                  })
                }
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1.5,
                  borderColor: 'rgba(239,68,68,0.25)',
                  backgroundColor: 'rgba(239,68,68,0.06)',
                  opacity: busy ? 0.5 : 1,
                }}
              >
                {capture.deletingKeys[card.key] ? (
                  <ActivityIndicator size="small" color={RED} />
                ) : (
                  <Icon name="trash-can-outline" size={18} color={RED} />
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#0D1F1A' }}>
      {/* Header — close + title with the live photo count */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, backgroundColor: '#0D1F1A', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' }}>
        {/* X exits select mode first, then closes (web parity) */}
        <TouchableOpacity
          onPress={selectMode ? exitSelectMode : onClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Icon name={selectMode ? 'arrow-left' : 'close'} size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: '700', fontSize: 15 }}>
          {selectMode ? 'Select photos' : `Manage Photos (${managePhotosCount})`}
        </Text>
        {selectMode ? (
          <TouchableOpacity
            disabled={selectedMap.size === 0}
            onPress={openAnnotationForSelection}
            style={{
              paddingHorizontal: 12,
              height: 30,
              borderRadius: 15,
              backgroundColor: '#0D1F1A',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: selectedMap.size === 0 ? 0.5 : 1,
            }}
          >
            <Text style={{ color: GREEN, fontWeight: '800', fontSize: 12 }}>
              Annotate ({selectedMap.size})
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            onPress={() => setSelectMode(true)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="pencil-outline" size={22} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Product dropdown (only when the company configured more than one) — web parity */}
      {products.length > 1 && (
        <ProductDropdown
          products={products as any}
          selectedProductId={selectedProduct?.id ?? null}
          onSelect={(id) => {
            setSelectedProductId(id);
            setActiveTab(0);
          }}
        />
      )}

      {topTabs.length > 0 && (
        <CategoryTabStrip
          categories={topTabs}
          capture={capture}
          active={tabIndex}
          onChange={setActiveTab}
        />
      )}

      {/* Block on the FIRST load only. The hook flips `loading` on every reload
          (each secure-URL resolve), so gating the whole grid on it made the photos
          blink out and back on every refresh — including after each upload. Once
          we have something to show, refreshes happen under the existing content. */}
      {capture.loading && isEmpty ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={GREEN} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: H_PADDING, paddingBottom: 48 }}>
          {isEmpty ? (
            <View
              style={{
                marginTop: 48,
                alignSelf: 'center',
                maxWidth: 480,
                paddingVertical: 40,
                paddingHorizontal: 24,
                borderRadius: 16,
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: 'rgba(76,187,23,0.25)',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: GREEN, fontWeight: '700', fontSize: 15, textAlign: 'center' }}>
                No photos in this section yet.
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, textAlign: 'center', marginTop: 8 }}>
                Use the tabs above to browse other sections.
              </Text>
            </View>
          ) : (
            <>
              {sections.map(({ cat, cards }) => (
                <View key={cat.id} style={{ marginBottom: 12 }}>
                  {/* Breadcrumb header, shown only when the tab has >1 leaf */}
                  {multiLeaf && (
                    <Text style={{ fontWeight: '700', fontSize: 13, color: '#FFFFFF', marginBottom: 8 }}>
                      {((cat as any).path || [cat.label]).join(' / ')}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                    {cards.map((card) => renderCard(card, { canMove: true, selectable: true }))}
                  </View>
                </View>
              ))}

              {extraCards.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <Text style={{ color: '#F59E0B', fontWeight: '900', fontSize: 11, letterSpacing: 1 }}>
                      + EXTRAS
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' }}>
                      {extraCards.length} photo{extraCards.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                    {extraCards.map((card) =>
                      renderCard(card, { showLabel: false, selectable: true }),
                    )}
                  </View>
                </View>
              )}

              {/* + ANNOTATED — display + delete only. Mobile's annotation screen
                  has no re-edit path (it always appends " (Annotated)"), so these
                  are deliberately not re-selectable. */}
              {annotated.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <Text style={{ color: '#F59E0B', fontWeight: '900', fontSize: 11, letterSpacing: 1 }}>
                      + ANNOTATED
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' }}>
                      {annotated.length} photo{annotated.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                    {annotated.map((card) => renderCard(card))}
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
      )}

      {/* Move photo — reuses the capture grid so re-filing looks like tagging */}
      <DynamicMovePhotoModal
        visible={!!moveState}
        moveState={moveState}
        categories={activeCategories}
        capture={capture}
        onClose={() => setMoveState(null)}
        onDelete={() => {
          if (!moveState) return;
          const m = moveState;
          setMoveState(null);
          setPendingDelete({
            categoryLabel: m.fromCategory.label as string,
            subcategory: m.fromSlot.storageName as string,
            key: m.key,
            photo: m.photo,
          });
        }}
      />

      {/* Full-screen preview */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)' }}>
          {/* Inset the close row below the status bar — the preview Modal is
              transparent with no SafeAreaView, so a fixed padding overlapped the
              status bar on notched devices (esp. reopening a just-annotated photo). */}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, paddingTop: insets.top + 12 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: '#fff', fontWeight: '700', fontSize: 14 }}>
              {preview?.label}
            </Text>
            <TouchableOpacity onPress={() => setPreview(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
          {!!preview && (
            <Image source={{ uri: preview.uri }} style={{ flex: 1 }} resizeMode="contain" />
          )}
        </View>
      </Modal>

      {/* Delete confirmation — web never deletes straight from the card */}
      <Modal visible={!!pendingDelete} transparent animationType="fade" onRequestClose={() => setPendingDelete(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 380, backgroundColor: '#0D1F1A', borderRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="trash-can-outline" size={24} color={RED} />
              </View>
              {!!pendingDelete?.photo?.secureUrl && (
                <Image
                  source={{ uri: pendingDelete.photo.secureUrl as string }}
                  style={{ width: 48, height: 48, borderRadius: 8 }}
                  resizeMode="cover"
                />
              )}
            </View>
            <Text style={{ fontWeight: '800', fontSize: 16, color: '#FFFFFF', marginBottom: 6 }}>
              Delete this photo?
            </Text>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 20 }}>
              This photo will be permanently deleted. This action cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                disabled={deleting}
                onPress={() => setPendingDelete(null)}
                style={{ flex: 1, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontWeight: '700', color: 'rgba(255,255,255,0.7)' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={deleting}
                onPress={confirmDelete}
                style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: RED, alignItems: 'center', justifyContent: 'center', opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={{ fontWeight: '700', color: '#fff' }}>Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
