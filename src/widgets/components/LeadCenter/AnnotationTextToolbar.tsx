import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { CustomSlider, OpacitySlider } from './AnnotationSlider';
import { PaletteButton, PaletteGrid } from './ColorPalette';
import { QUICK_COLORS } from '../../../utils/annotation-colors';

interface AnnotationTextToolbarProps {
  selectedText: any;
  updateSelectedText: (properties: Partial<any>) => void;
  setShowStylePanel: (show: boolean) => void;
  showFontDropdown: boolean;
  setShowFontDropdown: (show: boolean) => void;
  /** Done / handle: closes the panel AND the note's menu (the screen also deselects the note). */
  onDone?: () => void;
  /** The quick-colour row (a colour picked from the grid replaces the active swatch in it). */
  quickColors?: string[];
  /** A colour chosen in the full grid: the screen restyles the note AND updates the quick row. */
  onPickGridColor?: (color: string) => void;
}

export const AnnotationTextToolbar = ({
  selectedText,
  updateSelectedText,
  setShowStylePanel,
  showFontDropdown,
  setShowFontDropdown,
  onDone,
  quickColors,
  onPickGridColor,
}: AnnotationTextToolbarProps) => {

  // The full colour grid replaces the opacity / size rows while open, so the panel keeps its height (REVUIUX-589).
  const [showPalette, setShowPalette] = React.useState(false);

  // Closing the panel also closes its font dropdown, so the next open starts clean.
  const closePanel = () => {
    setShowFontDropdown(false);
    setShowStylePanel(false);
    onDone?.();
  };

  const textColor = selectedText.color || '#FFFFFF';
  const textOpacity = selectedText.opacity !== undefined ? selectedText.opacity : 1.0;
  const textSize = selectedText.fontSize || 16;
  const textFontStyle = selectedText.fontStyle || 'regular';
  const colors = quickColors || QUICK_COLORS;

  const fontOptions = [
    { label: 'Regular', value: 'regular' },
    { label: 'Bold', value: 'bold' },
    { label: 'Italic', value: 'italic' },
    { label: 'Bold Italic', value: 'bold-italic' },
  ];

  return (
    <View style={{ backgroundColor: '#121614', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36 }}>
      {/* Header: grab handle (tap closes) + an explicit Done button. The handle alone was the only way out and nobody found it. */}
      <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 36 }}>
        <TouchableOpacity
          onPress={closePanel}
          hitSlop={{ top: 10, bottom: 10, left: 40, right: 40 }}
          style={{ alignSelf: 'center', paddingVertical: 8 }}
        >
          <View style={{ width: 40, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.3)' }} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={closePanel}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Done adjusting style"
          style={{
            position: 'absolute',
            right: 0,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 14,
            paddingVertical: 7,
            borderRadius: 999,
            backgroundColor: '#72BD00',
          }}
        >
          <Icon name="check" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12, marginLeft: 4 }}>Done</Text>
        </TouchableOpacity>
      </View>

      {/* Colors row */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 16 }}>
        {colors.map((color) => {
          const isSelected = textColor === color;
          return (
            <TouchableOpacity
              key={color}
              onPress={() => updateSelectedText({ color })}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                borderWidth: isSelected ? 2 : 0,
                borderColor: color,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  backgroundColor: color,
                  borderWidth: isSelected ? 2.5 : 0,
                  borderColor: '#121614',
                }}
              />
            </TouchableOpacity>
          );
        })}
        <PaletteButton open={showPalette} onPress={() => setShowPalette((v) => !v)} size={34} />
      </View>

      {showPalette ? (
        <View style={{ marginBottom: 16 }}>
          <PaletteGrid
            value={textColor}
            swatch={34}
            onPick={(color) => {
              if (onPickGridColor) onPickGridColor(color);
              else updateSelectedText({ color });
              setShowPalette(false);
            }}
          />
        </View>
      ) : (
        <>
      {/* Opacity slider row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <OpacitySlider
          value={textOpacity}
          onValueChange={(val) => updateSelectedText({ opacity: val })}
          activeColor={textColor}
        />
      </View>

      {/* Size slider row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14, width: 40 }}>Size</Text>
        <CustomSlider
          value={(textSize - 10) / (72 - 10)}
          onValueChange={(val) => {
            const newSize = Math.round(10 + val * (72 - 10));
            updateSelectedText({ fontSize: newSize });
          }}
          activeColor={textColor}
        />
        <Text style={{ color: 'white', fontWeight: 'bold', fontSize: 14, width: 30, textAlign: 'right' }}>{textSize}</Text>
      </View>

        </>
      )}

      {/* Font selector dropdown */}
      <View style={{ position: 'relative', zIndex: 1000 }}>
        <TouchableOpacity
          onPress={() => setShowFontDropdown(!showFontDropdown)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: '#1E1E1E',
            borderRadius: 8,
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
          }}
        >
          <Text style={{ color: 'white', fontWeight: 'bold' }}>
            {fontOptions.find(o => o.value === textFontStyle)?.label || 'Regular'}
          </Text>
          <Icon name="chevron-down" size={16} color="white" />
        </TouchableOpacity>

        {showFontDropdown && (
          <View
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              marginBottom: 4,
              backgroundColor: '#1E1E1E',
              borderRadius: 8,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.15)',
              overflow: 'hidden',
              zIndex: 9999,
            }}
          >
            {fontOptions.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => {
                  updateSelectedText({ fontStyle: opt.value });
                  setShowFontDropdown(false);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: 'rgba(255,255,255,0.05)',
                  backgroundColor: textFontStyle === opt.value ? '#007AFF' : 'transparent',
                }}
              >
                {textFontStyle === opt.value && (
                  <Icon name="check" size={16} color="white" style={{ marginRight: 8 }} />
                )}
                <Text
                  style={{
                    color: 'white',
                    fontWeight: textFontStyle === opt.value ? 'bold' : 'normal',
                    marginLeft: textFontStyle === opt.value ? 0 : 24,
                  }}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </View>
  );
};
