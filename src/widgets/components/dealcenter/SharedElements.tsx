import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';

export const PricingInputField = React.memo(({
  label,
  value,
  onSave,
  confirmed = false,
  noLabel = false,
}: any) => {
  const [local, setLocal] = useState(String(value || ''));
  useEffect(() => setLocal(String(value || '')), [value]);
  return (
    <View className={noLabel ? '' : 'mb-8'}>
      {!noLabel && (
        <Text className="text-[10px] font-black text-slate-500  mb-3 ml-1 tracking-widest">
          {label}
        </Text>
      )}
      <View
        className={`flex-row items-center bg-white border border-slate-200 rounded-2xl px-5 h-16 shadow-sm ${
          noLabel ? 'border-0 shadow-none bg-transparent h-12' : ''
        }`}
      >
        {!noLabel && <Text className="text-xl font-black text-slate-400 mr-2">$</Text>}
        {noLabel && <Text className="text-lg font-black text-slate-400 mr-1">$</Text>}
        <TextInput
          className={`flex-1 font-black text-[#101828] ${noLabel ? 'text-lg' : 'text-xl'}`}
          value={local}
          placeholder=""
          keyboardType="numeric"
          onChangeText={setLocal}
          onBlur={() => {
            const num = Number(local.replace(/[^0-9.]/g, ''));
            setTimeout(() => {
              onSave(num);
            }, 100);
          }}
        />
        {confirmed && !noLabel && (
          <View className="bg-slate-100 px-4 py-2 rounded-xl">
            <Text className="text-[10px] font-black text-slate-500 ">Confirmed</Text>
          </View>
        )}
      </View>
    </View>
  );
});

export const SubHeader = ({ title }: any) => (
  <Text className="text-xs font-semibold text-[#637381] mt-6 mb-3">{title}</Text>
);

export const Section = ({
  title,
  id,
  children,
  icon,
  color,
  desc,
  expanded,
  onToggle,
  onClear,
}: any) => (
  <View className="mb-6 bg-white overflow-hidden rounded-[24px] border border-slate-100 shadow-sm">
    <TouchableOpacity
      onPress={() => onToggle(id)}
      className="flex-row items-center justify-between p-5"
    >
      <View className="flex-row items-center flex-1">
        <View
          className="w-10 h-10 rounded-xl items-center justify-center mr-4"
          style={{ backgroundColor: color + '15' }}
        >
          <Ionicons name={icon} size={20} color={color} />
        </View>
        <View>
          <Text className="text-sm font-black" style={{ color: '#1C252E' }}>
            {title}
          </Text>
          {desc && <Text className="text-[9px] font-bold text-slate-400 ">{desc}</Text>}
        </View>
      </View>
      <View className="flex-row items-center">
        {onClear && (
          <TouchableOpacity
            onPress={(e) => {
              e.stopPropagation();
              onClear();
            }}
            className="mr-3 px-3 py-1.5 border border-slate-200 rounded-xl"
          >
            <Text className="text-[11px] font-extrabold text-[#FF5630]">Clear</Text>
          </TouchableOpacity>
        )}
        <Ionicons name={expanded[id] ? 'chevron-up' : 'chevron-down'} size={14} color="#637381" />
      </View>
    </TouchableOpacity>
    {expanded[id] && <View className="px-5 pb-6">{children}</View>}
  </View>
);

export const InputField = React.memo(({
  label,
  value,
  keyName,
  price,
  isExtra = false,
  unit = '',
  onUpdate,
  highlighted = false,
  red = false,
  editable = true,
}: any) => {
  const getDisplayValue = (val: any) => {
    if (val === undefined || val === null) return '';
    const s = String(val).trim();
    return s === '0' || s === '0.00' ? '' : s;
  };

  const [localValue, setLocalValue] = useState(getDisplayValue(value));
  useEffect(() => {
    setLocalValue(getDisplayValue(value));
  }, [value]);

  const bgColor = red ? '#FFF1F0' : highlighted ? '#fff5da' : 'white';
  const borderColor = red ? '#FF4D4F' : '#919EAB33';

  return (
    <View className="relative mt-2 mb-3">
      <View className="absolute -top-[7px] left-3 z-10 px-1" style={{ backgroundColor: bgColor }}>
        <Text className={`text-[10px] font-black ${red ? 'text-[#FF4D4F]' : 'text-[#1C252E]'} `}>
          {label}
        </Text>
      </View>
      <View
        className="flex-row items-center border rounded-lg"
        style={{
          borderColor: borderColor,
          backgroundColor: bgColor,
          paddingVertical: 2,
          paddingHorizontal: 14,
        }}
      >
        <TextInput
          className="flex-1 h-11 text-sm font-black text-[#1C252E]"
          value={localValue}
          editable={editable}
          onChangeText={setLocalValue}
          onBlur={() => {
            if (!editable) return;
            const normLocal = localValue.trim() === '0' ? '' : localValue.trim();
            const normValue = String(value === undefined || value === null ? '' : value).trim();
            const normValClean = normValue === '0' || normValue === '0.00' ? '' : normValue;
            if (normLocal !== normValClean) {
              setTimeout(() => {
                if (isExtra) onUpdate({ extras: { [keyName]: localValue } });
                else onUpdate({ inputs: { [keyName]: localValue } });
              }, 100);
            }
          }}
          keyboardType="numeric"
          placeholder=""
          placeholderTextColor="#919EAB"
        />
        <View className="flex-row items-center border-l border-[#919EAB33] pl-3 ml-2">
          <Text className="text-[10px] font-bold text-slate-400  mr-1">{unit}</Text>
          {price && <Text className="text-[10px] font-bold text-green-600">${price}</Text>}
        </View>
      </View>
    </View>
  );
});
