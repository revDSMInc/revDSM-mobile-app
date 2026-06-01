import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, Modal, Image,
  Dimensions, ScrollView, ActivityIndicator, Alert,
  Animated as RNAnimated,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from 'react-native-reanimated';
import { BeforeAfterPresentModal } from './BeforeAfterPresentModal';
import { BeforeImageModal } from '../../modals/BeforeImageModal';
import { AfterImageModal } from '../../modals/AfterImageModal';
import Logo from "../../../assets/svgs/logo"

const { width, height } = Dimensions.get('window');

// ─── Shimmer skeleton for a single image slot ───────────────────────────────
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

// ─── Single image with its own load state ───────────────────────────────────
const GalleryImage = React.memo(({ uri, onExpand, onDelete, canDelete }: {
  uri: string;
  onExpand: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
}) => {
  const [imgLoaded, setImgLoaded] = useState(false);

  return (
    <View className="rounded-2xl overflow-hidden bg-slate-100 aspect-[3/4] shadow-sm relative">
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
          <TouchableOpacity
            onPress={onExpand}
            className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/40 items-center justify-center"
          >
            <Icon name="dots-grid" size={16} color="white" />
          </TouchableOpacity>
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
    </View>
  );
});

interface MapGalleryModalProps {
  visible: boolean;
  onClose: () => void;
  job: any;
  isMyJob?: boolean;
  onUploadSuccess?: () => void;
}

export const MapGalleryModal = ({
  visible,
  onClose,
  job,
  isMyJob = false,
  onUploadSuccess,
}: MapGalleryModalProps) => {
  const [signingUrls, setSigningUrls] = useState(false);  // background sign, not blocking
  const [saving, setSaving] = useState(false);

  const [beforeImages, setBeforeImages] = useState<any[]>([]);
  const [afterImages, setAfterImages] = useState<any[]>([]);
  const [beforeUris, setBeforeUris] = useState<string[]>([]);
  const [afterUris, setAfterUris] = useState<string[]>([]);

  const [pendingDeletions, setPendingDeletions] = useState<any[]>([]);
  const [showPresent, setShowPresent] = useState(false);
  const [showBeforeModal, setShowBeforeModal] = useState(false);
  const [showAfterModal, setShowAfterModal] = useState(false);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  // Gesture state for full-screen viewer
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

  // ─── PHASE 1: Instantly show any direct URLs available on the image objects
  const setFallbackUris = useCallback((bImages: any[], aImages: any[]) => {
    const extractFallback = (img: any): string =>
      img.secureUrl || img.s3url || img.url || '';
    const bFallback = bImages.map(extractFallback).filter(Boolean);
    const aFallback = aImages.map(extractFallback).filter(Boolean);
    if (bFallback.length > 0) setBeforeUris(bFallback);
    if (aFallback.length > 0) setAfterUris(aFallback);
  }, []);

  // ─── PHASE 2: Silently upgrade to fresh signed URLs in the background
  const fetchSignedUrls = useCallback(async (bImages: any[], aImages: any[]) => {
    if (bImages.length === 0 && aImages.length === 0) return;
    try {
      setSigningUrls(true);
      const filePaths = [
        ...bImages.map((img: any) => ({
          bucketName: img.bucketName || 'np-revdsm-staging',
          filePath: img.filePath || img.s3url || img.secureUrl,
        })),
        ...aImages.map((img: any) => ({
          bucketName: img.bucketName || 'np-revdsm-staging',
          filePath: img.filePath || img.s3url || img.secureUrl,
        })),
      ];
      const res = await LeadService.getSecureUrls(filePaths);
      const secureData = res.data?.data || res.data || [];
      const signedBefore = secureData.slice(0, bImages.length)
        .map((s: any) => s?.secureUrl || s?.url || '').filter(Boolean);
      const signedAfter = secureData.slice(bImages.length)
        .map((s: any) => s?.secureUrl || s?.url || '').filter(Boolean);
      // Only update if we actually got signed URLs
      if (signedBefore.length > 0) setBeforeUris(signedBefore);
      if (signedAfter.length > 0) setAfterUris(signedAfter);
    } catch {
      // Keep fallback URLs — no-op on error
    } finally {
      setSigningUrls(false);
    }
  }, []);

  const initImages = useCallback(() => {
    if (!job) return;
    const bImages = job?.images?.beforeImages || [];
    const aImages = job?.images?.afterImages || [];

    setBeforeImages(bImages);
    setAfterImages(aImages);
    setPendingDeletions([]);

    // Phase 1: show fallback URLs instantly (no spinner, no delay)
    setFallbackUris(bImages, aImages);

    // Phase 2: upgrade to signed URLs silently in the background
    fetchSignedUrls(bImages, aImages);
  }, [job, setFallbackUris, fetchSignedUrls]);

  const lastJobIdRef = useRef<string | null>(null);
  const lastVisibleRef = useRef<boolean>(false);

  useEffect(() => {
    if (visible && job) {
      const isNewJob = job._id !== lastJobIdRef.current || !lastVisibleRef.current;
      if (isNewJob) {
        setBeforeUris([]);
        setAfterUris([]);
        setBeforeImages([]);
        setAfterImages([]);
      }
      lastJobIdRef.current = job._id;
      lastVisibleRef.current = visible;
      initImages();
    } else if (!visible) {
      lastVisibleRef.current = false;
    }
  }, [visible, job?._id, job?.images?.beforeImages?.length, job?.images?.afterImages?.length, initImages]);

  // ─── Local delete (staged until Save Changes) ────────────────────
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

  // ─── Save pending deletions via correct API payload format ────────
  const handleSaveChanges = async () => {
    if (pendingDeletions.length === 0) { onClose(); return; }
    try {
      setSaving(true);
      const beforePaths = pendingDeletions.filter(d => d.imgType === 'before').map(d => d.filePath).filter(Boolean);
      const afterPaths = pendingDeletions.filter(d => d.imgType === 'after').map(d => d.filePath).filter(Boolean);
      await LeadService.deleteJobImages({
        jobNumber: job.jobNumber,
        companyId: job.companyId,
        beforeImages: beforePaths,
        afterImages: afterPaths,
      });
      setPendingDeletions([]);
      FlashMessage.success('Images updated successfully');
      onUploadSuccess?.();
      onClose();
    } catch {
      FlashMessage.error('Failed to delete images. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!job) return null;

  const hasNoImages = beforeUris.length === 0 && afterUris.length === 0;

  return (
    <View>
      <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
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
                <TouchableOpacity onPress={initImages} className="p-2">
                  <Icon name="refresh" size={20} color="#64748b" />
                </TouchableOpacity>
                <TouchableOpacity onPress={onClose} className="p-1">
                  <Icon name="close" size={24} color="#64748b" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Read-only badge */}
            {/* {!isMyJob && (
              <View className="mx-6 mb-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl flex-row items-center gap-2">
                <Icon name="eye-outline" size={14} color="#94a3b8" />
                <Text className="text-[11px] font-bold text-slate-400">View only — not your job</Text>
              </View>
            )} */}

            <ScrollView className="px-6 pb-2">
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

                  {beforeUris.length > 0 ? (
                    <View className="gap-4">
                      {beforeUris.map((uri, idx) => (
                        <GalleryImage
                          key={`before-${idx}-${uri.slice(-12)}`}
                          uri={uri}
                          canDelete={isMyJob && beforeUris.length > 1}
                          onExpand={() => { setViewerUri(uri); setViewerVisible(true); }}
                          onDelete={() => handleLocalDelete('before', idx)}
                        />
                      ))}
                    </View>
                  ) : (
                    /* Skeleton placeholder while URIs are loading */
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

                  {afterUris.length > 0 ? (
                    <View className="gap-4">
                      {afterUris.map((uri, idx) => (
                        <GalleryImage
                          key={`after-${idx}-${uri.slice(-12)}`}
                          uri={uri}
                          canDelete={isMyJob && afterUris.length > 1}
                          onExpand={() => { setViewerUri(uri); setViewerVisible(true); }}
                          onDelete={() => handleLocalDelete('after', idx)}
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
                  if (beforeUris.length > 0 && afterUris.length > 0) { setShowPresent(true); }
                  else { FlashMessage.warning('You need at least one Before and one After image.'); }
                }}
                className="flex-row items-center"
              >
                <Icon
                  name="presentation"
                  size={16}
                  color={beforeUris.length > 0 && afterUris.length > 0 ? '#65C216' : '#cbd5e1'}
                />
                <Text
                  className="ml-2 text-[14px] font-black"
                  style={{ color: beforeUris.length > 0 && afterUris.length > 0 ? '#65C216' : '#cbd5e1' }}
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
                    disabled={saving || pendingDeletions.length === 0}
                    onPress={handleSaveChanges}
                    style={{ backgroundColor: saving || pendingDeletions.length === 0 ? '#E2E8F0' : '#65C216' }}
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
          </View>
        </View>
      </Modal>

      {/* Before upload modal */}
      <BeforeImageModal
        visible={showBeforeModal}
        onClose={() => setShowBeforeModal(false)}
        job={job}
        existingUris={beforeUris}
        onUploadSuccess={async () => {
          setShowBeforeModal(false);
          if (onUploadSuccess) {
            onUploadSuccess();
          } else {
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
              }
            } catch (err) {
              console.error('Failed to reload job after before-image upload', err);
            }
          }
        }}
      />

      {/* After upload modal */}
      <AfterImageModal
        visible={showAfterModal}
        onClose={() => setShowAfterModal(false)}
        job={job}
        existingUris={afterUris}
        onUploadSuccess={async () => {
          setShowAfterModal(false);
          if (onUploadSuccess) {
            onUploadSuccess();
          } else {
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
              }
            } catch (err) {
              console.error('Failed to reload job after after-image upload', err);
            }
          }
        }}
      />

      <BeforeAfterPresentModal
        visible={showPresent}
        onClose={() => setShowPresent(false)}
        beforeImages={beforeUris}
        afterImages={afterUris}
      />

      {/* Full-screen viewer */}
      <Modal visible={viewerVisible} transparent animationType="slide">
        <GestureHandlerRootView style={{ flex: 1 }}>
          <View className="flex-1 bg-black justify-center items-center">
            <TouchableOpacity
              className="absolute top-12 right-6 z-10 p-2 bg-white/20 rounded-full"
              onPress={() => { setViewerVisible(false); resetViewer(); }}
            >
              <Icon name="close" size={30} color="white" />
            </TouchableOpacity>
            {viewerUri && (
              <GestureDetector gesture={composedGesture}>
                <Animated.Image
                  source={{ uri: viewerUri }}
                  style={[{ width: '100%', height: '100%' }, animatedStyle]}
                  resizeMode="contain"
                />
              </GestureDetector>
            )}
          </View>
        </GestureHandlerRootView>
      </Modal>
    </View>
  );
};
