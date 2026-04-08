import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';
import { launchCamera, launchImageLibrary, MediaType } from 'react-native-image-picker';
import { GlobalModal } from '../../../common/modal/GlobalModal';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

export const JobDocsSection = () => {
  const { colors, isDark } = useTheme();
  return (
    <View className="px-4 py-2">
      <View
        className="rounded-2xl border items-center justify-center py-6 mb-4 mt-2 shadow-sm"
        style={{
          borderColor: isDark ? colors.border : '#F0F0F0',
          backgroundColor: isDark ? colors.surface : '#fff',
        }}
      >
        <Icon
          name="file-document-outline"
          size={48}
          color={colors.textSecondary}
          style={{ opacity: 0.3, marginBottom: 8 }}
        />
        <Text className="text-sm font-black" style={{ color: colors.textSecondary }}>
          No contract details available
        </Text>
      </View>

      <View className="flex-row items-center justify-between mb-3 px-1">
        <Text
          className="text-[13px] font-black uppercase tracking-widest"
          style={{ color: colors.textSecondary }}
        >
          Progress
        </Text>
        <View className="flex-row items-center">
          <Text className="text-[13px] font-black tracking-widest color-[#72BD00] mr-2">
            0/45 Images
          </Text>
          <Icon name="chevron-down" size={14} color="#72BD00" />
        </View>
      </View>

      <AccordionItem title="Front View" count={0} total={3} />
      <AccordionItem title="Side Views" count={0} total={2} />
      <AccordionItem title="Back View" count={0} total={3} />
      <AccordionItem title="Gutter System" count={0} total={3} />
      <AccordionItem title="Measurements" count={0} total={7} />
      <AccordionItem title="Miscellaneous" count={0} total={5} />
      <AccordionItem title="Roofline Observation" count={0} total={4} />
      <AccordionItem title="Roof Inspection" count={0} total={18} />
    </View>
  );
};

const AccordionItem = ({ title, count, total }: any) => {
  const { colors, isDark } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [images, setImages] = useState<{ uri: string; index: number }[]>([]);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  const openCamera = () => {
    launchCamera({ mediaType: 'photo' as MediaType, quality: 0.8 }, (response) => {
      if (
        response.assets &&
        response.assets.length > 0 &&
        response.assets[0].uri &&
        pickerIndex !== null
      ) {
        const newImage = { uri: response.assets[0].uri, index: pickerIndex };
        setImages((prev) => [...prev.filter((img) => img.index !== pickerIndex), newImage]);
      }
      setPickerIndex(null);
    });
  };

  const openGallery = () => {
    launchImageLibrary({ mediaType: 'photo' as MediaType, quality: 0.8 }, (response) => {
      if (
        response.assets &&
        response.assets.length > 0 &&
        response.assets[0].uri &&
        pickerIndex !== null
      ) {
        const newImage = { uri: response.assets[0].uri, index: pickerIndex };
        setImages((prev) => [...prev.filter((img) => img.index !== pickerIndex), newImage]);
      }
      setPickerIndex(null);
    });
  };

  return (
    <View className="mb-3">
      <GlobalModal
        visible={pickerIndex !== null}
        title="Upload Image"
        message={`Choose a completely visible photo for ${title}.`}
        type="info"
        onClose={() => setPickerIndex(null)}
        confirmText="Cancel"
      >
        <View className="flex-col w-full px-4 mt-4">
          <TouchableOpacity
            onPress={openCamera}
            className="py-3 px-4 rounded-2xl flex-row items-center border shadow-sm mb-3"
            style={{
              borderColor: colors.border,
              backgroundColor: isDark ? colors.grey[800] : colors.background,
            }}
          >
            <Icon name="camera-outline" size={24} color={colors.text} style={{ marginRight: 12 }} />
            <Text
              className="text-sm font-black uppercase tracking-widest"
              style={{ color: colors.text }}
            >
              Take Photo
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={openGallery}
            className="py-3 px-4 rounded-2xl flex-row items-center border shadow-sm"
            style={{
              borderColor: colors.border,
              backgroundColor: isDark ? colors.grey[800] : colors.background,
            }}
          >
            <Icon name="image-outline" size={24} color={colors.text} style={{ marginRight: 12 }} />
            <Text
              className="text-sm font-black uppercase tracking-widest"
              style={{ color: colors.text }}
            >
              Choose from Gallery
            </Text>
          </TouchableOpacity>
        </View>
      </GlobalModal>

      <TouchableOpacity
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center justify-between p-4 rounded-2xl border shadow-sm"
        style={{
          borderColor: colors.border,
          backgroundColor: isDark ? colors.surface : colors.background,
          borderBottomLeftRadius: expanded ? 0 : 16,
          borderBottomRightRadius: expanded ? 0 : 16,
        }}
      >
        <Text
          className="text-[13px] font-black uppercase tracking-widest"
          style={{ color: colors.text }}
        >
          {title}
        </Text>
        <View className="flex-row items-center">
          <View
            className="px-3 py-1 rounded-md mr-3 shadow-md"
            style={{ backgroundColor: isDark ? colors.grey[800] : colors.grey[700] }}
          >
            <Text className="text-[10px] text-white font-black uppercase tracking-widest">
              {images.length}/{total} DONE
            </Text>
          </View>
          <Icon
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.text}
            style={{ opacity: 0.3 }}
          />
        </View>
      </TouchableOpacity>

      {expanded && (
        <View
          className="p-4 border-l border-r border-b rounded-b-2xl"
          style={{
            borderColor: colors.border,
            backgroundColor: isDark ? colors.background : colors.grey[100],
          }}
        >
          <View className="flex-row flex-wrap justify-between">
            {[...Array(total)].map((_, idx) => {
              const existingImage = images.find((img) => img.index === idx);
              return (
                <TouchableOpacity
                  key={idx}
                  onPress={() => setPickerIndex(idx)}
                  className="w-[48%] h-32 rounded-2xl border-2 border-dashed items-center justify-center overflow-hidden mb-4"
                  style={{
                    borderColor: existingImage ? 'transparent' : colors.primary.main,
                    backgroundColor: isDark ? 'transparent' : colors.primary.main + '05',
                  }}
                >
                  {existingImage ? (
                    <Image
                      source={{ uri: existingImage.uri }}
                      style={{ width: '100%', height: '100%' }}
                    />
                  ) : (
                    <>
                      <Icon
                        name="camera-plus-outline"
                        size={32}
                        color={colors.text}
                        style={{ opacity: 0.3, marginBottom: 8 }}
                      />
                      <Text
                        className="text-[10px] font-black uppercase tracking-widest text-center mx-2"
                        style={{ color: colors.text }}
                      >
                        {title} {idx + 1}
                      </Text>
                      <View
                        className="absolute bottom-2 right-2 w-6 h-6 rounded-full items-center justify-center"
                        style={{ backgroundColor: '#72BD00' }}
                      >
                        <Text className="text-white text-md font-bold mt-[-2px]">+</Text>
                      </View>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
};
