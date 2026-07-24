import React, { useState } from 'react';
import { View, Image, ActivityIndicator, StyleSheet, type ImageResizeMode } from 'react-native';

const T_GREEN = '#7ddb46';

/**
 * URIs that have finished decoding at least once this session.
 *
 * Without this, every return to an already-viewed tag re-flashes the spinner: RN
 * fires `onLoadStart` again even when the image comes straight from its cache. Same
 * trick as `LoadingImage` in `JobDocsUtils` — the tagger just needs a dark-surface
 * version of it.
 */
const loadedUris = new Set<string>();

interface Props {
  uri: string;
  /** Colour behind the image while it decodes, so the frame is never plain black. */
  tint?: string;
  resizeMode?: ImageResizeMode;
  /** Rendered under the spinner — e.g. the ghost house placeholder. */
  children?: React.ReactNode;
}

/**
 * Absolute-fill photo with a spinner until it is on screen.
 *
 * Rep reference shots are private S3 objects fetched over a signed URL, so on a job
 * site they can take seconds. Previously the frame just sat empty and the installer
 * had no way to tell a slow photo from a missing one.
 */
export const TaggerImage = React.memo(function TaggerImage({
  uri,
  tint,
  resizeMode = 'cover',
  children,
}: Props) {
  const [loading, setLoading] = useState(!loadedUris.has(uri));

  return (
    <View style={[StyleSheet.absoluteFill, tint ? { backgroundColor: tint } : null]}>
      {children}
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode={resizeMode}
        onLoadStart={() => {
          if (!loadedUris.has(uri)) setLoading(true);
        }}
        onLoadEnd={() => {
          loadedUris.add(uri);
          setLoading(false);
        }}
        // A broken URL must clear the spinner too, or it spins forever.
        onError={() => setLoading(false)}
      />
      {loading && (
        <View style={[StyleSheet.absoluteFill, styles.overlay]}>
          <ActivityIndicator size="large" color={T_GREEN} />
        </View>
      )}
    </View>
  );
});

/** Spinner for the state *before* a URL exists — the signed URL is still resolving. */
export function TaggerImageSpinner() {
  return (
    <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="none">
      <ActivityIndicator size="large" color={T_GREEN} />
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
});
