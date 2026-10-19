import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  PanResponder,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const MENU_WIDTH = 140;
// Menu (~118) + connector (20) + a little air.
const MENU_CLEARANCE = 148;

interface DraggableTextProps {
  text: any;
  canvasLayout: { width: number; height: number };
  selectedTextId: string | null;
  setSelectedTextId: (id: string | null) => void;
  handleTextPress: (text: any) => void;
  setShowStylePanel: (show: boolean) => void;
  handleDeleteTextNote: (id: string) => void;
  handleMoveText: (id: string, newPx: number, newPy: number) => void;
  zoomScale?: number;
  dragEnabled?: boolean;
}

export const DraggableText = ({
  text,
  canvasLayout,
  selectedTextId,
  setSelectedTextId,
  handleTextPress,
  setShowStylePanel,
  handleDeleteTextNote,
  handleMoveText,
  zoomScale = 1,
  dragEnabled = true,
}: DraggableTextProps) => {
  const startPx = useRef(text.px);
  const startPy = useRef(text.py);
  const [layout, setLayout] = useState<{ width: number; height: number } | null>(null);
  const textStateRef = useRef({ text, canvasLayout, zoomScale, dragEnabled, layout });

  useEffect(() => {
    textStateRef.current = { text, canvasLayout, zoomScale, dragEnabled, layout };
  });

  // The note's whole box (text + padding) must stay inside the photo, so the limit depends on its measured size.
  const maxFraction = (canvas: number, box: number | undefined) =>
    box && canvas > 0 ? Math.max(0, (canvas - box) / canvas) : 1;

  // A tap placed near the right/bottom edge, a longer edit, or a bigger font can push the box past the photo:
  // pull it back as soon as its size is known.
  useEffect(() => {
    if (!layout) return;
    const nx = Math.min(text.px, maxFraction(canvasLayout.width, layout.width));
    const ny = Math.min(text.py, maxFraction(canvasLayout.height, layout.height));
    if (nx !== text.px || ny !== text.py) handleMoveText(text.id, nx, ny);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout?.width, layout?.height, text.px, text.py, canvasLayout.width, canvasLayout.height]);

  const isSelected = text.id === selectedTextId;

  const textPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => textStateRef.current.dragEnabled,
      onMoveShouldSetPanResponder: () => textStateRef.current.dragEnabled,
      onPanResponderGrant: () => {
        startPx.current = textStateRef.current.text.px;
        startPy.current = textStateRef.current.text.py;
      },
      onPanResponderMove: (evt, gestureState) => {
        const { text: currentText, canvasLayout: currentLayout, zoomScale: currentScale, layout: box } =
          textStateRef.current;
        const scale = currentScale > 0 ? currentScale : 1;
        const deltaPx = gestureState.dx / scale / currentLayout.width;
        const deltaPy = gestureState.dy / scale / currentLayout.height;
        const nextPx = Math.min(startPx.current + deltaPx, maxFraction(currentLayout.width, box?.width));
        const nextPy = Math.min(startPy.current + deltaPy, maxFraction(currentLayout.height, box?.height));
        handleMoveText(currentText.id, nextPx, nextPy);
      },
      onPanResponderRelease: (evt, gestureState) => {
        const distance = Math.sqrt(gestureState.dx * gestureState.dx + gestureState.dy * gestureState.dy);
        if (distance < 8) {
          setSelectedTextId(textStateRef.current.text.id);
        }
      }
    })
  ).current;

  const getFontStyle = (style: string) => {
    switch (style) {
      case 'bold':
        return { fontWeight: 'bold' as const, fontStyle: 'normal' as const };
      case 'italic':
        return { fontWeight: 'normal' as const, fontStyle: 'italic' as const };
      case 'bold-italic':
        return { fontWeight: 'bold' as const, fontStyle: 'italic' as const };
      case 'regular':
      default:
        return { fontWeight: 'normal' as const, fontStyle: 'normal' as const };
    }
  };

  const renderContextMenu = () => (
    <View
      style={{
        backgroundColor: '#1E1E1E',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.15)',
        paddingVertical: 4,
        width: MENU_WIDTH,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        elevation: 4,
      }}
    >
      <TouchableOpacity
        onPress={() => handleTextPress(text)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <Icon name="format-text" size={16} color="white" style={{ marginRight: 8 }} />
        <Text style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>Edit Text</Text>
      </TouchableOpacity>

      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />

      <TouchableOpacity
        onPress={() => setShowStylePanel(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <Icon name="tune" size={16} color="white" style={{ marginRight: 8 }} />
        <Text style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>Adjust Style</Text>
      </TouchableOpacity>

      <View style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />

      <TouchableOpacity
        onPress={() => {
          setSelectedTextId(null);
          handleDeleteTextNote(text.id);
        }}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 10,
        }}
      >
        <Icon name="delete-outline" size={16} color="#FF5252" style={{ marginRight: 8 }} />
        <Text style={{ color: '#FF5252', fontSize: 13, fontWeight: 'bold' }}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View
      {...textPanResponder.panHandlers}
      onLayout={(e) => {
        setLayout(e.nativeEvent.layout);
      }}
      style={{
        position: 'absolute',
        left: text.px * canvasLayout.width,
        top: text.py * canvasLayout.height,
        padding: 8,
        borderWidth: isSelected ? 1 : 0,
        borderColor: '#72BD00',
        borderRadius: 4,
      }}
    >
      <Text
        style={[
          getFontStyle(text.fontStyle || 'regular'),
          {
            color: text.color || '#FFFFFF',
            fontSize: text.fontSize || 16,
            opacity: text.opacity !== undefined ? text.opacity : 1.0,
            textShadowColor: 'rgba(0,0,0,0.8)',
            textShadowOffset: { width: 1, height: 1 },
            textShadowRadius: 2,
          }
        ]}
      >
        {text.text}
      </Text>

      {isSelected && layout && (
        <>
          {/* Left handle */}
          <View
            style={{
              position: 'absolute',
              left: -4,
              top: layout.height / 2 - 4,
              width: 8,
              height: 8,
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: '#72BD00',
            }}
          />
          {/* Right handle */}
          <View
            style={{
              position: 'absolute',
              right: -4,
              top: layout.height / 2 - 4,
              width: 8,
              height: 8,
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: '#72BD00',
            }}
          />

          {/* Connecting vertical line & Menu. The menu is kept inside the photo: the canvas frame clips
              (overflow: hidden), so a menu centred on a note near an edge was cut off. */}
          {(() => {
            const textLeft = text.px * canvasLayout.width;
            const textTop = text.py * canvasLayout.height;
            const spaceAbove = textTop;
            const spaceBelow = canvasLayout.height - (textTop + layout.height);
            const placeAbove = spaceAbove >= MENU_CLEARANCE || spaceAbove >= spaceBelow;
            const centred = textLeft + layout.width / 2 - MENU_WIDTH / 2;
            const menuLeft = Math.max(0, Math.min(canvasLayout.width - MENU_WIDTH, centred)) - textLeft;
            const edge = placeAbove ? { bottom: '100%' as const } : { top: '100%' as const };
            const gap = placeAbove ? { marginBottom: 20 } : { marginTop: 20 };
            return (
              <>
                <View
                  style={{
                    position: 'absolute',
                    ...edge,
                    left: layout.width / 2,
                    width: 1,
                    height: 20,
                    backgroundColor: '#72BD00',
                  }}
                />
                <View
                  style={{
                    position: 'absolute',
                    ...edge,
                    ...gap,
                    left: menuLeft,
                    width: MENU_WIDTH,
                    zIndex: 9999,
                  }}
                >
                  {renderContextMenu()}
                </View>
              </>
            );
          })()}
        </>
      )}
    </View>
  );
};
