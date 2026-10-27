import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  TextInput,
  StyleSheet,
  Dimensions,
  PanResponder,
  BackHandler,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import Geolocation from 'react-native-geolocation-service';
import { enqueueAnnotationJobs } from '../../services/annotationSaveService';
import { useRoute, useNavigation } from '@react-navigation/native';
import { IMAGE_CATEGORIES } from '../../constants/lead-center';
import { useAuth } from '../../hooks/useAuth';
import { logEvent } from '../../services/api/LoggerService';
import { logAnnotationClick } from '../../utils/activity-log/annotation-log';
import { isOnline } from '../../services/connectivity';
import { useWarmedImageUris } from '../../hooks/useWarmedImageUris';
import { FlashMessage } from '../../config/message';
import {
  buildMobileAnnotationData,
  countMarks,
  historySignature,
  type RestoredMarks,
} from '../../utils/annotation-restore';

import { AnnotationCanvas, type TwoFingerZoomApi } from '../../widgets/components/LeadCenter/AnnotationCanvas';
import { AnnotationTextToolbar } from '../../widgets/components/LeadCenter/AnnotationTextToolbar';
import { ConfirmDialog } from '../DynamicDealCenter/components/ConfirmDialog';
import {
  MIN_SHAPE_DRAG_PX,
  SHAPE_KINDS,
  applyShapeChange,
  hitShapeBody,
  hitShapeHandle,
  makeShape,
  moveShape,
  moveShapeHandle,
  pickShapeAt,
  shapeLengthPx,
  type AnnotationShape,
  type ShapeHandle,
  type ShapeKind,
} from '../../utils/annotation-shapes';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const MIN_POINT_DISTANCE_SQ = 2.25; // 1.5px
const SHAPE_COLORS = ['#FF7043', '#4CBB17', '#42A5F5', '#FFB74D', '#FFFFFF', '#000000'];
const SHAPE_SIZES = [3, 5, 8, 12];

interface SectionImage {
  uri: string;
  index: number;
  s3url?: string;
  id?: string;
  subcategory?: string;
  categoryName?: string;
  isOptimistic?: boolean;
  /** Re-edit: `_id` of the annotated copy being edited. Its upload is a PATCH that overwrites it in place. */
  existingAnnotationId?: string | null;
  /** `_id` of the clean ORIGINAL photo - stored with the annotation so a later re-edit can find its base. */
  salesPhotoId?: string | null;
  /** Re-edit: saved marks to put back on the canvas (only when `uri` is the clean original). */
  initialMarks?: ({ strokes: any[]; texts: any[]; shapes: any[] } & Partial<Pick<RestoredMarks, 'history' | 'redo'>>) | null;
  /** Re-edit: remote urls of the annotated copy whose cached bytes are stale once it is overwritten. */
  staleUris?: string[];
  /**
   * REVUIUX-569 discriminator. `undefined` means a sales PHOTO, so both existing callers are untouched. An order-sheet DOCUMENT
   * id is a different id space from `lead.salesPhotos` ids: it must never ride in `existingAnnotationId` / `salesPhotoId`
   * (that would PATCH the photo route and 404 - or hit an unrelated photo).
   */
  docKind?: 'salesPhoto' | 'orderSheet';
  /** Whatever `serverId` the row had - either backend collection's id is accepted. */
  orderSheetDocumentId?: string;
  orderSheetBaseName?: string;
  orderSheetMeta?: {
    contentKind: 'pdf' | 'image';
    mediaBox?: { width: number; height: number } | null;
    originalPath?: string | null;
    knownSizes?: number[];
  };
}

export default function ImageAnnotationScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { selectedPhotos = [], lead, onSaveSuccess, onCancel } = route.params || {};
  const isOrderSheetEdit = (selectedPhotos as SectionImage[])[0]?.docKind === 'orderSheet';
  const openedLoggedRef = useRef(false);

  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);
  const currentPhoto = selectedPhotos[activeImageIndex];
  const photoId = currentPhoto ? (currentPhoto.id || currentPhoto.uri) : '';

  const photoUris = useMemo(() => {
    const all = selectedPhotos.map((p: any) => p?.uri).filter(Boolean) as string[];
    const current = currentPhoto?.uri;
    return current ? [current, ...all.filter((u) => u !== current)] : all;
  }, [selectedPhotos, currentPhoto?.uri]);
  const warmedUris = useWarmedImageUris(photoUris);
  const displayUri = currentPhoto ? warmedUris[currentPhoto.uri] || currentPhoto.uri : '';
  const displayPhoto = useMemo(
    () => (currentPhoto ? { ...currentPhoto, uri: displayUri } : currentPhoto),
    [currentPhoto, displayUri],
  );
  const [activeTool, setActiveTool] = useState<'none' | 'zoom' | 'draw' | 'text' | 'shape'>('none');
  
  const [activeDrawTool, setActiveDrawTool] = useState<'pen' | 'eraser'>('pen');
  const [activeColor, setActiveColor] = useState<string>('#4CBB17'); // Green
  const [activeSize, setActiveSize] = useState<number>(5);
  const [showColorPanel, setShowColorPanel] = useState<boolean>(false);

  // Re-edit seeds the canvas with the marks saved on the annotated copy; `initialCount` is the "nothing changed yet"
  // baseline so opening a photo does not read as unsaved work.
  const seededMarks = useRef(
    (() => {
      const strokes: Record<string, any[]> = {};
      const texts: Record<string, any[]> = {};
      const shapes: Record<string, AnnotationShape[]> = {};
      const count: Record<string, number> = {};
      // Undo / redo steps saved with the marks: a re-edit can undo last week's steps. `sig` is the "nothing changed yet" baseline
      // for the undo stack (it is no longer empty on open).
      const history: Record<string, any[]> = {};
      const redo: Record<string, any[]> = {};
      const sig: Record<string, string> = {};
      (selectedPhotos as SectionImage[]).forEach((p) => {
        const m = p?.initialMarks;
        if (!m) return;
        const pid = p.id || p.uri;
        strokes[pid] = m.strokes || [];
        texts[pid] = m.texts || [];
        shapes[pid] = (m.shapes || []) as AnnotationShape[];
        count[pid] = countMarks(m);
        history[pid] = m.history || [];
        redo[pid] = m.redo || [];
        sig[pid] = historySignature(history[pid]);
      });
      return { strokes, texts, shapes, count, history, redo, sig };
    })(),
  ).current;

  const [strokesMap, setStrokesMap] = useState<Record<string, any[]>>(seededMarks.strokes);
  const [textsMap, setTextsMap] = useState<Record<string, any[]>>(seededMarks.texts);
  const [shapesMap, setShapesMap] = useState<Record<string, AnnotationShape[]>>(seededMarks.shapes);
  const [activeShapeKind, setActiveShapeKind] = useState<ShapeKind>('arrow');
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<string, any[]>>(seededMarks.history);
  const [redoMap, setRedoMap] = useState<Record<string, any[]>>(seededMarks.redo);

  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [containerLayout, setContainerLayout] = useState<{ width: number; height: number } | null>(null);
  const [pendingTextPos, setPendingTextPos] = useState<{ px: number; py: number } | null>(null);
  const [zoomScale, setZoomScale] = useState<number>(1);

  useEffect(() => {
    const userId = user?._id || user?.id;
    if (userId && selectedPhotos.length > 0 && !openedLoggedRef.current) {
      openedLoggedRef.current = true;
      logEvent('open', {
        user_id: userId,
        created_by: userId,
        module_type: 'annotated_photos',
        meta: {
          action: 'opened_annotation_dialog',
          leadId: lead?._id,
          mode: (selectedPhotos[0] as SectionImage)?.docKind === 'orderSheet' ? 'orderSheet' : (selectedPhotos[0] as SectionImage)?.existingAnnotationId ? 'reedit' : 'new',
          total_images: selectedPhotos.length,
          occurredAt: new Date().toISOString(),
        },
      });
    }
  }, [user, selectedPhotos.length]);

  useEffect(() => {
    if (displayUri) {
      Image.getSize(displayUri, (w, h) => {
        setImageSize({ width: w, height: h });
      }, (error) => {
        console.warn('Failed to get image size', error);
        setImageSize({ width: 4, height: 3 }); // fallback
      });
    }
  }, [displayUri]);

  useEffect(() => {
    const backAction = () => {
      handleBackPress();
      return true;
    };

    const backHandler = BackHandler.addEventListener(
      'hardwareBackPress',
      backAction
    );

    return () => backHandler.remove();
  }, [strokesMap, textsMap, shapesMap, historyMap, onCancel]);

  const canvasLayout = useMemo(() => {
    if (!containerLayout || !imageSize) {
      const w = SCREEN_WIDTH - 32;
      return { width: w, height: w * 0.75 };
    }
    const containerRatio = containerLayout.width / containerLayout.height;
    const imageRatio = imageSize.width / imageSize.height;

    if (imageRatio > containerRatio) {
      const w = containerLayout.width;
      const h = w / imageRatio;
      return { width: w, height: h };
    } else {
      const h = containerLayout.height;
      const w = h * imageRatio;
      return { width: w, height: h };
    }
  }, [containerLayout, imageSize]);

  const activeStrokeRef = useRef<any | null>(null);
  const startXRef = useRef<number>(0);
  const startYRef = useRef<number>(0);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);

  const liveStrokeListenerRef = useRef<((stroke: any) => void) | null>(null);
  const liveStrokeFrameRef = useRef<number | null>(null);

  const subscribeLiveStroke = useCallback((cb: (stroke: any) => void) => {
    liveStrokeListenerRef.current = cb;
    return () => {
      if (liveStrokeListenerRef.current === cb) liveStrokeListenerRef.current = null;
    };
  }, []);

  const emitLiveStroke = useCallback(() => {
    liveStrokeFrameRef.current = null;
    const stroke = activeStrokeRef.current;
    liveStrokeListenerRef.current?.(stroke ? { ...stroke } : null);
  }, []);

  const scheduleLiveStroke = useCallback(() => {
    if (liveStrokeFrameRef.current !== null) return;
    liveStrokeFrameRef.current = requestAnimationFrame(emitLiveStroke);
  }, [emitLiveStroke]);

  const cancelScheduledStroke = useCallback(() => {
    if (liveStrokeFrameRef.current !== null) {
      cancelAnimationFrame(liveStrokeFrameRef.current);
      liveStrokeFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelScheduledStroke, [cancelScheduledStroke]);

  // Shape being drawn / moved / resized. It lives in a ref and is pushed to the canvas once per frame, exactly like
  // the pen stroke, so a drag never re-renders this whole screen.
  const liveShapeListenerRef = useRef<((shape: AnnotationShape | null) => void) | null>(null);
  const liveShapeFrameRef = useRef<number | null>(null);
  const liveShapeRef = useRef<AnnotationShape | null>(null);
  const shapeGestureRef = useRef<{
    mode: 'new' | 'move' | 'resize';
    startX: number;
    startY: number;
    original: AnnotationShape | null;
    handle: ShapeHandle | null;
    moved: boolean;
  } | null>(null);

  const subscribeLiveShape = useCallback((cb: (shape: AnnotationShape | null) => void) => {
    liveShapeListenerRef.current = cb;
    return () => {
      if (liveShapeListenerRef.current === cb) liveShapeListenerRef.current = null;
    };
  }, []);

  const emitLiveShape = useCallback(() => {
    liveShapeFrameRef.current = null;
    liveShapeListenerRef.current?.(liveShapeRef.current ? { ...liveShapeRef.current } : null);
  }, []);

  const scheduleLiveShape = useCallback(() => {
    if (liveShapeFrameRef.current !== null) return;
    liveShapeFrameRef.current = requestAnimationFrame(emitLiveShape);
  }, [emitLiveShape]);

  const cancelScheduledShape = useCallback(() => {
    if (liveShapeFrameRef.current !== null) {
      cancelAnimationFrame(liveShapeFrameRef.current);
      liveShapeFrameRef.current = null;
    }
  }, []);

  useEffect(() => cancelScheduledShape, [cancelScheduledShape]);

  const backupStrokesRef = useRef<any[]>([]);
  const backupTextsRef = useRef<any[]>([]);
  const backupShapesRef = useRef<AnnotationShape[]>([]);
  const backupShapeHistoryRef = useRef<{ history: any[]; redo: any[] }>({ history: [], redo: [] });

  const [showTextDialog, setShowTextDialog] = useState<boolean>(false);
  const [textInputValue, setTextInputValue] = useState<string>('');
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null);
  const [showStylePanel, setShowStylePanel] = useState<boolean>(false);
  const [showFontDropdown, setShowFontDropdown] = useState<boolean>(false);

  useEffect(() => {
    setSelectedTextId(null);
    setSelectedShapeId(null);
    setShowStylePanel(false);
    setShowFontDropdown(false);
  }, [activeImageIndex]);

  const currentStrokes = strokesMap[photoId] || [];
  const currentTexts = textsMap[photoId] || [];
  const currentShapes = shapesMap[photoId] || [];

  const getSubcategoryLabel = (catNameOrId: string, subIdOrName: string) => {
    if (!subIdOrName) return '';
    const category = IMAGE_CATEGORIES.find(
      (c) => c.id === catNameOrId || c.name === catNameOrId
    );
    if (!category) return subIdOrName;
    const sub = category.subCategories?.find(
      (s) => s.id === subIdOrName || s.name === subIdOrName
    );
    if (sub) return sub.name;
    const group = category.cardGroups?.find(g => g.name === subIdOrName || g.id === subIdOrName);
    if (group) return group.name;
    return subIdOrName;
  };

  const getPathData = useCallback((points: { px: number; py: number }[]) => {
    if (points.length === 0) return '';
    const first = points[0];
    let d = `M ${first.px * canvasLayout.width} ${first.py * canvasLayout.height}`;
    if (points.length === 1) {
      d += ` L ${(first.px * canvasLayout.width) + 0.1} ${first.py * canvasLayout.height}`;
    } else {
      for (let i = 1; i < points.length; i++) {
        const pt = points[i];
        d += ` L ${pt.px * canvasLayout.width} ${pt.py * canvasLayout.height}`;
      }
    }
    return d;
  }, [canvasLayout]);

  const stateRef = useRef({
    activeTool,
    activeDrawTool,
    activeColor,
    activeSize,
    photoId,
    canvasLayout,
    zoomScale,
    activeShapeKind,
    currentShapes,
    selectedShapeId,
  });

  useEffect(() => {
    stateRef.current = {
      activeTool,
      activeDrawTool,
      activeColor,
      activeSize,
      photoId,
      canvasLayout,
      zoomScale,
      activeShapeKind,
      currentShapes,
      selectedShapeId,
    };
  });

  // One entry in the undo history for a shape being added (before null), changed, or removed (after null).
  const commitShapeChange = useCallback(
    (pid: string, before: AnnotationShape | null, after: AnnotationShape | null) => {
      const id = (after || before)!.id;
      setShapesMap((sm) => ({ ...sm, [pid]: applyShapeChange(sm[pid], id, after) }));
      setHistoryMap((hm) => ({
        ...hm,
        [pid]: [...(hm[pid] || []), { id, type: 'shape', before, after }],
      }));
      setRedoMap((rm) => ({ ...rm, [pid]: [] }));
    },
    []
  );

  // Set once a second finger lands: that is a pinch-zoom / two-finger pan (handled by the canvas's gesture handler),
  // so whatever the first finger had started - a stroke, a shape, a text tap - is thrown away, and nothing is
  // committed when the fingers lift.
  const multiTouchRef = useRef(false);
  const twoFingerZoomRef = useRef<TwoFingerZoomApi | null>(null);

  /**
   * REVUIUX-561: is the photo currently zoomed in?
   *
   * WARNING: compared with a tolerance, not `!== 1`. `zoomScale` is a float coming out of a
   * live pinch, so it settles on things like 1.0000001 and an exact comparison would leave the
   * button lit on a photo that looks untouched.
   */
  const isZoomed = zoomScale > 1.01;

  // Back to fit. The canvas owns the transform, so this just asks it; `onZoomChange` then
  // clears `isZoomed` and the button goes dark on its own.
  const resetZoom = useCallback(() => {
    twoFingerZoomRef.current?.reset();
  }, []);

  /**
   * The centred caption in a tool's footer ("BRUSH" / "SHAPES"), which turns into a reset
   * control while the photo is zoomed.
   *
   * WARNING: the main toolbar - and with it the Zoom button - is REPLACED while a tool is open,
   * so a rep who pinches mid-draw would otherwise have no way back to fit without leaving the
   * tool and losing their place. This reuses the caption's own slot, so it costs no layout.
   */
  const ToolFooterLabel = ({ title }: { title: string }) =>
    isZoomed ? (
      <TouchableOpacity
        onPress={resetZoom}
        accessibilityLabel="Reset zoom"
        className="flex-row items-center rounded-full bg-[#72BD00] px-3 py-1.5"
      >
        <Icon name="magnify-minus-outline" size={14} color="white" />
        <Text className="text-white font-extrabold text-[11px] uppercase tracking-widest ml-1.5">
          Reset Zoom
        </Text>
      </TouchableOpacity>
    ) : (
      <Text className="text-white font-extrabold text-sm uppercase tracking-widest">{title}</Text>
    );
  const abortForMultiTouch = () => {
    multiTouchRef.current = true;
    activeStrokeRef.current = null;
    lastPointRef.current = null;
    cancelScheduledStroke();
    emitLiveStroke();
    shapeGestureRef.current = null;
    liveShapeRef.current = null;
    cancelScheduledShape();
    emitLiveShape();
  };

  // Wraps the whole photo area (the photo AND the dark margin around it). It never claims a one-finger touch, but takes
  // over as soon as a second finger moves - from the drawing overlay or a text note if they already hold the touch -
  // so two-finger pinch / pan zooms wherever the fingers are and in every tool, including none.
  const zoomResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponderCapture: (evt) => evt.nativeEvent.touches.length > 1,
      onPanResponderGrant: (evt) => twoFingerZoomRef.current?.touches(evt.nativeEvent.touches),
      onPanResponderMove: (evt) => twoFingerZoomRef.current?.touches(evt.nativeEvent.touches),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: () => twoFingerZoomRef.current?.release(),
      onPanResponderTerminate: () => twoFingerZoomRef.current?.release(),
    })
  ).current;

  const panResponder = useRef(
    PanResponder.create({
      onPanResponderStart: (evt) => {
        if (evt.nativeEvent.touches.length > 1) {
          abortForMultiTouch();
          twoFingerZoomRef.current?.touches(evt.nativeEvent.touches);
        }
      },
      // The system took the touch: same as a second finger, and any pinch in flight ends.
      onPanResponderTerminate: () => {
        abortForMultiTouch();
        twoFingerZoomRef.current?.release();
      },
      onStartShouldSetPanResponder: () => {
        const { activeTool } = stateRef.current;
        return activeTool === 'draw' || activeTool === 'text' || activeTool === 'shape';
      },
      onMoveShouldSetPanResponder: () => {
        const { activeTool } = stateRef.current;
        return activeTool === 'draw' || activeTool === 'shape';
      },
      onPanResponderGrant: (evt, gestureState) => {
        multiTouchRef.current = evt.nativeEvent.touches.length > 1;
        if (multiTouchRef.current) return;
        const { activeTool, activeDrawTool, activeColor, activeSize, photoId, canvasLayout } = stateRef.current;
        if (activeTool === 'draw') {
          if (!photoId) return;
          const { locationX, locationY } = evt.nativeEvent;
          startXRef.current = locationX;
          startYRef.current = locationY;
          const px = locationX / canvasLayout.width;
          const py = locationY / canvasLayout.height;
          const newStroke = {
            id: Date.now(),
            points: [{ px, py }],
            color: activeDrawTool === 'eraser' ? 'transparent' : activeColor,
            width: activeSize,
            isEraser: activeDrawTool === 'eraser',
          };
          activeStrokeRef.current = newStroke;
          lastPointRef.current = { x: locationX, y: locationY };
          cancelScheduledStroke();
          emitLiveStroke();
        } else if (activeTool === 'shape') {
          if (!photoId) return;
          const { locationX, locationY } = evt.nativeEvent;
          const { currentShapes, selectedShapeId, activeShapeKind, zoomScale } = stateRef.current;
          const scale = zoomScale > 0 ? zoomScale : 1;
          const px = locationX / canvasLayout.width;
          const py = locationY / canvasLayout.height;
          // A touch on the SELECTED shape's handle resizes it, on its outline moves it; anywhere else draws a new one.
          // Tolerances are in screen px, so they are divided by the zoom to stay a finger-sized target.
          const selected = currentShapes.find((sh) => sh.id === selectedShapeId) || null;
          let gesture: NonNullable<typeof shapeGestureRef.current> = {
            mode: 'new', startX: locationX, startY: locationY, original: null, handle: null, moved: false,
          };
          if (selected) {
            const handle = hitShapeHandle(selected, locationX, locationY, canvasLayout.width, canvasLayout.height, 24 / scale);
            if (handle) {
              gesture = { ...gesture, mode: 'resize', original: selected, handle };
            } else if (hitShapeBody(selected, locationX, locationY, canvasLayout.width, canvasLayout.height, 20 / scale)) {
              gesture = { ...gesture, mode: 'move', original: selected };
            }
          }
          shapeGestureRef.current = gesture;
          liveShapeRef.current =
            gesture.mode === 'new'
              ? makeShape(activeShapeKind, `shape-${Date.now()}`, { px, py }, { px, py }, activeColor, activeSize)
              : selected;
          lastPointRef.current = { x: locationX, y: locationY };
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        const touches = evt.nativeEvent.touches;
        if (touches.length > 1) {
          if (!multiTouchRef.current) abortForMultiTouch();
          twoFingerZoomRef.current?.touches(touches); // two fingers = pinch-zoom + pan, in every tool
          return;
        }
        // Back to one finger after a pinch: end the pinch, but draw nothing until every finger has lifted.
        twoFingerZoomRef.current?.touches(touches);
        if (multiTouchRef.current) return;
        const { activeTool, canvasLayout, zoomScale } = stateRef.current;
        if (activeTool === 'draw' && activeStrokeRef.current) {
          const scale = zoomScale > 0 ? zoomScale : 1;
          const curX = startXRef.current + gestureState.dx / scale;
          const curY = startYRef.current + gestureState.dy / scale;
          const last = lastPointRef.current;
          if (last) {
            const dx = curX - last.x;
            const dy = curY - last.y;
            if (dx * dx + dy * dy < MIN_POINT_DISTANCE_SQ) return;
          }
          lastPointRef.current = { x: curX, y: curY };

          const px = Math.max(0, Math.min(1, curX / canvasLayout.width));
          const py = Math.max(0, Math.min(1, curY / canvasLayout.height));
          activeStrokeRef.current.points.push({ px, py });
          scheduleLiveStroke();
        } else if (activeTool === 'shape' && shapeGestureRef.current && liveShapeRef.current) {
          const gesture = shapeGestureRef.current;
          const scale = zoomScale > 0 ? zoomScale : 1;
          const dx = gestureState.dx / scale;
          const dy = gestureState.dy / scale;
          if (!gesture.moved && Math.hypot(dx, dy) < 3) return; // finger jitter on a tap
          gesture.moved = true;
          const curPx = (gesture.startX + dx) / canvasLayout.width;
          const curPy = (gesture.startY + dy) / canvasLayout.height;
          const base = gesture.original;
          if (gesture.mode === 'new') {
            liveShapeRef.current = { ...liveShapeRef.current, p2: { px: Math.max(0, Math.min(1, curPx)), py: Math.max(0, Math.min(1, curPy)) } };
          } else if (gesture.mode === 'move' && base) {
            liveShapeRef.current = moveShape(base, dx / canvasLayout.width, dy / canvasLayout.height);
          } else if (gesture.mode === 'resize' && base && gesture.handle) {
            liveShapeRef.current = moveShapeHandle(base, gesture.handle, { px: curPx, py: curPy });
          }
          scheduleLiveShape();
        }
      },
      onPanResponderRelease: (evt, gestureState) => {
        twoFingerZoomRef.current?.release();
        if (multiTouchRef.current) {
          multiTouchRef.current = false;
          return;
        }
        const { activeTool, photoId, canvasLayout } = stateRef.current;
        if (activeTool === 'draw') {
          cancelScheduledStroke();
          const pending = activeStrokeRef.current;
          const finishedStroke = pending ? { ...pending, points: pending.points.slice() } : null;
          if (finishedStroke) {
            setStrokesMap((sm) => {
              const existing = sm[photoId] || [];
              return { ...sm, [photoId]: [...existing, finishedStroke] };
            });
            setHistoryMap((hm) => {
              const existing = hm[photoId] || [];
              const actionItem = { id: finishedStroke.id, type: 'stroke', data: finishedStroke };
              return { ...hm, [photoId]: [...existing, actionItem] };
            });
            setRedoMap((rm) => ({ ...rm, [photoId]: [] }));
          }
          activeStrokeRef.current = null;
          lastPointRef.current = null;
          emitLiveStroke();
        } else if (activeTool === 'shape') {
          cancelScheduledShape();
          const gesture = shapeGestureRef.current;
          const live = liveShapeRef.current;
          shapeGestureRef.current = null;
          liveShapeRef.current = null;
          lastPointRef.current = null;
          if (gesture && live && photoId) {
            const { currentShapes } = stateRef.current;
            const length = gesture.mode === 'new' ? shapeLengthPx(live, canvasLayout.width, canvasLayout.height) : 0;
            const isTap = !gesture.moved || (gesture.mode === 'new' && length < MIN_SHAPE_DRAG_PX);
            if (isTap) {
              // A tap selects the shape under the finger (or clears the selection) - it never leaves a zero-size shape.
              const { zoomScale } = stateRef.current;
              const hit = pickShapeAt(currentShapes, gesture.startX, gesture.startY, canvasLayout.width, canvasLayout.height, 20 / (zoomScale > 0 ? zoomScale : 1));
              setSelectedShapeId(hit ? hit.id : gesture.mode === 'new' ? null : live.id);
            } else if (gesture.mode === 'new') {
              commitShapeChange(photoId, null, live);
              setSelectedShapeId(live.id);
            } else {
              commitShapeChange(photoId, gesture.original, live);
              setSelectedShapeId(live.id);
            }
          }
          emitLiveShape();
        } else if (activeTool === 'text') {
          const { locationX, locationY } = evt.nativeEvent;
          const px = locationX / canvasLayout.width;
          const py = locationY / canvasLayout.height;
          // A tap on the canvas closes the previous note's menu / style panel AND starts a new note here - the menu used to
          // stay open over the image and get in the way of the new text.
          setSelectedTextId(null);
          setShowStylePanel(false);
          setShowFontDropdown(false);
          setEditingTextId(null);
          setTextInputValue('');
          setPendingTextPos({ px, py });
          setShowTextDialog(true);
        }
      },
    })
  ).current;

  // One place that builds the context every annotation CLICK log shares (REVUIUX-571 - see utils/activity-log/annotation-log.ts).
  const logClick = (action: 'undo' | 'redo' | 'reset' | 'discard', extra: Record<string, any> = {}) => {
    const userId = user?._id || user?.id;
    const photo = (currentPhoto || {}) as SectionImage;
    logAnnotationClick({
      userId,
      leadId: lead?._id,
      action,
      mode: photo.docKind === 'orderSheet' ? 'orderSheet' : photo.existingAnnotationId ? 'reedit' : 'new',
      category: photo.categoryName || (photo as any).category || null,
      subcategory: photo.subcategory || null,
      photoId: photo.existingAnnotationId || photo.id || null,
      offline: !isOnline(),
      ...extra,
    });
  };

  const handleUndo = () => {
    const history = historyMap[photoId] || [];
    if (history.length === 0) return;

    const action = history[history.length - 1];
    setHistoryMap((hm) => ({ ...hm, [photoId]: history.slice(0, -1) }));
    logClick('undo', { stepType: action.type, undoLeft: history.length - 1, redoLeft: (redoMap[photoId] || []).length + 1 });

    setRedoMap((rm) => {
      const existing = rm[photoId] || [];
      return { ...rm, [photoId]: [...existing, action] };
    });

    if (action.type === 'stroke') {
      setStrokesMap((sm) => {
        const existing = sm[photoId] || [];
        return { ...sm, [photoId]: existing.filter((s) => s.id !== action.id) };
      });
    } else if (action.type === 'text') {
      setTextsMap((tm) => {
        const existing = tm[photoId] || [];
        return { ...tm, [photoId]: existing.filter((t) => t.id !== action.id) };
      });
    } else if (action.type === 'shape') {
      setShapesMap((sm) => ({ ...sm, [photoId]: applyShapeChange(sm[photoId], action.id, action.before) }));
      if (!action.before) setSelectedShapeId((cur) => (cur === action.id ? null : cur));
    }
  };

  const handleRedo = () => {
    const redo = redoMap[photoId] || [];
    if (redo.length === 0) return;

    const action = redo[redo.length - 1];
    setRedoMap((rm) => ({ ...rm, [photoId]: redo.slice(0, -1) }));
    logClick('redo', { stepType: action.type, undoLeft: (historyMap[photoId] || []).length + 1, redoLeft: redo.length - 1 });

    setHistoryMap((hm) => {
      const existing = hm[photoId] || [];
      return { ...hm, [photoId]: [...existing, action] };
    });

    if (action.type === 'stroke') {
      setStrokesMap((sm) => {
        const existing = sm[photoId] || [];
        return { ...sm, [photoId]: [...existing, action.data] };
      });
    } else if (action.type === 'text') {
      setTextsMap((tm) => {
        const existing = tm[photoId] || [];
        return { ...tm, [photoId]: [...existing, action.data] };
      });
    } else if (action.type === 'shape') {
      setShapesMap((sm) => ({ ...sm, [photoId]: applyShapeChange(sm[photoId], action.id, action.after) }));
      if (!action.after) setSelectedShapeId((cur) => (cur === action.id ? null : cur));
    }
  };

  // Reset: strip EVERY annotation off this photo - the ones saved earlier included - so it is back to the original picture. A re-edit
  // opens its saved marks over the CLEAN original, so removing them all and tapping Save writes the clean photo back (an empty
  // annotation is a valid save: `isEditedPhoto` sees the mark count differ from what the screen opened with). Back / Discard instead
  // leaves what was saved untouched. The undo / redo stacks go too: their steps point at marks that no longer exist.
  const handleResetCanvas = () => {
    logClick('reset', {
      marksRemoved: countMarks(marksFor(photoId)),
      includedSavedMarks: (seededMarks.count[photoId] || 0) > 0,
    });
    setStrokesMap((sm) => ({ ...sm, [photoId]: [] }));
    setTextsMap((tm) => ({ ...tm, [photoId]: [] }));
    setShapesMap((sm) => ({ ...sm, [photoId]: [] }));
    setSelectedShapeId(null);
    setHistoryMap((hm) => ({ ...hm, [photoId]: [] }));
    setRedoMap((rm) => ({ ...rm, [photoId]: [] }));
    // Close anything tied to a note that is gone, and bring the photo back to its normal fit position.
    setSelectedTextId(null);
    setShowStylePanel(false);
    setShowFontDropdown(false);
    resetZoom();
  };

  // The reset button ALWAYS asks first, with the app's own ConfirmDialog (a native Alert ignores the theme).
  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const confirmResetCanvas = () => setShowResetConfirm(true);

  const updateSelectedText = (properties: Partial<any>) => {
    if (!selectedTextId) return;
    setTextsMap((tm) => {
      const existing = tm[photoId] || [];
      const updated = existing.map((t) =>
        t.id === selectedTextId ? { ...t, ...properties } : t
      );
      return { ...tm, [photoId]: updated };
    });
  };

  const handleDeleteTextNote = (id: string) => {
    setTextsMap((tm) => {
      const existing = tm[photoId] || [];
      return { ...tm, [photoId]: existing.filter((t) => t.id !== id) };
    });
    setHistoryMap((hm) => {
      const existing = hm[photoId] || [];
      return { ...hm, [photoId]: existing.filter((a) => a.id !== id) };
    });
  };

  const handleAddTextPress = () => {
    setEditingTextId(null);
    setTextInputValue('');
    setShowTextDialog(true);
  };

  const handleTextSubmit = () => {
    if (!textInputValue.trim()) return;

    if (editingTextId) {
      setTextsMap((tm) => {
        const existing = tm[photoId] || [];
        const updated = existing.map((t) =>
          t.id === editingTextId ? { ...t, text: textInputValue } : t
        );
        return { ...tm, [photoId]: updated };
      });
    } else {
      const newText = {
        id: `text-${Date.now()}`,
        text: textInputValue,
        px: pendingTextPos ? pendingTextPos.px : 0.35,
        py: pendingTextPos ? pendingTextPos.py : 0.45,
        color: activeColor || '#42A5F5',
        fontSize: 24,
        opacity: 1.0,
        fontStyle: 'regular',
      };
      setTextsMap((tm) => {
        const existing = tm[photoId] || [];
        return { ...tm, [photoId]: [...existing, newText] };
      });
      setHistoryMap((hm) => {
        const existing = hm[photoId] || [];
        const actionItem = { id: newText.id, type: 'text', data: newText };
        return { ...hm, [photoId]: [...existing, actionItem] };
      });
      setRedoMap((rm) => ({ ...rm, [photoId]: [] }));
    }
    setShowTextDialog(false);
    setEditingTextId(null);
    setTextInputValue('');
    setPendingTextPos(null);
  };

  const handleTextPress = (text: any) => {
    setEditingTextId(text.id);
    setTextInputValue(text.text);
    setShowTextDialog(true);
  };

  const handleMoveText = (id: string, newPx: number, newPy: number) => {
    setTextsMap((tm) => {
      const existing = tm[photoId] || [];
      const updated = existing.map((t) =>
        t.id === id ? { ...t, px: Math.max(0, Math.min(1, newPx)), py: Math.max(0, Math.min(1, newPy)) } : t
      );
      return { ...tm, [photoId]: updated };
    });
  };

  const enterDrawMode = () => {
    backupStrokesRef.current = [...currentStrokes];
    backupShapeHistoryRef.current = { history: [...(historyMap[photoId] || [])], redo: [...(redoMap[photoId] || [])] };
    setActiveTool('draw');
  };

  const commitDrawMode = () => {
    setActiveTool('none');
  };

  const cancelDrawMode = () => {
    setStrokesMap((sm) => ({ ...sm, [photoId]: backupStrokesRef.current }));
    // The strokes drawn since Draw was entered are gone, so their undo steps must go with them (a saved step pointing at a stroke
    // that no longer exists would make Undo do nothing).
    const { history, redo } = backupShapeHistoryRef.current;
    setHistoryMap((hm) => ({ ...hm, [photoId]: history }));
    setRedoMap((rm) => ({ ...rm, [photoId]: redo }));
    setActiveTool('none');
  };

  const enterShapeMode = () => {
    backupShapesRef.current = [...currentShapes];
    backupShapeHistoryRef.current = { history: [...(historyMap[photoId] || [])], redo: [...(redoMap[photoId] || [])] };
    setSelectedShapeId(null);
    setActiveTool('shape');
  };

  const commitShapeMode = () => {
    setSelectedShapeId(null);
    setActiveTool('none');
  };

  // Cancel throws away every shape change made since the mode was entered - including its undo history, so Undo
  // afterwards never points at a shape that is no longer there.
  const cancelShapeMode = () => {
    const { history, redo } = backupShapeHistoryRef.current;
    setShapesMap((sm) => ({ ...sm, [photoId]: backupShapesRef.current }));
    setHistoryMap((hm) => ({ ...hm, [photoId]: history }));
    setRedoMap((rm) => ({ ...rm, [photoId]: redo }));
    setSelectedShapeId(null);
    setActiveTool('none');
  };

  const selectedShape = currentShapes.find((sh) => sh.id === selectedShapeId) || null;

  // Colour / size / kind buttons always set the defaults for the NEXT shape, and also restyle the selected one.
  const restyleSelectedShape = (patch: Partial<Pick<AnnotationShape, 'color' | 'width'>>) => {
    if (!selectedShape) return;
    const next = { ...selectedShape, ...patch };
    if (next.color === selectedShape.color && next.width === selectedShape.width) return;
    commitShapeChange(photoId, selectedShape, next);
  };

  const pickShapeColor = (color: string) => {
    setActiveColor(color);
    restyleSelectedShape({ color });
  };

  const pickShapeSize = (size: number) => {
    setActiveSize(size);
    restyleSelectedShape({ width: size });
  };

  const deleteSelectedShape = () => {
    if (!selectedShape) return;
    commitShapeChange(photoId, selectedShape, null);
    setSelectedShapeId(null);
  };

  const enterTextMode = () => {
    backupTextsRef.current = [...currentTexts];
    setActiveTool('text');
  };

  const commitTextMode = () => {
    // The tick locks every note: close the menu / style panel too, so nothing is left in a state where a note could move.
    setSelectedTextId(null);
    setShowStylePanel(false);
    setShowFontDropdown(false);
    setActiveTool('none');
  };

  const cancelTextMode = () => {
    setTextsMap((tm) => ({ ...tm, [photoId]: backupTextsRef.current }));
    setActiveTool('none');
  };

  // Brief guard against a double tap while the job is written (milliseconds). There is deliberately NO loader: Save
  // writes a job to disk and closes; flattening and uploading happen in the background (annotationSaveService).
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const savingRef = useRef(false);

  // Fetched while the rep edits, so Save never waits on a GPS fix.
  const locationRef = useRef<Promise<{ latitude: number; longitude: number }> | null>(null);

  const requestCoords = (): Promise<{ latitude: number; longitude: number }> =>
    new Promise((resolve) => {
      Geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }),
        (error) => {
          console.warn('Could not get location for annotated photos', error);
          resolve({ latitude: 0, longitude: 0 });
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 300000 },
      );
    });

  useEffect(() => {
    locationRef.current = requestCoords();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const marksFor = (pId: string) => ({
    strokes: strokesMap[pId] || [],
    texts: textsMap[pId] || [],
    shapes: shapesMap[pId] || [],
  });

  // True when the rep changed this photo since it opened (a re-edit's restored marks do not count).
  const stacksFor = (pId: string) => ({ history: historyMap[pId] || [], redo: redoMap[pId] || [] });

  // The undo stack is compared with what it opened with, not with empty: a re-edit opens with last week's steps in it.
  const hasChangedSinceOpen = (pId: string) =>
    countMarks(marksFor(pId)) !== (seededMarks.count[pId] || 0) ||
    historySignature(historyMap[pId]) !== (seededMarks.sig[pId] || '');
  const isEditedPhoto = hasChangedSinceOpen;

  // REVUIUX-569: an ORDER SHEET is replaced in place, never added. Same durable job queue as the photos (mode `orderSheet`): Save
  // writes the job and closes; flattening, the PDF wrap and the PATCH happen in the background - offline included.
  const saveOrderSheetJob = async (photo: SectionImage) => {
    if (savingRef.current) return;
    const pId = photo.id || photo.uri;
    if (!isEditedPhoto(pId) || !photo.orderSheetDocumentId) {
      onCancel?.();
      navigation.goBack();
      return;
    }
    savingRef.current = true;
    setIsSaving(true);
    try {
      const marks = marksFor(pId);
      const meta = photo.orderSheetMeta;
      await enqueueAnnotationJobs([
        {
          leadId: lead._id,
          originalUri: warmedUris[photo.uri] || photo.uri,
          layoutWidth: canvasLayout.width,
          layoutHeight: canvasLayout.height,
          strokes: marks.strokes,
          texts: marks.texts,
          shapes: marks.shapes,
          categoryName: 'Order Sheet',
          subcategory: 'Order Sheet (Annotated)',
          annotation: {
            mode: 'orderSheet' as const,
            annotationData: buildMobileAnnotationData(marks, null, stacksFor(pId)),
            orderSheetDocumentId: photo.orderSheetDocumentId,
            baseName: photo.orderSheetBaseName,
            contentKind: meta?.contentKind || 'pdf',
            mediaBox: meta?.mediaBox || null,
            staleUris: photo.staleUris || [],
            originalPath: meta?.originalPath || null,
            knownSizes: meta?.knownSizes || [],
          },
        },
      ]);
    } catch (e) {
      console.error('Could not save the order-sheet annotation:', e);
      savingRef.current = false;
      setIsSaving(false);
      FlashMessage.error('Not saved', 'Could not save your annotations. Please try again.');
      return;
    }
    onSaveSuccess?.();
    navigation.goBack();
  };

  const handleSaveAll = async () => {
    const orderSheetPhoto = (selectedPhotos as SectionImage[]).find((p) => p.docKind === 'orderSheet');
    if (orderSheetPhoto) {
      await saveOrderSheetJob(orderSheetPhoto);
      return;
    }
    if (savingRef.current) return;

    const photosToProcess = selectedPhotos.filter((photo: any) => {
      const pId = photo.id || photo.uri;
      // A re-edit is saved whenever it was touched, even if every mark was removed (that restores the clean photo).
      if (photo.existingAnnotationId) return isEditedPhoto(pId);
      return countMarks(marksFor(pId)) > 0;
    });

    if (photosToProcess.length === 0) {
      onCancel?.();
      navigation.goBack();
      return;
    }

    savingRef.current = true;
    setIsSaving(true);

    try {
      // A cached fix is near-instant; never hold the rep for a slow one.
      const coords = await Promise.race([
        locationRef.current || requestCoords(),
        new Promise<{ latitude: number; longitude: number }>((resolve) =>
          setTimeout(() => resolve({ latitude: 0, longitude: 0 }), 400),
        ),
      ]);

      const jobs = photosToProcess.map((photo: SectionImage) => {
        const pId = photo.id || photo.uri;
        const marks = marksFor(pId);
        const category = photo.categoryName || (photo as any).category || '';
        const baseSub = String(photo.subcategory || '').replace(/\s*\(Annotated\)\s*$/i, '').trim();
        const annotationData = buildMobileAnnotationData(marks, photo.salesPhotoId, stacksFor(pId));
        return {
          leadId: lead._id,
          // The local copy the screen already warmed, so the job needs no download.
          originalUri: warmedUris[photo.uri] || photo.uri,
          layoutWidth: canvasLayout.width,
          layoutHeight: canvasLayout.height,
          strokes: marks.strokes,
          texts: marks.texts,
          shapes: marks.shapes,
          categoryName: category,
          subcategory: `${baseSub} (Annotated)`,
          coordinates: coords,
          annotation: photo.existingAnnotationId
            ? {
                mode: 'reedit' as const,
                annotationData,
                salesPhotoId: photo.salesPhotoId,
                existingAnnotationId: photo.existingAnnotationId,
                existingS3url: photo.s3url,
                staleUris: photo.staleUris || [],
              }
            : {
                mode: 'new' as const,
                annotationData,
                salesPhotoId: photo.salesPhotoId,
              },
        };
      });

      await enqueueAnnotationJobs(jobs);
    } catch (e) {
      console.error('Could not save the annotations:', e);
      savingRef.current = false;
      setIsSaving(false);
      FlashMessage.error('Not saved', 'Could not save your annotations. Please try again.');
      return;
    }

    const userId = user?._id || user?.id;
    if (userId) {
      logEvent('save', {
        user_id: userId,
        created_by: userId,
        module_type: 'annotated_photos',
        meta: {
          action: 'saved_annotated_images',
          leadId: lead?._id,
          image_count: photosToProcess.length,
          occurredAt: new Date().toISOString(),
        },
      });
    }
    onSaveSuccess?.();
    navigation.goBack();
  };

  // The app's own ConfirmDialog (a native Alert ignores the theme); the dialog itself is rendered at the bottom of the screen.
  const [showDiscardConfirm, setShowDiscardConfirm] = useState<boolean>(false);

  const handleBackPress = () => {
    const hasUnsavedChanges = (selectedPhotos as SectionImage[]).some((p) => {
      const pid = p.id || p.uri;
      return hasChangedSinceOpen(pid);
    });
    if (hasUnsavedChanges) {
      setShowDiscardConfirm(true);
    } else {
      onCancel?.();
      navigation.goBack();
    }
  };

  const selectedText = currentTexts.find(t => t.id === selectedTextId);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView className="flex-1" style={{ backgroundColor: '#090e0c' }}>
        {/* Header: a three-slot row - back button, title, Save / Save All / Saving... button. The title slot is the
            only one that flexes, so it takes all the leftover space and centres its own text between the two
            buttons. (With `justify-between` the title sat wherever the leftover space put it.)
            WARNING: the side slots must NOT be given `flex`. `flex: 1` is shorthand for
            `flexGrow:1, flexShrink:1, flexBasis:0`, which clamped the right slot to about a quarter of the screen -
            less than "Save All" needs - so the label first wrapped to two lines (overflowing the h-10 pill) and then,
            once pinned to one line, truncated to "Save...". Adding `flexBasis:'auto'` next to `flex: 1` does NOT help:
            the `flex` shorthand overwrites the longhands in the same style object whatever the key order. So the side
            slots take `flexGrow: 0, flexShrink: 0` (natural width, never clipped) and ONLY the title flexes and
            shrinks. Button padding is `px-4`, not `px-6`, to leave the title more room. */}
        <View className="flex-row items-center px-4 pt-2 pb-4 bg-[#090e0c]">
          <View style={{ flexGrow: 0, flexShrink: 0, alignItems: 'flex-start', justifyContent: 'center' }}>
            <TouchableOpacity
              onPress={handleBackPress}
              accessibilityLabel="Back"
              className="w-10 h-10 rounded-full bg-white/10 items-center justify-center"
            >
              <Icon name="chevron-left" size={24} color="white" />
            </TouchableOpacity>
          </View>

          <View style={{ flexGrow: 1, flexShrink: 1, minWidth: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
            <Text numberOfLines={1} className="text-white/60 font-bold text-sm" style={{ textAlign: 'center' }}>
              {isOrderSheetEdit ? 'Annotate Order Sheet' : `Annotate (${activeImageIndex + 1}/${selectedPhotos.length})`}
            </Text>
          </View>

          <View style={{ flexGrow: 0, flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center' }}>
            <TouchableOpacity
              onPress={handleSaveAll}
              disabled={isSaving}
              className="px-4 h-10 rounded-full bg-[#72BD00] items-center justify-center"
              style={{ opacity: isSaving ? 0.7 : 1 }}
            >
              {/* Single line, always: the pill is a fixed h-10, so a wrapped label overflows it. */}
              <Text numberOfLines={1} className="text-white font-extrabold text-sm">
                {isSaving ? 'Saving\u2026' : isOrderSheetEdit ? 'Save' : 'Save All'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {selectedPhotos.length > 0 && currentPhoto && (
          <View className="flex-1 flex-col justify-between" {...zoomResponder.panHandlers}>
            {/* Space Given to it Container */}
            <View
              onLayout={(e) => {
                const { width, height } = e.nativeEvent.layout;
                if (width > 0 && height > 0) {
                  setContainerLayout({ width, height });
                }
              }}
              className="flex-1 items-center justify-center p-4 w-full"
            >
              <AnnotationCanvas
                canvasLayout={canvasLayout}
                activeTool={activeTool}
                currentPhoto={displayPhoto}
                activeImageIndex={activeImageIndex}
                currentStrokes={currentStrokes}
                subscribeActiveStroke={subscribeLiveStroke}
                currentTexts={currentTexts}
                currentShapes={currentShapes}
                subscribeActiveShape={subscribeLiveShape}
                selectedShapeId={selectedShapeId}
                getPathData={getPathData}
                selectedTextId={selectedTextId}
                setSelectedTextId={setSelectedTextId}
                panResponder={panResponder}
                handleTextPress={handleTextPress}
                setShowStylePanel={setShowStylePanel}
                handleDeleteTextNote={handleDeleteTextNote}
                handleMoveText={handleMoveText}
                textMoveMode={activeTool === 'text' ? 'all' : showStylePanel ? 'selected' : 'none'}
                onZoomChange={setZoomScale}
                twoFingerZoomRef={twoFingerZoomRef}
              />
            </View>

            {/* Subcategory Label Pill */}
            <View className="items-center my-2">
              <View className="bg-[#72BD00] px-5 py-2 rounded-full">
                <Text className="text-white font-extrabold text-xs">
                  {getSubcategoryLabel(currentPhoto.categoryName || currentPhoto.category || '', currentPhoto.subcategory || '') || 'Photo'}
                </Text>
              </View>
            </View>

            {/* Tool Toolbar */}
            {(activeTool === 'none' || activeTool === 'zoom') && !showStylePanel ? (
              <View className="bg-[#0b0e0c] border-t border-white/10 px-4 py-4 pb-8 flex-row items-center justify-between">
                <View className="flex-row gap-1.5">
                  {/* REVUIUX-561. Two-finger pinch works in EVERY tool, so the photo can be zoomed
                      without this button ever being pressed - and then there was nothing on screen
                      saying so, and no obvious way back to fit. The button now REPORTS zoom as well
                      as selecting the tool: lit whenever the photo is zoomed (`isZoomed`), and while
                      lit a tap resets to fit instead of re-selecting the tool. */}
                  <TouchableOpacity
                    onPress={() => (isZoomed ? resetZoom() : setActiveTool('zoom'))}
                    accessibilityLabel={isZoomed ? 'Reset zoom' : 'Zoom'}
                    className={`w-12 h-14 rounded-xl items-center justify-center ${
                      isZoomed || activeTool === 'zoom' ? 'bg-[#72BD00]' : 'bg-white/10'
                    }`}
                  >
                    <Icon name={isZoomed ? 'magnify-minus-outline' : 'magnify'} size={20} color="white" />
                    <Text className="text-white text-[10px] font-bold mt-1">
                      {isZoomed ? 'Reset' : 'Zoom'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={enterDrawMode}
                    className="w-12 h-14 rounded-xl items-center justify-center bg-white/10"
                  >
                    <Icon name="pencil" size={20} color="white" />
                    <Text className="text-white text-[10px] font-bold mt-1">Draw</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={enterTextMode}
                    className="w-12 h-14 rounded-xl items-center justify-center bg-white/10"
                  >
                    <Icon name="format-text" size={20} color="white" />
                    <Text className="text-white text-[10px] font-bold mt-1">Text</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={enterShapeMode}
                    className="w-12 h-14 rounded-xl items-center justify-center bg-white/10"
                  >
                    <Icon name="shape-outline" size={20} color="white" />
                    <Text className="text-white text-[10px] font-bold mt-1">Shapes</Text>
                  </TouchableOpacity>
                </View>

                {/* Undo, Redo, Reset */}
                <View className="flex-row gap-1.5">
                  <TouchableOpacity
                    onPress={handleUndo}
                    disabled={!(historyMap[photoId]?.length > 0)}
                    className="w-10 h-10 rounded-xl items-center justify-center bg-white/10"
                    style={{ opacity: (historyMap[photoId]?.length > 0) ? 1 : 0.35 }}
                  >
                    <Icon name="undo" size={20} color="white" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={handleRedo}
                    disabled={!(redoMap[photoId]?.length > 0)}
                    className="w-10 h-10 rounded-xl items-center justify-center bg-white/10"
                    style={{ opacity: (redoMap[photoId]?.length > 0) ? 1 : 0.35 }}
                  >
                    <Icon name="redo" size={20} color="white" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={confirmResetCanvas}
                    accessibilityLabel="Undo my changes"
                    className="w-10 h-10 rounded-xl items-center justify-center bg-white/10"
                  >
                    <Icon name="refresh" size={20} color="white" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {showStylePanel && selectedTextId && selectedText && (
              <AnnotationTextToolbar
                selectedText={selectedText}
                updateSelectedText={updateSelectedText}
                setShowStylePanel={setShowStylePanel}
                showFontDropdown={showFontDropdown}
                setShowFontDropdown={setShowFontDropdown}
                // Done also hides the note's Edit / Adjust / Delete menu - it only shows while a note is selected.
                onDone={() => setSelectedTextId(null)}
              />
            )}

            {/* DRAW MODE TOOLBAR */}
            {activeTool === 'draw' ? (
              <View className="bg-[#0b0e0c] border-t border-white/10 px-4 py-4 pb-8">
                <View className="flex-row justify-center gap-6 mb-5">
                  <TouchableOpacity
                    onPress={() => {
                      setActiveDrawTool('pen');
                      setShowColorPanel(!showColorPanel);
                    }}
                    className={`flex-row items-center px-6 py-2.5 rounded-full ${
                      activeDrawTool === 'pen' ? 'bg-[#72BD00]/25 border border-[#72BD00]' : 'bg-white/5 border border-white/10'
                    }`}
                  >
                    <Icon name="pencil" size={16} color={activeDrawTool === 'pen' ? '#72BD00' : 'white'} />
                    <Text className="text-white text-xs font-bold ml-1.5">Pen</Text>
                    <Icon name="chevron-down" size={12} color="white" className="ml-1" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setActiveDrawTool('eraser');
                      setShowColorPanel(false);
                    }}
                    className={`flex-row items-center px-6 py-2.5 rounded-full ${
                      activeDrawTool === 'eraser' ? 'bg-[#72BD00]/25 border border-[#72BD00]' : 'bg-white/5 border border-white/10'
                    }`}
                  >
                    <Icon name="eraser" size={16} color={activeDrawTool === 'eraser' ? '#72BD00' : 'white'} />
                    <Text className="text-white text-xs font-bold ml-1.5">Eraser</Text>
                  </TouchableOpacity>
                </View>

                {showColorPanel && activeDrawTool === 'pen' && (
                  <View className="bg-[#121614] border border-white/5 p-4 rounded-2xl mb-4">
                    <View className="flex-row justify-between mb-4">
                      {['#FF7043', '#4CBB17', '#42A5F5', '#FFB74D', '#FFFFFF', '#000000'].map((color) => (
                        <TouchableOpacity
                          key={color}
                          onPress={() => setActiveColor(color)}
                          style={{
                            backgroundColor: color,
                            borderWidth: activeColor === color ? 2.5 : 0,
                            borderColor: '#FFFFFF',
                          }}
                          className="w-8 h-8 rounded-full border border-white/10"
                        />
                      ))}
                      <View className="w-8 h-8 rounded-full bg-white/5 items-center justify-center">
                        <Icon name="palette" size={18} color="white" />
                      </View>
                    </View>

                    <View className="flex-row items-center justify-between mt-1 px-1">
                      <Text className="text-white/60 text-xs font-bold">Size</Text>
                      <View className="flex-1 flex-row items-center justify-end gap-3 mx-4">
                        {[3, 5, 8, 12].map((size) => (
                          <TouchableOpacity
                            key={size}
                            onPress={() => setActiveSize(size)}
                            className={`w-7 h-7 rounded-full items-center justify-center ${
                              activeSize === size ? 'bg-[#72BD00]' : 'bg-white/5'
                            }`}
                          >
                            <Text className="text-white text-[10px] font-bold">{size}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text className="text-white text-xs font-bold">{activeSize}</Text>
                    </View>
                  </View>
                )}

                <View className="flex-row items-center justify-between">
                  <TouchableOpacity onPress={cancelDrawMode} className="w-12 h-12 rounded-full bg-white/5 items-center justify-center">
                    <Icon name="close" size={24} color="white" />
                  </TouchableOpacity>
                  <ToolFooterLabel title="Brush" />
                  <TouchableOpacity onPress={commitDrawMode} className="w-12 h-12 rounded-full bg-white/5 items-center justify-center">
                    <Icon name="check" size={24} color="#72BD00" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* SHAPE MODE TOOLBAR */}
            {activeTool === 'shape' ? (
              <View className="bg-[#0b0e0c] border-t border-white/10 px-4 py-4 pb-8">
                <View className="flex-row justify-center gap-2 mb-4">
                  {SHAPE_KINDS.map(({ kind, label, icon }) => {
                    const on = activeShapeKind === kind;
                    return (
                      <TouchableOpacity
                        key={kind}
                        onPress={() => setActiveShapeKind(kind)}
                        className={`flex-1 items-center py-2 rounded-xl ${
                          on ? 'bg-[#72BD00]/25 border border-[#72BD00]' : 'bg-white/5 border border-white/10'
                        }`}
                      >
                        <Icon name={icon} size={20} color={on ? '#72BD00' : 'white'} />
                        <Text className="text-white text-[10px] font-bold mt-0.5">{label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View className="bg-[#121614] border border-white/5 p-3 rounded-2xl mb-3">
                  <View className="flex-row justify-between mb-3">
                    {SHAPE_COLORS.map((color) => {
                      const on = (selectedShape ? selectedShape.color : activeColor) === color;
                      return (
                        <TouchableOpacity
                          key={color}
                          onPress={() => pickShapeColor(color)}
                          style={{ backgroundColor: color, borderWidth: on ? 2.5 : 0, borderColor: '#FFFFFF' }}
                          className="w-8 h-8 rounded-full border border-white/10"
                        />
                      );
                    })}
                  </View>
                  <View className="flex-row items-center justify-between px-1">
                    <Text className="text-white/60 text-xs font-bold">Size</Text>
                    <View className="flex-1 flex-row items-center justify-end gap-3 mx-4">
                      {SHAPE_SIZES.map((size) => {
                        const on = (selectedShape ? selectedShape.width : activeSize) === size;
                        return (
                          <TouchableOpacity
                            key={size}
                            onPress={() => pickShapeSize(size)}
                            className={`w-7 h-7 rounded-full items-center justify-center ${on ? 'bg-[#72BD00]' : 'bg-white/5'}`}
                          >
                            <Text className="text-white text-[10px] font-bold">{size}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <Text className="text-white text-xs font-bold">{selectedShape ? selectedShape.width : activeSize}</Text>
                  </View>
                </View>

                <View className="items-center mb-3">
                  <Text className="text-white/60 text-xs font-bold text-center">
                    {selectedShape
                      ? 'Drag a handle to resize, drag the outline to move, or change colour / size above'
                      : 'Drag on the image to draw. Tap a shape to select it.'}
                  </Text>
                </View>

                <View className="flex-row items-center justify-between">
                  <TouchableOpacity onPress={cancelShapeMode} className="w-12 h-12 rounded-full bg-white/5 items-center justify-center">
                    <Icon name="close" size={24} color="white" />
                  </TouchableOpacity>
                  {selectedShape ? (
                    <TouchableOpacity
                      onPress={deleteSelectedShape}
                      className="flex-row items-center bg-[#FF5630]/15 border border-[#FF5630]/40 px-6 py-2.5 rounded-full"
                    >
                      <Icon name="trash-can-outline" size={16} color="#FF5630" />
                      <Text className="text-white text-xs font-bold ml-1.5">Delete shape</Text>
                    </TouchableOpacity>
                  ) : (
                    <ToolFooterLabel title="Shapes" />
                  )}
                  <TouchableOpacity onPress={commitShapeMode} className="w-12 h-12 rounded-full bg-white/5 items-center justify-center">
                    <Icon name="check" size={24} color="#72BD00" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* TEXT MODE TOOLBAR */}
            {activeTool === 'text' ? (
              <View className="bg-[#0b0e0c] border-t border-white/10 px-4 py-4 pb-8">
                <View className="items-center mb-4">
                  <Text className="text-white/60 text-xs font-bold">Tap anywhere on the image to add text</Text>
                </View>

                <View className="flex-row items-center justify-between">
                  <TouchableOpacity onPress={cancelTextMode} className="w-12 h-12 rounded-full bg-white/5 items-center justify-center">
                    <Icon name="close" size={24} color="white" />
                  </TouchableOpacity>
                  
                  <TouchableOpacity
                    onPress={handleAddTextPress}
                    className="flex-row items-center bg-[#72BD00]/15 border border-[#72BD00]/30 px-6 py-2.5 rounded-full"
                  >
                    <Icon name="plus-circle" size={16} color="#72BD00" />
                    <Text className="text-white text-xs font-bold ml-1.5">Add Text</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={commitTextMode} className="w-12 h-12 rounded-full bg-white/5 items-center justify-center">
                    <Icon name="check" size={24} color="#72BD00" />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* Pagination Navigation Footer */}
            {(activeTool === 'none' || activeTool === 'zoom') && !showStylePanel ? (
              <View className="bg-[#0b0e0c] flex-row justify-between items-center px-4 py-4 pb-8 border-t border-white/5">
                <TouchableOpacity
                  disabled={activeImageIndex === 0}
                  onPress={() => setActiveImageIndex(prev => prev - 1)}
                  className={`py-3 px-6 rounded-xl flex-row items-center ${
                    activeImageIndex === 0 ? 'opacity-40' : 'bg-white/5 border border-white/10'
                  }`}
                >
                  <Icon name="chevron-left" size={18} color="white" />
                  <Text className="text-white font-bold text-xs ml-1">Prev</Text>
                </TouchableOpacity>
                
                <Text className="text-slate-400 font-bold text-xs">
                  {activeImageIndex + 1} of {selectedPhotos.length}
                </Text>

                <TouchableOpacity
                  disabled={activeImageIndex === selectedPhotos.length - 1}
                  onPress={() => setActiveImageIndex(prev => prev + 1)}
                  className={`py-3 px-6 rounded-xl flex-row items-center ${
                    activeImageIndex === selectedPhotos.length - 1 ? 'opacity-40' : 'bg-white/5 border border-white/10'
                  }`}
                >
                  <Text className="text-white font-bold text-xs mr-1">Next</Text>
                  <Icon name="chevron-right" size={18} color="white" />
                </TouchableOpacity>
              </View>
            ) : null}

            {/* Inline Text Input Dialog Overlay */}
            {showTextDialog && (
              <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1000 }]}>
                <View style={{ backgroundColor: '#1E1E1E', borderRadius: 28, padding: 24, width: '100%', maxWidth: 320, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 }}>
                  <TextInput
                    value={textInputValue}
                    onChangeText={setTextInputValue}
                    placeholder="Enter text..."
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    autoFocus
                    style={{
                      width: '100%',
                      backgroundColor: '#2E2E2E',
                      borderRadius: 16,
                      color: 'white',
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      fontSize: 16,
                      fontWeight: 'bold',
                      marginBottom: 24,
                    }}
                  />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <TouchableOpacity
                      onPress={() => {
                        setShowTextDialog(false);
                        setEditingTextId(null);
                        setTextInputValue('');
                      }}
                      style={{
                        flex: 1,
                        backgroundColor: '#3E3E3E',
                        borderRadius: 16,
                        paddingVertical: 14,
                        alignItems: 'center',
                        marginRight: 8,
                      }}
                    >
                      <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleTextSubmit}
                      style={{
                        flex: 1,
                        backgroundColor: '#4CBB17',
                        borderRadius: 16,
                        paddingVertical: 14,
                        alignItems: 'center',
                        marginLeft: 8,
                      }}
                    >
                      <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 16 }}>OK</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>

      {/* Same wording / tone as the order-sheet "Reset all changes" dialog. */}
      <ConfirmDialog
        visible={showResetConfirm}
        tone="warn"
        title="Reset changes?"
        message="This removes ALL annotations from this photo, including ones you saved earlier, and returns it to the original image."
        note="Tap Save afterwards to keep the original. Going back instead keeps what was saved."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        onConfirm={() => {
          setShowResetConfirm(false);
          handleResetCanvas();
        }}
        onCancel={() => setShowResetConfirm(false)}
      />

      <ConfirmDialog
        visible={showDiscardConfirm}
        tone="warn"
        title="Discard changes?"
        message="Are you sure you want to discard your drawing changes?"
        note="Your unsaved changes will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep Editing"
        onConfirm={() => {
          setShowDiscardConfirm(false);
          logClick('discard', {
            marksRemoved: countMarks(marksFor(photoId)),
            includedSavedMarks: (seededMarks.count[photoId] || 0) > 0,
          });
          // iOS: popping the screen while the dialog's native Modal is still dismissing can drop the pop (or the dismissal), leaving the
          // rep on the editor. Wait for the dialog to finish leaving; Android has no such window.
          const leave = () => {
            onCancel?.();
            navigation.goBack();
          };
          if (Platform.OS === 'ios') setTimeout(leave, 400);
          else leave();
        }}
        onCancel={() => setShowDiscardConfirm(false)}
      />
    </GestureHandlerRootView>
  );
}
