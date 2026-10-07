import React, { useMemo, useRef, useState } from 'react';
import { View, PanResponder, StyleSheet, LayoutChangeEvent } from 'react-native';

const GREEN = '#4CBB17';
const THUMB = 20;

interface Props {
  value: number;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}

export function GhostSlider({ value, min = 0.1, max = 0.7, onChange }: Props) {
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    widthRef.current = w;
    setWidth(w);
  };

  const emit = (x: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const ratio = Math.max(0, Math.min(1, x / w));
    onChange(min + ratio * (max - min));
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => emit(e.nativeEvent.locationX),
        onPanResponderMove: (e) => emit(e.nativeEvent.locationX),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const thumbLeft = Math.max(0, ratio * width - THUMB / 2);

  return (
    <View style={styles.hitArea} onLayout={onLayout} {...responder.panHandlers}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
      </View>
      <View style={[styles.thumb, { left: thumbLeft }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  hitArea: { flex: 1, height: 32, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: '#3a4a3a', overflow: 'hidden' },
  fill: { height: 4, backgroundColor: GREEN },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: GREEN,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
