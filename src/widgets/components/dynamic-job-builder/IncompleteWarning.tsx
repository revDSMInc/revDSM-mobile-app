import React from 'react';
import { Text } from 'react-native';

export function IncompleteWarning({ message }: { message: string }) {
  return (
    <Text className="text-[11px] font-semibold mb-1.5" style={{ color: '#FFAB00' }}>
      ⚠️ {message}
    </Text>
  );
}
