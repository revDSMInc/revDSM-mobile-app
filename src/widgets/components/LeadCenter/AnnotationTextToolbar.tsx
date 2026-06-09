import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';
import { CustomSlider, OpacitySlider } from './AnnotationSlider';

interface AnnotationTextToolbarProps {
  selectedText: any;
  updateSelectedText: (properties: Partial<any>) => void;
  setShowStylePanel: (show: boolean) => void;
  showFontDropdown: boolean;
  setShowFontDropdown: (show: boolean) => void;
}

export const AnnotationTextToolbar = ({
  selectedText,
  updateSelectedText,
  setShowStylePanel,
  showFontDropdown,
  setShowFontDropdown,
}: AnnotationTextToolbarProps) => {

  const textColor = selectedText.color || '#FFFFFF';
  const textOpacity = selectedText.opacity !== undefined ? selectedText.opacity : 1.0;
  const textSize = selectedText.fontSize || 16;
  const textFontStyle = selectedText.fontStyle || 'regular';
  const colors = ['#FF7043', '#4CBB17', '#42A5F5', '#FFB74D', '#FFFFFF', '#000000'];

  const fontOptions = [
    { label: 'Regular', value: 'regular' },
    { label: 'Bold', value: 'bold' },
    { label: 'Italic', value: 'italic' },
    { label: 'Bold Italic', value: 'bold-italic' },
  ];

  return (
    <View style={{ backgroundColor: '#121614', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 36 }}>
      {/* top drag chevron handle */}
      <TouchableOpacity onPress={() => setShowStylePanel(false)} style={{ alignSelf: 'center', paddingVertical: 8 }}>
        <View style={{ width: 40, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(255,255,255,0.3)' }} />
      </TouchableOpacity>

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
        {/* Decorative multi-color wheel */}
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <Svg style={{ width: '100%', height: '100%' }}>
            <Defs>
              <LinearGradient id="rainbow" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0%" stopColor="red" />
                <Stop offset="33%" stopColor="green" />
                <Stop offset="66%" stopColor="blue" />
                <Stop offset="100%" stopColor="yellow" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#rainbow)" />
          </Svg>
        </View>
      </View>

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
