import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface EmptyStepGateProps {
  stepLabel: string;
  onAddDetails: () => void;
  onSkip: () => void;
}

export function EmptyStepGate({ stepLabel, onAddDetails, onSkip }: EmptyStepGateProps) {
  return (
    <View style={{ padding: 16 }}>
      <View
        style={{
          borderWidth: 1,
          borderColor: '#E2E8F0',
          borderRadius: 16,
          backgroundColor: '#fff',
          paddingVertical: 32,
          paddingHorizontal: 16,
          alignItems: 'center',
        }}
      >
        <Icon name="clipboard-list-outline" size={44} color="#919EAB" />
        <Text style={{ fontWeight: '700', fontSize: 16, color: '#1C252E', marginTop: 16, textAlign: 'center' }}>
          {`No details on “${stepLabel}” yet`}
        </Text>
        <Text style={{ fontSize: 13, color: '#637381', marginTop: 8, textAlign: 'center', lineHeight: 20 }}>
          This step has no measurements or selections. Add details for it, or skip to the next step.
        </Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
          <TouchableOpacity
            onPress={onSkip}
            style={{
              paddingHorizontal: 24,
              paddingVertical: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: '#919EAB52',
              backgroundColor: '#fff',
            }}
          >
            <Text style={{ fontWeight: '700', fontSize: 14, color: '#1C252E' }}>Skip</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onAddDetails}
            style={{
              paddingHorizontal: 24,
              paddingVertical: 10,
              borderRadius: 10,
              backgroundColor: '#22C55E',
            }}
          >
            <Text style={{ fontWeight: '700', fontSize: 14, color: '#fff' }}>Add details</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
