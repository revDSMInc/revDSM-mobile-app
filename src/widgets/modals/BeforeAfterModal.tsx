import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../theme/ThemeProvider';
import { BeforeImageModal } from './BeforeImageModal';
import { AfterImageModal } from './AfterImageModal';

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
  const [beforeCount, setBeforeCount] = useState(0);
  const [afterCount, setAfterCount] = useState(0);

  useEffect(() => {
    if (visible) {
      setBeforeCount(0);
      setAfterCount(0);
      setShowBeforeModal(false);
      setShowAfterModal(false);
    }
  }, [visible]);


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

            {/* Content - Two columns with plus buttons */}
            <ScrollView className="flex-1 px-4 py-6">
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
                      {beforeCount > 0 && (
                        <Text className="text-[10px] font-bold text-green-600 mt-1">
                          {beforeCount} image{beforeCount > 1 ? 's' : ''} added
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
                      {afterCount > 0 && (
                        <Text className="text-[10px] font-bold text-green-600 mt-1">
                          {afterCount} image{afterCount > 1 ? 's' : ''} added
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
                onPress={onClose}
                className="flex-1 border border-slate-200 dark:border-zinc-700 py-3 rounded-lg items-center"
              >
                <Text className="text-[13px] font-black text-slate-700 dark:text-slate-300">
                  Done
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Before Image Upload Modal */}
      <BeforeImageModal
        visible={showBeforeModal}
        onClose={() => setShowBeforeModal(false)}
        job={selectedJob}
        existingUris={[]}
        onUploadSuccess={() => {
          setBeforeCount(c => c + 1);
          setShowBeforeModal(false);
          onUploadSuccess?.();
        }}
      />

      {/* After Image Upload Modal */}
      <AfterImageModal
        visible={showAfterModal}
        onClose={() => setShowAfterModal(false)}
        job={selectedJob}
        existingUris={[]}
        onUploadSuccess={() => {
          setAfterCount(c => c + 1);
          setShowAfterModal(false);
          onUploadSuccess?.();
        }}
      />
    </>
  );
};
