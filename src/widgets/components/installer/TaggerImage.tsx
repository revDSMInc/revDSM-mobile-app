import React, { useEffect, useRef, useState } from 'react';
import { View, Image, ActivityIndicator, StyleSheet, type ImageResizeMode } from 'react-native';

const T_GREEN = '#7ddb46';

/** Give up on the spinner after this long and show whatever loaded. */
const LOAD_TIMEOUT_MS = 15000;

/**
 * URIs that have finished decoding at least once this session.
 *
 * Without this, every return to an already-viewed tag re-flashes the spinner: RN
 * fires `onLoadStart` again even when the image comes straight from its cache.
 */
const loadedUris = new Set<string>();

interface Props {
  uri: string;
  /** Colour behind the image while it decodes, so the frame is never plain black. */
  tint?: string;
  resizeMode?: ImageResizeMode;
  /** Rendered under the image — e.g. the ghost house placeholder. */
  children?: React.ReactNode;
}

/**
 * Absolute-fill photo with a spinner until it is on screen.
 *
 * Rep reference shots are private S3 objects fetched over a signed URL, so on a job
 * site they can take seconds and the frame would otherwise sit empty.
 *
 * The spinner is a small centred badge, NOT a full-bleed scrim: a scrim that fails to
 * clear hides the very photo it is waiting on, and there are several ways for the
 * "loaded" signal to be missed (a cached decode that skips `onLoadEnd`, the component
 * instance being reused for a different tag). A badge degrades to a harmless dot on
 * top of a visible image instead.
 */
export const TaggerImage = React.memo(function TaggerImage({
  uri,
  tint,
  resizeMode = 'cover',
  children,
}: Props) {
  const [loading, setLoading] = useState(!loadedUris.has(uri));
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The tagger reuses one instance as the installer moves between tags, so the state
  // has to be re-derived per uri — `useState`'s initializer only runs on mount, which
  // is what left the spinner up over an image that had already loaded.
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
        // Both fire on success and either can be the one that lands first depending
        // on platform and whether the decode came from cache — clear on either.
        onLoad={settle}
        onLoadEnd={settle}
        onError={(event) => {
          if (timer.current) clearTimeout(timer.current);
          setLoading(false);
          setFailed(true);
          if (__DEV__) {
            // A signed URL that 403s (expired, wrong bucket/region) fails silently
            // otherwise, and looks identical to a slow network from the outside.
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

/** Spinner for the state *before* a URL exists — the signed URL is still resolving. */
export function TaggerImageSpinner() {
  return (
    <View style={styles.badge} pointerEvents="none">
      <ActivityIndicator size="small" color={T_GREEN} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Centred badge rather than a covering layer — see the component doc.
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
