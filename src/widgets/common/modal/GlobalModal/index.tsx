import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';

interface GlobalModalProps {
  visible: boolean;
  title: string;
  message: string;
  type?: 'info' | 'error' | 'success' | 'warning';
  onClose: () => void;
  confirmText?: string;
  onConfirm?: () => void;
  cancelText?: string;
  onCancel?: () => void;
  children?: React.ReactNode;
}

export const GlobalModal: React.FC<GlobalModalProps> = ({
  visible,
  title,
  message,
  type = 'info',
  onClose,
  confirmText = 'OK',
  onConfirm,
  cancelText = 'Cancel',
  onCancel,
  children,
}) => {
  const { colors, isDark } = useTheme();

  const getConfirmBgColor = () => {
    if (type === 'error') return '#FF5630';
    return '#2EDE56'; // premium green
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.container, { backgroundColor: isDark ? '#1C1C1E' : '#fff' }]}>
          <Text className="text-[18px] font-black text-[#1C252E] dark:text-white mb-2">
            {title}
          </Text>
          <Text className="text-slate-600 dark:text-zinc-400 text-sm mb-6 leading-5">
            {message}
          </Text>
          
          {children}

          <View className="flex-row justify-end gap-3">
            {onCancel && (
              <TouchableOpacity
                onPress={onCancel}
                className="px-4 py-2.5 rounded-xl justify-center items-center"
              >
                <Text className="font-bold text-[#1C252E] dark:text-zinc-200 text-sm">
                  {cancelText}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onConfirm || onClose}
              style={{ backgroundColor: getConfirmBgColor() }}
              className="px-5 py-2.5 rounded-xl justify-center items-center"
            >
              <Text className="text-white font-bold text-sm">
                {confirmText}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 16,
  },
  container: {
    width: '90%',
    maxWidth: 360,
    borderRadius: 32,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 10,
  },
});
