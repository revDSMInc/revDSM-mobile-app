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
import { checkOnlineStatus, enqueueOfflineUpload } from '../../services/api/offlineUploadManager';

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
    <View className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 relative">
      {!loaded && <ThumbSkeleton />}
      <Image source={{ uri }} style={{ width: '100%', height: '100%', opacity: loaded ? 1 : 0 }} resizeMode="cover" onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />
      {loaded && onDelete && (
        <TouchableOpacity onPress={onDelete} className="absolute top-1 right-1 bg-black rounded-full p-0.5 shadow-sm">
          <Icon name="close" size={12} color="white" />
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
  onSelectImages?: (images: any[]) => void;
}

export const BeforeImageModal = ({
  visible,
  onClose,
  job,
  existingUris = [],
  onUploadSuccess,
  onSelectImages,
}: BeforeImageModalProps) => {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [newImages, setNewImages] = useState<any[]>([]);   // newly picked files only
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [imageToDeleteIndex, setImageToDeleteIndex] = useState<number | null>(null);

  // Reset new images when modal opens
  React.useEffect(() => {
    if (visible) {
      setNewImages([]);
      setDeleteConfirmVisible(false);
      setImageToDeleteIndex(null);
    }
  }, [visible]);

  const allImages = React.useMemo(() => {
    return [
      ...existingUris.map((uri) => ({ isExisting: true, uri, index: -1 })),
      ...newImages.map((file, idx) => ({ isExisting: false, uri: file.uri, index: idx })),
    ];
  }, [existingUris, newImages]);

  const handleAddImage = async (useCamera: boolean) => {
    if (useCamera && Platform.OS === 'android') {
      const hasCamera = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      let granted = hasCamera ? PermissionsAndroid.RESULTS.GRANTED : null;
      if (!hasCamera) {
        granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA, {
          title: 'Camera Permission',
          message: 'App needs camera access to take photos.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        });
      }
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        FlashMessage.error('Camera permission is required.');
        return;
      }
    }
    const options = { mediaType: 'photo' as const, quality: 0.7 as const, selectionLimit: useCamera ? 1 : 0, saveToPhotos: true };
    const handleResult = (result: any) => {
      setTimeout(() => {
        if (result.didCancel) return;
        if (result.errorCode) { FlashMessage.error(result.errorMessage || 'Failed to open camera/gallery'); return; }
        if (result.assets && result.assets.length > 0) {
          const picked = result.assets.map((asset: any, idx: number) => ({
            uri: asset.uri, type: asset.type || 'image/jpeg',
            name: asset.fileName || `before_${Date.now()}_${idx}.jpg`,
          }));
          setNewImages(prev => [...prev, ...picked]);
        }
      }, 0);
    };

    if (useCamera) {
      launchCamera(options as any, handleResult);
    } else {
      launchImageLibrary(options as any, handleResult);
    }
  };

  const handleDeleteNew = (index: number) => {
    // Only allow delete of new images; also guard against deleting if total would be 0
    const totalAfterDelete = existingUris.length + newImages.length - 1;
    if (existingUris.length > 0 && totalAfterDelete < 1) {
      FlashMessage.warning('At least 1 image is required.'); return;
    }
    setImageToDeleteIndex(index);
    setDeleteConfirmVisible(true);
  };

  const handleConfirmDelete = () => {
    if (imageToDeleteIndex !== null) {
      setNewImages(prev => prev.filter((_, i) => i !== imageToDeleteIndex));
    }
    setDeleteConfirmVisible(false);
    setImageToDeleteIndex(null);
  };

  const handleUpload = async () => {
    if (newImages.length === 0) { onClose(); return; }
    if (onSelectImages) {
      onSelectImages(newImages);
      onClose();
      return;
    }
    try {
      setLoading(true);
      const isOnline = await checkOnlineStatus();
      if (!isOnline) {
        await enqueueOfflineUpload({
          jobNumber: job.jobNumber,
          companyId: job.companyId,
          houseNumber: job.address?.houseNumber || '',
          streetName: job.address?.streetName || '',
          city: job.address?.city || '',
          state: job.address?.state || '',
          zip: job.address?.zip || '',
          price: job.price || 0,
          installationDate: job.installationDate || '',
          type: 'before',
          images: newImages.map(img => ({
            uri: img.uri || '',
            type: img.type,
            fileName: img.name,
          })),
        });
        FlashMessage.info('Offline: Images saved. They will be uploaded automatically.');
        onUploadSuccess?.();
        onClose();
        return;
      }
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
    <>
      <Modal visible={visible} animationType="fade" transparent>
        <View className="flex-1 justify-center items-center bg-black/60 px-4">
          <View className="bg-white rounded-[32px] p-6 w-[90%] max-w-sm shadow-2xl">
            {/* Title */}
            <Text className="text-[20px] font-black text-[#1C252E] mb-6">Upload Before Images</Text>
            
            {/* Subheader */}
            <Text className="text-[14px] font-bold text-slate-800 mb-3">Before Images</Text>
            
            {/* Dashed Border Container */}
            <View className="border border-dashed border-slate-300 rounded-[20px] p-4 w-full min-h-[120px] justify-center mb-6">
              {allImages.length > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} className="w-full mb-3">
                  <View className="flex-row items-center gap-3">
                    {allImages.map((file: any, idx) => (
                      <Thumb key={idx} uri={file.uri} onDelete={file.isExisting ? undefined : () => handleDeleteNew(file.index)} />
                    ))}
                  </View>
                </ScrollView>
              ) : (
                <View className="items-center justify-center mb-3 py-4">
                  <Icon name="image-outline" size={36} color="#cbd5e1" />
                  <Text className="text-[12px] text-slate-400 mt-2 font-bold">No images selected</Text>
                </View>
              )}
              
              <TouchableOpacity
                onPress={() => {
                  Alert.alert(
                    'Add Image',
                    'Choose a source',
                    [
                      { text: 'Camera', onPress: () => handleAddImage(true) },
                      { text: 'Gallery', onPress: () => handleAddImage(false) },
                      { text: 'Cancel', style: 'cancel' }
                    ]
                  );
                }}
                className="flex-row items-center justify-center py-2"
              >
                <Icon name="plus" size={16} color="#1C252E" />
                <Text className="ml-1.5 font-black text-slate-800 text-sm">Add More Before Images</Text>
              </TouchableOpacity>
            </View>

            {/* Footer Buttons */}
            <View className="flex-row justify-end gap-3">
              <TouchableOpacity
                onPress={onClose}
                className="px-4 py-2.5 rounded-xl justify-center items-center"
              >
                <Text className="font-bold text-[#1C252E] text-sm">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={loading || newImages.length === 0}
                onPress={handleUpload}
                className="px-5 py-2.5 rounded-xl justify-center items-center"
                style={{ backgroundColor: newImages.length > 0 && !loading ? '#2EDE56' : '#E2E8F0' }}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className={`font-bold text-sm ${newImages.length > 0 ? 'text-white' : 'text-slate-400'}`}>Upload</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirm Delete Modal */}
      <Modal visible={deleteConfirmVisible} transparent animationType="fade">
        <View className="flex-1 justify-center items-center bg-black/60 px-4">
          <View className="bg-white rounded-[32px] p-6 w-[90%] max-w-sm shadow-2xl">
            <Text className="text-[18px] font-black text-[#1C252E] mb-2">Confirm Delete</Text>
            <Text className="text-slate-600 text-sm mb-6 leading-5">Are you sure you want to delete this image?</Text>
            <View className="flex-row justify-end gap-3">
              <TouchableOpacity
                onPress={() => {
                  setDeleteConfirmVisible(false);
                  setImageToDeleteIndex(null);
                }}
                className="px-4 py-2.5 rounded-xl justify-center items-center"
              >
                <Text className="font-bold text-[#1C252E] text-sm">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleConfirmDelete}
                className="bg-[#FF5630] px-5 py-2.5 rounded-xl justify-center items-center"
              >
                <Text className="text-white font-bold text-sm">Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};
