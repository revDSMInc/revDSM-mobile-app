import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  Modal,
  ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

import { useTheme } from '../../../theme/ThemeProvider';
import ChatService from '../../../services/api/ChatService';
import {
  ACK_AMBER,
  ACK_GREEN,
  confirmationSenderFirstName,
  confirmationTimeOf,
} from './chat-confirmation';

interface Props {
  message: any;
  currentUserId: string;
  canManage?: boolean;
  onConfirm: (messageId: string) => void;
}

/** The banner tracks the bubble's width (MessageBubble caps a bubble at 75% of the screen). */
const BANNER_MAX_WIDTH = Math.round(Dimensions.get('window').width * 0.72);

/** Caption under the manager's tracker ("Waiting on all 5 reps"). */
const trackerCaptionOf = (confirmed: number, total: number | null): string => {
  if (total == null) return '';
  const waiting = total - confirmed;
  if (waiting <= 0) return 'Everyone has confirmed';
  if (confirmed === 0) return total === 1 ? 'Waiting on 1 rep' : `Waiting on all ${total} reps`;
  return `Waiting on ${waiting} rep${waiting === 1 ? '' : 's'}`;
};

// REVDSM-1313 "Require read confirmation": other people get a Mark as Read banner until they tap it,
// then a Confirmed banner; the sender and managers get a tracker card with live progress and a
// report of who confirmed (with when).
export const ChatMessageAck = React.memo(function ChatMessageAck({
  message,
  currentUserId,
  canManage = false,
  onConfirm,
}: Props) {
  const { colors, isDark } = useTheme();

  const messageId = String(message?._id || message?.id || '');
  const ackBy: any[] = Array.isArray(message?.ackBy) ? message.ackBy : [];
  const me = String(currentUserId);
  const senderId = String(message?.user?._id || message?.senderId || '');
  const isSender = senderId === me;
  const confirmedByMe = ackBy.some((a) => String(a?.userId) === me);
  const confirmedCount = ackBy.length;

  // Unsent, pending-approval and system rows have nothing to confirm.
  const nothingToConfirm = !messageId || messageId.startsWith('temp_') || message?.pendingApproval;

  const [report, setReport] = useState<{ confirmed?: any[]; pending?: any[] } | null>(null);
  const [reportError, setReportError] = useState(false);
  const [showReport, setShowReport] = useState(false);

  // Manager's tracker: the office audience ("N of M confirmed") only exists in the stored report
  // (everyone in the office except the sender), so one read-only fetch populates the card. The
  // live count still comes from the message's ackBy, which the socket keeps updating.
  const fetchReport = useCallback(() => {
    if (!canManage || nothingToConfirm) return Promise.resolve();
    return ChatService.getChannelAcks(messageId)
      .then((data) => {
        setReport({ confirmed: data.confirmed || [], pending: data.pending || [] });
        setReportError(false);
      })
      .catch(() => {
        setReportError(true);
      });
  }, [canManage, messageId, nothingToConfirm]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const openReport = useCallback(() => {
    setReportError(false);
    setReport(null);
    setShowReport(true);
    fetchReport();
  }, [fetchReport]);

  if (nothingToConfirm) return null;

  // Amber while the read is open; green once something settled.
  const schemeFor = (accentSettled: boolean) =>
    isDark
      ? (accentSettled ? ACK_GREEN : ACK_AMBER).dark
      : (accentSettled ? ACK_GREEN : ACK_AMBER).light;

  const bannerWrap = {
    alignSelf: (isSender ? 'flex-end' : 'flex-start') as 'flex-end' | 'flex-start',
    marginTop: 6,
    marginLeft: isSender ? 0 : 40,
    marginRight: isSender ? 0 : 4,
    maxWidth: BANNER_MAX_WIDTH + 8,
  };

  const bannerContent = (iconName: string, label: string, color: string, centered: boolean) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: centered ? 'center' : 'flex-start',
      }}
    >
      <Icon name={iconName} size={15} color={color} />
      <Text
        style={{
          fontSize: 13,
          fontWeight: '700',
          color,
          marginLeft: 6,
        }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );

  // ------------------------------------------------------------------
  // Report bottom sheet: every person's name, with the confirm time for
  // the ones who have already read it.
  // ------------------------------------------------------------------
  const reportRow = (person: any, confirmed: boolean) => (
    <View
      key={String(person?.userId || person?.fullName)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 9,
        borderBottomWidth: 1,
        borderBottomColor: isDark ? '#2A2A2A' : '#F4F6F8',
      }}
    >
      <Text style={{ fontSize: 14, color: colors.text, flex: 1 }} numberOfLines={1}>
        {person?.fullName || 'Unknown user'}
      </Text>
      <Text
        style={{
          fontSize: 12,
          fontWeight: '600',
          marginLeft: 10,
          color: confirmed ? (isDark ? ACK_GREEN.dark.accent : ACK_GREEN.light.accent) : colors.textSecondary,
        }}
      >
        {confirmed ? confirmationTimeOf(person) || 'Confirmed' : 'Pending'}
      </Text>
    </View>
  );

  const sectionTitle = (label: string) => (
    <Text
      style={{
        fontSize: 12,
        fontWeight: '800',
        color: colors.textSecondary,
        marginTop: 14,
        marginBottom: 2,
      }}
    >
      {label}
    </Text>
  );

  const reportSheet = (
    <Modal visible={showReport} transparent animationType="slide" onRequestClose={() => setShowReport(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setShowReport(false)} />
        <View
          style={{
            backgroundColor: isDark ? '#1C1C1E' : '#FFFFFF',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingTop: 10,
            paddingHorizontal: 20,
            maxHeight: '62%',
          }}
        >
          <View
            style={{
              width: 40,
              height: 5,
              borderRadius: 3,
              alignSelf: 'center',
              backgroundColor: isDark ? '#454F5B' : '#DFE3E8',
              marginBottom: 12,
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: 8,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Read confirmations</Text>
            <TouchableOpacity onPress={() => setShowReport(false)} accessibilityLabel="CloseReadConfirmations">
              <Icon name="close" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={{ marginBottom: 18 }}>
            {reportError && !report ? (
              <Text style={{ fontSize: 13, color: colors.textSecondary, paddingVertical: 10 }}>
                Could not load the confirmations. Pull up again later.
              </Text>
            ) : !report ? (
              <Text style={{ fontSize: 13, color: colors.textSecondary, paddingVertical: 10 }}>Loading…</Text>
            ) : (
              <>
                {sectionTitle(`Confirmed (${report.confirmed?.length || 0})`)}
                {report.confirmed?.length
                  ? report.confirmed.map((person: any) => reportRow(person, true))
                  : (
                    <Text style={{ fontSize: 13, color: colors.textSecondary, paddingVertical: 4 }}>
                      No one has confirmed yet.
                    </Text>
                  )}
                {sectionTitle(`Haven't confirmed (${report.pending?.length || 0})`)}
                {report.pending?.length
                  ? report.pending.map((person: any) => reportRow(person, false))
                  : (
                    <Text style={{ fontSize: 13, color: colors.textSecondary, paddingVertical: 4 }}>
                      Everyone has confirmed.
                    </Text>
                  )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );

  // Manager's tracker card ("0 of 5 confirmed" + progress + caption, QA mockup REP-side manager).
  if (canManage) {
    const total = report ? (report.confirmed?.length || 0) + (report.pending?.length || 0) : null;
    const pct = total ? Math.min(100, Math.round((confirmedCount / total) * 100)) : 0;
    const caption = trackerCaptionOf(confirmedCount, total);

    const tracker = (
      <View style={{ paddingVertical: 10, paddingHorizontal: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Icon name="checkmark-outline" size={16} color={colors.textSecondary} />
          <Text
            style={{
              fontSize: 13,
              fontWeight: '700',
              color: colors.text,
              marginLeft: 6,
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {total != null ? `${confirmedCount} of ${total} confirmed` : `${confirmedCount} confirmed`}
          </Text>
          <View style={{ flex: 1 }} />
          <Icon name="chevron-forward" size={14} color={colors.textSecondary} />
        </View>

        <View
          style={{
            height: 4,
            borderRadius: 999,
            overflow: 'hidden',
            marginTop: 8,
            backgroundColor: isDark ? '#2A2A2A' : '#E9ECEF',
          }}
        >
          {pct > 0 && (
            <View
              style={{
                width: `${pct}%`,
                height: '100%',
                borderRadius: 999,
                backgroundColor: colors.primary.main,
              }}
            />
          )}
        </View>

        {caption ? (
          <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 6 }}>{caption}</Text>
        ) : null}
      </View>
    );

    // The tracker is wider than the bubble (nearly the full row, QA mockup).
    const trackerWidth = Math.round(Dimensions.get('window').width) - (isSender ? 16 : 56);

    return (
      <View
        style={{
          alignSelf: (isSender ? 'flex-end' : 'flex-start') as 'flex-end' | 'flex-start',
          width: trackerWidth,
          marginTop: 6,
          marginLeft: isSender ? 8 : 40,
          marginRight: isSender ? 8 : 8,
        }}
      >
        {canManage ? (
          <TouchableOpacity
            onPress={openReport}
            accessibilityLabel="SeeConfirmations"
            activeOpacity={0.75}
            style={{
              backgroundColor: isDark ? colors.card : '#FFFFFF',
              borderWidth: 1,
              borderColor: isDark ? '#2A2A2A' : '#E5E7EB',
              borderRadius: 12,
              overflow: 'hidden',
            }}
          >
            {tracker}
          </TouchableOpacity>
        ) : (
          <View
            style={{
              backgroundColor: isDark ? colors.card : '#FFFFFF',
              borderWidth: 1,
              borderColor: isDark ? '#2A2A2A' : '#E5E7EB',
              borderRadius: 12,
            }}
          >
            {tracker}
          </View>
        )}
        {reportSheet}
      </View>
    );
  }

  if (!isSender && !confirmedByMe) {
    return (
      <View style={bannerWrap}>
        <TouchableOpacity
          onPress={() => onConfirm(messageId)}
          accessibilityLabel="ConfirmRead"
          activeOpacity={0.75}
        >
          <View
            style={{
              maxWidth: BANNER_MAX_WIDTH,
              borderRadius: 12,
              borderWidth: 1,
              paddingVertical: 9,
              paddingHorizontal: 14,
              backgroundColor: schemeFor(false).bg,
              borderColor: schemeFor(false).border,
            }}
          >
            {bannerContent('checkmark-circle-outline', 'Mark as Read', schemeFor(false).accent, true)}
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isSender && confirmedByMe && !canManage) {
    const myAck = ackBy.find((a) => String(a?.userId) === me);
    const label = confirmationTimeOf(myAck) ? `Confirmed · ${confirmationTimeOf(myAck)}` : 'Confirmed';
    const scheme = schemeFor(true);
    return (
      <View style={bannerWrap}>
        <View
          style={{
            maxWidth: BANNER_MAX_WIDTH,
            borderRadius: 12,
            borderWidth: 1,
            paddingVertical: 9,
            paddingHorizontal: 14,
            backgroundColor: scheme.bg,
            borderColor: scheme.border,
          }}
        >
          {bannerContent('checkmark-circle', label, scheme.accent, true)}
        </View>
        <Text
          style={{
            fontSize: 11,
            color: colors.textSecondary,
            marginTop: 6,
            textAlign: 'center',
          }}
        >
          {confirmationSenderFirstName(message)} can see you confirmed.
        </Text>
      </View>
    );
  }

  // Fallback: the sender without manager rights keeps a plain count row.
  const scheme = schemeFor(confirmedCount > 0);
  return (
    <View style={bannerWrap}>
      <View
        style={{
          maxWidth: BANNER_MAX_WIDTH,
          borderRadius: 12,
          borderWidth: 1,
          paddingVertical: 9,
          paddingHorizontal: 14,
          backgroundColor: scheme.bg,
          borderColor: scheme.border,
        }}
      >
        {bannerContent(
          confirmedCount > 0 ? 'checkmark-done' : 'checkmark-done-outline',
          `${confirmedCount} confirmed`,
          scheme.accent,
          true
        )}
      </View>
    </View>
  );
});
