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

  const mentionParts = text.split(/(@[a-zA-Z0-9_]+)/g);
  return (
    <Text
      style={{
        color: isPinned ? '#000' : isMe ? '#fff' : colors.text,
        fontSize: 13,
        lineHeight: 16,
      }}
    >
      {mentionParts.map((part, i) => {
        if (part.startsWith('@')) {
          const mentionStyle = isMe
            ? { 
                color: '#FFFFFF', 
                backgroundColor: 'rgba(255,255,255,0.25)', 
                paddingHorizontal: 5, 
                paddingVertical: 1, 
                borderRadius: 4,
                overflow: 'hidden' as const
              }
            : { 
                color: '#00A76F', 
                backgroundColor: 'rgba(0,167,111,0.12)', 
                paddingHorizontal: 5, 
                paddingVertical: 1, 
                borderRadius: 4,
                overflow: 'hidden' as const
              };

          return (
            <Text key={i} className="font-bold" style={mentionStyle}>
              {renderHighlightedText(part, `m-${i}`)}
            </Text>
          );
        }
        return renderHighlightedText(part, `t-${i}`);
      })}
    </Text>
  );
};
