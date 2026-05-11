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
      <View style={{ flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.6)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <View
          style={{ 
            width: '100%', 
            backgroundColor: isDark ? colors.surface : '#FFFFFF',
            borderRadius: 40,
            overflow: 'hidden'
          }}
        >
          {/* Header */}
          <View style={{ padding: 32, paddingBottom: 16 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="file-document-edit" size={24} color="white" />
              </View>
              <TouchableOpacity
                onPress={onClose}
                style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#f8fafc', alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="close" size={20} color="#64748b" />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 24, fontWeight: '900', color: '#0f172a' }}>Agreement Method</Text>
            <Text style={{ fontSize: 10, fontWeight: 'bold', color: '#94a3b8', letterSpacing: 1, marginTop: 8, lineHeight: 16 }}>
              Choose how you want to provide the agreement document.
            </Text>
          </View>

          {/* Options */}
          <View style={{ padding: 24, gap: 16 }}>
            <TouchableOpacity
              onPress={onGenerate}
              style={{ padding: 24, borderRadius: 24, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#f1f5f9', flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#eff6ff', alignItems: 'center', justifyContent: 'center', marginRight: 16 }}>
                <Icon name="magic-staff" size={24} color="#3b82f6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '900', color: '#0f172a', fontSize: 12 }}>Generate Document</Text>
                <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#94a3b8', marginTop: 4 }}>
                  Create a digital PDF from job data
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color="#cbd5e1" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onScan}
              style={{ padding: 24, borderRadius: 24, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#f1f5f9', flexDirection: 'row', alignItems: 'center' }}
            >
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#f0fdf4', alignItems: 'center', justifyContent: 'center', marginRight: 16 }}>
                <Icon name="camera" size={24} color="#22c55e" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontWeight: '900', color: '#0f172a', fontSize: 12 }}>Scan Paper Document</Text>
                <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#94a3b8', marginTop: 4 }}>
                  Use camera to capture physical form
                </Text>
              </View>
              <Icon name="chevron-right" size={20} color="#cbd5e1" />
            </TouchableOpacity>
          </View>

          <View style={{ padding: 32, paddingTop: 8 }}>
            <TouchableOpacity
              onPress={onClose}
              style={{ height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#f1f5f9' }}
            >
              <Text style={{ fontWeight: '900', color: '#64748b', fontSize: 10, letterSpacing: 2, textTransform: 'uppercase' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};
