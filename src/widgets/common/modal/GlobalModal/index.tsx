import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';

interface GlobalModalProps {
  visible: boolean;
  title: string;
  message: string;
  type?: 'info' | 'error' | 'success' | 'warning';
  onClose: () => void;
  confirmText?: string;
  onConfirm?: () => void;
}

export const GlobalModal: React.FC<GlobalModalProps> = ({
  visible,
  title,
  message,
  type = 'info',
  onClose,
  confirmText = 'OK',
  onConfirm,
}) => {
  const { colors, isDark } = useTheme();

  const getHeaderColor = () => {
    switch (type) {
      case 'error': return colors.error.main;
      case 'success': return colors.success?.main || '#4CBB17';
      case 'warning': return colors.warning?.main || '#FF6B35';
      default: return colors.primary.main;
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center p-6 bg-black/50" onPress={onClose}>
        <View 
          className="w-full max-w-[340px] rounded-3xl overflow-hidden shadow-2xl" 
          style={{ backgroundColor: isDark ? colors.surface : '#fff' }}
        >
          <View className="p-5 border-b items-center" style={{ borderBottomColor: isDark ? colors.border : '#eee' }}>
            <Text className="text-lg font-black" style={{ color: getHeaderColor() }}>{title}</Text>
          </View>
          
          <View className="p-6 items-center">
            <Text className="text-sm text-center leading-5 opacity-70" style={{ color: colors.textSecondary }}>{message}</Text>
          </View>

          <View className="p-4 border-t flex-row justify-center" style={{ borderTopColor: isDark ? colors.border : '#eee' }}>
            <TouchableOpacity 
              onPress={onConfirm || onClose} 
              className="py-3 px-10 rounded-2xl"
              style={{ backgroundColor: getHeaderColor() }}
            >
              <Text className="text-white text-sm font-black">{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
};
