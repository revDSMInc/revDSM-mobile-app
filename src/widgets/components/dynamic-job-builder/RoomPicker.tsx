import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

interface RoomPickerProps {
  label?: string;
  value?: string[];
  onChange?: (val: string[]) => void;
  roomSet?: 'rooms' | 'bath';
  color?: string;
}

const ROOM_OPTIONS = [
  'Living Room', 'Master Bedroom', 'Bedroom 2', 'Bedroom 3',
  'Hallway', 'Kitchen', 'Dining Room', 'Basement', 'Office', 'Other',
];

const BATH_OPTIONS = ['Master Bath', 'Guest Bath', 'Half Bath', 'Basement Bath', 'Other'];

export function RoomPicker({ label, value = [], onChange, roomSet = 'rooms', color = '#3b82f6' }: RoomPickerProps) {
  const rooms = roomSet === 'bath' ? BATH_OPTIONS : ROOM_OPTIONS;

  const toggle = (room: string) => {
    const next = value.includes(room) ? value.filter((r) => r !== room) : [...value, room];
    onChange?.(next);
  };

  return (
    <View className="mb-4">
      {/* Web parity (`roomPicker` → OptionSelector `label={showLabel === false ? '' :
          field.label}`): render the label only when provided. A field that sets
          `showLabel:false` (e.g. Wet Space "Location", already titled by its section
          header) passes no label and must NOT print a duplicate one. */}
      {!!label && (
        <Text className="text-[13px] font-bold text-gray-500 mb-2">{label}</Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        {rooms.map((r) => {
          const selected = value.includes(r);
          return (
            <TouchableOpacity
              key={r}
              onPress={() => toggle(r)}
              className="py-2.5 px-4 rounded-full"
              style={{
                borderWidth: selected ? 2 : 1.5,
                borderColor: selected ? color : '#e5e5ea',
                backgroundColor: selected ? color : '#fff',
              }}
            >
              <Text
                className="text-xs"
                style={{ color: selected ? '#fff' : '#555', fontWeight: selected ? '700' : '400' }}
              >
                {r}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {value.length > 0 && (
        <Text className="mt-2 text-[11px] font-bold" style={{ color }}>
          ✓ {value.join(', ')}
        </Text>
      )}
    </View>
  );
}
