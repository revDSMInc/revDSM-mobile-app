import React, { useEffect, useRef, useState } from 'react';
import { View, Image, ActivityIndicator, StyleSheet, type ImageResizeMode } from 'react-native';

const T_GREEN = '#7ddb46';

const LOAD_TIMEOUT_MS = 15000;

const loadedUris = new Set<string>();

interface Props {
  uri: string;
  tint?: string;
  resizeMode?: ImageResizeMode;
  children?: React.ReactNode;
}

export const TaggerImage = React.memo(function TaggerImage({
  uri,
  tint,
  resizeMode = 'cover',
  children,
}: Props) {
  const [loading, setLoading] = useState(!loadedUris.has(uri));
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLoading(!loadedUris.has(uri));
    setFailed(false);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setLoading(false), LOAD_TIMEOUT_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [uri]);

  const settle = () => {
    loadedUris.add(uri);
    if (timer.current) clearTimeout(timer.current);
    setLoading(false);
  };

  return (
    <View style={[StyleSheet.absoluteFill, tint ? { backgroundColor: tint } : null]}>
      {/* Fallback art stays mounted underneath, so a failed load shows the ghost
          rather than an empty frame. */}
      {children}
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode={resizeMode}
        onLoad={settle}
        onLoadEnd={settle}
        onError={(event) => {
          if (timer.current) clearTimeout(timer.current);
          setLoading(false);
          setFailed(true);
          if (__DEV__) {
            console.warn(
              '[TaggerImage] Image failed to load:',
              event?.nativeEvent?.error ?? 'unknown error',
              '\nuri:',
              uri
            );
          }
        }}
      />
      {loading && !failed && (
        <View style={styles.badge} pointerEvents="none">
          <ActivityIndicator size="small" color={T_GREEN} />
        </View>
      )}
    </View>
  );
});

export function TaggerImageSpinner() {
  return (
    <View style={styles.badge} pointerEvents="none">
      <ActivityIndicator size="small" color={T_GREEN} />
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 44,
    height: 44,
    marginTop: -22,
    marginLeft: -22,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
});
