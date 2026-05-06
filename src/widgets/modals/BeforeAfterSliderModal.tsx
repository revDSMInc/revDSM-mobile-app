import React, { useState } from 'react';
import { View, Text, Modal, TouchableOpacity, Image, Dimensions, SafeAreaView } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';

const { width, height } = Dimensions.get('window');

interface BeforeAfterSliderModalProps {
  visible: boolean;
  onClose: () => void;
  beforeImages: any[];
  afterImages: any[];
}

export const BeforeAfterSliderModal = ({
  visible,
  onClose,
  beforeImages,
  afterImages,
}: BeforeAfterSliderModalProps) => {
  const { colors, isDark } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);

  const maxLength = Math.max(beforeImages.length, afterImages.length);

  const nextSlide = () => {
    if (currentIndex < maxLength - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  const prevSlide = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View className="flex-1 bg-black">
        <SafeAreaView className="flex-1">
          {/* Header */}
          <View className="flex-row justify-between items-center px-6 py-4">
            <View>
              <Text className="text-white text-lg font-black">Presentation</Text>
              <Text className="text-slate-400 text-xs">
                Pair {currentIndex + 1} of {maxLength}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-2 bg-white/10 rounded-full">
              <Icon name="close" size={24} color="white" />
            </TouchableOpacity>
          </View>

          {/* Slideshow Area */}
          <View className="flex-1 justify-center">
            <View className="flex-col gap-4 px-4">
              {/* Before */}
              <View
                className="flex-1 bg-zinc-900 rounded-3xl overflow-hidden relative"
                style={{ maxHeight: height * 0.35 }}
              >
                {beforeImages[currentIndex] ? (
                  <Image
                    source={{
                      uri:
                        beforeImages[currentIndex].secureUrl || beforeImages[currentIndex].filePath,
                    }}
                    className="w-full h-full"
                    resizeMode="cover"
                  />
                ) : (
                  <View className="w-full h-full items-center justify-center">
                    <Icon name="image-off" size={40} color="#333" />
                  </View>
                )}
                <View className="absolute top-4 left-4 bg-black/50 px-3 py-1 rounded-full border border-white/20">
                  <Text className="text-white font-black text-[10px] ">Before</Text>
                </View>
              </View>

              {/* After */}
              <View
                className="flex-1 bg-zinc-900 rounded-3xl overflow-hidden relative"
                style={{ maxHeight: height * 0.35 }}
              >
                {afterImages[currentIndex] ? (
                  <Image
                    source={{
                      uri:
                        afterImages[currentIndex].secureUrl || afterImages[currentIndex].filePath,
                    }}
                    className="w-full h-full"
                    resizeMode="cover"
                  />
                ) : (
                  <View className="w-full h-full items-center justify-center">
                    <Icon name="image-off" size={40} color="#333" />
                  </View>
                )}
                <View className="absolute top-4 left-4 bg-green-500 px-3 py-1 rounded-full">
                  <Text className="text-white font-black text-[10px] ">After</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Controls */}
          <View className="p-8 flex-row justify-between items-center">
            <TouchableOpacity
              onPress={prevSlide}
              disabled={currentIndex === 0}
              className={`w-14 h-14 rounded-full items-center justify-center ${
                currentIndex === 0 ? 'bg-white/5' : 'bg-white/20'
              }`}
            >
              <Icon name="chevron-left" size={32} color="white" />
            </TouchableOpacity>

            <View className="flex-row gap-1">
              {Array.from({ length: maxLength }).map((_, i) => (
                <View
                  key={i}
                  className={`h-1.5 rounded-full ${
                    i === currentIndex ? 'w-6 bg-green-500' : 'w-1.5 bg-white/20'
                  }`}
                />
              ))}
            </View>

            <TouchableOpacity
              onPress={nextSlide}
              disabled={currentIndex === maxLength - 1}
              className={`w-14 h-14 rounded-full items-center justify-center ${
                currentIndex === maxLength - 1 ? 'bg-white/5' : 'bg-white/20'
              }`}
            >
              <Icon name="chevron-right" size={32} color="white" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};
