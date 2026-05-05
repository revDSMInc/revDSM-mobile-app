import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Animated, Alert } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import type { Lead } from '../../config/types/lead';
import MaterialIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import Ionicon from 'react-native-vector-icons/Ionicons';
import { useArchiveLeadMutation, useDeleteLeadMutation } from '../../hooks/useLeadMutation';
import { GlobalModal } from '../common/modal/GlobalModal';

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

const STATES = {
  ACTIVE: { color: '#ff6b35', label: 'ACTIVE NOW', action: 'Start Appointment', shouldPulse: true },
  PROGRESS: { color: '#6fcf97', label: 'IN PROGRESS', action: 'Resume Appointment', shouldPulse: false },
  OFFSITE: { color: '#9e9e9e', label: 'OFF-SITE', action: 'Review Appointment', shouldPulse: false },
  UPCOMING: { color: '#2196f3', label: 'UPCOMING', action: 'Preview Appointment', shouldPulse: false },
  RESULTED: { color: '#9ca3af', label: 'RESULTED', action: 'View Result', shouldPulse: false },
};

const toReadableLabel = (str: string) => {
  if (!str) return '';
  // Handle camelCase
  const result = str.replace(/([A-Z])/g, ' $1');
  const final = result.charAt(0).toUpperCase() + result.slice(1);
  return final.trim();
};

const RESULT_LABELS: Record<string, string> = {
  noDemo: 'No Demo',
  notHit: 'Not Hit',
  reset: 'Reset',
  sold: 'Sold',
  sale: 'Sale',
  cancelled: 'Cancelled',
};

import {
  calculateDistance,
  isSelfGeneratedLead,
  getScheduledDateTime,
} from '../../utils/location-util';

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

  // Pulsing animation for ACTIVE state
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Determine state matching web-app logic
  const leadState = (() => {
    // 1. Resulted Leads ("RESULTED" chip)
    const NON_RESULTED = ['lfLead', 'selfGenerated', 'scheduled'];
    const isResulted = !NON_RESULTED.includes(lead.status || '');
    if (isResulted) {
      return {
        ...STATES.RESULTED,
        label: 'RESULTED',
        action: 'View Result', // Text below button
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
          ) <= 1.0 // 1 mile range
        : false;

    // Web Parity Logic: 15 min before to 1 hour after
    const scheduledTime = getScheduledDateTime(lead);
    const now = new Date();
    const nowTime = now.getTime();
    const fifteenMinutesBefore = scheduledTime ? scheduledTime.getTime() - (15 * 60 * 1000) : 0;
    const oneHourAfter = scheduledTime ? scheduledTime.getTime() + (60 * 60 * 1000) : 0;

    const isBeforeTimeWindow = scheduledTime ? nowTime < fifteenMinutesBefore : false;
    const isWithinTimeWindow = scheduledTime ? (nowTime >= fifteenMinutesBefore && nowTime <= oneHourAfter) : true;
    const timeHasPassed = scheduledTime ? nowTime > oneHourAfter : false;
    const isResume = lead.workflowState === 'resume';
    const isPreview = lead.workflowState === 'preview';

    // 1. Tomorrow / Upcoming (Priority 1)
    if (isTomorrow || isBeforeTimeWindow) return STATES.UPCOMING;

    // 2. Self-Generated Lead Logic
    if (isSelfGen) {
      // If we've started or previewed and we are in range
      if (isInRange && (isResume || isPreview)) return isResume ? STATES.PROGRESS : STATES.ACTIVE;
      // If never started and off-site
      if (!isInRange && !isResume && !isPreview) return STATES.OFFSITE;
      // Fallback for self-gen off-site (e.g. preview state or resume state but left site)
      if (!isInRange) return STATES.UPCOMING;
      // In range but never started
      return STATES.ACTIVE;
    }

    // 3. Regular Lead Logic
    // Review Appointment (Time passed + checked in)
    if (timeHasPassed && isResume) return STATES.OFFSITE;

    // Not in range
    if (!isInRange) {
        // Web Parity: If it was previewed but we are off-site, or it's a fallback
        if (isPreview) return STATES.UPCOMING;
        return STATES.OFFSITE;
    }

    // Resume (In range + within window + checked in)
    if (isResume && isInRange && isWithinTimeWindow) return STATES.PROGRESS;

    // Start (In range + within window + not checked in)
    if (!isResume && isInRange && (isWithinTimeWindow || timeHasPassed)) return STATES.ACTIVE;

    return STATES.OFFSITE;
  })();

  useEffect(() => {
    if (leadState.shouldPulse) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [leadState.shouldPulse]);

  const handleArchive = () => {
    if (!lead._id) return;
    const newStatus = !isArchived;
    archiveMutation.mutate(
      { leadId: lead._id, isArchive: newStatus },
      { onSuccess: () => onArchiveSuccess?.(lead._id!) }
    );
  };

  const handleDelete = () => {
    setShowDeleteModal(true);
  };

  const confirmDelete = () => {
    if (lead._id) {
      deleteMutation.mutate(lead._id, {
        onSuccess: () => {
          onDeleteSuccess?.(lead._id!);
          setShowDeleteModal(false);
        },
      });
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '—';
    const d = new Date(dateString);
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(
      2,
      '0'
    )}/${d.getFullYear()}`;
  };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => {
        if (leadState === STATES.UPCOMING) {
          const scheduledTime = getScheduledDateTime(lead);
          if (scheduledTime) {
            const timeStr = lead.leadTime || 'N/A';
            const beforeTime = new Date(scheduledTime.getTime() - 15 * 60 * 1000);
            const hour = beforeTime.getHours();
            const min = beforeTime.getMinutes();
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const displayHour = hour % 12 || 12;
            const displayMin = min.toString().padStart(2, '0');
            
            Alert.alert(
              'Appointment Preview',
              `This appointment opens at ${displayHour}:${displayMin} ${ampm} when you arrive on-site.`
            );
          } else {
            Alert.alert('Appointment Preview', 'This appointment opens when you arrive on-site.');
          }
        } else {
          onPress();
        }
      }}
      className="mb-3 rounded-xl overflow-hidden"
      style={{
        backgroundColor:
          leadState.color === STATES.RESULTED.color ? (isDark ? colors.surface : '#F4F6F8') : leadState.color + '15',
        borderColor: leadState.color,
        borderWidth: 2,
        opacity: leadState.color === STATES.RESULTED.color ? 0.85 : 1,
      }}
    >
      <View className="px-4 py-3">
        <View className="flex-row items-center justify-between mb-3">
          <View className="flex-row items-center">
            <MaterialIcon
              name="clock"
              size={14}
              color={isDark ? colors.textSecondary : '#637381'}
            />
            <Text className="ml-1 text-sm font-bold uppercase" style={{ color: colors.text }}>
              {(() => {
                const time = lead.leadTime || 'N/A';
                const match = time.match(/^(\d+)(am|pm)$/i);
                if (match) {
                  return `${match[1]}:00 ${match[2].toLowerCase()}`;
                }
                return time;
              })()}
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            {!isArchived && (
              <TouchableOpacity
                onPress={handleArchive}
                disabled={archiveMutation.isPending}
                className="h-8 w-8 rounded-full justify-center items-center"
                style={{ backgroundColor: '#FFAB00' }}
              >
                {archiveMutation.isPending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialIcon name="folder" size={16} color="#ffffff" />
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={handleDelete}
              disabled={deleteMutation.isPending}
              className="h-8 w-8 rounded-full justify-center items-center"
              style={{ backgroundColor: '#FF5630' }}
            >
              {deleteMutation.isPending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <MaterialIcon name="delete" size={16} color="#ffffff" />
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View className="mb-3">
          <Text className="text-sm" style={{ color: colors.textSecondary }}>
            Lead ID: {lead.leadId || 'N/A'}
          </Text>
        </View>

        <View className="flex-row justify-between mb-3">
          <View className="flex-row items-center">
            <FontAwesome name="user" size={14} color={isDark ? colors.textSecondary : '#637381'} />
            <Text className="ml-1 text-xs font-semibold" style={{ color: colors.textSecondary }}>
              {lead.customerDetails?.firstName} {lead.customerDetails?.lastName}
            </Text>
          </View>
          <View className="flex-row items-center">
            <Ionicon
              name="calendar-clear"
              size={14}
              color={isDark ? colors.textSecondary : '#637381'}
            />
            <Text
              className="ml-1 text-xs font-semibold uppercase"
              style={{ color: colors.textSecondary }}
            >
              {formatDate(lead?.leadDate)}
            </Text>
          </View>
        </View>

        <View className="flex-row justify-between items-center mb-3">
          <View className="flex-row items-center">
            <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
              Lead Code: <Text style={{ color: colors.text }}>{lead.leadCode || 'NO CODE'}</Text>
            </Text>
          </View>
          <TouchableOpacity
            onPress={onPitchbookPress || onPress}
            disabled={leadState === STATES.UPCOMING}
            activeOpacity={0.7}
            className="w-8 h-8 rounded-full items-center justify-center"
            style={{ 
              backgroundColor: colors.primary.main,
              opacity: leadState === STATES.UPCOMING ? 0.5 : 1
            }}
          >
            <MaterialIcon name="book-open-blank-variant" size={16} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View className="flex-row items-start mb-3">
          <Ionicon
            name="location-sharp"
            size={16}
            color={colors.textSecondary}
            style={{ marginRight: 4 }}
          />
          <Text
            className="flex-1 text-xs font-semibold"
            style={{ color: colors.text }}
            numberOfLines={2}
          >
            {lead.fullAddress || lead.customerDetails?.address || 'Address not available'}
          </Text>
        </View>

        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <TouchableOpacity
            onPress={onActionPress}
            disabled={actionLoading || leadState === STATES.UPCOMING}
            className="h-12 rounded-xl items-center justify-center shadow-lg"
            style={{
              backgroundColor: leadState.color,
              opacity: leadState === STATES.UPCOMING ? 0.5 : 1,
              elevation: 4,
            }}
          >
            {actionLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View className="flex-row items-center">
                <Ionicon name="location-sharp" size={20} color={'#ffffff'} />
                <Text className="text-white ml-2 text-sm font-bold">{leadState.action}</Text>
              </View>
            )}
          </TouchableOpacity>
        </Animated.View>
      </View>

      <GlobalModal
        visible={showDeleteModal}
        type="error"
        title="Delete Lead"
        message="Are you sure you want to permanently delete this lead? This action cannot be undone."
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteModal(false)}
        onClose={() => setShowDeleteModal(false)}
      />
    </TouchableOpacity>
  );
}
