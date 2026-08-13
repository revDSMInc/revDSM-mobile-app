import React from 'react';
import { View, Text } from 'react-native';
import { FUND } from './funding-theme';

/**
 * The checklist above a disabled action: what is still standing between the rep
 * and the button, or a green line saying nothing is.
 *
 * Both footers of the Result Lead sheet use it — Confirm (`confirmBlockers`) and
 * Submit Funding (`fundingBlockers`, or the server's own `blockers` on a refused
 * submit) — and it is deliberately ignorant of which: it takes strings and a
 * heading, so anything gating a button behind a list of reasons can reuse it.
 *
 * ⚠️ The point is that the reasons are visible BEFORE the tap. A greyed button
 * with no explanation is the thing this replaces, and it is why an empty list
 * still renders (the ready line) rather than collapsing to nothing.
 */

interface Props {
  items: string[];
  /** Sentence above the bullets. */
  title?: string;
  /** Shown in green when `items` is empty. Omit to render nothing at all. */
  readyText?: string;
  /**
   * Replaces the whole thing — for a state where the list does not apply, e.g. a
   * Bank Decline, which submits with no funding to satisfy.
   */
  override?: { title: string; body: string };
}

export function BlockerList({ items, title = 'Before you can submit:', readyText, override }: Props) {
  if (override) {
    return (
      <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.MUTED, lineHeight: 17, marginBottom: 11 }}>
        <Text style={{ color: FUND.SUBTEXT }}>{override.title}</Text>
        {'\n'}
        {override.body}
      </Text>
    );
  }

  if (!items.length) {
    if (!readyText) return null;
    return (
      <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.GREEN_TEXT, lineHeight: 17, marginBottom: 11 }}>
        {readyText}
      </Text>
    );
  }

  return (
    <View style={{ marginBottom: 11 }}>
      <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.SUBTEXT, lineHeight: 17 }}>{title}</Text>
      {items.map((b, i) => (
        // Bullet and text are separate so a wrapped line indents under the words
        // rather than under the dot — these run to two lines often.
        <View key={`${b}-${i}`} style={{ flexDirection: 'row', gap: 6, marginTop: 2 }}>
          <Text style={{ fontSize: 11.5, fontWeight: '700', color: FUND.MUTED, lineHeight: 17 }}>•</Text>
          <Text style={{ flex: 1, fontSize: 11.5, fontWeight: '700', color: FUND.MUTED, lineHeight: 17 }}>{b}</Text>
        </View>
      ))}
    </View>
  );
}
