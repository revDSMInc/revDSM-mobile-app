import React, { useState, useEffect, useMemo, useRef } from 'react';
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
  Keyboard,
  Platform,
  ScrollView,
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
import { forgetWarmedUri, getLocalCachePath, getWarmedLocalUri, prefetchToLocalCache, verifyIndexedUri, warmToLocalCache } from '../../../utils/imageFileCache';

export { getLocalCachePath, prefetchToLocalCache };


type RenderChip = { label: string; colorName: string; colorHex: string; swatches?: string[] };

/**
 * REVUIUX-586: an already-downloaded render must open with NO spinner.
 *
 * ⚠️ The spinner was never waiting on a download. `OperationalSections` warms BOTH images of
 * every run to disk as soon as the Tools list renders, so by the time the rep taps a thumbnail
 * the bytes are usually already there - but the viewer still showed its loader until React
 * Native fired `onLoad`, and if that never came (a purged cache file, a remount mid-load) the
 * spinner stayed up for good.
 *
 * `onReady` fires SYNCHRONOUSLY when the file is already local, so the caller can clear its
 * loader in the same commit as the first paint instead of waiting for an event.
 */
/**
 * How long the viewer waits for an image event before giving up on the spinner.
 * Generous: a cold render over LTE is a real wait, and clearing too early would flash an
 * empty frame over a picture that was about to arrive.
 */
const IMAGE_LOAD_TIMEOUT_MS = 12_000;

const CachedImage = ({ uri, style, resizeMode, onLoad, onError, onReady }: any) => {
  const [sourceUri, setSourceUri] = useState<string | null>(() => getWarmedLocalUri(uri));
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  // Tell the caller at once when we already hold the file; `uri` in the deps so a new picture
  // re-asks rather than inheriting the previous one's answer.
  useEffect(() => {
    if (uri && getWarmedLocalUri(uri)) onReadyRef.current?.();
  }, [uri]);

  useEffect(() => {
    if (!uri) {
      setSourceUri(null);
      return;
    }

    const known = getWarmedLocalUri(uri);
    if (known) {
      setSourceUri(known);
      /**
       * ⚠️ The INDEX is a hint, not proof. Cache files live in `CacheDir`, which iOS purges
       * under storage pressure WITHOUT telling the app - so the index can promise a file that
       * is gone, and the <Image> then fails to a slow remote (or hangs). Confirm once per
       * session and re-warm if it has vanished.
       */
      verifyIndexedUri(uri)
        .then((ok) => {
          if (ok) return;
          setSourceUri(uri);
          return warmToLocalCache(uri).then(() => {
            const fresh = getWarmedLocalUri(uri);
            if (fresh) setSourceUri(fresh);
          });
        })
        .catch(() => {});
      return;
    }

    if (!getLocalCachePath(uri)) {
      setSourceUri(uri);
      return;
    }

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
  // How far the keyboard overlaps the delete dialog's overlay (0 when it is not up, or when the window already resized).
  const deleteOverlayRef = React.useRef<View>(null);
  const deleteScrollRef = React.useRef<ScrollView>(null);
  const [keyboardOverlap, setKeyboardOverlap] = useState(0);
  useEffect(() => {
    if (!deleteVisible) {
      setKeyboardOverlap(0);
      return;
    }
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => {
      const keyboardTop = e.endCoordinates.screenY;
      deleteOverlayRef.current?.measureInWindow((_x, y, _w, h) => {
        setKeyboardOverlap(Math.max(0, Math.round(y + h - keyboardTop)));
        setTimeout(() => deleteScrollRef.current?.scrollToEnd({ animated: true }), 50);
      });
    });
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [deleteVisible]);
  const [deleteReason, setDeleteReason] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const [loadedImages, setLoadedImages] = useState<Record<number, { before: boolean; after: boolean }>>({});
  const [beforeLoaded, setBeforeLoaded] = useState(false);
  const [afterLoaded, setAfterLoaded] = useState(false);

  useEffect(() => {
    setCurrentIndex(initialIndex);
  }, [initialIndex, visible]);

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

  /**
   * ⚠️ The <Image> key is the RUN, never the url. A signed S3 url changes every time the
   * runs query refetches, and a changed key destroys and recreates the <Image> - throwing
   * away a load that was already in flight and showing the spinner again for the SAME
   * picture. The run identifies the picture; the url is just how we fetch it.
   */
  const runKey = String(currentRun?.runId || currentRun?._id || currentIndex);

  const renderColors = useMemo(() => {
    const run = currentRun;
    if (!run) return [] as RenderChip[];
    const lookSel = run.selections && typeof run.selections === 'object' ? run.selections : null;
    const lookName = lookSel?.lookName || run.lookName;
    if (typeof lookName === 'string' && lookName.trim()) {
      const lookColors = (Array.isArray(lookSel?.colors) ? lookSel.colors : run.colors) as unknown;
      const swatches = Array.isArray(lookColors)
        ? lookColors.filter((h): h is string => typeof h === 'string' && h.startsWith('#'))
        : [];
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

  const renderedOn = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(currentRun?.createdAt || ''));
    if (!m) return '';
    return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
  }, [currentRun]);

  useEffect(() => {
    const cached = loadedImages[currentIndex];
    setBeforeLoaded(!beforeImage || !!cached?.before);
    setAfterLoaded(!afterImage || !!cached?.after);
  }, [currentIndex, loadedImages, beforeImage, afterImage]);

  const isCurrentLoaded = beforeLoaded && afterLoaded;

  /**
   * ⚠️ A LOADER MUST ALWAYS HAVE AN EXIT. The overlay clears only from `onLoad` / `onReady`,
   * and both can fail to arrive - a cache file purged from `CacheDir` behind our back, a signed
   * url that expired, a decode that quietly failed. The rep was then left on a spinner with
   * nothing to do but close the modal. After this budget we show whatever did paint: a visible
   * picture, or at worst an empty frame the rep can page away from.
   */
  useEffect(() => {
    if (isCurrentLoaded) return;
    const t = setTimeout(() => {
      setBeforeLoaded(true);
      setAfterLoaded(true);
    }, IMAGE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [currentIndex, isCurrentLoaded]);

  const fadeOpacity = useSharedValue(0);

  const fadeAnimStyle = useAnimatedStyle(() => ({
    opacity: fadeOpacity.value,
  }));

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

  /**
   * ⚠️ THE RUN THE REP IS LOOKING AT JUMPS THE QUEUE (REVUIUX-586).
   *
   * Only three warms run at once, so the picture being opened could sit behind a screenful of
   * pictures queued earlier by the Tools list - the rep taps a thumbnail that is visibly
   * loaded and still waits. `priority` puts this run's two images at the FRONT of the waiting
   * line. Already-cached urls return immediately, so this costs nothing when the work is done.
   */
  useEffect(() => {
    if (!visible) return;
    if (beforeImage) warmToLocalCache(beforeImage, true).catch(() => {});
    if (afterImage) warmToLocalCache(afterImage, true).catch(() => {});
  }, [visible, beforeImage, afterImage]);

  // Neighbours at NORMAL priority: useful for paging, never ahead of the open render.
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

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
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

  const sliderX = useSharedValue(imageWidth / 2);
  const savedSliderX = useSharedValue(imageWidth / 2);

  useEffect(() => {
    sliderX.value = imageWidth / 2;
    savedSliderX.value = imageWidth / 2;
  }, [currentIndex, imageWidth, savedSliderX, sliderX]);

  const sliderPan = Gesture.Pan()
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
                    key={`after-${runKey}`}
                    uri={afterImage}
                    style={{
                      position: 'absolute',
                      width: imageWidth,
                      height: "100%",
                    }}
                    resizeMode="contain"
                    onReady={() => {
                      setAfterLoaded(true);
                      setLoadedImages((prev) => ({
                        ...prev,
                        [currentIndex]: { ...(prev[currentIndex] || { before: false, after: false }), after: true },
                      }));
                    }}
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
                      key={`before-${runKey}`}
                      uri={beforeImage}
                      style={{ width: imageWidth, height: "100%" }}
                      resizeMode="contain"
                      onReady={() => {
                        setBeforeLoaded(true);
                        setLoadedImages((prev) => ({
                          ...prev,
                          [currentIndex]: { ...(prev[currentIndex] || { before: false, after: false }), before: true },
                        }));
                      }}
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
          <Modal visible={deleteVisible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => setDeleteVisible(false)}>
            {/* ⚠️ A Modal is its own native window: `KeyboardAwareScrollView` / adjustResize do not reach it (the keyboard covered the
                buttons). So the keyboard's own rectangle is measured against this view and the overlap becomes bottom padding. */}
            <View ref={deleteOverlayRef} style={styles.deleteScroll} collapsable={false}>
            <ScrollView
              ref={deleteScrollRef}
              contentContainerStyle={[styles.deleteOverlay, { paddingBottom: 24 + keyboardOverlap }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
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
            </ScrollView>
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
  deleteScroll: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  deleteOverlay: {
    flexGrow: 1,
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
