import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from '@react-native-community/blur';
import { useAuth } from '../../../hooks/useAuth';
import { logEvent } from '../../../services/api/LoggerService';
import { useOutcomeLogging } from '../../../hooks/useOutcomeLogging';

interface ResultLeadModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: any) => void;
  initialResult?: string; // noDemo, reset, notHit
  loading?: boolean;
  lead?: any;
}

const REASONS_MAP: { [key: string]: string[] } = {
  noDemo: [
    "Can't Do Work",
    "Doesn't Own Home",
    'Never Set Appointment',
    'Not Able to Reach',
    'Not Interested',
  ],
  // Verbatim from web `job-capture-images-sections/result-lead-drawer.js` RESULT_REASONS.
  // `Not Home` was missing here and is FIRST on web — the most common reset reason, so
  // reps were picking `No Time` for a door nobody answered.
  reset: ['Not Home', 'No Time', 'Leaving'],
  notHit: ['Car Broke Down', 'Medical Emergency'],
};

const RESULT_LABELS: { [key: string]: string } = {
  noDemo: 'No Demo',
  reset: 'Reset',
  notHit: 'Not Hit',
};

export const ResultLeadModal = ({
  visible,
  onClose,
  onSubmit,
  initialResult = 'noDemo',
  loading,
  lead,
}: ResultLeadModalProps) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [reason, setReason] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  useOutcomeLogging({
    visible,
    outcomeForm: { reason },
    outcomeStatus: initialResult === 'noDemo' ? 'demo' : initialResult === 'notHit' ? 'demo' : 'sale',
    calculators: [],
    activeIdx: 0,
    lead,
    disabled: false,
  });

  useEffect(() => {
    if (visible) {
      setReason(lead?.leadData?.reason || null);
      setIsDropdownOpen(false);
    }
  }, [visible, initialResult, lead]);

  const reasons = REASONS_MAP[initialResult] || [];
  const resultLabel = RESULT_LABELS[initialResult] || initialResult;

  const handleConfirm = () => {
    if (!reason) return;
    const userId = user?._id || user?.id;
    if (userId && lead?._id) {
      logEvent('click', {
        user_id: userId,
        created_by: userId,
        module_type: 'lead_result_field_entry',
        meta: {
          leadId: lead._id,
          result: resultLabel,
          reason,
          action: 'click_build_job',
        },
      });
    }
    onSubmit({
      result: initialResult,
      reason: reason,
      timestamp: new Date().toISOString(),
    });
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        >
          <BlurView
            style={StyleSheet.absoluteFill}
            blurType={isDark ? 'dark' : 'light'}
            blurAmount={1}
            reducedTransparencyFallbackColor={isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.5)'}
          />
        </TouchableOpacity>

        <View
          className="w-full rounded-t-[32px] px-6 pt-5"
          style={{
            backgroundColor: isDark ? colors.surface : colors.background,
            zIndex: 1,
            paddingBottom: Math.max(insets.bottom, 24),
          }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between mb-8">
            <Text className="text-xl font-bold" style={{ color: colors.text }}>
              Result Lead
            </Text>
            <TouchableOpacity onPress={onClose} className="p-1">
              <Icon name="close" size={24} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Result Block */}
          <View className="mb-6">
            <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
              Result
            </Text>
            <View
              className="w-full px-4 py-4 rounded-xl border"
              style={{
                borderColor: '#919EAB33',
                backgroundColor: isDark ? '#FFFFFF08' : '#F4F6F8',
              }}
            >
              <Text className="text-base" style={{ color: isDark ? '#919EAB' : '#919EAB' }}>
                {resultLabel}
              </Text>
            </View>
          </View>

          {/* Reason Block */}
          <View className="mb-10">
            <Text className="text-sm font-semibold mb-2" style={{ color: colors.text }}>
              Reason
            </Text>
            <TouchableOpacity
              onPress={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full px-4 py-4 rounded-xl border flex-row items-center justify-between"
              style={{
                borderColor: isDropdownOpen ? '#1C252E' : '#212B36',
                backgroundColor: 'transparent',
              }}
            >
              <Text
                className="text-base"
                style={{ color: reason ? colors.text : colors.textSecondary }}
              >
                {reason || 'Select Reason'}
              </Text>
              <Icon
                name={isDropdownOpen ? 'chevron-up' : 'chevron-down'}
                size={24}
                color={'#637381'}
              />
            </TouchableOpacity>

            {isDropdownOpen && (
              <View
                className="mt-2 rounded-xl border overflow-hidden shadow-lg"
                style={{
                  borderColor: '#919EAB33',
                  backgroundColor: isDark ? colors.surface : colors.background,
                  maxHeight: 200,
                }}
              >
                <ScrollView bounces={false}>
                  {reasons.map((item) => (
                    <TouchableOpacity
                      key={item}
                      onPress={() => {
                        const oldReason = reason;
                        setReason(item);
                        setIsDropdownOpen(false);
                        const userId = user?._id || user?.id;
                        if (userId && lead?._id) {
                          logEvent('change', {
                            user_id: userId,
                            created_by: userId,
                            module_type: 'lead_result_field_entry',
                            meta: {
                              leadId: lead._id,
                              result: resultLabel,
                              newValue: item,
                              oldValue: oldReason || '',
                              action: 'change_lead_result_reason',
                            },
                          });
                        }
                      }}
                      className="px-4 py-4 border-b"
                      style={{ borderBottomColor: '#919EAB14' }}
                    >
                      <Text className="text-base" style={{ color: colors.text }}>
                        {item}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            disabled={!reason || loading}
            onPress={handleConfirm}
            className="w-full h-14 rounded-2xl items-center justify-center shadow-lg flex-row"
            style={{
              backgroundColor: !reason ? (isDark ? '#FFFFFF1F' : '#919EAB33') : colors.primary.main,
              shadowColor: colors.primary.main,
              shadowOpacity: !reason ? 0 : 0.3,
              shadowRadius: 10,
              elevation: !reason ? 0 : 4,
            }}
          >
            {loading && <ActivityIndicator size="small" color="#FFFFFF" style={{ marginRight: 10 }} />}
            <Text
              className="text-base font-bold"
              style={{ color: !reason ? colors.textSecondary : '#FFFFFF' }}
            >
              {loading ? 'Processing...' : 'Build Job'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

