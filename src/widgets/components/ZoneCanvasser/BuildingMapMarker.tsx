import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { getMarkerColor } from '../../../utils/zone-canvasser-status';

type Props = {
  status: string | null | undefined;
  size?: 'sm' | 'md';
};

/** Web buildings-layer.js — single shield+home path, status color only (no white overlay). */
const SHIELD_HOME_PATH =
  'M11 13h2v3h3v-5h2l-6-5l-6 5h2v5h3zm1-12l9 4v6c0 5.55-3.84 10.74-9 12c-5.16-1.26-9-6.45-9-12V5z';

const SIZES = {
  sm: 22,
  md: 34,
};

export function BuildingMapMarker({ status, size = 'md' }: Props) {
  const fillColor = getMarkerColor(status);
  const iconSize = SIZES[size];

  return (
    <View style={[styles.container, { width: iconSize, height: iconSize }]}>
      <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24">
        <Path fill={fillColor} d={SHIELD_HOME_PATH} />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
