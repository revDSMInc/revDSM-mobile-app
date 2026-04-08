import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { Bubble } from 'react-native-gifted-chat';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../../theme/ThemeProvider';
import { useVoiceNote, formatMs } from '../../../../hooks/useVoiceNote';

const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

interface Props {
  bubbleProps: any;
  currentUserId: string;
  onReply: (msg: any) => void;
  onEdit: (msg: any) => void;
  onReact: (msg: any, emoji: string) => void;
}

// ─── Voice Note Player ────────────────────────────────────────────────────────
function VoiceNotePlayer({ uri, isMe }: { uri: string; isMe: boolean }) {
  const { colors, isDark } = useTheme();
  const {
    playbackState,
    playbackPos,
    playbackDuration,
    startPlayback,
    pausePlayback,
    stopPlayback,
  } = useVoiceNote();

  const isPlaying = playbackState === 'playing';
  const isPaused = playbackState === 'paused';

  const handlePress = async () => {
    if (isPlaying) {
      await pausePlayback();
    } else if (isPaused) {
      await startPlayback(uri); // restart from beginning for simplicity
    } else {
      await startPlayback(uri);
    }
  };

  const progress = playbackDuration > 0 ? playbackPos / playbackDuration : 0;

  return (
    <View
      className="flex-row items-center px-3 py-2 rounded-2xl"
      style={{
        backgroundColor: isMe ? 'rgba(255,255,255,0.2)' : isDark ? '#3A3A3A' : '#E8E8E8',
        minWidth: 180,
      }}
    >
      <TouchableOpacity onPress={handlePress} className="mr-3">
        <Icon
          name={isPlaying ? 'pause-circle' : 'play-circle'}
          size={32}
          color={isMe ? '#fff' : colors.primary.main}
        />
      </TouchableOpacity>

      <View className="flex-1">
        {/* Waveform-style progress bar */}
        <View
          className="h-1.5 rounded-full overflow-hidden"
          style={{ backgroundColor: isMe ? 'rgba(255,255,255,0.3)' : colors.border }}
        >
          <View
            style={{
              width: `${Math.round(progress * 100)}%`,
              height: '100%',
              backgroundColor: isMe ? '#fff' : colors.primary.main,
              borderRadius: 999,
            }}
          />
        </View>
        <Text
          className="text-[9px] font-black mt-1"
          style={{ color: isMe ? 'rgba(255,255,255,0.8)' : colors.textSecondary }}
        >
          {isPlaying || isPaused
            ? `${formatMs(playbackPos)} / ${formatMs(playbackDuration)}`
            : formatMs(playbackDuration || 0)}
        </Text>
      </View>

      <Icon
        name="mic"
        size={14}
        color={isMe ? 'rgba(255,255,255,0.6)' : colors.textSecondary}
        style={{ marginLeft: 8 }}
      />
    </View>
  );
}

// ─── ChatMessageBubble ────────────────────────────────────────────────────────
export function ChatMessageBubble({ bubbleProps, currentUserId, onReply, onEdit, onReact }: Props) {
  const { colors, isDark } = useTheme();
  const msg = bubbleProps.currentMessage;
  const isMe = msg?.user?._id === currentUserId;
  const reactions: any[] = (msg as any)?.reactions || [];

  // Detect voice notes (mobile, web, sockets, various backend field names)
  const voiceUri: string | undefined = (() => {
    // 1. Check all common array properties for an audio file
    const possibleArrays = [
      (msg as any)?.files,
      (msg as any)?.attachments,
      (msg as any)?.messageFiles,
      (msg as any)?.media,
    ];

    for (const arr of possibleArrays) {
      if (arr && Array.isArray(arr)) {
        const audio = arr.find(
          (f: any) =>
            f?.mimeType?.startsWith('audio') ||
            f?.type?.startsWith('audio') ||
            f?.url?.match(/\.(m4a|mp4|mp3|aac|wav|ogg|amr)$/i) ||
            f?.link?.match(/\.(m4a|mp4|mp3|aac|wav|ogg|amr)$/i)
        );
        const url = audio?.url || audio?.link || (typeof audio === 'string' ? audio : undefined);
        if (url) return url;
      }
    }

    // 2. Direct properties
    if (msg?.audio) return msg.audio;
    if ((msg as any).voiceUrl) return (msg as any).voiceUrl;

    // 3. Single file/attachment property
    const single = (msg as any)?.file || (msg as any)?.attachment;
    if (single) {
      const url = single.url || single.link || (typeof single === 'string' ? single : undefined);
      if (url && (single.mimeType?.startsWith('audio') || url.match(/\.(m4a|mp4|mp3|aac|wav|ogg|amr)$/i))) {
        return url;
      }
    }

    // 4. Fallback: Search the whole message object for anything that looks like an audio URL
    // Useful if the backend structure changes or differs from web
    try {
      const values = Object.values(msg);
      for (const val of values) {
        if (typeof val === 'string' && val.match(/^https?:\/\/.*?\.(m4a|mp4|mp3|aac|wav|ogg|amr)(\?.*)?$/i)) {
          return val;
        }
      }
    } catch {}

    return undefined;
  })();

  const handleLongPress = () => {
    const actions: any[] = [{ text: 'Reply', onPress: () => onReply(msg) }];
    if (isMe) {
      actions.push({ text: 'Edit', onPress: () => onEdit(msg) });
    }
    actions.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Message Actions', undefined, actions);
  };

  return (
    <View>
      {/* Reply context */}
      {(msg as any)?.replyToDetails && (
        <View
          className="mx-2 mb-1 px-3 py-1.5 rounded-xl border-l-4"
          style={{
            borderLeftColor: '#007AFF',
            backgroundColor: isDark ? '#1A2030' : '#EEF4FF',
            alignSelf: isMe ? 'flex-end' : 'flex-start',
            maxWidth: '80%',
          }}
        >
          <Text className="text-[9px] font-black uppercase tracking-widest text-blue-500 mb-0.5">
            {(msg as any).replyToDetails?.senderDetails?.firstName || 'User'}
          </Text>
          <Text className="text-[11px] opacity-70" style={{ color: colors.text }} numberOfLines={1}>
            {(msg as any).replyToDetails?.message || '📎 Attachment'}
          </Text>
        </View>
      )}

      {/* Voice note player */}
      {voiceUri ? (
        <View
          style={{
            alignSelf: isMe ? 'flex-end' : 'flex-start',
            marginHorizontal: 8,
            marginVertical: 2,
          }}
        >
          <View
            className="rounded-[20px] overflow-hidden p-2"
            style={{ backgroundColor: isMe ? '#007AFF' : isDark ? '#2A2A2A' : '#F0F0F0' }}
          >
            <VoiceNotePlayer uri={voiceUri} isMe={isMe} />
            <Text
              className="text-[9px] mt-1 text-right"
              style={{ color: isMe ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.4)' }}
            >
              {new Date(msg.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
        </View>
      ) : (
        /* Normal text/image bubble */
        <TouchableOpacity onLongPress={handleLongPress} activeOpacity={0.9}>
          <Bubble
            {...bubbleProps}
            wrapperStyle={{
              right: {
                backgroundColor: '#007AFF',
                borderRadius: 20,
                paddingVertical: 2,
                paddingHorizontal: 2,
              },
              left: {
                backgroundColor: isDark ? '#2A2A2A' : '#F0F0F0',
                borderRadius: 20,
                paddingVertical: 2,
                paddingHorizontal: 2,
              },
            }}
            textStyle={{
              right: { color: '#fff', fontSize: 13, lineHeight: 18 },
              left: { color: isDark ? '#fff' : '#111', fontSize: 13, lineHeight: 18 },
            }}
            timeTextStyle={{
              right: { color: 'rgba(255,255,255,0.6)', fontSize: 9 },
              left: { color: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)', fontSize: 9 },
            }}
          />
        </TouchableOpacity>
      )}

      {/* Reactions */}
      <View
        className="flex-row flex-wrap mt-0.5 mx-3 mb-1"
        style={{ justifyContent: isMe ? 'flex-end' : 'flex-start' }}
      >
        {reactions.map((r: any) => (
          <TouchableOpacity
            key={r.emoji}
            onPress={() => onReact(msg, r.emoji)}
            className="flex-row items-center rounded-full px-2 py-0.5 mr-1 mb-1"
            style={{ backgroundColor: isDark ? '#2A2A2A' : '#F0F0F0' }}
          >
            <Text style={{ fontSize: 11 }}>{r.emoji}</Text>
            {r.users?.length > 1 && (
              <Text className="text-[9px] font-black ml-1" style={{ color: colors.text }}>
                {r.users.length}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* Edited label */}
      {(msg as any)?.isEdited && (
        <Text
          className="text-[9px] opacity-40 mx-4 mb-1"
          style={{ color: colors.textSecondary, textAlign: isMe ? 'right' : 'left' }}
        >
          edited
        </Text>
      )}
    </View>
  );
}
