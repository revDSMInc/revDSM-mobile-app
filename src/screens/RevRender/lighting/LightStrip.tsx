import React from 'react';
import { View } from 'react-native';

/**
 * The mini light strip on every look tile: a dark panel with LED pucks in the
 * look's colours, cycling in pattern order.
 *
 * Dark regardless of app theme — it is standing in for the product at dusk, so
 * a light background would misrepresent what the rep is selling.
 */
export function LightStrip({
  colors,
  pucks = 7,
  rows = 2,
  size = 8,
  radius = 12,
  height,
}: {
  colors: string[];
  pucks?: number;
  rows?: number;
  size?: number;
  radius?: number;
  height?: number;
}) {
  const palette = colors.length ? colors : ['#FFD9A0'];

  return (
    <View
      className="w-full items-center justify-center overflow-hidden"
      style={{ backgroundColor: '#111827', borderRadius: radius, height, paddingVertical: 10 }}
    >
      {Array.from({ length: rows }).map((_, row) => (
        <View key={row} className="flex-row justify-center" style={{ marginTop: row ? size + 2 : 0 }}>
          {Array.from({ length: pucks }).map((_, i) => {
            // Continue the sequence across rows so a 3-colour look does not
            // repeat the same column twice — it should read as one long run.
            const color = palette[(row * pucks + i) % palette.length];
            return (
              <View
                key={i}
                style={{
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  marginHorizontal: size / 3,
                  backgroundColor: color,
                  // Stands in for the glow. Pucks must still read as separate
                  // points of light with dark gaps — never a continuous line.
                  shadowColor: color,
                  shadowOpacity: 0.9,
                  shadowRadius: size / 1.5,
                  shadowOffset: { width: 0, height: 0 },
                  elevation: 4,
                }}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

/** Lights Off: daylight panel, unlit grey lenses. */
export function UnlitStrip({ pucks = 7, rows = 2, size = 8, radius = 12, height }: {
  pucks?: number; rows?: number; size?: number; radius?: number; height?: number;
}) {
  return (
    <View
      className="w-full items-center justify-center overflow-hidden"
      style={{ backgroundColor: '#DCE6F0', borderRadius: radius, height, paddingVertical: 10 }}
    >
      {Array.from({ length: rows }).map((_, row) => (
        <View key={row} className="flex-row justify-center" style={{ marginTop: row ? size + 2 : 0 }}>
          {Array.from({ length: pucks }).map((_, i) => (
            <View
              key={i}
              style={{
                width: size, height: size, borderRadius: size / 2,
                marginHorizontal: size / 3, backgroundColor: '#AEB9C4',
              }}
            />
          ))}
        </View>
      ))}
    </View>
  );
}
