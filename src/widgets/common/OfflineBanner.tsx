import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useIsOnline } from '../../hooks/useIsOnline';

/**
 * The app's ONE offline indicator.
 *
 * Rendered from `MainHeader`, directly under the header bar, so every authenticated screen gets it
 * without opting in. That placement is the point: before this, a rep only learned they had no
 * signal by tapping something and watching it fail, and each screen reported that differently —
 * a flash here, a silent empty list there, a spinner that never resolved somewhere else.
 *
 * ⚠️ Do NOT add a second offline indicator to an individual screen. A screen that needs to say
 * something more specific ("this lead was never opened while connected") should say that in its own
 * empty state; the fact of being offline is stated here, once.
 */
export const OfflineBanner: React.FC = () => {
  const online = useIsOnline();

  if (online) return null;

  return (
    <View style={styles.bar}>
      <Icon name="cloud-off-outline" size={15} color="#7A4100" />
      <Text style={styles.text}>Offline — showing saved data. Changes will sync when you reconnect.</Text>
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
    // Amber, matching the app's existing "attention, not failure" treatment (the pending-addendum
    // header). Offline is a state to be aware of, not an error the rep caused.
    backgroundColor: '#FFF1C6',
  },
  text: {
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '600',
    color: '#7A4100',
  },
});
