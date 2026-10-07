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
  DeviceEventEmitter,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { launchCamera, launchImageLibrary, Asset, PhotoQuality } from 'react-native-image-picker';
import { LeadService } from '../../services/api/leads';
import { ENV } from '../../config/env';
import { checkOnlineStatus, enqueueOfflineUpload, getOfflineImagesForJob } from '../../services/api/offlineUploadManager';
import { useAuth } from '../../hooks/useAuth';
import { logEvent } from '../../services/api/LoggerService';

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
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<'before' | 'after' | null>(initialType || null);
  const [images, setImages] = useState<Asset[]>([]);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [imageToDeleteIndex, setImageToDeleteIndex] = useState<number | null>(null);
  const [existingToDelete, setExistingToDelete] = useState<any>(null);
  const [deletedExistingUris, setDeletedExistingUris] = useState<string[]>([]);
  const [signedUris, setSignedUris] = useState<string[]>([]);
  const [jobDetails, setJobDetails] = useState<any>(null);
  const [offlinePendingImages, setOfflinePendingImages] = useState<any[]>([]);

  useEffect(() => {
    if (visible) {
      resetState();
      if (initialType) setType(initialType);
      if (selectedJob) {
        setJobDetails(selectedJob);
        fetchJobDetails();
      }
    }
  }, [visible]);

  useEffect(() => {
    if (visible && jobDetails && type) {
      const pending = getOfflineImagesForJob(jobDetails.jobNumber, type);
      setOfflinePendingImages(pending);
    }
  }, [visible, jobDetails?.jobNumber, type]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('OFFLINE_UPLOAD_SUCCESS', async (data) => {
      if (data?.jobNumber === selectedJob?.jobNumber) {
        const updated = await fetchJobDetails();
        if (type && updated) {
          const pending = getOfflineImagesForJob(selectedJob.jobNumber, type);
          setOfflinePendingImages(pending);
        }
      }
    });
    return () => sub.remove();
  }, [selectedJob?.jobNumber, type]);

  const resetState = () => {
    setType(null);
    setImages([]);
    setLoading(false);
    setDeleteConfirmVisible(false);
    setImageToDeleteIndex(null);
    setExistingToDelete(null);
    setDeletedExistingUris([]);
    setSignedUris([]);
    setJobDetails(null);
    setOfflinePendingImages([]);
  };

  const fetchJobDetails = async () => {
    if (!selectedJob?.jobNumber) return null;
    try {
      const res = await LeadService.findJobs({ jobNumber: selectedJob.jobNumber });
      const updated = res.data?.data?.[0];
      if (updated) {
        setJobDetails(updated);
        return updated;
      }
    } catch (err) {
      console.warn('Failed to fetch job details in JobImageUploadModal:', err);
    }
    return null;
  };

  useEffect(() => {
    const fetchExistingSignedUrls = async () => {
      if (!visible || !jobDetails || !type) return;

      const imgs = type === 'before'
        ? jobDetails?.images?.beforeImages
        : jobDetails?.images?.afterImages;

      if (!imgs || imgs.length === 0) {
        setSignedUris([]);
        return;
      }

      const fallbacks = imgs.map((img: any) => img.secureUrl || img.s3url || img.url || img.filePath || img).filter(Boolean);
      setSignedUris(fallbacks);

      try {
        const filePaths = imgs.map((img: any) => ({
          bucketName: img.bucketName || ENV.S3_BUCKET,
          filePath: img.filePath || img.s3url || img.secureUrl || img,
        })).filter((f: any) => f.filePath);

        if (filePaths.length === 0) return;

        const res = await LeadService.getSecureUrls(filePaths);
        const secureData = res.data?.data || res.data || [];
        const uris = secureData.map((s: any) => s?.secureUrl || s?.url || '').filter(Boolean);
        if (uris.length > 0) {
          setSignedUris(uris);
        }
      } catch (err) {
        console.warn('Failed to sign urls in JobImageUploadModal:', err);
      }
    };

    fetchExistingSignedUrls();
  }, [visible, jobDetails, type]);

  const existingImages = React.useMemo(() => {
    if (!jobDetails || !type) return [];
    const imgs = type === 'before'
      ? jobDetails?.images?.beforeImages
      : jobDetails?.images?.afterImages;

    const getFallbackUri = (raw: any): string => {
      if (!raw) return '';
      if (typeof raw === 'string') {
        if (raw.startsWith('http')) return raw;
        return ENV.S3_BASE_URL + raw;
      }
      const path = raw.secureUrl || raw.s3url || raw.url || raw.filePath;
      if (!path) return '';
      if (path.startsWith('http')) return path;
      return ENV.S3_BASE_URL + path;
    };

    const serverImages = (imgs || [])
      .map((raw: any, idx: number) => {
        const uri = signedUris[idx] || getFallbackUri(raw);
        return {
          isExisting: true,
          uri,
          raw,
          index: -1,
        };
      })
      .filter((img: any) => img.uri && !deletedExistingUris.includes(img.uri));

    return [...serverImages, ...offlinePendingImages];
  }, [jobDetails, type, signedUris, deletedExistingUris, offlinePendingImages]);

  const allImages = React.useMemo(() => {
    return [
      ...existingImages,
      ...images.map((img, index) => ({
        isExisting: false,
        uri: img.uri,
        raw: img,
        localIndex: index,
      })),
    ];
  }, [existingImages, images]);

  const hasBeforeImage = React.useMemo(() => {
    if (!jobDetails) return false;
    const serverCount = jobDetails?.images?.beforeImages?.length || 0;
    const offlineCount = getOfflineImagesForJob(jobDetails.jobNumber, 'before')?.length || 0;
    return (serverCount + offlineCount) > 0;
  }, [jobDetails]);

  const hasAfterImage = React.useMemo(() => {
    if (!jobDetails) return false;
    const serverCount = jobDetails?.images?.afterImages?.length || 0;
    const offlineCount = getOfflineImagesForJob(jobDetails.jobNumber, 'after')?.length || 0;
    return (serverCount + offlineCount) > 0;
  }, [jobDetails]);

  console.log('JobImageUploadModal Render State:', {
    visible,
    type,
    selectedJobId: selectedJob?._id,
    selectedJobImages: selectedJob?.images,
    jobDetailsImages: jobDetails?.images,
    signedUris,
    existingImagesLength: existingImages.length,
    allImagesLength: allImages.length,
  });

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
      const isOnline = await checkOnlineStatus();
      if (!isOnline) {
        await enqueueOfflineUpload({
          jobNumber: selectedJob.jobNumber,
          companyId: selectedJob.companyId,
          houseNumber: selectedJob.address?.houseNumber || '',
          streetName: selectedJob.address?.streetName || '',
          city: selectedJob.address?.city || '',
          state: selectedJob.address?.state || '',
          zip: selectedJob.address?.zip || '',
          price: selectedJob.price || 0,
          installationDate: selectedJob.installationDate || '',
          type,
          images: images.map(img => ({
            uri: img.uri || '',
            type: img.type,
            fileName: img.fileName,
          })),
        });

        const userId = user?._id || user?.id;
        if (userId) {
          logEvent('add', {
            user_id: userId,
            module_type: 'before_after_images',
            created_by: userId,
            meta: {
              type,
              job_number: selectedJob.jobNumber,
              company_id: selectedJob.companyId,
              isOffline: true,
              imageData: images.map((img: any) => ({
                s3url: img.uri || '',
                bucketName: null,
                uploadedAt: null,
                category: type === 'before' ? 'Before' : 'After',
                fileName: img.fileName || null,
              })),
            },
          });
        }

        Alert.alert(
          'Offline Mode',
          'Internet connection is unavailable. Your images have been saved locally and will upload automatically once connection is restored.'
        );
        onUploadSuccess?.();
        resetState();
        onClose();
        return;
      }

      const formData = new FormData();
      formData.append('jobNumber', selectedJob.jobNumber);
      formData.append('companyId', selectedJob.companyId);

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
        const uploadedImages =
          type === 'before'
            ? response.data?.data?.images?.beforeImages || response.data?.images?.beforeImages || []
            : response.data?.data?.images?.afterImages || response.data?.images?.afterImages || [];

        const userId = user?._id || user?.id;
        if (userId) {
          logEvent('add', {
            user_id: userId,
            module_type: 'before_after_images',
            created_by: userId,
            meta: {
              type,
              job_number: selectedJob.jobNumber,
              company_id: selectedJob.companyId,
              imageData: uploadedImages.map((img: any) => ({
                s3url: img?.s3url?.filePath || img?.s3url || img?.url || img?.imagePath || img?.filePath || img,
                bucketName: img?.s3url?.bucketName || img?.bucketName || null,
                uploadedAt: img?.s3url?.uploadedAt || img?.uploadedAt || null,
                category: type === 'before' ? 'Before' : 'After',
                fileName: img?.fileName || img?.name || null,
              })),
            },
          });
        }

        Alert.alert('Success', 'Images uploaded successfully');
        onUploadSuccess?.(response.data?.data || response.data);
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

  const removeImage = (item: any) => {
    if (item.isExisting) {
      setExistingToDelete(item);
      setDeleteConfirmVisible(true);
    } else {
      setImages((prev) => prev.filter((_, i) => i !== item.localIndex));
    }
  };

  const handleConfirmDelete = async () => {
    if (existingToDelete) {
      setLoading(true);
      try {
        const filePath =
          existingToDelete.raw?.filePath ||
          existingToDelete.raw?.s3url ||
          existingToDelete.raw?.secureUrl ||
          existingToDelete.uri;

        await LeadService.deleteJobImages({
          jobNumber: selectedJob.jobNumber,
          companyId: selectedJob.companyId,
          beforeImages: type === 'before' ? [filePath] : [],
          afterImages: type === 'after' ? [filePath] : [],
        });

        setDeletedExistingUris((prev) => [...prev, existingToDelete.uri]);
        onUploadSuccess?.();
      } catch (err) {
        Alert.alert('Error', 'Failed to delete image');
      } finally {
        setLoading(false);
        setExistingToDelete(null);
        setDeleteConfirmVisible(false);
      }
    }
  };

  const selectType = (selectedType: 'before' | 'after') => {
    console.log('selectType called:', selectedType);
    setType(selectedType);
    setTimeout(() => {
      showPickSourceAlert();
    }, 150);
  };

  const showPickSourceAlert = () => {
    Alert.alert(
      'Select Image Source',
      'Choose how you want to add images',
      [
        { text: 'Camera', onPress: () => handlePickImage(true) },
        { text: 'Gallery', onPress: () => handlePickImage(false) },
        { text: 'Cancel', style: 'cancel' }
      ]
    );
  };

  return (
    <>
      <Modal visible={visible} animationType="fade" transparent>
        <View className="flex-1 justify-center items-center bg-black/60 px-4">
          <View className="bg-white dark:bg-zinc-900 rounded-[32px] p-6 w-[90%] max-w-sm max-h-[85%] shadow-2xl relative">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-[18px] font-black text-zinc-800 dark:text-white pr-6">
                {type ? `Upload ${type === 'before' ? 'Before' : 'After'} Images` : 'Upload Image Modal'}
              </Text>
              <TouchableOpacity onPress={onClose} className="absolute right-0 top-0">
                <Icon name="close" size={20} color={isDark ? 'white' : '#71717A'} />
              </TouchableOpacity>
            </View>

            {!type ? (
              <View className="flex-row gap-4 py-2">
                <TouchableOpacity
                  disabled={hasBeforeImage}
                  onPress={() => selectType('before')}
                  className={`flex-1 py-8 px-4 rounded-3xl items-center justify-center border shadow-sm ${hasBeforeImage
                    ? 'bg-zinc-100 dark:bg-zinc-900 border-zinc-200/50 dark:border-zinc-800 opacity-50'
                    : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-300/30 dark:border-zinc-700'
                    }`}
                >
                  <Icon name="image-plus" size={44} color={hasBeforeImage ? '#A1A1AA' : (isDark ? '#E4E4E7' : '#1C252E')} />
                  <Text className={`mt-4 text-[13px] text-center ${hasBeforeImage ? 'text-zinc-400' : 'text-[#1C252E]'}`}>
                    {"Upload Before Images"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  disabled={hasAfterImage}
                  onPress={() => selectType('after')}
                  className={`flex-1 py-8 px-4 rounded-3xl items-center justify-center border shadow-sm ${hasAfterImage
                    ? 'bg-zinc-100 dark:bg-zinc-900 border-zinc-200/50 dark:border-zinc-800 opacity-50'
                    : 'bg-zinc-50 dark:bg-zinc-800 border-zinc-300/30 dark:border-zinc-700'
                    }`}
                >
                  <Icon name="image-plus" size={44} color={hasAfterImage ? '#A1A1AA' : (isDark ? '#E4E4E7' : '#1C252E')} />
                  <Text className={`mt-4 text-[13px] text-center ${hasAfterImage ? 'text-zinc-400' : 'text-[#1C252E]'}`}>
                    {"Upload After Images"}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View className="flex-col w-full">
                <Text className="text-[14px] font-bold text-zinc-800 dark:text-zinc-200 mb-3">
                  {type === 'before' ? 'Before Images' : 'After Images'}
                </Text>

                <View
                  style={{ borderStyle: 'dashed' }}
                  className="border-2 border-zinc-300 dark:border-zinc-700 rounded-2xl p-4 mb-6 items-center justify-center bg-zinc-50/50 dark:bg-zinc-800/20"
                >
                  {allImages.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="w-full mb-4">
                      <View className="flex-row items-center gap-3">
                        {allImages.map((img, index) => (
                          <View
                            key={index}
                            className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 relative mr-2"
                          >
                            <Image
                              source={{ uri: img.uri }}
                              style={{ width: '100%', height: '100%' }}
                              resizeMode="cover"
                            />
                            <TouchableOpacity
                              onPress={() => removeImage(img)}
                              className="absolute top-1 right-1 bg-black rounded-full p-0.5 shadow-sm"
                            >
                              <Icon name="close" size={12} color="white" />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    </ScrollView>
                  ) : (
                    <View className="py-6 items-center justify-center">
                      <Icon name="image-off-outline" size={32} color="#A1A1AA" />
                      <Text className="text-zinc-400 mt-2 text-xs">No images added yet</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    onPress={showPickSourceAlert}
                    className="flex-row items-center justify-center py-2"
                  >
                    <Icon name="plus" size={18} color={isDark ? 'white' : '#1C252E'} />
                    <Text className="ml-1.5 font-bold text-[14px] text-zinc-800 dark:text-white">
                      {type === 'before' ? 'Add More Before Images' : 'Add More After Images'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View className="flex-row justify-end items-center gap-4">
                  <TouchableOpacity
                    onPress={() => setType(null)}
                    className="px-4 py-2"
                  >
                    <Text className="font-bold text-zinc-700 dark:text-zinc-300 text-sm">Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleUpload}
                    disabled={loading || images.length === 0}
                    className={`px-6 h-10 rounded-xl items-center justify-center shadow-sm ${loading || images.length === 0
                      ? 'bg-zinc-200 dark:bg-zinc-800'
                      : 'bg-[#2EDE56]'
                      }`}
                    style={{ minWidth: 90 }}
                  >
                    {loading ? (
                      <ActivityIndicator size="small" color="white" />
                    ) : (
                      <Text
                        className={`font-bold text-sm ${loading || images.length === 0
                          ? 'text-zinc-400 dark:text-zinc-500'
                          : 'text-white'
                          }`}
                      >
                        Upload
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

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
