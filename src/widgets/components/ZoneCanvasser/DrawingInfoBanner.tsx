import React from 'react';
import { View, Text } from 'react-native';

type Props = {
  drawType: 'polygon' | 'rectangle';
};

export function DrawingInfoBanner({ drawType }: Props) {
  return (
    <View className="bg-[#FF563020] px-3 py-3 items-center">
      <Text className="text-[#FF5630] text-xs font-semibold text-center">
        {drawType === 'polygon'
          ? 'Tap sequentially on the map to define polygon vertices. Tap Save Zone once done.'
          : 'Tap two opposite corners to define a rectangular canvassing zone.'}
      </Text>
    </View>
  );
}
