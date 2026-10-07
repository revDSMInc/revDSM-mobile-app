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
  style?: StyleProp<ImageStyle>;
  resizeMode?: ResizeMode;
  containerStyle?: StyleProp<ViewStyle>;
  spinnerColor?: string;
  spinnerSize?: 'small' | 'large';
  unavailableLabel?: string;
  onRetry?: () => void;
}

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

  useEffect(() => {
    setFailed(false);
    setLoading(true);
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
