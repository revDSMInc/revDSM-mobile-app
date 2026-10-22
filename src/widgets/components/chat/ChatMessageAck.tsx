import React from 'react';
import { View, Text, TouchableOpacity, Dimensions } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

import { useTheme } from '../../../theme/ThemeProvider';
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
  onSeeWho?: (messageId: string) => void;
}

/** The banner tracks the bubble's width (MessageBubble caps a bubble at 75% of the screen). */
const BANNER_MAX_WIDTH = Math.round(Dimensions.get('window').width * 0.72);

// REVDSM-1313 "Require read confirmation": other people get a Mark as Read banner until they tap it,
// then a Confirmed banner; the sender and managers see how many have confirmed.
export const ChatMessageAck = React.memo(function ChatMessageAck({
  message,
  currentUserId,
  canManage = false,
  onConfirm,
  onSeeWho,
}: Props) {
  const { colors, isDark } = useTheme();

  const messageId = String(message?._id || message?.id || '');
  // Unsent, pending-approval and system rows have nothing to confirm.
  if (!messageId || messageId.startsWith('temp_') || message?.pendingApproval) return null;

  const ackBy: any[] = Array.isArray(message?.ackBy) ? message.ackBy : [];
  const me = String(currentUserId);
  const senderId = String(message?.user?._id || message?.senderId || '');
  const isSender = senderId === me;
  const confirmedByMe = ackBy.some((a) => String(a?.userId) === me);

  // Amber while the read is still open; green once something settled (any confirmation,
  // or the manager's own counted state).
  const schemeFor = (accentSettled: boolean) =>
    isDark
      ? (accentSettled ? ACK_GREEN.dark : ACK_AMBER.dark)
      : (accentSettled ? ACK_GREEN.light : ACK_AMBER.light);

  const bannerBox = {
    maxWidth: BANNER_MAX_WIDTH,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 9,
    paddingHorizontal: 14,
  };

  const bannerWithScheme = (settled: boolean, content: React.ReactNode) => (
    <View style={{ ...bannerBox, backgroundColor: schemeFor(settled).bg, borderColor: schemeFor(settled).border }}>
      {content}
    </View>
  );

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

  // Left margin mirrors the bubble's inset (avatar 32 + gutter 8) so the banner and the
  // message card share the same edge; the sender's own rows sit flush right.
  const bannerWrap = {
    alignSelf: (isSender ? 'flex-end' : 'flex-start') as 'flex-end' | 'flex-start',
    maxWidth: BANNER_MAX_WIDTH + 8,
    marginTop: 6,
    marginLeft: isSender ? 0 : 40,
    marginRight: isSender ? 4 : 0,
  };

  if (!isSender && !confirmedByMe) {
    const pendingScheme = schemeFor(false);
    return (
      <View style={bannerWrap}>
        <TouchableOpacity
          onPress={() => onConfirm(messageId)}
          accessibilityLabel="ConfirmRead"
          activeOpacity={0.75}
          accessible
        >
          {bannerWithScheme(
            false,
            bannerContent('checkmark-circle-outline', 'Mark as Read', pendingScheme.accent, true)
          )}
        </TouchableOpacity>
      </View>
    );
  }

  if (!isSender && confirmedByMe && !canManage) {
    const myAck = ackBy.find((a) => String(a?.userId) === me);
    const label = confirmationTimeOf(myAck) ? `Confirmed · ${confirmationTimeOf(myAck)}` : 'Confirmed';
    return (
      <View style={bannerWrap}>
        {bannerWithScheme(
          true,
          bannerContent('checkmark-circle', label, schemeFor(true).accent, true)
        )}
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

  // Sender, or a manager looking at the message: how many have confirmed.
  const countScheme = schemeFor(ackBy.length > 0);
  const countLabel = `${ackBy.length} confirmed${canManage ? ' · See who' : ''}`;
  const row = bannerWithScheme(
    ackBy.length > 0,
    bannerContent(
      ackBy.length > 0 ? 'checkmark-done' : 'checkmark-done-outline',
      countLabel,
      countScheme.accent,
      true
    )
  );

  return (
    <View style={bannerWrap}>
      {canManage && onSeeWho ? (
        <TouchableOpacity
          onPress={() => onSeeWho(messageId)}
          accessibilityLabel="SeeConfirmations"
          activeOpacity={0.75}
        >
          {row}
        </TouchableOpacity>
      ) : (
        row
      )}
    </View>
  );
});
