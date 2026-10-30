import React from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { GIF_REPLY_LABEL, isGifFileMessage, isGifMessageText } from '../../../utils/gif-message';

interface ReplyBarProps {
  replyingTo: any;
  currentUserId?: string;
  onCancel: () => void;
}

export function ChatReplyBar({ replyingTo, currentUserId, onCancel }: ReplyBarProps) {
  const { colors, isDark } = useTheme();
  if (!replyingTo) return null;

  const isMeReply = String(replyingTo.user?._id || replyingTo.senderDetails?._id || replyingTo.senderDetails?.id || replyingTo.userId || '') === String(currentUserId || '');
  const senderName = isMeReply
    ? 'You'
    : (
        replyingTo.senderDetails?.name ||
        [replyingTo.senderDetails?.firstName, replyingTo.senderDetails?.lastName]
          .filter(Boolean)
          .join(' ') ||
        replyingTo.user?.name ||
        replyingTo.authorName ||
        'User'
      );

  const getFileType = (file: any) => {
    if (!file) return null;
    if (file.type) {
      if (file.type.includes('image')) return 'image';
      if (file.type.includes('video')) return 'video';
      if (file.type.includes('audio')) return 'audio';
    }
    const name = (file.name || '').toLowerCase();
    if (name.match(/\.(jpeg|jpg|gif|png|webp)$/)) return 'image';
    if (name.match(/\.(mp4|mov|avi|wmv)$/)) return 'video';
    if (name.match(/\.(mp3|wav|m4a|aac)$/)) return 'audio';
    return 'file';
  };

  const replyFiles = replyingTo.files || [];
  const replyPrimaryFile = replyFiles[0];
  const replyFileType = getFileType(replyPrimaryFile);
  const isReplyVoice = !!(
    replyingTo.audio ||
    replyingTo.voice ||
    replyingTo.isVoiceNote ||
    replyFileType === 'audio'
  );

  let replyIcon = null;
  let replyLabel = replyingTo.text || replyingTo.message || '';
  // A GIF reply shows the GIF itself, never its url. A stored GIF carries an S3 key, which cannot be
  // rendered, and this bar is handed no signed urls - so it falls back to the GIF label below.
  const replyGifFile = isGifFileMessage(replyingTo) ? replyFiles[0] : null;
  const replyGifUrl = isGifMessageText(replyLabel)
    ? replyLabel.trim()
    : [replyGifFile?.url, replyGifFile?.previewUrl].find(
        (u: any) => typeof u === 'string' && /^(https?|file):/.test(u)
      ) || null;

  if (replyGifUrl || replyGifFile) {
    replyIcon = 'images';
    replyLabel = GIF_REPLY_LABEL;
  } else if (isReplyVoice) {
    replyIcon = 'mic';
    replyLabel = `Voice Message ${replyingTo.duration ? `(${replyingTo.duration})` : ''}`;
  } else if (replyFileType === 'image' || replyingTo.image) {
    replyIcon = 'image';
    replyLabel = replyLabel || 'Photo';
  } else if (replyFileType === 'video' || replyingTo.video) {
    replyIcon = 'videocam';
    replyLabel = replyLabel || 'Video';
  } else if (replyPrimaryFile || ['file', 'pdf', 'doc'].includes(replyFileType || '')) {
    replyIcon = 'document';
    replyLabel = replyLabel || replyPrimaryFile?.name || 'Document';
  }

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
        <Text className="text-[10px] font-black  tracking-widest text-blue-500 mb-0.5">
          Replying to {senderName}
        </Text>
        <View className="flex-row items-center">
          {replyGifUrl ? (
            <Image
              source={{ uri: replyGifUrl }}
              style={{ width: 48, height: 48, borderRadius: 8, marginTop: 2 }}
              resizeMode="cover"
            />
          ) : (
            <>
              {replyIcon && (
                <Icon name={replyIcon} size={14} color={colors.text} style={{ marginRight: 4, opacity: 0.6 }} />
              )}
              <Text
                className="text-[12px] font-semibold opacity-60 flex-1"
                style={{ color: colors.text }}
                numberOfLines={isReplyVoice ? undefined : 1}
              >
                {replyLabel || 'Attachment'}
              </Text>
            </>
          )}
        </View>
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
        <Text className="text-[10px] font-black  tracking-widest text-amber-500 mb-0.5">
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
