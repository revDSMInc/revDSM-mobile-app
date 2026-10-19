import React, { useEffect, useRef, useState } from 'react';
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
  style?: StyleProp<ImageStyle>;
  resizeMode?: ResizeMode;
  containerStyle?: StyleProp<ViewStyle>;
  spinnerColor?: string;
  spinnerSize?: 'small' | 'large';
  unavailableLabel?: string;
  onRetry?: () => void;
  /** Fired once the CURRENT uri has painted (the swap from the previous image is then complete). */
  onLoaded?: () => void;
}

// A photo that is already a file on the device, or that has loaded once this session, must not flash a spinner every
// time its screen is reopened - the spinner is for bytes that really are still arriving.
const isLocalUri = (u: string) => !/^https?:/i.test(u);
const stableKey = (u: string) => u.split('?')[0];
const loadedKeys = new Set<string>();
const needsSpinner = (u: string) => !isLocalUri(u) && !loadedKeys.has(stableKey(u));

export const LoadingImage: React.FC<LoadingImageProps> = ({
  uri,
  style,
  resizeMode = 'cover',
  containerStyle,
  spinnerColor = '#4CBB17',
  spinnerSize = 'small',
  unavailableLabel = 'Tap to retry',
  onRetry,
  onLoaded,
}) => {
  const [loading, setLoading] = useState(() => needsSpinner(uri));
  const [failed, setFailed] = useState(false);

  // ⚠️ When the uri changes (a pending photo handing over to its server copy, a re-edit's new bytes), the PREVIOUS image
  // stays on screen underneath until the new one has painted - otherwise the tile blanks for a moment while the new file
  // is decoded. `paintedRef` = the current uri has loaded; `lastRef` = the uri that was showing before.
  const [prevUri, setPrevUri] = useState<string | null>(null);
  const lastRef = useRef(uri);
  const paintedRef = useRef(false);

  useEffect(() => {
    if (lastRef.current !== uri) {
      if (paintedRef.current) setPrevUri(lastRef.current);
      lastRef.current = uri;
      paintedRef.current = false;
    }
    setFailed(false);
    setLoading(needsSpinner(uri) && !paintedRef.current);
  }, [uri]);

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
      {prevUri && prevUri !== uri && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          <Image source={{ uri: prevUri }} style={style} resizeMode={resizeMode} />
        </View>
      )}
      <Image
        source={{ uri }}
        style={style}
        resizeMode={resizeMode}
        onLoadStart={() => {
          if (needsSpinner(uri) && !prevUri) setLoading(true);
        }}
        onLoadEnd={() => {
          if (loadedKeys.size > 800) loadedKeys.clear();
          loadedKeys.add(stableKey(uri));
          paintedRef.current = true;
          setLoading(false);
          setPrevUri(null);
          onLoaded?.();
        }}
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
