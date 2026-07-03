import React from 'react';
import { View, Text } from 'react-native';

interface SectionCardProps {
  children: React.ReactNode;
  incomplete?: boolean;
  borderColor?: string;
  className?: string;
}

export function SectionCard({ children, incomplete, borderColor, className = '' }: SectionCardProps) {
  return (
    <View
      className={`bg-white rounded-2xl mx-3 mb-3 p-4 shadow-sm ${className}`}
      style={{
        borderWidth: incomplete ? 2 : borderColor ? 2 : 1.5,
        borderColor: incomplete ? '#f59e0b' : borderColor || 'rgba(0,0,0,0.05)',
      }}
    >
      {incomplete && (
        <Text className="text-xs font-bold text-amber-500 mb-3">
          ⚠️ INCOMPLETE — Profile and Color Required
        </Text>
      )}
      {children}
    </View>
  );
}
