import React from 'react';
import { Image, StyleProp, ImageStyle } from 'react-native';
import Video from 'react-native-video';

/**
 * A captured asset's preview. A recorded video (camera Video mode) needs a <Video>: <Image> renders nothing for a video file.
 * Paused first frame by default; `controls` plays it (full-screen preview).
 */
export const PreviewMedia = ({
  uri,
  type,
  style,
  className,
  resizeMode = 'cover',
  controls = false,
}: {
  uri: string;
  type?: string | null;
  style?: StyleProp<ImageStyle>;
  className?: string;
  resizeMode?: 'cover' | 'contain';
  controls?: boolean;
}) =>
  String(type || '').startsWith('video/') ? (
    <Video
      source={{ uri }}
      style={style as any}
      className={className}
      resizeMode={resizeMode}
      paused={!controls}
      controls={controls}
      repeat={controls}
    />
  ) : (
    <Image source={{ uri }} style={style} className={className} resizeMode={resizeMode} />
  );
