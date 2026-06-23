import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Image } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { launchImageLibrary, Asset } from 'react-native-image-picker';

interface PaperFallbackModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (fileData: any) => void;
  loading?: boolean;
}

export const PaperFallbackModal = ({
  visible,
  onClose,
  onSubmit,
  loading,
}: PaperFallbackModalProps) => {
  const { colors } = useTheme();
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  const handlePickImage = () => {
    launchImageLibrary({ mediaType: 'photo', quality: 0.8 }, (res) => {
      if (res.assets && res.assets[0].uri) {
        setSelectedAsset(res.assets[0]);
      }
    });
  };

  const handleClear = () => {
    setSelectedAsset(null);
  };

  const onFinalSubmit = () => {
    if (selectedAsset) {
      onSubmit({
        uri: selectedAsset.uri,
        type: selectedAsset.type || 'image/jpeg',
        name: selectedAsset.fileName || 'paper_consent.jpg',
      });
    }
  };

  const isActive = !!selectedAsset;

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View className="flex-1 bg-black/80 justify-center px-4">
        <View className="bg-white rounded-2xl overflow-hidden shadow-2xl">
          <View
            className="flex-row justify-between items-center p-4 mb-6"
            style={{ backgroundColor: colors.primary.main }}
          >
            <Text className="text-white text-sm font-semibold">Upload Image</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={20} color="#ffffff" />
            </TouchableOpacity>
          </View>

          <View className="px-4">
            <TouchableOpacity
              onPress={handlePickImage}
              disabled={loading}
              className="w-full h-64 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 items-center justify-center mb-6 overflow-hidden"
              style={{ borderColor: '#919EAB33' }}
            >
              {selectedAsset?.uri ? (
                <Image
                  source={{ uri: selectedAsset.uri }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="contain"
                />
              ) : (
                <View className="items-center">
                  <Icon name="image-outline" size={48} color="#919EAB8F" style={{ opacity: 0.6 }} />
                  <Text
                    className="text-center px-10 mt-4 text-sm font-medium"
                    style={{ color: '#4D4D4D' }}
                  >
                    Drag and drop an image here, or click to select
                  </Text>
                  <Text className="text-xs mt-4" style={{ color: '#4D4D4D' }}>
                    Supported formats: JPG, PNG
                  </Text>
                  <Text className="text-xs mt-2" style={{ color: '#4D4D4D' }}>
                    Max size: 5MB
                  </Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Selected File Badge */}
            {selectedAsset && (
              <View
                className="flex-row items-center justify-between p-4 rounded-xl mb-6"
                style={{ backgroundColor: '#72BD0014', borderWidth: 1, borderColor: '#72BD0033' }}
              >
                <View className="flex-row items-center flex-1">
                  <View
                    className="w-8 h-8 rounded-lg items-center justify-center mr-3"
                    style={{ backgroundColor: colors.primary.main }}
                  >
                    <Icon name="image" size={18} color="white" />
                  </View>
                  <Text className="text-[#1C252E] font-semibold text-sm flex-1" numberOfLines={1}>
                    {selectedAsset.fileName || 'selected_image.jpg'}
                  </Text>
                </View>
                <TouchableOpacity onPress={handleClear}>
                  <Icon name="close" size={20} color="#FF5630" />
                </TouchableOpacity>
              </View>
            )}

            <View className="flex-row justify-end gap-3 mb-4">
              <TouchableOpacity
                onPress={onClose}
                disabled={loading}
                className="px-6 py-2.5 rounded-xl border"
                style={{ borderColor: '#919EAB52' }}
              >
                <Text className="text-gray-700 font-bold">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onFinalSubmit}
                disabled={!isActive || loading}
                className="px-6 py-2.5 rounded-xl"
                style={{
                  backgroundColor: isActive ? colors.primary.main : '#919EAB33',
                }}
              >
                <Text className="font-bold" style={{ color: isActive ? 'white' : '#919EABCC' }}>
                  {loading ? 'Uploading...' : 'Upload'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};
