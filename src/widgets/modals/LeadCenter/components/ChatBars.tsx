import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../../theme/ThemeProvider';

interface ReplyBarProps {
  replyingTo: any;
  onCancel: () => void;
}

// Shown above the input when the user is replying — matches web ReplyPreview
export function ChatReplyBar({ replyingTo, onCancel }: ReplyBarProps) {
  const { colors, isDark } = useTheme();
  if (!replyingTo) return null;

  const senderName =
    replyingTo.senderDetails?.name ||
    [replyingTo.senderDetails?.firstName, replyingTo.senderDetails?.lastName]
      .filter(Boolean)
      .join(' ') ||
    'User';

  return (
    <View
      className="flex-row items-center px-4 py-2 border-t"
      style={{
        backgroundColor: isDark ? '#1A1A1A' : '#F8F9FA',
        borderTopColor: colors.border,
      }}
    >
      <View
        className="w-1 h-full rounded-full mr-3"
        style={{ backgroundColor: '#007AFF', minHeight: 30 }}
      />
      <View className="flex-1">
        <Text className="text-[10px] font-black uppercase tracking-widest text-blue-500 mb-0.5">
          Replying to {senderName}
        </Text>
        <Text
          className="text-[12px] font-semibold opacity-60"
          style={{ color: colors.text }}
          numberOfLines={1}
        >
          {replyingTo.message || replyingTo.text || '📎 Attachment'}
        </Text>
      </View>
      <TouchableOpacity onPress={onCancel} className="ml-3 p-1">
        <Icon name="close-circle" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

interface EditBarProps {
  editingMessage: any;
  onCancel: () => void;
}

// Shown above input when the user is editing a sent message
export function ChatEditBar({ editingMessage, onCancel }: EditBarProps) {
  const { colors, isDark } = useTheme();
  if (!editingMessage) return null;

  return (
    <View
      className="flex-row items-center px-4 py-2 border-t"
      style={{
        backgroundColor: isDark ? '#1A1A1A' : '#FFFBEB',
        borderTopColor: '#F59E0B30',
      }}
    >
      <Icon name="create-outline" size={16} color="#F59E0B" style={{ marginRight: 10 }} />
      <View className="flex-1">
        <Text className="text-[10px] font-black uppercase tracking-widest text-amber-500 mb-0.5">
          Editing Message
        </Text>
        <Text
          className="text-[12px] font-semibold opacity-60"
          style={{ color: colors.text }}
          numberOfLines={1}
        >
          {editingMessage.text || editingMessage.message}
        </Text>
      </View>
      <TouchableOpacity onPress={onCancel} className="ml-3 p-1">
        <Icon name="close-circle" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}
