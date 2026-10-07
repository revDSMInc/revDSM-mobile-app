import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface LockedFieldProps {
  label?: string;
  value?: string | number;
  caption?: string;
}

export function LockedField({ label, value, caption = 'Locked from Job Summary' }: LockedFieldProps) {
  return (
    <View className="mb-3">
      <View
        style={{
          borderRadius: 12,
          borderWidth: 1.5,
          borderColor: '#e5e5ea',
          backgroundColor: '#f9f9f9',
          paddingTop: 32,
          paddingBottom: 10,
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
