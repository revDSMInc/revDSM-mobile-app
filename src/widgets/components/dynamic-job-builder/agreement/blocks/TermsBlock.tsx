import React from 'react';
import { View, Text } from 'react-native';
import { AgreementBlockProps } from './types';

// Faithful port of web `blocks/terms-block.js`.
// Renders `block.settings.terms`, sorted by `order` ascending, as bold-label + content
// paragraphs. Returns null when there are no terms.
export default function TermsBlock({ block }: AgreementBlockProps) {
  const terms: any[] = block?.settings?.terms || [];

  if (!terms.length) return null;

  return (
    <View style={{ marginVertical: 16 }}>
      {[...terms]
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((term: any) => (
          <Text
            key={term.id}
            style={{ fontSize: 10, lineHeight: 14, marginVertical: 8, color: '#000' }}
          >
            <Text style={{ fontWeight: 'bold' }}>{term.label}</Text> {term.content}
          </Text>
        ))}
    </View>
  );
}
