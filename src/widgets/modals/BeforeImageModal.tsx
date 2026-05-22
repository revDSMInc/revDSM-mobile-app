import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, ScrollView,
  Image, ActivityIndicator, Alert, Platform, PermissionsAndroid,
  Animated as RNAnimated,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { LeadService } from '../../services/api/leads';
import { FlashMessage } from '../../config/message';

const ThumbSkeleton = () => {
  const shimmer = useRef(new RNAnimated.Value(0)).current;
  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(shimmer, { toValue: 1, duration: 800, useNativeDriver: true }),
        RNAnimated.timing(shimmer, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);
  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.75] });
  return <RNAnimated.View style={{ flex: 1, backgroundColor: '#cbd5e1', opacity }} />;
};

const Thumb = ({ uri, onDelete }: { uri: string; onDelete?: () => void }) => {
  const [loaded, setLoaded] = useState(false);
  return (
    <View className="w-[30%] aspect-square rounded-xl overflow-hidden bg-slate-100 relative">
      {!loaded && <ThumbSkeleton />}
      <Image source={{ uri }} style={{ width: '100%', height: '100%', opacity: loaded ? 1 : 0 }} resizeMode="cover" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
      {loaded && onDelete && (
        <TouchableOpacity onPress={onDelete} className="absolute top-1 right-1 bg-red-500 rounded-full p-1">
          <Icon name="close" size={14} color="white" />
        </TouchableOpacity>
      )}
    </View>
  );
};

interface BeforeImageModalProps {
  visible: boolean;
  onClose: () => void;
  job: any;
  existingUris?: string[];        // Already-uploaded server images (read-only)
  onUploadSuccess?: () => void;   // Called after a successful upload
}

export const BeforeImageModal = ({
  visible,
  onClose,
  job,
  existingUris = [],
  onUploadSuccess,
}: BeforeImageModalProps) => {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [newImages, setNewImages] = useState<any[]>([]);   // newly picked files only

  // Reset new images when modal opens
  React.useEffect(() => {
    if (visible) setNewImages([]);
  }, [visible]);

  const handleAddImage = async (useCamera: boolean) => {
    if (useCamera && Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
        title: 'Camera Permission',
        message: 'App needs camera access to take photos.',
        buttonNeutral: 'Ask Me Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      });
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        FlashMessage.error('Camera permission is required.');
        return;
      }
    }
    const options = { mediaType: 'photo' as const, quality: 0.7 as const, selectionLimit: useCamera ? 1 : 0, saveToPhotos: true };
    try {
      const result = useCamera ? await launchCamera(options as any) : await launchImageLibrary(options as any);
      if (result.didCancel) return;
      if (result.errorCode) { FlashMessage.error(result.errorMessage || 'Failed to open camera/gallery'); return; }
      if (result.assets && result.assets.length > 0) {
        const picked = result.assets.map((asset, idx) => ({
          uri: asset.uri, type: asset.type || 'image/jpeg',
          name: asset.fileName || `before_${Date.now()}_${idx}.jpg`,
        }));
        setNewImages(prev => [...prev, ...picked]);
      }
    } catch (error) {
      FlashMessage.error('An unexpected error occurred');
    }
  };

  const handleDeleteNew = (index: number) => {
    // Only allow delete of new images; also guard against deleting if total would be 0
    const totalAfterDelete = existingUris.length + newImages.length - 1;
    if (existingUris.length > 0 && totalAfterDelete < 1) {
      FlashMessage.warning('At least 1 image is required.'); return;
    }
    setNewImages(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (newImages.length === 0) { onClose(); return; }
    try {
      setLoading(true);
      const formData = new FormData();
      formData.append('jobNumber', job.jobNumber);
      formData.append('companyId', job.companyId);
      newImages.forEach((file) => {
        formData.append('files', { uri: file.uri, type: file.type, name: file.name } as any);
      });
      await LeadService.updateBeforeImages(formData);
      FlashMessage.success('Before images uploaded successfully');
      onUploadSuccess?.();
      onClose();
    } catch (error) {
      FlashMessage.error('Failed to upload images');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 justify-end bg-black/60">
        <View className="bg-white dark:bg-zinc-900 rounded-t-[40px] h-[85%]">
          {/* Header */}
          <View className="p-4 border-b border-slate-100 dark:border-zinc-800 flex-row justify-between items-center">
            <Text className="text-[17px] font-black dark:text-white">Before Images</Text>
            <TouchableOpacity onPress={onClose} className="p-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full">
              <Icon name="close" size={20} color={isDark ? 'white' : 'black'} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#4CBB17" />
              <Text className="mt-4 font-bold text-slate-400 text-[12px]">Uploading...</Text>
            </View>
          ) : (
            <ScrollView className="flex-1 px-4 py-4">
              {/* Existing server images (read-only) */}
              {existingUris.length > 0 && (
                <View className="mb-4">
                  <Text className="text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-widest">
                    Existing ({existingUris.length})
                  </Text>
                  <View className="flex-row flex-wrap gap-2 mb-2">
                    {existingUris.map((uri, idx) => (
                      <Thumb key={`existing-${idx}`} uri={uri} />
                    ))}
                  </View>
                </View>
              )}

              {/* Newly picked images */}
              <Text className="text-[11px] font-bold text-slate-400 mb-2 uppercase tracking-widest">
                Add New Before Images
              </Text>
              {newImages.length > 0 && (
                <View className="flex-row flex-wrap gap-2 mb-4">
                  {newImages.map((file, idx) => (
                    <Thumb key={`new-${idx}`} uri={file.uri} onDelete={() => handleDeleteNew(idx)} />
                  ))}
                </View>
              )}

              {newImages.length === 0 && existingUris.length === 0 && (
                <View className="bg-slate-50 dark:bg-zinc-800 p-6 rounded-xl items-center mb-4">
                  <Icon name="image-off-outline" size={32} color="#cbd5e1" />
                  <Text className="text-[12px] text-slate-400 mt-2 font-bold">No images yet</Text>
                </View>
              )}

              {/* Add buttons */}
              <View className="flex-row gap-2 mt-2">
                <TouchableOpacity
                  onPress={() => handleAddImage(true)}
                  className="flex-1 bg-slate-50 dark:bg-zinc-800 py-3 rounded-lg border border-slate-100 dark:border-zinc-700 flex-row items-center justify-center gap-2"
                >
                  <Icon name="camera" size={18} color="#4CBB17" />
                  <Text className="text-[12px] font-bold text-slate-700 dark:text-slate-300">Camera</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleAddImage(false)}
                  className="flex-1 bg-slate-50 dark:bg-zinc-800 py-3 rounded-lg border border-slate-100 dark:border-zinc-700 flex-row items-center justify-center gap-2"
                >
                  <Icon name="image-plus" size={18} color="#4CBB17" />
                  <Text className="text-[12px] font-bold text-slate-700 dark:text-slate-300">Gallery</Text>
                </TouchableOpacity>
              </View>
              <View style={{ height: 40 }} />
            </ScrollView>
          )}

          {/* Footer */}
          <View className="p-4 border-t border-slate-100 dark:border-zinc-800 flex-row gap-3">
            <TouchableOpacity onPress={onClose} className="flex-1 border border-slate-200 dark:border-zinc-700 py-3 rounded-lg items-center">
              <Text className="text-[13px] font-black text-slate-700 dark:text-slate-300">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={loading || newImages.length === 0}
              onPress={handleUpload}
              className={`flex-1 py-3 rounded-lg items-center ${newImages.length > 0 && !loading ? 'bg-green-600' : 'bg-slate-300'}`}
            >
              {loading ? <ActivityIndicator size="small" color="white" /> : (
                <Text className="text-[13px] font-black text-white">Upload ({newImages.length})</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};
