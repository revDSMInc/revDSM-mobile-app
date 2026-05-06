import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { LeadService } from '../../services/api/leads';
import { BeforeAfterSliderModal } from './BeforeAfterSliderModal';

const { width } = Dimensions.get('window');

interface BeforeAfterModalProps {
  visible: boolean;
  onClose: () => void;
  selectedJob: any;
  onUploadSuccess?: () => void;
}

export const BeforeAfterModal = ({
  visible,
  onClose,
  selectedJob,
  onUploadSuccess,
}: BeforeAfterModalProps) => {
  const { colors, isDark } = useTheme();
  const [activeTab, setActiveTab] = useState<'before' | 'after'>('before');
  const [loading, setLoading] = useState(false);
  const [showPresentation, setShowPresentation] = useState(false);

  const beforeImages = selectedJob?.images?.beforeImages || [];
  const afterImages = selectedJob?.images?.afterImages || [];

  const handleAddImage = async (useCamera: boolean) => {
    const options = {
      mediaType: 'photo' as const,
      quality: 0.7 as const,
      selectionLimit: 0,
    };

    const result = useCamera
      ? await launchCamera(options as any)
      : await launchImageLibrary(options as any);

    if (result.assets && result.assets.length > 0) {
      setLoading(true);
      try {
        const formData = new FormData();
        formData.append('jobNumber', selectedJob.jobNumber);
        formData.append('companyId', selectedJob.companyId);

        result.assets.forEach((img, index) => {
          formData.append('files', {
            uri: img.uri,
            type: img.type || 'image/jpeg',
            name: img.fileName || `image_${index}.jpg`,
          } as any);
        });

        if (activeTab === 'before') {
          await LeadService.updateBeforeImages(formData);
        } else {
          await LeadService.updateAfterImages(formData);
        }

        Alert.alert('Success', 'Images uploaded successfully');
        onUploadSuccess?.();
      } catch (error) {
        console.error('Upload error:', error);
        Alert.alert('Error', 'Failed to upload images');
      } finally {
        setLoading(false);
      }
    }
  };

  const currentImages = activeTab === 'before' ? beforeImages : afterImages;

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 justify-end bg-black/60">
        <View className="bg-white dark:bg-zinc-900 rounded-t-[40px] h-[85%]">
          {/* Header */}
          <View className="p-4 border-b border-slate-100 dark:border-zinc-800 flex-row justify-between items-center">
            <View>
              <Text className="text-[17px] font-black dark:text-white">Job Photos</Text>
              <Text className="text-[11px] font-bold text-slate-400">
                #{selectedJob?.jobNumber}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="p-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full"
            >
              <Icon name="close" size={20} color={isDark ? 'white' : 'black'} />
            </TouchableOpacity>
          </View>

          {/* Tabs */}
          <View className="flex-row p-3 gap-3">
            {(['before', 'after'] as const).map((tab) => (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                className={`flex-1 py-2.5 rounded-xl items-center border ${
                  activeTab === tab
                    ? 'bg-green-600 border-green-600'
                    : 'bg-slate-50 dark:bg-zinc-800 border-slate-100 dark:border-zinc-700'
                }`}
              >
                <Text
                  className={`font-black tracking-widest text-[11px] ${
                    activeTab === tab ? 'text-white' : 'text-slate-400'
                  }`}
                >
                  {tab} ({tab === 'before' ? beforeImages.length : afterImages.length})
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Actions Bar */}
          <View className="px-5 flex-row justify-between items-center mb-3">
            <View className="flex-row gap-2.5">
              <TouchableOpacity
                onPress={() => handleAddImage(true)}
                className="w-10 h-10 bg-slate-50 dark:bg-zinc-800 rounded-lg items-center justify-center border border-slate-100 dark:border-zinc-700"
              >
                <Icon name="camera" size={20} color="#4CBB17" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleAddImage(false)}
                className="w-10 h-10 bg-slate-50 dark:bg-zinc-800 rounded-lg items-center justify-center border border-slate-100 dark:border-zinc-700"
              >
                <Icon name="image-plus" size={20} color="#4CBB17" />
              </TouchableOpacity>
            </View>

            {beforeImages.length > 0 && afterImages.length > 0 && (
              <TouchableOpacity
                onPress={() => setShowPresentation(true)}
                className="flex-row items-center bg-blue-50 px-3 py-2 rounded-lg border border-blue-100"
              >
                <Icon name="presentation" size={18} color="#3b82f6" />
                <Text className="ml-1.5 font-black text-blue-600 text-[9px] tracking-widest">
                  Presentation
                </Text>
              </TouchableOpacity>
            )}
          </View>

          <ScrollView className="flex-1 px-4">
            {loading ? (
              <View className="py-20 items-center">
                <ActivityIndicator size="large" color="#4CBB17" />
                <Text className="mt-4 font-bold text-slate-400">Uploading...</Text>
              </View>
            ) : (
              <View className="flex-row flex-wrap gap-2">
                {currentImages.map((img: any, idx: number) => (
                  <View
                    key={idx}
                    className="w-[31%] aspect-square rounded-2xl overflow-hidden bg-slate-100"
                  >
                    <Image
                      source={{ uri: img.secureUrl || img.filePath }}
                      className="w-full h-full"
                      resizeMode="cover"
                    />
                  </View>
                ))}
                {currentImages.length === 0 && (
                  <View className="w-full py-20 items-center justify-center">
                    <Icon name="image-off-outline" size={48} color="#cbd5e1" />
                    <Text className="mt-4 font-bold text-slate-300">No {activeTab} images</Text>
                  </View>
                )}
              </View>
            )}
            <View style={{ height: 100 }} />
          </ScrollView>
        </View>
      </View>

      {showPresentation && (
        <BeforeAfterSliderModal
          visible={showPresentation}
          onClose={() => setShowPresentation(false)}
          beforeImages={beforeImages}
          afterImages={afterImages}
        />
      )}
    </Modal>
  );
};
