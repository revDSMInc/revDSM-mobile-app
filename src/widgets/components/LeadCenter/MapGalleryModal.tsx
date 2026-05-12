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
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../../theme/ThemeProvider';
import { LeadService } from '../../../services/api/leads';

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
  const [loading, setLoading] = useState(false);
  const [beforeUris, setBeforeUris] = useState<string[]>([]);
  const [afterUris, setAfterUris] = useState<string[]>([]);

  useEffect(() => {
    if (visible && job) {
      fetchSecureUrls();
    } else {
      setBeforeUris([]);
      setAfterUris([]);
    }
  }, [visible, job?._id]);

  const fetchSecureUrls = async () => {
    const beforeImages = job.images?.beforeImages || [];
    const afterImages = job.images?.afterImages || [];

    if (beforeImages.length === 0 && afterImages.length === 0) return;

    try {
      setLoading(true);
      
      const filePaths = [
        ...beforeImages.map((img: any) => ({
          bucketName: img.bucketName || 'np-revdsm-staging',
          filePath: img.filePath || img.s3url,
        })),
        ...afterImages.map((img: any) => ({
          bucketName: img.bucketName || 'np-revdsm-staging',
          filePath: img.filePath || img.s3url,
        })),
      ];

      const res = await LeadService.getSecureUrls(filePaths);
      const secureData = res.data?.data || res.data || [];

      // Map back to before/after
      const securedBefore = secureData.slice(0, beforeImages.length).map((s: any) => s.secureUrl);
      const securedAfter = secureData.slice(beforeImages.length).map((s: any) => s.secureUrl);

      setBeforeUris(securedBefore);
      setAfterUris(securedAfter);
    } catch (error) {
      console.error('Failed to fetch secure gallery URLs', error);
    } finally {
      setLoading(false);
    }
  };

  if (!job) return null;

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

          {loading ? (
            <View className="h-64 items-center justify-center">
              <ActivityIndicator size="large" color="#2EDE56" />
              <Text className="mt-4 text-slate-400 font-bold">Loading site images...</Text>
            </View>
          ) : (
            <ScrollView className="px-6 pb-6">
              <View className="flex-row gap-6">
                {/* Before Section */}
                <View className="flex-1">
                  <Text className="text-[15px] font-black text-slate-800 mb-4">Before</Text>
                  {beforeUris.length > 0 ? (
                    <View className="rounded-2xl overflow-hidden bg-slate-100 aspect-[3/4]">
                      <Image 
                        source={{ uri: beforeUris[0] }} 
                        className="w-full h-full"
                        resizeMode="cover"
                      />
                    </View>
                  ) : (
                    <View className="rounded-2xl bg-slate-50 border border-slate-100 aspect-[3/4] items-center justify-center p-4">
                      <Icon name="image-off-outline" size={32} color="#cbd5e1" />
                      <Text className="text-[10px] font-bold text-slate-400 text-center mt-2">
                        No before images
                      </Text>
                    </View>
                  )}
                </View>

                {/* After Section */}
                <View className="flex-1">
                  <Text className="text-[15px] font-black text-slate-800 mb-4">After</Text>
                  {afterUris.length > 0 ? (
                    <View className="rounded-2xl overflow-hidden bg-slate-100 aspect-[3/4]">
                      <Image 
                        source={{ uri: afterUris[0] }} 
                        className="w-full h-full"
                        resizeMode="cover"
                      />
                    </View>
                  ) : (
                    <View className="rounded-2xl bg-slate-50 border border-slate-100 aspect-[3/4] items-center justify-center p-4">
                      <Icon name="image-off-outline" size={32} color="#cbd5e1" />
                      <Text className="text-[10px] font-bold text-slate-400 text-center mt-2">
                        No after images
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
                <Text className="ml-2 text-[14px] font-bold text-slate-600">Present View</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};
