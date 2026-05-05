import React from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface AgreementDialogModalProps {
  visible: boolean;
  onClose: () => void;
  onGenerate: () => void;
  onScan: () => void;
}

export const AgreementDialogModal = ({
  visible,
  onClose,
  onGenerate,
  onScan,
}: AgreementDialogModalProps) => {
  const { colors, isDark } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 bg-black/60 items-center justify-center px-6">
        <View
          className="w-full bg-white rounded-[40px] overflow-hidden"
          style={{ backgroundColor: isDark ? colors.surface : '#FFFFFF' }}
        >
          {/* Header */}
          <View className="p-8 pb-4">
            <View className="flex-row justify-between items-center mb-6">
              <View className="w-12 h-12 rounded-2xl bg-slate-900 items-center justify-center">
                <Icon name="file-document-edit" size={24} color="white" />
              </View>
              <TouchableOpacity
                onPress={onClose}
                className="w-10 h-10 rounded-full bg-slate-50 items-center justify-center"
              >
                <Icon name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text className="text-2xl font-black text-slate-900 uppercase">Agreement Method</Text>
            <Text className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-2 leading-4">
              Choose how you want to provide the agreement document.
            </Text>
          </View>

          {/* Options */}
          <View className="p-6 gap-4">
            <TouchableOpacity
              onPress={onGenerate}
              className="p-6 rounded-3xl bg-slate-50 border border-slate-100 flex-row items-center"
            >
              <View className="w-12 h-12 rounded-full bg-blue-50 items-center justify-center mr-4">
                <Icon name="magic-staff" size={24} color="#3b82f6" />
              </View>
              <View className="flex-1">
                <Text className="font-black text-slate-900 uppercase text-xs">
                  Generate Document
                </Text>
                <Text className="text-[9px] font-bold text-slate-400 uppercase mt-1">
                  Create a digital PDF from job data
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color="#cbd5e1" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onScan}
              className="p-6 rounded-3xl bg-slate-50 border border-slate-100 flex-row items-center"
            >
              <View className="w-12 h-12 rounded-full bg-green-50 items-center justify-center mr-4">
                <Icon name="camera" size={24} color="#22c55e" />
              </View>
              <View className="flex-1">
                <Text className="font-black text-slate-900 uppercase text-xs">
                  Scan Paper Document
                </Text>
                <Text className="text-[9px] font-bold text-slate-400 uppercase mt-1">
                  Use camera to capture physical form
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color="#cbd5e1" />
            </TouchableOpacity>
          </View>

          <View className="p-8 pt-2">
            <TouchableOpacity
              onPress={onClose}
              className="h-14 rounded-2xl items-center justify-center border border-slate-100"
            >
              <Text className="font-black text-slate-500 uppercase text-[10px] tracking-widest">
                Cancel
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};
