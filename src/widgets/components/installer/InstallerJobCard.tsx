import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import Ionicon from 'react-native-vector-icons/Ionicons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import { format } from 'date-fns';
import { useTheme } from '../../../theme/ThemeProvider';
import { resolveJobCardState } from '../../../utils/installer-card-state';
import type { InstallerJob } from '../../../config/types/installer';

interface Props {
  job: InstallerJob;
  /** Tomorrow's jobs are preview-only. */
  isTomorrow?: boolean;
  /** Starting the job — the card waits on the API before the detail screen opens. */
  loading?: boolean;
  /** Another card is starting; this one stays tappable-looking but inert. */
  disabled?: boolean;
  onPress: () => void;
}

/**
 * Job card for the installer schedule.
 *
 * Follows LeadCard's visual contract — `rounded-2xl border-2` with a `color + '10'`
 * tinted wash and a full-width `h-12 rounded-xl` action button. The accent colour and
 * the action label both come from the job's `workflowState`, via
 * `resolveJobCardState` — the mobile port of the web card's palette.
 */
export function InstallerJobCard({
  job,
  isTomorrow = false,
  loading = false,
  disabled = false,
  onPress,
}: Props) {
  const { colors, isDark } = useTheme();

  const resulted = !!job.resulted;
  const inert = loading || disabled;
  const state = resolveJobCardState(job, { isTomorrow, loading });
  const accent = state.color;
  const actionLabel = state.actionLabel;

  const name =
    job.customerName ||
    [job.customerDetails?.firstName, job.customerDetails?.lastName].filter(Boolean).join(' ');

  // The API sends "N/A" for leads without a human-facing number; fall back to the job number.
  const displayId = job.leadDisplayId || job.jobNumber || job.leadId;

  const date = job.leadDate ? new Date(job.leadDate) : null;
  const dateLabel = date && !isNaN(date.getTime()) ? format(date, 'MM/dd/yyyy') : 'N/A';

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      disabled={inert}
      className="mb-4 rounded-2xl overflow-hidden border-2"
      style={{
        // `+ '1A'` is web's `alpha(color, 0.1)`; resulted falls back to web's `grey.100`
        // (the app's own surface in dark mode, which `grey.100` would blind).
        backgroundColor: resulted ? (isDark ? colors.surface : '#F4F6F8') : accent + '1A',
        borderColor: accent,
        opacity: disabled && !loading ? 0.6 : resulted ? 0.85 : 1,
      }}
    >
      {/*
        Web draws this as `boxShadow: '-6px 0 0 0 color'` on the two live states.
        RN has no offset-only shadow, so it's a real 6 px edge — same result.
      */}
      {state.accentBar && (
        <View
          className="absolute left-0 top-0 bottom-0"
          style={{ width: 6, backgroundColor: accent }}
        />
      )}

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
            // Web's self-gen resulted chip — `#9ca3af`, white, bold.
            <View className="px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#9ca3af' }}>
              <Text className="text-[11px] font-black text-white tracking-widest">RESULTED</Text>
            </View>
          )}
        </View>

        {/* Customer + date */}
        <View className="mb-4">
          <Text className="text-base mb-1" style={{ color: colors.textSecondary }}>
            Lead ID: {displayId || 'N/A'}
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
                {dateLabel}
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
          disabled={inert}
          className="h-12 rounded-xl items-center justify-center flex-row"
          // Web's disabled treatment is `alpha(color, 0.5)` — `+ '80'` here. The button
          // still fires: tapping it explains why the job won't open (see `onPress`),
          // which a truly inert button can't do.
          style={{ backgroundColor: state.openable ? accent : accent + '80' }}
        >
          {loading ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            <Ionicon
              name={state.openable ? 'location-sharp' : 'lock-closed'}
              size={20}
              color="white"
            />
          )}
          <Text className="text-white ml-2 text-base font-bold">{actionLabel}</Text>
        </TouchableOpacity>

        {/*
          Stated on the card rather than only on tap. An installer scanning their
          schedule needs to see which jobs are dead before they drive to one.
        */}
        {!!state.blockedReason && (
          <Text
            className="text-xs font-semibold leading-4 mt-2 text-center"
            style={{ color: accent }}
          >
            {state.blockedReason}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}
