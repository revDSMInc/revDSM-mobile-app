import React from 'react';
import { View, Text } from 'react-native';
import { AgreementBlockProps } from './types';

// NOTE: HTML stripped to plain text — react-native-render-html is not installed.
// Web renders `block.content` via dangerouslySetInnerHTML; RN has no HTML renderer,
// so we strip tags to plain text (preserving <br>/</p> line breaks and decoding a few
// common entities) and render inside a single <Text> preserving newlines.
function stripHtml(html: string): string {
  if (!html) return '';
  let text = String(html);
  // Turn line-break-producing tags into newlines first.
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/p>/gi, '\n');
  // Remove any remaining tags.
  text = text.replace(/<[^>]*>/g, '');
  // Decode the entities the web content commonly contains.
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  return text.trim();
}

// Faithful port of web `blocks/paragraph-block.js`.
// Returns null when there is no content.
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
