import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface SectionCardProps {
  children: React.ReactNode;
  incomplete?: boolean;
  borderColor?: string;
  className?: string;
}

export function SectionCard({ children, incomplete, borderColor, className = '' }: SectionCardProps) {
  return (
    <View
      className={`bg-white rounded-[24px] mx-3 mb-4 p-5 shadow-sm ${className}`}
      style={{
        borderWidth: incomplete || borderColor ? 2 : 1,
        borderColor: incomplete ? '#FBBF24' : borderColor || '#E2E8F0',
      }}
    >
      {incomplete && (
        <View className="flex-row items-center mb-3">
          <Icon name="alert-circle" size={14} color="#FBBF24" />
          <Text className="text-[#FBBF24] text-[10px] font-black ml-2">
            Incomplete — required fields remaining
          </Text>
        </View>
      )}
      {children}
    </View>
  );
}
