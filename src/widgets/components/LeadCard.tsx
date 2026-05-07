import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Alert,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import type { Lead } from '../../config/types/lead';
import MaterialIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import Ionicon from 'react-native-vector-icons/Ionicons';
import {
  useArchiveLeadMutation,
  useDeleteLeadMutation,
  useResetLeadMutation,
} from '../../hooks/useLeadMutation';
import { GlobalModal } from '../common/modal/GlobalModal';
import { format } from 'date-fns';
import {
  calculateDistance,
  isSelfGeneratedLead,
  getScheduledDateTime,
} from '../../utils/location-util';

interface Props {
  lead: Lead;
  colors?: any;
  isDark?: boolean;
  isTomorrow?: boolean;
  isArchived?: boolean;
  actionLoading?: boolean;
  onActionPress?: () => void;
  onPitchbookPress?: () => void;
  onArchiveSuccess?: (id: string) => void;
  onDeleteSuccess?: (id: string) => void;
  onPress: () => void;
  userLocation?: { latitude: number; longitude: number } | null;
}

const CARD_COLOR = {
  ACTIVE: '#ff6b35', // Orange - Start Appointment
  PROGRESS: '#6fcf97', // Green - Resume Application
  OFFSITE: '#9e9e9e', // Gray - Review Appointment
  UPCOMING: '#2196f3', // Blue - Preview Appointment
  RESULTED: '#9ca3af', // Grayish - Resulted
};

const formatTime = (leadTime: string) => {
  if (!leadTime || leadTime === 'N/A') return 'N/A';
  const timeStr = leadTime.toLowerCase().trim();
  const isPM = timeStr.includes('pm');
  const timeMatch = timeStr.match(/(\d+)/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
    return `${displayHours.toString().padStart(2, '0')}:00 ${period}`;
  }
  return leadTime;
};

const getLastCheckInTime = (actionlogs: any[]) => {
  if (!Array.isArray(actionlogs) || actionlogs.length === 0) return null;
  const relevantActions = actionlogs
    .filter(
      (log) =>
        log?.created_at && ['lead_check_in', 'lead_resume', 'lead_review'].includes(log.module_type)
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (relevantActions.length === 0) return null;
  try {
    return format(new Date(relevantActions[0].created_at), 'hh:mm a');
  } catch (e) {
    return null;
  }
};

export function LeadCard({
  lead,
  isTomorrow,
  isArchived,
  actionLoading,
  onActionPress,
  onPitchbookPress,
  onArchiveSuccess,
  onDeleteSuccess,
  onPress,
  userLocation,
}: Props) {
  const { colors, isDark } = useTheme();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const archiveMutation = useArchiveLeadMutation();
  const deleteMutation = useDeleteLeadMutation();
  const resetMutation = useResetLeadMutation();

  const pulseAnim = useRef(new Animated.Value(1)).current;

  const actionCounts = useMemo(() => {
    if (lead.actionCounts) return lead.actionCounts;
    const logs = Array.isArray(lead.actionlogs) ? lead.actionlogs : [];
    return {
      lead_check_in: logs.filter((l) => l.module_type === 'lead_check_in').length,
      lead_resume: logs.filter((l) => l.module_type === 'lead_resume').length,
      lead_review: logs.filter((l) => l.module_type === 'lead_review').length,
    };
  }, [lead.actionCounts, lead.actionlogs]);

  const leadState = useMemo(() => {
    const NON_RESULTED = ['lfLead', 'selfGenerated', 'scheduled'];
    const isResulted = !NON_RESULTED.includes(lead.status || '');

    if (isResulted) {
      const statusLabels: Record<string, string> = {
        demoNoSale: 'Demo No Sale',
        noDemo: 'No Demo',
        notHome: 'Not Home',
        notHit: 'Not Hit',
        sale: 'Sale',
        cancelled: 'Cancelled',
        rescheduled: 'Rescheduled',
        demo: 'Demo',
        pitchbook: 'Pitchbook',
        resulted: 'Resulted',
      };
      const label = statusLabels[lead.status || ''] || lead.status || 'Resulted';

      return {
        status: 'RESULTED',
        color: '#94a3b8',
        action: `Resulted - ${label}`,
        label: 'RESULTED',
        disabled: false,
        shouldPulse: false,
      };
    }

    const isSelfGen = isSelfGeneratedLead(lead);
    const isInRange =
      userLocation && lead.location?.coordinates
        ? calculateDistance(
            userLocation.latitude,
            userLocation.longitude,
            lead.location.coordinates[1],
            lead.location.coordinates[0]
          ) <= 0.15 // Web Parity: 0.15 miles (~250m) for "at the house"
        : false;

    const scheduledTime = getScheduledDateTime(lead);
    const now = new Date();
    const nowTime = now.getTime();
    const fifteenMinutesBefore = scheduledTime ? scheduledTime.getTime() - 15 * 60 * 1000 : 0;
    const oneHourAfter = scheduledTime ? scheduledTime.getTime() + 60 * 60 * 1000 : 0;

    const isBeforeTimeWindow = scheduledTime ? nowTime < fifteenMinutesBefore : false;
    const isWithinTimeWindow = scheduledTime
      ? nowTime >= fifteenMinutesBefore && nowTime <= oneHourAfter
      : true; // Default true for self-gen (no time)
    const timeHasPassed = scheduledTime ? nowTime > oneHourAfter : false;

    const isResume =
      lead.workflowState === 'resume' ||
      actionCounts.lead_check_in > 0 ||
      actionCounts.lead_resume > 0;

    // 1. Tomorrow (Priority 1) - Always Preview
    if (isTomorrow) {
      return {
        status: 'UPCOMING',
        color: CARD_COLOR.UPCOMING,
        action: 'Preview Appointment',
        label: 'TOMORROW',
        disabled: true,
        shouldPulse: false,
      };
    }

    // 2. Self-Generated Lead Logic (Web Parity)
    if (isSelfGen) {
      if (isInRange) {
        if (isResume) {
          const count = actionCounts.lead_resume;
          return {
            status: 'PROGRESS',
            color: CARD_COLOR.PROGRESS,
            action: count >= 1 ? `Resume Appointment (${count})` : 'Resume Appointment',
            label: 'IN PROGRESS',
            disabled: false,
            shouldPulse: false,
          };
        }
        return {
          status: 'ACTIVE',
          color: CARD_COLOR.ACTIVE,
          action: 'Start Appointment',
          label: 'ON-SITE',
          disabled: false,
          shouldPulse: true,
        };
      }
      // Off-site Self-Gen is always Preview (per user request)
      return {
        status: 'UPCOMING',
        color: CARD_COLOR.UPCOMING,
        action: 'Preview Appointment',
        label: 'OFF-SITE (PREVIEW)',
        disabled: false,
        shouldPulse: false,
      };
    }

    // 3. LeafFilter Lead Logic (Proper Dynamic Time + Location)
    if (isInRange && (isWithinTimeWindow || timeHasPassed)) {
      if (isResume) {
        const count = actionCounts.lead_resume;
        return {
          status: 'PROGRESS',
          color: CARD_COLOR.PROGRESS,
          action: count >= 1 ? `Resume Appointment (${count})` : 'Resume Appointment',
          label: 'IN PROGRESS',
          disabled: false,
          shouldPulse: false,
        };
      }
      return {
        status: 'ACTIVE',
        color: CARD_COLOR.ACTIVE,
        action: 'Start Appointment',
        label: 'ON-SITE',
        disabled: false,
        shouldPulse: true,
      };
    }

    // 4. Off-site or Early Logic (LF Lead)
    if (isBeforeTimeWindow) {
      return {
        status: 'UPCOMING',
        color: CARD_COLOR.UPCOMING,
        action: 'Preview Appointment',
        label: 'UPCOMING',
        disabled: true,
        shouldPulse: false,
      };
    }

    // 5. Default: Off-site Review
    const count = actionCounts.lead_review;
    return {
      status: 'OFFSITE',
      color: CARD_COLOR.OFFSITE,
      action: count >= 1 ? `Review Appointment (${count})` : 'Review Appointment',
      label: 'OFF-SITE',
      disabled: false,
      shouldPulse: false,
    };
  }, [lead, userLocation, isTomorrow, actionCounts]);

  useEffect(() => {
    if (leadState.shouldPulse) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.03, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [leadState.shouldPulse]);

  const handleArchive = () => {
    if (!lead._id) return;
    archiveMutation.mutate(
      { leadId: lead._id, isArchive: !isArchived },
      { onSuccess: () => onArchiveSuccess?.(lead._id!) }
    );
  };

  const handleReset = () => {
    Alert.alert(
      'Reset Lead',
      'Are you sure you want to reset this lead? This will clear current work state.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            if (lead._id) resetMutation.mutate(lead._id, { onSuccess: () => onPress() });
          },
        },
      ]
    );
  };

  const lastCheckInTime = useMemo(
    () => getLastCheckInTime(lead.actionlogs || []),
    [lead.actionlogs]
  );

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => {
        if (leadState.status === 'UPCOMING') {
          const scheduledTime = getScheduledDateTime(lead);
          const msg = scheduledTime
            ? `This appointment opens at ${format(
                new Date(scheduledTime.getTime() - 15 * 60 * 1000),
                'hh:mm a'
              )} when you arrive on-site.`
            : 'This appointment opens when you arrive on-site.';
          Alert.alert('Appointment Preview', msg);
        } else {
          onPress();
        }
      }}
      className="mb-4 rounded-2xl overflow-hidden border-2"
      style={{
        backgroundColor:
          leadState.status === 'RESULTED'
            ? isDark
              ? colors.surface
              : '#F4F6F8'
            : leadState.color + '10',
        borderColor: leadState.color,
      }}
    >
      <View className="p-4">
        {/* Header: Time & Status Chip */}
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-row items-center">
            <Ionicon
              name="time-outline"
              size={16}
              color={
                leadState.status === 'RESULTED'
                  ? '#72BD00'
                  : isDark
                  ? colors.textSecondary
                  : '#637381'
              }
            />
            <Text
              className="ml-1.5 text-sm font-bold"
              style={{ color: leadState.status === 'RESULTED' ? '#72BD00' : colors.primary.main }}
            >
              {formatTime(lead.leadTime || 'N/A')}
            </Text>
          </View>

          <View className="flex-row gap-2 ml-1">
            {leadState.status === 'RESULTED' && (
              <View>
                <View className="bg-[#94a3b8] px-3 py-1.5 rounded-lg">
                  <Text className="text-[11px] font-black text-white tracking-widest uppercase">
                    RESULTED
                  </Text>
                </View>
              </View>
            )}
            {!isArchived && (
              <TouchableOpacity
                onPress={handleArchive}
                className="w-10 h-10 rounded-full items-center justify-center bg-[#FFAB00]"
              >
                <MaterialIcon name="folder" size={18} color="white" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => setShowDeleteModal(true)}
              className="w-10 h-10 rounded-full items-center justify-center bg-[#FF5630]"
            >
              <MaterialIcon name="delete" size={18} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Lead Info */}
        <View className="mb-4">
          <Text className="text-xs text-slate-400 mb-1">Lead ID: {lead.leadId}</Text>
          <View className="flex-row justify-between items-center">
            <View className="flex-row items-center flex-1">
              <FontAwesome name="user" size={14} color="#637381" />
              <Text className="ml-2 text-sm font-bold" style={{ color: colors.text }}>
                {lead.customerDetails?.firstName} {lead.customerDetails?.lastName}
              </Text>
            </View>
            <View className="flex-row items-center">
              <Ionicon name="calendar-clear" size={14} color="#637381" />
              <Text
                className="ml-1.5 text-xs font-semibold"
                style={{ color: colors.textSecondary }}
              >
                {lead.leadDate ? format(new Date(lead.leadDate), 'MM/dd/yyyy') : 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
            Lead Code: <Text style={{ color: colors.primary.main }}>{lead.leadCode || 'N/A'}</Text>
          </Text>
          <TouchableOpacity
            onPress={onPitchbookPress || onPress}
            disabled={leadState.disabled}
            className="w-10 h-10 rounded-full items-center justify-center bg-green-600"
            style={{ opacity: leadState.disabled ? 0.5 : 1 }}
          >
            <MaterialIcon name="book-open-blank-variant" size={20} color="white" />
          </TouchableOpacity>
        </View>

        <View className="flex-row items-start mb-5">
          <Ionicon
            name="location-sharp"
            size={18}
            color={leadState.status === 'RESULTED' ? '#72BD00' : '#637381'}
            style={{ marginTop: 2 }}
          />
          <Text
            className="ml-1.5 flex-1 text-xs font-bold leading-5"
            style={{ color: leadState.status === 'RESULTED' ? '#72BD00' : colors.text }}
            numberOfLines={3}
          >
            {lead.fullAddress || 'Address Pending'}
          </Text>
        </View>

        {/* Action Button & Check-in Info */}
        <View>
          {leadState.status === 'RESULTED' ? (
            <View className="flex-row gap-2">
              <TouchableOpacity
                onPress={onActionPress}
                className="flex-[3] h-12 rounded-xl bg-[#94a3b8] items-center justify-center"
              >
                <Text className="text-white font-bold text-sm tracking-tight">
                  {leadState.action}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleReset}
                disabled={resetMutation.isPending}
                className="flex-1 h-12 rounded-xl bg-[#94a3b8] items-center justify-center"
              >
                {resetMutation.isPending ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <Ionicon name="refresh" size={24} color="white" />
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                onPress={onActionPress}
                disabled={actionLoading || leadState.disabled}
                className="h-12 rounded-xl items-center justify-center shadow-lg flex-row"
                style={{ backgroundColor: leadState.color, opacity: leadState.disabled ? 0.6 : 1 }}
              >
                {actionLoading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Ionicon name="location-sharp" size={20} color="white" />
                    <Text className="text-white ml-2 text-sm font-bold">{leadState.action}</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>
          )}

          {lastCheckInTime && (
            <Text
              className="text-center text-[11px] italic mt-2"
              style={{ color: colors.textSecondary }}
            >
              Last check-in: {lastCheckInTime}
            </Text>
          )}
        </View>
      </View>

      <GlobalModal
        visible={showDeleteModal}
        type="error"
        title="Delete Lead"
        message="Permanently delete this lead? This cannot be undone."
        confirmText="Delete"
        onConfirm={() => {
          if (lead._id)
            deleteMutation.mutate(lead._id, {
              onSuccess: () => {
                onDeleteSuccess?.(lead._id!);
                setShowDeleteModal(false);
              },
            });
        }}
        onCancel={() => setShowDeleteModal(false)}
        onClose={() => setShowDeleteModal(false)}
      />
    </TouchableOpacity>
  );
}
