import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';

const loadedUris = new Set<string>();

export const LoadingImage = React.memo(({ uri, style, resizeMode }: any) => {
  const [loading, setLoading] = useState(!loadedUris.has(uri));
  const { colors } = useTheme();

  return (
    <View style={{ width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' }}>
      {loading && (
        <View style={{ position: 'absolute', zIndex: 10, width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.05)' }}>
          <ActivityIndicator size="small" color={colors.primary.main} />
        </View>
      )}
      <Image
        source={{ uri }}
        style={[{ width: '100%', height: '100%' }, style]}
        resizeMode={resizeMode}
        onLoadStart={() => {
          if (!loadedUris.has(uri)) setLoading(true);
        }}
        onLoadEnd={() => {
          loadedUris.add(uri);
          setLoading(false);
        }}
        onError={() => setLoading(false)}
      />
    </View>
  );
});

export const DetailRow = ({ label, value, color, method, isDark }: any) => (
  <View className="flex-row justify-between items-center py-1">
    <Text className="text-[12px] text-gray-500 font-medium">{label}</Text>
    <View className="flex-row items-center">
      <Text
        className="text-[10px] font-black mr-2"
        style={{ color: color || (isDark ? '#FFFFFF' : '#1C252E') }}
      >
        {value}
      </Text>
      {method && (
        <View
          className="px-2 py-1 rounded-md border border-gray-100 shadow-sm"
          style={{
            backgroundColor: isDark ? '#1C252E' : '#FFFFFF',
            borderColor: isDark ? '#FFFFFF20' : '#E2E8F0',
            paddingHorizontal: 6,
            paddingVertical: 4,
          }}
        >
          <Text className="text-[10px] font-black text-gray-500 uppercase tracking-tighter">
            {method}
          </Text>
        </View>
      )}
    </View>
  </View>
);

export const DocumentItem = ({ doc, isDark, colors, onOpen, onImagePreview }: any) => {
  const [opening, setOpening] = useState(false);
  const isImage = doc.uri?.toLowerCase().match(/\.(jpg|jpeg|png|webp|heic)$/) || !doc.uri?.toLowerCase().includes('.pdf');

  const handlePress = async () => {
    if (opening) return;
    setOpening(true);
    try {
      if (isImage) {
        await onImagePreview?.(doc.uri);
      } else {
        await onOpen?.(doc.uri, doc.name);
      }
    } finally {
      setTimeout(() => setOpening(false), 800);
    }
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      className="flex-row items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100"
      style={{ backgroundColor: isDark ? '#FFFFFF08' : '#F9FAFB' }}
    >
      <View className="flex-row items-center gap-3" style={{ flex: 1 }}>
        <View className={`p-2 rounded-lg ${isImage ? 'bg-blue-50' : 'bg-red-50'}`}>
          <Icon
            name={isImage ? "image-outline" : "file-pdf-box"}
            size={24}
            color={isImage ? "#2196F3" : "#FF5630"}
          />
        </View>
        <View style={{ flex: 1, marginRight: 8 }}>
          <Text
            className="text-xs font-bold text-[#1C252E]"
            style={{ color: colors.text }}
            numberOfLines={1}
          >
            {doc.name}
          </Text>
          <Text className="text-[10px] font-black text-gray-400 uppercase tracking-widest mt-0.5">
            {isImage ? 'IMAGE' : 'PDF'} • {(doc.size !== undefined && doc.size !== null) ? (doc.size / 1024).toFixed(0) + ' KB' : 'Size N/A'}
          </Text>
          {/* Signed offline and still in the upload queue. It opens from the local file, so the
              rep can show it to the customer - this only says it has not reached the server. */}
          {doc.pendingUpload && (
            <View className="flex-row items-center gap-1 mt-1">
              <Icon name="cloud-upload-outline" size={11} color="#B76E00" />
              <Text className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#B76E00' }}>
                Saved on device - uploads when online
              </Text>
            </View>
          )}
        </View>
      </View>
      {opening ? (
        <ActivityIndicator size="small" color={colors.primary.main} />
      ) : (
        <Icon name="eye-outline" size={20} color="#637381" />
      )}
    </TouchableOpacity>
  );
};
