import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { G, Path, Rect } from 'react-native-svg';

/**
 * Placeholder line-art house for an EMPTY reference frame — the tagger's reference pane
 * and the matched-pair review, where a rep photo would have gone.
 *
 * ⚠️ Never draw it OVER a photo or over the live viewfinder. It used to be the camera's
 * fallback when a tag had no reference, so installers saw the drawing sitting on top of
 * the shot they were taking and read it as a broken image burnt into the capture. The
 * camera now shows nothing at all in that case — see `hasGhost` in `InstallerCamera.tsx`.
 * In an empty frame it is unambiguous (the caption beside it reads "NO REP PHOTO FOR THIS
 * TAG"); on top of a real image it is not.
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
