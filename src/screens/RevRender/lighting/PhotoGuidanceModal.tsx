import React from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { RenderMode } from './ModeSwitch';

const GREEN = '#2EDE56';

const ON_GREEN = '#161C24';

const BADGE_BG = 'rgba(22,28,36,0.88)';

const CORNER_SIZE = 22;
const CORNER_WIDTH = 3;
const CORNER_RADIUS = 6;
const CORNER_INSET = 6;
const BADGE_INSET = CORNER_INSET + CORNER_SIZE + 6;

const CORNERS = [
  {
    key: 'tl',
    position: { top: CORNER_INSET, left: CORNER_INSET, borderTopLeftRadius: CORNER_RADIUS },
    edges: { borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderBottomWidth: 0, borderRightWidth: 0 },
  },
  {
    key: 'tr',
    position: { top: CORNER_INSET, right: CORNER_INSET, borderTopRightRadius: CORNER_RADIUS },
    edges: { borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderBottomWidth: 0, borderLeftWidth: 0 },
  },
  {
    key: 'bl',
    position: { bottom: CORNER_INSET, left: CORNER_INSET, borderBottomLeftRadius: CORNER_RADIUS },
    edges: { borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderTopWidth: 0, borderRightWidth: 0 },
  },
  {
    key: 'br',
    position: { bottom: CORNER_INSET, right: CORNER_INSET, borderBottomRightRadius: CORNER_RADIUS },
    edges: { borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderTopWidth: 0, borderLeftWidth: 0 },
  },
] as const;

const CORE_EXAMPLES = [
  { src: require('../../../assets/images/revrender-guidance/core-corner-downspout.png'), caption: 'Corner + downspout' },
  { src: require('../../../assets/images/revrender-guidance/core-gutter-fascia-soffit.png'), caption: 'Gutter, fascia, soffit' },
];
const LIGHTING_EXAMPLE = require('../../../assets/images/revrender-guidance/lighting-full-home.png');

export function PhotoGuidanceModal({
  mode,
  visible,
  isDark,
  onGotIt,
  onNeverShowAgain,
}: {
  mode: RenderMode;
  visible: boolean;
  isDark: boolean;
  onGotIt: () => void;
  onNeverShowAgain: () => void;
}) {
  const isCore = mode === 'core';
  const copy = isCore
    ? {
        title: 'Get in close for best results',
        body: 'For core products, take close-up photos of the roofline, angled up from below, so the gutter, fascia and soffit fill the frame.',
      }
    : {
        title: 'Zoom out for best results',
        body: 'Take your roofline lighting photos zoomed out, with the full view of the home in the frame.',
      };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onGotIt}>
      <View className="flex-1 items-center justify-center px-8" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <View
          className="w-full rounded-[20px] p-5"
          style={{ backgroundColor: isDark ? '#1E1E1E' : '#fff' }}
        >
          {isCore ? (
            <View className="flex-row mb-4" style={{ gap: 10 }}>
              {CORE_EXAMPLES.map((ex) => (
                <View key={ex.caption} className="flex-1">
                  <Image
                    source={ex.src}
                    resizeMode="cover"
                    className="w-full rounded-xl"
                    style={{ height: 150, backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8' }}
                  />
                  <View className="flex-row items-center justify-center mt-2" style={{ gap: 4 }}>
                    <Icon name="check" size={13} color="#2EDE56" />
                    <Text
                      className="text-[11px] font-bold flex-1"
                      style={{ color: isDark ? '#919EAB' : '#637381' }}
                    >
                      {ex.caption}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View className="mb-4">
              <Image
                source={LIGHTING_EXAMPLE}
                resizeMode="cover"
                className="w-full rounded-xl"
                style={{ height: 220, backgroundColor: isDark ? '#2A2A2A' : '#F4F6F8' }}
              />

              {/*
                ⚠️ `pointerEvents="none"` on the whole overlay. These are
                decoration drawn ON TOP of the image; without it the corners and
                the badge would silently eat taps in those spots — which matters
                because the card below them is a dismissible tip.
              */}
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                {CORNERS.map((corner) => (
                  <View
                    key={corner.key}
                    className="absolute"
                    style={{
                      width: CORNER_SIZE,
                      height: CORNER_SIZE,
                      borderColor: GREEN,
                      shadowColor: '#000',
                      shadowOpacity: 0.45,
                      shadowRadius: 3,
                      shadowOffset: { width: 0, height: 1 },
                      elevation: 3,
                      ...corner.edges,
                      ...corner.position,
                    }}
                  />
                ))}

                <View
                  className="absolute rounded-full px-3 py-1.5"
                  style={{ top: CORNER_INSET, left: BADGE_INSET, backgroundColor: BADGE_BG }}
                >
                  <Text className="text-[11px] font-black text-white">Full home in frame</Text>
                </View>
              </View>
            </View>
          )}

          <Text
            className="text-[17px] font-black text-center mb-2"
            style={{ color: isDark ? '#fff' : '#212B36' }}
          >
            {copy.title}
          </Text>

          <Text
            className="text-[13px] text-center mb-5"
            style={{ color: isDark ? '#919EAB' : '#637381', lineHeight: 19 }}
          >
            {copy.body}
          </Text>

          <TouchableOpacity
            onPress={onGotIt}
            accessibilityRole="button"
            className="rounded-[14px] items-center justify-center mb-2"
            style={{ minHeight: 48, backgroundColor: GREEN }}
          >
            <Text className="text-[15px] font-black" style={{ color: ON_GREEN }}>
              Got it
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onNeverShowAgain}
            accessibilityRole="button"
            className="items-center justify-center"
            style={{ minHeight: 44 }}
          >
            <Text className="text-[13px] font-bold" style={{ color: isDark ? '#919EAB' : '#637381' }}>
              Got it, don&apos;t show me this again
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
