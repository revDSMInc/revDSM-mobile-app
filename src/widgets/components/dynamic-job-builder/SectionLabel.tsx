import React from 'react';
import { Text } from 'react-native';

interface SectionLabelProps {
  title: string;
}

export function SectionLabel({ title }: SectionLabelProps) {
  return (
    <Text className="text-[11px] font-extrabold text-gray-400 tracking-widest uppercase py-2.5 px-0">
      {title}
    </Text>
  );
}
