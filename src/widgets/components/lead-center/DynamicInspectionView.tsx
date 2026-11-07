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
import { useCameraWalkthrough } from '../../../hooks/useCameraWalkthrough';
import { WalkthroughOverlay } from '../../common/WalkthroughOverlay';
import { uploadQueueManager } from '../../../utils/uploadQueue';
import { countQueuedFrames } from '../../../utils/camera-video';
import {
  getTopTabs,
  slotCapacity,
  getExtraPickerCategories,
  type InspectionProduct,
  type InspectionCategory,
  type InspectionSlot,
} from './dynamic-inspection-schema-utils';
import { CategoryTabStrip, CategoryBody, ProductDropdown, iconifyToMdi } from './DynamicInspectionRenderer';
import { CustomCameraModal, type FrameTag, type PickedFrame } from '../../modals/CustomCameraModal';
import { FlashMessage } from '../../../config/message';
import { PreviewMedia } from '../../common/PreviewMedia';
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
  pending?: boolean;
}

/** What a video frame was tagged to: a schema slot, or "Extra" in a category. Read back when the frames are committed. */
type FrameTarget =
  | { kind: 'slot'; category: InspectionCategory; slot: InspectionSlot; key: string }
  | { kind: 'extra'; category: InspectionCategory };

interface FrameTagRequest {
  uri: string;
  queued: FrameTag[];
  resolve: (tag: FrameTag | null) => void;
}

interface ReplaceConfirm {
  category: InspectionCategory;
  slot: InspectionSlot;
  key: string;
  asset: PendingPhoto;
}

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

  // First-run camera walkthrough (Jira 576). It hops between the camera and this tag screen, so it is owned
  // here, above both. `video` flips on when the video-capture module ships.
  const tabLabels = useMemo(() => topTabs.map((t) => t.label), [topTabs]);
  const walkthrough = useCameraWalkthrough({ features: { video: true }, tabLabels });

  useEffect(() => setActiveTab(0), [selectedProductId]);

  const capture = useDynamicInspectionCapture({
    lead,
    categories: activeCategories,
    productKey: (selectedProduct?.name as string) || (selectedProduct?.id as string) || undefined,
    userId: user?._id || user?.id,
    refreshLeadData: refetch ? () => refetch() : undefined,
  });

  useEffect(() => {
    if (!refetch) return undefined;
    const unsubscribe = uploadQueueManager.addListener(() => {
      refetch();
    });
    return () => unsubscribe();
  }, [refetch]);

  const [realPendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  // While the walkthrough shows the tag screen, a sample frame stands in for the pending photo. It is derived,
  // never written to state, so ending the tour leaves nothing behind to upload or discard.
  const tourOnTagScreen = walkthrough.screen === 'tag';
  // A frame picked from a recorded video waits for its tag the same way a fresh photo does (see `requestFrameTag`).
  const [frameTagReq, setFrameTagReq] = useState<FrameTagRequest | null>(null);
  const pendingPhoto: PendingPhoto | null = tourOnTagScreen
    ? { uri: walkthrough.sample ?? '' }
    : frameTagReq
      ? { uri: frameTagReq.uri, type: 'image/jpeg' }
      : realPendingPhoto;
  const captureRef = useRef(capture);
  captureRef.current = capture;
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [replaceConfirm, setReplaceConfirm] = useState<ReplaceConfirm | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [conflictDiscardConfirm, setConflictDiscardConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<PreviewState | null>(null);
  const [discardPending, setDiscardPending] = useState(false);
  const [showExtraPicker, setShowExtraPicker] = useState(false);
  const [moveExisting, setMoveExisting] = useState<MoveState | null>(null);
  const captureTargetRef = useRef<{ categoryLabel: string; subcategory: string; key: string } | null>(null);
  const pendingMoveRef = useRef<MoveState | null>(null);
  const autoOpenedRef = useRef(false);
  const [flowStarted, setFlowStarted] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [customCameraVisible, setCustomCameraVisible] = useState(false);

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
      setFlowStarted(true);
    }
  };

  const closeFlow = () => {
    captureTargetRef.current = null;
    setCameraActive(false);
    setFlowStarted(false);
    onClose();
  };


  const openCapture = (target?: { categoryLabel: string; subcategory: string; key: string }) => {
    captureTargetRef.current = target || null;
    setCameraActive(true);
    setCustomCameraVisible(true);
  };

  const handleCameraCapture = (asset: { uri: string; fileName?: string; type?: string }) => {
    setCustomCameraVisible(false);
    setCameraActive(false);
    onCapturedAsset({ uri: asset.uri, type: asset.type, fileName: asset.fileName });
  };

  const handleCameraClose = () => {
    setCustomCameraVisible(false);
    closeFlow();
  };

  const clearPending = () => setPendingPhoto(null);

  // Record-then-pick. The camera stays mounted (hidden) under the tag screen while a frame is tagged, so the picker
  // keeps its clip and frames. The frame is NOT uploaded here: the tag only resolves the request, and the kept frames
  // are committed together when the picker's Done is confirmed.
  const requestFrameTag = (uri: string, queued: FrameTag[]) =>
    new Promise<FrameTag | null>((resolve) => setFrameTagReq({ uri, queued, resolve }));

  const resolveFrameTag = (tag: FrameTag | null) => {
    frameTagReq?.resolve(tag);
    setFrameTagReq(null);
    setShowExtraPicker(false);
  };

  const handleFramesDone = async (frames: PickedFrame[]) => {
    setCustomCameraVisible(false);
    setCameraActive(false);
    captureTargetRef.current = null;
    // One at a time with a tick between: `buildExtraSlot` numbers extras from the render it was created in.
    for (const f of frames) {
      const target = f.target as FrameTarget;
      const asset = { uri: f.uri, type: f.type, fileName: f.fileName };
      if (target.kind === 'slot') {
        captureRef.current.captureToSlot({
          categoryLabel: target.category.label,
          subcategory: target.slot.storageName,
          key: target.key,
          asset,
        });
      } else {
        captureRef.current.tagAsExtraInCategory({ category: target.category, asset });
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((r) => setTimeout(r, 80));
    }
    setTimeout(() => openCapture(), 120);
  };

  const onSlotClick = (category: InspectionCategory, slot: InspectionSlot, key: string) => {
    if (capture.deletingKeys[key]) return;

    const capacity = slotCapacity(category, slot);
    const photos = capture.getPhotos(category.label, slot.storageName);
    const hasRoom = photos.length < capacity;

    if (frameTagReq) {
      const queuedHere = countQueuedFrames(frameTagReq.queued, key);
      if (photos.length + queuedHere >= capacity) {
        FlashMessage.show(`${slot.name} is full. Pick another spot or tag it as Extra.`, '', 'warning');
        return;
      }
      resolveFrameTag({ label: slot.name, target: { kind: 'slot', category, slot, key } satisfies FrameTarget });
      return;
    }

    if (pendingPhoto) {
      if (hasRoom) {
        capture.captureToSlot({
          categoryLabel: category.label,
          subcategory: slot.storageName,
          key,
          asset: pendingPhoto,
        });
        clearPending();
        setTimeout(() => openCapture(), 120);
      } else {
        const occupant = capture.getPhotos(category.label, slot.storageName).find((p) => p.s3url) || photos[0];
        if (occupant) {
          setConflict({ category, slot, key, asset: pendingPhoto, existing: occupant });
        } else {
          setReplaceConfirm({ category, slot, key, asset: pendingPhoto });
        }
      }
      return;
    }

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
    const existing = capture.getPhotos(category.label, slot.storageName).filter((p) => p.s3url);
    for (const p of existing) {
      // eslint-disable-next-line no-await-in-loop
      await capture.deletePhoto({ categoryLabel: category.label, subcategory: slot.storageName, key, photo: p });
    }
    capture.captureToSlot({ categoryLabel: category.label, subcategory: slot.storageName, key, asset });
    clearPending();
  };

  const handleConflictKeepBoth = () => {
    if (!conflict) return;
    setConflict(null);
    setShowExtraPicker(true); // consumes the still-pending photo
  };

  const flushPendingMove = () => {
    if (pendingMoveRef.current) {
      const next = pendingMoveRef.current;
      pendingMoveRef.current = null;
      setMoveExisting(next);
    }
  };

  const handleConflictMove = () => {
    if (!conflict) return;
    const { category, slot, key, asset, existing } = conflict;
    pendingMoveRef.current = { photo: existing, fromCategory: category, fromSlot: slot, key };
    setConflict(null);
    capture.captureToSlot({ categoryLabel: category.label, subcategory: slot.storageName as string, key, asset });
    clearPending();
    setTimeout(flushPendingMove, 450);
  };

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

  const closeConflict = () => {
    setConflictDiscardConfirm(false);
    setConflict(null);
  };

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

  const confirmDiscardPending = () => {
    setDiscardPending(false);
    if (frameTagReq) {
      resolveFrameTag(null);
      return;
    }
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
    if (frameTagReq) {
      resolveFrameTag({ label: `${pickerItem.category.label} Extra`, target: { kind: 'extra', category: pickerItem.category } satisfies FrameTarget });
      return;
    }
    capture.tagAsExtraInCategory({ category: pickerItem.category, asset: pendingPhoto });
    clearPending();
    setTimeout(() => openCapture(), 120);
  };

  const showProductRow = products.length > 1;

  const showCamera = walkthrough.screen ? walkthrough.screen === 'camera' : !flowStarted || cameraActive;
  const frameTagging = !!frameTagReq;
  // The camera is the same element in both branches (slot 0 of the root), so tagging a video frame does not remount it.
  const cameraNode = (
    <View style={frameTagging ? { display: 'none' } : { flex: 1, backgroundColor: '#000' }}>
      <CustomCameraModal
        allowVideo
        visible={customCameraVisible}
        onClose={handleCameraClose}
        onCapture={handleCameraCapture}
        walkthrough={walkthrough}
        onRequestFrameTag={requestFrameTag}
        onFramesDone={handleFramesDone}
      />
      <WalkthroughOverlay controller={walkthrough} />
    </View>
  );

  if (showCamera && !frameTagging) {
    return (
      <View style={{ flex: 1 }}>
        {cameraNode}
        {null}
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
    {frameTagging ? cameraNode : null}
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
        <View ref={walkthrough.targetRef('tabs')} collapsable={false}>
          <CategoryTabStrip
            categories={topTabs}
            capture={capture}
            active={Math.min(activeTab, Math.max(topTabs.length - 1, 0))}
            onChange={setActiveTab}
          />
        </View>
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
              {!!pendingPhoto.uri && (
                <PreviewMedia uri={pendingPhoto.uri} type={pendingPhoto.type} style={{ width: '100%', height: 160 }} resizeMode="contain" />
              )}
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
              <PreviewMedia uri={pendingPhoto.uri} type={pendingPhoto.type} style={{ width: 52, height: 52, borderRadius: 8 }} />
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
          <View ref={walkthrough.targetRef('slots')} collapsable={false}>
            <CategoryBody
              category={activeCategory}
              capture={
                frameTagReq
                  ? { ...capture, queuedFrameCount: (key: string) => countQueuedFrames(frameTagReq.queued, key) }
                  : capture
              }
              onSlotClick={onSlotClick}
              onTagAsExtra={handleTagAsExtraClick}
            />
          </View>
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
            <PreviewMedia uri={previewState.uri} type={previewState.pending ? realPendingPhoto?.type : undefined} style={{ width: '100%', height: '80%' }} resizeMode="contain" controls />
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
                <PreviewMedia uri={pendingPhoto.uri} type={pendingPhoto.type} style={{ width: 48, height: 48, borderRadius: 8 }} resizeMode="cover" />
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
        onMoved={() => setTimeout(() => openCapture(), 350)}
      />

      <WalkthroughOverlay controller={walkthrough} />
    </View>
    </View>
  );
}

export default DynamicInspectionView;
