import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { FUND } from './funding-theme';

/**
 * A radio-card segmented control: two or more side-by-side cards, each a title
 * over a line of explanation, with the selected one filled green.
 *
 * Written as a **generic** control rather than as "the payment structure picker"
 * so any screen with a small, mutually-exclusive choice that needs explaining can
 * use it — the Result Lead sheet uses it for Down Payment vs Upfront, but nothing
 * about it knows that.
 *
 * ⚠️ An option can be `disabled` **while still being the selected one**. That is
 * the case this exists for: once money has started moving the structure is
 * settled, so the unpicked option greys out but the picked one keeps its full
 * treatment — greying both would read as "this control is broken" rather than
 * "this decision is made".
 */

export interface SegmentedOption<T extends string> {
  value: T;
  title: string;
  /** One line under the title. Keep it short — the cards are half-width. */
  subtitle?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  /** Small uppercase caption above the row. Omit for no heading. */
  label?: string;
  options: SegmentedOption<T>[];
  value: T;
  /**
   * Fires for a DISABLED option too, with `allowed: false`, so the caller can
   * explain the refusal instead of the tap silently doing nothing — a dead card
   * with no feedback is the most common way this pattern goes wrong.
   */
  onSelect: (value: T, allowed: boolean) => void;
  /** Caption under the row. Renders nothing when empty. */
  hint?: string;
  /** Tint the hint amber — used when it explains why a choice is unavailable. */
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
        <Text style={{ fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', color: FUND.PANEL_LABEL, paddingHorizontal: 4, paddingBottom: 9 }}>
          {label}
        </Text>
      )}

      <View style={{ flexDirection: 'row', gap: 9 }}>
        {options.map((o) => {
          const on = o.value === value;
          // Only an option the rep could switch TO is dimmed. See the note above.
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
                <Text style={{ flex: 1, fontSize: 15.5, fontWeight: '700', letterSpacing: -0.2, color: on ? FUND.GREEN_TEXT : FUND.SUBTEXT }} numberOfLines={1}>
                  {o.title}
                </Text>
              </View>
              {!!o.subtitle && (
                <Text style={{ fontSize: 10.5, fontWeight: '600', lineHeight: 14, marginTop: 5, color: on ? '#5F7A55' : FUND.MUTED }}>
                  {o.subtitle}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {!!hint && (
        <Text style={{ fontSize: 11, fontWeight: '600', lineHeight: 16, marginTop: 9, marginHorizontal: 4, color: hintTone === 'warn' ? FUND.AMBER_TEXT : FUND.MUTED }}>
          {hint}
        </Text>
      )}
    </View>
  );
}
