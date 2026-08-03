import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';

/**
 * Placeholder line-art house used wherever a rep reference photo would appear.
 *
 * The rep's ARC shots aren't available from the API yet, so this stands in as the
 * ghost the installer aligns against. Once `PhotoTag.repPhotoUrl` is populated,
 * callers pass a real <Image> instead and this is only a fallback.
 */
export function HouseGhost({ opacity = 0.35 }: { opacity?: number }) {
  return (
    <Svg viewBox="0 0 200 140" style={[StyleSheet.absoluteFill, { opacity }]}>
      <G stroke="#dff5cf" strokeWidth={2.5} fill="none">
        <Path d="M20 70 L100 20 L180 70" />
        <Path d="M32 70 L32 125 L168 125 L168 70" />
        <Rect x={88} y={90} width={26} height={35} />
        <Rect x={45} y={82} width={24} height={20} />
        <Rect x={132} y={82} width={24} height={20} />
        <Path d="M20 70 L180 70" strokeWidth={4} stroke="#8fe05f" />
        <Path d="M168 70 L168 122" strokeWidth={4} stroke="#8fe05f" />
      </G>
    </Svg>
  );
}

/**
 * Deterministic gradient per tag id, so switching tags visibly swaps the stand-in
 * "rep photo" during design review. Purely cosmetic — drops out with real photos.
 */
export function tagTint(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h}, 26%, 24%)`;
}
