import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useTheme } from '../../../theme/ThemeProvider';
import { useVoiceNote, formatMs } from '../../../hooks/useVoiceNote';

export function VoiceNotePlayer({
  uri,
  isMe,
  isPinned,
  maxBubbleWidth,
}: {
  uri: string;
  isMe: boolean;
  isPinned: boolean;
  maxBubbleWidth: number;
}) {
  const { colors } = useTheme();
  const {
    playbackState,
    playbackPos,
    playbackDuration,
    startPlayback,
    pausePlayback,
    setPlaybackSpeed,
  } = useVoiceNote();

  const progress = playbackDuration > 0 ? playbackPos / playbackDuration : 0;
  const isPlaying = playbackState === 'playing';
  const isPaused = playbackState === 'paused';
  const [speed, setSpeed] = useState(1);

  const handlePress = () => {
    if (isPlaying) pausePlayback();
    else startPlayback(uri);
  };

  const toggleSpeed = () => {
    const next = speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1;
    setSpeed(next);
    setPlaybackSpeed(next);
  };

  const tintColor = isPinned ? '#222' : isMe ? '#fff' : colors.primary.main;

  return (
    <View
      className="flex-row items-center p-2 rounded-xl"
      style={{
        backgroundColor: isPinned
          ? 'rgba(0,0,0,0.05)'
          : isMe
          ? 'rgba(255,255,255,0.1)'
          : 'rgba(0,0,0,0.05)',
        width: maxBubbleWidth - 20,
      }}
    >
      <TouchableOpacity onPress={handlePress} className="mr-2">
        <Icon name={isPlaying ? 'pause' : 'play'} size={30} color={tintColor} />
      </TouchableOpacity>
      <View className="flex-1">
        <View
          className="h-1 rounded-full overflow-hidden"
          style={{
            backgroundColor: isPinned
              ? 'rgba(0,0,0,0.1)'
              : isMe
              ? 'rgba(255,255,255,0.2)'
              : '#D1D7DB',
          }}
        >
          <View
            style={{
              width: `${Math.round(progress * 100)}%`,
              height: '100%',
              backgroundColor: tintColor,
            }}
          />
        </View>
        <View className="flex-row justify-between items-center mt-1">
          <Text
            className="text-[9px] font-bold"
            style={{
              color: isPinned ? '#666' : isMe ? 'rgba(255,255,255,0.7)' : colors.textSecondary,
            }}
          >
            {isPlaying || isPaused
              ? `${formatMs(playbackPos)} / ${formatMs(playbackDuration)}`
              : formatMs(playbackDuration || 0)}
          </Text>
          <TouchableOpacity onPress={toggleSpeed} className="px-1.5 py-0.5 rounded-md bg-black/10">
            <Text className="text-[9px] font-bold" style={{ color: tintColor }}>
              {speed}x
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
