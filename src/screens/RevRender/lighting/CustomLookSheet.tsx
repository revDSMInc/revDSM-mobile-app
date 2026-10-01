import React, { useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Defs, G, Path, RadialGradient, Stop, Circle } from 'react-native-svg';
import {
  canGlow, expandHex, hexToHsv, hsvToHex, isHexColor, MAX_CUSTOM_COLORS, patternFor,
} from '../../../utils/revrender-lighting/colors';
import { CustomLook } from '../../../utils/revrender-lighting/types';

const GREEN = '#2EDE56';
const WHEEL = 200;
const R = WHEEL / 2;

/** Hue sectors drawn as pie slices; the white radial overlay gives saturation. */
function HueWheel({ size = WHEEL }: { size?: number }) {
  const r = size / 2;
  const slices = useMemo(() => {
    const out: { d: string; fill: string }[] = [];
    const step = 6;
    for (let a = 0; a < 360; a += step) {
      const a0 = ((a - 90) * Math.PI) / 180;
      const a1 = ((a + step - 90) * Math.PI) / 180;
      out.push({
        d: `M ${r} ${r} L ${r + r * Math.cos(a0)} ${r + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${r + r * Math.cos(a1)} ${r + r * Math.sin(a1)} Z`,
        fill: hsvToHex(a, 1, 1),
      });
    }
    return out;
  }, [r]);

  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id="sat" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <Stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <G>{slices.map((s, i) => <Path key={i} d={s.d} fill={s.fill} />)}</G>
      <Circle cx={r} cy={r} r={r} fill="url(#sat)" />
    </Svg>
  );
}

/**
 * Custom look builder (483 §6). The only place a rep can invent a look —
 * the mockup positions it for high schools, which the catalogue does not cover.
 *
 * No pattern control: one colour renders single, two or more alternating.
 */
export function CustomLookSheet({
  visible,
  isDark,
  onSave,
  onClose,
}: {
  visible: boolean;
  isDark: boolean;
  onSave: (look: CustomLook) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [colors, setColors] = useState<string[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [hsv, setHsv] = useState({ h: 20, s: 0.9, v: 1 });
  const [hexDraft, setHexDraft] = useState('');

  const sub = isDark ? '#919EAB' : '#637381';
  const label = isDark ? '#fff' : '#212B36';
  const current = hsvToHex(hsv.h, hsv.s, hsv.v);
  const tooDark = !canGlow(current);

  const applyTouch = (x: number, y: number) => {
    const dx = x - R;
    const dy = y - R;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), R);
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (angle < 0) angle += 360;
    setHsv((p) => ({ ...p, h: angle, s: dist / R }));
  };

  const wheelPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => applyTouch(e.nativeEvent.locationX, e.nativeEvent.locationY),
      onPanResponderMove: (e) => applyTouch(e.nativeEvent.locationX, e.nativeEvent.locationY),
    }),
  ).current;

  const commit = () => {
    const hex = expandHex(current);
    if (editing !== null) {
      setColors(colors.map((c, i) => (i === editing ? hex : c)));
      setEditing(null);
    } else if (colors.length < MAX_CUSTOM_COLORS) {
      setColors([...colors, hex]);
    }
  };

  const usable = colors.filter(canGlow);
  const canSave = name.trim().length > 0 && usable.length > 0;

  const reset = () => { setName(''); setColors([]); setEditing(null); setHexDraft(''); };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View className="rounded-t-[24px] px-5 pt-3 pb-8" style={{ backgroundColor: isDark ? '#1E1E1E' : '#fff', maxHeight: '92%' }}>
          <View className="items-center mb-3">
            <View className="rounded-full" style={{ width: 36, height: 4, backgroundColor: sub }} />
          </View>

          <Text className="text-[17px] font-black mb-4" style={{ color: label }}>New custom look</Text>

          <Text className="text-[11px] font-black tracking-widest mb-2 uppercase" style={{ color: sub }}>Name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="e.g. Riverside High"
            placeholderTextColor={sub}
            accessibilityLabel="Look name"
            className="rounded-[14px] px-4 mb-4 text-[14px]"
            style={{ minHeight: 48, color: label, backgroundColor: isDark ? '#15191E' : '#F4F6F8' }}
          />

          <View className="items-center mb-3">
            <View {...wheelPan.panHandlers} style={{ width: WHEEL, height: WHEEL }}>
              <HueWheel />
            </View>
          </View>

          {/* Brightness. The wheel covers hue and saturation; value needs its own
              control or the rep can never reach a dark or muted shade. */}
          <Text className="text-[11px] font-black tracking-widest mb-2 uppercase" style={{ color: sub }}>Brightness</Text>
          <View className="flex-row items-center mb-4">
            {[0.2, 0.4, 0.6, 0.8, 1].map((v) => (
              <TouchableOpacity
                key={v}
                onPress={() => setHsv((p) => ({ ...p, v }))}
                accessibilityLabel={`Brightness ${Math.round(v * 100)} percent`}
                className="flex-1 mx-0.5 rounded-lg"
                style={{
                  height: 34,
                  backgroundColor: hsvToHex(hsv.h, hsv.s, v),
                  borderWidth: Math.abs(hsv.v - v) < 0.01 ? 2 : 0,
                  borderColor: GREEN,
                }}
              />
            ))}
          </View>

          {/* Hex field: the wheel is not reachable by keyboard or screen reader,
              so this is the accessible path to the same value (483 §11). */}
          <View className="flex-row items-center mb-4">
            <View
              className="rounded-lg mr-3"
              style={{ width: 40, height: 40, backgroundColor: current, borderWidth: 1, borderColor: isDark ? '#2A2F36' : '#DFE3E8' }}
            />
            <TextInput
              value={hexDraft || current}
              onChangeText={(t) => {
                setHexDraft(t);
                if (isHexColor(t)) setHsv(hexToHsv(t));
              }}
              onBlur={() => setHexDraft('')}
              autoCapitalize="characters"
              accessibilityLabel="Colour hex value"
              className="flex-1 rounded-[14px] px-4 text-[14px]"
              style={{ minHeight: 44, color: label, backgroundColor: isDark ? '#15191E' : '#F4F6F8' }}
            />
            <TouchableOpacity
              onPress={commit}
              disabled={tooDark || (editing === null && colors.length >= MAX_CUSTOM_COLORS)}
              accessibilityLabel={editing !== null ? 'Update colour' : 'Add colour'}
              className="ml-3 rounded-full items-center justify-center px-4"
              style={{
                minHeight: 44,
                backgroundColor: tooDark || (editing === null && colors.length >= MAX_CUSTOM_COLORS) ? (isDark ? '#2A2F36' : '#DFE3E8') : GREEN,
              }}
            >
              <Text className="text-[13px] font-black" style={{ color: tooDark ? sub : '#fff' }}>
                {editing !== null ? 'Update' : 'Add'}
              </Text>
            </TouchableOpacity>
          </View>

          {tooDark && (
            <Text className="text-[12px] mb-3" style={{ color: '#FFAB00' }}>
              Too dark to glow — LEDs can&apos;t emit black. Raise the brightness.
            </Text>
          )}

          {colors.length > 0 && (
            <>
              <Text className="text-[11px] font-black tracking-widest mb-2 uppercase" style={{ color: sub }}>
                Colors ({colors.length}/{MAX_CUSTOM_COLORS}) · {patternFor(usable) === 'single' ? 'Single color' : 'Alternating'}
              </Text>
              <View className="flex-row mb-4">
                {colors.map((c, i) => (
                  <View key={i} className="mr-3">
                    <TouchableOpacity
                      onPress={() => { setEditing(i); setHsv(hexToHsv(c)); }}
                      accessibilityLabel={`Edit colour ${c}`}
                      className="rounded-lg"
                      style={{
                        width: 44, height: 44, backgroundColor: c,
                        borderWidth: editing === i ? 2 : 1,
                        borderColor: editing === i ? GREEN : isDark ? '#2A2F36' : '#DFE3E8',
                      }}
                    />
                    <TouchableOpacity
                      onPress={() => { setColors(colors.filter((_, j) => j !== i)); setEditing(null); }}
                      accessibilityLabel={`Remove colour ${c}`}
                      className="absolute items-center justify-center rounded-full"
                      style={{ top: -6, right: -6, width: 20, height: 20, backgroundColor: '#637381' }}
                    >
                      <Icon name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            </>
          )}

          <View className="flex-row">
            <TouchableOpacity
              onPress={() => { reset(); onClose(); }}
              className="flex-1 mr-2 rounded-full items-center justify-center"
              style={{ minHeight: 50, borderWidth: 1, borderColor: isDark ? '#2A2F36' : '#DFE3E8' }}
            >
              <Text className="text-[15px] font-black" style={{ color: label }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!canSave}
              onPress={() => {
                onSave({
                  id: `custom-${Date.now()}`,
                  group: 'custom',
                  category: 'Custom',
                  name: name.trim(),
                  colors: usable,
                  pattern: patternFor(usable),
                  createdAt: Date.now(),
                });
                reset();
                onClose();
              }}
              className="flex-1 ml-2 rounded-full items-center justify-center"
              style={{ minHeight: 50, backgroundColor: canSave ? GREEN : isDark ? '#2A2F36' : '#DFE3E8' }}
            >
              <Text className="text-[15px] font-black" style={{ color: canSave ? '#fff' : sub }}>Save look</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
