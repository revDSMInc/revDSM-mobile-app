import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface LockedSingleOptionProps {
  label?: string;
  option: string;
}

/**
 * Display-only locked chip shown when dependency filtering leaves exactly ONE
 * selectable option — RN port of web
 * `job-builder-common/locked-single-option-selector.js`.
 *
 * There is nothing to choose, so this renders no touch target at all: a filled
 * info-teal pill with a padlock, and the italic "Only option available" caption
 * to its right. The value itself is written into job state by the auto-select
 * effect in `OptionToggleField` — this component is purely the visual half.
 *
 * NOT to be confused with `LockedField` ("Locked from Job Summary"), which is the
 * grey read-only box for values carried over from the calculator. Different
 * mechanism, different look.
 */
export function LockedSingleOption({ label, option }: LockedSingleOptionProps) {
  return (
    <View className="mb-4">
      {!!label && (
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#1C252E', marginBottom: 8 }}>
          {label}
        </Text>
      )}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 4,
          gap: 8,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            // web `bgcolor: 'info.main'` — the teal pill in the reference UI.
            backgroundColor: '#00B8D9',
            borderRadius: 18,
            paddingHorizontal: 12,
            paddingVertical: 8,
            flexShrink: 1,
          }}
        >
          <Icon name="lock" size={14} color="#fff" />
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '800', color: '#fff', flexShrink: 1 }}>
            {option}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          style={{ fontSize: 12, fontStyle: 'italic', color: '#919EAB', flexShrink: 0 }}
        >
          Only option available
        </Text>
      </View>
    </View>
  );
}
