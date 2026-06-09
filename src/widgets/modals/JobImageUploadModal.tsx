import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  Alert,
  ScrollView,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { launchCamera, launchImageLibrary, Asset, PhotoQuality } from 'react-native-image-picker';
import { LeadService } from '../../services/api/leads';

interface JobImageUploadModalProps {
  visible: boolean;
  onClose: () => void;
  selectedJob: any;
  type?: 'before' | 'after';
  onUploadSuccess?: (updatedJob?: any) => void;
}

export const JobImageUploadModal = ({
  visible,
  onClose,
  selectedJob,
  type: initialType,
  onUploadSuccess,
}: JobImageUploadModalProps) => {
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<'before' | 'after' | null>(initialType || null);
  const [images, setImages] = useState<Asset[]>([]);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      resetState();
      if (initialType) setType(initialType);
    }
  }, [visible, initialType]);

  const resetState = () => {
    setType(null);
    setImages([]);
    setLoading(false);
  };

  const handlePickImage = (useCamera: boolean) => {
    const options = {
      mediaType: 'photo' as const,
      quality: 0.7 as PhotoQuality,
      selectionLimit: 0, // Allow multiple
      saveToPhotos: true,
      includeExtra: true,
    };

    const handleResult = (result: any) => {
      setTimeout(() => {
        if (result.didCancel) return;
        if (result.errorMessage) {
          Alert.alert('Camera Error', result.errorMessage);
          return;
        }

        if (result.assets) {
          setImages((prev) => [...prev, ...result.assets!]);
        }
      }, 0);
    };

    if (useCamera) {
      launchCamera(options, handleResult);
    } else {
      launchImageLibrary(options, handleResult);
    }
  };

  const handleUpload = async () => {
    if (!type || images.length === 0) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('jobNumber', selectedJob.jobNumber);
      formData.append('companyId', selectedJob.companyId);

      // Additional fields web sends
      formData.append('houseNumber', selectedJob.address?.houseNumber || '');
      formData.append('streetName', selectedJob.address?.streetName || '');
      formData.append('city', selectedJob.address?.city || '');
      formData.append('state', selectedJob.address?.state || '');
      formData.append('zip', selectedJob.address?.zip || '');
      formData.append('price', selectedJob.price || 0);
      formData.append('installationDate', selectedJob.installationDate || '');

      images.forEach((img, index) => {
        formData.append('files', {
          uri: img.uri,
          type: img.type || 'image/jpeg',
          name: img.fileName || `image_${index}.jpg`,
        } as any);
      });

      const response =
        type === 'before'
          ? await LeadService.updateBeforeImages(formData)
          : await LeadService.updateAfterImages(formData);

      if (response.data) {
        Alert.alert('Success', 'Images uploaded successfully');
        onUploadSuccess?.(response.data?.data || response.data);
        // Return to selection screen instead of just closing if preferred, 
        // but typically we close and let parent handle refresh.
        // Based on user request: "again intialized to the before and after screen"
        resetState();
        onClose();
      }
    } catch (error) {
      console.error('Upload Error:', error);
      Alert.alert('Error', 'Failed to upload images');
    } finally {
      setLoading(false);
    }
  };

  const removeImage = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 justify-end bg-black/50">
        <View className="bg-white dark:bg-zinc-900 rounded-t-[40px] p-6 h-[80%]">
          <View className="flex-row justify-between items-center mb-6">
            <Text className="text-[20px] font-black dark:text-white">
              {type ? `Upload ${type === 'before' ? 'Before' : 'After'} Images` : 'Upload Images'}
            </Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="close" size={24} color={isDark ? 'white' : 'black'} />
            </TouchableOpacity>
          </View>

          {!type ? (
            <View className="flex-row gap-4 py-10">
              <TouchableOpacity
                onPress={() => setType('before')}
                className="flex-1 bg-slate-50 dark:bg-zinc-800 p-8 rounded-[32px] items-center border border-slate-100 dark:border-zinc-700"
              >
                <Icon name="history" size={40} color="#4CBB17" />
                <Text className="mt-4 font-bold dark:text-white">Before</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setType('after')}
                className="flex-1 bg-slate-50 dark:bg-zinc-800 p-8 rounded-[32px] items-center border border-slate-100 dark:border-zinc-700"
              >
                <Icon name="check-circle" size={40} color="#4CBB17" />
                <Text className="mt-4 font-bold dark:text-white">After</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View className="flex-1">
              <View className="flex-row gap-3 mb-6">
                <TouchableOpacity
                  onPress={() => handlePickImage(true)}
                  className="flex-1 flex-row bg-[#2EDE56] p-4 rounded-2xl items-center justify-center"
                >
                  <Icon name="camera" size={20} color="white" />
                  <Text className="ml-2 text-white font-bold">Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handlePickImage(false)}
                  className="flex-1 flex-row bg-slate-100 dark:bg-zinc-800 p-4 rounded-2xl items-center justify-center"
                >
                  <Icon name="image-multiple" size={20} color={isDark ? 'white' : 'black'} />
                  <Text className="ml-2 font-bold dark:text-white">Gallery</Text>
                </TouchableOpacity>
              </View>

              <ScrollView className="flex-1 mb-6">
                <View className="flex-row flex-wrap gap-2">
                  {images.map((img, index) => (
                    <View
                      key={index}
                      className="w-[31%] aspect-square rounded-xl overflow-hidden relative"
                    >
                      <Image source={{ uri: img.uri }} className="w-full h-full" />
                      <TouchableOpacity
                        onPress={() => removeImage(index)}
                        className="absolute top-1 right-1 bg-black/50 rounded-full p-1"
                      >
                        <Icon name="close" size={12} color="white" />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {images.length === 0 && (
                    <View className="w-full py-20 items-center justify-center">
                      <Icon name="image-off" size={48} color="#94a3b8" />
                      <Text className="text-slate-400 mt-2">No images selected</Text>
                    </View>
                  )}
                </View>
              </ScrollView>

              <View className="flex-row gap-3">
                <TouchableOpacity
                  onPress={() => setType(null)}
                  className="flex-1 h-14 rounded-2xl items-center justify-center border border-slate-200"
                >
                  <Text className="font-bold dark:text-white">Back</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleUpload}
                  disabled={loading || images.length === 0}
                  className="flex-[2] bg-[#2EDE56] h-14 rounded-2xl items-center justify-center shadow-lg shadow-green-100"
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text className="text-white font-bold text-lg">
                      Upload {images.length} Images
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};
