import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Image,
  Dimensions,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from 'react-native-reanimated';
import { LeadService } from '../../../services/api/leads';
import { useAuth } from '../../../hooks/useAuth';
import { logEvent } from '../../../services/api/LoggerService';
import ReactNativeBlobUtil from 'react-native-blob-util';
import { findLook } from '../../../utils/revrender-lighting/catalog';
import { forgetWarmedUri, getLocalCachePath, getWarmedLocalUri, prefetchToLocalCache, warmToLocalCache } from '../../../utils/imageFileCache';

// The local-file image cache used to live here. It moved to `utils/imageFileCache`
// so leaf widgets (PhotoPeekPressable) can warm images without importing this
// modal; these re-exports keep the existing import sites working.
export { getLocalCachePath, prefetchToLocalCache };


// High-performance CachedImage component targeting pre-signed S3 URLs (atomic write)
type RenderChip = { label: string; colorName: string; colorHex: string; swatches?: string[] };

const CachedImage = ({ uri, style, resizeMode, onLoad, onError }: any) => {
  // ⚠️ Seeded SYNCHRONOUSLY from the warmed-uri memo. This component renders `null` until
  // it knows which uri to use, and it used to learn that only from an async
  // `fs.exists` — so every open of the gallery, and every swipe back to a render already
  // seen, went blank for a beat over a file sitting on disk the whole time.
  const [sourceUri, setSourceUri] = useState<string | null>(() => getWarmedLocalUri(uri));

  useEffect(() => {
    if (!uri) {
      setSourceUri(null);
      return;
    }

    const known = getWarmedLocalUri(uri);
    if (known) {
      setSourceUri(known);
      return;
    }

    if (!getLocalCachePath(uri)) {
      setSourceUri(uri);
      return;
    }

    // Paint the network url NOW and warm the file underneath it. ⚠️ Deliberately does not
    // swap `sourceUri` when the download lands — changing the source mid-load trips native
    // image-loader hangs. The next mount picks the file up from the memo instead, which is
    // also why nothing here needs an unmount guard any more.
    setSourceUri(uri);
    warmToLocalCache(uri).catch(() => {});
  }, [uri]);

  if (!sourceUri) return null;

  return (
    <Image
      source={{ uri: sourceUri }}
      style={style}
      resizeMode={resizeMode}
      onLoad={onLoad}
      onError={() => {
        // A local copy that won't decode: bin the FILE and the memo entry together, then
        // fall back to the network. ⚠️ Unlinking without `forgetWarmedUri` would leave the
        // memo pointing at a path that no longer exists, and every later reader would be
        // handed a dead `file://`.
        if (sourceUri.startsWith('file://')) {
          forgetWarmedUri(uri).catch(() => {});
          setSourceUri(uri);
        }
        if (onError) onError();
      }}
    />
  );
};

interface RevRenderHistoryModalProps {
  visible: boolean;
  onClose: () => void;
  runs: any[];
  initialIndex: number;
  leadId?: string;
  onDeleteSuccess?: () => void;
  showDelete?: boolean;
  /**
   * Activity-log module this gallery's events belong to. Defaults to `rev_render`
   * (the Lead Center RevRender tool). When the modal is opened from the Investment
   * Center it is passed `investment_center`, so those views/navigations/deletes are
   * attributed to the presentation's audit trail rather than the RevRender module.
   */
  moduleType?: string;
}

export const RevRenderHistoryModal = ({
  visible,
  onClose,
  runs,
  initialIndex,
  leadId,
  onDeleteSuccess,
  showDelete = true,
  moduleType = 'rev_render',
}: RevRenderHistoryModalProps) => {
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Persistent cache of loaded image runs
  const [loadedImages, setLoadedImages] = useState<Record<number, { before: boolean; after: boolean }>>({});
  const [beforeLoaded, setBeforeLoaded] = useState(false);
  const [afterLoaded, setAfterLoaded] = useState(false);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex, visible]);

  // Clean up any incomplete/corrupted temp files from the cache directory on mount
  useEffect(() => {
    if (visible) {
      const cacheDir = ReactNativeBlobUtil.fs.dirs.CacheDir;
      ReactNativeBlobUtil.fs.lstat(cacheDir)
        .then((files) => {
          files.forEach((file) => {
            const isTemp = file.filename.startsWith('revrender_') && file.filename.endsWith('.tmp');
            const isCorrupted = file.filename.startsWith('revrender_') && Number(file.size) < 10240; // under 10KB is corrupted
            if (isTemp || isCorrupted) {
              ReactNativeBlobUtil.fs.unlink(`${cacheDir}/${file.filename}`).catch(() => { });
            }
          });
        })
        .catch(() => { });
    }
  }, [visible]);

  const currentRun = runs[currentIndex];
  const beforeImage = currentRun ? (currentRun.originalUrl || currentRun.s3UrlOriginal) : null;
  const afterImage = currentRun ? (currentRun.generatedUrl || currentRun.s3UrlGenerated) : null;

  // The colors/components the rep selected when generating this render, shown as
  // swatch chips below the header. Supports every backend shape: an explicit
  // `summary`/`components` array, or the raw `selections` + `textureImageUrls` maps.
  const renderColors = useMemo(() => {
    const run = currentRun;
    if (!run) return [] as RenderChip[];
    // Roofline Lighting runs carry a LOOK (`selections.lookName` + `colors`), not
    // components. Show it as one chip — the look's name with its colours — the same
    // way core products show "Soffit: <colour>", so the rep sees what was rendered.
    const lookSel = run.selections && typeof run.selections === 'object' ? run.selections : null;
    const lookName = lookSel?.lookName || run.lookName;
    if (typeof lookName === 'string' && lookName.trim()) {
      const lookColors = (Array.isArray(lookSel?.colors) ? lookSel.colors : run.colors) as unknown;
      const swatches = Array.isArray(lookColors)
        ? lookColors.filter((h): h is string => typeof h === 'string' && h.startsWith('#'))
        : [];
      // The server does not echo the month, so read it off the catalogue by id
      // (seasonal looks only — Everyday / team / theme looks have none).
      const month = findLook(String(lookSel?.lookId || run.lookId || ''))?.month;
      return [{ label: '', colorName: month ? `${lookName.trim()} · ${month}` : lookName.trim(), colorHex: swatches[0] || '', swatches }];
    }
    const arr = Array.isArray(run.summary)
      ? run.summary
      : Array.isArray(run.components)
        ? run.components
        : null;
    const cap = (s?: string) =>
      typeof s === 'string' && s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
    if (arr && arr.length) {
      return arr
        .map((c: any) => ({
          label: c?.label || c?.id || '',
          colorName: cap(c?.colorName || c?.textureName || c?.type || ''),
          colorHex: c?.colorHex || c?.textureUrl || '',
        }))
        .filter((c: any) => c.colorName || c.colorHex);
    }
    const sel = run.selections;
    const tex = run.textureImageUrls || {};
    if (sel && typeof sel === 'object') {
      const COMPONENTS = [
        { key: 'soffit', label: 'Soffit' },
        { key: 'fascia', label: 'Fascia Wrap' },
        { key: 'gutter', label: 'Gutter' },
        { key: 'downspout', label: 'Downspout' },
      ];
      return COMPONENTS
        .filter((c) => sel[c.key])
        .map((c) => ({
          label: c.label,
          colorName: cap(typeof sel[c.key] === 'string' ? sel[c.key] : ''),
          colorHex: tex[c.key] || '',
        }))
        .filter((c) => c.colorName || c.colorHex);
    }
    return [];
  }, [currentRun]);

  // ⚠️ ISO date read as TEXT (YYYY-MM-DD), never through `new Date()` — a timezone
  // offset would shift the calendar day.
  const renderedOn = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(currentRun?.createdAt || ''));
    if (!m) return '';
    // M/D/YYYY (no zero padding), the app's date format — was "Oct 6, 2026".
    return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
  }, [currentRun]);

  // Track if current slide is fully loaded (prioritizing persistent cache)
  useEffect(() => {
    const cached = loadedImages[currentIndex];
    setBeforeLoaded(!beforeImage || !!cached?.before);
    setAfterLoaded(!afterImage || !!cached?.after);
  }, [currentIndex, loadedImages, beforeImage, afterImage]);

  const isCurrentLoaded = beforeLoaded && afterLoaded;

  const fadeOpacity = useSharedValue(0);

  const fadeAnimStyle = useAnimatedStyle(() => ({
    opacity: fadeOpacity.value,
  }));

  // Trigger smooth fade-in whenever current index or its loaded state updates
  useEffect(() => {
    if (isCurrentLoaded) {
      fadeOpacity.value = withTiming(1, { duration: 300 });
    } else {
      fadeOpacity.value = 0;
    }
  }, [currentIndex, isCurrentLoaded, fadeOpacity]);

  useEffect(() => {
    if (visible && runs.length === 0) {
      onClose();
    }
  }, [runs, visible, onClose]);

  // Preload ONLY adjacent render images (prev and next) to keep network pipeline clear
  useEffect(() => {
    if (visible && runs && runs.length > 0) {
      const adjacentIndices = [currentIndex - 1, currentIndex + 1];
      adjacentIndices.forEach((idx) => {
        const run = runs[idx];
        if (!run) return;
        const before = run.originalUrl || run.s3UrlOriginal;
        const after = run.generatedUrl || run.s3UrlGenerated;
        if (before) {
          prefetchToLocalCache(before);
        }
        if (after) {
          prefetchToLocalCache(after);
        }
      });
    }
  }, [visible, runs, currentIndex]);


  // ── render_result: view — fires on open and when the user navigates to a new render ──
  useEffect(() => {
    if (!visible) return;
    const userId = user?._id || user?.id;
    if (!userId) return;
    const run = runs[currentIndex];
    if (!run) return;
    logEvent('view', {
      user_id: userId,
      module_type: moduleType,
      created_by: userId,
      meta: {
        action: 'render_viewed',
        screen: 'render_result',
        leadId,
        renderIndex: currentIndex + 1,
        totalRenders: runs.length,
        beforeImageUrl: run.originalUrl || run.s3UrlOriginal || null,
        afterImageUrl: run.generatedUrl || run.s3UrlGenerated || null,
        // `run` comes from different pair-builders depending on which screen opened this
        // modal (Lead Center Tools vs Investment Center vs Deal Center), and they don't all
        // use the same key name for the same value — read both so neither path logs null.
        originalS3url: run.s3UrlOriginal || run.originalS3url || null,
        generatedS3url: run.s3UrlGenerated || run.generatedS3url || null,
        s3url: run.s3url || null,
        bucketName: run.bucketName || null,
        category: run.category || null,
        subcategory: run.subcategory || null,
        viewLabel: run.viewLabel || null,
        createdAt: run.createdAt || null,
        runId: run.runId || run._id || null,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, currentIndex]);

  useEffect(() => {
    if (currentIndex >= runs.length) {
      setCurrentIndex(Math.max(0, runs.length - 1));
    }
  }, [runs, currentIndex]);

  const handleDeletePress = () => {
    setDeleteReason('');
    setDeleteVisible(true);
  };

  const handleDeleteConfirm = async () => {
    if (!currentRun?.runId && !currentRun?._id) return;
    const runId = currentRun.runId || currentRun._id;
    setIsDeleting(true);
    try {
      await LeadService.deleteRevRenderRun(runId, { reason: deleteReason });

      const userId = user?._id || user?.id;
      if (userId) {
        const deleteIndex = runs.findIndex(
          (r) => (r.runId || r._id) === runId
        );
        logEvent('delete', {
          user_id: userId,
          module_type: moduleType,
          created_by: userId,
          meta: {
            action: 'render_deleted',
            screen: 'render_result',
            leadId,
            renderIndex: deleteIndex + 1,
            runId,
            generatedS3url: currentRun?.s3UrlGenerated || null,
            bucketName: currentRun?.bucketName || null,
            category: currentRun?.category || null,
            subcategory: currentRun?.subcategory || null,
            viewLabel: currentRun?.viewLabel || null,
            createdAt: currentRun?.createdAt || null,
            deleteReason: deleteReason || null,
          },
        });
      }

      if (onDeleteSuccess) {
        onDeleteSuccess();
      }

      if (runs.length <= 1) {
        onClose();
      } else {
        setCurrentIndex((prev) => {
          if (prev >= runs.length - 1) {
            return Math.max(0, runs.length - 2);
          }
          return prev;
        });
      }
      setDeleteVisible(false);
      setDeleteReason('');
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to delete render.');
    } finally {
      setIsDeleting(false);
    }
  };

  const screenWidth = Dimensions.get('window').width;
  const imageWidth = screenWidth - 40;
  const imageHeight = "75%";

  // ── Pinch / pan for zooming ───────────────────────────────────────────
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  // Measured height of the clipping frame (it is a % of the screen), for the pan bounds.
  const boxHeight = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => { scale.value = savedScale.value * e.scale; })
    .onEnd(() => {
      const userId = user?._id || user?.id;
      const newScale = scale.value;
      if (userId && newScale !== 1) {
        runOnJS(logEvent)('pinch', {
          user_id: userId,
          module_type: moduleType,
          created_by: userId,
          meta: {
            leadId,
            action: 'pinch_zoom_applied',
            newScale,
          },
        });
      }
      if (newScale < 1) {
        scale.value = withSpring(1); savedScale.value = 1;
        translateX.value = withSpring(0); translateY.value = withSpring(0);
        savedTranslateX.value = 0; savedTranslateY.value = 0;
      } else {
        savedScale.value = newScale;
      }
    });

  const zoomPan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        // Keep the picture covering the frame: at most half of the extra size on each side.
        const maxX = ((scale.value - 1) * imageWidth) / 2;
        const maxY = ((scale.value - 1) * boxHeight.value) / 2;
        translateX.value = Math.max(-maxX, Math.min(maxX, savedTranslateX.value + e.translationX));
        translateY.value = Math.max(-maxY, Math.min(maxY, savedTranslateY.value + e.translationY));
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, zoomPan);

  const imageAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // ── Comparison slider ─────────────────────────────────────────────────
  // sliderX lives in Reanimated so the handle moves without a JS bridge round-trip.
  const sliderX = useSharedValue(imageWidth / 2);
  const savedSliderX = useSharedValue(imageWidth / 2);

  // Reset whenever the card changes
  useEffect(() => {
    sliderX.value = imageWidth / 2;
    savedSliderX.value = imageWidth / 2;
  }, [currentIndex, imageWidth, savedSliderX, sliderX]);

  const sliderPan = Gesture.Pan()
    // Only activate on clear horizontal swipes so vertical scrolls pass through
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onUpdate((e) => {
      const next = savedSliderX.value + e.translationX;
      sliderX.value = Math.max(0, Math.min(imageWidth, next));
    })
    .onEnd(() => {
      savedSliderX.value = sliderX.value;
    });

  const handleAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: sliderX.value - 0 }], // -30 = half handle width (60/2)
  }));

  const maskAnimStyle = useAnimatedStyle(() => ({
    width: sliderX.value,
  }));

  // ── Nav ───────────────────────────────────────────────────────────────
  const handlePrev = () => { if (currentIndex > 0) setCurrentIndex(currentIndex - 1); };
  const handleNext = () => {
    if (currentIndex < runs.length - 1) {
      const nextIndex = currentIndex + 1;
      const userId = user?._id || user?.id;
      if (userId) {
        logEvent('navigate', {
          user_id: userId,
          module_type: moduleType,
          created_by: userId,
          meta: {
            action: 'gallery_next',
            leadId,
            fromIndex: currentIndex + 1,
            toIndex: nextIndex + 1,
            totalRenders: runs.length,
          },
        });
      }
      setCurrentIndex(nextIndex);
    }
  };

  if (!currentRun) return null;

  return (
    <Modal visible={visible} transparent animationType="fade">
      <GestureHandlerRootView style={{ flex: 1 }}>
        <View style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.95)' }]}>


          {/* Header */}
          <View style={styles.header}>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.headerTitle}>Render #{currentIndex + 1}</Text>
                {showDelete && (currentRun?.runId || currentRun?._id) && (
                  <TouchableOpacity onPress={handleDeletePress} style={{ marginLeft: 12 }}>
                    <Icon name="trash-can-outline" size={22} color="#FF5630" />
                  </TouchableOpacity>
                )}
              </View>
              <View style={styles.statusRow}>
                <Icon name="check-circle" size={14} color="#72BD00" />
                <Text style={styles.statusText}>
                  Rendered{renderedOn ? ` · ${renderedOn}` : ''}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Icon name="close" size={24} color="white" />
            </TouchableOpacity>
          </View>

          {/* Selected colors — the component colors the rep applied when creating
              this render, shown as swatch chips (color dot + component + color name). */}
          {renderColors.length > 0 && (
            <View style={styles.colorsRow}>
              {renderColors.map((c: RenderChip, i: number) => (
                <View key={`${c.label}-${i}`} style={styles.colorChip}>
                  {(c.swatches?.length ? c.swatches : [c.colorHex]).map((hex, si) => (
                    <View
                      key={si}
                      style={[
                        styles.colorSwatch,
                        { backgroundColor: hex && hex.startsWith('#') ? hex : '#B0B0B0' },
                      ]}
                    />
                  ))}
                  <Text style={styles.colorChipText} numberOfLines={1}>
                    {c.label ? `${c.label}: ` : ''}{c.colorName || '—'}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Comparison Slider — zoom wrapper */}
          {/* ⚠️ The transform goes on an INNER layer, not the container. It used to sit on the
              container itself, so pinching scaled and dragged the WHOLE card (frame, labels,
              handle) across the screen instead of zooming the picture inside a fixed frame.
              The container is now the clip: it never moves, and only the zoom layer does. */}
          <GestureDetector gesture={composedGesture}>
            <View
              style={[styles.sliderContainer, { width: imageWidth, height: imageHeight }]}
              onLayout={(e) => { boxHeight.value = e.nativeEvent.layout.height; }}
            >
              <Reanimated.View style={[{ width: '100%', height: '100%' }, imageAnimStyle]}>
              <Reanimated.View style={[{ width: '100%', height: '100%' }, fadeAnimStyle]}>
                {/* AFTER — background */}
                {afterImage && (
                  <CachedImage
                    // Key by the render so navigating REMOUNTS the image instead of
                    // swapping `source.uri` on a live <Image> — React Native doesn't
                    // reliably re-fire `onLoad` on a source swap (loader hangs forever)
                    // and keeps painting the previous render's frame (one wrap "overtook"
                    // the others). A fresh mount per render fixes both.
                    key={`after-${currentIndex}-${afterImage}`}
                    uri={afterImage}
                    style={{
                      position: 'absolute',
                      width: imageWidth,
                      height: "100%",
                    }}
                    resizeMode="contain"
                    onLoad={() => {
                      setAfterLoaded(true);
                      setLoadedImages((prev) => ({
                        ...prev,
                        [currentIndex]: { ...(prev[currentIndex] || { before: false, after: false }), after: true },
                      }));
                    }}
                    onError={() => {
                      setAfterLoaded(true);
                      setLoadedImages((prev) => ({
                        ...prev,
                        [currentIndex]: { ...(prev[currentIndex] || { before: false, after: false }), after: true },
                      }));
                    }}
                  />
                )}

                {/* BEFORE — clipped left portion, driven by sliderX */}
                {beforeImage && (
                  <Reanimated.View
                    style={[
                      {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        height: "100%",
                        overflow: 'hidden',
                        borderRightWidth: 1,
                        borderRightColor: 'rgba(255,255,255,0.5)',
                      },
                      maskAnimStyle,
                    ]}
                  >
                    <CachedImage
                      // Remount per render (see the AFTER image note above).
                      key={`before-${currentIndex}-${beforeImage}`}
                      uri={beforeImage}
                      style={{ width: imageWidth, height: "100%" }}
                      resizeMode="contain"
                      onLoad={() => {
                        setBeforeLoaded(true);
                        setLoadedImages((prev) => ({
                          ...prev,
                          [currentIndex]: { ...(prev[currentIndex] || { before: false, after: false }), before: true },
                        }));
                      }}
                      onError={() => {
                        setBeforeLoaded(true);
                        setLoadedImages((prev) => ({
                          ...prev,
                          [currentIndex]: { ...(prev[currentIndex] || { before: false, after: false }), before: true },
                        }));
                      }}
                    />
                  </Reanimated.View>
                )}

                {/* Draggable handle — uses its own RNGH Pan so it doesn't fight PanResponder */}
                <GestureDetector gesture={sliderPan}>
                  <Reanimated.View style={[styles.handle, { height: "100%" }, handleAnimStyle]}>
                    <View style={styles.handleLine} />
                    <View style={styles.handleCircle}>
                      <Icon name="compare-horizontal" size={20} color="#1C252E" />
                    </View>
                  </Reanimated.View>
                </GestureDetector>
              </Reanimated.View>
              </Reanimated.View>

              {/* Labels stay put while the picture zooms underneath them. */}
              <View style={[styles.label, styles.labelBefore]} pointerEvents="none">
                <Text style={styles.labelText}>Before</Text>
              </View>
              <View style={[styles.label, styles.labelAfter]} pointerEvents="none">
                <Text style={styles.labelText}>After</Text>
              </View>

              {/* Green loader overlay while images are loading */}
              {!isCurrentLoaded && (
                <View style={styles.imageLoaderContainer}>
                  <ActivityIndicator size="large" color="#72BD00" />
                </View>
              )}
            </View>
          </GestureDetector>

          {/* Footer Navigation */}
          <View style={styles.footer}>
            <View style={styles.navRow}>
              <TouchableOpacity
                onPress={handlePrev}
                disabled={currentIndex === 0}
                style={[styles.navBtn, currentIndex === 0 && { opacity: 0.3 }]}
              >
                <Icon name="chevron-left" size={32} color="white" />
              </TouchableOpacity>

              <View style={styles.pagination}>
                {runs.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.dot,
                      { backgroundColor: i === currentIndex ? '#72BD00' : 'rgba(255,255,255,0.3)' },
                    ]}
                  />
                ))}
              </View>

              <TouchableOpacity
                onPress={handleNext}
                disabled={currentIndex === runs.length - 1}
                style={[styles.navBtn, currentIndex === runs.length - 1 && { opacity: 0.3 }]}
              >
                <Icon name="chevron-right" size={32} color="white" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.footerCloseBtn}>
              <Text style={styles.footerCloseText}>Close</Text>
            </TouchableOpacity>
          </View>

          {/* Delete Confirmation Modal */}
          <Modal visible={deleteVisible} transparent animationType="fade">
            <View style={styles.deleteOverlay}>
              <View style={[styles.deleteContainer, { backgroundColor: isDark ? '#1C252E' : 'white' }]}>
                <View style={styles.alertIconBg}>
                  <Icon name="alert-outline" size={32} color="#FF5630" />
                </View>
                <Text style={[styles.deleteTitle, { color: isDark ? 'white' : '#1C252E' }]}>Delete render?</Text>
                <Text style={styles.deleteDesc}>
                  This render will be removed from your gallery. Please enter a short reason for your records.
                </Text>
                <TextInput
                  style={[styles.reasonInput, { color: isDark ? 'white' : '#1C252E', borderColor: colors.border }]}
                  placeholder="Reason for deletion"
                  placeholderTextColor="#919EAB"
                  value={deleteReason}
                  onChangeText={setDeleteReason}
                  multiline
                  maxLength={2000}
                />
                <View style={styles.deleteActions}>
                  <TouchableOpacity
                    onPress={() => setDeleteVisible(false)}
                    disabled={isDeleting}
                    style={[styles.deleteBtnCancel, { borderColor: colors.border }]}
                  >
                    <Text style={[styles.btnTextCancel, { color: isDark ? 'white' : '#1C252E' }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleDeleteConfirm}
                    disabled={isDeleting || !deleteReason.trim()}
                    style={[styles.deleteBtnConfirm, { opacity: (isDeleting || !deleteReason.trim()) ? 0.6 : 1 }]}
                  >
                    {isDeleting ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Text style={styles.btnTextConfirm}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    paddingTop: 50,
    alignItems: 'center',
  },
  header: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 40,
    alignItems: 'center',
  },
  headerTitle: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  statusText: {
    color: '#72BD00',
    fontSize: 12,
    marginLeft: 4,
    fontWeight: '600',
  },
  colorsRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 24,
    marginTop: -28,
    marginBottom: 20,
    gap: 8,
  },
  colorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  colorSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    marginRight: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  colorChipText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
    maxWidth: 180,
  },
  closeBtn: {
    marginLeft: 'auto',
    padding: 8,
  },
  sliderContainer: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#1E1E1E',
  },
  imageLoaderContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1E1E1E',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  label: {
    position: 'absolute',
    top: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  labelBefore: {
    left: 20,
    backgroundColor: '#3498dbCC',
  },
  labelAfter: {
    right: 20,
  },
  labelText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  handle: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 60,
    marginLeft: -30,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  handleLine: {
    width: 2,
    height: '100%',
    backgroundColor: 'white',
  },
  handleCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'white',
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  footer: {
    width: '100%',
    position: 'absolute',
    bottom: 60,
    alignItems: 'center',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 30,
  },
  navBtn: {
    padding: 10,
  },
  pagination: {
    flexDirection: 'row',
    marginHorizontal: 20,
  },
  dot: {
    width: 20,
    height: 4,
    borderRadius: 2,
    marginHorizontal: 3,
  },
  footerCloseBtn: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
  },
  footerCloseText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  deleteOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  deleteContainer: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
  },
  alertIconBg: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 86, 48, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  deleteTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  deleteDesc: {
    color: '#637381',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  reasonInput: {
    width: '100%',
    height: 80,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    textAlignVertical: 'top',
    fontSize: 14,
    marginBottom: 20,
  },
  deleteActions: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  deleteBtnCancel: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnConfirm: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#FF5630',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTextCancel: {
    fontSize: 14,
    fontWeight: '600',
  },
  btnTextConfirm: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});
