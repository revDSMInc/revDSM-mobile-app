import React, { useState } from 'react';
import {
  View,
  Image,
  ActivityIndicator,
  StyleSheet,
  StyleProp,
  ImageStyle,
  ViewStyle,
} from 'react-native';

type ResizeMode = 'cover' | 'contain' | 'stretch' | 'center' | 'repeat';

interface LoadingImageProps {
  uri: string;
  /** Style for the <Image> itself. */
  style?: StyleProp<ImageStyle>;
  resizeMode?: ResizeMode;
  /** Wrapper style that positions the image + spinner. Defaults to filling the parent. */
  containerStyle?: StyleProp<ViewStyle>;
  spinnerColor?: string;
  spinnerSize?: 'small' | 'large';
}

/**
 * An <Image> with a centered spinner overlay while it loads — so a (often pre-signed
 * S3 / remote) photo shows a loader instead of a blank/black box until it's ready.
 * Fills its parent by default; pass `containerStyle` to override (e.g. `{ flex: 1 }`).
 */
export const LoadingImage: React.FC<LoadingImageProps> = ({
  uri,
  style,
  resizeMode = 'cover',
  containerStyle,
  spinnerColor = '#4CBB17',
  spinnerSize = 'small',
}) => {
  const [loading, setLoading] = useState(true);
  return (
    <View style={containerStyle ?? { width: '100%', height: '100%' }}>
      <Image
        source={{ uri }}
        style={style}
        resizeMode={resizeMode}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
      />
      {loading && (
        <View
          style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
          pointerEvents="none"
        >
          <ActivityIndicator size={spinnerSize} color={spinnerColor} />
        </View>
      )}
    </View>
  );
};

export default LoadingImage;
