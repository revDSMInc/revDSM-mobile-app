import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useNetworkStatus } from '../../hooks/useIsOnline';
import {
  BANNER_RECOVER_MS,
  BANNER_WORSEN_MS,
  OFFLINE_BG,
  OFFLINE_FG,
  UNSTABLE_BG,
  UNSTABLE_FG,
  bannerFor,
  shouldSwitchBanner,
  type BannerTone,
} from '../../utils/connection-banner';

/**
 * The connection strip. Three states: nothing, weak, offline.
 *
 * ⚠️ "Weak" is the one that matters. A rep on one bar used to get NO strip at all, because the
 * app saw itself as online - so a stalled screen looked like a broken app rather than a bad
 * signal. Naming the state is most of the fix; see `utils/connection-banner.ts`.
 */
export const OfflineBanner: React.FC = () => {
  const status = useNetworkStatus();
  const target = bannerFor(status).tone;
  const [shown, setShown] = useState<BannerTone>(target);
  const since = useRef({ tone: target, at: Date.now() });

  useEffect(() => {
    if (target !== since.current.tone) since.current = { tone: target, at: Date.now() };
    if (target === shown) return;

    // Held long enough already (a slow render, or a state that settled before mount).
    if (shouldSwitchBanner(shown, target, Date.now() - since.current.at)) {
      setShown(target);
      return;
    }
    // ⚠️ Asymmetric: warn fast, recover slowly. Clearing a warning while the line is still
    // flapping is what makes a strip nobody trusts.
    const wait = shouldSwitchBanner(shown, target, BANNER_WORSEN_MS) ? BANNER_WORSEN_MS : BANNER_RECOVER_MS;
    const t = setTimeout(() => setShown(target), Math.max(0, wait - (Date.now() - since.current.at)));
    return () => clearTimeout(t);
  }, [target, shown]);

  if (shown === 'none') return null;

  const offline = shown === 'offline';
  const copy = bannerFor(offline ? 'offline' : 'degraded');
  const fg = offline ? OFFLINE_FG : UNSTABLE_FG;

  return (
    <View style={[styles.bar, { backgroundColor: offline ? OFFLINE_BG : UNSTABLE_BG }]}>
      <Icon name={copy.icon} size={15} color={fg} />
      {/* One weight, one colour, as the original bar had - a bold/regular split inside a
          11pt line reads as two messages rather than one.

          ⚠️ ONE LINE ON EVERY PHONE. This was `numberOfLines={2}` with a title + detail
          sentence, which wrapped on a 320pt iPhone SE and made the strip change height - the
          screen under it jumped every time the link flapped. `adjustsFontSizeToFit` shrinks the
          longest copy on the narrowest device instead of wrapping it, and `minimumFontScale`
          stops it shrinking into illegibility. Keep copy under `BANNER_MAX_CHARS`. */}
      <Text
        style={[styles.text, { color: fg }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {copy.detail ? `${copy.title}. ${copy.detail}` : copy.title}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  text: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
  },
});
