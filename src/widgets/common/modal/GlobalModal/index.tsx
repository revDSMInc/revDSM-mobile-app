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

  const getHeaderColor = () => {
    switch (type) {
      case 'error':
        return '#FF5630';
      case 'success':
        return '#22C55E';
      case 'warning':
        return '#FFAB00';
      default:
        return colors.primary.main;
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[styles.overlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]} onPress={onClose}>
        <View
          style={[
            styles.container,
            {
              backgroundColor: isDark ? '#1C1C1E' : '#fff',
            },
          ]}
        >
          <View
            className="p-5 border-b items-center"
            style={{ borderBottomColor: isDark ? colors.border : '#eee' }}
          >
            <Text
              className="text-lg font-black tracking-widest text-center"
              style={{ color: getHeaderColor() }}
            >
              {title}
            </Text>
          </View>

          <View className="px-6 py-8 items-center">
            <Text
              className="text-sm text-center leading-5 opacity-80"
              style={{
                color: isDark ? '#fff' : colors.textSecondary,
                marginBottom: children ? 20 : 0,
              }}
            >
              {message}
            </Text>
            {children}
          </View>

          <View style={[styles.footer, { borderTopColor: isDark ? colors.border : '#eee' }]}>
            {onCancel && (
              <TouchableOpacity
                onPress={onCancel}
                style={[
                  styles.btn,
                  { backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8', marginRight: 12 },
                ]}
              >
                <Text style={[styles.btnText, { color: isDark ? '#fff' : '#637381' }]}>
                  {cancelText}
                </Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onConfirm || onClose}
              style={[styles.btn, { backgroundColor: getHeaderColor(), flex: onCancel ? 1 : 0 }]}
            >
              <Text style={styles.btnText}>{confirmText}</Text>
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
    padding: 20,
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  btn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1.1,
  },
});
