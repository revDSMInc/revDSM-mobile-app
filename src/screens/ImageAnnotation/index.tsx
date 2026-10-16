import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Image,
  Alert,
  ActivityIndicator,
  TextInput,
  StyleSheet,
  Dimensions,
  PanResponder,
  BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { WebView } from 'react-native-webview';
import ReactNativeBlobUtil from 'react-native-blob-util';

const WebViewComponent = WebView as any;
import Geolocation from 'react-native-geolocation-service';
import { useUploadImagesMutation } from '../../hooks/useLeadMutation';
import {
  IDEMPOTENCY_FIELD,
  annotatedPhotoIdempotencyKey,
} from '../../utils/upload-idempotency';
import { useRoute, useNavigation } from '@react-navigation/native';
import { IMAGE_CATEGORIES } from '../../constants/lead-center';
import { useAuth } from '../../hooks/useAuth';
import { logEvent } from '../../services/api/LoggerService';
import { useWarmedImageUris } from '../../hooks/useWarmedImageUris';
import { forgetWarmedUri, warmToLocalCache } from '../../utils/imageFileCache';
import { LeadService } from '../../services/api/leads';
import { queryClient } from '../../services/api/queryClient';
import { FlashMessage } from '../../config/message';
import { buildMobileAnnotationData, countMarks } from '../../utils/annotation-restore';

import { AnnotationCanvas } from '../../widgets/components/LeadCenter/AnnotationCanvas';
import { AnnotationTextToolbar } from '../../widgets/components/LeadCenter/AnnotationTextToolbar';
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
  initialMarks?: { strokes: any[]; texts: any[]; shapes: any[] } | null;
  /** Re-edit: remote urls of the annotated copy whose cached bytes are stale once it is overwritten. */
  staleUris?: string[];
}

export default function ImageAnnotationScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { selectedPhotos = [], lead, onSaveSuccess, onCancel } = route.params || {};
  const openedLoggedRef = useRef(false);

  const uploadImagesMutation = useUploadImagesMutation();

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
      (selectedPhotos as SectionImage[]).forEach((p) => {
        const m = p?.initialMarks;
        if (!m) return;
        const pid = p.id || p.uri;
        strokes[pid] = m.strokes || [];
        texts[pid] = m.texts || [];
        shapes[pid] = (m.shapes || []) as AnnotationShape[];
        count[pid] = countMarks(m);
      });
      return { strokes, texts, shapes, count };
    })(),
  ).current;

  const [strokesMap, setStrokesMap] = useState<Record<string, any[]>>(seededMarks.strokes);
  const [textsMap, setTextsMap] = useState<Record<string, any[]>>(seededMarks.texts);
  const [shapesMap, setShapesMap] = useState<Record<string, AnnotationShape[]>>(seededMarks.shapes);
  const [activeShapeKind, setActiveShapeKind] = useState<ShapeKind>('arrow');
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [historyMap, setHistoryMap] = useState<Record<string, any[]>>({});
  const [redoMap, setRedoMap] = useState<Record<string, any[]>>({});

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

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        const { activeTool } = stateRef.current;
        return activeTool === 'draw' || activeTool === 'text' || activeTool === 'shape';
      },
      onMoveShouldSetPanResponder: () => {
        const { activeTool } = stateRef.current;
        return activeTool === 'draw' || activeTool === 'shape';
      },
      onPanResponderGrant: (evt, gestureState) => {
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
          setEditingTextId(null);
          setTextInputValue('');
          setPendingTextPos({ px, py });
          setShowTextDialog(true);
        }
      },
    })
  ).current;

  const handleUndo = () => {
    const history = historyMap[photoId] || [];
    if (history.length === 0) return;

    const action = history[history.length - 1];
    setHistoryMap((hm) => ({ ...hm, [photoId]: history.slice(0, -1) }));

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

  const handleResetCanvas = () => {
    setStrokesMap((sm) => ({ ...sm, [photoId]: [] }));
    setTextsMap((tm) => ({ ...tm, [photoId]: [] }));
    setShapesMap((sm) => ({ ...sm, [photoId]: [] }));
    setSelectedShapeId(null);
    setHistoryMap((hm) => ({ ...hm, [photoId]: [] }));
    setRedoMap((rm) => ({ ...rm, [photoId]: [] }));
  };

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
    setActiveTool('draw');
  };

  const commitDrawMode = () => {
    setActiveTool('none');
  };

  const cancelDrawMode = () => {
    setStrokesMap((sm) => ({ ...sm, [photoId]: backupStrokesRef.current }));
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
    setActiveTool('none');
  };

  const cancelTextMode = () => {
    setTextsMap((tm) => ({ ...tm, [photoId]: backupTextsRef.current }));
    setActiveTool('none');
  };

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveProgressText, setSaveProgressText] = useState<string>('');
  const webViewRef = useRef<any>(null);
  
  const [mountWebView, setMountWebView] = useState<boolean>(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setMountWebView(true);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  const saveQueueRef = useRef<any[]>([]);
  const saveResultsRef = useRef<any[]>([]);
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

  const getBase64FromUri = async (uri: string): Promise<string> => {
    if (uri.startsWith('file://')) {
      const cleanPath = uri.replace('file://', '');
      const data = await ReactNativeBlobUtil.fs.readFile(cleanPath, 'base64');
      return `data:image/jpeg;base64,${data}`;
    }

    try {
      const cached = await warmToLocalCache(uri);
      if (cached) {
        const data = await ReactNativeBlobUtil.fs.readFile(cached.replace('file://', ''), 'base64');
        return `data:image/jpeg;base64,${data}`;
      }
    } catch {
    }

    const res = await ReactNativeBlobUtil.config({ fileCache: true }).fetch('GET', uri, {
      'Accept-Encoding': 'identity',
    });
    const path = res.path();
    const base64Data = await ReactNativeBlobUtil.fs.readFile(path, 'base64');
    await ReactNativeBlobUtil.fs.unlink(path);
    return `data:image/jpeg;base64,${base64Data}`;
  };

  const marksFor = (pId: string) => ({
    strokes: strokesMap[pId] || [],
    texts: textsMap[pId] || [],
    shapes: shapesMap[pId] || [],
  });

  // True when the rep changed this photo since it opened (a re-edit's restored marks do not count).
  const isEditedPhoto = (pId: string) =>
    countMarks(marksFor(pId)) !== (seededMarks.count[pId] || 0) || (historyMap[pId] || []).length > 0;

  const handleSaveAll = async () => {
    setIsSaving(true);
    saveResultsRef.current = [];
    
    const photosToProcess = selectedPhotos.filter((photo: any) => {
      const pId = photo.id || photo.uri;
      // A re-edit is saved whenever it was touched, even if every mark was removed (that restores the clean photo).
      if (photo.existingAnnotationId) return isEditedPhoto(pId);
      return countMarks(marksFor(pId)) > 0;
    });

    if (photosToProcess.length === 0) {
      setIsSaving(false);
      onCancel?.();
      navigation.goBack();
      return;
    }

    locationRef.current = requestCoords();

    setSaveProgressText('Downloading original images...');

    const base64Promises = photosToProcess.map(async (photo: any) => {
      try {
        const base64 = await getBase64FromUri(photo.uri);
        return { pId: photo.id || photo.uri, base64 };
      } catch (e) {
        console.error('Failed to get base64 for photo:', photo.uri, e);
        return { pId: photo.id || photo.uri, base64: null };
      }
    });

    const base64Results = await Promise.all(base64Promises);
    const base64Map: Record<string, string> = {};
    base64Results.forEach(res => {
      if (res.base64) {
        base64Map[res.pId] = res.base64;
      }
    });

    if (!mountWebView) {
      setMountWebView(true);
      await new Promise<void>(resolve => setTimeout(resolve, 300));
    }

    saveQueueRef.current = photosToProcess.map((photo: any) => ({
      ...photo,
      base64Data: base64Map[photo.id || photo.uri] || null
    }));

    setSaveProgressText(`Preparing image 1 of ${photosToProcess.length}...`);
    processNextInQueue(0);
  };

  const processNextInQueue = async (idx: number) => {
    if (idx >= saveQueueRef.current.length) {
      uploadProcessedImages(saveResultsRef.current);
      return;
    }
    
    const photo = saveQueueRef.current[idx];
    setSaveProgressText(`Drawing annotations for image ${idx + 1} of ${saveQueueRef.current.length}...`);
    
    try {
      const base64Data = photo.base64Data || await getBase64FromUri(photo.uri);
      const pId = photo.id || photo.uri;

      const strokes = strokesMap[pId] || [];
      const texts = textsMap[pId] || [];

      const normalizedStrokes = strokes.map(s => ({
        isEraser: s.isEraser,
        color: s.color,
        width: s.width,
        points: s.points
      }));

      // fontStyle + opacity were never sent, so Bold / Italic / Opacity set in the style panel showed on screen but
      // were flattened to regular, fully opaque text in the saved photo.
      const normalizedTexts = texts.map(t => ({
        text: t.text,
        color: t.color,
        fontSize: t.fontSize,
        fontStyle: t.fontStyle,
        opacity: t.opacity,
        px: t.px,
        py: t.py
      }));

      const normalizedShapes = (shapesMap[pId] || []).map((sh) => ({
        kind: sh.kind,
        color: sh.color,
        width: sh.width,
        p1: sh.p1,
        p2: sh.p2,
      }));

      const message = {
        backgroundImageBase64: base64Data,
        layoutWidth: canvasLayout.width,
        layoutHeight: canvasLayout.height,
        strokes: normalizedStrokes,
        texts: normalizedTexts,
        shapes: normalizedShapes,
        imageIndex: idx
      };
      
      webViewRef.current?.postMessage(JSON.stringify(message));
    } catch (e) {
      console.error('Rasterization failed for index:', idx, e);
      processNextInQueue(idx + 1);
    }
  };

  const handleWebViewMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.status === 'success') {
        const cleanBase64 = data.base64.replace(/^data:image\/\w+;base64,/, '');
        const tempPath = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/annotated_${Date.now()}_${data.imageIndex}.jpg`;
        
        await ReactNativeBlobUtil.fs.writeFile(tempPath, cleanBase64, 'base64');
        
        const originalPhoto = saveQueueRef.current[data.imageIndex];
        saveResultsRef.current.push({
          uri: `file://${tempPath}`,
          originalPhoto
        });
        
        processNextInQueue(data.imageIndex + 1);
      } else {
        console.warn('WebView canvas drawing failed:', data.message);
        processNextInQueue(data.imageIndex + 1);
      }
    } catch (e) {
      console.error('WebView message handling error:', e);
      if (saveQueueRef.current) {
        const activeIdx = saveResultsRef.current.length;
        processNextInQueue(activeIdx + 1);
      }
    }
  };

  const uploadProcessedImages = async (results: any[]) => {
    if (results.length === 0) {
      setIsSaving(false);
      onCancel?.();
      navigation.goBack();
      return;
    }

    setSaveProgressText('Uploading annotated images...');

    const coords = await (locationRef.current || requestCoords());
    let reEditFailures = 0;
    let reEditSaved = 0;
    
    for (let i = 0; i < results.length; i++) {
      const res = results[i];
      setSaveProgressText(`Uploading annotated image ${i + 1} of ${results.length}...`);
      
      const orig = res.originalPhoto;
      const origKey = orig.id || orig.uri;
      const annotationData = buildMobileAnnotationData(marksFor(origKey), orig.salesPhotoId);

      if (orig.existingAnnotationId) {
        // Re-edit: overwrite the existing annotated image in place (one annotated photo per base photo). No new
        // photo row is created, so there is no duplicate to guard with an idempotency key - a retried PATCH just
        // writes the same bytes again.
        const patch = new FormData();
        patch.append('file', {
          uri: res.uri,
          type: 'image/jpeg',
          name: `annotated_${Date.now()}.jpg`,
        } as any);
        patch.append('annotationData', JSON.stringify(annotationData));
        try {
          await LeadService.upsertAnnotation(lead._id, orig.existingAnnotationId, patch);
          reEditSaved += 1;
          // Same s3url + same file name = same local cache path, so the old bytes would keep showing.
          await Promise.all((orig.staleUris || []).map((u: string) => forgetWarmedUri(u)));
        } catch (patchError: any) {
          reEditFailures += 1;
          console.error('Failed to update annotated image:', patchError?.response?.data || patchError?.message || patchError);
        }
        try {
          await ReactNativeBlobUtil.fs.unlink(res.uri.replace('file://', ''));
        } catch (cleanupError) {
          console.warn('Failed to delete temp file:', cleanupError);
        }
        continue;
      }

      const annotatedSubcategory = `${orig.subcategory} (Annotated)`;
      
      const formData = new FormData();
      formData.append('files', {
        uri: res.uri,
        type: 'image/jpeg',
        name: `annotated_${Date.now()}.jpg`,
      } as any);

      const imageInfo = [
        {
          category: orig.categoryName || orig.category || '',
          subcategory: annotatedSubcategory,
          timestampTaken: new Date().toISOString(),
          coordinates: coords,
        },
      ];

      formData.append('images', JSON.stringify(imageInfo));
      // Linked to the clean original so the copy can be re-edited later (same field the web app sends).
      formData.append(
        'annotations',
        JSON.stringify([
          orig.salesPhotoId ? { salesPhotoId: orig.salesPhotoId, annotationData } : null,
        ]),
      );
      formData.append('category', 'salesPhotos');

      /**
       * IMPORTANT: stops a timed-out upload being stored twice. Keyed on the rendered temp
       * file, which is minted once per annotation - so a retransmit of THIS save is collapsed,
       * while re-annotating the same source photo later is correctly a new upload.
       */
      const idempotencyKey = annotatedPhotoIdempotencyKey({
        leadId: lead._id,
        renderUri: res.uri,
      });
      if (idempotencyKey) formData.append(IDEMPOTENCY_FIELD, idempotencyKey);

      try {
        await uploadImagesMutation.mutateAsync({ leadId: lead._id, formData, idempotencyKey });
      } catch (uploadError: any) {
        console.error('Failed to upload annotated image:', uploadError?.response?.data || uploadError?.message || uploadError);
      }
      
      try {
        const cleanPath = res.uri.replace('file://', '');
        await ReactNativeBlobUtil.fs.unlink(cleanPath);
      } catch (cleanupError) {
        console.warn('Failed to delete temp file:', cleanupError);
      }
    }

    setIsSaving(false);
    const userId = user?._id || user?.id;
    if (userId && results.length > 0) {
      logEvent('save', {
        user_id: userId,
        created_by: userId,
        module_type: 'annotated_photos',
        meta: {
          action: 'saved_annotated_images',
          image_count: results.length,
          occurredAt: new Date().toISOString(),
        },
      });
    }
    if (reEditSaved > 0) {
      // Fresh signatures, so the overwritten image is not served from a cached url.
      queryClient.invalidateQueries({ queryKey: ['secureUrls'] });
      queryClient.invalidateQueries({ queryKey: ['lead', lead._id] });
    }
    if (reEditFailures > 0) {
      FlashMessage.error('Not saved', `${reEditFailures} annotated photo${reEditFailures === 1 ? '' : 's'} could not be updated. Try again.`);
    }
    onSaveSuccess?.();
    navigation.goBack();
  };

  const handleBackPress = () => {
    const hasUnsavedChanges = (selectedPhotos as SectionImage[]).some((p) => {
      const pid = p.id || p.uri;
      return countMarks(marksFor(pid)) !== (seededMarks.count[pid] || 0) || (historyMap[pid] || []).length > 0;
    });
    if (hasUnsavedChanges) {
      Alert.alert(
        'Discard Changes',
        'Are you sure you want to discard your drawing changes?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () => {
              onCancel?.();
              navigation.goBack();
            },
          },
        ]
      );
    } else {
      onCancel?.();
      navigation.goBack();
    }
  };

  const selectedText = currentTexts.find(t => t.id === selectedTextId);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView className="flex-1" style={{ backgroundColor: '#090e0c' }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 pt-2 pb-4 bg-[#090e0c]">
          <TouchableOpacity
            onPress={handleBackPress}
            className="w-10 h-10 rounded-full bg-white/10 items-center justify-center"
          >
            <Icon name="chevron-left" size={24} color="white" />
          </TouchableOpacity>

          <Text className="text-white/40 font-bold text-xs">
            Annotate ({activeImageIndex + 1}/{selectedPhotos.length})
          </Text>

          <TouchableOpacity
            onPress={handleSaveAll}
            disabled={isSaving}
            className="px-6 py-2.5 rounded-full bg-[#72BD00]"
          >
            <Text className="text-white font-extrabold text-sm">Save All</Text>
          </TouchableOpacity>
        </View>

        {/* Loading Overlay */}
        {isSaving && (
          <View className="absolute inset-0 bg-black/85 z-50 items-center justify-center p-6">
            <ActivityIndicator size="large" color="#72BD00" />
            <Text className="text-white font-bold text-base mt-4 text-center">
              {saveProgressText}
            </Text>
          </View>
        )}

        {selectedPhotos.length > 0 && currentPhoto && (
          <View className="flex-1 flex-col justify-between">
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
                onZoomChange={setZoomScale}
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
                  <TouchableOpacity
                    onPress={() => setActiveTool('zoom')}
                    className={`w-12 h-14 rounded-xl items-center justify-center ${
                      activeTool === 'zoom' ? 'bg-[#72BD00]' : 'bg-white/10'
                    }`}
                  >
                    <Icon name="magnify" size={20} color="white" />
                    <Text className="text-white text-[10px] font-bold mt-1">Zoom</Text>
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
                    onPress={handleResetCanvas}
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
                  <Text className="text-white font-extrabold text-sm uppercase tracking-widest">Brush</Text>
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
                    <Text className="text-white font-extrabold text-sm uppercase tracking-widest">Shapes</Text>
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

      {/* Hidden WebView for high-res rasterization */}
      {mountWebView && (
        <View style={{ width: 0, height: 0, opacity: 0, position: 'absolute' }}>
          <WebViewComponent
            ref={webViewRef}
            onMessage={handleWebViewMessage}
            originWhitelist={['*']}
            source={{
              html: `
                <!DOCTYPE html>
                <html>
                <head>
                  <style>
                    body, html { margin: 0; padding: 0; overflow: hidden; background: transparent; }
                    canvas { display: none; }
                  </style>
                </head>
                <body>
                  <canvas id="canvas"></canvas>
                  <script>
                    document.addEventListener("message", function(event) {
                      handleMessage(JSON.parse(event.data));
                    });
                    window.addEventListener("message", function(event) {
                      handleMessage(JSON.parse(event.data));
                    });

                    async function handleMessage(data) {
                      try {
                        const canvas = document.getElementById("canvas");
                        const ctx = canvas.getContext("2d");

                        const img = new Image();
                        img.onload = function() {
                          const w = img.naturalWidth || img.width;
                          const h = img.naturalHeight || img.height;
                          canvas.width = w;
                          canvas.height = h;

                          ctx.drawImage(img, 0, 0);

                          // Ink is drawn on its OWN transparent layer and then laid over the photo: an eraser stroke
                          // ('destination-out') on the photo canvas itself punched transparent holes in the PICTURE,
                          // which a JPEG saves as black, instead of rubbing out only the pen marks as the preview does.
                          if (data.strokes && data.strokes.length) {
                            const layer = document.createElement('canvas');
                            layer.width = w;
                            layer.height = h;
                            const lctx = layer.getContext('2d');
                            data.strokes.forEach(stroke => {
                              if (stroke.points.length === 0) return;

                              lctx.beginPath();
                              lctx.lineCap = 'round';
                              lctx.lineJoin = 'round';

                              if (stroke.isEraser) {
                                lctx.globalCompositeOperation = 'destination-out';
                                lctx.lineWidth = stroke.width * (w / data.layoutWidth);
                              } else {
                                lctx.globalCompositeOperation = 'source-over';
                                lctx.strokeStyle = stroke.color;
                                lctx.lineWidth = stroke.width * (w / data.layoutWidth);
                              }

                              const firstPoint = stroke.points[0];
                              lctx.moveTo(firstPoint.px * w, firstPoint.py * h);

                              stroke.points.forEach(pt => {
                                lctx.lineTo(pt.px * w, pt.py * h);
                              });

                              lctx.stroke();
                            });
                            ctx.drawImage(layer, 0, 0);
                          }

                          // Shapes: same maths as utils/annotation-shapes.ts (arrowGeometry) - keep the two in step.
                          if (data.shapes) {
                            const sScale = w / data.layoutWidth;
                            data.shapes.forEach(sh => {
                              const x1 = sh.p1.px * w, y1 = sh.p1.py * h;
                              const x2 = sh.p2.px * w, y2 = sh.p2.py * h;
                              const lw = sh.width * sScale;
                              ctx.lineCap = 'round';
                              ctx.lineJoin = 'round';
                              ctx.strokeStyle = sh.color;
                              ctx.fillStyle = sh.color;
                              ctx.lineWidth = lw;
                              ctx.beginPath();
                              if (sh.kind === 'line') {
                                ctx.moveTo(x1, y1);
                                ctx.lineTo(x2, y2);
                                ctx.stroke();
                              } else if (sh.kind === 'arrow') {
                                const dx = x2 - x1, dy = y2 - y1;
                                const len = Math.hypot(dx, dy) || 1;
                                const ux = dx / len, uy = dy / len;
                                const headLen = Math.min(Math.max(14 * sScale, lw * 4.5), len * 0.6);
                                const bx = x2 - ux * headLen, by = y2 - uy * headLen;
                                const half = headLen * Math.tan(Math.PI / 7);
                                const shaft = headLen * 0.85;
                                ctx.moveTo(x1, y1);
                                ctx.lineTo(x2 - ux * shaft, y2 - uy * shaft);
                                ctx.stroke();
                                ctx.beginPath();
                                ctx.moveTo(x2, y2);
                                ctx.lineTo(bx - uy * half, by + ux * half);
                                ctx.lineTo(bx + uy * half, by - ux * half);
                                ctx.closePath();
                                ctx.lineWidth = lw * 0.4;
                                ctx.fill();
                                ctx.stroke();
                              } else if (sh.kind === 'circle') {
                                const r = Math.hypot((sh.p2.px - sh.p1.px) * data.layoutWidth, (sh.p2.py - sh.p1.py) * data.layoutHeight) * sScale;
                                ctx.arc(x1, y1, r, 0, Math.PI * 2);
                                ctx.stroke();
                              } else if (sh.kind === 'rect') {
                                ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
                                ctx.stroke();
                              }
                            });
                          }

                          ctx.globalCompositeOperation = 'source-over';

                          if (data.texts) {
                            data.texts.forEach(textObj => {
                              const textScale = w / data.layoutWidth;
                              const fontSize = textObj.fontSize * textScale;
                              
                              let fontStylePrefix = "";
                              if (textObj.fontStyle === 'bold') {
                                fontStylePrefix = "bold ";
                              } else if (textObj.fontStyle === 'italic') {
                                fontStylePrefix = "italic ";
                              } else if (textObj.fontStyle === 'bold-italic') {
                                fontStylePrefix = "italic bold ";
                              }
                              ctx.font = fontStylePrefix + fontSize + "px sans-serif";
                              
                              ctx.globalAlpha = textObj.opacity !== undefined ? textObj.opacity : 1.0;
                              ctx.fillStyle = textObj.color || '#FFFFFF';
                              ctx.fillText(textObj.text, textObj.px * w, textObj.py * h + fontSize * 0.8);
                              ctx.globalAlpha = 1.0;
                            });
                          }

                          const base64 = canvas.toDataURL("image/jpeg", 0.85);
                          window.ReactNativeWebView.postMessage(JSON.stringify({
                            status: 'success',
                            imageIndex: data.imageIndex,
                            base64: base64
                          }));
                        };
                        img.onerror = function() {
                          window.ReactNativeWebView.postMessage(JSON.stringify({
                            status: 'error',
                            imageIndex: data.imageIndex,
                            message: 'Image load failed'
                          }));
                        };
                        img.src = data.backgroundImageBase64;
                      } catch (e) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                          status: 'error',
                          imageIndex: data.imageIndex,
                          message: e.message
                        }));
                      }
                    }
                  </script>
                </body>
                </html>
              `
            }}
          />
        </View>
      )}
    </GestureHandlerRootView>
  );
}
