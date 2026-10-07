import React from 'react';
import { View } from 'react-native';

const HALOS = [
  { scale: 3.2, opacity: 0.1 },
  { scale: 2.2, opacity: 0.16 },
  { scale: 1.5, opacity: 0.3 },
];

const CHANNEL_HEIGHT = 6;
const CHANNEL_BLEED = 24;

export function LightStrip({
  colors,
  pucks = 7,
  rows = 2,
  size = 8,
  radius = 12,
  height,
  glow = true,
}: {
  colors: string[];
  pucks?: number;
  rows?: number;
  size?: number;
  radius?: number;
  height?: number;
  glow?: boolean;
}) {
  const palette = colors.length ? colors : ['#FFD9A0'];

  return (
    <View
      className="w-full items-center justify-center overflow-hidden"
      style={{ backgroundColor: '#111827', borderRadius: radius, height, paddingVertical: 10 }}
    >
      {Array.from({ length: rows }).map((_, row) => (
        <View key={row} style={{ marginTop: row ? size + 2 : 0 }}>
          {/*
            The aluminium channel the pucks sit in: a faint track with a lit
            top edge. Easy to leave out — the mock has it, and without it the
            lights float in the dark instead of reading as a fitted product.
            Absolutely positioned so it never affects the puck row's layout.
          */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: -CHANNEL_BLEED,
              right: -CHANNEL_BLEED,
              top: size / 2 - CHANNEL_HEIGHT / 2,
              height: CHANNEL_HEIGHT,
              backgroundColor: 'rgba(255,255,255,0.05)',
              borderTopWidth: 1,
              borderTopColor: 'rgba(255,255,255,0.14)',
            }}
          />

          <View className="flex-row justify-center">
            {Array.from({ length: pucks }).map((_, i) => {
              const color = palette[(row * pucks + i) % palette.length];
              return (
                <View
                  key={i}
                  className="items-center justify-center"
                  style={{ width: size, height: size, marginHorizontal: size / 3 }}
                >
                  {/*
                    ⚠️ The glow is THREE translucent halos, not a shadow.
                    `shadowColor` / `shadowOpacity` / `shadowRadius` are
                    iOS-only; Android's `elevation` draws a grey drop shadow,
                    so a coloured glow is simply not expressible that way and
                    the strip looked flat and muddy on Android.

                    ⚠️ They are absolutely positioned and `pointerEvents="none"`
                    so they cannot affect layout. The dark gaps between pucks
                    ARE the product — if the halos ever push the pucks apart or
                    merge into a continuous line, the strip stops describing
                    what is being sold.
                  */}
                  {glow && HALOS.map((h) => (
                    <View
                      key={h.scale}
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        width: size * h.scale,
                        height: size * h.scale,
                        borderRadius: (size * h.scale) / 2,
                        backgroundColor: color,
                        opacity: h.opacity,
                      }}
                    />
                  ))}

                  <View
                    style={{
                      width: size,
                      height: size,
                      borderRadius: size / 2,
                      backgroundColor: color,
                    }}
                  />
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

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
