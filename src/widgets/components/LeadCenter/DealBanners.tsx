import React from 'react';
import { View, Text } from 'react-native';

interface DealBannersProps {
  lead: any;
}

export const DealBanners = ({ lead }: DealBannersProps) => {
  const status = String(lead?.result || lead?.status || '');
  const isCancelled = status.toLowerCase() === 'cancelled';

  if (!isCancelled) return null;

  return (
    <View className="px-4 mb-2" style={{ marginTop: 6 }}>
      <View className="bg-[#B91C1C] rounded-xl py-3 px-4 items-center justify-center">
        <Text className="text-white font-extrabold text-xs tracking-wider">JOB CANCELLED</Text>
      </View>
    </View>
  );
};

export default DealBanners;
