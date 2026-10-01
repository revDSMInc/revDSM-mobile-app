import React from 'react';
import { Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { RenderMode } from './ModeSwitch';

/** The app green, same token as the screen's own "+ Add Render Combo" CTA. */
const GREEN = '#2EDE56';

/**
 * ⚠️ The "Got it" label is BLACK on the green, not white.
 *
 * Every other green CTA in revRender uses white text, so this looks like a
 * slip and has already been "corrected" once. It is the design: at this green's
 * lightness, white sits around 1.9:1 contrast — legible on a big flat button
 * only because the text is heavy — while black clears 9:1. Do not re-sync it to
 * the other buttons.
 */
const ON_GREEN = '#161C24';

/** Dark pill behind the badge — the label sits over sky, which is too light for dark text. */
const BADGE_BG = 'rgba(22,28,36,0.88)';

/** Viewfinder bracket geometry. */
const CORNER_SIZE = 22;
const CORNER_WIDTH = 3;
const CORNER_RADIUS = 6;
/**
 * Brackets hug the image edge, which is what makes them read as a viewfinder
 * rather than a box floating inside the picture.
 */
const CORNER_INSET = 6;
/**
 * ⚠️ The badge clears the top-left bracket; it does not sit on top of it.
 *
 * Both started at the same inset and overlapped, which hid the corner behind
 * the pill — the brackets have to read as four matching marks, and three plus a
 * fragment reads as a rendering bug. Derived from the bracket rather than typed
 * as a second magic number, so moving the corners keeps the badge clear.
 */
const BADGE_INSET = CORNER_INSET + CORNER_SIZE + 6;

/**
 * The four viewfinder corners, each drawn as a box showing only its two
 * adjacent edges.
 *
 * ⚠️ A corner needs BOTH its edge widths AND the three others explicitly at 0.
 * RN's `borderWidth` shorthand is not being used here, and an unset edge
 * inherits nothing — but a `borderColor` with no width still renders nothing,
 * so a missing `0` shows up as a full box only once a sibling style sets a
 * width. Spelling all four out keeps each corner independent of render order.
 */
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

/** Real photos, so the rep matches a photo rather than reading a description. */
const CORE_EXAMPLES = [
  { src: require('../../../assets/images/revrender-guidance/core-corner-downspout.png'), caption: 'Corner + downspout' },
  { src: require('../../../assets/images/revrender-guidance/core-gutter-fascia-soffit.png'), caption: 'Gutter, fascia, soffit' },
];
const LIGHTING_EXAMPLE = require('../../../assets/images/revrender-guidance/lighting-full-home.png');

/**
 * First-time photo guidance when switching modes (Lance, REVUIUX-483 30 Sep).
 *
 * Core and Lighting want opposite photos: Core repaints a surface you need to
 * see in detail, Lighting runs a channel along the whole roofline and shifts the
 * scene to dusk, so it needs the house and sky in frame. Reps have been filling
 * the elevation slots with close-ups, which is right for Core and unusable for
 * Lighting.
 *
 * ⚠️ The examples carry the message, not the copy. A rep skims a tip and taps
 * through it; "get in close" means nothing until you have seen how close. The
 * two Core shots are deliberately ordinary field photos rather than clean
 * studio ones, so they read as "a photo like yours".
 *
 * "Don't show me this again" is PER REP ACCOUNT, not per device — so the
 * dismissal has to persist server-side. Until that endpoint exists the caller
 * can hold it locally, but it must not stay there.
 */
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
            // Two side-by-side examples, each with a ticked caption naming what
            // is in frame — the tick is what makes them read as "do this".
            <View className="flex-row mb-4" style={{ gap: 10 }}>
              {CORE_EXAMPLES.map((ex) => (
                <View key={ex.caption} className="flex-1">
                  <Image
                    source={ex.src}
                    // ⚠️ `cover` on a fixed box, not `contain`: these are
                    // portrait field photos and letterboxing them inside the
                    // card makes the roofline too small to learn anything from.
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
            // One wide example, inside viewfinder corners: the brackets say
            // "frame it like this" in the language of a camera, which is the
            // action being asked for, and the badge names the rule in words.
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
                      // ⚠️ A shadow, not for depth — for legibility. This green
                      // measures ~1.7:1 against both the illustration's sky and
                      // its road, and all four corners land on one or the other,
                      // so unshadowed the brackets wash out exactly where they
                      // carry the message. The dark edge gives them something to
                      // sit against without altering the design's colour.
                      shadowColor: '#000',
                      shadowOpacity: 0.45,
                      shadowRadius: 3,
                      shadowOffset: { width: 0, height: 1 },
                      elevation: 3,
                      // Two adjacent edges per corner — a bracket, not a box.
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
