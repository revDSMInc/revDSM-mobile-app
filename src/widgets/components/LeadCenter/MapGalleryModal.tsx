import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Image,
  Dimensions,
  StyleSheet,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';

const { width, height } = Dimensions.get('window');

interface MapGalleryModalProps {
  visible: boolean;
  onClose: () => void;
  job: any;
  onPresent?: () => void;
}

export const MapGalleryModal = ({
  visible,
  onClose,
  job,
  onPresent,
}: MapGalleryModalProps) => {
  const { colors, isDark } = useTheme();

  if (!job) return null;

  const beforeImages = job.images?.beforeImages || [];
  const afterImages = job.images?.afterImages || [];

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View className="flex-1 justify-center items-center bg-black/60 px-5">
        <View 
          className="bg-white rounded-[32px] overflow-hidden"
          style={{ width: width * 0.85, maxHeight: height * 0.7 }}
        >
          {/* Logo & Close */}
          <View className="p-6 flex-row justify-between items-center">
            <View className="flex-row items-center">
              <Text className="text-[24px] font-black text-[#2EDE56]">rev</Text>
              <Text className="text-[24px] font-black text-slate-800">DSM</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="p-1">
              <Icon name="close" size={24} color="#64748b" />
            </TouchableOpacity>
          </View>

          <ScrollView className="px-6 pb-6">
            <View className="flex-row gap-6">
              {/* Before Section */}
              <View className="flex-1">
                <Text className="text-[15px] font-black text-slate-800 mb-4">Before</Text>
                {beforeImages.length > 0 ? (
                  <View className="rounded-2xl overflow-hidden bg-slate-100 aspect-[3/4]">
                    <Image 
                      source={{ uri: beforeImages[0].secureUrl || beforeImages[0].filePath }} 
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                  </View>
                ) : (
                  <View className="rounded-2xl bg-slate-50 border border-slate-100 aspect-[3/4] items-center justify-center p-4">
                    <Text className="text-[12px] font-bold text-slate-400 text-center">
                      No before images available
                    </Text>
                  </View>
                )}
              </View>

              {/* After Section */}
              <View className="flex-1">
                <Text className="text-[15px] font-black text-slate-800 mb-4">After</Text>
                {afterImages.length > 0 ? (
                  <View className="rounded-2xl overflow-hidden bg-slate-100 aspect-[3/4]">
                    <Image 
                      source={{ uri: afterImages[0].secureUrl || afterImages[0].filePath }} 
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                  </View>
                ) : (
                  <View className="rounded-2xl bg-slate-50 border border-slate-100 aspect-[3/4] items-center justify-center p-4">
                    <Text className="text-[12px] font-bold text-slate-400 text-center">
                      No after images available
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Present Footer */}
            <TouchableOpacity 
              onPress={onPresent}
              className="flex-row items-center mt-8 pb-4"
            >
              <Icon name="presentation" size={20} color="#64748b" />
              <Text className="ml-2 text-[14px] font-bold text-slate-600">Present</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};
