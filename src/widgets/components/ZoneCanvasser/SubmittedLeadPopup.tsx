import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Dimensions,
  StyleSheet,
} from 'react-native';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  APPOINTMENT_COLORS,
  getStatusChipConfig,
} from '../../../utils/zone-canvasser-status';
import { distanceMiles } from '../../../utils/zone-canvasser-util';
import { OverlayModal } from './OverlayModal';
import { PopupField } from './PopupField';
import type { MapCoordinate } from '../../../types/zone-canvasser';

const MAX_MODAL_HEIGHT = Dimensions.get('window').height * 0.85;

type Props = {
  visible: boolean;
  leadData: any;
  userPosition: MapCoordinate | null;
  onClose: () => void;
  onEdit?: () => void;
  onStartAppointment?: () => void | Promise<void>;
};

function formatShortDate(value: string | Date | undefined | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
  });
}

function formatSubmittedAt(value: string | Date | undefined | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getLeadAddress(leadData: any, isCrmLead: boolean): string | null {
  if (isCrmLead) return leadData?.fullAddress || leadData?.address || null;
  return leadData?.address || leadData?.fullAddress || null;
}

function getPreferredTime(leadData: any): string | null {
  return leadData?.prefferedTime || leadData?.preferredTime || null;
}

function getFollowupDate(leadData: any): string | null {
  return formatShortDate(leadData?.followupDate || leadData?.followUpDate);
}

function getSubmittedDate(leadData: any): string | null {
  return formatSubmittedAt(leadData?.date || leadData?.createdAt || leadData?.updatedAt);
}

function InterestedNoTimeLeadBody({ leadData }: { leadData: any }) {
  const name = leadData?.name?.trim() || '—';
  const followUp = getFollowupDate(leadData);
  const preferredTime = getPreferredTime(leadData);
  const submitted = getSubmittedDate(leadData);
  const note = leadData?.note?.trim() ? leadData.note : 'No notes';
  const selectedItems = leadData?.selectedItems;

  return (
    <>
      <PopupField icon="account-outline" label="Name" value={name} />
      <PopupField icon="calendar-clock" label="Date" value={followUp || '—'} />
      <PopupField icon="clock-outline" label="Preferred Time" value={preferredTime || '—'} />
      {selectedItems?.length > 0 && (
        <PopupField
          icon="format-list-checks"
          label="Selected Items"
          value={selectedItems.join(', ')}
        />
      )}
      <PopupField icon="clock-check-outline" label="Submitted" value={submitted || '—'} />
      <PopupField icon="note-text-outline" label="Note" value={note} isLast />
    </>
  );
}

function GoBackLeadBody({
  leadData,
  onEdit,
}: {
  leadData: any;
  onEdit?: () => void;
}) {
  const followUp = getFollowupDate(leadData);
  const preferredTime = getPreferredTime(leadData);
  const submitted = getSubmittedDate(leadData);
  const note = leadData?.note?.trim() ? leadData.note : 'No notes';

  return (
    <>
      <PopupField icon="calendar-clock" label="Follow-up Date" value={followUp || '—'} />
      <PopupField icon="clock-outline" label="Preferred Time" value={preferredTime || '—'} />
      <PopupField icon="clock-check-outline" label="Submitted" value={submitted || '—'} />
      <PopupField icon="note-text-outline" label="Note" value={note} isLast={!onEdit} />
      {onEdit && (
        <TouchableOpacity
          onPress={onEdit}
          className="flex-row items-center self-end gap-1.5 px-5 py-2.5 rounded-lg bg-slate-800 mt-2"
        >
          <MaterialCommunityIcons name="pencil" size={16} color="#FFFFFF" />
          <Text className="text-white font-bold">Edit Result</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

function CrmLeadBody({ leadData, canCheckIn }: { leadData: any; canCheckIn: boolean }) {
  return (
    <>
      {canCheckIn && (
        <View className="bg-green-50 rounded-lg p-3 mb-4">
          <Text className="text-green-700 font-semibold text-center">
            🎉 Congrats you created a lead
          </Text>
        </View>
      )}
      {leadData.assignedRep && (
        <PopupField icon="account-outline" label="Assigned Rep" value={leadData.assignedRep} />
      )}
      {leadData.leadCode && (
        <PopupField icon="tag-outline" label="Lead Code" value={leadData.leadCode} />
      )}
      {leadData.city && (
        <PopupField icon="city-variant-outline" label="City" value={leadData.city} />
      )}
      {leadData.leadDate && (
        <PopupField
          icon="calendar"
          label="Lead Date"
          value={formatShortDate(leadData.leadDate) || '—'}
        />
      )}
      {leadData.createdAt && (
        <PopupField
          icon="clock-check-outline"
          label="Submitted"
          value={getSubmittedDate(leadData) || '—'}
          isLast
        />
      )}
    </>
  );
}

function AppointmentButton({
  apptStatus,
  apptLoading,
  onPress,
}: {
  apptStatus: { color: string; text: string; disabled: boolean };
  apptLoading: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={apptLoading}
      className="flex-row items-center justify-center gap-2 py-3.5 rounded-xl"
      style={{
        backgroundColor: apptStatus.disabled ? `${apptStatus.color}80` : apptStatus.color,
      }}
    >
      {apptLoading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <>
          <MaterialCommunityIcons name="map-marker-radius" size={20} color="#FFFFFF" />
          <Text className="text-white font-bold text-base">{apptStatus.text}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

function GenericLeadBody({ leadData }: { leadData: any }) {
  return (
    <>
      {leadData.name && (
        <PopupField icon="account-outline" label="Name" value={leadData.name} />
      )}
      {leadData.status === 'create_lead' && leadData.phoneNumber && (
        <PopupField icon="phone-outline" label="Phone" value={leadData.phoneNumber} />
      )}
      {leadData.followupDate && (
        <PopupField icon="calendar-clock" label="Date" value={getFollowupDate(leadData) || '—'} />
      )}
      {getPreferredTime(leadData) && (
        <PopupField
          icon="clock-outline"
          label="Preferred Time"
          value={getPreferredTime(leadData)!}
        />
      )}
      {getSubmittedDate(leadData) && (
        <PopupField
          icon="clock-check-outline"
          label="Submitted"
          value={getSubmittedDate(leadData)!}
        />
      )}
      <PopupField icon="note-text-outline" label="Note" value={leadData.note || 'No notes'} isLast />
    </>
  );
}

export function SubmittedLeadPopup({
  visible,
  leadData,
  userPosition,
  onClose,
  onEdit,
  onStartAppointment,
}: Props) {
  const [apptLoading, setApptLoading] = useState(false);
  const isCrmLead = leadData?.status === 'selfGenerated' || !!leadData?.fullAddress;
  const isGoBack = leadData?.status === 'go_back';
  const isInterestedNoTime = leadData?.status === 'interested_no_time';

  const isInRange = useMemo(() => {
    if (!userPosition) return false;
    const coords = leadData?.location?.coordinates;
    if (!coords || coords.length < 2) return false;
    return distanceMiles(userPosition.latitude, userPosition.longitude, coords[1], coords[0]) <= 1.0;
  }, [userPosition, leadData]);

  const workflowState = leadData?.workflowState || 'preview';
  const resumeCount = leadData?.actionCounts?.lead_resume || 0;
  const reviewCount = leadData?.actionCounts?.lead_review || 0;
  const canCheckIn = workflowState === 'preview';
  const isResume = workflowState === 'resume';

  const getApptStatus = () => {
    if (canCheckIn && isInRange) {
      return { color: APPOINTMENT_COLORS.ACTIVE, text: 'Start Appointment', disabled: false };
    }
    if (!isInRange && !canCheckIn) {
      const text = reviewCount >= 1 ? `Review Appointment (${reviewCount})` : 'Review Appointment';
      return { color: APPOINTMENT_COLORS.OFFSITE, text, disabled: false };
    }
    if (isResume && isInRange) {
      const text = resumeCount >= 1 ? `Resume Appointment (${resumeCount})` : 'Resume Appointment';
      return { color: APPOINTMENT_COLORS.PROGRESS, text, disabled: false };
    }
    return { color: APPOINTMENT_COLORS.UPCOMING, text: 'Preview Appointment', disabled: true };
  };

  const apptStatus = getApptStatus();
  const address = getLeadAddress(leadData, isCrmLead);
  const statusChip = getStatusChipConfig(leadData?.status);

  const handleAppointmentPress = async () => {
    if (apptStatus.disabled) {
      Alert.alert('Preview Appointment', 'This appointment opens when you arrive on-site');
      return;
    }
    setApptLoading(true);
    try {
      await onStartAppointment?.();
    } finally {
      setApptLoading(false);
    }
  };

  const renderBody = () => {
    if (isGoBack) return <GoBackLeadBody leadData={leadData} onEdit={onEdit} />;
    if (isInterestedNoTime) return <InterestedNoTimeLeadBody leadData={leadData} />;
    if (isCrmLead) return <CrmLeadBody leadData={leadData} canCheckIn={canCheckIn} />;
    return <GenericLeadBody leadData={leadData} />;
  };

  if (!leadData) return null;

  return (
    <OverlayModal visible={visible} onRequestClose={onClose}>
      <View style={[styles.card, { maxHeight: MAX_MODAL_HEIGHT }]}>
        <View className="px-5 pt-4 pb-4" style={{ backgroundColor: '#3faa13' }}>
          <TouchableOpacity onPress={onClose} className="absolute right-4 top-4 z-10">
            <MaterialCommunityIcons name="close" size={20} color="rgba(255,255,255,0.8)" />
          </TouchableOpacity>
          <View className="flex-row items-center gap-2 flex-wrap pr-8">
            <Text className="text-lg font-bold text-white">Lead Detail</Text>
            <View
              className="flex-row items-center gap-1 px-2 py-1 rounded-full border"
              style={{ backgroundColor: statusChip.bg, borderColor: `${statusChip.color}40` }}
            >
              <MaterialCommunityIcons name={statusChip.icon} size={14} color={statusChip.color} />
              <Text className="text-xs font-semibold" style={{ color: statusChip.color }}>
                {statusChip.label}
              </Text>
            </View>
          </View>
          {address ? (
            <View className="flex-row items-start gap-1.5 mt-2 pr-6">
              <MaterialCommunityIcons name="map-marker-outline" size={14} color="rgba(255,255,255,0.75)" />
              <Text className="flex-1 text-sm text-white/85" numberOfLines={3}>
                {address}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.body}>{renderBody()}</View>

        {isCrmLead && (
          <View style={styles.footer}>
            <AppointmentButton
              apptStatus={apptStatus}
              apptLoading={apptLoading}
              onPress={handleAppointmentPress}
            />
          </View>
        )}
      </View>
    </OverlayModal>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '92%',
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  body: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#FFFFFF',
  },
});
