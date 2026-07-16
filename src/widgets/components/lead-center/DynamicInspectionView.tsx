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
  Alert,
  Platform,
  PermissionsAndroid,
  ActivityIndicator,
  Modal,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
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
import { CategoryTabStrip, CategoryBody, iconifyToMdi } from './DynamicInspectionRenderer';
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
}

interface ReplaceConfirm {
  category: InspectionCategory;
  slot: InspectionSlot;
  key: string;
  asset: PendingPhoto;
}

interface DynamicInspectionViewProps {
  lead: any;
  products: InspectionProduct[];
  onClose: () => void;
  refetch?: () => void | Promise<void>;
}

const IMAGE_PICKER_OPTS = {
  mediaType: 'photo' as const,
  quality: 0.5 as const,
  maxWidth: 1600,
  maxHeight: 1600,
};

async function ensureAndroidCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const has = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
  if (has) return true;
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
    title: 'Camera Permission',
    message: 'App needs access to your camera to take inspection photos.',
    buttonNeutral: 'Ask Me Later',
    buttonNegative: 'Cancel',
    buttonPositive: 'OK',
  });
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export function DynamicInspectionView({ lead, products, onClose, refetch }: DynamicInspectionViewProps) {
  const { user } = useAuth();

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
  const activeCategories = selectedProduct?.categories || [];
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
  const [showExtraPicker, setShowExtraPicker] = useState(false);
  const captureTargetRef = useRef<{ categoryLabel: string; subcategory: string; key: string } | null>(null);

  const onCapturedAsset = (asset: PendingPhoto) => {
    const target = captureTargetRef.current;
    captureTargetRef.current = null;
    if (target) {
      capture.captureToSlot({ ...target, asset });
    } else {
      setPendingPhoto(asset);
    }
  };

  const launchWithSource = (source: 'camera' | 'gallery') => {
    const cb = (res: any) => {
      if (res?.didCancel) return;
      if (res?.errorCode) {
        Alert.alert('Error', res.errorMessage || 'Could not open camera/gallery');
        return;
      }
      const a = res?.assets?.[0];
      if (a?.uri) {
        onCapturedAsset({ uri: a.uri, type: a.type, fileName: a.fileName });
      }
    };
    if (source === 'camera') {
      ensureAndroidCameraPermission().then((ok) => {
        if (!ok) {
          Alert.alert('Permission Denied', 'Camera permission is required to take photos.');
          return;
        }
        launchCamera({ ...IMAGE_PICKER_OPTS, saveToPhotos: true }, cb);
      });
    } else {
      launchImageLibrary({ ...IMAGE_PICKER_OPTS, selectionLimit: 1 }, cb);
    }
  };

  const openCapture = (target?: { categoryLabel: string; subcategory: string; key: string }) => {
    captureTargetRef.current = target || null;
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Camera', onPress: () => launchWithSource('camera') },
      { text: 'Gallery', onPress: () => launchWithSource('gallery') },
      { text: 'Cancel', style: 'cancel', onPress: () => { captureTargetRef.current = null; } },
    ]);
  };

  const clearPending = () => setPendingPhoto(null);

  const onSlotClick = (category: InspectionCategory, slot: InspectionSlot, key: string) => {
    if (capture.uploadingKeys[key] || capture.deletingKeys[key]) return;

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
      } else {
        setReplaceConfirm({ category, slot, key, asset: pendingPhoto });
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

  const deleteFromPreview = () => {
    if (previewState?.deletable && previewState?.photo) {
      capture.deletePhoto({
        categoryLabel: previewState.categoryLabel as string,
        subcategory: previewState.subcategory as string,
        key: previewState.key as string,
        photo: previewState.photo,
      });
    }
    setPreviewState(null);
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
  };

  const showProductRow = products.length > 1;

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header: close + product name + counts */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, backgroundColor: GREEN }}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Icon name="close" size={24} color="#fff" />
        </TouchableOpacity>
        <Text style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: '700', fontSize: 15 }}>
          Inspection Photos
        </Text>
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 11 }}>
          {capture.progress.filled}/{capture.progress.total} · {capture.totalPhotos}📷
        </Text>
      </View>

      {/* Product pill row (only when >1 product) */}
      {showProductRow && (
        <View style={{ borderBottomWidth: 1, borderColor: '#EEF2F6' }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ padding: 10, gap: 8 }}>
            {products.map((p) => {
              const isActive = p.id === selectedProductId;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setSelectedProductId(p.id as string)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    paddingHorizontal: 14,
                    height: 38,
                    borderRadius: 19,
                    borderWidth: 1,
                    borderColor: isActive ? GREEN : '#E2E8F0',
                    backgroundColor: isActive ? GREEN : 'transparent',
                  }}
                >
                  <Icon name={iconifyToMdi(p.icon)} size={16} color={isActive ? '#fff' : '#637381'} />
                  <Text style={{ fontWeight: '700', fontSize: 13, color: isActive ? '#fff' : '#637381' }}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

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
              <TouchableOpacity
                onPress={() => setPendingPhoto(null)}
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {showExtraPicker && pendingPhoto ? (
          <View>
            <TouchableOpacity onPress={() => setShowExtraPicker(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 16 }}>
              <Icon name="chevron-left" size={18} color={GREEN} />
              <Text style={{ color: GREEN, fontWeight: '700' }}>Back</Text>
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#EEF2F6', marginBottom: 16 }}>
              <Image source={{ uri: pendingPhoto.uri }} style={{ width: 52, height: 52, borderRadius: 8 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#94A3B8', fontWeight: '700', letterSpacing: 1, fontSize: 10, marginBottom: 2 }}>TAGGING AS EXTRA</Text>
                <Text style={{ color: '#1C252E', fontWeight: '700', fontSize: 14 }}>Which category is this extra of?</Text>
              </View>
            </View>
            <View style={{ gap: 8 }}>
              {extraPickerCategories.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => handlePickExtraCategory(cat)}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, borderWidth: 1, borderColor: '#EEF2F6', backgroundColor: '#F8FAFC' }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Icon name={iconifyToMdi(cat.icon)} size={20} color="#637381" />
                    <Text style={{ color: '#1C252E', fontWeight: '600', fontSize: 14 }}>{cat.label}</Text>
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
          <Text style={{ color: '#94A3B8', textAlign: 'center', marginTop: 24 }}>No inspection categories configured.</Text>
        )}
      </ScrollView>

      {/* Full-screen preview */}
      <Modal visible={!!previewState?.uri} transparent animationType="fade" onRequestClose={() => setPreviewState(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          <TouchableOpacity onPress={() => setPreviewState(null)} style={{ position: 'absolute', top: 40, right: 16, zIndex: 2 }}>
            <Icon name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {previewState?.uri ? (
            <Image source={{ uri: previewState.uri }} style={{ width: '100%', height: '80%' }} resizeMode="contain" />
          ) : null}
          {previewState?.deletable && (
            <TouchableOpacity
              onPress={deleteFromPreview}
              style={{ position: 'absolute', bottom: 40, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EF4444', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 }}
            >
              <Icon name="trash-can-outline" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontWeight: '700' }}>Delete photo</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>

      {/* Replace confirmation for single-photo slots */}
      <Modal visible={!!replaceConfirm} transparent animationType="fade" onRequestClose={() => setReplaceConfirm(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
          <View style={{ width: '100%', maxWidth: 360, backgroundColor: '#fff', borderRadius: 16, padding: 20 }}>
            <Text style={{ fontWeight: '800', fontSize: 16, color: '#1C252E', marginBottom: 8 }}>Replace existing photo?</Text>
            <Text style={{ color: '#637381', fontSize: 13, lineHeight: 19, marginBottom: 20 }}>
              <Text style={{ fontWeight: '700' }}>{replaceConfirm?.slot?.name}</Text> only allows a single photo. Uploading this photo will replace the existing one. Continue?
            </Text>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity onPress={() => setReplaceConfirm(null)} style={{ flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#637381', fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={confirmReplace} style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: GREEN, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Replace</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default DynamicInspectionView;
