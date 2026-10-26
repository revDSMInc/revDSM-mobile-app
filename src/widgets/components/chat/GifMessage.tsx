import React, { useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { gifAspectRatio } from '../../../utils/gif-message';

// Inline GIF for a message whose body is a GIPHY URL. Falls back to the plain link if it fails to load.
export const GifMessage = ({
  url,
  maxWidth,
  onLongPress,
}: {
  url: string;
  maxWidth: number;
  onLongPress?: () => void;
}) => {
  const [ratio, setRatio] = useState(1);
  const [failed, setFailed] = useState(false);
  const width = Math.min(maxWidth, 240);

  if (failed) {
    return (
      <Pressable onPress={() => Linking.openURL(url).catch(() => {})} onLongPress={onLongPress}>
        <Text style={{ fontSize: 13, color: '#4DA3FF', textDecorationLine: 'underline' }}>{url}</Text>
      </Pressable>
    );
  }

  return (
    <Pressable onLongPress={onLongPress} delayLongPress={250}>
      <View style={{ width, borderRadius: 10, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.08)' }}>
        <Image
          source={{ uri: url.trim() }}
          style={{ width, aspectRatio: ratio }}
          resizeMode="cover"
          onLoad={(e) => {
            const { width: w, height: h } = e.nativeEvent.source || ({} as any);
            setRatio(gifAspectRatio(w, h));
          }}
          onError={() => setFailed(true)}
        />
      </View>
    </Pressable>
  );
};
