import React from 'react';
import { View, Text } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface AllocatorBarProps {
  label?: string;
  avail?: number;
  used?: number;
  unit?: string;
  inactive?: boolean;
  compact?: boolean;
}

// Styled to match the normal Job Builder footage tracker card
// (GutterSection renderAllocationCard): #A5E1ED border, sky/amber stat colors,
// #22C55E "Perfectly allocated" banner, red over-allocation banner.
// `compact` drops the outer horizontal margin so the card fills its grid column
// inside the collapsible Footage Allocation Tracker.
export function AllocatorBar({ label, avail = 0, used = 0, unit = '', inactive = false, compact = false }: AllocatorBarProps) {
  const left = avail - used;
  const complete = Math.abs(left) <= 0.1 && avail > 0;
  const over = left < -0.1;

  return (
    <View
      className={`${compact ? 'mb-2' : 'mx-3 mb-3'} py-2 rounded-2xl border-2 bg-white`}
      style={{
        borderColor: '#A5E1ED',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 15,
        elevation: 2,
        opacity: inactive ? 0.45 : 1,
      }}
    >
      {label && (
        <Text className="text-[10px] font-black text-[#0EA5E9] mb-1 text-center tracking-tight">
          {label}
        </Text>
      )}
      <View className="flex-row justify-around px-1">
        <View className="items-center">
          <Text className="text-[8px] font-bold text-slate-400 mb-0.5">Avail</Text>
          <Text className="text-base font-black text-[#7DD3FC]">{avail}{unit}</Text>
        </View>
        <View className="items-center">
          <Text className="text-[8px] font-bold text-slate-400 mb-0.5">Used</Text>
          <Text className="text-base font-black text-[#F59E0B]">{used}{unit}</Text>
        </View>
        <View className="items-center">
          <Text className="text-[8px] font-bold text-slate-400 mb-0.5">Left</Text>
          <Text className={`text-base font-black ${over ? 'text-red-500' : 'text-slate-800'}`}>
            {left}{unit}
          </Text>
        </View>
      </View>

      {!inactive && complete && (
        <View className="bg-[#22C55E] rounded-xl py-2 px-2 mt-1.5 mx-2 flex-row items-center justify-center">
          <Icon name="check" size={12} color="#fff" />
          <Text className="text-white text-[9px] font-black tracking-tight ml-1">
            Perfectly allocated!
          </Text>
        </View>
      )}
      {!inactive && over && (
        <View className="bg-red-500 rounded-xl py-2 px-2 mt-1.5 mx-2 flex-row items-center justify-center">
          <Icon name="alert" size={12} color="#fff" />
          <Text className="text-white text-[9px] font-black tracking-tight ml-1">
            Over by {Math.abs(left)}{unit}
          </Text>
        </View>
      )}
    </View>
  );
}
