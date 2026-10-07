import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface LockedSingleOptionProps {
  label?: string;
  option: string;
}

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
