import React from 'react';
import { Text } from 'react-native';

export const ChatMessageText = ({
  text,
  isMe,
  colors,
  isPinned,
}: {
  text: string;
  isMe: boolean;
  colors: any;
  isPinned: boolean;
}) => {
  if (!text) return null;
  const parts = text.split(/(@\w+(?:\s\w+)?)/g);
  return (
    <Text
      style={{
        color: isPinned ? '#000' : isMe ? '#fff' : colors.text,
        fontSize: 14.5,
        lineHeight: 21,
      }}
    >
      {parts.map((part, i) => {
        if (part.startsWith('@')) {
          const mentionStyle = isMe
            ? { color: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.2)' }
            : { color: '#00A76F', backgroundColor: 'rgba(0,167,111,0.08)' };

          return (
            <Text key={i} className="px-1 rounded font-bold" style={mentionStyle}>
              {part}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
};
