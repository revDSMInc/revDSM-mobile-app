import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { INSTALLER_RESULT_REASONS } from '../../../constants/installer';
import type { InstallerResultType } from '../../../config/types/installer';

interface Props {
  visible: boolean;
  result: InstallerResultType | null;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

/**
 * Results a job the installer can't complete.
 *
 * A reason is mandatory — an unexplained non-completion is what the Install Manager
 * can't action, so confirm stays disabled until one is picked.
 */
export function ResultJobModal({ visible, result, submitting, onClose, onConfirm }: Props) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [reason, setReason] = useState<string | null>(null);

  // Reasons are per-result-type, so a stale pick must not survive a type change.
  useEffect(() => {
    setReason(null);
  }, [result, visible]);

  if (!result) return null;
  const reasons = INSTALLER_RESULT_REASONS[result] ?? [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <View
          className="w-full rounded-t-[32px] px-6 pt-5"
          style={{
            backgroundColor: isDark ? colors.surface : colors.background,
            paddingBottom: Math.max(insets.bottom, 24),
            maxHeight: '85%',
          }}
        >
          <View className="flex-row items-center justify-between mb-6">
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Result Job
            </Text>
            <TouchableOpacity onPress={onClose} className="p-1">
              <Icon name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
            Result
          </Text>
          <View
            className="w-full px-4 py-3.5 rounded-xl border mb-5"
            style={{
              borderColor: '#919EAB33',
              backgroundColor: isDark ? '#FFFFFF08' : '#F4F6F8',
            }}
          >
            <Text className="text-base font-bold" style={{ color: colors.text }}>
              {result}
            </Text>
          </View>

          <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
            Reason
          </Text>
          <ScrollView className="mb-4" style={{ maxHeight: 260 }}>
            <View
              className="rounded-xl overflow-hidden border"
              style={{ borderColor: colors.border }}
            >
              {reasons.map((r, i) => {
                const on = reason === r;
                return (
                  <TouchableOpacity
                    key={r}
                    onPress={() => setReason(r)}
                    className="px-4 py-3.5 flex-row items-center justify-between"
                    style={{
                      backgroundColor: on ? colors.primary.main + '10' : colors.background,
                      borderBottomWidth: i < reasons.length - 1 ? 1 : 0,
                      borderBottomColor: colors.border,
                    }}
                  >
                    <Text
                      className="text-base flex-1"
                      style={{ color: on ? colors.primary.main : colors.text }}
                    >
                      {r}
                    </Text>
                    {on && <Icon name="checkmark-circle" size={20} color={colors.primary.main} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <TouchableOpacity
            disabled={!reason || submitting}
            onPress={() => reason && onConfirm(reason)}
            className="h-12 rounded-xl items-center justify-center"
            style={{
              backgroundColor:
                reason && !submitting ? colors.primary.main : colors.textSecondary + '40',
            }}
          >
            {submitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                className="text-base font-bold"
                style={{ color: reason ? '#fff' : colors.textSecondary }}
              >
                Submit Result
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
