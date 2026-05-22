import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ClusterSize } from '../../../utils/zone-canvasser-cluster';

type Props = {
  count: number;
  size: ClusterSize;
};

/** Leaflet markercluster styles from web buildings-layer.js */
const CLUSTER_STYLES: Record<
  ClusterSize,
  { outer: string; inner: string }
> = {
  small: {
    outer: 'rgba(181, 226, 140, 0.6)',
    inner: 'rgba(110, 204, 57, 0.6)',
  },
  medium: {
    outer: 'rgba(241, 211, 87, 0.6)',
    inner: 'rgba(240, 194, 12, 0.6)',
  },
  large: {
    outer: 'rgba(253, 156, 115, 0.6)',
    inner: 'rgba(241, 128, 23, 0.6)',
  },
};

/** Double-circle cluster bubble with count — matches web zone-canvasser. */
export function ClusterMapMarker({ count, size }: Props) {
  const colors = CLUSTER_STYLES[size];
  const label = count > 999 ? '999+' : String(count);

  return (
    <View style={styles.outer} accessibilityLabel={`${count} buildings`}>
      <View style={[styles.outerRing, { backgroundColor: colors.outer }]}>
        <View style={[styles.inner, { backgroundColor: colors.inner }]}>
          <Text style={styles.label}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

const OUTER = 40;
const INNER = 30;

const styles = StyleSheet.create({
  outer: {
    width: OUTER,
    height: OUTER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRing: {
    width: OUTER,
    height: OUTER,
    borderRadius: OUTER / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: {
    width: INNER,
    height: INNER,
    borderRadius: INNER / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
});
