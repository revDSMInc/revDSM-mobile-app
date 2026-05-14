import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Image,
  Dimensions,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { LeadService } from '../../../services/api/leads';

const { width, height } = Dimensions.get('window');

import { BeforeAfterPresentModal } from './BeforeAfterPresentModal';

interface MapGalleryModalProps {
  visible: boolean;
  onClose: () => void;
  job: any;
  onCameraPress?: (job: any, type?: 'before' | 'after') => void;
}

export const MapGalleryModal = ({
  visible,
  onClose,
  job,
  onCameraPress,
}: MapGalleryModalProps) => {
  const { colors, isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Storage for image objects (bucketName, filePath, etc)
  const [beforeImages, setBeforeImages] = useState<any[]>([]);
  const [afterImages, setAfterImages] = useState<any[]>([]);
  
  // Storage for secured URIs
  const [beforeUris, setBeforeUris] = useState<string[]>([]);
  const [afterUris, setAfterUris] = useState<string[]>([]);
  
  const [pendingDeletions, setPendingDeletions] = useState<any[]>([]);
  const [showPresent, setShowPresent] = useState(false);
  
  // Image Viewer State
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  useEffect(() => {
    if (visible && job) {
      fetchSecureUrls();
    } else {
      setBeforeUris([]);
      setAfterUris([]);
      setPendingDeletions([]);
    }
  }, [visible, job?._id, job?.images?.beforeImages?.length, job?.images?.afterImages?.length]);


  const fetchSecureUrls = async () => {
    const bImages = job.images?.beforeImages || [];
    const aImages = job.images?.afterImages || [];

    if (bImages.length === 0 && aImages.length === 0) return;

    try {
      setLoading(true);
      setBeforeImages(bImages);
      setAfterImages(aImages);
      
      const filePaths = [
        ...bImages.map((img: any) => ({
          bucketName: img.bucketName || 'np-revdsm-staging',
          filePath: img.filePath || img.s3url,
        })),
        ...aImages.map((img: any) => ({
          bucketName: img.bucketName || 'np-revdsm-staging',
          filePath: img.filePath || img.s3url,
        })),
      ];

      const res = await LeadService.getSecureUrls(filePaths);
      const secureData = res.data?.data || res.data || [];

      // Map back to before/after
      const securedBefore = secureData.slice(0, bImages.length).map((s: any) => s.secureUrl);
      const securedAfter = secureData.slice(bImages.length).map((s: any) => s.secureUrl);

      setBeforeUris(securedBefore);
      setAfterUris(securedAfter);
    } catch (error) {
      console.error('Failed to fetch secure gallery URLs', error);
    } finally {
      setLoading(false);
    }
  };

  const handleLocalDelete = (type: 'before' | 'after', index: number) => {
    if (type === 'before') {
      const img = beforeImages[index];
      setPendingDeletions(prev => [...prev, { ...img, type: 'before' }]);
      const newUris = [...beforeUris];
      const newImages = [...beforeImages];
      newUris.splice(index, 1);
      newImages.splice(index, 1);
      setBeforeUris(newUris);
      setBeforeImages(newImages);
    } else {
      const img = afterImages[index];
      setPendingDeletions(prev => [...prev, { ...img, type: 'after' }]);
      const newUris = [...afterUris];
      const newImages = [...afterImages];
      newUris.splice(index, 1);
      newImages.splice(index, 1);
      setAfterUris(newUris);
      setAfterImages(newImages);
    }
  };

  const handleSaveChanges = async () => {
    if (pendingDeletions.length === 0) {
      onClose();
      return;
    }

    try {
      setSaving(true);
      const payload = {
        jobId: job._id,
        images: pendingDeletions.map(img => ({
          bucketName: img.bucketName,
          filePath: img.filePath,
          type: img.type
        }))
      };
      
      await LeadService.deleteJobImages(payload);
      onClose();
    } catch (error) {
      console.error('Failed to save gallery changes', error);
    } finally {
      setSaving(false);
    }
  };

  const openViewer = (uri: string) => {
    setViewerUri(uri);
    setViewerVisible(true);
  };

  if (!job) return null;

  return (
    <View>
      <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
        <View className="flex-1 justify-center items-center bg-black/60 px-5">
          <View 
            className="bg-white rounded-[32px] overflow-hidden"
            style={{ width: width * 0.9, maxHeight: height * 0.85 }}
          >
            {/* Logo & Close */}
            <View className="p-6 flex-row justify-between items-center">
              <View className="flex-row items-center">
                <Text className="text-[28px] font-black text-[#65C216]">rev</Text>
                <Text className="text-[28px] font-black text-slate-800">DSM</Text>
              </View>
              <TouchableOpacity onPress={onClose} className="p-1">
                <Icon name="close" size={24} color="#64748b" />
              </TouchableOpacity>
            </View>

            {loading ? (
              <View className="h-64 items-center justify-center">
                <ActivityIndicator size="large" color="#65C216" />
                <Text className="mt-4 text-slate-400 font-bold text-[12px]">Loading site images...</Text>
              </View>
            ) : (
              <ScrollView className="px-6 pb-2">
                <View className="flex-row gap-4">
                  {/* Before Section */}
                  <View className="flex-1">
                    <View className="flex-row justify-between items-center mb-6">
                      <Text className="text-[14px] font-black text-slate-800">Before</Text>
                      <TouchableOpacity 
                        onPress={() => onCameraPress?.(job, 'before')}
                        style={{ backgroundColor: '#212B36', width: 36, height: 32, borderRadius: 8 }}
                        className="items-center justify-center"
                      >
                        <Icon name="plus" size={20} color="white" />
                      </TouchableOpacity>
                    </View>
                    {beforeUris.length > 0 ? (
                      <View className="gap-4">
                        {beforeUris.map((uri, idx) => (
                          <View key={`before-${idx}`} className="rounded-2xl overflow-hidden bg-slate-100 aspect-[3/4] shadow-sm relative">
                            <Image 
                              source={{ uri }} 
                              className="w-full h-full"
                              resizeMode="cover"
                            />
                            {/* Dots Grid Icon */}
                            <TouchableOpacity 
                              onPress={() => openViewer(uri)}
                              className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/40 items-center justify-center"
                            >
                              <Icon name="dots-grid" size={16} color="white" />
                            </TouchableOpacity>
                            {/* Delete Icon */}
                            <TouchableOpacity 
                              onPress={() => handleLocalDelete('before', idx)}
                              className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/40 items-center justify-center"
                            >
                              <Icon name="delete" size={16} color="white" />
                            </TouchableOpacity>
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
                    )}
                  </View>

                  {/* After Section */}
                  <View className="flex-1">
                    <View className="flex-row justify-between items-center mb-6">
                      <Text className="text-[14px] font-black text-slate-800">After</Text>
                      <TouchableOpacity 
                        onPress={() => onCameraPress?.(job, 'after')}
                        style={{ backgroundColor: '#212B36', width: 36, height: 32, borderRadius: 8 }}
                        className="items-center justify-center"
                      >
                        <Icon name="plus" size={20} color="white" />
                      </TouchableOpacity>
                    </View>
                    {afterUris.length > 0 ? (
                      <View className="gap-4">
                        {afterUris.map((uri, idx) => (
                          <View key={`after-${idx}`} className="rounded-2xl overflow-hidden bg-slate-100 aspect-[3/4] shadow-sm relative">
                            <Image 
                              source={{ uri }} 
                              className="w-full h-full"
                              resizeMode="cover"
                            />
                            {/* Dots Grid Icon */}
                            <TouchableOpacity 
                              onPress={() => openViewer(uri)}
                              className="absolute top-2 left-2 w-7 h-7 rounded-full bg-black/40 items-center justify-center"
                            >
                              <Icon name="dots-grid" size={16} color="white" />
                            </TouchableOpacity>
                            {/* Delete Icon */}
                            <TouchableOpacity 
                              onPress={() => handleLocalDelete('after', idx)}
                              className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-black/40 items-center justify-center"
                            >
                              <Icon name="delete" size={16} color="white" />
                            </TouchableOpacity>
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
                    )}
                  </View>
                </View>
              </ScrollView>
            )}

            {/* Footer */}
            <View className="p-6 flex-row items-center justify-between border-t border-slate-100 bg-white">
              <TouchableOpacity 
                onPress={() => {
                  if (beforeUris.length > 0 && afterUris.length > 0) {
                    setShowPresent(true);
                  } else {
                    Alert.alert('Presentation Mode', 'Please ensure you have at least one "Before" and one "After" image to start the presentation.');
                  }
                }}
                className="flex-row items-center"
              >
                <Icon 
                  name="presentation" 
                  size={20} 
                  color={beforeUris.length > 0 && afterUris.length > 0 ? "#65C216" : "#cbd5e1"} 
                />
                <Text 
                  className="ml-2 text-[14px] font-black"
                  style={{ color: beforeUris.length > 0 && afterUris.length > 0 ? "#65C216" : "#cbd5e1" }}
                >
                  Present View
                </Text>
              </TouchableOpacity>

              <View className="flex-row gap-2">
                <TouchableOpacity 
                  onPress={onClose}
                  className="px-6 py-2.5 rounded-xl border border-slate-200"
                >
                  <Text className="text-[14px] font-black text-slate-700">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  disabled={saving || pendingDeletions.length === 0}
                  onPress={handleSaveChanges}
                  style={{ backgroundColor: (saving || pendingDeletions.length === 0) ? '#E2E8F0' : '#65C216' }}
                  className="px-4 py-2.5 rounded-xl"
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text className="text-[14px] font-black text-white">Save Changes</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <BeforeAfterPresentModal
        visible={showPresent}
        onClose={() => setShowPresent(false)}
        beforeImages={beforeUris}
        afterImages={afterUris}
      />

      {/* Full Screen Image Viewer */}
      <Modal visible={viewerVisible} transparent animationType="slide">
        <View className="flex-1 bg-black justify-center items-center">
          <TouchableOpacity 
            className="absolute top-12 right-6 z-10 p-2 bg-white/20 rounded-full"
            onPress={() => setViewerVisible(false)}
          >
            <Icon name="close" size={30} color="white" />
          </TouchableOpacity>
          {viewerUri && (
            <Image 
              source={{ uri: viewerUri }} 
              className="w-full h-full"
              resizeMode="contain"
            />
          )}
        </View>
      </Modal>
    </View>
  );
};
