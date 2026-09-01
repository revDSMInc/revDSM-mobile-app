import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Svg, { Path, Mask, Rect, G } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
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

/** Matches the `maximumZoomScale` the iOS-only ScrollView zoom used before. */
const MAX_ZOOM_SCALE = 5;

interface AnnotationCanvasProps {
  canvasLayout: { width: number; height: number };
  activeTool: 'none' | 'zoom' | 'draw' | 'text';
  currentPhoto: any;
  activeImageIndex: number;
  currentStrokes: any[];
  /** Static fallback for callers that do not publish a live stroke. */
  activeStroke?: any;
  /**
   * Subscribe to the stroke being drawn right now. The editor publishes it here
   * instead of holding it in its own state, so a touch move re-renders THIS
   * component rather than the whole screen. Returns an unsubscribe.
   */
  subscribeActiveStroke?: (cb: (stroke: any) => void) => () => void;
  currentTexts: any[];
  getPathData: (points: any[]) => string;
  selectedTextId: string | null;
  setSelectedTextId: (id: string | null) => void;
  panResponder: any;
  handleTextPress: (text: any) => void;
  setShowStylePanel: (show: boolean) => void;
  handleDeleteTextNote: (id: string) => void;
  handleMoveText: (id: string, newPx: number, newPy: number) => void;
  /**
   * Reports the live pinch scale so the drawing layer can divide its gesture deltas
   * by it — `gestureState.dx/dy` are SCREEN pixels, so at 3x a stroke would otherwise
   * run three times as far as the finger.
   */
  onZoomChange?: (scale: number) => void;
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
  getPathData,
  selectedTextId,
  setSelectedTextId,
  panResponder,
  handleTextPress,
  setShowStylePanel,
  handleDeleteTextNote,
  handleMoveText,
  onZoomChange,
}: AnnotationCanvasProps) => {
  // ⚠️ The zoom is a reanimated TRANSFORM, not a ScrollView.
  //
  // It used to be a `ScrollView` with `maximumZoomScale`/`minimumZoomScale`, which are
  // **iOS-only props** — Android's ScrollView has no pinch-zoom at all, so the whole
  // feature was silently missing there. And on iOS, flipping `scrollEnabled` when the
  // rep picked the pen re-laid out the content, which made UIScrollView re-clamp its
  // `contentOffset` and jump the image away from the detail they had lined up.
  //
  // A transform has neither problem: `react-native-gesture-handler` fires the same on
  // both platforms, and switching tools touches none of these shared values, so the
  // view is preserved to the pixel.
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  // The focal point of the live pinch, and the canvas-space point under it, so the
  // pixels between the fingers stay between the fingers as the scale changes.
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);

  // JS-thread mirror of the settled scale. The stroke and text-drag deltas arrive on the
  // JS thread (PanResponder), so they cannot read a shared value.
  const [jsScale, setJsScale] = useState(1);

  // The stroke under the finger. Kept HERE rather than in the editor so drawing
  // re-renders this component alone - see `subscribeActiveStroke`.
  const [liveStroke, setLiveStroke] = useState<any | null>(null);
  useEffect(() => {
    if (!subscribeActiveStroke) return;
    return subscribeActiveStroke(setLiveStroke);
  }, [subscribeActiveStroke]);
  const drawingStroke = liveStroke || activeStroke || null;

  // Path strings for the strokes already committed. Rebuilt only when a stroke
  // is added/removed or the canvas is re-laid out - NOT on every frame of the
  // stroke being drawn, which is what made a photo with a few strokes on it feel
  // progressively heavier to draw on.
  const committedPaths = useMemo(() => {
    const eraser: Array<{ id: any; d: string; width: number }> = [];
    const ink: Array<{ id: any; d: string; width: number; color: string }> = [];
    (currentStrokes || []).forEach((stroke) => {
      const d = getPathData(stroke.points);
      if (stroke.isEraser) eraser.push({ id: stroke.id, d, width: stroke.width });
      else ink.push({ id: stroke.id, d, width: stroke.width, color: stroke.color });
    });
    return { eraser, ink };
  }, [currentStrokes, getPathData]);

  const reportScale = useCallback(
    (next: number) => {
      setJsScale(next);
      onZoomChange?.(next);
    },
    [onZoomChange],
  );

  // The pan bound is measured against the CANVAS, not the container: `canvasLayout` is
  // already the image's exact letterboxed box, so this stops the drag at the image's own
  // edge rather than letting it slide into the empty margin beside it.
  useEffect(() => {
    boxW.value = canvasLayout.width;
    boxH.value = canvasLayout.height;
  }, [canvasLayout.width, canvasLayout.height, boxW, boxH]);

  // Snap back to 1x on Next/Prev — otherwise the rep lands on a different photo already
  // zoomed into wherever the previous one happened to be scrolled.
  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
    reportScale(1);
    setLiveStroke(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeImageIndex]);

  // Only Zoom mode drives the gestures. In Draw/Text the PanResponder overlay below owns
  // every touch, exactly as it did before, so a one-finger drag draws instead of panning.
  const zoomEnabled = activeTool === 'zoom';

  const pinch = Gesture.Pinch()
    .enabled(zoomEnabled)
    .onStart((e) => {
      focalX.value = e.focalX - boxW.value / 2;
      focalY.value = e.focalY - boxH.value / 2;
      originX.value = zoomOrigin(focalX.value, savedTx.value, savedScale.value);
      originY.value = zoomOrigin(focalY.value, savedTy.value, savedScale.value);
    })
    .onUpdate((e) => {
      const next = clampZoomScale(savedScale.value * e.scale, MAX_ZOOM_SCALE);
      scale.value = next;
      // Keep the pinch anchored, then hold the canvas inside its own box — at 1x both
      // bounds are 0, so pinching all the way out re-centres by itself.
      tx.value = anchoredTranslate(focalX.value, originX.value, next, boxW.value);
      ty.value = anchoredTranslate(focalY.value, originY.value, next, boxH.value);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      runOnJS(reportScale)(scale.value);
    });

  const pan = Gesture.Pan()
    .enabled(zoomEnabled)
    .onUpdate((e) => {
      tx.value = clampPan(savedTx.value, e.translationX, scale.value, boxW.value);
      ty.value = clampPan(savedTy.value, e.translationY, scale.value, boxH.value);
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const composed = Gesture.Simultaneous(pan, pinch);

  const zoomStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const renderCanvas = () => {
    return (
      // The frame stays PUT and does the clipping; only the layer inside it is
      // transformed. Scaling a view that carries its own `overflow: 'hidden'` would
      // scale the clip along with it and let the image paint over the chrome.
      <View
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
              <Mask id={`eraser-mask-${activeImageIndex}`}>
                <Rect x={0} y={0} width={canvasLayout.width} height={canvasLayout.height} fill="white" />
                {committedPaths.eraser.map(stroke => (
                  <Path
                    key={stroke.id}
                    d={stroke.d}
                    stroke="black"
                    strokeWidth={stroke.width}
                    fill="none"
                  />
                ))}
                {drawingStroke?.isEraser && (
                  <Path
                    d={getPathData(drawingStroke.points)}
                    stroke="black"
                    strokeWidth={drawingStroke.width}
                    fill="none"
                  />
                )}
              </Mask>

              <G mask={`url(#eraser-mask-${activeImageIndex})`}>
                {committedPaths.ink.map(stroke => (
                  <Path
                    key={stroke.id}
                    d={stroke.d}
                    stroke={stroke.color}
                    strokeWidth={stroke.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}
                {drawingStroke && !drawingStroke.isEraser && (
                  <Path
                    d={getPathData(drawingStroke.points)}
                    stroke={drawingStroke.color}
                    strokeWidth={drawingStroke.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </G>
            </Svg>
          </View>

          {/* Drawing/Tapping Responder Overlay */}
          {(activeTool === 'draw' || activeTool === 'text') && (
            <View
              style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.01)' }]}
              {...panResponder.panHandlers}
            />
          )}

          {/* Draggable Text Notes Layer */}
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
            />
          ))}
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
