import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, Modal, FlatList, Animated, ScrollView } from 'react-native';

/**
 * ⚠️ `dark` is OPT-IN and defaults to the light look every existing caller relies on.
 * The control is hardcoded white (trigger and panel), which is right on the Lead Center
 * and the Roofline Deck but reads as a white slab on the Pitch Book's dark presentation
 * dock — so that one caller asks for the dark palette rather than the component guessing
 * from a theme it cannot see (the dock is dark in BOTH app themes).
 */
const YearDropdown = ({
  defaultValue = 3,
  min = 1,
  max = 5,
  onChange,
  dark = false,
}: {
  defaultValue?: number;
  min?: number;
  max?: number;
  onChange?: (val: number) => void;
  dark?: boolean;
}) => {
  const [selectedValue, setSelectedValue] = useState(defaultValue);
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ x: 0, y: 0, width: 0 });
  const triggerRef = useRef<View>(null);
  const rotateAnim = useRef(new Animated.Value(0)).current;

  const years = Array.from({ length: max - min + 1 }, (_, i) => min + i);

  const openDropdown = () => {
    triggerRef.current?.measure((_fx: any, _fy: any, width: any, height: any, px: any, py: any) => {
      setDropdownPos({ x: px, y: py + height + 4, width });
      setIsOpen(true);
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();
    });
  };

  const closeDropdown = () => {
    Animated.timing(rotateAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => setIsOpen(false));
  };

  const handleSelect = (year: number) => {
    setSelectedValue(year);
    onChange?.(year);
    closeDropdown();
  };

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  const tone = dark
    ? {
        trigger: 'rgba(255,255,255,0.08)',
        triggerBorder: 'rgba(255,255,255,0.18)',
        label: '#FFFFFF',
        panel: '#1A1C1D',
        panelBorder: 'rgba(255,255,255,0.12)',
        rowSelected: 'rgba(255,255,255,0.10)',
        rowText: 'rgba(255,255,255,0.72)',
        rowTextSelected: '#FFFFFF',
        chevron: 'rgba(255,255,255,0.72)',
      }
    : {
        trigger: '#FFFFFF',
        triggerBorder: '#919EAB52',
        label: '#1C252E',
        panel: '#FFFFFF',
        panelBorder: '#E5E7EB',
        rowSelected: '#F3F4F6',
        rowText: '#637381',
        rowTextSelected: '#1C252E',
        chevron: '#637381',
      };

  return (
    <View>
      {/* Trigger */}
      <TouchableOpacity
        ref={triggerRef}
        onPress={isOpen ? closeDropdown : openDropdown}
        activeOpacity={0.8}
        className="flex-row items-center justify-center px-3 py-2 border rounded-md"
        style={{ backgroundColor: tone.trigger, borderColor: tone.triggerBorder }}
      >
        <Text className="text-sm font-semibold mr-2" style={{ color: tone.label }}>
          {selectedValue} {selectedValue === 1 ? 'Year' : 'Years'}
        </Text>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <ChevronIcon color={tone.chevron} />
        </Animated.View>
      </TouchableOpacity>

      {/* Modal Dropdown — renders above everything */}
      <Modal visible={isOpen} transparent animationType="fade" onRequestClose={closeDropdown}>
        {/* Backdrop */}
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeDropdown}>
          {/* Dropdown panel */}
          <View
            style={{
              position: 'absolute',
              top: dropdownPos.y,
              left: dropdownPos.x,
              width: dropdownPos.width,
              maxHeight: 200,
              backgroundColor: tone.panel,
              borderRadius: 8,
              borderWidth: 0.5,
              borderColor: tone.panelBorder,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.1,
              shadowRadius: 12,
              elevation: 8,
              overflow: 'hidden',
            }}
          >
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              style={{ maxHeight: 250 }}
            >
              {years.map((item) => {
                const isSelected = item === selectedValue;
                return (
                  <TouchableOpacity
                    key={item}
                    onPress={() => handleSelect(item)}
                    activeOpacity={0.7}
                    className="m-1 rounded-md"
                    style={{
                      paddingHorizontal: 6,
                      paddingVertical: 12,
                      backgroundColor: isSelected ? tone.rowSelected : tone.panel,
                    }}
                  >
                    <Text
                      className="text-sm font-semibold"
                      style={{ color: isSelected ? tone.rowTextSelected : tone.rowText }}
                    >
                      {item} {item === 1 ? 'Year' : 'Years'}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const ChevronIcon = ({ color = '#637381' }: { color?: string }) => (
  <View style={{ width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
    <View
      style={{
        width: 7,
        height: 7,
        borderRightWidth: 1.5,
        borderBottomWidth: 1.5,
        borderColor: color,
        transform: [{ rotate: '45deg' }],
        marginTop: -4,
      }}
    />
  </View>
);

export default YearDropdown;
