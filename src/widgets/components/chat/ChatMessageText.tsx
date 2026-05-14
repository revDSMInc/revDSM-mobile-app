import React from 'react';
import { Text } from 'react-native';

export const ChatMessageText = ({
  text,
  isMe,
  colors,
  isPinned,
  searchQuery,
}: {
  text: string;
  isMe: boolean;
  colors: any;
  isPinned: boolean;
  searchQuery?: string;
}) => {
  if (!text) return null;

  const renderHighlightedText = (content: string, keyPrefix: string) => {
    if (!searchQuery?.trim()) return content;

    const regex = new RegExp(`(${searchQuery})`, 'gi');
    const parts = content.split(regex);

    return parts.map((part, j) => {
      if (part.toLowerCase() === searchQuery.toLowerCase()) {
        return (
          <Text key={`${keyPrefix}-${j}`} style={{ backgroundColor: '#FFD700', color: '#000' }}>
            {part}
          </Text>
        );
      }
      return part;
    });
  };

  const mentionParts = text.split(/(@\w+(?:\s\w+)?)/g);
  return (
    <Text
      style={{
        color: isPinned ? '#000' : isMe ? '#fff' : colors.text,
        fontSize: 13,
        lineHeight: 15,
      }}
    >
      {mentionParts.map((part, i) => {
        if (part.startsWith('@')) {
          const mentionStyle = isMe
            ? { color: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.2)' }
            : { color: '#00A76F', backgroundColor: 'rgba(0,167,111,0.08)' };

          return (
            <Text key={i} className="px-1 rounded font-bold" style={mentionStyle}>
              {renderHighlightedText(part, `m-${i}`)}
            </Text>
          );
        }
        return renderHighlightedText(part, `t-${i}`);
      })}
    </Text>
  );
};
