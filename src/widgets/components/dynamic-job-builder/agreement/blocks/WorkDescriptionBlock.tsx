import React from 'react';
import { View, Text } from 'react-native';
import { AgreementBlockProps } from './types';

export default function WorkDescriptionBlock({ block, jobScope = [] }: AgreementBlockProps) {
  const preBlockText: string = block?.settings?.preBlockText || '';
  const postBlockText: string = block?.settings?.postBlockText || '';

  return (
    <View
      style={{
        marginVertical: 16,
        borderWidth: 1,
        borderColor: '#000',
        padding: 8,
      }}
    >
      {!!block?.title && (
        <Text style={{ fontWeight: 'bold', fontSize: 10, color: '#000' }}>
          {block.title}:
        </Text>
      )}

      {!!preBlockText && (
        <Text style={{ fontSize: 10, marginVertical: 4, color: '#000' }}>
          {preBlockText}
        </Text>
      )}

      <View style={{ marginTop: 0 }}>
        {jobScope.map((item: string, index: number) => (
          <Text
            key={index}
            style={{ fontSize: 10, marginBottom: 5, color: '#000' }}
          >
            {'• '}
            {item}
          </Text>
        ))}
      </View>

      {!!postBlockText && (
        <Text style={{ fontSize: 10, marginVertical: 4, color: '#000' }}>
          {postBlockText}
        </Text>
      )}
    </View>
  );
}
