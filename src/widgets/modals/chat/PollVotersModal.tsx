import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { TouchableOpacity } from 'react-native';
import ChatService from '../../../services/api/ChatService';
import { useBottomInset } from '../../../hooks/useBottomInset';

interface Props {
  /** The poll message to report on, or null when the sheet is closed. */
  messageId: string | null;
  onClose: () => void;
}

interface VoterRow {
  _id: string;
  fullName: string;
}

interface OptionRow {
  id: string;
  text: string;
  voters: VoterRow[];
}

/**
 * REVUIUX-577: "View votes" - each option with the people who chose it.
 *
 * Fetched when the sheet opens rather than carried on the message: a history
 * page never ships voter ids, so this endpoint is the only place names exist.
 */
export const PollVotersModal = ({ messageId, onClose }: Props) => {
  const [options, setOptions] = useState<OptionRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const bottomInset = useBottomInset();

  const load = useCallback(async (id: string) => {
    setOptions(null);
    setFailed(false);
    try {
      const rows = await ChatService.getChannelPollVoters(id);
      setOptions(
        (rows || []).map((o: any) => ({
          id: String(o?.id ?? ''),
          text: String(o?.text ?? ''),
          voters: (o?.voters || []).map((v: any) => ({
            _id: String(v?._id ?? ''),
            fullName:
              v?.fullName || `${v?.firstName || ''} ${v?.lastName || ''}`.trim() || 'Someone',
          })),
        })),
      );
    } catch (e) {
      console.warn('[PollVotersModal] failed to load voters:', e);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    if (messageId) load(messageId);
  }, [messageId, load]);

  return (
    <Modal
      visible={!!messageId}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close votes" />
        <View style={[styles.sheet, { paddingBottom: bottomInset + 12 }]}>
          <View style={styles.header}>
            <Text style={styles.title}>Votes</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Icon name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>

          {options === null && !failed && (
            <View style={styles.center}>
              <ActivityIndicator color="#30D158" />
            </View>
          )}
          {failed && (
            <View style={styles.center}>
              <Text style={styles.muted}>Could not load the votes. Close and try again.</Text>
            </View>
          )}
          {options !== null && (
            <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
              {options.map((option) => (
                <View key={option.id} style={styles.optionBlock}>
                  <View style={styles.optionHead}>
                    <Text style={styles.optionText} numberOfLines={2}>
                      {option.text}
                    </Text>
                    <Text style={styles.optionCount}>{option.voters.length}</Text>
                  </View>
                  {option.voters.length === 0 ? (
                    <Text style={styles.muted}>No votes</Text>
                  ) : (
                    option.voters.map((voter) => (
                      <Text key={`${option.id}:${voter._id}`} style={styles.voter}>
                        {voter.fullName}
                      </Text>
                    ))
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: '#1C1C1E',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    maxHeight: '75%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#262628',
  },
  center: { paddingVertical: 32, alignItems: 'center' },
  muted: { color: 'rgba(255,255,255,0.55)', fontSize: 14 },
  optionBlock: { marginBottom: 20 },
  optionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  optionText: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700' },
  optionCount: { color: 'rgba(255,255,255,0.55)', fontSize: 13, marginLeft: 10 },
  voter: { color: '#fff', fontSize: 15, paddingVertical: 5 },
});
