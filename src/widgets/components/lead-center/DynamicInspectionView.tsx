// ─── DynamicInspectionView.tsx ───────────────────────────────────────────────
// Schema-driven ("dynamic") inspection photos capture for the mobile lead-center.
// Mobile port of the web reference
//   src/sections/job/components/dynamic-inspection-photos/dynamic-inspection-photos-dialog.js
//
// Flow (photo-first, mirrors web):
//   1. Rep taps the camera banner → camera/gallery → a pending photo appears.
//   2. Pending photo shows in the banner ("Tag this photo below").
//   3. Rep taps a slot to tag/upload the photo there (via the offline upload queue).
// Product is chosen from a top pill row; categories are a tab strip.
//
// Implemented: per-product tabs, dynamic categories (all types), multi-photo
// slots, capture (camera + gallery), categorized display, delete, replace-confirm,
// and tag-as-extra. Deferred vs web (see the web files above): move-photo across
// slots and the annotated-photos section.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Image,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../hooks/useAuth';
import { uploadQueueManager } from '../../../utils/uploadQueue';
import { logEvent } from '../../../services/api/LoggerService';
import {
  getTopTabs,
  slotCapacity,
  getExtraPickerCategories,
  type InspectionProduct,
  type InspectionCategory,
  type InspectionSlot,
} from './dynamic-inspection-schema-utils';
import { CategoryTabStrip, CategoryBody, ProductDropdown, iconifyToMdi } from './DynamicInspectionRenderer';
import { CustomCameraModal } from '../../modals/CustomCameraModal';
import { DynamicMovePhotoModal, type MoveState } from './DynamicMovePhotoModal';
import {
  useDynamicInspectionCapture,
  type CapturedPhoto,
} from './useDynamicInspectionCapture';

const GREEN = '#4CBB17';

interface PendingPhoto {
  uri: string;
  type?: string;
  fileName?: string;
}

interface PreviewState {
  uri: string;
  deletable: boolean;
  photo?: CapturedPhoto;
  categoryLabel?: string;
  subcategory?: string;
  key?: string;
  /** True when previewing the just-shot PENDING photo (offers Discard&Retake / Keep&Tag). */
  pending?: boolean;
}

interface ReplaceConfirm {
  category: InspectionCategory;
  slot: InspectionSlot;
  key: string;
  asset: PendingPhoto;
}

// A single-capacity slot already holds a photo and the rep is tagging a new one.
// Port of the static `renderConflictScreen` (TagPhotoModal.tsx:129) — offers
// Move existing / Keep both / Discard & Replace instead of a bare "Replace?" prompt.
interface ConflictState {
  category: InspectionCategory;
  slot: InspectionSlot;
  key: string;
  asset: PendingPhoto;
  existing: CapturedPhoto;
}

interface DynamicInspectionViewProps {
  lead: any;
  products: InspectionProduct[];
  onClose: () => void;
  refetch?: () => void | Promise<void>;
}

export function DynamicInspectionView({ lead, products, onClose, refetch }: DynamicInspectionViewProps) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState(0);

  useEffect(() => {
    if (!selectedProductId && products.length > 0) {
      setSelectedProductId(products[0].id as string);
    }
  }, [products, selectedProductId]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );
  const activeCategories = useMemo(() => selectedProduct?.categories || [], [selectedProduct]);
  const topTabs = useMemo(() => getTopTabs(activeCategories), [activeCategories]);
  const activeCategory = topTabs[Math.min(activeTab, Math.max(topTabs.length - 1, 0))] || null;
  const extraPickerCategories = useMemo(() => getExtraPickerCategories(topTabs), [topTabs]);

  useEffect(() => setActiveTab(0), [selectedProductId]);

  const capture = useDynamicInspectionCapture({
    lead,
    categories: activeCategories,
    productKey: (selectedProduct?.name as string) || (selectedProduct?.id as string) || undefined,
    userId: user?._id || user?.id,
    refreshLeadData: refetch ? () => refetch() : undefined,
  });

  // Refresh the lead (photos) whenever the upload queue changes so freshly
  // uploaded photos resolve into their slots.
  useEffect(() => {
    if (!refetch) return undefined;
    const unsubscribe = uploadQueueManager.addListener(() => {
      refetch();
    });
    return () => unsubscribe();
  }, [refetch]);

  // Log a view event on mount (parity with the legacy inspection modal).
  useEffect(() => {
    if (user) {
      logEvent('view', {
        user_id: user._id || user.id,
        module_type: 'inspection_photo',
        created_by: user._id || user.id,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [replaceConfirm, setReplaceConfirm] = useState<ReplaceConfirm | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  // "Discard new photo" inside the conflict screen confirms first ("Discard this
  // photo?"). Rendered as an in-modal overlay (not a nested Modal) to avoid the
  // iOS modal-over-modal bug, matching the static preview-discard pattern.
  const [conflictDiscardConfirm, setConflictDiscardConfirm] = useState(false);
  // Web parity (dynamic-inspection-photos-dialog.js:763-870 "Discard this photo?"):
  // deleting a stored photo from the full-screen preview must confirm first.
  const [deleteConfirm, setDeleteConfirm] = useState<PreviewState | null>(null);
  // Discarding the just-shot PENDING (un-tagged) photo also confirms first — static
  // TagPhotoModal parity (`showDiscardConfirm`). Same "Discard this photo?" sheet as
  // delete, but it throws away the un-tagged capture and reopens the camera.
  const [discardPending, setDiscardPending] = useState(false);
  const [showExtraPicker, setShowExtraPicker] = useState(false);
  // Conflict "Move it somewhere else" → the displaced (existing) photo enters
  // pick-a-new-slot mode, reusing the move-photo grid (static TagPhotoModal parity).
  const [moveExisting, setMoveExisting] = useState<MoveState | null>(null);
  const captureTargetRef = useRef<{ categoryLabel: string; subcategory: string; key: string } | null>(null);
  // Holds the pending "move existing photo" until the conflict Modal has finished
  // dismissing — presenting the move Modal while the conflict one is still animating
  // out shows a black screen on iOS (RN can't have two Modals transition at once).
  const pendingMoveRef = useRef<MoveState | null>(null);
  const autoOpenedRef = useRef(false);
  // The inspection UI (header / banner / slots) stays HIDDEN until the first photo
  // is captured — web's `flowStarted`. Until then the rep sees ONLY the camera, so
  // opening this flow lands straight on the camera, not on the tagging screen.
  const [flowStarted, setFlowStarted] = useState(false);
  // True while the native camera is on screen. The RN view underneath must stay
  // BLACK the whole time it's up — otherwise the camera's dismiss animation (on
  // cancel) reveals the tagging UI for a few frames before our callback fires,
  // which is the "I see the inspection view when I close the camera" flash. With
  // this, closing the camera goes straight to a black backdrop → Job Docs.
  const [cameraActive, setCameraActive] = useState(false);
  // Branded in-app camera (flash / self-timer / zoom pills / ultra-wide / retake),
  // the SAME `CustomCameraModal` the static TagPhotoModal uses — replaces the plain
  // native `launchCamera` so the dynamic flow has full capture-feature parity.
  const [customCameraVisible, setCustomCameraVisible] = useState(false);

  // Photo-first (web parity): launch the camera immediately on open so the rep
  // shoots first and tags after. The view content is gated on `flowStarted`, so
  // nothing but the camera is visible until that first shot lands.
  useEffect(() => {
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    const t = setTimeout(() => openCapture(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCapturedAsset = (asset: PendingPhoto) => {
    const target = captureTargetRef.current;
    captureTargetRef.current = null;
    if (target) {
      capture.captureToSlot({ ...target, asset });
    } else {
      setPendingPhoto(asset);
      // First shot taken → reveal the tagging UI (web `setFlowStarted(true)`).
      setFlowStarted(true);
    }
  };

  // Closing the camera ends the WHOLE flow and returns to Job Docs — web parity
  // (`cancelCapture → handleClose`), for the first shot AND mid-loop. Blank the
  // tagging UI FIRST (setFlowStarted(false) → black backdrop) so it never flashes
  // while the modal dismisses: the inspection view visually closes, then the
  // camera/modal tears down.
  const closeFlow = () => {
    captureTargetRef.current = null;
    setCameraActive(false);
    setFlowStarted(false);
    onClose();
  };


  // Photo-first, matching web: capture goes STRAIGHT to the camera (web's mobile
  // `openCaptureUI` → `setCameraOpen(true)`). We open the branded `CustomCameraModal`
  // (flash/timer/zoom/retake) instead of the native picker — `cameraActive` blanks
  // the tagging UI to a black backdrop behind it so nothing flashes.
  const openCapture = (target?: { categoryLabel: string; subcategory: string; key: string }) => {
    captureTargetRef.current = target || null;
    setCameraActive(true);
    setCustomCameraVisible(true);
  };

  // Branded camera confirmed a shot ("Use Photo") → tag it just like a native capture.
  const handleCameraCapture = (asset: { uri: string; fileName?: string; type?: string }) => {
    setCustomCameraVisible(false);
    setCameraActive(false);
    onCapturedAsset({ uri: asset.uri, type: asset.type, fileName: asset.fileName });
  };

  // Branded camera closed (X) → end the whole flow, back to Job Docs (web parity).
  const handleCameraClose = () => {
    setCustomCameraVisible(false);
    closeFlow();
  };

  const clearPending = () => setPendingPhoto(null);

  const onSlotClick = (category: InspectionCategory, slot: InspectionSlot, key: string) => {
    if (capture.deletingKeys[key]) return;

    const capacity = slotCapacity(category, slot);
    const photos = capture.getPhotos(category.label, slot.storageName);
    const hasRoom = photos.length < capacity;

    if (pendingPhoto) {
      if (hasRoom) {
        capture.captureToSlot({
          categoryLabel: category.label,
          subcategory: slot.storageName,
          key,
          asset: pendingPhoto,
        });
        clearPending();
        // Continuous capture (web parity): the moment a photo is tagged, its
        // upload is already running in the background via the queue, so reopen
        // the camera instantly for the next shot instead of making the rep tap
        // the banner again. The just-tagged slot fills optimistically and holds.
        setTimeout(() => openCapture(), 120);
      } else {
        // Slot occupied → rich conflict screen (Move / Keep both / Discard), the
        // static TagPhotoModal behaviour, instead of a bare Replace prompt.
        const occupant = capture.getPhotos(category.label, slot.storageName).find((p) => p.s3url) || photos[0];
        if (occupant) {
          setConflict({ category, slot, key, asset: pendingPhoto, existing: occupant });
        } else {
          setReplaceConfirm({ category, slot, key, asset: pendingPhoto });
        }
      }
      return;
    }

    // No pending photo: empty (or multi w/ room) → capture into this slot;
    // otherwise preview the existing photo.
    if (hasRoom) {
      openCapture({ categoryLabel: category.label, subcategory: slot.storageName, key });
    } else {
      const first = photos[0];
      setPreviewState({
        uri: first?.secureUrl || '',
        deletable: !!first?.s3url,
        photo: first,
        categoryLabel: category.label,
        subcategory: slot.storageName,
        key,
      });
    }
  };

  const confirmReplace = async () => {
    if (!replaceConfirm) return;
    const { category, slot, key, asset } = replaceConfirm;
    setReplaceConfirm(null);
    // Delete the existing photo(s) in the slot, then upload the new one.
    const existing = capture.getPhotos(category.label, slot.storageName).filter((p) => p.s3url);
    for (const p of existing) {
      // eslint-disable-next-line no-await-in-loop
      await capture.deletePhoto({ categoryLabel: category.label, subcategory: slot.storageName, key, photo: p });
    }
    capture.captureToSlot({ categoryLabel: category.label, subcategory: slot.storageName, key, asset });
    clearPending();
  };

  // ── Slot-conflict resolution (static TagPhotoModal parity) ──────────────────
  // Keep both: the existing photo stays in its slot; the incoming photo becomes an
  // Extra — the rep picks which category via the extra picker (static parity:
  // handleKeepBothOption → setShowExtraPicker(true), keeping the pending photo).
  const handleConflictKeepBoth = () => {
    if (!conflict) return;
    setConflict(null);
    setShowExtraPicker(true); // consumes the still-pending photo
  };

  // Open the deferred move once the conflict Modal has actually dismissed. Guarded
  // so the iOS onDismiss and the Android setTimeout fallback never double-fire.
  const flushPendingMove = () => {
    if (pendingMoveRef.current) {
      const next = pendingMoveRef.current;
      pendingMoveRef.current = null;
      setMoveExisting(next);
    }
  };

  // Move it somewhere else: the incoming photo takes THIS slot immediately, and the
  // existing photo enters pick-a-new-slot mode (the move-photo grid) so the rep
  // chooses where it goes — static parity (handleMoveOption → setMovingImage).
  const handleConflictMove = () => {
    if (!conflict) return;
    const { category, slot, key, asset, existing } = conflict;
    // Queue the move; it opens only after the conflict Modal finishes dismissing
    // (via onDismiss on iOS, setTimeout on Android) to avoid the black-screen race.
    pendingMoveRef.current = { photo: existing, fromCategory: category, fromSlot: slot, key };
    setConflict(null);
    // Incoming takes the slot (optimistic/queued). movePhoto below relocates ONLY
    // the existing photo (by id), so the two never collide.
    capture.captureToSlot({ categoryLabel: category.label, subcategory: slot.storageName as string, key, asset });
    clearPending();
    setTimeout(flushPendingMove, 450);
  };

  // Discard: confirm first ("Discard this photo?"), then throw away the incoming
  // photo and reopen the camera. The existing photo in the slot is left untouched.
  const handleConflictDiscard = () => {
    if (!conflict) return;
    setConflictDiscardConfirm(true);
  };

  const confirmConflictDiscard = () => {
    setConflictDiscardConfirm(false);
    setConflict(null);
    clearPending();
    setTimeout(() => openCapture(), 120);
  };

  // Close the conflict screen without discarding (X / "Pick different slot" / back),
  // also dismissing any open discard-confirm overlay so it can't linger on reopen.
  const closeConflict = () => {
    setConflictDiscardConfirm(false);
    setConflict(null);
  };

  // Ask before deleting — matches web's "Discard this photo?" confirm and the
  // manage-view delete modal (which already confirms).
  const requestDeleteFromPreview = () => {
    if (previewState?.deletable && previewState?.photo) {
      setDeleteConfirm(previewState);
    }
    setPreviewState(null);
  };

  const confirmDeleteFromPreview = () => {
    if (deleteConfirm?.deletable && deleteConfirm?.photo) {
      capture.deletePhoto({
        categoryLabel: deleteConfirm.categoryLabel as string,
        subcategory: deleteConfirm.subcategory as string,
        key: deleteConfirm.key as string,
        photo: deleteConfirm.photo,
      });
    }
    setDeleteConfirm(null);
  };

  // Confirmed discard of the pending photo → throw it away and reopen the camera
  // (continuous capture), matching the static "Discard & Retake" flow.
  const confirmDiscardPending = () => {
    setDiscardPending(false);
    setPendingPhoto(null);
    setTimeout(() => openCapture(), 120);
  };

  const handleTagAsExtraClick = (category: InspectionCategory) => {
    if (pendingPhoto) {
      setShowExtraPicker(true);
      return;
    }
    capture.addExtra(category);
  };

  const handlePickExtraCategory = (pickerItem: { category: InspectionCategory }) => {
    if (!pendingPhoto || !pickerItem?.category) return;
    setShowExtraPicker(false);
    capture.tagAsExtraInCategory({ category: pickerItem.category, asset: pendingPhoto });
    clearPending();
    // Continuous capture — reopen the camera after tagging as extra too.
    setTimeout(() => openCapture(), 120);
  };

  const showProductRow = products.length > 1;

  // Render only a plain black backdrop while the camera is up (or before the first
  // shot). The native camera sits on top, so the rep lands straight on the camera
  // and — critically — closing it reveals only black, never the tagging UI, so a
  // cancel goes straight back to Job Docs with no inspection-view flash.
  if (!flowStarted || cameraActive) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CustomCameraModal
          visible={customCameraVisible}
          onClose={handleCameraClose}
          onCapture={handleCameraCapture}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0D1F1A' }}>
      {/* Header: close + product name + counts. Top inset padding keeps the green
          header clear of the notch / status bar (safe area). */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: insets.top + 12, paddingBottom: 12, backgroundColor: '#0D1F1A', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)' }}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="close" size={24} color="#fff" />
        </TouchableOpacity>
        {/* Multiple products → a product dropdown in the header; otherwise the title. */}
        {showProductRow ? (
          <View style={{ flex: 1, alignItems: 'center' }}>
            <ProductDropdown
              products={products as any}
              selectedProductId={selectedProductId}
              onSelect={(id) => setSelectedProductId(id)}
            />
          </View>
        ) : (
          <Text style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: '700', fontSize: 15 }}>
            Inspection Photos
          </Text>
        )}
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11 }}>
          {capture.progress.filled}/{capture.progress.total} SLOTS | {capture.totalPhotos} PHOTOS
        </Text>
      </View>

      {/* Category tab strip */}
      {topTabs.length > 0 && !showExtraPicker && (
        <CategoryTabStrip
          categories={topTabs}
          capture={capture}
          active={Math.min(activeTab, Math.max(topTabs.length - 1, 0))}
          onChange={setActiveTab}
        />
      )}

      {/* Photo banner (pending capture) */}
      {!showExtraPicker && (
        <TouchableOpacity
          activeOpacity={pendingPhoto ? 1 : 0.8}
          onPress={pendingPhoto ? undefined : () => openCapture()}
          style={{ minHeight: 140, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' }}
        >
          {pendingPhoto ? (
            <>
              <Image source={{ uri: pendingPhoto.uri }} style={{ width: '100%', height: 160 }} resizeMode="contain" />
              <Text style={{ position: 'absolute', left: 12, bottom: 8, color: '#fff', fontWeight: '600', fontSize: 12 }}>
                Tag this photo below
              </Text>
              {/* Web parity (dynamic-inspection-photos-dialog.js:499-505): a
                  "TAP TO EXPAND" affordance opens the full-screen preview. */}
              <TouchableOpacity
                onPress={() => setPreviewState({ uri: pendingPhoto.uri, deletable: false, pending: true } as PreviewState)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={{ position: 'absolute', right: 12, bottom: 8 }}
              >
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontWeight: '700', fontSize: 11, letterSpacing: 0.5 }}>
                  TAP TO EXPAND
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDiscardPending(true)}
                style={{ position: 'absolute', top: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 20, padding: 6 }}
              >
                <Icon name="trash-can-outline" size={20} color="#fff" />
              </TouchableOpacity>
            </>
          ) : (
            <View style={{ alignItems: 'center', gap: 6, paddingVertical: 24 }}>
              <Icon name="camera-plus" size={40} color={GREEN} />
              <Text style={{ color: '#fff', fontWeight: '700' }}>Tap to take a photo</Text>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11 }}>Shoot first — then tag it to a slot below</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Slots / extra picker */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 48 }} keyboardShouldPersistTaps="handled">
        {showExtraPicker && pendingPhoto ? (
          <View>
            <TouchableOpacity onPress={() => setShowExtraPicker(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 }}>
              <Icon name="chevron-left" size={18} color={GREEN} />
              <Text style={{ color: GREEN, fontWeight: '700' }}>Back</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: '#16302A', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', marginBottom: 16 }}>
              <Image source={{ uri: pendingPhoto.uri }} style={{ width: 52, height: 52, borderRadius: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontWeight: '700', letterSpacing: 1, fontSize: 10, marginBottom: 2 }}>TAGGING AS EXTRA</Text>
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontSize: 14 }}>Which category is this extra of?</Text>
              </View>
            </View>
            <View style={{ gap: 8 }}>
              {extraPickerCategories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => handlePickExtraCategory(cat)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', backgroundColor: '#16302A' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Icon name={iconifyToMdi(cat.icon)} size={20} color="#637381" />
                    <Text style={{ color: '#FFFFFF', fontWeight: '600', fontSize: 14 }}>{cat.label}</Text>
                  </View>
                  <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(76,187,23,0.12)', borderWidth: 1, borderColor: 'rgba(76,187,23,0.35)' }}>
                    <Text style={{ color: GREEN, fontWeight: '700', fontSize: 11 }}>+ EXTRA</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : activeCategory ? (
          <CategoryBody
            category={activeCategory}
            capture={capture}
            onSlotClick={onSlotClick}
            onTagAsExtra={handleTagAsExtraClick}
          />
        ) : (
          <Text style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 24 }}>No inspection categories configured.</Text>
        )}
      </ScrollView>

      {/* Full-screen preview */}
      <Modal visible={!!previewState?.uri} transparent animationType="fade" onRequestClose={() => setPreviewState(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          <TouchableOpacity onPress={() => setPreviewState(null)} style={{ position: 'absolute', top: insets.top + 12, right: 16, zIndex: 2 }}>
            <Icon name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {previewState?.uri ? (
            <Image source={{ uri: previewState.uri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
          ) : null}
          {previewState?.deletable && (
            <TouchableOpacity
              onPress={requestDeleteFromPreview}
              style={{ position: 'absolute', bottom: 40, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EF4444', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 }}
            >
              <Icon name="trash-can-outline" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700' }}>Delete photo</Text>
            </TouchableOpacity>
          )}
          {/* Pending (just-shot, un-tagged) photo → Discard & Retake / Keep & Tag,
              static TagPhotoModal preview parity. */}
          {previewState?.pending && (
            <View style={{ position: 'absolute', bottom: insets.bottom + 24, left: 16, right: 16, flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity
                onPress={() => {
                  // Close the preview, then confirm before throwing the shot away
                  // (static "Discard this photo?" parity).
                  setPreviewState(null);
                  setDiscardPending(true);
                }}
                style={{ flex: 1, height: 52, borderRadius: 14, borderWidth: 2, borderColor: 'rgba(239,68,68,0.5)', backgroundColor: 'rgba(239,68,68,0.1)', alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: '#EF4444', fontWeight: '900', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' }}>Discard & Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setPreviewState(null)}
                style={{ flex: 1, height: 52, borderRadius: 14, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 12, letterSpacing: 0.5, textTransform: 'uppercase' }}>Keep & Tag</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* Replace confirmation for single-photo slots */}
      <Modal visible={!!replaceConfirm} transparent animationType="fade" onRequestClose={() => setReplaceConfirm(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ width: '100%', maxWidth: 360, backgroundColor: '#0D1F1A', borderRadius: 16, padding: 20 }}>
            <Text style={{ fontWeight: '800', fontSize: 16, color: '#FFFFFF', marginBottom: 8 }}>Replace existing photo?</Text>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, lineHeight: 19, marginBottom: 20 }}>
              <Text style={{ fontWeight: '700' }}>{replaceConfirm?.slot?.name}</Text> only allows a single photo. Uploading this photo will replace the existing one. Continue?
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => setReplaceConfirm(null)} style={{ flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmReplace} style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Replace</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Slot-conflict screen — static TagPhotoModal parity (renderConflictScreen).
          Side-by-side INCOMING vs EXISTING + Move / Keep both / Discard. */}
      <Modal visible={!!conflict} animationType="slide" onRequestClose={closeConflict} onDismiss={flushPendingMove}>
        <View style={{ flex: 1, backgroundColor: '#0D1F1A', paddingTop: insets.top || 16, paddingBottom: insets.bottom }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}>
            <TouchableOpacity onPress={closeConflict} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="close" size={24} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            <TouchableOpacity onPress={closeConflict} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <Icon name="chevron-left" size={20} color={GREEN} />
              <Text style={{ color: GREEN, fontWeight: '900', fontSize: 12, marginLeft: 2 }}>Pick different slot</Text>
            </TouchableOpacity>

            <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4 }}>Slot Occupied</Text>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 20, marginBottom: 4 }}>{conflict?.slot?.name} already has a photo</Text>
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12, marginBottom: 20 }}>Choose what to do.</Text>

            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 24 }}>
              <View style={{ flex: 1, borderRadius: 16, overflow: 'hidden', aspectRatio: 4 / 3, backgroundColor: 'rgba(0,0,0,0.4)' }}>
                {!!conflict?.asset?.uri && <Image source={{ uri: conflict.asset.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: GREEN, paddingVertical: 6, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase' }}>Incoming (takes slot)</Text>
                </View>
              </View>
              <View style={{ flex: 1, borderRadius: 16, overflow: 'hidden', aspectRatio: 4 / 3, backgroundColor: 'rgba(0,0,0,0.4)', borderWidth: 2, borderColor: '#F59E0B' }}>
                {!!conflict?.existing?.secureUrl && <Image source={{ uri: conflict.existing.secureUrl }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />}
                <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#F59E0B', paddingVertical: 6, alignItems: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '900', fontSize: 9, letterSpacing: 0.5, textTransform: 'uppercase' }}>Existing (needs a home)</Text>
                </View>
              </View>
            </View>

            <View style={{ gap: 12 }}>
              <TouchableOpacity onPress={handleConflictMove} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, backgroundColor: 'rgba(76,187,23,0.1)', borderWidth: 1, borderColor: 'rgba(76,187,23,0.2)' }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(76,187,23,0.2)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Icon name="arrow-all" size={20} color={GREEN} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Move it somewhere else</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>Pick a new slot for the existing photo · new photo takes this slot</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleConflictKeepBoth} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, backgroundColor: 'rgba(59,130,246,0.1)', borderWidth: 1, borderColor: 'rgba(59,130,246,0.2)' }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(59,130,246,0.2)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Icon name="content-copy" size={18} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Keep both</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>Existing photo stays here · incoming photo becomes an Extra</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleConflictDiscard} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 16, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)' }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(239,68,68,0.2)', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Icon name="delete-outline" size={20} color="#EF4444" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#EF4444', fontWeight: '700', fontSize: 14 }}>Discard new photo</Text>
                  <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10 }}>Throw away the photo you just took · existing photo stays</Text>
                </View>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* "Discard this photo?" confirm — in-modal overlay (not a nested Modal, to
              avoid the iOS modal-over-modal black screen) shown when the rep taps
              "Discard new photo". */}
          {conflictDiscardConfirm && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
              <View style={{ width: '100%', maxWidth: 380, backgroundColor: '#0D1F1A', borderRadius: 20, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                    <Icon name="delete-outline" size={24} color="#EF4444" />
                  </View>
                  {!!conflict?.asset?.uri && (
                    <Image source={{ uri: conflict.asset.uri }} style={{ width: 48, height: 48, borderRadius: 8 }} resizeMode="cover" />
                  )}
                </View>
                <Text style={{ fontWeight: '800', fontSize: 16, color: '#FFFFFF', marginBottom: 6 }}>Discard this photo?</Text>
                <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 20 }}>
                  This photo will be permanently deleted. You'll need to retake it to capture this shot.
                </Text>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity onPress={() => setConflictDiscardConfirm(false)} style={{ flex: 1, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontWeight: '700', color: 'rgba(255,255,255,0.7)' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={confirmConflictDiscard} style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: '#EF4444', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <Icon name="delete-outline" size={16} color="#fff" />
                    <Text style={{ fontWeight: '700', color: '#fff' }}>Discard</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </View>
      </Modal>

      {/* Delete confirmation — web parity (dynamic-inspection-photos-dialog.js
          "Discard this photo?"): never delete straight from the preview. */}
      <Modal visible={!!deleteConfirm} transparent animationType="fade" onRequestClose={() => setDeleteConfirm(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ width: '100%', maxWidth: 380, backgroundColor: '#0D1F1A', borderRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="delete-outline" size={24} color="#EF4444" />
              </View>
              {!!deleteConfirm?.uri && (
                <Image source={{ uri: deleteConfirm.uri }} style={{ width: 48, height: 48, borderRadius: 8 }} resizeMode="cover" />
              )}
            </View>
            <Text style={{ fontWeight: '800', fontSize: 16, color: '#FFFFFF', marginBottom: 6 }}>Discard this photo?</Text>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 20 }}>
              This photo will be permanently deleted. You'll need to retake it to capture this shot.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setDeleteConfirm(null)} style={{ flex: 1, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontWeight: '700', color: 'rgba(255,255,255,0.7)' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmDeleteFromPreview} style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: '#EF4444', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Icon name="delete-outline" size={16} color="#fff" />
                <Text style={{ fontWeight: '700', color: '#fff' }}>Discard</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Discard-pending confirmation — static TagPhotoModal parity (`showDiscardConfirm`):
          the just-shot, un-tagged photo is only thrown away after this "Discard this
          photo?" confirm (from the banner trash or preview "Discard & Retake"). */}
      <Modal visible={discardPending} transparent animationType="fade" onRequestClose={() => setDiscardPending(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ width: '100%', maxWidth: 380, backgroundColor: '#0D1F1A', borderRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="delete-outline" size={24} color="#EF4444" />
              </View>
              {!!pendingPhoto?.uri && (
                <Image source={{ uri: pendingPhoto.uri }} style={{ width: 48, height: 48, borderRadius: 8 }} resizeMode="cover" />
              )}
            </View>
            <Text style={{ fontWeight: '800', fontSize: 16, color: '#FFFFFF', marginBottom: 6 }}>Discard this photo?</Text>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 20 }}>
              This photo will be permanently deleted. You'll need to retake it to capture this shot.
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setDiscardPending(false)} style={{ flex: 1, height: 44, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontWeight: '700', color: 'rgba(255,255,255,0.7)' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmDiscardPending} style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: '#EF4444', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Icon name="delete-outline" size={16} color="#fff" />
                <Text style={{ fontWeight: '700', color: '#fff' }}>Discard</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Conflict "Move it somewhere else" → re-home the displaced (existing) photo:
          the rep picks a new slot in the reused move-photo grid (static parity). */}
      <DynamicMovePhotoModal
        visible={!!moveExisting}
        moveState={moveExisting}
        categories={activeCategories}
        capture={capture}
        onClose={() => setMoveExisting(null)}
        // Re-home done → reopen the camera for the next shot (continuous capture,
        // matching the tag / discard / keep-both paths). Deferred so the move Modal
        // finishes dismissing before the camera Modal presents (iOS modal-race guard);
        // the move upload is queued, so nothing is lost while the camera comes back.
        onMoved={() => setTimeout(() => openCapture(), 350)}
      />
    </View>
  );
}

export default DynamicInspectionView;
