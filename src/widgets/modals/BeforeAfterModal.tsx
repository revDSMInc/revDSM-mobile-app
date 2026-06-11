import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { BeforeImageModal } from './BeforeImageModal';
import { AfterImageModal } from './AfterImageModal';
import { LeadService } from '../../services/api/leads';
import { FlashMessage } from '../../config/message';

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
  const { isDark } = useTheme();
  const [showBeforeModal, setShowBeforeModal] = useState(false);
  const [showAfterModal, setShowAfterModal] = useState(false);
  const [beforeImages, setBeforeImages] = useState<any[]>([]);
  const [afterImages, setAfterImages] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [job, setJob] = useState(selectedJob);

  useEffect(() => {
    if (visible) {
      setJob(selectedJob);
      setBeforeImages([]);
      setAfterImages([]);
      setShowBeforeModal(false);
      setShowAfterModal(false);
      setIsSaving(false);

      // Fetch fresh job data to ensure updated images are shown when reopened
      const fetchFreshJob = async () => {
        if (!selectedJob?.jobNumber) return;
        try {
          const res = await LeadService.findJobs({ jobNumber: selectedJob.jobNumber });
          const updated = res.data?.data?.[0];
          if (updated) {
            setJob(updated);
          }
        } catch (err) {
          console.warn('Failed to fetch fresh job on modal open:', err);
        }
      };
      fetchFreshJob();
    }
  }, [visible, selectedJob]);

  const handleSaveChanges = async () => {
    if (beforeImages.length === 0 && afterImages.length === 0) return;
    try {
      setIsSaving(true);

      // Upload Before Images if any
      if (beforeImages.length > 0) {
        const formData = new FormData();
        formData.append('jobNumber', job.jobNumber);
        formData.append('companyId', job.companyId);
        beforeImages.forEach((file) => {
          formData.append('files', { uri: file.uri, type: file.type, name: file.name } as any);
        });
        await LeadService.updateBeforeImages(formData);
      }

      // Upload After Images if any
      if (afterImages.length > 0) {
        const formData = new FormData();
        formData.append('jobNumber', job.jobNumber);
        formData.append('companyId', job.companyId);
        afterImages.forEach((file) => {
          formData.append('files', { uri: file.uri, type: file.type, name: file.name } as any);
        });
        await LeadService.updateAfterImages(formData);
      }

      FlashMessage.success('Images saved successfully');
      onUploadSuccess?.();
      onClose();
    } catch (error) {
      console.error(error);
      FlashMessage.error('Failed to save changes');
    } finally {
      setIsSaving(false);
    }
  };

  const existingBeforeUris = job?.images?.beforeImages?.map((img: any) => img.secureUrl || img.filePath) || [];
  const existingAfterUris = job?.images?.afterImages?.map((img: any) => img.secureUrl || img.filePath) || [];

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent>
        <View className="flex-1 justify-end bg-black/60">
          <View className="bg-white dark:bg-zinc-900 rounded-t-[40px] h-[50%]">
            {/* Header */}
            <View className="p-4 border-b border-slate-100 dark:border-zinc-800 flex-row justify-between items-center">
              <View>
                <Text className="text-[17px] font-black dark:text-white">Upload Photos</Text>
                <Text className="text-[11px] font-bold text-slate-400">
                  #{job?.jobNumber}
                </Text>
              </View>
              <TouchableOpacity
                onPress={onClose}
                className="p-1.5 bg-slate-100 dark:bg-zinc-800 rounded-full"
              >
                <Icon name="close" size={20} color={isDark ? 'white' : 'black'} />
              </TouchableOpacity>
            </View>

            {/* Content - Two columns with plus buttons */}
            <ScrollView className="flex-1 px-4 py-6">
              {(beforeImages.length > 0 || afterImages.length > 0) && (
                <View className="flex-row items-center bg-[#E6F9FC] dark:bg-cyan-950/20 border border-[#00AEC7] p-4 rounded-[16px] mb-6 gap-3">
                  <Icon name="information-outline" size={20} color="#00AEC7" />
                  <Text className="flex-1 text-[13px] font-medium text-[#004B6E] dark:text-cyan-200 leading-5">
                    New uploaded images cannot be reordered until saved. Save changes first to enable drag-and-drop.
                  </Text>
                </View>
              )}
              <View className="flex-row gap-6">
                {/* Before Section */}
                <View className="flex-1">
                  <View className="mb-4">
                    <Text className="text-[13px] font-black text-slate-800 dark:text-white mb-3">
                      Before
                    </Text>
                    <TouchableOpacity
                      onPress={() => setShowBeforeModal(true)}
                      className="bg-slate-100 dark:bg-zinc-800 border-2 border-dashed border-slate-200 dark:border-zinc-700 rounded-xl p-8 items-center justify-center aspect-square"
                    >
                      <Icon name="plus" size={36} color="#4CBB17" />
                      <Text className="text-[11px] font-bold text-slate-600 dark:text-slate-400 mt-2">
                        Add Before
                      </Text>
                      {beforeImages.length > 0 && (
                        <Text className="text-[10px] font-bold text-green-600 mt-1">
                          {beforeImages.length} image{beforeImages.length > 1 ? 's' : ''} added
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                {/* After Section */}
                <View className="flex-1">
                  <View className="mb-4">
                    <Text className="text-[13px] font-black text-slate-800 dark:text-white mb-3">
                      After
                    </Text>
                    <TouchableOpacity
                      onPress={() => setShowAfterModal(true)}
                      className="bg-slate-100 dark:bg-zinc-800 border-2 border-dashed border-slate-200 dark:border-zinc-700 rounded-xl p-8 items-center justify-center aspect-square"
                    >
                      <Icon name="plus" size={36} color="#4CBB17" />
                      <Text className="text-[11px] font-bold text-slate-600 dark:text-slate-400 mt-2">
                        Add After
                      </Text>
                      {afterImages.length > 0 && (
                        <Text className="text-[10px] font-bold text-green-600 mt-1">
                          {afterImages.length} image{afterImages.length > 1 ? 's' : ''} added
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </ScrollView>

            {/* Footer */}
            <View className="p-4 border-t border-slate-100 dark:border-zinc-800 flex-row gap-3">
              <TouchableOpacity
                disabled={isSaving}
                onPress={onClose}
                className="flex-1 border border-slate-200 dark:border-zinc-700 py-3 rounded-lg items-center"
              >
                <Text className="text-[13px] font-black text-slate-700 dark:text-slate-300">
                  Cancel
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={isSaving || (beforeImages.length === 0 && afterImages.length === 0)}
                onPress={handleSaveChanges}
                className={`flex-1 py-3 rounded-lg items-center justify-center ${
                  (beforeImages.length > 0 || afterImages.length > 0) && !isSaving
                    ? 'bg-green-600'
                    : 'bg-slate-300 dark:bg-zinc-800'
                }`}
              >
                {isSaving ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Text className={`text-[13px] font-black ${
                    (beforeImages.length > 0 || afterImages.length > 0)
                      ? 'text-white'
                      : 'text-slate-400 dark:text-slate-600'
                  }`}>
                    Save Changes
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Before Image Upload Modal */}
      <BeforeImageModal
        visible={showBeforeModal}
        onClose={() => setShowBeforeModal(false)}
        job={job}
        existingUris={existingBeforeUris}
        onSelectImages={(images) => {
          setBeforeImages(images);
        }}
      />

      {/* After Image Upload Modal */}
      <AfterImageModal
        visible={showAfterModal}
        onClose={() => setShowAfterModal(false)}
        job={job}
        existingUris={existingAfterUris}
        onSelectImages={(images) => {
          setAfterImages(images);
        }}
      />
    </>
  );
};
