import React from 'react';
import { View, Text } from 'react-native';
import { FUND } from './funding-theme';
import { coverageState, type CoverageTone } from '../../utils/funding';

/**
 * "Does this add up?" — a one-line running total, tinted by whether it does.
 *
 * Reusable for any screen splitting a fixed figure across several lines: it takes
 * the two numbers and nothing else. The wording and the tone both come from
 * `coverageState` in `utils/funding`, so the copy is testable and a second caller
 * cannot invent a different phrasing for the same state.
 *
 * ⚠️ Amber for a shortfall, **red only for an overage**. A gap is the normal
 * mid-typing state and must not read as an error the moment the rep starts; being
 * over the contract price is a real mistake and gets the alarming colour.
 */

const TONES: Record<CoverageTone, { bg: string; fg: string }> = {
  ok: { bg: FUND.GREEN_BG, fg: FUND.GREEN_TEXT },
  short: { bg: FUND.AMBER_BG, fg: FUND.AMBER_TEXT },
  over: { bg: FUND.RED_BG, fg: FUND.RED_TEXT },
};

interface Props {
  /** What the rows currently add up to. */
  assigned: number;
  /** What they need to add up to. */
  target: number;
}

export function CoverageBar({ assigned, target }: Props) {
  const { tone, message, tally } = coverageState(assigned, target);
  const c = TONES[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: c.bg, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10, marginBottom: 2 }}>
      <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: c.fg }}>{message}</Text>
      <Text style={{ fontSize: 13, fontWeight: '700', color: c.fg }} numberOfLines={1}>
        {tally}
      </Text>
    </View>
  );
}
