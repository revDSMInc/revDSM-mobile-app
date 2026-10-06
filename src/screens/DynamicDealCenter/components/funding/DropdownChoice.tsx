import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FS, FUND, PS } from './funding-theme';

/**
 * A labelled dropdown for a small, mutually-exclusive choice. The list expands
 * IN PLACE under the field rather than in a `Modal`: the screens that use it are
 * already inside one, and native Modals must never be stacked.
 *
 * Titles are never truncated — the selected one reads in full in the field, and
 * every row in the list wraps instead of ending in an ellipsis.
 *
 * ⚠️ Same contract as `SegmentedChoice`: `onSelect` also fires for a `disabled`
 * option (with `allowed: false`) so the caller can explain the refusal, and the
 * option that is already selected keeps its full treatment even when disabled.
 */

export interface DropdownOption<T extends string> {
  value: T;
  title: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  label?: string;
  options: DropdownOption<T>[];
  value: T;
  onSelect: (value: T, allowed: boolean) => void;
  hint?: string;
  hintTone?: 'muted' | 'warn';
}

export function DropdownChoice<T extends string>({ label, options, value, onSelect, hint, hintTone = 'muted' }: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={{ marginBottom: 20 }}>
      {!!label && (
        <Text style={{ fontSize: FS.SMALL, fontFamily: PS.extrabold, letterSpacing: 1.2, textTransform: 'uppercase', color: FUND.PANEL_LABEL, paddingHorizontal: 4, paddingBottom: 9 }}>
          {label}
        </Text>
      )}

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => setOpen((o) => !o)}
        style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderWidth: 1.6, borderColor: open ? FUND.GREEN : FUND.PANEL_LINE, borderRadius: 15, paddingHorizontal: 14, paddingVertical: 14 }}
      >
        <Text style={{ flex: 1, fontSize: FS.LEAD, fontFamily: PS.bold, color: FUND.GREEN_TEXT }}>{selected?.title ?? ''}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={FUND.SUBTEXT} />
      </TouchableOpacity>

      {open && (
        <View style={{ marginTop: 6, backgroundColor: '#fff', borderWidth: 1.2, borderColor: FUND.PANEL_LINE, borderRadius: 15, overflow: 'hidden' }}>
          {options.map((o, i) => {
            const on = o.value === value;
            const dim = !!o.disabled && !on;
            return (
              <TouchableOpacity
                key={o.value}
                activeOpacity={0.85}
                onPress={() => {
                  setOpen(false);
                  onSelect(o.value, !o.disabled);
                }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 14, opacity: dim ? 0.5 : 1, backgroundColor: on ? '#F4FCF1' : '#fff', borderTopWidth: i === 0 ? 0 : 1, borderTopColor: FUND.PANEL_LINE }}
              >
                <Text style={{ flex: 1, fontSize: FS.LEAD, fontFamily: PS.bold, color: on ? FUND.GREEN_TEXT : FUND.SUBTEXT }}>{o.title}</Text>
                {on && <Ionicons name="checkmark" size={18} color={FUND.GREEN} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {!!hint && (
        <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, lineHeight: 16, marginTop: 9, marginHorizontal: 4, color: hintTone === 'warn' ? FUND.AMBER_TEXT : FUND.MUTED }}>
          {hint}
        </Text>
      )}
    </View>
  );
}
