import React from 'react';
import { View, Text, TouchableOpacity, Modal } from 'react-native';

interface DynamicResultLeadModalProps {
  visible?: boolean;
  title?: string;
  message?: string;
  leadId?: string;
  onClose?: () => void;
  onViewLead?: () => void;
  accentColor?: string;
}

export function DynamicResultLeadModal({
  visible = false,
  title = 'Job Created Successfully',
  message,
  leadId,
  onClose,
  onViewLead,
  accentColor = '#3b82f6',
}: DynamicResultLeadModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <View className="flex-1 bg-black/40 items-center justify-center p-6">
        <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
          <View className="items-center mb-4">
            <View className="w-16 h-16 rounded-full items-center justify-center mb-3" style={{ backgroundColor: `${accentColor}15` }}>
              <Text className="text-2xl">✓</Text>
            </View>
            <Text className="text-lg font-bold text-center text-gray-800">{title}</Text>
          </View>

          {message && (
            <Text className="text-sm text-gray-600 text-center mb-4">{message}</Text>
          )}

          {leadId && (
            <View className="bg-gray-50 rounded-lg p-3 mb-4">
              <Text className="text-xs text-gray-500">Lead ID</Text>
              <Text className="text-sm font-semibold text-gray-800">{leadId}</Text>
            </View>
          )}

          <View className="flex-row gap-3">
            <TouchableOpacity
              onPress={onClose}
              className="flex-1 py-3 rounded-xl bg-gray-100"
            >
              <Text className="text-gray-600 text-center font-semibold">Close</Text>
            </TouchableOpacity>
            {onViewLead && (
              <TouchableOpacity
                onPress={onViewLead}
                className="flex-1 py-3 rounded-xl"
                style={{ backgroundColor: accentColor }}
              >
                <Text className="text-white text-center font-semibold">View Lead</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
