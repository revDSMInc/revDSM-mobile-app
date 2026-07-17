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
          paddingTop: 26,
          paddingBottom: 10,
          paddingLeft: 14,
          paddingRight: 40,
        }}
      >
        {!!label && (
          <Text style={{ fontSize: 14, color: '#999', position: 'absolute', top: 10, left: 8,fontWeight: '600'}}>
            {label}
          </Text>
        )}
        <Text style={{ fontSize: 14,  color: '#999' }}>{value ?? '—'}</Text>
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
