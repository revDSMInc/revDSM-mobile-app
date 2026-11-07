import React, { useEffect, useMemo, useRef } from 'react';
import { View, Animated, Easing, StyleSheet } from 'react-native';
import { ShapeSource, FillLayer, LineLayer, MarkerView } from '@rnmapbox/maps';
import { coneRotationDeg } from '../../../utils/zone-heading';

const BLUE = '#0D47A1';
const RING_BLUE = '#1565C0';

function circlePolygon(lng: number, lat: number, radiusM: number, points = 64) {
  const coords: [number, number][] = [];
  const earth = 6378137; // metres
  const dLat = (radiusM / earth) * (180 / Math.PI);
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  for (let i = 0; i <= points; i += 1) {
    const theta = (i / points) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return {
    type: 'Feature' as const,
    geometry: { type: 'Polygon' as const, coordinates: [coords] },
    properties: {},
  };
}

type Props = {
  latitude: number;
  longitude: number;
  heading?: number | null;
  accuracy?: number | null;
  /** Live map rotation in degrees. An Animated.Value, so a spin moves the cone without a render. */
  mapBearing: Animated.Value;
  /** The rotation when this marker mounts. It can mount after the map was already spun. */
  initialBearing?: number;
};

export function UserLocationMarker({
  latitude,
  longitude,
  heading = null,
  accuracy = null,
  mapBearing,
  initialBearing = 0,
}: Props) {
  const pulse = useRef(new Animated.Value(0)).current;

  /**
   * ⚠️ The cone is a view over the map, so its `rotate` is from the top of the SCREEN while the
   * compass is from NORTH. Spinning the map used to leave it still on screen while the ground
   * turned under it. See `utils/zone-heading.ts`.
   */
  const bearingRef = useRef(initialBearing);
  const headingRef = useRef(heading);
  headingRef.current = heading;
  const coneRotation = useRef(new Animated.Value(coneRotationDeg(heading, initialBearing))).current;

  useEffect(() => {
    const id = mapBearing.addListener(({ value }) => {
      bearingRef.current = value;
      coneRotation.setValue(coneRotationDeg(headingRef.current, value));
    });
    return () => mapBearing.removeListener(id);
  }, [mapBearing, coneRotation]);

  useEffect(() => {
    coneRotation.setValue(coneRotationDeg(heading, bearingRef.current));
  }, [heading, coneRotation]);

  const coneRotate = coneRotation.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] });

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 2000,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const radius = accuracy && accuracy > 0 ? accuracy : 20;
  const ring = useMemo(
    () =>
      typeof longitude === 'number' && typeof latitude === 'number'
        ? circlePolygon(longitude, latitude, radius)
        : null,
    [longitude, latitude, radius]
  );

  if (typeof longitude !== 'number' || typeof latitude !== 'number') return null;

  const showCone = heading !== null && !Number.isNaN(heading);

  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.4] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.8, 0, 0] });

  return (
    <>
      {/* Accuracy ring */}
      {ring && (
        <ShapeSource id="ulm-accuracy" shape={ring}>
          <FillLayer id="ulm-accuracy-fill" style={{ fillColor: RING_BLUE, fillOpacity: 0.15 }} />
          <LineLayer
            id="ulm-accuracy-line"
            style={{ lineColor: RING_BLUE, lineOpacity: 0.8, lineWidth: 2 }}
          />
        </ShapeSource>
      )}

      {/* Heading cone + pulsing blue dot */}
      <MarkerView
        coordinate={[longitude, latitude]}
        anchor={{ x: 0.5, y: 0.5 }}
        allowOverlap={true}
      >
        <View style={styles.wrapper} pointerEvents="none">
          {/* Heading cone: a full-size square centred on the dot so rotating it
              spins the cone around the dot (apex at dot, fanning north by default). */}
          {showCone && (
            <Animated.View
              style={[styles.coneContainer, { transform: [{ rotate: coneRotate }] }]}
              pointerEvents="none"
            >
              <View style={styles.coneTriangle} />
            </Animated.View>
          )}

          {/* Pulse ring */}
          <Animated.View
            style={[
              styles.pulseRing,
              { transform: [{ scale: pulseScale }], opacity: pulseOpacity },
            ]}
          />

          {/* Blue dot */}
          <View style={styles.dot} />
        </View>
      </MarkerView>
    </>
  );
}

const CONE_SIZE = 120;

const styles = StyleSheet.create({
  wrapper: {
    width: CONE_SIZE,
    height: CONE_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coneContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: CONE_SIZE,
    height: CONE_SIZE,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  coneTriangle: {
    width: 0,
    height: 0,
    borderLeftWidth: 30,
    borderRightWidth: 30,
    borderTopWidth: CONE_SIZE / 2,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: 'rgba(21,101,192,0.45)',
  },
  pulseRing: {
    position: 'absolute',
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(13,71,161,0.4)',
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: BLUE,
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 3,
    elevation: 4,
  },
});
