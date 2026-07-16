import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Ionicon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { format } from 'date-fns';
import { useTheme } from '../../../theme/ThemeProvider';
import type { InstallerJob } from '../../../config/types/installer';

interface Props {
  job: InstallerJob;
  /** Tomorrow's jobs are preview-only. */
  isTomorrow?: boolean;
  onPress: () => void;
}

/**
 * Job card for the installer schedule.
 *
 * Follows LeadCard's visual contract — `rounded-2xl border-2` with a `color + '10'`
 * tinted wash and a full-width `h-12 rounded-xl` action button.
 */
export function InstallerJobCard({ job, isTomorrow = false, onPress }: Props) {
  const { colors, isDark } = useTheme();

  const resulted = !!job.resulted;
  const accent = resulted
    ? '#94a3b8'
    : isTomorrow
    ? '#2196f3'
    : colors.primary.main;

  const actionLabel = resulted
    ? 'Review Appointment'
    : isTomorrow
    ? 'Preview Appointment'
    : 'Resume Appointment';

  const name = [job.customerDetails?.firstName, job.customerDetails?.lastName]
    .filter(Boolean)
    .join(' ');

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      className="mb-4 rounded-2xl overflow-hidden border-2"
      style={{
        backgroundColor: resulted ? (isDark ? colors.surface : '#F4F6F8') : accent + '10',
        borderColor: accent,
        opacity: resulted ? 0.85 : 1,
      }}
    >
      <View className="p-4">
        {/* Arrival window + resulted chip */}
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center flex-1">
            <Ionicon name="time-outline" size={16} color={accent} />
            <Text className="ml-1.5 text-base font-bold" style={{ color: accent }} numberOfLines={1}>
              {job.leadTime || 'N/A'}
            </Text>
          </View>
          {resulted && (
            <View className="px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#94a3b8' }}>
              <Text className="text-[11px] font-black text-white tracking-widest">RESULTED</Text>
            </View>
          )}
        </View>

        {/* Customer + date */}
        <View className="mb-4">
          <Text className="text-base mb-1" style={{ color: colors.textSecondary }}>
            Lead ID: {job.leadId || 'N/A'}
          </Text>
          <View className="flex-row justify-between items-center">
            <View className="flex-row items-center flex-1">
              <FontAwesome name="user" size={14} color="#637381" />
              <Text className="ml-2 text-base font-bold" style={{ color: colors.text }}>
                {name || 'Customer'}
              </Text>
            </View>
            <View className="flex-row items-center">
              <Ionicon name="calendar-clear" size={14} color="#637381" />
              <Text className="ml-1.5 text-base font-semibold" style={{ color: colors.textSecondary }}>
                {job.leadDate ? format(new Date(job.leadDate), 'MM/dd/yyyy') : 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        {/* Address */}
        <View className="flex-row items-start mb-5">
          <Ionicon name="location-sharp" size={18} color={accent} style={{ marginTop: 2 }} />
          <Text
            className="flex-1 ml-1.5 text-base font-bold leading-5"
            style={{ color: colors.text }}
            numberOfLines={2}
          >
            {job.fullAddress || 'Address Pending'}
          </Text>
        </View>

        {/* Action */}
        <TouchableOpacity
          onPress={onPress}
          className="h-12 rounded-xl items-center justify-center flex-row"
          style={{ backgroundColor: accent }}
        >
          <Ionicon name="location-sharp" size={20} color="white" />
          <Text className="text-white ml-2 text-base font-bold">{actionLabel}</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}
