import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface DropdownSelectProps {
  label?: string;
  /** Options remaining after `getVisibleFieldOptions` (already rule-filtered). */
  options: string[];
  value?: string;
  onChange?: (val: string) => void;
  placeholder?: string;
  accentColor?: string;
}

const ACCENT = '#22C55E';

/**
 * A real single-select dropdown — the control REVDSM-1063 is actually asking for
 * ("My deals - NEVER have text inputs - always should be a drop down with all
 * options"). Collapsed it shows the current selection; tapping it reveals the
 * option list; picking an option selects it and collapses again.
 *
 * ⚠️ The list expands INLINE — deliberately not a `Modal` and not an absolutely
 * positioned overlay.
 *
 *   - The Job Builder already renders inside a native `Modal`, and this repo's
 *     hard rule is never to stack them: iOS silently drops a presentation
 *     requested while another modal is still dismissing (that is what froze the
 *     CoC paper-fallback scanner).
 *   - An absolute overlay would not work either: a sibling `GestureDetector`
 *     swallows touches whatever its `zIndex`, because `zIndex` orders painting
 *     only — and these fields sit inside scrollable, gesture-driven combination
 *     cards.
 *
 * Expanding in flow costs a little scroll height and sidesteps both traps.
 */
export function DropdownSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select an option',
  accentColor = ACCENT,
}: DropdownSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = typeof value === 'string' ? value : '';
  const hasValue = !!selected && options.includes(selected);

  return (
    <View className="mb-3">
      {!!label && (
        <Text className="text-[11px] font-black text-slate-400 mb-1.5">{label}</Text>
      )}

      <TouchableOpacity
        onPress={() => setOpen((prev) => !prev)}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        className="rounded-2xl border-2 px-4"
        style={{
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderColor: open ? accentColor : '#F1F5F9',
          backgroundColor: '#fff',
        }}
      >
        <Text
          numberOfLines={1}
          className="text-[12px] font-black"
          style={{ flex: 1, color: hasValue ? '#1C252E' : '#CBD5E1' }}
        >
          {hasValue ? selected : placeholder}
        </Text>
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={open ? accentColor : '#94A3B8'}
        />
      </TouchableOpacity>

      {open && (
        <View
          className="mt-1.5 rounded-2xl border-2 overflow-hidden"
          style={{ borderColor: '#F1F5F9', backgroundColor: '#fff' }}
        >
          {options.map((opt, index) => {
            const isSelected = opt === selected;
            return (
              <TouchableOpacity
                key={opt}
                onPress={() => {
                  // Web parity with the chip grid it replaces: tapping the current
                  // selection clears it, so a non-required field can be unanswered.
                  onChange?.(isSelected ? '' : opt);
                  setOpen(false);
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                className="px-4 py-3.5"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopColor: '#F1F5F9',
                  backgroundColor: isSelected ? `${accentColor}12` : '#fff',
                }}
              >
                <Text
                  numberOfLines={2}
                  className="text-[12px] font-black"
                  style={{ flex: 1, color: isSelected ? accentColor : '#64748B' }}
                >
                  {opt}
                </Text>
                {isSelected && <Icon name="check" size={16} color={accentColor} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}
