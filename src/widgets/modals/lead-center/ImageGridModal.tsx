import React from 'react';
import { View, Text, TouchableOpacity, Image, Modal, FlatList, Dimensions } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';

interface ImageGridModalProps {
  visible: boolean;
  onClose: () => void;
  images: Array<{ uri: string; category: string; subcategory?: string }>;
  title?: string;
}

export const ImageGridModal = ({
  visible,
  onClose,
  images,
  title = 'Inspection Report',
}: ImageGridModalProps) => {
  const { colors, isDark } = useTheme();
  const screenWidth = Dimensions.get('window').width;
  const numColumns = 3;
  const itemSize = (screenWidth - 48) / numColumns;

  return (
    <Modal visible={visible} animationType="fade" presentationStyle="pageSheet">
      <SafeAreaView
        className="flex-1"
        style={{ backgroundColor: isDark ? colors.surface : colors.background }}
      >
        {/* Header */}
        <View
          className="px-5 py-4 flex-row items-center justify-between border-b"
          style={{ borderBottomColor: colors.border }}
        >
          <Text
            className="text-lg font-black uppercase tracking-widest"
            style={{ color: colors.text }}
          >
            {title}
          </Text>
          <TouchableOpacity onPress={onClose} className="p-1">
            <Icon name="close" size={24} color={colors.text} />
          </TouchableOpacity>
        </View>

        {/* Info Banner */}
        <View className="px-5 py-3 bg-[#919EAB14]">
          <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
            {images.length} Photos total in this inspection grid.
          </Text>
        </View>

        {/* Grid */}
        <FlatList
          data={images}
          keyExtractor={(item, index) => `${item.uri}-${index}`}
          numColumns={numColumns}
          contentContainerStyle={{ padding: 12 }}
          renderItem={({ item }) => (
            <View
              className="m-1 rounded-xl overflow-hidden shadow-sm"
              style={{ width: itemSize, height: itemSize, backgroundColor: colors.border }}
            >
              <Image source={{ uri: item.uri }} style={{ width: '100%', height: '100%' }} />
              <View className="absolute bottom-0 left-0 right-0 p-1 bg-black/40">
                <Text
                  className="text-[8px] text-white font-bold uppercase truncate"
                  numberOfLines={1}
                >
                  {item.category}
                </Text>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center pt-20">
              <Icon name="image-off-outline" size={48} color={colors.textSecondary} />
              <Text className="text-sm mt-4 opacity-50" style={{ color: colors.textSecondary }}>
                No photos available for this grid.
              </Text>
            </View>
          }
        />
      </SafeAreaView>
    </Modal>
  );
};
