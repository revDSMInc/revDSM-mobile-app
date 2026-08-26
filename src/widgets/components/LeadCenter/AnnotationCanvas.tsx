import React from 'react';
import {
  View,
  Image,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import Svg, { Path, Mask, Rect, G } from 'react-native-svg';
import { DraggableText } from './DraggableText';

interface AnnotationCanvasProps {
  canvasLayout: { width: number; height: number };
  activeTool: 'none' | 'zoom' | 'draw' | 'text';
  currentPhoto: any;
  activeImageIndex: number;
  currentStrokes: any[];
  activeStroke: any;
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
              {currentStrokes.filter(s => s.isEraser).map(stroke => (
                <Path
                  key={stroke.id}
                  d={getPathData(stroke.points)}
                  stroke="black"
                  strokeWidth={stroke.width}
                  fill="none"
                />
              ))}
              {activeStroke?.isEraser && (
                <Path
                  d={getPathData(activeStroke.points)}
                  stroke="black"
                  strokeWidth={activeStroke.width}
                  fill="none"
                />
              )}
            </Mask>

            <G mask={`url(#eraser-mask-${activeImageIndex})`}>
              {currentStrokes.filter(s => !s.isEraser).map(stroke => (
                <Path
                  key={stroke.id}
                  d={getPathData(stroke.points)}
                  stroke={stroke.color}
                  strokeWidth={stroke.width}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {activeStroke && !activeStroke.isEraser && (
                <Path
                  d={getPathData(activeStroke.points)}
                  stroke={activeStroke.color}
                  strokeWidth={activeStroke.width}
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
          />
        ))}
      </View>
    );
  };

  // The zoom ScrollView stays mounted for EVERY tool.
  //
  // It used to wrap the canvas only while `activeTool === 'zoom'`, so switching to Draw
  // unmounted it and threw the zoom away — the rep lined up a detail, picked the pen,
  // and was back at 1x with no way to make a precise stroke.
  //
  // Only its own gestures are gated now: `scrollEnabled` is off unless the rep is in
  // Zoom mode, so a one-finger drag draws instead of panning the image. iOS keeps the
  // current zoomScale while scrolling is disabled, which is what preserves the view.
  return (
    <ScrollView
      maximumZoomScale={5}
      minimumZoomScale={1}
      scrollEnabled={activeTool === 'zoom'}
      onScroll={(e) => onZoomChange?.(e.nativeEvent.zoomScale || 1)}
      scrollEventThrottle={16}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center' }}
      className="w-full h-full"
    >
      {renderCanvas()}
    </ScrollView>
  );
};
