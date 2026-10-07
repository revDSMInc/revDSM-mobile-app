import React from 'react';
import { View, Text } from 'react-native';
import { FS, FUND, PS } from './funding-theme';

interface Props {
  items: string[];
  title?: string;
  readyText?: string;
  override?: { title: string; body: string };
}

export function BlockerList({ items, title = 'Before you can submit:', readyText, override }: Props) {
  if (override) {
    return (
      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.MUTED, lineHeight: 17, marginBottom: 11 }}>
        <Text style={{ color: FUND.SUBTEXT }}>{override.title}</Text>
        {'\n'}
        {override.body}
      </Text>
    );
  }

  if (!items.length) {
    if (!readyText) return null;
    return (
      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.GREEN_TEXT, lineHeight: 17, marginBottom: 11 }}>
        {readyText}
      </Text>
    );
  }

  return (
    <View style={{ marginBottom: 11 }}>
      <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.SUBTEXT, lineHeight: 17 }}>{title}</Text>
      {items.map((b, i) => (
        <View key={`${b}-${i}`} style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
          <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.MUTED, lineHeight: 17 }}>•</Text>
          <Text style={{ flex: 1, fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.MUTED, lineHeight: 17 }}>{b}</Text>
        </View>
      ))}
    </View>
  );
}
