import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

import { useTheme } from '../../../theme/ThemeProvider';

interface Props {
  message: any;
  currentUserId: string;
  canManage?: boolean;
  onConfirm: (messageId: string) => void;
  onSeeWho?: (messageId: string) => void;
}

// REVDSM-1313 "Require read confirmation": other people get a Confirm button until they tap it,
// the sender and managers see how many have confirmed.
export const ChatMessageAck = React.memo(function ChatMessageAck({
  message,
  currentUserId,
  canManage = false,
  onConfirm,
  onSeeWho,
}: Props) {
  const { colors } = useTheme();

  const messageId = String(message?._id || message?.id || '');
  // Unsent, pending-approval and system rows have nothing to confirm.
  if (!messageId || messageId.startsWith('temp_') || message?.pendingApproval) return null;

  const ackBy: any[] = Array.isArray(message?.ackBy) ? message.ackBy : [];
  const me = String(currentUserId);
  const senderId = String(message?.user?._id || message?.senderId || '');
  const isSender = senderId === me;
  const confirmedByMe = ackBy.some((a) => String(a?.userId) === me);

  if (!isSender && !confirmedByMe) {
    return (
      <View style={{ alignSelf: 'flex-start', paddingHorizontal: 6, paddingTop: 4, paddingBottom: 2 }}>
        <TouchableOpacity
          onPress={() => onConfirm(messageId)}
          accessibilityLabel="ConfirmRead"
          className="flex-row items-center px-3 py-1.5 rounded-full border"
          style={{ borderColor: colors.primary.main, backgroundColor: colors.card }}
        >
          <Icon name="checkmark-circle-outline" size={16} color={colors.primary.main} />
          <Text className="text-[12px] font-bold ml-1.5" style={{ color: colors.primary.main }}>
            Mark as Read
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isSender && confirmedByMe && !canManage) {
    return (
      <View style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingTop: 2, flexDirection: 'row', alignItems: 'center' }}>
        <Icon name="checkmark-circle" size={14} color={colors.primary.main} />
        <Text className="text-[11px] ml-1" style={{ color: colors.textSecondary }}>
          Read 
        </Text>
      </View>
    );
  }

  // Sender, or a manager looking at someone else's message.
  return (
    <TouchableOpacity
      disabled={!canManage || !onSeeWho}
      onPress={() => onSeeWho?.(messageId)}
      style={{
        alignSelf: isSender ? 'flex-end' : 'flex-start',
        paddingHorizontal: 8,
        paddingTop: 2,
        flexDirection: 'row',
        alignItems: 'center',
      }}
    >
      <Icon name="checkmark-done" size={14} color={colors.textSecondary} />
      <Text className="text-[11px] ml-1" style={{ color: colors.textSecondary }}>
        {ackBy.length} confirmed{canManage ? ' · See who' : ''}
      </Text>
    </TouchableOpacity>
  );
});
