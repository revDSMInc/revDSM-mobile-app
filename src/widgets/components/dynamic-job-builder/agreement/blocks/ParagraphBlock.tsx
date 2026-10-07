import React from 'react';
import { View, Text } from 'react-native';
import { AgreementBlockProps } from './types';

function stripHtml(html: string): string {
  if (!html) return '';
  let text = String(html);
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  text = text.replace(/<[^>]*>/g, '');
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  return text.trim();
}

export default function ParagraphBlock({ block }: AgreementBlockProps) {
  if (!block?.content) return null;

  return (
    <View style={{ marginVertical: 16 }}>
      <Text style={{ margin: 0, textAlign: 'justify', fontSize: 10, color: '#000' }}>
        {stripHtml(block.content)}
      </Text>
    </View>
  );
}
