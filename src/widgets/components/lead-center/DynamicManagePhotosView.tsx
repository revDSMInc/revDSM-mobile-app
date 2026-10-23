import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
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
  norm,
  type InspectionProduct,
  type InspectionCategory,
  type InspectionSlot,
} from './dynamic-inspection-schema-utils';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';
import {
  findOriginalPhoto,
  indexAnnotationDocs,
  stripAnnotatedSuffix,
} from '../../../utils/annotation-restore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CategoryTabStrip, ProductDropdown } from './DynamicInspectionRenderer';
import { useDynamicInspectionCapture, type CapturedPhoto } from './useDynamicInspectionCapture';
import { DynamicMovePhotoModal, type MoveState } from './DynamicMovePhotoModal';
import { PhotoPeekPressable } from '../../common/PhotoPeekPressable';
import { PhotoPeekScrollLockProvider, PeekAwareScrollView } from '../../common/PhotoPeekScrollLock';
import { LoadingImage } from '../../common/LoadingImage';
import { InspectionPhotoViewer } from '../InspectionPhotosPanel';
import type { SectionPhoto } from '../../../utils/inspection-photos';
import { useSecureUrls } from '../../../hooks/useSecureUrls';
import { useWarmedImageUris } from '../../../hooks/useWarmedImageUris';
import { forgetWarmedUri } from '../../../utils/imageFileCache';
import { resolveS3Url } from '../../../utils/s3-utils';
import { indexPendingBySlot, pendingStatusFor, photoTileState } from '../../../utils/pending-inspection-photos';
import { offlinePhotoDeleteQueue } from '../../../services/offlinePhotoDeleteQueue';
import { useIsOnline } from '../../../hooks/useIsOnline';
import { uploadQueueManager } from '../../../utils/uploadQueue';
import { usePendingAnnotations } from '../../../hooks/usePendingAnnotations';
import { annotationIdentity, type PendingAnnotationJobView } from '../../../utils/pending-annotations';
import { AnnotationOverlayPreview } from './AnnotationOverlayPreview';

/**
 * Thumbnail shape in Manage Photos (REVUIUX-574 - "thumbnails are way too zoomed in").
 *
 * ⚠️ This is a CROP ratio, not a decoration. The tile draws with `resizeMode="cover"`, so a
 * photo narrower than the box loses the whole difference off the TOP AND BOTTOM. At the old 1.6
 * a portrait 3:4 phone photo showed only ~47% of its height - the reporter's thumbnail had cut
 * away the TV that is plainly there when the photo is opened, so the tile did not look like the
 * same picture. At 4:3 the same photo keeps ~75%.
 *
 * 4:3 is the shape a phone camera actually produces, so a landscape shot now fills the tile with
 * no crop at all, and a portrait one keeps as much as a fixed-ratio grid can show.
 *
 * ⚠️ `AnnotationOverlayPreview` draws saved marks over the photo and MUST be given the same
 * ratio, or the drawing lands away from what it was drawn on. Use this constant in all three
 * places; don't inline the number again.
 */
export const PHOTO_TILE_ASPECT = 4 / 3;

const GREEN = '#4CBB17';
const RED = '#EF4444';

interface PhotoCard {
  cat: InspectionCategory;
  label: string;
  storageName: string;
  slot: InspectionSlot;
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
  const [preview, setPreview] = useState<{ photos: SectionPhoto[]; index: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedMap, setSelectedMap] = useState<Map<string, PhotoCard>>(new Map());
  const [moveState, setMoveState] = useState<MoveState | null>(null);

  const online = useIsOnline();
  const [pendingUploads, setPendingUploads] = useState(() => uploadQueueManager.getQueue());
  const [activeUploadId, setActiveUploadId] = useState<string | null>(() =>
    uploadQueueManager.getActiveUploadId(),
  );
  const [deleteTick, setDeleteTick] = useState(0);
  useEffect(() => {
    const sync = () => {
      setPendingUploads([...uploadQueueManager.getQueue()]);
      setActiveUploadId(uploadQueueManager.getActiveUploadId());
    };
    sync();
    const offUploads = uploadQueueManager.addListener(sync);
    const offDeletes = offlinePhotoDeleteQueue.addListener(() => setDeleteTick((n) => n + 1));
    return () => {
      offUploads();
      offDeletes();
    };
  }, []);

  const managePhotosCount = useMemo(() => {
    const all = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];
    const removed = offlinePhotoDeleteQueue.deletedUrls(lead?._id || lead?.id);
    const photos = removed.size ? all.filter((p: any) => !removed.has(p?.s3url)) : all;
    const seen = new Set<string>();
    photos.forEach((p: any) => {
      if (!p?.s3url || seen.has(p.s3url)) return;
      seen.add(p.s3url);
    });
    let pending = 0;
    indexPendingBySlot(pendingUploads as any, lead?._id || lead?.id).forEach((items, slot) => {
      const onServer = photos.filter(
        (p: any) => `${String(p?.category ?? '').trim().toLowerCase()}||${String(p?.subcategory ?? '').trim().toLowerCase()}` === slot
      ).length;
      pending += Math.max(0, items.length - onServer);
    });
    return seen.size + pending;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.salesPhotos, lead?._id, lead?.id, pendingUploads, deleteTick]);

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

  const leafs = useMemo(
    () => indexSchema(activeCategory ? [activeCategory] : []).leafCategories,
    [activeCategory],
  );

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
                slot,
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
              slot,
              key: `${slot.key || slot.id}-${photo.s3url || photo._id || i}`,
              photo,
            })),
        ),
      ),
    [leafs, capture],
  );

  // Annotated photos saved on the device but not on the server yet - shown the moment the rep taps Save.
  const pendingAnnotations = usePendingAnnotations(lead?._id || lead?.id);
  // Handover without a gap: the last job's marks per card, kept so they can sit over the image until it has painted.
  const lastJobRef = useRef(new Map<string, PendingAnnotationJobView>());
  const [annotLoaded, setAnnotLoaded] = useState<Record<string, true>>({});
  const annotationProductKey = (selectedProduct?.name as string) || (selectedProduct?.id as string) || '';

  const annotated = useMemo(
    () =>
      leafs.flatMap((cat) => {
        const server: PhotoCard[] = (capture.getAnnotatedFor?.(cat.label as string) || []).map(
          ({ subcategory, photo }, i) => ({
            cat,
            label: subcategory.replace(/\(Annotated\)/i, '').trim() || subcategory,
            storageName: subcategory,
            slot: { name: subcategory, storageName: subcategory } as InspectionSlot,
            // ⚠️ KEY = identity (category + base photo), never the s3url: it must be the SAME across pending -> queued ->
            // uploaded -> server copy, or the card remounts and its image blanks for a moment at the handover.
            key: `annotated-${cat.id}-${(subcategory.replace(/\(Annotated\)/i, '').trim() || subcategory).toLowerCase()}`,
            photo,
          }),
        );
        const scoped = norm(annotationProductKey ? `${annotationProductKey} \u2014 ${cat.label}` : (cat.label as string));
        const mine = pendingAnnotations.filter((pa) => norm(pa.categoryName) === scoped);
        if (!mine.length) return server;

        // Re-edit: the existing card shows the new image straight away (local file, or the marks over the original).
        const cards = server.map((card) => {
          const pa = mine.find((x) => x.mode === 'reedit' && x.existingAnnotationId && x.existingAnnotationId === card.photo._id);
          if (!pa) return card;
          return {
            ...card,
            photo: {
              ...card.photo,
              secureUrl: pa.previewUri || card.photo.secureUrl,
              isPending: true,
              _annotPending: pa,
            } as CapturedPhoto,
          };
        });
        // New: its own card, unless the server copy has already landed for that photo (the queue refetches the lead
        // BEFORE it drops the item, so for a moment both exist).
        mine
          .filter((pa) => pa.mode === 'new')
          .forEach((pa) => {
            const base = pa.baseSubcategory.toLowerCase();
            if (cards.some((c) => c.label.toLowerCase() === base && !(c.photo as any)._annotPending)) return;
            cards.push({
              cat,
              label: pa.baseSubcategory,
              storageName: `${pa.baseSubcategory} (Annotated)`,
              slot: { name: pa.baseSubcategory, storageName: `${pa.baseSubcategory} (Annotated)` } as InspectionSlot,
              key: `annotated-${cat.id}-${pa.baseSubcategory.toLowerCase()}`,
              photo: {
                secureUrl: pa.previewUri,
                category: pa.categoryName,
                subcategory: `${pa.baseSubcategory} (Annotated)`,
                timestampTaken: pa.timestamp,
                isPending: true,
                isOptimistic: true,
                pendingId: pa.queueId,
                _annotPending: pa,
              } as CapturedPhoto,
            });
          });
        return cards;
      }),
    [leafs, capture, pendingAnnotations, annotationProductKey],
  );

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

  // Saved annotation docs, so an annotated photo can be re-opened with its marks (REVUIUX-558).
  const annotationLeadId: string | undefined = lead?._id || lead?.id;
  const queryClient = useQueryClient();
  const { data: annotationResponse } = useQuery({
    queryKey: ['leadAnnotations', annotationLeadId],
    queryFn: async () => (await LeadService.getAnnotations(annotationLeadId as string)).data,
    enabled: !!annotationLeadId && online,
    staleTime: 30_000,
  });
  const annotationDocs = useMemo(() => indexAnnotationDocs(annotationResponse), [annotationResponse]);

  // Secure url of every clean (slot / extra) photo, by `_id` - the base a re-edit draws over.
  const secureUrlById = useMemo(() => {
    const m = new Map<string, string>();
    [...sections.flatMap((sec) => sec.cards), ...extraCards].forEach((c) => {
      if (c.photo._id && c.photo.secureUrl) m.set(c.photo._id, c.photo.secureUrl);
    });
    return m;
  }, [sections, extraCards]);

  const moveTargetCount = useMemo(() => {
    const { leafCategories } = indexSchema(activeCategories);
    return leafCategories.reduce(
      (n, cat) => n + getCapturableSlots(cat).length + capture.extrasFor(cat).length,
      0,
    );
  }, [activeCategories, capture]);

  const orphanPhotos = useMemo(() => {
    const expected = new Set<string>();
    (products || []).forEach((prod: any) => {
      const pfx = prod?.name || prod?.id ? `${prod.name || prod.id} — ` : '';
      indexSchema(prod?.categories || []).leafCategories.forEach((c: any) =>
        expected.add(norm(`${pfx}${c.label}`)),
      );
    });
    const photos = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];
    const seen = new Set<string>();
    const out: any[] = [];
    photos.forEach((p: any) => {
      if (!p?.s3url) return;
      const sub = String(p.subcategory || '');
      if (sub.toLowerCase().includes('(annotated)')) return; // annotated copies aren't orphans
      if (expected.has(norm(p.category))) return; // belongs to a configured product slot
      if (seen.has(p.s3url)) return;
      seen.add(p.s3url);
      out.push(p);
    });
    return out;
  }, [products, lead?.salesPhotos]);

  const orphanSecure = useSecureUrls(
    orphanPhotos.map((p) => ({ s3url: p.s3url, bucketName: p.bucketName, category: p.category, subcategory: p.subcategory })),
  );
  const orphanUriByS3 = useMemo(() => {
    const m: Record<string, string> = {};
    Object.values(orphanSecure.data || {}).forEach((arr: any) =>
      (arr || []).forEach((x: any) => { if (x?.s3url) m[x.s3url] = x.uri; }),
    );
    return m;
  }, [orphanSecure.data]);

  const orphanCards = useMemo<PhotoCard[]>(
    () =>
      orphanPhotos.map((p, i) => ({
        cat: { id: `orphan-${p.s3url || i}`, label: p.category || 'Unsorted' } as any,
        label: p.subcategory || p.category || 'Photo',
        storageName: p.subcategory || '',
        slot: { name: p.subcategory || 'Photo', storageName: p.subcategory || '' } as InspectionSlot,
        key: `orphan-${p.s3url || p._id || i}`,
        photo: { ...p, secureUrl: orphanUriByS3[p.s3url] || p.secureUrl || resolveS3Url(p.s3url) },
      })),
    [orphanPhotos, orphanUriByS3],
  );

  const cardUris = useMemo(() => {
    const seen = new Set<string>();
    const push = (u?: string | null) => { if (u && !seen.has(u)) seen.add(u); };
    sections.forEach((sec) => sec.cards.forEach((c) => push(c.photo.secureUrl)));
    extraCards.forEach((c) => push(c.photo.secureUrl));
    annotated.forEach((c) => push(c.photo.secureUrl));
    orphanCards.forEach((c) => push(c.photo.secureUrl));
    return [...seen];
  }, [sections, extraCards, annotated, orphanCards]);
  const warmedUris = useWarmedImageUris(cardUris);

  const multiLeaf = sections.length > 1;
  const isEmpty =
    sections.length === 0 && extraCards.length === 0 && annotated.length === 0 && orphanCards.length === 0;

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

  const isAnnotatedCard = (card: PhotoCard) => card.key.startsWith('annotated-');

  const openAnnotationForSelection = () => {
    const withUrl = [...selectedMap.values()].filter((c) => c.photo.secureUrl);
    // Annotating needs the photo's bytes. Offline, a photo that was never downloaded exists only as a signed url and
    // would open a blank editor - leave it out and say why (saving itself works offline, see annotationSaveService).
    const cards = withUrl.filter(
      (c) => online || !/^https?:/i.test(c.photo.secureUrl as string) || !!warmedUris[c.photo.secureUrl as string],
    );
    if (cards.length < withUrl.length) {
      FlashMessage.warning(
        'Photo not on this device',
        'Connect once to open that photo, then you can annotate it offline.',
      );
    }
    if (!cards.length) return;
    const allPhotos: any[] = Array.isArray(lead?.salesPhotos) ? lead.salesPhotos : [];
    const selectedPhotos = cards.map((c) => {
      const common = {
        index: 0,
        s3url: c.photo.s3url,
        categoryName: c.photo.category || (c.cat.label as string),
      };
      if (!isAnnotatedCard(c) || !c.photo._id) {
        return {
          ...common,
          uri: c.photo.secureUrl as string,
          id: c.photo._id || c.photo.s3url || c.key,
          subcategory: c.storageName,
          salesPhotoId: c.photo._id || null,
        };
      }
      // Re-edit of an annotated copy. With saved marks AND the clean original on hand, draw over the original with
      // the marks restored; otherwise (web-written doc, no doc, original gone) draw on top of the flattened copy.
      const doc = annotationDocs.get(c.photo._id);
      const orig = findOriginalPhoto(c.photo as any, allPhotos, doc);
      const origUri = orig?._id ? secureUrlById.get(orig._id) : undefined;
      const marks = doc?.marks && origUri ? doc.marks : null;
      return {
        ...common,
        uri: (marks ? origUri : c.photo.secureUrl) as string,
        id: c.photo._id,
        subcategory: stripAnnotatedSuffix(c.storageName),
        existingAnnotationId: c.photo._id,
        salesPhotoId: orig?._id || doc?.originalId || null,
        initialMarks: marks,
        staleUris: c.photo.secureUrl ? [c.photo.secureUrl] : [],
      };
    });
    onClose();
    navigation.navigate('ImageAnnotation', {
      selectedPhotos,
      lead,
      onSaveSuccess: async () => {
        exitSelectMode();
        await queryClient.invalidateQueries({ queryKey: ['leadAnnotations', annotationLeadId] });
        try {
          await refetch?.();
        } catch (e) {
          console.warn('[DynamicManagePhotosView] refetch after annotate failed', e);
        }
        onReopen?.();
      },
      onCancel: () => {
        exitSelectMode();
        onReopen?.();
      },
    });
  };

  const openPreview = (tapped: PhotoCard) => {
    const all = [
      ...sections.flatMap((s) => s.cards),
      ...extraCards,
      ...annotated,
      ...orphanCards,
    ].filter((c) => c.photo.secureUrl);
    const photos: SectionPhoto[] = all.map((c) => ({
      uri: warmedUris[c.photo.secureUrl as string] || (c.photo.secureUrl as string),
      label: c.label,
      timestamp: c.photo.timestampTaken,
    }));
    const index = all.findIndex((c) => c.key === tapped.key);
    setPreview({ photos, index: index >= 0 ? index : 0 });
  };

  const renderCard = (
    card: PhotoCard,
    {
      showLabel = true,
      canMove = false,
      selectable = false,
      absoluteCategory = false,
    }: {
      showLabel?: boolean;
      canMove?: boolean;
      selectable?: boolean;
      absoluteCategory?: boolean;
    } = {},
  ) => {
    const uri = card.photo.secureUrl || undefined;
    const localUri = uri ? warmedUris[uri] : undefined;
    const tileState = photoTileState(uri, localUri, online);
    const unavailableOffline = tileState === 'unavailable' && !!uri;
    const busy = !!capture.deletingKeys[card.key] || !!capture.movingKeys?.[card.key];
    const isPending = (card.photo as any)?.isPending === true;
    const annot = (card.photo as any)?._annotPending;
    if (annot?.job) lastJobRef.current.set(card.key, annot.job);
    // Once the flattened image / server copy is what the card shows, the marks drawn over the original stay on top
    // ONLY until that image has painted, so the swap is invisible.
    const holdJob =
      !annot?.job && isAnnotatedCard(card) && !annotLoaded[card.key] ? lastJobRef.current.get(card.key) : undefined;
    const isSelected = selectedMap.has(card.key);
    // The base photo is locked once annotated (one annotated photo per base photo); the annotated copy itself is
    // what gets re-selected to edit.
    const alreadyAnnotated =
      !isAnnotatedCard(card) &&
      annotatedBaseKeys.has(`${card.cat.id}::${card.label.trim().toLowerCase()}`);
    const lockedFromSelect = selectMode && selectable && (alreadyAnnotated || isPending);
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
          <PhotoPeekPressable
            uri={localUri || uri}
            label={card.label}
            disabled={!uri || lockedFromSelect || (unavailableOffline && !selectableNow)}
            peekDisabled={selectMode || unavailableOffline}
            onPress={() => {
              if (!uri) return;
              if (selectableNow) toggleSelect(card);
              else if (unavailableOffline) return;
              else if (!selectMode) openPreview(card);
            }}
            style={{ width: '100%', aspectRatio: PHOTO_TILE_ASPECT, alignItems: 'center', justifyContent: 'center' }}
          >
            {/* ⚠️ THREE states, not two — see `photoTileState`. A photo uploaded while online
                exists only as a pre-signed S3 url; if this screen was never opened with a
                connection its bytes were never warmed, so offline there is nothing to draw and
                no way to fetch it. That tile used to spin forever. It now says so. */}
            {annot?.job ? (
              // Saved but not flattened yet: the marks drawn over the original, so the card never waits.
              <AnnotationOverlayPreview
                job={annot.job}
                width={cardWidth - 3}
                height={(cardWidth - 3) / PHOTO_TILE_ASPECT}
              />
            ) : tileState === 'ready' || tileState === 'loading' ? (
              <LoadingImage
                uri={(tileState === 'ready' ? localUri : undefined) || uri!}
                style={{ width: '100%', height: '100%' }}
                // ⚠️ `contain`, not `cover` (REVUIUX-574). `cover` fills the tile by throwing away
                // whatever does not fit, so a portrait photo lost its top and bottom and the thumbnail
                // was not the picture it opened. `contain` shows the WHOLE frame and pads with the
                // card's own background instead. The tile is a means of recognising a photo, so showing
                // all of it beats filling the box.
                resizeMode="contain"
                spinnerColor="#fff"
                unavailableLabel={online ? 'Tap to retry' : 'Needs a connection'}
                onRetry={() => {
                  void forgetWarmedUri(uri).then(() => refetch?.());
                }}
                onLoaded={() => {
                  if (isAnnotatedCard(card)) setAnnotLoaded((p) => (p[card.key] ? p : { ...p, [card.key]: true }));
                }}
              />
            ) : uri ? (
              <View style={{ alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 }}>
                <Icon name="cloud-off-outline" size={22} color="#9CA3AF" />
                <Text
                  style={{
                    marginTop: 6,
                    fontSize: 10,
                    fontWeight: '700',
                    color: '#9CA3AF',
                    textAlign: 'center',
                  }}
                >
                  Needs a connection{'\n'}to show this photo
                </Text>
              </View>
            ) : (
              <Icon name="image-outline" size={24} color="#C4CDD5" />
            )}

            {holdJob && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} pointerEvents="none">
                <AnnotationOverlayPreview job={holdJob} width={cardWidth - 3} height={(cardWidth - 3) / PHOTO_TILE_ASPECT} />
              </View>
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
          </PhotoPeekPressable>

          {/* A queued photo shows its state instead of actions. */}
          {!selectMode && isPending && (() => {
            const isInFlight = (card.photo as any)?.pendingId === activeUploadId;
            // A saved-but-not-yet-flattened annotation has no queue item (nothing to cancel); a re-edit's card is the
            // EXISTING server photo, so its trash must never cancel / delete anything.
            const noDelete = !!annot && (annot.mode === 'reedit' || !annot.queueId || !!annot.ghost);
            const st =
              annot?.ghost
                ? { status: 'uploaded', label: 'Uploaded', icon: 'check-circle', color: GREEN, spinner: false }
                : annot && !annot.queueId
                ? { status: 'saving', label: 'Saving\u2026', icon: 'content-save', color: '#F59E0B', spinner: true }
                : pendingStatusFor(isInFlight, online);
            return (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  paddingVertical: 8,
                  paddingHorizontal: 6,
                }}
              >
                {st.spinner ? (
                  <ActivityIndicator size="small" color={st.color} />
                ) : (
                  <Icon name={st.icon} size={14} color={st.color} />
                )}
                <Text style={{ color: st.color, fontWeight: '700', fontSize: 11 }} numberOfLines={1}>
                  {st.label}
                </Text>
                {/* ⚠️ A queued photo CAN be deleted — it is the wrong shot the rep wants gone, and
                    making them wait for signal to remove it is the complaint this fixes. It
                    cancels the upload rather than calling the server, because nothing has been
                    sent yet (see `resolveDeleteTarget`). Hidden only while the bytes are actually
                    in flight, where cancelling would lose the s3url needed to clean up after. */}
                {!isInFlight && !noDelete && (
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
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={{ marginLeft: 2, opacity: busy ? 0.5 : 1 }}
                  >
                    {capture.deletingKeys[card.key] ? (
                      <ActivityIndicator size="small" color={RED} />
                    ) : (
                      <Icon name="trash-can-outline" size={14} color={RED} />
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })()}

          {/* Actions are hidden in select mode (web parity). Ticket: "Scale down Trash
              and move icon" — both shrunk from the original 32px-tall row. */}
          {!selectMode && !isPending && (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 6, padding: 6 }}>
              {canMove && moveTargetCount > 1 ? (
                <TouchableOpacity
                  disabled={busy}
                  onPress={() =>
                    setMoveState({
                      photo: card.photo,
                      fromCategory: card.cat,
                      fromSlot: card.slot,
                      key: card.key,
                      ...(absoluteCategory ? { fromIsAbsoluteCategory: true } : null),
                    })
                  }
                  style={{
                    flex: 1,
                    height: 26,
                    borderRadius: 7,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 3,
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
                      <Icon name="folder-move-outline" size={11} color={GREEN} />
                      <Text style={{ color: GREEN, fontWeight: '700', fontSize: 10 }}>Move</Text>
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
                  width: 26,
                  height: 26,
                  borderRadius: 7,
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
                  <Icon name="trash-can-outline" size={14} color={RED} />
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <PhotoPeekScrollLockProvider>
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
        {/* Multiple products → a product dropdown in the header; otherwise the title
            (select mode always shows its own title, not the dropdown). */}
        {!selectMode && products.length > 1 ? (
          <View style={{ flex: 1, alignItems: 'center' }}>
            <ProductDropdown
              products={products as any}
              selectedProductId={selectedProduct?.id ?? null}
              onSelect={(id) => { setSelectedProductId(id); setActiveTab(0); }}
            />
          </View>
        ) : (
          <Text style={{ flex: 1, textAlign: 'center', color: '#fff', fontWeight: '700', fontSize: 15 }}>
            {selectMode ? 'Select photos' : `Manage Photos (${managePhotosCount})`}
          </Text>
        )}
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
        <PeekAwareScrollView contentContainerStyle={{ padding: H_PADDING, paddingBottom: 48 }}>
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

              {/* + ANNOTATED — selectable to RE-EDIT in place (REVUIUX-558). The base
                  photo stays locked in select mode: one annotated photo per base. */}
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
                    {annotated.map((card) => renderCard(card, { selectable: true }))}
                  </View>
                </View>
              )}

              {/* + UNSORTED — photos not mapped to any configured slot (static /
                  pre-schema / renamed-product). Display + delete only; product-wide,
                  so they show regardless of the active tab. */}
              {orphanCards.length > 0 && (
                <View style={{ marginTop: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <Text style={{ color: '#F59E0B', fontWeight: '900', fontSize: 11, letterSpacing: 1 }}>
                      + UNSORTED
                    </Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.12)' }} />
                    <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11, fontWeight: '700' }}>
                      {orphanCards.length} photo{orphanCards.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
                    {/* ⚠️ Movable, deliberately. These were display+delete only, which left a rep
                        who captured while the inspection schema was unavailable (an offline cold
                        start, before it was cached) with no way to re-file a correctly-shot photo
                        except to delete it and shoot again. The move sends the photo's REAL stored
                        category as `currentPosition` and a SCOPED one as the destination, which is
                        precisely what adopts it into the schema — after which it counts towards
                        its tab and stops being an orphan. */}
                    {orphanCards.map((card) =>
                      renderCard(card, { canMove: true, absoluteCategory: true }),
                    )}
                  </View>
                </View>
              )}
            </>
          )}
        </PeekAwareScrollView>
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

      {/* Full-screen preview - swipe / arrows / thumbnail strip through every photo on screen */}
      {!!preview && (
        <InspectionPhotoViewer
          sectionName=""
          photos={preview.photos}
          initialIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      )}

      {/* Delete confirmation — web never deletes straight from the card */}
      <Modal visible={!!pendingDelete} transparent animationType="fade" onRequestClose={() => setPendingDelete(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 380, backgroundColor: '#0D1F1A', borderRadius: 20, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(239,68,68,0.1)', borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="delete-outline" size={24} color={RED} />
              </View>
              {/* Only when the bytes are actually on the device. Offline a server photo's
                  signed url resolves to nothing, and a blank 48pt square next to "Discard this
                  photo?" is worse than no thumbnail at all — the rep cannot tell WHICH photo
                  they are about to delete. */}
              {!!pendingDelete?.photo?.secureUrl &&
                photoTileState(
                  pendingDelete.photo.secureUrl as string,
                  warmedUris[pendingDelete.photo.secureUrl as string],
                  online,
                ) !== 'unavailable' && (
                  <Image
                    source={{
                      uri:
                        warmedUris[pendingDelete.photo.secureUrl as string] ||
                        (pendingDelete.photo.secureUrl as string),
                    }}
                    style={{ width: 48, height: 48, borderRadius: 8 }}
                    resizeMode="cover"
                  />
                )}
            </View>
            <Text style={{ fontWeight: '800', fontSize: 16, color: '#FFFFFF', marginBottom: 6 }}>
              Discard this photo?
            </Text>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginBottom: 20 }}>
              This photo will be permanently deleted. You'll need to retake it to capture this shot.
            </Text>
            {/* Say what actually happens offline. The photo leaves the screen now either way, but
                a delete of a SYNCED photo is only filed until there is signal — and a rep who is
                not told that may assume it failed and go looking for it on the portal. */}
            {!online && !(pendingDelete?.photo as any)?.isPending && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: -12,
                  marginBottom: 18,
                }}
              >
                <Icon name="cloud-off-outline" size={13} color="#9CA3AF" />
                <Text style={{ flex: 1, fontSize: 11, color: '#9CA3AF' }}>
                  You're offline — this will sync when you're back on a connection.
                </Text>
              </View>
            )}
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
                style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: RED, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', opacity: deleting ? 0.6 : 1 }}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Icon name="delete-outline" size={16} color="#fff" />
                    <Text style={{ fontWeight: '700', color: '#fff' }}>Discard</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
    </PhotoPeekScrollLockProvider>
  );
}
