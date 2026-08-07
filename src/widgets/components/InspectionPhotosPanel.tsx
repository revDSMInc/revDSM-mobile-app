import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { isRemoteImageUrl, warmToLocalCache } from '../../utils/imageFileCache';
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
}

const THUMB_SIZE = 56;
const THUMB_STRIDE = THUMB_SIZE + 8;

/**
 * Resolve local `file://` copies for a list of urls, so the viewer paints instantly
 * instead of re-downloading a pre-signed S3 object per slide (see the "Hold-to-peek
 * previews" note in CLAUDE.md — the OS image cache refuses to store these urls).
 *
 * Downloads dedupe by cache path inside `imageFileCache` and are capped there, so
 * overlapping with the thumbnails' own warming costs nothing.
 */
function useWarmedUris(uris: string[]): Record<string, string> {
  const [warmed, setWarmed] = useState<Record<string, string>>({});
  // Depend on the joined key, not the array identity — a new array every render
  // would restart every download on every render.
  const key = uris.join('|');

  useEffect(() => {
    let cancelled = false;
    uris.forEach((uri) => {
      if (!isRemoteImageUrl(uri)) return;
      warmToLocalCache(uri)
        .then((file) => {
          if (cancelled || !file) return;
          setWarmed((prev) => (prev[uri] ? prev : { ...prev, [uri]: file }));
        })
        .catch(() => {});
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return warmed;
}

interface ViewerProps {
  sectionName: string;
  photos: SectionPhoto[];
  initialIndex: number;
  onClose: () => void;
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
function InspectionPhotoViewer({ sectionName, photos, initialIndex, onClose }: ViewerProps) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  const pagerRef = useRef<FlatList<SectionPhoto>>(null);
  const stripRef = useRef<FlatList<SectionPhoto>>(null);

  const uris = useMemo(() => photos.map((p) => p.uri), [photos]);
  const warmed = useWarmedUris(uris);
  const srcOf = (p: SectionPhoto) => warmed[p.uri] || p.uri;

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(photos.length - 1, next));
      setIndex(clamped);
      pagerRef.current?.scrollToIndex({ index: clamped, animated: true });
    },
    [photos.length]
  );

  // Keep the active thumbnail on screen when paging by swipe or chevron.
  useEffect(() => {
    if (photos.length > 1) {
      stripRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
    }
  }, [index, photos.length]);

  const current = photos[index];
  const time = formatCaptureTime(current?.timestamp);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)' }}>
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
              {sectionName} - {current?.label}
            </Text>
            {!!time && (
              <Text style={{ color: '#fff', fontSize: 12, opacity: 0.7, marginTop: 2 }}>{time}</Text>
            )}
          </View>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600', marginRight: 12 }}>
            {index + 1} / {photos.length}
          </Text>
          <TouchableOpacity
            onPress={onClose}
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
        <View style={{ flex: 1, justifyContent: 'center' }}>
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
            onMomentumScrollEnd={(e) =>
              setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
            }
            renderItem={({ item }) => (
              <View
                style={{
                  width,
                  height: height * 0.62,
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
                />
              </View>
            )}
            style={{ flexGrow: 0 }}
          />
        </View>

        {photos.length > 1 && (
          <>
            <ChevronButton side="left" disabled={index === 0} onPress={() => goTo(index - 1)} />
            <ChevronButton
              side="right"
              disabled={index === photos.length - 1}
              onPress={() => goTo(index + 1)}
            />
          </>
        )}

        {photos.length > 1 && (
          <View style={{ position: 'absolute', left: 0, right: 0, bottom: 36 }}>
            <FlatList
              ref={stripRef}
              data={photos}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 16 }}
              keyExtractor={(item, i) => `thumb-${item.uri}-${i}`}
              getItemLayout={(_, i) => ({
                length: THUMB_STRIDE,
                offset: THUMB_STRIDE * i,
                index: i,
              })}
              renderItem={({ item, index: i }) => (
                <TouchableOpacity
                  onPress={() => goTo(i)}
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
export function InspectionPhotosPanel({ photos, secureImages }: InspectionPhotosPanelProps) {
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
                onPress={() => setExpandedCat(isExpanded ? null : section.id)}
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
                        onPress={() => setViewer({ sectionId: section.id, index: i })}
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
          onClose={() => setViewer(null)}
        />
      )}
    </>
  );
}
