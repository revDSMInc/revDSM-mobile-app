import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { paletteGrid, sameColor } from '../../../utils/annotation-colors';

// The palette button + full colour grid shared by the Pen, Shapes and Text tools (REVUIUX-589). The button used to be a decorative picture in
// each of them. The parent owns `open`, so it can swap the grid in for its sliders (keeping the panel's height) and close it on a pick; the
// pick itself lands in the parent's quick-colour row (utils/annotation-colors.ts replaceQuickColor).

export const PaletteButton = ({ open, onPress, size = 32 }: { open: boolean; onPress: () => void; size?: number }) => (
  // The app's own palette icon (grey disc + palette glyph), as the Pen panel always showed it. It never changes with the picked colour: that goes into
  // the quick row (replacing the active swatch). Only a green ring while the grid is open.
  <TouchableOpacity
    onPress={onPress}
    accessibilityLabel="More colours"
    style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: 'rgba(255,255,255,0.05)',
      borderWidth: open ? 2 : 0,
      borderColor: '#72BD00',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <Icon name="palette" size={Math.round(size * 0.56)} color={open ? '#72BD00' : 'white'} />
  </TouchableOpacity>
);

export const PaletteGrid = ({ value, onPick, swatch = 30 }: { value?: string | null; onPick: (color: string) => void; swatch?: number }) => (
  <View>
    {paletteGrid().map((row, ri) => (
      <View key={ri} style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: ri === paletteGrid().length - 1 ? 0 : 10 }}>
        {row.map((color) => {
          const on = sameColor(value, color);
          return (
            <TouchableOpacity
              key={color}
              onPress={() => onPick(color)}
              accessibilityLabel={`Colour ${color}`}
              style={{
                width: swatch,
                height: swatch,
                borderRadius: swatch / 2,
                backgroundColor: color,
                borderWidth: on ? 2.5 : 1,
                borderColor: on ? '#FFFFFF' : 'rgba(255,255,255,0.12)',
              }}
            />
          );
        })}
      </View>
    ))}
  </View>
);
