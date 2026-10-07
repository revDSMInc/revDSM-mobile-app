import React from 'react';
import { View, Text } from 'react-native';
import { FS, FUND, PS } from './funding-theme';
import { coverageState, type CoverageTone } from '../../utils/funding';

const TONES: Record<CoverageTone, { bg: string; fg: string }> = {
  ok: { bg: FUND.GREEN_BG, fg: FUND.GREEN_TEXT },
  short: { bg: FUND.AMBER_BG, fg: FUND.AMBER_TEXT },
  over: { bg: FUND.RED_BG, fg: FUND.RED_TEXT },
};

interface Props {
  assigned: number;
  target: number;
}

export function CoverageBar({ assigned, target }: Props) {
  const { tone, message, tally } = coverageState(assigned, target);
  const c = TONES[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: c.bg, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10, marginBottom: 2 }}>
      <Text style={{ flex: 1, fontSize: FS.SMALL, fontFamily: PS.bold, color: c.fg }}>{message}</Text>
      <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: c.fg }} numberOfLines={1}>
        {tally}
      </Text>
    </View>
  );
}
