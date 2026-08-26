import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  PanResponder,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface DraggableTextProps {
  text: any;
  canvasLayout: { width: number; height: number };
  selectedTextId: string | null;
  setSelectedTextId: (id: string | null) => void;
  handleTextPress: (text: any) => void;
  setShowStylePanel: (show: boolean) => void;
  handleDeleteTextNote: (id: string) => void;
  handleMoveText: (id: string, newPx: number, newPy: number) => void;
  /**
   * Live pinch scale of the canvas. `gestureState.dx/dy` are SCREEN pixels while the
   * note's position is stored in canvas units, so at 3x an untouched drag would carry
   * the note three times as far as the finger. Same correction the stroke layer applies.
   */
  zoomScale?: number;
  /** False while the rep is in Zoom mode, so a pinch that lands on a note pans instead of dragging it. */
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
  const textStateRef = useRef({ text, canvasLayout, zoomScale, dragEnabled });
  const [layout, setLayout] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    textStateRef.current = { text, canvasLayout, zoomScale, dragEnabled };
  });

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
        const { text: currentText, canvasLayout: currentLayout, zoomScale: currentScale } =
          textStateRef.current;
        const scale = currentScale > 0 ? currentScale : 1;
        const deltaPx = gestureState.dx / scale / currentLayout.width;
        const deltaPy = gestureState.dy / scale / currentLayout.height;
        handleMoveText(currentText.id, startPx.current + deltaPx, startPy.current + deltaPy);
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
        width: 140,
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

          {/* Connecting vertical line & Menu */}
          {text.py >= 0.2 ? (
            <>
              <View
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: layout.width / 2,
                  width: 1,
                  height: 20,
                  backgroundColor: '#72BD00',
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  marginBottom: 20,
                  left: layout.width / 2,
                  transform: [{ translateX: -70 }],
                  width: 140,
                  zIndex: 9999,
                }}
              >
                {renderContextMenu()}
              </View>
            </>
          ) : (
            <>
              <View
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: layout.width / 2,
                  width: 1,
                  height: 20,
                  backgroundColor: '#72BD00',
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  top: '100%',
                  marginTop: 20,
                  left: layout.width / 2,
                  transform: [{ translateX: -70 }],
                  width: 140,
                  zIndex: 9999,
                }}
              >
                {renderContextMenu()}
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
};
