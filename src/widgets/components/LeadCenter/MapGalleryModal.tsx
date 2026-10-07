import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Image,
  Dimensions, ScrollView, ActivityIndicator, Alert,
  Animated as RNAnimated,
  Platform,
  DeviceEventEmitter,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { BeforeAfterPresentModal } from './BeforeAfterPresentModal';
import { BeforeImageModal } from '../../modals/BeforeImageModal';
import { AfterImageModal } from '../../modals/AfterImageModal';
import { logEvent } from '../../../services/api/LoggerService';
import Logo from "../../../assets/svgs/logo"
import { ENV } from '../../../config/env';
import { getOfflineImagesForJob } from '../../../services/api/offlineUploadManager';


const { width, height } = Dimensions.get('window');

const ImageSkeleton = () => {
  const shimmer = useRef(new RNAnimated.Value(0)).current;

  useEffect(() => {
    const loop = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        RNAnimated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] });

  return (
    <RNAnimated.View
      style={{
        width: '100%', height: '100%',
        backgroundColor: '#cbd5e1',
        opacity,
      }}
    />
  );
};

const GalleryImage = React.memo(({ uri, onExpand, onDelete, canDelete }: {
  uri: string;
  onExpand: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
}) => {
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onExpand}
      className="rounded-2xl overflow-hidden bg-slate-100 aspect-[3/4] shadow-sm relative"
    >
      {!imgLoaded && <ImageSkeleton />}
      <Image
        source={{ uri }}
        style={{ width: '100%', height: '100%', opacity: imgLoaded ? 1 : 0 }}
        resizeMode="cover"
        onLoad={() => setImgLoaded(true)}
        onError={() => setImgLoaded(true)} // hide skeleton even on error
      />
      {imgLoaded && (
        <>
          {canDelete && onDelete && (
            <TouchableOpacity
              onPress={onDelete}
              className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/40 items-center justify-center"
            >
              <Icon name="delete" size={16} color="white" />
            </TouchableOpacity>
          )}
        </>
      )}
    </TouchableOpacity>
  );
});

interface MapGalleryModalProps {
  visible: boolean;
  onClose: () => void;
  job: any;
  isMyJob?: boolean;
  user?: any;
  onUploadSuccess?: () => void;
}

export const MapGalleryModal = ({
  visible,
  onClose,
  job,
  isMyJob = false,
  user,
  onUploadSuccess,
}: MapGalleryModalProps) => {
  const [signingUrls, setSigningUrls] = useState(false);  // background sign, not blocking
  const [saving, setSaving] = useState(false);

  const [beforeImages, setBeforeImages] = useState<any[]>([]);
  const [afterImages, setAfterImages] = useState<any[]>([]);
  const [beforeUris, setBeforeUris] = useState<string[]>([]);
  const [afterUris, setAfterUris] = useState<string[]>([]);
  const [offlineBeforeUris, setOfflineBeforeUris] = useState<string[]>([]);
  const [offlineAfterUris, setOfflineAfterUris] = useState<string[]>([]);

  const [newBeforeImages, setNewBeforeImages] = useState<any[]>([]);
  const [newAfterImages, setNewAfterImages] = useState<any[]>([]);

  const [pendingDeletions, setPendingDeletions] = useState<any[]>([]);
  const [showPresent, setShowPresent] = useState(false);
  const [showBeforeModal, setShowBeforeModal] = useState(false);
  const [showAfterModal, setShowAfterModal] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerImgLoaded, setViewerImgLoaded] = useState(false);

  useEffect(() => {
    setViewerImgLoaded(false);
  }, [viewerUri]);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const [imageToDelete, setImageToDelete] = useState<{ type: 'before' | 'after'; index: number } | null>(null);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => { scale.value = savedScale.value * e.scale; })
    .onEnd(() => {
      if (scale.value < 1) {
        scale.value = withSpring(1); savedScale.value = 1;
        translateX.value = withSpring(0); translateY.value = withSpring(0);
        savedTranslateX.value = 0; savedTranslateY.value = 0;
      } else { savedScale.value = scale.value; }
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        translateX.value = savedTranslateX.value + e.translationX;
        translateY.value = savedTranslateY.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  const composedGesture = Gesture.Simultaneous(pinchGesture, panGesture);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  const resetViewer = () => {
    scale.value = 1; savedScale.value = 1;
    translateX.value = 0; translateY.value = 0;
    savedTranslateX.value = 0; savedTranslateY.value = 0;
  };

  const setFallbackUris = useCallback((bImages: any[], aImages: any[]) => {
    const extractFallback = (img: any): string =>
      img.secureUrl || img.s3url || img.url || '';
    const offlineBefore = getOfflineImagesForJob(job?.jobNumber, 'before').map(img => img.uri);
    const offlineAfter = getOfflineImagesForJob(job?.jobNumber, 'after').map(img => img.uri);
    
    setOfflineBeforeUris(offlineBefore);
    setOfflineAfterUris(offlineAfter);

    const bFallback = bImages.map(extractFallback).filter(Boolean);
    const aFallback = aImages.map(extractFallback).filter(Boolean);
    setBeforeUris(bFallback);
    setAfterUris(aFallback);
  }, [job?.jobNumber]);

  const fetchSignedUrls = useCallback(async (bImages: any[], aImages: any[]) => {
    try {
      setSigningUrls(true);
      const filePaths = [
        ...bImages.map((img: any) => ({
          bucketName: img.bucketName || ENV.S3_BUCKET,
          filePath: img.filePath || img.s3url || img.secureUrl,
        })),
        ...aImages.map((img: any) => ({
          bucketName: img.bucketName || ENV.S3_BUCKET,
          filePath: img.filePath || img.s3url || img.secureUrl,
        })),
      ];
      let signedBefore: string[] = [];
      let signedAfter: string[] = [];
      if (filePaths.length > 0) {
        const res = await LeadService.getSecureUrls(filePaths);
        const secureData = res.data?.data || res.data || [];
        signedBefore = secureData.slice(0, bImages.length)
          .map((s: any) => s?.secureUrl || s?.url || '').filter(Boolean);
        signedAfter = secureData.slice(bImages.length)
          .map((s: any) => s?.secureUrl || s?.url || '').filter(Boolean);
      }
      
      const offlineBefore = getOfflineImagesForJob(job?.jobNumber, 'before').map(img => img.uri);
      const offlineAfter = getOfflineImagesForJob(job?.jobNumber, 'after').map(img => img.uri);

      setBeforeUris(signedBefore.length > 0 ? signedBefore : bImages.map((img: any) => img.secureUrl || img.s3url || img.url || '').filter(Boolean));
      setAfterUris(signedAfter.length > 0 ? signedAfter : aImages.map((img: any) => img.secureUrl || img.s3url || img.url || '').filter(Boolean));
      
      setOfflineBeforeUris(offlineBefore);
      setOfflineAfterUris(offlineAfter);
    } catch {
    } finally {
      setSigningUrls(false);
    }
  }, [job?.jobNumber]);

  const initImages = useCallback(() => {
    if (!job) return;
    const bImages = job?.images?.beforeImages || [];
    const aImages = job?.images?.afterImages || [];

    setBeforeImages(bImages);
    setAfterImages(aImages);
    setPendingDeletions([]);
    setNewBeforeImages([]);
    setNewAfterImages([]);

    setFallbackUris(bImages, aImages);

    fetchSignedUrls(bImages, aImages);
  }, [job, setFallbackUris, fetchSignedUrls]);

  const lastJobIdRef = useRef<string | null>(null);
  const lastVisibleRef = useRef<boolean>(false);

  const refreshJobImages = useCallback(async () => {
    if (!job?.jobNumber) return null;
    try {
      const res = await LeadService.findJobs({ jobNumber: job.jobNumber });
      const updated = res.data?.data?.[0];
      if (updated) {
        const bImages = updated?.images?.beforeImages || [];
        const aImages = updated?.images?.afterImages || [];
        setBeforeImages(bImages);
        setAfterImages(aImages);
        setFallbackUris(bImages, aImages);
        fetchSignedUrls(bImages, aImages);
        return updated;
      }
    } catch (err) {
      console.warn('Failed to refresh job images on modal open:', err);
    }
    return null;
  }, [job?.jobNumber, setFallbackUris, fetchSignedUrls]);

  useEffect(() => {
    if (visible && job) {
      const isNewJob = job._id !== lastJobIdRef.current || !lastVisibleRef.current;
      if (isNewJob) {
        setBeforeUris([]);
        setAfterUris([]);
        setOfflineBeforeUris([]);
        setOfflineAfterUris([]);
        setBeforeImages([]);
        setAfterImages([]);
        setNewBeforeImages([]);
        setNewAfterImages([]);
      }
      lastJobIdRef.current = job._id;
      lastVisibleRef.current = visible;
      initImages();
      refreshJobImages();
    } else if (!visible) {
      lastVisibleRef.current = false;
    }
  }, [visible, job?._id, initImages, refreshJobImages]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('OFFLINE_UPLOAD_SUCCESS', async (data) => {
      if (data?.jobNumber === job?.jobNumber) {
        const updated = await refreshJobImages();
        if (updated) {
          const offlineBefore = getOfflineImagesForJob(job.jobNumber, 'before').map(img => img.uri);
          const offlineAfter = getOfflineImagesForJob(job.jobNumber, 'after').map(img => img.uri);
          setOfflineBeforeUris(offlineBefore);
          setOfflineAfterUris(offlineAfter);
        }
      }
    });
    return () => sub.remove();
  }, [job?.jobNumber, refreshJobImages]);

  const handleLocalDelete = (type: 'before' | 'after', index: number) => {
    if (type === 'before' && beforeUris.length <= 1) {
      FlashMessage.warning('At least 1 before image is required.'); return;
    }
    if (type === 'after' && afterUris.length <= 1) {
      FlashMessage.warning('At least 1 after image is required.'); return;
    }
    if (type === 'before') {
      const img = beforeImages[index];
      setPendingDeletions(prev => [...prev, { ...img, imgType: 'before' }]);
      setBeforeUris(prev => prev.filter((_, i) => i !== index));
      setBeforeImages(prev => prev.filter((_, i) => i !== index));
    } else {
      const img = afterImages[index];
      setPendingDeletions(prev => [...prev, { ...img, imgType: 'after' }]);
      setAfterUris(prev => prev.filter((_, i) => i !== index));
      setAfterImages(prev => prev.filter((_, i) => i !== index));
    }
  };

  const confirmDeleteDirect = (type: 'before' | 'after', index: number) => {
    if (type === 'before' && beforeUris.length <= 1) {
      FlashMessage.warning('At least 1 before image is required.');
      return;
    }
    if (type === 'after' && afterUris.length <= 1) {
      FlashMessage.warning('At least 1 after image is required.');
      return;
    }
    setImageToDelete({ type, index });
    setDeleteConfirmVisible(true);
  };

  const handleDeleteDirect = async () => {
    if (!imageToDelete) return;
    const { type, index } = imageToDelete;
    setDeleteConfirmVisible(false);
    try {
      setSaving(true);
      const img = type === 'before' ? beforeImages[index] : afterImages[index];
      const filePath = img.filePath || img.s3url || img.secureUrl || img;
      await LeadService.deleteJobImages({
        jobNumber: job.jobNumber,
        companyId: job.companyId,
        beforeImages: type === 'before' ? [filePath] : [],
        afterImages: type === 'after' ? [filePath] : [],
      });
      if (type === 'before') {
        setBeforeUris(prev => prev.filter((_, i) => i !== index));
        setBeforeImages(prev => prev.filter((_, i) => i !== index));
      } else {
        setAfterUris(prev => prev.filter((_, i) => i !== index));
        setAfterImages(prev => prev.filter((_, i) => i !== index));
      }
      const uId = user?._id || user?.id;
      if (uId) {
        logEvent('delete', {
          user_id: uId,
          module_type: 'before_after_images',
          created_by: uId,
          meta: {
            job_number: job?.jobNumber,
            company_id: job?.companyId,
            image_type: type,
          },
        });
      }
      FlashMessage.success('Image deleted successfully');
      onUploadSuccess?.();
    } catch (err) {
      console.error('Direct delete failed:', err);
      FlashMessage.error('Failed to delete image. Please try again.');
    } finally {
      setSaving(false);
      setImageToDelete(null);
    }
  };

  const handleSaveChanges = async () => {
    if (pendingDeletions.length === 0 && newBeforeImages.length === 0 && newAfterImages.length === 0) {
      onClose();
      return;
    }
    try {
      setSaving(true);

      if (pendingDeletions.length > 0) {
        const beforePaths = pendingDeletions.filter(d => d.imgType === 'before').map(d => d.filePath).filter(Boolean);
        const afterPaths = pendingDeletions.filter(d => d.imgType === 'after').map(d => d.filePath).filter(Boolean);
        await LeadService.deleteJobImages({
          jobNumber: job.jobNumber,
          companyId: job.companyId,
          beforeImages: beforePaths,
          afterImages: afterPaths,
        });
      }

      let updatedBefore = [];
      if (newBeforeImages.length > 0) {
        const formData = new FormData();
        formData.append('jobNumber', job.jobNumber);
        formData.append('companyId', job.companyId);
        newBeforeImages.forEach((file) => {
          formData.append('files', { uri: file.uri, type: file.type, name: file.name } as any);
        });
        const res = await LeadService.updateBeforeImages(formData);
        updatedBefore = res.data?.data?.images?.beforeImages || res.data?.images?.beforeImages || [];
      }

      let updatedAfter = [];
      if (newAfterImages.length > 0) {
        const formData = new FormData();
        formData.append('jobNumber', job.jobNumber);
        formData.append('companyId', job.companyId);
        newAfterImages.forEach((file) => {
          formData.append('files', { uri: file.uri, type: file.type, name: file.name } as any);
        });
        const res = await LeadService.updateAfterImages(formData);
        updatedAfter = res.data?.data?.images?.afterImages || res.data?.images?.afterImages || [];
      }

      const userId = user?._id || user?.id;
      if (userId) {
        if (newBeforeImages.length > 0 && updatedBefore.length > 0) {
          logEvent('add', {
            user_id: userId,
            module_type: 'before_after_images',
            created_by: userId,
            meta: {
              type: 'before',
              job_number: job?.jobNumber,
              company_id: job?.companyId,
              imageData: updatedBefore.map((img: any) => ({
                s3url: img?.s3url?.filePath || img?.s3url || img?.url || img?.imagePath || img?.filePath || img,
                bucketName: img?.s3url?.bucketName || img?.bucketName || null,
                uploadedAt: img?.s3url?.uploadedAt || img?.uploadedAt || null,
                category: 'Before',
                fileName: img?.fileName || img?.name || null,
              })),
            },
          });
        }
        if (newAfterImages.length > 0 && updatedAfter.length > 0) {
          logEvent('add', {
            user_id: userId,
            module_type: 'before_after_images',
            created_by: userId,
            meta: {
              type: 'after',
              job_number: job?.jobNumber,
              company_id: job?.companyId,
              imageData: updatedAfter.map((img: any) => ({
                s3url: img?.s3url?.filePath || img?.s3url || img?.url || img?.imagePath || img?.filePath || img,
                bucketName: img?.s3url?.bucketName || img?.bucketName || null,
                uploadedAt: img?.s3url?.uploadedAt || img?.uploadedAt || null,
                category: 'After',
                fileName: img?.fileName || img?.name || null,
              })),
            },
          });
        }
        if (pendingDeletions.length > 0) {
          logEvent('delete', {
            user_id: userId,
            module_type: 'before_after_images',
            created_by: userId,
            meta: {
              job_number: job?.jobNumber,
              company_id: job?.companyId,
              count: pendingDeletions.length,
            },
          });
        }
        logEvent('update', {
          user_id: userId,
          module_type: 'image_order',
          created_by: userId,
          meta: {
            job_number: job?.jobNumber,
            company_id: job?.companyId,
          },
        });
      }

      setPendingDeletions([]);
      setNewBeforeImages([]);
      setNewAfterImages([]);
      FlashMessage.success('Images updated successfully');
      onUploadSuccess?.();
      onClose();
    } catch (err) {
      console.error(err);
      FlashMessage.error('Failed to save changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!job) return null;

  const allBeforeUris = [...beforeUris, ...offlineBeforeUris];
  const allAfterUris = [...afterUris, ...offlineAfterUris];
  const hasNoImages = allBeforeUris.length === 0 && allAfterUris.length === 0;
  const mainModalVisible =
    visible &&
    !showBeforeModal &&
    !showAfterModal &&
    !showPresent &&
    !viewerVisible;

  return (
    <View>
      <Modal visible={mainModalVisible} animationType="fade" transparent onRequestClose={onClose}>
        <View className="flex-1 justify-center items-center bg-black/60 px-5">
          <View
            className="bg-white rounded-[32px] overflow-hidden"
            style={{ width: width * 0.9, maxHeight: height * 0.85 }}
          >
            {/* Header */}
            <View className="p-6 flex-row justify-between items-center">
              <View className="flex-row items-center">
                <Logo width={120} />
              </View>
              <View className="flex-row items-center gap-2">
                {/* Subtle signing indicator — non-blocking */}
                {signingUrls && (
                  <ActivityIndicator size="small" color="#94a3b8" />
                )}
                <TouchableOpacity onPress={onClose} className="p-1">
                  <Icon name="close" size={24} color="#64748b" />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView className="px-6 pb-2">
              {(newBeforeImages.length > 0 || newAfterImages.length > 0) && (
                <View className="flex-row items-center bg-[#E6F9FC] dark:bg-cyan-950/20 border border-[#00AEC7] p-4 rounded-[16px] mb-6 gap-3">
                  <Icon name="information-outline" size={20} color="#00AEC7" />
                  <Text className="flex-1 text-[13px] font-medium text-[#004B6E] dark:text-cyan-200 leading-5">
                    New uploaded images cannot be reordered until saved. Save changes first.
                  </Text>
                </View>
              )}
              <View className="flex-row gap-4">
                {/* ── Before Column ── */}
                <View className="flex-1">
                  <View className="flex-row justify-between items-center mb-4">
                    <Text className="text-[14px] font-black text-slate-800">Before</Text>
                    {isMyJob && (
                      <TouchableOpacity
                        onPress={() => setShowBeforeModal(true)}
                        style={{ backgroundColor: '#212B36', width: 36, height: 32, borderRadius: 8 }}
                        className="items-center justify-center"
                      >
                        <Icon name="plus" size={20} color="white" />
                      </TouchableOpacity>
                    )}
                  </View>

                  {(allBeforeUris.length > 0 || newBeforeImages.length > 0) ? (
                    <View className="gap-4">
                      {allBeforeUris.map((uri, idx) => {
                        const isOffline = offlineBeforeUris.includes(uri);
                        return (
                          <GalleryImage
                            key={`before-${idx}-${uri.slice(-12)}`}
                            uri={uri}
                            canDelete={isMyJob && !isOffline && allBeforeUris.length > 1}
                            onExpand={() => {
                              setViewerUri(uri);
                              setViewerVisible(true);
                              const uId = user?._id || user?.id;
                              if (uId) {
                                const rawImg = beforeImages[idx];
                                logEvent('preview', {
                                  user_id: uId,
                                  module_type: 'before_after_images',
                                  created_by: uId,
                                  meta: {
                                    job_number: job?.jobNumber,
                                    company_id: job?.companyId,
                                    category: 'Before',
                                    index: idx,
                                    s3url: rawImg?.filePath || rawImg?.s3url || rawImg?.secureUrl || uri,
                                    bucketName: rawImg?.bucketName || ENV.S3_BUCKET || null,
                                  },
                                });
                              }
                            }}
                            onDelete={() => confirmDeleteDirect('before', idx)}
                          />
                        );
                      })}
                      {newBeforeImages.map((file, idx) => (
                        <GalleryImage
                          key={`new-before-${idx}`}
                          uri={file.uri}
                          canDelete={true}
                          onExpand={() => {
                            setViewerUri(file.uri);
                            setViewerVisible(true);
                            const uId = user?._id || user?.id;
                            if (uId) {
                              logEvent('preview', {
                                user_id: uId,
                                module_type: 'before_after_images',
                                created_by: uId,
                                meta: {
                                  job_number: job?.jobNumber,
                                  company_id: job?.companyId,
                                  category: 'Before',
                                  index: beforeUris.length + idx,
                                  s3url: file.uri,
                                  bucketName: ENV.S3_BUCKET || null,
                                },
                              });
                            }
                          }}
                          onDelete={() => {
                            setNewBeforeImages(prev => prev.filter((_, i) => i !== idx));
                          }}
                        />
                      ))}
                    </View>
                  ) : (
                    job?.images?.beforeImages?.length > 0 ? (
                      <View className="gap-4">
                        {(job.images.beforeImages as any[]).map((_: any, idx: number) => (
                          <View key={`bsk-${idx}`} className="rounded-2xl overflow-hidden aspect-[3/4]">
                            <ImageSkeleton />
                          </View>
                        ))}
                      </View>
                    ) : (
                      <View className="rounded-2xl bg-slate-50 border border-slate-100 aspect-[3/4] items-center justify-center p-4">
                        <Icon name="image-off-outline" size={32} color="#cbd5e1" />
                        <Text style={{ fontSize: 10 }} className="font-bold text-slate-400 text-center mt-2 uppercase tracking-tighter">
                          No images
                        </Text>
                      </View>
                    )
                  )}
                </View>
 
                {/* ── After Column ── */}
                <View className="flex-1">
                  <View className="flex-row justify-between items-center mb-4">
                    <Text className="text-[14px] font-black text-slate-800">After</Text>
                    {isMyJob && (
                      <TouchableOpacity
                        onPress={() => setShowAfterModal(true)}
                        style={{ backgroundColor: '#212B36', width: 36, height: 32, borderRadius: 8 }}
                        className="items-center justify-center"
                      >
                        <Icon name="plus" size={20} color="white" />
                      </TouchableOpacity>
                    )}
                  </View>
 
                  {(allAfterUris.length > 0 || newAfterImages.length > 0) ? (
                    <View className="gap-4">
                      {allAfterUris.map((uri, idx) => {
                        const isOffline = offlineAfterUris.includes(uri);
                        return (
                          <GalleryImage
                            key={`after-${idx}-${uri.slice(-12)}`}
                            uri={uri}
                            canDelete={isMyJob && !isOffline && allAfterUris.length > 1}
                            onExpand={() => {
                              setViewerUri(uri);
                              setViewerVisible(true);
                              const uId = user?._id || user?.id;
                              if (uId) {
                                const rawImg = afterImages[idx];
                                logEvent('preview', {
                                  user_id: uId,
                                  module_type: 'before_after_images',
                                  created_by: uId,
                                  meta: {
                                    job_number: job?.jobNumber,
                                    company_id: job?.companyId,
                                    category: 'After',
                                    index: idx,
                                    s3url: rawImg?.filePath || rawImg?.s3url || rawImg?.secureUrl || uri,
                                    bucketName: rawImg?.bucketName || ENV.S3_BUCKET || null,
                                  },
                                });
                              }
                            }}
                            onDelete={() => confirmDeleteDirect('after', idx)}
                          />
                        );
                      })}
                      {newAfterImages.map((file, idx) => (
                        <GalleryImage
                          key={`new-after-${idx}`}
                          uri={file.uri}
                          canDelete={true}
                          onExpand={() => {
                            setViewerUri(file.uri);
                            setViewerVisible(true);
                            const uId = user?._id || user?.id;
                            if (uId) {
                              logEvent('preview', {
                                user_id: uId,
                                module_type: 'before_after_images',
                                created_by: uId,
                                meta: {
                                  job_number: job?.jobNumber,
                                  company_id: job?.companyId,
                                  category: 'After',
                                  index: afterUris.length + idx,
                                  s3url: file.uri,
                                  bucketName: ENV.S3_BUCKET || null,
                                },
                              });
                            }
                          }}
                          onDelete={() => {
                            setNewAfterImages(prev => prev.filter((_, i) => i !== idx));
                          }}
                        />
                      ))}
                    </View>
                  ) : (
                    job?.images?.afterImages?.length > 0 ? (
                      <View className="gap-4">
                        {(job.images.afterImages as any[]).map((_: any, idx: number) => (
                          <View key={`ask-${idx}`} className="rounded-2xl overflow-hidden aspect-[3/4]">
                            <ImageSkeleton />
                          </View>
                        ))}
                      </View>
                    ) : (
                      <View className="rounded-2xl bg-slate-50 border border-slate-100 aspect-[3/4] items-center justify-center p-4">
                        <Icon name="image-off-outline" size={32} color="#cbd5e1" />
                        <Text style={{ fontSize: 10 }} className="font-bold text-slate-400 text-center mt-2 uppercase tracking-tighter">
                          No images
                        </Text>
                      </View>
                    )
                  )}
                </View>
              </View>

              <View style={{ height: 20 }} />
            </ScrollView>

            {/* Footer */}
            <View className="py-3 px-6 flex-row items-center justify-between border-t border-slate-100 bg-white">
              <TouchableOpacity
                onPress={() => {
                  if (allBeforeUris.length > 0 && allAfterUris.length > 0) { setShowPresent(true); }
                  else { FlashMessage.warning('You need at least one Before and one After image.'); }
                }}
                className="flex-row items-center"
              >
                <Icon
                  name="presentation"
                  size={16}
                  color={allBeforeUris.length > 0 && allAfterUris.length > 0 ? '#65C216' : '#cbd5e1'}
                />
                <Text
                  className="ml-2 text-[14px] font-black"
                  style={{ color: allBeforeUris.length > 0 && allAfterUris.length > 0 ? '#65C216' : '#cbd5e1' }}
                >
                  Present
                </Text>
              </TouchableOpacity>

              {isMyJob ? (
                <View className="flex-row gap-2">
                  <TouchableOpacity onPress={onClose} className="p-2 rounded-xl border border-slate-200">
                    <Text className="text-[14px] font-black text-slate-700">Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={saving || (pendingDeletions.length === 0 && newBeforeImages.length === 0 && newAfterImages.length === 0)}
                    onPress={handleSaveChanges}
                    style={{
                      backgroundColor:
                        saving || (pendingDeletions.length === 0 && newBeforeImages.length === 0 && newAfterImages.length === 0)
                          ? '#E2E8F0'
                          : '#65C216'
                    }}
                    className="p-2 rounded-xl"
                  >
                    {saving
                      ? <ActivityIndicator size="small" color="white" />
                      : <Text className="text-[14px] font-black text-white">Save Changes</Text>
                    }
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity onPress={onClose} className="px-6 py-2.5 rounded-xl border border-slate-200">
                  <Text className="text-[14px] font-black text-slate-700">Close</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Delete Confirmation Modal */}
            <Modal visible={deleteConfirmVisible} transparent animationType="fade">
              <View className="flex-1 justify-center items-center bg-black/60 px-4">
                <View className="bg-white rounded-[32px] p-6 w-[90%] max-w-sm shadow-2xl">
                  <Text className="text-[18px] font-black text-[#1C252E] mb-2">Confirm Delete</Text>
                  <Text className="text-slate-600 text-sm mb-6 leading-5">Are you sure you want to delete this image?</Text>
                  <View className="flex-row justify-end gap-3">
                    <TouchableOpacity
                      onPress={() => {
                        setDeleteConfirmVisible(false);
                        setImageToDelete(null);
                      }}
                      className="px-4 py-2.5 rounded-xl justify-center items-center"
                    >
                      <Text className="font-bold text-[#1C252E] text-sm">Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleDeleteDirect}
                      className="bg-[#FF5630] px-5 py-2.5 rounded-xl justify-center items-center"
                    >
                      <Text className="text-white font-bold text-sm">Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Modal>
          </View>
        </View>
      </Modal>

      {/* Before upload modal */}
      <BeforeImageModal
        visible={showBeforeModal}
        onClose={() => setShowBeforeModal(false)}
        job={job}
        existingUris={beforeUris}
        onSelectImages={(images) => {
          setNewBeforeImages(images);
        }}
      />

      {/* After upload modal */}
      <AfterImageModal
        visible={showAfterModal}
        onClose={() => setShowAfterModal(false)}
        job={job}
        existingUris={afterUris}
        onSelectImages={(images) => {
          setNewAfterImages(images);
        }}
      />

      <BeforeAfterPresentModal
        visible={showPresent}
        onClose={() => setShowPresent(false)}
        beforeImages={beforeUris}
        afterImages={afterUris}
        job={job}
      />

      {/* Full-screen viewer */}
      <Modal
        visible={viewerVisible}
        transparent
        animationType="slide"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={() => { setViewerVisible(false); resetViewer(); }}
      >
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View className="flex-1 bg-black justify-center items-center">
            <TouchableOpacity
              className="absolute top-12 right-6 z-10 p-2 bg-white/20 rounded-full"
              onPress={() => { setViewerVisible(false); resetViewer(); }}
            >
              <Icon name="close" size={30} color="white" />
            </TouchableOpacity>
            {viewerUri && (
              <>
                {!viewerImgLoaded && (
                  <ActivityIndicator size="large" color="#65C216" style={{ position: 'absolute' }} />
                )}
                <GestureDetector gesture={composedGesture}>
                  <Animated.Image
                    source={{ uri: viewerUri }}
                    style={[{ width: '100%', height: '100%', opacity: viewerImgLoaded ? 1 : 0 }, animatedStyle]}
                    resizeMode="contain"
                    onLoad={() => setViewerImgLoaded(true)}
                    onError={() => setViewerImgLoaded(true)}
                  />
                </GestureDetector>
              </>
            )}
          </View>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
};
