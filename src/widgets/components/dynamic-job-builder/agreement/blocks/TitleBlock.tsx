import React from 'react';
import { View, Text } from 'react-native';
import { AgreementBlockProps } from './types';

export default function TitleBlock({ block }: AgreementBlockProps) {
  if (!block?.title) return null;

  return (
    <View style={{ alignItems: 'center', marginVertical: 16 }}>
      <Text
        style={{
          fontSize: 16,
          fontWeight: 'bold',
          margin: 0,
          letterSpacing: 2,
          textTransform: 'uppercase',
          textAlign: 'center',
          color: '#000',
        }}
      >
        {block.title}
      </Text>
    </View>
  );
}
