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

const MAX_ZOOM_SCALE = 5;

interface AnnotationCanvasProps {
  canvasLayout: { width: number; height: number };
  activeTool: 'none' | 'zoom' | 'draw' | 'text';
  currentPhoto: any;
  activeImageIndex: number;
  currentStrokes: any[];
  activeStroke?: any;
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
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const originX = useSharedValue(0);
  const originY = useSharedValue(0);
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);

  const [jsScale, setJsScale] = useState(1);

  const [liveStroke, setLiveStroke] = useState<any | null>(null);
  useEffect(() => {
    if (!subscribeActiveStroke) return;
    return subscribeActiveStroke(setLiveStroke);
  }, [subscribeActiveStroke]);
  const drawingStroke = liveStroke || activeStroke || null;

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

  useEffect(() => {
    boxW.value = canvasLayout.width;
    boxH.value = canvasLayout.height;
  }, [canvasLayout.width, canvasLayout.height, boxW, boxH]);

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
