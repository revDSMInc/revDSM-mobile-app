import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Alert,
  StyleSheet,
  Modal,
  Pressable,
  Linking,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import type { Lead } from '../../config/types/lead';
import MaterialIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import Ionicon from 'react-native-vector-icons/Ionicons';
import Feather from 'react-native-vector-icons/Feather';
import { getRawPhoneNumber } from '../../utils/phone-util';
import {
  useArchiveLeadMutation,
  useDeleteLeadMutation,
  useResetLeadMutation,
} from '../../hooks/useLeadMutation';
import { GlobalModal } from '../common/modal/GlobalModal';
import { MapSelectionModal } from '../common/modal/MapSelectionModal';
import { format } from 'date-fns';
import { FlashMessage } from '../../config/message';
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
  OFFSITE: '#637381',  // Gray    — Review Appointment
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

export const LeadCard = React.memo(
  function LeadCard({
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
  const insets = useSafeAreaInsets();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showPhoneOptions, setShowPhoneOptions] = useState(false);
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

  const handlePreviewPress = () => {

    const scheduledTime = getScheduledDateTime(lead);
    const msg = !scheduledTime
      ? 'This appointment opens when you arrive on-site.'
      : `This appointment opens at ${format(
        new Date(scheduledTime.getTime() - 15 * 60 * 1000),
        'hh:mm a'
      )} when you arrive on-site.`;
    FlashMessage.success(msg);
  };

  // ── Contact customer (Call / Text / Copy) ───────────────────────────────
  // Gated purely by TIME, regardless of GPS: reps can only reach the customer
  // starting 15 minutes before the appointment start — so a running-late rep can
  // give a heads-up, but nobody can contact the customer hours ahead of the appt.
  const contactWindowStart = useMemo(() => {
    const t = getScheduledDateTime(lead);
    return t ? t.getTime() - 15 * 60 * 1000 : null;
  }, [lead]);
  const canContactNow = contactWindowStart != null && Date.now() >= contactWindowStart;

  const handlePhonePress = () => {
    if (contactWindowStart == null) {
      FlashMessage.info(
        'Not available yet',
        'You can contact the customer starting 15 minutes before the appointment.'
      );
      return;
    }
    if (Date.now() < contactWindowStart) {
      FlashMessage.info(
        'Not available yet',
        `You can contact the customer starting ${format(new Date(contactWindowStart), 'hh:mm a')} — 15 minutes before the appointment.`
      );
      return;
    }
    setShowPhoneOptions(true);
  };

  const handleCall = () => {
    const phone = lead?.customerDetails?.phone;
    if (phone) Linking.openURL(`tel:${getRawPhoneNumber(phone)}`);
    setShowPhoneOptions(false);
  };
  const handleTextMessage = () => {
    const phone = lead?.customerDetails?.phone;
    if (phone) Linking.openURL(`sms:${getRawPhoneNumber(phone)}`);
    setShowPhoneOptions(false);
  };
  const handleCopyPhone = () => {
    const phone = lead?.customerDetails?.phone;
    if (phone) {
      Clipboard.setString(phone);
      FlashMessage.success('Copied', 'Phone number copied to clipboard');
    }
    setShowPhoneOptions(false);
  };

  // ── Card press handler — UPCOMING shows info snackbar, others navigate ───
  const handleCardPress = () => {
    if (leadState.status === 'UPCOMING') {
      handlePreviewPress();
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
        {lead.lowesLead === true && (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 8,
              left: 0,
              right: 0,
              alignItems: 'center',
              zIndex: 1,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '900', color: '#084f93', letterSpacing: 0 }}>
              L
              <Text style={{ fontSize: 13, fontWeight: '900', color: '#084f93', letterSpacing: -0.8 }}>OWE&apos;s</Text>
            </Text>
          </View>
        )}

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
              className="ml-1.5 text-base font-bold"
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
                <Text className="text-base font-black text-white tracking-widest uppercase">
                  RESULTED
                </Text>
              </View>
            )}

            {/* Archive button — self-generated leads only, not issued LF leads */}
            {!isArchived && isSelfGeneratedLead(lead) && (
              <TouchableOpacity
                onPress={() => setShowArchiveModal(true)}
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

            {/* Delete button — self-generated leads only, not issued LF leads */}
            {isSelfGeneratedLead(lead) && (
              <TouchableOpacity
                onPress={() => setShowDeleteModal(true)}
                className="w-9 h-9 rounded-full items-center justify-center bg-[#FF5630]"
              >
                <MaterialIcon name="delete" size={16} color="white" />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Lead Info ────────────────────────────────────────────────── */}
        <View className="mb-4">
          <Text className="text-base text-slate-400 mb-1">Lead ID: {lead.leadId}</Text>
          <View className="flex-row justify-between items-center">
            <View className="flex-row items-center flex-1">
              <FontAwesome name="user" size={14} color="#637381" />
              <Text className="ml-2 text-base font-bold" style={{ color: colors.text }}>
                {lead.customerDetails?.firstName} {lead.customerDetails?.lastName}
              </Text>
            </View>
            <View className="flex-row items-center">
              <Ionicon name="calendar-clear" size={14} color="#637381" />
              <Text className="ml-1.5 text-base font-semibold" style={{ color: colors.textSecondary }}>
                {lead.leadDate ? format(new Date(lead.leadDate), 'MM/dd/yyyy') : 'N/A'}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Lead Code & Contact Customer ─────────────────────────────── */}
        <View className="flex-row justify-between items-center mb-4">
          <Text className="text-base font-semibold" style={{ color: colors.textSecondary }}>
            Lead Code:{' '}
            <Text style={{ color: colors.primary.main }}>{lead.leadCode || 'N/A'}</Text>
          </Text>
          {/* Phone button — reachable only 15 min before the appt (time-gated,
              regardless of GPS). Muted until the window opens; tapping early
              explains when it becomes available. */}
          <TouchableOpacity
            onPress={handlePhonePress}
            className="w-9 h-9 rounded-full items-center justify-center bg-green-600"
            style={{ opacity: canContactNow ? 1 : 0.5 }}
          >
            <Feather name="phone" size={17} color="white" />
          </TouchableOpacity>
        </View>

        {/* ── Address ──────────────────────────────────────────────────── */}
        <TouchableOpacity onPress={() => setShowMapModal(true)} className="flex-row items-start mb-5">
          <Ionicon
            name="location-sharp"
            size={18}
            color={isResulted ? '#72BD00' : leadState.status === 'ACTIVE' || leadState.status === 'PROGRESS' ? '#00A76F' : '#637381'}
            style={{ marginTop: 2 }}
          />
          <View className="flex-1 ml-1.5">
            <Text
              className="text-base font-bold leading-5"
              style={{ color: isResulted ? '#72BD00' : colors.text }}
              numberOfLines={2}
            >
              {lead.fullAddress || 'Address Pending'}
            </Text>
            {/* {userLocation && lead.location?.coordinates && (() => {
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
            })()} */}
          </View>
        </TouchableOpacity>

        {/* ── Action Button ─────────────────────────────────────────────── */}
        <View>
          {isResulted ? (
            // Resulted: two-button bar (review + reset) — web parity ResultedActionBar
            <View className="flex-row gap-2">
              <TouchableOpacity
                onPress={onActionPress}
                className="flex-[3] h-12 rounded-xl bg-[#94a3b8] items-center justify-center"
              >
                <Text className="text-white font-bold text-base tracking-tight">
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
                onPress={
                  leadState.status === 'UPCOMING'
                    ? handlePreviewPress
                    : onActionPress
                }
                disabled={actionLoading || (leadState.disabled && leadState.status !== 'UPCOMING')}
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
                    <Text className="text-white ml-2 text-base font-bold">
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
              className="text-center text-base italic mt-2"
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

      {/* ── Archive Confirmation Modal ─────────────────────────────────── */}
      <Modal
        visible={showArchiveModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowArchiveModal(false)}
      >
        <Pressable
          style={{
            flex: 1,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}
          onPress={() => setShowArchiveModal(false)}
        >
          <Pressable
            style={{
              width: '100%',
              maxWidth: 340,
              borderRadius: 24,
              padding: 24,
              backgroundColor: isDark ? '#1C1C1E' : '#fff',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 10 },
              shadowOpacity: 0.15,
              shadowRadius: 20,
              elevation: 8,
            }}
          >
            <Text
              style={{
                fontSize: 18,
                fontWeight: '900',
                marginBottom: 8,
                textAlign: 'left',
                color: isDark ? '#fff' : '#1e293b',
              }}
            >
              Archive this lead?
            </Text>
            <Text
              style={{
                fontSize: 14,
                fontWeight: '500',
                marginBottom: 24,
                textAlign: 'left',
                color: isDark ? '#94a3b8' : '#64748b',
              }}
            >
              Lead will move to Archived tab.
            </Text>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                alignItems: 'center',
              }}
            >
              <TouchableOpacity
                onPress={() => {
                  setShowArchiveModal(false);
                  handleArchive();
                }}
                style={{
                  backgroundColor: '#4cbb17',
                  paddingVertical: 10,
                  paddingHorizontal: 18,
                  borderRadius: 12,
                  marginRight: 10,
                }}
              >
                <Text
                  style={{
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 'bold',
                  }}
                >
                  Confirm
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowArchiveModal(false)}
                style={{
                  backgroundColor: isDark ? '#1C1C1E' : '#fff',
                  borderWidth: 1,
                  borderColor: isDark ? '#334155' : '#e2e8f0',
                  paddingVertical: 10,
                  paddingHorizontal: 18,
                  borderRadius: 12,
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: 'bold',
                    color: isDark ? '#fff' : '#334155',
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <MapSelectionModal
        visible={showMapModal}
        address={lead.fullAddress || ''}
        onClose={() => setShowMapModal(false)}
      />

      {/* Contact-customer action sheet (Call / Text / Copy) */}
      <Modal
        visible={showPhoneOptions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPhoneOptions(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
          onPress={() => setShowPhoneOptions(false)}
        >
          <Pressable
            style={{
              backgroundColor: colors.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              paddingBottom: insets.bottom + 16,
            }}
          >
            <View style={{ width: 40, height: 4, backgroundColor: colors.textSecondary, borderRadius: 2, alignSelf: 'center', marginBottom: 20, opacity: 0.3 }} />
            <TouchableOpacity onPress={handleCall} className="flex-row items-center py-4">
              <Feather name="phone-call" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>Call</Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.5 }} />
            <TouchableOpacity onPress={handleTextMessage} className="flex-row items-center py-4">
              <Feather name="message-square" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>Text Message</Text>
            </TouchableOpacity>
            <View style={{ height: 1, backgroundColor: colors.border, opacity: 0.5 }} />
            <TouchableOpacity onPress={handleCopyPhone} className="flex-row items-center py-4">
              <Feather name="copy" size={18} color={colors.text} />
              <Text className="ml-4 text-base font-semibold" style={{ color: colors.text }}>Copy Number</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </TouchableOpacity>
  );
},
  (prevProps, nextProps) => {
    if (prevProps.isTomorrow !== nextProps.isTomorrow) return false;
    if (prevProps.isArchived !== nextProps.isArchived) return false;
    if (prevProps.actionLoading !== nextProps.actionLoading) return false;
    if (prevProps.isDark !== nextProps.isDark) return false;

    const prevLoc = prevProps.userLocation;
    const nextLoc = nextProps.userLocation;
    if ((prevLoc === null || prevLoc === undefined) !== (nextLoc === null || nextLoc === undefined)) return false;
    if (prevLoc && nextLoc) {
      if (prevLoc.latitude !== nextLoc.latitude || prevLoc.longitude !== nextLoc.longitude) return false;
    }

    const prevLead = prevProps.lead;
    const nextLead = nextProps.lead;
    if (prevLead._id !== nextLead._id) return false;
    if (prevLead.status !== nextLead.status) return false;
    if (prevLead.workflowState !== nextLead.workflowState) return false;
    if (prevLead.leadTime !== nextLead.leadTime) return false;
    if (prevLead.leadDate !== nextLead.leadDate) return false;
    if (prevLead.leadCode !== nextLead.leadCode) return false;
    if (prevLead.fullAddress !== nextLead.fullAddress) return false;
    if (prevLead.lowesLead !== nextLead.lowesLead) return false;

    if (prevLead.customerDetails?.firstName !== nextLead.customerDetails?.firstName) return false;
    if (prevLead.customerDetails?.lastName !== nextLead.customerDetails?.lastName) return false;

    if (JSON.stringify(prevLead.actionCounts) !== JSON.stringify(nextLead.actionCounts)) return false;

    const prevLogs = prevLead.actionlogs || [];
    const nextLogs = nextLead.actionlogs || [];
    if (prevLogs.length !== nextLogs.length) return false;
    if (JSON.stringify(prevLogs) !== JSON.stringify(nextLogs)) return false;

    return true;
  }
);
