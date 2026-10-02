import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBottomInset } from '../../hooks/useBottomInset';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Modal,
  FlatList,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PhotoPeekPressable } from '../common/PhotoPeekPressable';
import { useWarmedImageUris } from '../../hooks/useWarmedImageUris';
import {
  buildInspectionSections,
  formatCaptureTime,
  type SectionPhoto,
  type SecureImageMap,
} from '../../utils/inspection-photos';

export interface InspectionPhotosPanelProps {
  /** Raw `salesPhotos` off the lead — carries category/subcategory/deletedAt. */
  photos: any[];
  secureImages: SecureImageMap;
  /** Optional analytics hook - reports every tap inside the panel. */
  onAction?: (action: string, meta?: Record<string, unknown>) => void;
}

const THUMB_SIZE = 72;
const THUMB_STRIDE = THUMB_SIZE + 8;

interface ViewerProps {
  sectionName: string;
  photos: SectionPhoto[];
  initialIndex: number;
  onClose: () => void;
  onAction?: (action: string, meta?: Record<string, unknown>) => void;
}

/**
 * Full-screen pageable viewer — the mobile counterpart of web's lightbox: swipe or
 * use the chevrons to move between a section's photos, with a title, an "n / total"
 * counter and a tappable thumbnail strip.
 *
 * Rendered from inside the panel on purpose. The Pitchbook / Roofline Deck tool
 * drawer is mounted either INSIDE the screen's fullscreen `Modal` or outside it
 * depending on `isFullscreen`, so a `Modal` rendered here nests correctly in both
 * cases automatically — which is why each screen previously needed two duplicate
 * preview modals gated on `isFullscreen`.
 */
export function InspectionPhotoViewer({ sectionName, photos, initialIndex, onClose, onAction }: ViewerProps) {
  const { width, height } = useWindowDimensions();
  const bottomInset = useBottomInset();
  // Height of the area under the header, and each photo's height/width ratio (learned from its
  // own load). Together they size the photo to what it actually displays at, so the thumbnails
  // sit directly under the picture instead of far below it across a wide black gap.
  const [slotHeight, setSlotHeight] = useState(0);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const hasStrip = photos.length > 1;
  const maxPhotoHeight = Math.max(0, slotHeight || height * 0.6);
  const [index, setIndex] = useState(initialIndex);
  const pagerRef = useRef<FlatList<SectionPhoto>>(null);
  const stripRef = useRef<FlatList<SectionPhoto>>(null);

  const uris = useMemo(() => photos.map((p) => p.uri), [photos]);
  const warmed = useWarmedImageUris(uris);
  const srcOf = (p: SectionPhoto) => warmed[p.uri] || p.uri;

  const goTo = useCallback(
    (next: number, source: 'chevron' | 'thumbnail') => {
      const clamped = Math.max(0, Math.min(photos.length - 1, next));
      onAction?.('inspection_viewer_photo_changed', {
        section: sectionName,
        toPhoto: clamped + 1,
        totalPhotos: photos.length,
        source,
      });
      setIndex(clamped);
      pagerRef.current?.scrollToIndex({ index: clamped, animated: true });
    },
    [photos.length, sectionName, onAction]
  );

  // Keep the active thumbnail on screen when paging by swipe or chevron.
  useEffect(() => {
    if (photos.length > 1) {
      stripRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    }
  }, [index, photos.length]);

  const current = photos[index];
  const photoHeight = Math.min(maxPhotoHeight, Math.round(width * (ratios[current?.uri] || 4 / 3)));
  const time = formatCaptureTime(current?.timestamp);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {/* Header — title left, counter + close right (web parity). */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 16,
            paddingTop: 52,
            paddingBottom: 12,
          }}
        >
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text numberOfLines={1} style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              {sectionName ? `${sectionName} - ${current?.label ?? ''}` : current?.label}
            </Text>
            {!!time && (
              <Text style={{ color: '#fff', fontSize: 12, opacity: 0.7, marginTop: 2 }}>{time}</Text>
            )}
          </View>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', marginRight: 12 }}>
            {index + 1} / {photos.length}
          </Text>
          <TouchableOpacity
            onPress={() => {
              onAction?.('inspection_viewer_closed', { section: sectionName, photo: index + 1 });
              onClose();
            }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.2)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="close" size={24} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Wrapper centres the pager between the header and the thumbnail strip; the
            pager itself keeps an explicit page height so layout is deterministic. */}
        <View style={{ flex: 1, paddingBottom: bottomInset }}>
          {/* The photo slot takes everything above the strip and centres the photo in it. */}
          <View
            style={{ flex: 1, justifyContent: 'center' }}
            onLayout={(e) => setSlotHeight(Math.round(e.nativeEvent.layout.height))}
          >
          <View style={{ height: photoHeight }}>
          <FlatList
            ref={pagerRef}
            data={photos}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialScrollIndex={initialIndex}
            // Required for `initialScrollIndex` / `scrollToIndex` on a horizontal pager.
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            keyExtractor={(item, i) => `${item.uri}-${i}`}
            onMomentumScrollEnd={(e) => {
              const next = Math.round(e.nativeEvent.contentOffset.x / width);
              if (next !== index) {
                onAction?.('inspection_viewer_photo_changed', {
                  section: sectionName,
                  toPhoto: next + 1,
                  totalPhotos: photos.length,
                  source: 'swipe',
                });
              }
              setIndex(next);
            }}
            renderItem={({ item }) => (
              <View
                style={{
                  width,
                  // ⚠️ Sized to the photo's own proportions, capped by the room left above the
                  // strip - a fixed fraction of the window either overlapped the thumbnails
                  // on short phones or left a huge black gap above them on tall ones.
                  height: photoHeight,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Image
                  // Keyed on the resolved source so swapping the network url for the
                  // warmed file remounts rather than leaving the old decode up.
                  key={srcOf(item)}
                  source={{ uri: srcOf(item) }}
                  style={{ width, height: '100%' }}
                  resizeMode="contain"
                  onLoad={(e) => {
                    const src = e.nativeEvent.source;
                    if (src?.width && src?.height) {
                      setRatios((r) => (r[item.uri] ? r : { ...r, [item.uri]: src.height / src.width }));
                    }
                  }}
                />
              </View>
            )}
            style={{ flexGrow: 0 }}
          />
          {/* Inside the photo box so `top: 50%` centres on the PHOTO. */}
          {hasStrip && (
            <>
              <ChevronButton side="left" disabled={index === 0} onPress={() => goTo(index - 1, 'chevron')} />
              <ChevronButton
                side="right"
                disabled={index === photos.length - 1}
                onPress={() => goTo(index + 1, 'chevron')}
              />
            </>
          )}
          </View>
          </View>

        {hasStrip && (
          // PINNED to the bottom of the black area, in flow under the photo slot, so it has
          // its own band instead of floating over the picture. The area's bottom padding
          // clears the Android nav bar. The row is centred when it is shorter than the screen.
          <View style={{ paddingTop: 12, paddingBottom: 16 }}>
            <FlatList
              ref={stripRef}
              data={photos}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ minWidth: width, paddingHorizontal: 16, paddingRight: 8, justifyContent: 'center' }}
              keyExtractor={(item, i) => `thumb-${item.uri}-${i}`}
              getItemLayout={(_, i) => ({
                length: THUMB_STRIDE,
                offset: THUMB_STRIDE * i,
                index: i,
              })}
              renderItem={({ item, index: i }) => (
                <TouchableOpacity
                  onPress={() => goTo(i, 'thumbnail')}
                  style={{
                    width: THUMB_SIZE,
                    height: THUMB_SIZE,
                    marginRight: 8,
                    borderRadius: 6,
                    overflow: 'hidden',
                    borderWidth: 2,
                    borderColor: i === index ? '#fff' : 'transparent',
                    opacity: i === index ? 1 : 0.55,
                  }}
                >
                  <Image
                    source={{ uri: srcOf(item) }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              )}
            />
          </View>
        )}
        </View>
      </View>
    </Modal>
  );
}

function ChevronButton({
  side,
  disabled,
  onPress,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        position: 'absolute',
        top: '50%',
        // RN has no `translateY(-50%)`, so pull the button up by half its height —
        // `top: '50%'` alone puts its TOP edge at the midline, not its centre.
        marginTop: -22,
        [side]: 12,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(255,255,255,0.15)',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.25 : 1,
      }}
    >
      <Icon name={side === 'left' ? 'chevron-left' : 'chevron-right'} size={28} color="#fff" />
    </TouchableOpacity>
  );
}

/**
 * "Property Inspection Photos" — the accordion of captured lead photos shown in the
 * Pitchbook and Roofline Deck tool drawers. Grouping lives in
 * `utils/inspection-photos.ts`; this file is presentation only.
 */
export function InspectionPhotosPanel({ photos, secureImages, onAction }: InspectionPhotosPanelProps) {
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [viewer, setViewer] = useState<{ sectionId: string; index: number } | null>(null);
  const sections = useMemo(() => buildInspectionSections(photos, secureImages), [photos, secureImages]);

  const viewerSection = viewer ? sections.find((s) => s.id === viewer.sectionId) : null;

  if (sections.length === 0) {
    return (
      <View className="items-center justify-center py-12 opacity-50">
        <Icon name="image-off" size={48} color="#919EAB" />
        <Text className="text-text-secondary mt-4 font-bold">No inspection photos available</Text>
        <Text className="text-text-secondary text-[10px] mt-1">
          Photos added in Job Docs will appear here.
        </Text>
      </View>
    );
  }

  return (
    <>
      {sections.map((section) => {
        const isExpanded = expandedCat === section.id;
        const count = section.photos.length;

        return (
          // Two nested Views on purpose: iOS CLIPS a shadow when the same view sets
          // `overflow: hidden`, so the shadow lives on the outer wrapper and the
          // rounding/clipping on the inner one.
          <View
            key={section.id}
            className="mb-4 rounded-xl bg-white"
            style={{
              shadowColor: '#000',
              shadowOpacity: 0.16,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }}
          >
            <View className="rounded-xl overflow-hidden bg-white">
              <TouchableOpacity
                onPress={() => {
                  onAction?.(isExpanded ? 'inspection_section_collapsed' : 'inspection_section_expanded', {
                    section: section.name,
                    photoCount: count,
                  });
                  setExpandedCat(isExpanded ? null : section.id);
                }}
                className="flex-row items-center justify-between px-4 py-3"
              >
                <Text className="text-base font-semibold text-[#1C252E]">{section.name}</Text>
                <View className="flex-row items-center">
                  {/* Web parity: a plain photo count. The old "N of M complete" read its
                      M from the STATIC category's `subCategories`, which a dynamically
                      captured section simply doesn't have. */}
                  <View className="px-3 py-1 rounded-md mr-3" style={{ backgroundColor: '#212B36' }}>
                    <Text className="text-xs text-white font-semibold">
                      {count} photo{count !== 1 ? 's' : ''}
                    </Text>
                  </View>
                  <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={20} color="#637381" />
                </View>
              </TouchableOpacity>

              {isExpanded && (
                // `space-between` rather than a pixel `gap`: two 48% columns plus a
                // fixed gap can exceed 100% on a narrow drawer and wrap to one card
                // per row. An odd last card is left-aligned, which is what web does.
                <View className="flex-row flex-wrap px-3 pb-3" style={{ justifyContent: 'space-between' }}>
                  {section.photos.map((img, i) => {
                    const time = formatCaptureTime(img.timestamp);
                    return (
                      // Hold to peek full-screen, exactly like revRender: the peek warms a
                      // local file:// copy, so the enlarged image is instant instead of
                      // blank for 2–3s while a pre-signed S3 url re-downloads. A tap opens
                      // the pageable viewer at this photo.
                      <PhotoPeekPressable
                        key={`${img.uri}-${i}`}
                        uri={img.uri}
                        label={`${section.name} - ${img.label}`}
                        onPress={() => {
                          onAction?.('inspection_photo_opened', {
                            section: section.name,
                            subcategory: img.label,
                            photo: i + 1,
                            totalPhotos: count,
                          });
                          setViewer({ sectionId: section.id, index: i });
                        }}
                        className="rounded-xl overflow-hidden bg-slate-50"
                        style={{
                          // Two per row (web `xs={6}`) at web's 4/3 crop.
                          width: '48%',
                          aspectRatio: 4 / 3,
                          marginBottom: 12,
                          borderWidth: 2,
                          borderColor: '#E2E8F0',
                        }}
                      >
                        <Image source={{ uri: img.uri }} className="w-full h-full" resizeMode="cover" />

                        {/* Eye affordance, top-left (web `mdi:eye`). */}
                        <View
                          style={{
                            position: 'absolute',
                            top: 8,
                            left: 8,
                            width: 28,
                            height: 28,
                            borderRadius: 14,
                            backgroundColor: 'rgba(0,0,0,0.6)',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Icon name="eye" size={16} color="#fff" />
                        </View>

                        {/* Caption bar: subcategory left, capture time right. */}
                        <View
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            right: 0,
                            backgroundColor: 'rgba(0,0,0,0.75)',
                            paddingHorizontal: 8,
                            paddingVertical: 6,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                        >
                          <Text
                            numberOfLines={2}
                            style={{
                              color: '#fff',
                              fontSize: 11,
                              fontWeight: '600',
                              lineHeight: 14,
                              flexShrink: 1,
                              paddingRight: time ? 6 : 0,
                            }}
                          >
                            {img.label}
                          </Text>
                          {!!time && (
                            <Text style={{ color: '#fff', fontSize: 10, opacity: 0.9 }}>{time}</Text>
                          )}
                        </View>
                      </PhotoPeekPressable>
                    );
                  })}
                </View>
              )}
            </View>
          </View>
        );
      })}

      {viewer && viewerSection && (
        <InspectionPhotoViewer
          // Remount when the section changes so `initialScrollIndex` is re-applied.
          key={viewer.sectionId}
          sectionName={viewerSection.name}
          photos={viewerSection.photos}
          initialIndex={viewer.index}
          onAction={onAction}
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}
