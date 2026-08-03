import React from 'react';
import { Text } from 'react-native';

interface SectionLabelProps {
  title: string;
}

// Matches the normal Job Builder sub-section titles: slate, font-black.
export function SectionLabel({ title }: SectionLabelProps) {
  return (
    <Text className="text-[12px] font-black text-slate-500 mb-2 mt-1">
      {title}
    </Text>
  );
}
