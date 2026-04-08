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
  children,
}) => {
  const { colors, isDark } = useTheme();

  const getHeaderColor = () => {
    switch (type) {
      case 'error':
        return colors.error.main;
      case 'success':
        return colors.success?.main || '#4CBB17';
      case 'warning':
        return colors.warning?.main || '#FF6B35';
      default:
        return colors.primary.main;
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.5)' }]} onPress={onClose}>
        <View
          style={[
            styles.container,
            {
              backgroundColor: isDark ? colors.surface : '#fff',
            },
          ]}
        >
          <View
            className="p-5 border-b items-center"
            style={{ borderBottomColor: isDark ? colors.border : '#eee' }}
          >
            <Text
              className="text-lg font-black uppercase tracking-widest text-center"
              style={{ color: getHeaderColor() }}
            >
              {title}
            </Text>
          </View>

          <View className="px-6 py-8 items-center">
            <Text
              className="text-sm text-center leading-5 opacity-60"
              style={{ color: colors.textSecondary, marginBottom: children ? 20 : 0 }}
            >
              {message}
            </Text>
            {children}
          </View>

          <View style={[styles.footer, { borderTopColor: isDark ? colors.border : '#eee' }]}>
            <TouchableOpacity
              onPress={onConfirm || onClose}
              style={[styles.confirmBtn, { backgroundColor: getHeaderColor() }]}
            >
              <Text style={styles.confirmText}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  container: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 32,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 30,
    elevation: 10,
  },
  footer: {
    padding: 24,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  confirmBtn: {
    paddingVertical: 12,
    paddingHorizontal: 40,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
});
