import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface LockedFieldProps {
  label?: string;
  value?: string | number;
  caption?: string;
}

// Faithful port of web `dynamic-job-builder/common/locked-field.js`: a grey
// rounded box (#f9f9f9 / 1.5px #e5e5ea) with the label floating inside at the
// top, the value below it, a padlock pinned right, and an italic
// "Locked from Job Summary" caption underneath. The caption prop was previously
// accepted but never rendered.
export function LockedField({ label, value, caption = 'Locked from Job Summary' }: LockedFieldProps) {
  return (
    <View className="mb-3">
      <View
        style={{
          borderRadius: 12,
          borderWidth: 1.5,
          borderColor: '#e5e5ea',
          backgroundColor: '#f9f9f9',
          // The label is absolutely positioned, so paddingTop has to clear it:
          // top (10) + the 14px label's line box (~18) = 28. Web can use 26 only
          // because its label is 12px at top 8. Too small a value and the label's
          // descenders sit on top of the value line.
          paddingTop: 32,
          paddingBottom: 10,
          // Must equal the label's `left` so the label and the value share one
          // left edge — they are laid out by different mechanisms (absolute vs
          // flow), so the two numbers have to be kept in sync by hand.
          paddingLeft: 14,
          paddingRight: 40,
        }}
      >
        {!!label && (
          <Text
            numberOfLines={1}
            style={{ fontSize: 14, color: '#999', fontWeight: '600', position: 'absolute', top: 10, left: 10, right: 40 }}
          >
            {label}
          </Text>
        )}
        <Text numberOfLines={1} style={{ fontSize: 14, color: '#999' }}>
          {value ?? '—'}
        </Text>
        <View style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' }}>
          <Icon name="lock" size={16} color="#ccc" />
        </View>
      </View>
      {!!caption && (
        <Text style={{ fontSize: 11, color: '#aaa', fontStyle: 'italic', marginTop: 3, paddingLeft: 4 }}>
          {caption}
        </Text>
      )}
    </View>
  );
}
