import React, { useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Svg, { Defs, G, Path, RadialGradient, Stop, Circle } from 'react-native-svg';
import {
  canGlow, clamp01, expandHex, hexToHsv, hsvToHex, MAX_CUSTOM_COLORS, patternFor, puckColors,
} from '../../../utils/revrender-lighting/colors';
import { CustomLook } from '../../../utils/revrender-lighting/types';

const GREEN = '#2EDE56';
const WHEEL = 224;
const R = WHEEL / 2;
const KNOB = 26;

/** Preview pucks across the run. 18 in the mock; it reads as a roofline, not a few dots. */
const PREVIEW_PUCKS = 18;

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
 * The dusk preview: the look as it will actually be rendered, on a dusk sky
 * with the channel and a wash of light on the wall below.
 *
 * ⚠️ This is the point of the sheet. Swatches say which colours were picked;
 * only this says what the homeowner will see, which is what the rep is selling.
 */
function DuskPreview({ colors, pattern }: { colors: string[]; pattern: 'single' | 'alternating' }) {
  const pucks = puckColors(colors, pattern, PREVIEW_PUCKS);
  const unlit = colors.length === 0;

  return (
    <View
      className="overflow-hidden rounded-[16px] mt-3.5"
      style={{ height: 118, backgroundColor: '#17284D' }}
    >
      {/* The wall below the eave, catching the light. */}
      <View
        className="absolute left-0 right-0 bottom-0"
        style={{ height: '52%', backgroundColor: 'rgba(255,255,255,0.04)' }}
      />

      {/* The aluminium channel the pucks are fitted into. */}
      <View
        className="absolute left-0 right-0"
        style={{
          top: 34, height: 16, backgroundColor: 'rgba(255,255,255,0.14)',
          borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.22)',
          borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.5)',
        }}
      />

      {/* The spill of light down the wall, under each puck. */}
      {!unlit && (
        <View className="absolute flex-row justify-between" style={{ left: 14, right: 14, top: 52 }}>
          {pucks.map((c, i) => (
            <View
              key={i}
              style={{
                width: 16, height: 34, marginHorizontal: -4,
                borderBottomLeftRadius: 8, borderBottomRightRadius: 8,
                backgroundColor: c, opacity: 0.38,
              }}
            />
          ))}
        </View>
      )}

      {/* The pucks themselves, each with its own halo. */}
      <View className="absolute flex-row justify-between" style={{ left: 14, right: 14, top: 38 }}>
        {pucks.map((c, i) => (
          <View key={i} className="items-center justify-center" style={{ width: 8, height: 8 }}>
            {!unlit && (
              <View
                pointerEvents="none"
                className="absolute rounded-full"
                style={{ width: 20, height: 20, backgroundColor: c, opacity: 0.3 }}
              />
            )}
            <View
              style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: unlit ? '#4A5677' : c }}
            />
          </View>
        ))}
      </View>

      <Text
        className="absolute text-[11px]"
        style={{ left: 12, bottom: 8, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.4 }}
      >
        Dusk preview · pucks every 9 in
      </Text>
    </View>
  );
}

/**
 * Custom look builder (483 §6). The only place a rep can invent a look —
 * the mockup positions it for high schools, which the catalogue does not cover.
 *
 * No pattern control: one colour renders single, two or more alternating.
 *
 * ⚠️ Colour picking is a SEPARATE card that opens on demand, not a wheel that
 * is always on screen. The sheet's job is the look (name, preview, swatches);
 * the wheel is a detour into one swatch, and leaving it permanently open pushed
 * the preview and the Save button off the bottom of a small phone.
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
  /** Which swatch the open picker is editing — `null` means it is adding a new one. */
  const [editing, setEditing] = useState<number | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [hsv, setHsv] = useState({ h: 20, s: 0.9, v: 1 });
  /** True while the wheel or brightness knob is held — freezes the ScrollView. */
  const [dragging, setDragging] = useState(false);

  const sub = isDark ? '#919EAB' : '#637381';
  const label = isDark ? '#fff' : '#212B36';
  const fill = isDark ? '#15191E' : '#F4F6F8';
  const current = expandHex(hsvToHex(hsv.h, hsv.s, hsv.v));
  const tooDark = !canGlow(current);
  const full = colors.length >= MAX_CUSTOM_COLORS;

  /**
   * ⚠️ Both gestures below are driven by PAGE coordinates measured against the
   * view's own frame, not by `nativeEvent.locationX/Y`.
   *
   * `locationX` is only meaningful while the touch is inside the view. Drag off
   * the wheel or past the end of the slider — which is exactly what happens
   * when you grab the knob and keep going — and it can arrive `undefined`.
   * `undefined / width` is NaN, and ⚠️ `Math.max(0, NaN)` is **NaN**, so a
   * min/max clamp does not catch it. The NaN reached a style as
   * `backgroundColor: "#NANNANNAN"` and `left: "NaN%"`, and Android throws on
   * an unparseable colour: that was the crash on dragging the brightness bar.
   */
  const wheelRef = useRef<View>(null);
  const barRef = useRef<View>(null);
  const wheelFrame = useRef({ x: 0, y: 0 });
  const barFrame = useRef({ x: 0, width: 0 });

  const measureWheel = () => {
    wheelRef.current?.measureInWindow((x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) wheelFrame.current = { x, y };
    });
  };
  const measureBar = () => {
    barRef.current?.measureInWindow((x, _y, width) => {
      if (Number.isFinite(x) && width > 0) barFrame.current = { x, width };
    });
  };

  const applyWheel = (pageX: number, pageY: number) => {
    const dx = pageX - wheelFrame.current.x - R;
    const dy = pageY - wheelFrame.current.y - R;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), R);
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
    if (angle < 0) angle += 360;
    // Saturation is clamped; hue is already normalised by the angle maths.
    setHsv((p) => ({ ...p, h: angle, s: clamp01(dist / R, p.s) }));
  };

  const applyBrightness = (pageX: number) => {
    const { x, width } = barFrame.current;
    if (!width) return;
    setHsv((p) => ({ ...p, v: clamp01((pageX - x) / width, p.v) }));
  };

  /**
   * ⚠️ The `Capture` variants, and `true` from the start.
   *
   * Without capture the enclosing `ScrollView` wins any gesture with vertical
   * movement, so dragging the wheel — or nudging the brightness knob slightly
   * off-axis — scrolled the sheet instead of changing the colour. Capturing
   * claims the touch before the ScrollView is offered it.
   */
  const wheelPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        setDragging(true);
        measureWheel();
        applyWheel(e.nativeEvent.pageX, e.nativeEvent.pageY);
      },
      onPanResponderMove: (e) => applyWheel(e.nativeEvent.pageX, e.nativeEvent.pageY),
      // ⚠️ Both release AND terminate, or an interrupted gesture (a call, the
      // sheet dismissing) leaves the ScrollView permanently frozen.
      onPanResponderRelease: () => setDragging(false),
      onPanResponderTerminate: () => setDragging(false),
    }),
  ).current;

  /** Brightness track: drag anywhere along it, Darker → Brighter. */
  const brightnessPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        setDragging(true);
        measureBar();
        applyBrightness(e.nativeEvent.pageX);
      },
      onPanResponderMove: (e) => applyBrightness(e.nativeEvent.pageX),
      onPanResponderRelease: () => setDragging(false),
      onPanResponderTerminate: () => setDragging(false),
    }),
  ).current;

  const openPicker = (index: number | null) => {
    if (index !== null) setHsv(hexToHsv(colors[index]));
    setEditing(index);
    setPickerOpen(true);
  };

  const closePicker = () => { setPickerOpen(false); setEditing(null); };

  const commit = () => {
    if (editing !== null) {
      setColors(colors.map((c, i) => (i === editing ? current : c)));
    } else if (!full) {
      setColors([...colors, current]);
    }
    closePicker();
  };

  const usable = colors.filter(canGlow);
  const canSave = name.trim().length > 0 && usable.length > 0;
  const pattern = patternFor(usable.length ? usable : colors);

  const reset = () => {
    setName(''); setColors([]); setEditing(null); setPickerOpen(false);
  };

  // The knob sits on the wheel at the current hue/saturation.
  // `clamp01` on the saturation keeps a bad value out of a layout style; the
  // state setters already guard it, and this is the last line of defence.
  const knobAngle = ((hsv.h - 90) * Math.PI) / 180;
  const knobSat = clamp01(hsv.s);
  const knobLeft = R + Math.cos(knobAngle) * knobSat * R - KNOB / 2;
  const knobTop = R + Math.sin(knobAngle) * knobSat * R - KNOB / 2;
  const brightness = clamp01(hsv.v, 1);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View
          className="rounded-t-[24px] pt-3"
          style={{ backgroundColor: isDark ? '#1E1E1E' : '#fff', maxHeight: '92%' }}
        >
          <View className="items-center mb-3">
            <View className="rounded-full" style={{ width: 36, height: 4, backgroundColor: sub }} />
          </View>

          {/* `shrink` so the pinned footer keeps its space whatever the picker adds. */}
          {/*
            ⚠️ `scrollEnabled` is switched off while a colour knob is held.
            Responder capture alone was not enough on Android: the ScrollView
            could still steal a drag that started mostly vertical, so dragging
            down the wheel scrolled the sheet instead of changing the colour.
          */}
          <ScrollView
            className="shrink px-5"
            scrollEnabled={!dragging}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text className="text-[20px] font-black" style={{ color: label }}>New custom look</Text>
            <Text className="text-[13px] mb-4" style={{ color: sub }}>
              Any colors: a school, a business, a party.
            </Text>

            <Text className="text-[11px] font-black tracking-widest mb-2 uppercase" style={{ color: sub }}>Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="e.g. Plant City High"
              placeholderTextColor={sub}
              maxLength={28}
              accessibilityLabel="Look name"
              className="rounded-[14px] px-4 text-[14px]"
              style={{ minHeight: 48, color: label, backgroundColor: fill }}
            />

            <DuskPreview colors={usable} pattern={pattern} />

            <Text className="text-[11px] font-black tracking-widest mb-1 mt-4 uppercase" style={{ color: sub }}>
              Colors · up to {MAX_CUSTOM_COLORS}
            </Text>

            <View className="flex-row flex-wrap" style={{ gap: 12, marginTop: 10 }}>
              {colors.map((c, i) => (
                <View key={`${c}-${i}`}>
                  <TouchableOpacity
                    onPress={() => openPicker(i)}
                    accessibilityLabel={`Edit color ${i + 1}`}
                    className="rounded-[12px]"
                    style={{
                      width: 46, height: 46, backgroundColor: c,
                      borderWidth: 2,
                      borderColor: editing === i && pickerOpen ? GREEN : 'rgba(0,0,0,0.08)',
                    }}
                  />
                  <TouchableOpacity
                    onPress={() => {
                      setColors(colors.filter((_, j) => j !== i));
                      if (editing === i) closePicker();
                    }}
                    accessibilityLabel={`Remove color ${i + 1}`}
                    className="absolute items-center justify-center rounded-full"
                    style={{
                      top: -8, right: -8, width: 22, height: 22,
                      backgroundColor: '#59616C', borderWidth: 2, borderColor: isDark ? '#1E1E1E' : '#fff',
                    }}
                  >
                    <Icon name="close" size={11} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}

              {/*
                ⚠️ Disabled at MAX_CUSTOM_COLORS rather than hidden. A plus that
                vanishes at the limit reads as a glitch; a greyed one that stays
                put says the limit is the limit.
              */}
              <TouchableOpacity
                onPress={() => openPicker(null)}
                disabled={full}
                accessibilityRole="button"
                accessibilityLabel="Add color"
                accessibilityState={{ disabled: full }}
                className="items-center justify-center rounded-[12px]"
                style={{
                  width: 46, height: 46, borderWidth: 2, borderStyle: 'dashed',
                  borderColor: full ? (isDark ? '#2A2F36' : '#DFE3E8') : GREEN,
                  backgroundColor: isDark ? 'transparent' : '#fff',
                }}
              >
                <Icon name="plus" size={22} color={full ? sub : GREEN} />
              </TouchableOpacity>
            </View>

            {full && (
              <Text className="text-[12px] mt-2.5" style={{ color: sub }}>
                That&apos;s all {MAX_CUSTOM_COLORS} colors. Remove one to swap it out.
              </Text>
            )}

            {/* ── The colour picker card ──────────────────────────────────── */}
            {pickerOpen && (
              <View className="rounded-[16px] p-4 mt-3.5" style={{ backgroundColor: fill }}>
                <View className="flex-row items-center mb-2" style={{ gap: 14 }}>
                  <View
                    className="rounded-[14px]"
                    style={{ width: 54, height: 54, backgroundColor: current, borderWidth: 2, borderColor: 'rgba(0,0,0,0.1)' }}
                  />
                  <View className="flex-1">
                    <Text className="text-[20px] font-black" style={{ color: label, letterSpacing: 0.4 }}>
                      {current}
                    </Text>
                    <Text
                      className="text-[13px]"
                      style={{ color: tooDark ? '#FFAB00' : sub, fontWeight: tooDark ? '700' : 'normal' }}
                    >
                      {tooDark ? 'Too dark to glow. Go brighter.' : 'Drag the wheel, then set light or dark'}
                    </Text>
                  </View>
                </View>

                <View className="items-center" style={{ marginTop: 10, marginBottom: 6 }}>
                  <View
                    {...wheelPan.panHandlers}
                    ref={wheelRef}
                    // Measured in window coordinates because the gesture is
                    // tracked by pageX/pageY — see the responders above. Measured
                    // on layout AND on each grant, since the sheet scrolls and a
                    // stale origin would offset every hue by the scroll distance.
                    onLayout={measureWheel}
                    style={{ width: WHEEL, height: WHEEL }}
                  >
                    <HueWheel />
                    {/* Shows where on the wheel the current colour sits — without it
                        the wheel gives no feedback once you lift your finger. */}
                    <View
                      pointerEvents="none"
                      className="absolute rounded-full"
                      style={{
                        width: KNOB, height: KNOB, left: knobLeft, top: knobTop,
                        borderWidth: 3, borderColor: '#fff', backgroundColor: current,
                      }}
                    />
                  </View>
                </View>

                {/* Brightness: Darker → Brighter, the wheel's missing third axis. */}
                <View className="flex-row items-center" style={{ gap: 10, marginTop: 6 }}>
                  <Text className="text-[12px] font-bold" style={{ color: sub }}>Darker</Text>
                  <View
                    {...brightnessPan.panHandlers}
                    ref={barRef}
                    onLayout={measureBar}
                    accessibilityLabel="Brightness"
                    className="flex-1 justify-center"
                    style={{ height: 32 }}
                  >
                    <View className="rounded-full overflow-hidden flex-row" style={{ height: 10 }}>
                      {/* A black → full-saturation ramp of the current hue. */}
                      {Array.from({ length: 24 }).map((_, i) => (
                        <View
                          key={i}
                          style={{ flex: 1, backgroundColor: hsvToHex(hsv.h, hsv.s, i / 23) }}
                        />
                      ))}
                    </View>
                    <View
                      pointerEvents="none"
                      className="absolute rounded-full"
                      style={{
                        width: 22, height: 22, left: `${brightness * 100}%`, marginLeft: -11,
                        backgroundColor: '#fff', borderWidth: 1, borderColor: 'rgba(0,0,0,0.2)',
                      }}
                    />
                  </View>
                  <Text className="text-[12px] font-bold" style={{ color: sub }}>Brighter</Text>
                </View>

                <View className="flex-row mt-3" style={{ gap: 10 }}>
                  <TouchableOpacity
                    onPress={closePicker}
                    accessibilityRole="button"
                    className="rounded-full items-center justify-center px-5"
                    style={{ minHeight: 46, borderWidth: 1, borderColor: isDark ? '#2A2F36' : '#DFE3E8' }}
                  >
                    <Text className="text-[15px] font-black" style={{ color: label }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={commit}
                    disabled={tooDark}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: tooDark }}
                    className="flex-1 rounded-full items-center justify-center"
                    style={{ minHeight: 46, backgroundColor: tooDark ? (isDark ? '#2A2F36' : '#DFE3E8') : GREEN }}
                  >
                    <Text className="text-[15px] font-black" style={{ color: tooDark ? sub : '#fff' }}>
                      {editing !== null ? 'Update color' : 'Add color'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            <View style={{ height: 8 }} />
          </ScrollView>

          {/* Pinned: Save must be reachable without scrolling past an open picker. */}
          <View className="flex-row px-5 pt-3 pb-8" style={{ gap: 10 }}>
            <TouchableOpacity
              onPress={() => { reset(); onClose(); }}
              accessibilityRole="button"
              className="rounded-full items-center justify-center px-6"
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
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSave }}
              className="flex-1 rounded-full items-center justify-center"
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
