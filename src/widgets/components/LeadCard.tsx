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
  canCheckIn,
  isResumeAppointment,
  GEOFENCE_RADIUS_MILES,
} from '../../utils/location-util';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Constants (web parity: job-card.js CARD_COLOR)
// ─────────────────────────────────────────────────────────────────────────────

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

interface LeadState {
  status: 'ACTIVE' | 'PROGRESS' | 'OFFSITE' | 'UPCOMING' | 'RESULTED';
  color: string;
  action: string;
  label: string;
  disabled: boolean;
  shouldPulse: boolean;
}

const CARD_COLOR = {
  ACTIVE: '#ff6b35',   // Orange  — Start Appointment
  PROGRESS: '#6fcf97', // Green   — Resume Appointment
  OFFSITE: '#9e9e9e',  // Gray    — Review Appointment
  UPCOMING: '#2196f3', // Blue    — Preview Appointment
};

// Non-resulted API statuses — web parity: job-card.js NON_RESULTED_STATUSES
const NON_RESULTED_STATUSES = ['lfLead', 'selfGenerated', 'scheduled'];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const formatTime = (leadTime: string) => {
  if (!leadTime || leadTime === 'N/A') return 'N/A';
  const timeStr = leadTime.toLowerCase().trim();
  const isPM = timeStr.includes('pm');
  const timeMatch = timeStr.match(/(\d+)/);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
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
  } catch {
    return null;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// RESULTED status label map — web parity
// ─────────────────────────────────────────────────────────────────────────────

const RESULTED_LABELS: Record<string, string> = {
  resulted: 'Resulted',
  sale: 'Sale',
  demo: 'Demo',
  noDemo: 'No Demo',
  nodemo: 'No Demo',
  demonosale: 'Demo No Sale',
  demoNoSale: 'Demo No Sale',
  nothit: 'Not Hit',
  notHit: 'Not Hit',
  notHome: 'Not Home',
  nothome: 'Not Home',
  cancelled: 'Cancelled',
  rescheduled: 'Rescheduled',
  reset: 'Reset',
  pitchbook: 'Pitchbook',
};

const RESULTED_COLORS: Record<string, string> = {
  sale: '#00A76F',
  demoNoSale: '#FFAB00',
  noDemo: '#FF5630',
  notHome: '#919EAB',
  notHit: '#FF5630',
  cancelled: '#FF5630',
  rescheduled: '#00B8D9',
  demo: '#00B8D9',
  pitchbook: '#00B8D9',
  default: '#94a3b8',
};

// ─────────────────────────────────────────────────────────────────────────────
// State machine — exact port of web app job-card.js getJobStatus()
// Priority order follows the web's documented comments exactly.
// ─────────────────────────────────────────────────────────────────────────────

function getLeadState(
  lead: Lead,
  userLocation: { latitude: number; longitude: number } | null,
  isTomorrow: boolean,
  actionCounts: { lead_check_in: number; lead_resume: number; lead_review: number }
): LeadState {
  // ── Resulted (non-active) leads — dimmed card ────────────────────────────
  const isResulted = !NON_RESULTED_STATUSES.includes(lead.status || '');
  if (isResulted) {
    const label = RESULTED_LABELS[lead.status || ''] || lead.status || 'Resulted';
    return {
      status: 'RESULTED',
      color: '#94a3b8',
      action: `Resulted — ${label}`,
      label: 'RESULTED',
      disabled: false,
      shouldPulse: false,
    };
  }

  // ── Tomorrow view — ALL cards forced UPCOMING (web parity shortcut) ───────
  // Matches: isTomorrowIssuedView shortcut in job-card.js lines 553-564
  if (isTomorrow) {
    return {
      status: 'UPCOMING',
      color: CARD_COLOR.UPCOMING,
      action: 'Preview Appointment',
      label: 'UPCOMING',
      disabled: true,
      shouldPulse: false,
    };
  }

  // ── Geo check ────────────────────────────────────────────────────────────
  const isInRange =
    userLocation && lead.location?.coordinates
      ? calculateDistance(
          userLocation.latitude,
          userLocation.longitude,
          lead.location.coordinates[1], // lat is index 1 (GeoJSON: [lng, lat])
          lead.location.coordinates[0]  // lng is index 0
        ) <= GEOFENCE_RADIUS_MILES
      : false;

  const isSelfGen = isSelfGeneratedLead(lead);
  const canCheckInLead = canCheckIn(lead);
  const isResumeLead = isResumeAppointment(lead);

  // Helper: get review/resume counts for button text
  const getCount = (action: 'lead_check_in' | 'lead_resume' | 'lead_review') =>
    actionCounts[action] || 0;

  // ─────────────────────────────────────────────────────────────────────────
  // BRANCH A: Self-Generated Leads (location-only, no time windows)
  // Web parity: job-card.js lines 569-644
  // ─────────────────────────────────────────────────────────────────────────
  if (isSelfGen) {
    // State 1: ACTIVE — At location + Never checked in
    if (canCheckInLead && isInRange) {
      return {
        status: 'ACTIVE',
        color: CARD_COLOR.ACTIVE,
        action: 'Start Appointment',
        label: 'ACTIVE NOW',
        disabled: false,
        shouldPulse: true,
      };
    }

    // State 3: REVIEW (OFF-SITE) — NOT at location AND NOT checked in
    // Web parity: lines 583-598 — this must be checked BEFORE resume
    if (!isInRange && !canCheckInLead) {
      const reviewCount = getCount('lead_review');
      return {
        status: 'OFFSITE',
        color: CARD_COLOR.OFFSITE,
        action: reviewCount >= 1 ? `Review Appointment (${reviewCount})` : 'Review Appointment',
        label: 'OFF-SITE',
        disabled: false,
        shouldPulse: false,
      };
    }

    // State 2: PROGRESS — At location + Has checked in (workflowState "resume")
    if (isResumeLead && isInRange) {
      const resumeCount = getCount('lead_resume');
      return {
        status: 'PROGRESS',
        color: CARD_COLOR.PROGRESS,
        action: resumeCount >= 1 ? `Resume Appointment (${resumeCount})` : 'Resume Appointment',
        label: 'IN PROGRESS',
        disabled: false,
        shouldPulse: false,
      };
    }

    // State 4: UPCOMING fallback — NOT at location (any other case)
    // Web parity: lines 623-633
    if (!isInRange) {
      return {
        status: 'UPCOMING',
        color: CARD_COLOR.UPCOMING,
        action: 'Preview Appointment',
        label: 'UPCOMING',
        disabled: true,
        shouldPulse: false,
      };
    }

    // Fallback (at location, canCheckIn already returned above)
    return {
      status: 'UPCOMING',
      color: CARD_COLOR.UPCOMING,
      action: 'Preview Appointment',
      label: 'UPCOMING',
      disabled: true,
      shouldPulse: false,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BRANCH B: LF (Issued) Leads — time + location based
  // Web parity: job-card.js lines 647-756
  // ─────────────────────────────────────────────────────────────────────────

  const scheduledDateTime = getScheduledDateTime(lead);
  const now = new Date();
  const nowTime = now.getTime();

  // Time window boundaries
  const fifteenMinBefore = scheduledDateTime
    ? scheduledDateTime.getTime() - 15 * 60 * 1000
    : null;
  const oneHourAfter = scheduledDateTime
    ? scheduledDateTime.getTime() + 60 * 60 * 1000
    : null;

  const isBeforeTimeWindow = fifteenMinBefore !== null ? nowTime < fifteenMinBefore : false;
  const isWithinTimeWindow =
    fifteenMinBefore !== null && oneHourAfter !== null
      ? nowTime >= fifteenMinBefore && nowTime <= oneHourAfter
      : false;
  const timeHasPassed =
    fifteenMinBefore !== null ? !isBeforeTimeWindow && !isWithinTimeWindow : false;

  // ── Priority 1: UPCOMING — Too early (before 15-min window) ─────────────
  // Web parity: lines 653-665
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

  // ── Priority 2: REVIEW — Time expired AND already checked in ─────────────
  // Web parity: lines 667-683
  // Location doesn't matter once time has fully passed and rep already worked it
  if (timeHasPassed && isResumeLead) {
    const reviewCount = getCount('lead_review');
    return {
      status: 'OFFSITE',
      color: CARD_COLOR.OFFSITE,
      action: reviewCount >= 1 ? `Review Appointment (${reviewCount})` : 'Review Appointment',
      label: isInRange ? 'ON-SITE' : 'OFF-SITE',
      disabled: false,
      shouldPulse: false,
    };
  }

  // ── Priority 3: REVIEW — Off-site (during or after window, not checked in) ─
  // Web parity: lines 685-700
  if (!isInRange) {
    const reviewCount = getCount('lead_review');
    return {
      status: 'OFFSITE',
      color: CARD_COLOR.OFFSITE,
      action: reviewCount >= 1 ? `Review Appointment (${reviewCount})` : 'Review Appointment',
      label: 'OFF-SITE',
      disabled: false,
      shouldPulse: false,
    };
  }

  // ── Priority 4: PROGRESS — On-site + Resume + Within time window ─────────
  // Web parity: lines 702-720
  if (isResumeLead && isInRange && isWithinTimeWindow) {
    const resumeCount = getCount('lead_resume');
    return {
      status: 'PROGRESS',
      color: CARD_COLOR.PROGRESS,
      action: resumeCount >= 1 ? `Resume Appointment (${resumeCount})` : 'Resume Appointment',
      label: 'IN PROGRESS',
      disabled: false,
      shouldPulse: false,
    };
  }

  // ── Priority 5: ACTIVE — On-site + Within window + (Never checked in OR preview state) ──
  // Web parity: lines 722-733
  // workflowState "preview" = checked in once but NOT yet set to "resume" — still show Start
  if ((!canCheckInLead || lead.workflowState === 'preview') && isWithinTimeWindow && isInRange) {
    return {
      status: 'ACTIVE',
      color: CARD_COLOR.ACTIVE,
      action: 'Start Appointment',
      label: 'ON-SITE',
      disabled: false,
      shouldPulse: true,
    };
  }

  // ── Priority 6: ACTIVE — On-site, time expired, but rep showed up ────────
  // Web parity: lines 735-746 — allow check-in even if time window closed
  if (!canCheckInLead && isInRange && !isWithinTimeWindow && !isBeforeTimeWindow) {
    return {
      status: 'ACTIVE',
      color: CARD_COLOR.ACTIVE,
      action: 'Start Appointment',
      label: 'ON-SITE',
      disabled: false,
      shouldPulse: true,
    };
  }

  // ── Fallback: Expired + Off-site ─────────────────────────────────────────
  // Web parity: lines 748-756
  const reviewCount = getCount('lead_review');
  return {
    status: 'OFFSITE',
    color: CARD_COLOR.OFFSITE,
    action: reviewCount >= 1 ? `Review Appointment (${reviewCount})` : 'Review Appointment',
    label: 'OFF-SITE',
    disabled: false,
    shouldPulse: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function LeadCard({
  lead,
  isTomorrow = false,
  isArchived = false,
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

  // ── Action counts — prioritise server-sent actionCounts, fallback to logs
  const actionCounts = useMemo(() => {
    if (lead.actionCounts) return lead.actionCounts as any;
    const logs = Array.isArray(lead.actionlogs) ? lead.actionlogs : [];
    return {
      lead_check_in: logs.filter((l: any) => l.module_type === 'lead_check_in').length,
      lead_resume: logs.filter((l: any) => l.module_type === 'lead_resume').length,
      lead_review: logs.filter((l: any) => l.module_type === 'lead_review').length,
    };
  }, [lead.actionCounts, lead.actionlogs]);

  // ── Compute display state via the web-parity state machine ──────────────
  const leadState = useMemo(
    () => getLeadState(lead, userLocation ?? null, isTomorrow, actionCounts),
    [lead, userLocation, isTomorrow, actionCounts]
  );

  // ── Pulse animation (only for ACTIVE state) ──────────────────────────────
  useEffect(() => {
    if (leadState.shouldPulse) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.03, duration: 1000, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
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
            if (lead._id) resetMutation.mutate(lead._id);
          },
        },
      ]
    );
  };

  const lastCheckInTime = useMemo(
    () => getLastCheckInTime(lead.actionlogs || []),
    [lead.actionlogs]
  );

  const isResulted = leadState.status === 'RESULTED';

  // ── Card press handler — UPCOMING shows info snackbar, others navigate ───
  const handleCardPress = () => {
    if (leadState.status === 'UPCOMING') {
      const scheduledTime = getScheduledDateTime(lead);
      // N/A time (self-gen with no slot) → generic message matching web
      const msg = !scheduledTime
        ? 'This appointment opens when you arrive on-site.'
        : `This appointment opens at ${format(
            new Date(scheduledTime.getTime() - 15 * 60 * 1000),
            'hh:mm a'
          )} when you arrive on-site.`;
      Alert.alert('Appointment Preview', msg);
    } else {
      onPress();
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={handleCardPress}
      className="mb-4 rounded-2xl overflow-hidden border-2"
      style={{
        backgroundColor: isResulted
          ? isDark
            ? colors.surface
            : '#F4F6F8'
          : leadState.color + '10',
        borderColor: leadState.color,
        opacity: isResulted ? 0.85 : 1,
      }}
    >
      <View className="p-4">

        {/* ── Header: Time & Status Chip ───────────────────────────────── */}
        <View className="flex-row items-center justify-between mb-4">
          {/* Left: Appointment time */}
          <View className="flex-row items-center">
            <Ionicon
              name="time-outline"
              size={16}
              color={isResulted ? '#72BD00' : isDark ? colors.textSecondary : '#637381'}
            />
            <Text
              className="ml-1.5 text-sm font-bold"
              style={{ color: isResulted ? '#72BD00' : colors.primary.main }}
            >
              {formatTime(lead.leadTime || 'N/A')}
            </Text>
          </View>

          {/* Right: Chips + Actions */}
          <View className="flex-row gap-2 ml-1 items-center">
            {/* Result status label (Only for resulted leads) */}
            {isResulted && (
              <View
                className="px-3 py-1.5 rounded-lg"
                style={{ backgroundColor: '#94a3b8' }}
              >
                <Text className="text-[10px] font-black text-white tracking-widest uppercase">
                  RESULTED
                </Text>
              </View>
            )}

            {/* Archive button (not shown in archived view) */}
            {!isArchived && (
              <TouchableOpacity
                onPress={handleArchive}
                disabled={archiveMutation.isPending}
                className="w-9 h-9 rounded-full items-center justify-center bg-[#FFAB00]"
              >
                {archiveMutation.isPending ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  <MaterialIcon name="folder" size={16} color="white" />
                )}
              </TouchableOpacity>
            )}

            {/* Delete button */}
            <TouchableOpacity
              onPress={() => setShowDeleteModal(true)}
              className="w-9 h-9 rounded-full items-center justify-center bg-[#FF5630]"
            >
              <MaterialIcon name="delete" size={16} color="white" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Lead Info ────────────────────────────────────────────────── */}
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
              <Text className="ml-1.5 text-xs font-semibold" style={{ color: colors.textSecondary }}>
                {lead.leadDate ? format(new Date(lead.leadDate), 'MM/dd/yyyy') : 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Lead Code & Pitchbook ────────────────────────────────────── */}
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-xs font-semibold" style={{ color: colors.textSecondary }}>
            Lead Code:{' '}
            <Text style={{ color: colors.primary.main }}>{lead.leadCode || 'N/A'}</Text>
          </Text>
          <TouchableOpacity
            onPress={onPitchbookPress || onPress}
            disabled={leadState.disabled}
            className="w-9 h-9 rounded-full items-center justify-center bg-green-600"
            style={{ opacity: leadState.disabled ? 0.5 : 1 }}
          >
            <MaterialIcon name="book-open-blank-variant" size={18} color="white" />
          </TouchableOpacity>
        </View>

        {/* ── Address ──────────────────────────────────────────────────── */}
        <View className="flex-row items-start mb-5">
          <Ionicon
            name="location-sharp"
            size={18}
            color={isResulted ? '#72BD00' : leadState.status === 'ACTIVE' || leadState.status === 'PROGRESS' ? '#00A76F' : '#637381'}
            style={{ marginTop: 2 }}
          />
          <View className="flex-1 ml-1.5">
            <Text
              className="text-xs font-bold leading-5"
              style={{ color: isResulted ? '#72BD00' : colors.text }}
              numberOfLines={2}
            >
              {lead.fullAddress || 'Address Pending'}
            </Text>
            {userLocation && lead.location?.coordinates && (() => {
              const dist = calculateDistance(
                userLocation.latitude,
                userLocation.longitude,
                lead.location.coordinates[1],
                lead.location.coordinates[0]
              );
              if (dist < 0.1) return null;
              return (
                <Text className="text-[10px] font-bold mt-0.5" style={{ color: '#919EAB' }}>
                  {dist.toFixed(1)} miles away
                </Text>
              );
            })()}
          </View>
        </View>

        {/* ── Action Button ─────────────────────────────────────────────── */}
        <View>
          {isResulted ? (
            // Resulted: two-button bar (review + reset) — web parity ResultedActionBar
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
                  <Ionicon name="refresh" size={22} color="white" />
                )}
              </TouchableOpacity>
            </View>
          ) : (
            // Normal: single animated action button
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <TouchableOpacity
                onPress={onActionPress}
                disabled={actionLoading || leadState.disabled}
                className="h-12 rounded-xl items-center justify-center shadow-lg flex-row"
                style={{
                  backgroundColor: leadState.color,
                  opacity: leadState.disabled ? 0.6 : 1,
                }}
              >
                {actionLoading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Ionicon name="location-sharp" size={20} color="white" />
                    <Text className="text-white ml-2 text-sm font-bold">
                      {leadState.action}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Last check-in time (web parity) */}
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

      {/* ── Delete Confirmation Modal ─────────────────────────────────── */}
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
