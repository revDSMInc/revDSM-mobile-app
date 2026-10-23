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
  onConfirm: (messageId: string) => void;
}

/** The banner tracks the bubble's width (MessageBubble caps a bubble at 75% of the screen). */
const BANNER_MAX_WIDTH = Math.round(Dimensions.get('window').width * 0.72);

// REVDSM-1313 "Require read confirmation": every other reader gets a Mark as Read banner until
// they tap it, then a green Confirmed banner. Read tracking itself lives on the manager's portal
// — the messages API only ships each viewer their own flag, so the app shows just that.
export const ChatMessageAck = React.memo(function ChatMessageAck({ message, currentUserId, onConfirm }: Props) {
  const { colors, isDark } = useTheme();

  const messageId = String(message?._id || message?.id || '');
  const ackBy: any[] = Array.isArray(message?.ackBy) ? message.ackBy : [];
  const me = String(currentUserId);
  const senderId = String(message?.user?._id || message?.senderId || '');
  const isSender = senderId === me;
  // The personal flag arrives as `acknowledgedByMe`/`acknowledgedAt`; `ackBy` covers a
  // manager/creator payload, which still carries the fuller rows.
  const confirmedByMe =
    message?.acknowledgedByMe === true || ackBy.some((a) => String(a?.userId) === me);
  const myAckTime = message?.acknowledgedAt || confirmationTimeOf(ackBy.find((a) => String(a?.userId) === me));

  // Unsent, pending-approval and system rows have nothing to confirm.
  if (!messageId || messageId.startsWith('temp_') || message?.pendingApproval) return null;

  // The sender's own bubble is already marked by the header strip.
  if (isSender) return null;

  // Amber while the read is open; green once something settled.
  const scheme = confirmedByMe ? ACK_GREEN : ACK_AMBER;
  const accent = isDark ? scheme.dark : scheme.light;

  const bannerWrap = {
    alignSelf: 'flex-start' as const,
    marginTop: 6,
    marginLeft: 40,
    marginRight: 4,
    maxWidth: BANNER_MAX_WIDTH + 8,
  };

  const bannerContent = (iconName: string, label: string, color: string) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
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

  if (!confirmedByMe) {
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
              backgroundColor: accent.bg,
              borderColor: accent.border,
            }}
          >
            {bannerContent('checkmark-circle-outline', 'Mark as Read', accent.accent)}
          </View>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={bannerWrap}>
      <View
        style={{
          maxWidth: BANNER_MAX_WIDTH,
          borderRadius: 12,
          borderWidth: 1,
          paddingVertical: 9,
          paddingHorizontal: 14,
          backgroundColor: accent.bg,
          borderColor: accent.border,
        }}
      >
        {bannerContent('checkmark-circle', myAckTime ? `Confirmed · ${myAckTime}` : 'Confirmed', accent.accent)}
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
});
