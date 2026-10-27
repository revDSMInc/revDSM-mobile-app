import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { activeWork, type OfflineLeadWork } from '../../utils/offline-lead-work';
import { getOfflineWork, subscribeOfflineWork } from '../../services/offlineLeadStore';
import { useIsOnline } from '../../hooks/useIsOnline';
import {
  SYNCING_BG,
  SYNCING_FG,
  SYNC_DONE_BG,
  SYNC_DONE_FG,
  SYNC_DONE_HOLD_MS,
  countSyncWork,
  syncBannerFor,
} from '../../utils/sync-banner';

/**
 * The sync strip: one line, same shape as `OfflineBanner`, stacked under it.
 *
 * Replaces the expandable pending-uploads CARD that used to sit on the lead list. See
 * `utils/sync-banner.ts` for why failures are silent here and live in Profile instead.
 */
export const SyncBanner: React.FC = () => {
  const [items, setItems] = useState<OfflineLeadWork[]>(() => activeWork(getOfflineWork()));
  const online = useIsOnline();

  useEffect(() => subscribeOfflineWork(() => setItems(activeWork(getOfflineWork()))), []);

  const counts = countSyncWork(items);

  /**
   * Did a sync finish while the rep was watching?
   *
   * ⚠️ Tracked rather than derived: an empty queue on a cold start is the normal state, not a
   * completed sync, and greeting the rep with "Syncing done" for work they never saw start
   * teaches them to ignore the strip.
   */
  const [justFinished, setJustFinished] = useState(false);
  const wasPending = useRef(counts.pending > 0);

  useEffect(() => {
    const had = wasPending.current;
    wasPending.current = counts.pending > 0;
    if (!had || counts.pending !== 0) return;
    setJustFinished(true);
    const t = setTimeout(() => setJustFinished(false), SYNC_DONE_HOLD_MS);
    return () => clearTimeout(t);
  }, [counts.pending]);

  const copy = syncBannerFor(counts, justFinished, online);
  if (copy.tone === 'none') return null;

  const done = copy.tone === 'done';
  const fg = done ? SYNC_DONE_FG : SYNCING_FG;

  return (
    <View style={[styles.bar, { backgroundColor: done ? SYNC_DONE_BG : SYNCING_BG }]}>
      {done ? (
        <Icon name={copy.icon} size={15} color={fg} />
      ) : (
        <ActivityIndicator size="small" color={fg} />
      )}
      <Text style={[styles.text, { color: fg }]} numberOfLines={1}>
        {copy.title}
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
