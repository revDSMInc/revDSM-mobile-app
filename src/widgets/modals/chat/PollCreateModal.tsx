import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useBottomInset } from '../../../hooks/useBottomInset';
import { FlashMessage } from '../../../config/message';
import {
  emptyPollDraft,
  pollDraftError,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_OPTION_MAX,
  POLL_QUESTION_MAX,
  PollDraft,
} from '../../../utils/poll-draft';

const SHEET_BG = '#1C1C1E';
const CARD_BG = '#262628';
const MUTED = 'rgba(255,255,255,0.55)';
const GREEN = '#30D158';

interface PollCreateModalProps {
  visible: boolean;
  onClose: () => void;
}

// ⚠️ DISPLAY ONLY. Send validates the draft and then says the backend is not ready; nothing is posted.
// The contract for the backend is docs/team-channel-polls-backend.md. When it ships, replace
// `handleSend`'s notice with a call to ChatService and close the sheet on success.
export const PollCreateModal = ({ visible, onClose }: PollCreateModalProps) => {
  const [draft, setDraft] = useState<PollDraft>(emptyPollDraft);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height } = useWindowDimensions();
  const bottomInset = useBottomInset();
  const optionRefs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    if (!visible) {
      setDraft(emptyPollDraft());
      setKeyboardHeight(0);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, (e) => setKeyboardHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [visible]);

  const setOption = useCallback((index: number, value: string) => {
    setDraft((d) => {
      const options = d.options.slice();
      options[index] = value;
      return { ...d, options };
    });
  }, []);

  const addOption = useCallback(() => {
    setDraft((d) => (d.options.length >= POLL_MAX_OPTIONS ? d : { ...d, options: [...d.options, ''] }));
    // Focus the new row once it has mounted.
    setTimeout(() => optionRefs.current[optionRefs.current.length - 1]?.focus(), 80);
  }, []);

  const removeOption = useCallback((index: number) => {
    setDraft((d) =>
      d.options.length <= POLL_MIN_OPTIONS ? d : { ...d, options: d.options.filter((_, i) => i !== index) },
    );
    optionRefs.current.splice(index, 1);
  }, []);

  const handleSend = useCallback(() => {
    const error = pollDraftError(draft);
    if (error) {
      FlashMessage.warning('Poll is incomplete', error);
      return;
    }
    Keyboard.dismiss();
    FlashMessage.info(
      'Backend work is required first',
      'Polls cannot be sent yet. This screen is a preview until the backend supports poll messages.',
    );
  }, [draft]);

  const lift = Math.max(keyboardHeight - bottomInset, 0);
  const sheetHeight = Math.min(height * 0.92, height - 40);
  const canSend = !pollDraftError(draft);

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent onRequestClose={onClose}>
      <View style={StyleSheet.absoluteFill}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close poll creator" />
        <View style={[styles.sheet, { maxHeight: sheetHeight, marginBottom: lift }]}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
              <Icon name="close" size={26} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.title}>Create poll</Text>
            <TouchableOpacity
              onPress={handleSend}
              style={[styles.sendBtn, !canSend && styles.sendBtnDim]}
              accessibilityRole="button"
            >
              <Text style={styles.sendText}>Send</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.body, { paddingBottom: (lift > 0 ? 0 : bottomInset) + 16 }]}
          >
            <Text style={styles.label}>QUESTION</Text>
            <View style={styles.card}>
              <TextInput
                value={draft.question}
                onChangeText={(question) => setDraft((d) => ({ ...d, question }))}
                placeholder="Ask question"
                placeholderTextColor={MUTED}
                style={styles.input}
                maxLength={POLL_QUESTION_MAX}
                multiline
                returnKeyType="next"
                blurOnSubmit
                onSubmitEditing={() => optionRefs.current[0]?.focus()}
              />
            </View>

            <Text style={[styles.label, styles.labelGap]}>OPTIONS</Text>
            <View style={styles.card}>
              {draft.options.map((opt, i) => (
                <View key={i} style={[styles.optionRow, i > 0 && styles.optionDivider]}>
                  <TextInput
                    ref={(r) => {
                      optionRefs.current[i] = r;
                    }}
                    value={opt}
                    onChangeText={(v) => setOption(i, v)}
                    placeholder="Add"
                    placeholderTextColor={MUTED}
                    style={styles.optionInput}
                    maxLength={POLL_OPTION_MAX}
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() => optionRefs.current[i + 1]?.focus()}
                  />
                  {draft.options.length > POLL_MIN_OPTIONS && (
                    <TouchableOpacity onPress={() => removeOption(i)} hitSlop={10} accessibilityLabel="Remove option">
                      <Icon name="close-circle" size={22} color={MUTED} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {draft.options.length < POLL_MAX_OPTIONS && (
                <TouchableOpacity
                  onPress={addOption}
                  style={[styles.optionRow, styles.optionDivider]}
                  accessibilityRole="button"
                  accessibilityLabel="Add option"
                >
                  <Icon name="add-circle" size={22} color={GREEN} />
                  <Text style={styles.addText}>Add option</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.hint}>
              {draft.options.length} of {POLL_MAX_OPTIONS} options · at least {POLL_MIN_OPTIONS} needed
            </Text>

            <View style={[styles.card, styles.toggleRow]}>
              <Text style={styles.toggleText}>Allow multiple answers</Text>
              <Switch
                value={draft.allowMultiple}
                onValueChange={(allowMultiple) => setDraft((d) => ({ ...d, allowMultiple }))}
                trackColor={{ false: '#39393D', true: GREEN }}
                thumbColor="#fff"
                ios_backgroundColor="#39393D"
              />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: { backgroundColor: SHEET_BG, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 8,
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CARD_BG,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  title: { color: '#fff', fontSize: 18, fontWeight: '700' },
  sendBtn: {
    height: 44,
    minWidth: 76,
    paddingHorizontal: 18,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#48484A',
  },
  sendBtnDim: { opacity: 0.6 },
  sendText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  body: { paddingHorizontal: 12, paddingTop: 8 },
  label: { color: MUTED, fontSize: 13, letterSpacing: 0.5, marginLeft: 8, marginBottom: 8 },
  labelGap: { marginTop: 22 },
  card: { backgroundColor: CARD_BG, borderRadius: 22, paddingHorizontal: 18 },
  input: { color: '#fff', fontSize: 17, minHeight: 56, paddingVertical: 14 },
  optionRow: { flexDirection: 'row', alignItems: 'center', minHeight: 56 },
  optionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.18)' },
  optionInput: { flex: 1, color: '#fff', fontSize: 17, paddingVertical: 14 },
  addText: { color: GREEN, fontSize: 17, marginLeft: 10 },
  hint: { color: MUTED, fontSize: 12, marginLeft: 8, marginTop: 8 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 24,
    minHeight: 62,
  },
  toggleText: { color: '#fff', fontSize: 17 },
});
