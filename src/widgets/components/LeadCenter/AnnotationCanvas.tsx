import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Svg, { Path, Mask, Rect, G, Line, Circle, Polygon } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import {
  anchoredTranslate,
  clampPan,
  clampZoomScale,
  zoomOrigin,
} from '../../../utils/zoom-transform';
import { DraggableText } from './DraggableText';
import { strokeOpacity } from '../../../utils/annotation-brush';
import { layerBlocks, orderedLayers, type LayerBlock } from '../../../utils/annotation-layers';
import { arrowGeometry, circleRadiusPx, shapeHandles, type AnnotationShape } from '../../../utils/annotation-shapes';

const MAX_ZOOM_SCALE = 5;

interface AnnotationCanvasProps {
  canvasLayout: { width: number; height: number };
  activeTool: 'none' | 'zoom' | 'draw' | 'text' | 'shape';
  currentPhoto: any;
  activeImageIndex: number;
  currentStrokes: any[];
  activeStroke?: any;
  subscribeActiveStroke?: (cb: (stroke: any) => void) => () => void;
  currentShapes?: AnnotationShape[];
  /** Live preview of the shape being drawn / moved / resized (a full shape; `null` when idle). */
  subscribeActiveShape?: (cb: (shape: AnnotationShape | null) => void) => () => void;
  selectedShapeId?: string | null;
  currentTexts: any[];
  getPathData: (points: any[]) => string;
  selectedTextId: string | null;
  setSelectedTextId: (id: string | null) => void;
  panResponder: any;
  handleTextPress: (text: any) => void;
  setShowStylePanel: (show: boolean) => void;
  handleDeleteTextNote: (id: string) => void;
  handleMoveText: (id: string, newPx: number, newPy: number) => void;
  /** Who can be dragged: every note while the Text tool is active ('all'), only the selected one while its Adjust Style panel is open ('selected'), else none. */
  textMoveMode?: 'none' | 'selected' | 'all';
  onZoomChange?: (scale: number) => void;
  /**
   * Two-finger zoom for Draw / Text / Shapes. The touch responder that owns those tools reports its live touches
   * here (`touches`) and tells us when they lift (`release`); the canvas turns two of them into a pinch + pan.
   */
  twoFingerZoomRef?: React.MutableRefObject<TwoFingerZoomApi | null>;
}

export interface PageTouch {
  pageX: number;
  pageY: number;
}

export interface TwoFingerZoomApi {
  touches: (list: PageTouch[]) => void;
  release: () => void;
  /** Back to fit (scale 1, no pan). Used by the Zoom button to undo a pinch. */
  reset: () => void;
}

export const AnnotationCanvas = ({
  canvasLayout,
  activeTool,
  currentPhoto,
  activeImageIndex,
  currentStrokes,
  activeStroke,
  subscribeActiveStroke,
  currentTexts,
  currentShapes,
  subscribeActiveShape,
  selectedShapeId,
  getPathData,
  selectedTextId,
  setSelectedTextId,
  panResponder,
  handleTextPress,
  setShowStylePanel,
  handleDeleteTextNote,
  handleMoveText,
  textMoveMode = 'none',
  onZoomChange,
  twoFingerZoomRef,
}: AnnotationCanvasProps) => {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);

  const [jsScale, setJsScale] = useState(1);

  const [liveStroke, setLiveStroke] = useState<any | null>(null);
  useEffect(() => {
    if (!subscribeActiveStroke) return;
    return subscribeActiveStroke(setLiveStroke);
  }, [subscribeActiveStroke]);
  const drawingStroke = liveStroke || activeStroke || null;

  const [liveShape, setLiveShape] = useState<AnnotationShape | null>(null);
  useEffect(() => {
    if (!subscribeActiveShape) return;
    return subscribeActiveShape(setLiveShape);
  }, [subscribeActiveShape]);

  // Committed shapes with the in-flight one swapped in (edit) or appended (new), in draw order.
  const shapesToRender = useMemo(() => {
    const base = currentShapes || [];
    if (!liveShape) return base;
    return base.some((sh) => sh.id === liveShape.id)
      ? base.map((sh) => (sh.id === liveShape.id ? liveShape : sh))
      : [...base, liveShape];
  }, [currentShapes, liveShape]);

  // Chronological layers (utils/annotation-layers.ts): pen ink, eraser strokes and shapes are one stack, and an eraser stroke rubs out
  // whatever was drawn BEFORE it - ink and shapes alike. Path strings are built once per change, not once per live-stroke frame.
  const layerPlan = useMemo<LayerBlock[]>(() => {
    const strokes = (currentStrokes || []).map((stroke) => ({ ...stroke, d: getPathData(stroke.points) }));
    return layerBlocks(orderedLayers(strokes, shapesToRender));
  }, [currentStrokes, shapesToRender, getPathData]);

  const reportScale = useCallback(
    (next: number) => {
      setJsScale(next);
      onZoomChange?.(next);
    },
    [onZoomChange],
  );

  useEffect(() => {
    boxW.value = canvasLayout.width;
    boxH.value = canvasLayout.height;
  }, [canvasLayout.width, canvasLayout.height, boxW, boxH]);

  // Back to fit. Shared by the photo-change effect and the Zoom button (REVUIUX-561), so the
  // two can never drift into resetting different things.
  const resetZoom = useCallback(() => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
    reportScale(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportScale]);

  useEffect(() => {
    resetZoom();
    setLiveStroke(null);
    setLiveShape(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageIndex]);

  const zoomEnabled = activeTool === 'zoom';

  // The pinch is driven from a touch responder's live touches in EVERY tool (Zoom, Draw, Text, Shapes, none) - see
  // `twoFingerZoomRef`. RNGH's pinch never fired once a JS PanResponder held the touch, so it is not used at all.
  const frameRef = useRef<View>(null);
  const pinchState = useRef({
    on: false,
    ready: false,
    rect: null as null | { cx: number; cy: number },
    startDist: 1,
    startScale: 1,
    startTx: 0,
    startTy: 0,
    focal: { x: 0, y: 0 },
    originX: 0,
    originY: 0,
  }).current;

  useEffect(() => {
    pinchState.rect = null; // the frame moved / resized: measure again on the next pinch
  }, [canvasLayout.width, canvasLayout.height, pinchState]);

  const centroid = (a: PageTouch, b: PageTouch) => ({ x: (a.pageX + b.pageX) / 2, y: (a.pageY + b.pageY) / 2 });
  const spread = (a: PageTouch, b: PageTouch) => Math.max(1, Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY));

  const armPinch = () => {
    const f = pinchState.focal;
    const { cx, cy } = pinchState.rect!;
    pinchState.originX = zoomOrigin(f.x - cx, pinchState.startTx, pinchState.startScale);
    pinchState.originY = zoomOrigin(f.y - cy, pinchState.startTy, pinchState.startScale);
    pinchState.ready = true;
  };

  const beginPinch = (a: PageTouch, b: PageTouch) => {
    pinchState.on = true;
    pinchState.ready = false;
    pinchState.startDist = spread(a, b);
    pinchState.startScale = scale.value;
    pinchState.startTx = tx.value;
    pinchState.startTy = ty.value;
    pinchState.focal = centroid(a, b);
    if (pinchState.rect) {
      armPinch();
    } else {
      // The frame never moves while a photo is open, so one measurement serves every later pinch.
      frameRef.current?.measure((_x, _y, w, h, pageX, pageY) => {
        pinchState.rect = { cx: pageX + w / 2, cy: pageY + h / 2 };
        if (pinchState.on && !pinchState.ready) armPinch();
      });
    }
  };

  const updatePinch = (a: PageTouch, b: PageTouch) => {
    if (!pinchState.ready || !pinchState.rect) return;
    const next = clampZoomScale(pinchState.startScale * (spread(a, b) / pinchState.startDist), MAX_ZOOM_SCALE);
    const f = centroid(a, b);
    scale.value = next;
    // The CURRENT centroid, so the photo follows the fingers (pan) as well as scaling about them.
    tx.value = anchoredTranslate(f.x - pinchState.rect.cx, pinchState.originX, next, boxW.value);
    ty.value = anchoredTranslate(f.y - pinchState.rect.cy, pinchState.originY, next, boxH.value);
  };

  const finishPinch = () => {
    if (!pinchState.on) return;
    pinchState.on = false;
    pinchState.ready = false;
    savedScale.value = scale.value;
    savedTx.value = tx.value;
    savedTy.value = ty.value;
    reportScale(scale.value);
  };

  const twoFingerTouches = (list: PageTouch[]) => {
    if (list.length > 1) {
      if (!pinchState.on) beginPinch(list[0], list[1]);
      else updatePinch(list[0], list[1]);
    } else {
      finishPinch();
    }
  };

  // Re-assigned every render so it always sees the current shared values; the ref object itself is stable.
  if (twoFingerZoomRef) {
    twoFingerZoomRef.current = { touches: twoFingerTouches, release: finishPinch, reset: resetZoom };
  }

  // One finger pans the zoomed photo in Zoom mode AND with no tool selected (a one-finger touch is otherwise free
  // there). maxPointers 1: two fingers belong to the JS pinch above, which pans with the centroid itself.
  const pan = Gesture.Pan()
    .enabled(zoomEnabled || activeTool === 'none')
    .maxPointers(1)
    .onUpdate((e) => {
      tx.value = clampPan(savedTx.value, e.translationX, scale.value, boxW.value);
      ty.value = clampPan(savedTy.value, e.translationY, scale.value, boxH.value);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const composed = Gesture.Simultaneous(pan);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const renderShape = (shape: AnnotationShape) => {
    const W = canvasLayout.width;
    const H = canvasLayout.height;
    const x1 = shape.p1.px * W;
    const y1 = shape.p1.py * H;
    const x2 = shape.p2.px * W;
    const y2 = shape.p2.py * H;
    const common = { stroke: shape.color, strokeWidth: shape.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    switch (shape.kind) {
      case 'line':
        return <Line key={shape.id} x1={x1} y1={y1} x2={x2} y2={y2} {...common} />;
      case 'arrow': {
        const g = arrowGeometry(x1, y1, x2, y2, shape.width);
        return (
          <G key={shape.id}>
            <Line x1={x1} y1={y1} x2={g.shaftEnd.x} y2={g.shaftEnd.y} {...common} />
            <Polygon
              points={`${g.tip.x},${g.tip.y} ${g.left.x},${g.left.y} ${g.right.x},${g.right.y}`}
              fill={shape.color}
              stroke={shape.color}
              strokeWidth={shape.width * 0.4}
              strokeLinejoin="round"
            />
          </G>
        );
      }
      case 'circle':
        return <Circle key={shape.id} cx={x1} cy={y1} r={circleRadiusPx(shape, W, H)} fill="none" {...common} />;
      case 'rect':
        return (
          <Rect
            key={shape.id}
            x={Math.min(x1, x2)}
            y={Math.min(y1, y2)}
            width={Math.abs(x2 - x1)}
            height={Math.abs(y2 - y1)}
            fill="none"
            {...common}
          />
        );
      default:
        return null;
    }
  };

  // Handles of the selected shape: drawn at a constant on-screen size whatever the zoom.
  const selectedShape = selectedShapeId ? shapesToRender.find((sh) => sh.id === selectedShapeId) : null;
  const handleR = 8 / (jsScale > 0 ? jsScale : 1);

  // Walk the blocks oldest-first: wrap what is built so far in a group masked by the block's eraser strokes, then lay the block's own marks on top.
  // The stroke being drawn right now joins at the end (a live eraser masks everything; live ink sits on top).
  const renderLayers = () => {
    const blocks: LayerBlock[] = layerPlan.map((b) => ({ erasers: b.erasers, items: [...b.items] }));
    const last = blocks[blocks.length - 1];
    if (drawingStroke?.isEraser && drawingStroke.points?.length > 0) {
      if (last.items.length === 0) last.erasers = [...last.erasers, drawingStroke];
      else blocks.push({ erasers: [drawingStroke], items: [] });
    } else if (drawingStroke && !drawingStroke.isEraser && drawingStroke.points?.length > 0) {
      last.items.push({ kind: 'stroke', item: { ...drawingStroke, d: getPathData(drawingStroke.points) } });
    }
    let content: React.ReactNode[] = [];
    blocks.forEach((blk, bi) => {
      if (blk.erasers.length) {
        const id = `eraser-mask-${activeImageIndex}-${bi}`;
        content = [
          <Mask key={`m-${bi}`} id={id}>
            <Rect x={0} y={0} width={canvasLayout.width} height={canvasLayout.height} fill="white" />
            {blk.erasers.map((s: any) => (
              <Path
                key={s.id}
                d={s.d ?? getPathData(s.points)}
                stroke="black"
                strokeWidth={s.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
          </Mask>,
          <G key={`g-${bi}`} mask={`url(#${id})`}>
            {content}
          </G>,
        ];
      }
      blk.items.forEach((l) => {
        content.push(
          l.kind === 'stroke' ? (
            <Path
              key={`s-${l.item.id}`}
              d={l.item.d}
              stroke={l.item.color}
              strokeWidth={l.item.width}
              strokeOpacity={strokeOpacity(l.item)}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : (
            renderShape(l.item)
          ),
        );
      });
    });
    return content;
  };

  const renderCanvas = () => {
    return (
      <View
        ref={frameRef}
        collapsable={false}
        style={{
          width: canvasLayout.width,
          height: canvasLayout.height,
          borderRadius: 16,
          overflow: 'hidden',
          position: 'relative',
          backgroundColor: 'rgba(0,0,0,0.4)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.05)',
        }}
      >
        <Animated.View
          style={[
            { width: canvasLayout.width, height: canvasLayout.height, position: 'relative' },
            zoomStyle,
          ]}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setSelectedTextId(null)}
            style={{ width: '100%', height: '100%', position: 'absolute' }}
          >
            {currentPhoto?.uri && (
              <Image
                source={{ uri: currentPhoto.uri }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="contain"
              />
            )}
          </TouchableOpacity>

          {/* SVG Drawing Layer */}
          <View
            style={{ position: 'absolute', top: 0, left: 0, width: canvasLayout.width, height: canvasLayout.height }}
            pointerEvents="none"
          >
            <Svg
              width={canvasLayout.width}
              height={canvasLayout.height}
            >
              {renderLayers()}

              {/* The eraser's footprint (REVUIUX-588): the erased band is invisible, so a ring shows where it is and how wide, at constant outline weight under zoom. */}
              {drawingStroke?.isEraser && drawingStroke.points?.length > 0 && (
                <Circle
                  cx={drawingStroke.points[drawingStroke.points.length - 1].px * canvasLayout.width}
                  cy={drawingStroke.points[drawingStroke.points.length - 1].py * canvasLayout.height}
                  r={Math.max(drawingStroke.width, 2) / 2}
                  fill="rgba(255,255,255,0.25)"
                  stroke="#FFFFFF"
                  strokeWidth={1.5 / (jsScale > 0 ? jsScale : 1)}
                />
              )}

              {selectedShape && activeTool === 'shape' && (
                <G>
                  {shapeHandles(selectedShape).map((h) => selectedShape[h]).map((pt, i) => (
                    <Circle
                      key={i}
                      cx={pt.px * canvasLayout.width}
                      cy={pt.py * canvasLayout.height}
                      r={handleR}
                      fill="#FFFFFF"
                      stroke="#72BD00"
                      strokeWidth={handleR * 0.4}
                    />
                  ))}
                </G>
              )}
            </Svg>
          </View>

          {/* Drawing/Tapping Responder Overlay */}
          {(activeTool === 'draw' || activeTool === 'text' || activeTool === 'shape') && (
            <View
              style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.01)' }]}
              {...panResponder.panHandlers}
            />
          )}

          {/* Draggable Text Notes Layer - inert while placing shapes or drawing / erasing, so a drag that starts over a note still draws (and the eraser can reach it). */}
          <View style={StyleSheet.absoluteFill} pointerEvents={activeTool === 'shape' || activeTool === 'draw' ? 'none' : 'box-none'}>
          {currentTexts.map(text => (
            <DraggableText
              key={text.id}
              text={text}
              canvasLayout={canvasLayout}
              selectedTextId={selectedTextId}
              setSelectedTextId={setSelectedTextId}
              handleTextPress={handleTextPress}
              setShowStylePanel={setShowStylePanel}
              handleDeleteTextNote={handleDeleteTextNote}
              handleMoveText={handleMoveText}
              zoomScale={jsScale}
              dragEnabled={!zoomEnabled}
              moveMode={textMoveMode}
              onTwoFingerTouches={twoFingerTouches}
              onTwoFingerEnd={finishPinch}
            />
          ))}
          </View>
        </Animated.View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center' }}>
      <GestureDetector gesture={composed}>{renderCanvas()}</GestureDetector>
    </View>
  );
};
