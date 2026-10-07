import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FS, FUND, PS } from './funding-theme';

export interface SegmentedOption<T extends string> {
  value: T;
  title: string;
  subtitle?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  label?: string;
  options: SegmentedOption<T>[];
  value: T;
  onSelect: (value: T, allowed: boolean) => void;
  hint?: string;
  hintTone?: 'muted' | 'warn';
}

export function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onSelect,
  hint,
  hintTone = 'muted',
}: Props<T>) {
  return (
    <View style={{ marginBottom: 20 }}>
      {!!label && (
        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, letterSpacing: 1.2, textTransform: 'uppercase', color: FUND.PANEL_LABEL, paddingHorizontal: 4, paddingBottom: 9 }}>
          {label}
        </Text>
      )}

      <View style={{ flexDirection: 'row', gap: 9 }}>
        {options.map((o) => {
          const on = o.value === value;
          const dim = !!o.disabled && !on;
          return (
            <TouchableOpacity
              key={o.value}
              activeOpacity={0.85}
              onPress={() => onSelect(o.value, !o.disabled)}
              style={{ flex: 1, minWidth: 0, opacity: dim ? 0.5 : 1, backgroundColor: on ? '#F4FCF1' : '#fff', borderWidth: 1.6, borderColor: on ? FUND.GREEN : FUND.PANEL_LINE, borderRadius: 15, paddingHorizontal: 12, paddingVertical: 13 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <View style={{ width: 17, height: 17, borderRadius: 9, borderWidth: 2, alignItems: 'center', justifyContent: 'center', borderColor: on ? FUND.GREEN : '#CCD3CD', backgroundColor: on ? FUND.GREEN : 'transparent' }}>
                  {on && <Ionicons name="checkmark" size={10} color="#fff" />}
                </View>
                <Text style={{ flex: 1, fontSize: FS.LEAD, fontFamily: PS.bold, letterSpacing: -0.2, color: on ? FUND.GREEN_TEXT : FUND.SUBTEXT }} numberOfLines={1}>
                  {o.title}
                </Text>
              </View>
              {!!o.subtitle && (
                <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, lineHeight: 14, marginTop: 5, color: on ? '#5F7A55' : FUND.MUTED }}>
                  {o.subtitle}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {!!hint && (
        <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, lineHeight: 16, marginTop: 9, marginHorizontal: 4, color: hintTone === 'warn' ? FUND.AMBER_TEXT : FUND.MUTED }}>
          {hint}
        </Text>
      )}
    </View>
  );
}
