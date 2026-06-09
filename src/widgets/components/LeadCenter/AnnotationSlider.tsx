import React, { useRef } from 'react';
import {
  View,
  PanResponder,
} from 'react-native';
import Svg, { Rect, Defs, Pattern, LinearGradient, Stop } from 'react-native-svg';

// Custom slider for size adjustment
export const CustomSlider = ({ value, onValueChange, activeColor }: { value: number; onValueChange: (v: number) => void; activeColor: string }) => {
  const sliderWidth = useRef<number>(0);
  const startVal = useRef<number>(0);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        startVal.current = value;
        const { locationX } = evt.nativeEvent;
        if (sliderWidth.current > 0) {
          const pct = Math.max(0, Math.min(1, locationX / sliderWidth.current));
          onValueChange(pct);
          startVal.current = pct;
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        if (sliderWidth.current > 0) {
          const delta = gestureState.dx / sliderWidth.current;
          const newVal = Math.max(0, Math.min(1, startVal.current + delta));
          onValueChange(newVal);
        }
      },
    })
  ).current;

  return (
    <View
      onLayout={(e) => { sliderWidth.current = e.nativeEvent.layout.width; }}
      {...pan.panHandlers}
      style={{
        height: 30,
        justifyContent: 'center',
        flex: 1,
      }}
    >
      <View style={{ height: 8, borderRadius: 4, backgroundColor: '#2E2E2E', position: 'relative' }}>
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${value * 100}%`, backgroundColor: activeColor, borderRadius: 4 }} />
      </View>
      <View
        style={{
          position: 'absolute',
          left: `${value * 100}%`,
          marginLeft: -10,
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: '#FFFFFF',
          borderWidth: 2,
          borderColor: activeColor,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 2,
          elevation: 3,
        }}
      />
    </View>
  );
};

// Custom opacity slider with SVG checkered backdrop and linear gradient overlay
export const OpacitySlider = ({ value, onValueChange, activeColor }: { value: number; onValueChange: (v: number) => void; activeColor: string }) => {
  const sliderWidth = useRef<number>(0);
  const startVal = useRef<number>(0);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (evt, gestureState) => {
        startVal.current = value;
        const { locationX } = evt.nativeEvent;
        if (sliderWidth.current > 0) {
          const pct = Math.max(0, Math.min(1, locationX / sliderWidth.current));
          onValueChange(pct);
          startVal.current = pct;
        }
      },
      onPanResponderMove: (evt, gestureState) => {
        if (sliderWidth.current > 0) {
          const delta = gestureState.dx / sliderWidth.current;
          const newVal = Math.max(0, Math.min(1, startVal.current + delta));
          onValueChange(newVal);
        }
      },
    })
  ).current;

  return (
    <View
      onLayout={(e) => { sliderWidth.current = e.nativeEvent.layout.width; }}
      {...pan.panHandlers}
      style={{
        height: 30,
        justifyContent: 'center',
        flex: 1,
      }}
    >
      <View style={{ height: 12, borderRadius: 6, overflow: 'hidden', position: 'relative' }}>
        <Svg style={{ position: 'absolute', width: '100%', height: '100%' }}>
          <Defs>
            <Pattern id="checkered-pattern" width="16" height="16" patternUnits="userSpaceOnUse">
              <Rect width="8" height="8" fill="#CCCCCC" />
              <Rect x="8" y="8" width="8" height="8" fill="#CCCCCC" />
              <Rect x="8" y="0" width="8" height="8" fill="#EEEEEE" />
              <Rect x="0" y="8" width="8" height="8" fill="#EEEEEE" />
            </Pattern>
            <LinearGradient id="opacity-grad" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor={activeColor} stopOpacity="0" />
              <Stop offset="100%" stopColor={activeColor} stopOpacity="1" />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill="url(#checkered-pattern)" />
          <Rect width="100%" height="100%" fill="url(#opacity-grad)" />
        </Svg>
      </View>
      <View
        style={{
          position: 'absolute',
          left: `${value * 100}%`,
          marginLeft: -12,
          width: 24,
          height: 24,
          borderRadius: 12,
          backgroundColor: '#FFFFFF',
          borderWidth: 2,
          borderColor: activeColor,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.3,
          shadowRadius: 2,
          elevation: 3,
        }}
      />
    </View>
  );
};
