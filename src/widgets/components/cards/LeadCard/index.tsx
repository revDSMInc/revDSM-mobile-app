import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../../../../theme/ThemeProvider';
import type { Lead } from '../../../../config/types/lead';

interface Props {
  lead: Lead;
  colors: any;
  isDark: boolean;
  isTomorrow?: boolean;
  isArchived?: boolean;
  actionLoading?: boolean;
  onActionPress?: () => void;
  onPress: () => void;
}

const STATUS_COLORS = {
  ACTIVE: '#ff6b35', // Orange
  PROGRESS: '#6fcf97', // Green
  OFFSITE: '#9e9e9e', // Gray
  UPCOMING: '#2196f3', // Blue
};

export function LeadCard({
  lead,
  isTomorrow,
  isArchived,
  actionLoading,
  onActionPress,
  onPress,
}: Props) {
  const { colors, isDark } = useTheme();
  console.log('Lead data', lead);

  const getStatusColor = () => {
    if (isArchived) return STATUS_COLORS.OFFSITE;
    if (isTomorrow) return STATUS_COLORS.UPCOMING;

    const workflow = lead.workflowState;
    if (workflow === 'preview') return STATUS_COLORS.UPCOMING;
    if (workflow === 'resume') return STATUS_COLORS.PROGRESS;
    return STATUS_COLORS.ACTIVE;
  };

  const statusColor = getStatusColor();
  const workflow = lead.workflowState;

  const getButtonText = () => {
    if (isTomorrow) return 'Preview Appointment';
    if (isArchived) return 'Review Appointment';
    if (workflow === 'preview') return 'Start Appointment';
    if (workflow === 'resume') return 'Resume Appointment';
    return 'Start Appointment';
  };

  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return '—';

    const date = new Date(dateString);

    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();

    return `${month}/${day}/${year}`;
  };

  return (
    <View
      className="mb-4 rounded-xl border-l-[6px] shadow-sm overflow-hidden"
      style={{
        backgroundColor: statusColor + '15',
        borderColor: statusColor,
        borderWidth: 1,
        borderLeftWidth: 6,
      }}
    >
      <View className="p-4">
        <View className="flex-row items-center pb-2">
          <Text className="text-xs mr-1.5">🕒</Text>
          <Text className="text-[12px] font-bold opacity-60" style={{ color: colors.text }}>
            {lead.leadTime || 'N/A'}
          </Text>
        </View>
        {/* Top Section: Lead ID & Info Button */}
        <View className="flex-row items-center pb-2">
          <Text
            className="text-[11px] font-black uppercase tracking-widest opacity-40"
            style={{ color: colors.text }}
          >
            Lead ID:
          </Text>
          <Text
            className="text-[11px] font-black uppercase tracking-widest ml-1"
            style={{ color: colors.text }}
          >
            {lead.leadId || 'N/A'}
          </Text>
        </View>

        <View className="flex-row justify-between items-start mb-2">
          <Text className="text-lg font-black tracking-tight mb-2" style={{ color: colors.text }}>
            {lead.customerDetails?.firstName} {lead.customerDetails?.lastName}
          </Text>
          <Text
            className="text-[10px] font-black uppercase tracking-[2px]"
            style={{ color: colors.text }}
          >
            {formatDate(lead?.leadDate)}
          </Text>
        </View>

        <View className="flex-row justify-between items-start mb-2">
          <View className="flex-row items-center mt-0.5">
            <Text
              className="text-[11px] font-black uppercase tracking-widest opacity-40"
              style={{ color: colors.text }}
            >
              Code:
            </Text>
            <Text
              className="text-[11px] font-black uppercase tracking-widest ml-1"
              style={{ color: colors.text }}
            >
              {lead.leadCode || 'REFERRAL'}
            </Text>
          </View>
          <TouchableOpacity
            onPress={onPress}
            activeOpacity={0.7}
            className="px-3 py-3 rounded-full flex-row items-center"
            style={{ backgroundColor: statusColor + '20' }}
          >
            <View className="w-5 h-5 rounded-full items-center justify-center bg-white/30">
              <Text className="text-[10px] items-center">📖</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Address */}
        <View className="flex-row items-start mb-3">
          <Text className="text-xs mr-2 mt-0.5">📍</Text>
          <Text
            className="flex-1 text-[13px] font-bold leading-5 opacity-70"
            style={{ color: colors.text }}
            numberOfLines={2}
          >
            {lead.fullAddress || lead.customerDetails?.address || 'Address not available'}
          </Text>
        </View>

        {/* Action Button */}
        <TouchableOpacity
          onPress={onActionPress}
          disabled={actionLoading}
          className="h-12 rounded-xl items-center justify-center shadow-lg"
          style={{
            backgroundColor: statusColor,
            elevation: 4,
          }}
        >
          {actionLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-[13px] font-black uppercase tracking-widest">
              {getButtonText()}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({});
