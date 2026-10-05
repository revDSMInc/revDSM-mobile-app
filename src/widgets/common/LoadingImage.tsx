import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  ActivityIndicator,
  StyleSheet,
  StyleProp,
  ImageStyle,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

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
  /** Caption shown when the image cannot be loaded. */
  unavailableLabel?: string;
  /** Called when the rep taps the failed tile — e.g. to drop the cached copy and refetch. */
  onRetry?: () => void;
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
  unavailableLabel = 'Tap to retry',
  onRetry,
}) => {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // A new uri is a new attempt — without this, swapping the source on a failed tile would keep
  // showing the error for an image that might load perfectly well.
  useEffect(() => {
    setFailed(false);
    setLoading(true);
  }, [uri]);

  // ⚠️ A spinner with no `onError` branch spins FOREVER. That is what a rep saw after clearing
  // the photo cache: the grid still held presigned urls that had expired, every `<Image>` failed,
  // and `onLoadEnd` never fired — so six tiles sat loading with no way to tell that nothing was
  // coming. An honest dead end the rep can act on beats an animation that never resolves.
  if (failed) {
    return (
      <TouchableOpacity
        style={[
          containerStyle ?? { width: '100%', height: '100%' },
          { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
        ]}
        onPress={() => {
          setFailed(false);
          setLoading(true);
          onRetry?.();
        }}
        activeOpacity={0.7}
      >
        <Icon name="image-off-outline" size={20} color="#9CA3AF" />
        <Text style={{ marginTop: 4, fontSize: 10, fontWeight: '700', color: '#9CA3AF', textAlign: 'center' }}>
          {unavailableLabel}
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    <View style={containerStyle ?? { width: '100%', height: '100%' }}>
      <Image
        source={{ uri }}
        style={style}
        resizeMode={resizeMode}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
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
