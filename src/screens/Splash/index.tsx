import React, { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, View, StatusBar, useWindowDimensions, Animated, Easing } from 'react-native';
import Svg, { Rect, G, Path, Defs, RadialGradient, LinearGradient, Stop } from 'react-native-svg';

const SPLASH_BG = '#0E2A1C';

const SPLASH_HOLD_MS = 1450;

const BUILD_MS = 1100;

const CHEVRON_LEN = 88;
const CHEVRON_D =
  'M0 24.2826L29.0627 2.48562C33.4815 -0.828541 37.9004 -0.828541 42.3193 2.48562L71.382 24.2826';
const CHIM_D = 'M0 18.1004V0';
const CHIM_LEN = 19;
const STROKE_W = 12.2369;

const AnimatedPath = Animated.createAnimatedComponent(Path);

type Props = {
  onFinish: () => void;
};

export default function SplashScreen({ onFinish }: Props) {
  const { width, height } = useWindowDimensions();
  const finished = useRef(false);

  const progress = useRef(new Animated.Value(0)).current;

  const finish = useCallback(() => {
    if (finished.current) return;
    finished.current = true;
    onFinish();
  }, [onFinish]);

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: BUILD_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    anim.start();
    const timer = setTimeout(finish, SPLASH_HOLD_MS);
    return () => {
      anim.stop();
      clearTimeout(timer);
    };
  }, [finish, progress]);

  const rBotOffset = progress.interpolate({ inputRange: [0, 0.25, 1], outputRange: [CHEVRON_LEN, 0, 0] });
  const rBotOpacity = progress.interpolate({ inputRange: [0, 0.04, 1], outputRange: [0, 1, 1] });

  const rMidOffset = progress.interpolate({ inputRange: [0, 0.2, 0.45, 1], outputRange: [CHEVRON_LEN, CHEVRON_LEN, 0, 0] });
  const rMidOpacity = progress.interpolate({ inputRange: [0, 0.2, 0.24, 1], outputRange: [0, 0, 1, 1] });

  const rTopOffset = progress.interpolate({ inputRange: [0, 0.45, 0.72, 1], outputRange: [CHEVRON_LEN, CHEVRON_LEN, 0, 0] });
  const rTopOpacity = progress.interpolate({ inputRange: [0, 0.45, 0.49, 1], outputRange: [0, 0, 1, 1] });

  const chimOffset = progress.interpolate({ inputRange: [0, 0.72, 0.96, 1], outputRange: [CHIM_LEN, CHIM_LEN, 0, 0] });
  const chimOpacity = progress.interpolate({ inputRange: [0, 0.72, 0.74, 1], outputRange: [0, 0, 1, 1] });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={SPLASH_BG} />
      {/* `slice` = cover: fills the screen edge-to-edge (old video "cover" behaviour). */}
      <Svg width={width} height={height} viewBox="0 0 440 956" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <RadialGradient
            id="paint0"
            cx="0"
            cy="0"
            r="1"
            gradientUnits="userSpaceOnUse"
            gradientTransform="matrix(320.117 2.80079 -1.21477 695.527 220 451.393)"
          >
            <Stop stopColor="#153F27" />
            <Stop offset="1" stopColor="#0C2218" />
          </RadialGradient>
          <LinearGradient id="paint1" x1="-0.2" y1="-0.0991416" x2="-0.2" y2="18.0296" gradientUnits="userSpaceOnUse">
            <Stop stopColor="#CDF3AB" />
            <Stop offset="1" stopColor="#84CF72" />
          </LinearGradient>
          <LinearGradient id="paint2" x1="35.6627" y1="-0.885193" x2="35.6627" y2="74.1792" gradientUnits="userSpaceOnUse">
            <Stop stopColor="#CDF3AB" />
            <Stop offset="0.5" stopColor="#7FE653" />
            <Stop offset="1" stopColor="#49C962" />
          </LinearGradient>
          <LinearGradient id="paint3" x1="35.6627" y1="-25.8689" x2="35.6627" y2="49.1955" gradientUnits="userSpaceOnUse">
            <Stop stopColor="#CDF3AB" />
            <Stop offset="0.5" stopColor="#7FE653" />
            <Stop offset="1" stopColor="#49C962" />
          </LinearGradient>
          <LinearGradient id="paint4" x1="35.6627" y1="-50.8526" x2="35.6627" y2="24.2118" gradientUnits="userSpaceOnUse">
            <Stop stopColor="#CDF3AB" />
            <Stop offset="0.5" stopColor="#7FE653" />
            <Stop offset="1" stopColor="#49C962" />
          </LinearGradient>
        </Defs>

        {/* Full-screen dark field + radial vignette (matches the SVG's own background). */}
        <Rect width={440} height={956} fill="#0E2A1C" />
        <Rect width={440} height={956} fill="url(#paint0)" />

        {/* Loader group, positioned exactly as in the export (translate 171,304). The
            gradients are userSpaceOnUse, so each chevron sits in its own translated G
            to keep the unified gradient continuous across the stacked chevrons. */}
        <G transform="translate(171 304)">
          {/* The little "chimney" stub — rendered FIRST so it sits BEHIND the
              chevrons (matches the SVG's paint order, where #chim is drawn first).
              It DRAWS bottom → top via strokeDashoffset (same technique as the
              chevrons), so the vertical line rises up out from behind the top
              chevron instead of scaling/popping in. */}
          <G x={69.8524} y={11.8543}>
            <AnimatedPath
              d={CHIM_D}
              fill="none"
              stroke="url(#paint1)"
              strokeWidth={STROKE_W}
              strokeLinecap="round"
              strokeDasharray={[CHIM_LEN, CHIM_LEN]}
              strokeDashoffset={chimOffset}
              opacity={chimOpacity}
            />
          </G>
          {/* bottom chevron — draws first */}
          <G transform="translate(13.7665 70.6806)">
            <AnimatedPath
              d={CHEVRON_D}
              fill="none"
              stroke="url(#paint4)"
              strokeWidth={STROKE_W}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[CHEVRON_LEN, CHEVRON_LEN]}
              strokeDashoffset={rBotOffset}
              opacity={rBotOpacity}
            />
          </G>
          {/* middle chevron */}
          <G x={13.7665} y={45.6969}>
            <AnimatedPath
              d={CHEVRON_D}
              fill="none"
              stroke="url(#paint3)"
              strokeWidth={STROKE_W}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[CHEVRON_LEN, CHEVRON_LEN]}
              strokeDashoffset={rMidOffset}
              opacity={rMidOpacity}
            />
          </G>
          {/* top chevron — draws last */}
          <G x={13.7665} y={20.7133}>
            <AnimatedPath
              d={CHEVRON_D}
              fill="none"
              stroke="url(#paint2)"
              strokeWidth={STROKE_W}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={[CHEVRON_LEN, CHEVRON_LEN]}
              strokeDashoffset={rTopOffset}
              opacity={rTopOpacity}
            />
          </G>
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: SPLASH_BG,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    elevation: 10000,
  },
});
