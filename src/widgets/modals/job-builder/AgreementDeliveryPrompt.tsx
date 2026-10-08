import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LeadService } from '../../../services/api/leads';
import { isNetworkError } from '../../../utils/network-error';
import { isOnline } from '../../../services/connectivity';
import {
  queueDeliveryPreference,
  queuedDeliveryPreference,
} from '../../../services/offlineAgreementDelivery';
import {
  DeliveryChannel,
  DeliveryPreferenceForm,
  buildDeliveryPayload,
  canSaveDelivery,
  deliveryFormError,
  deliveryRecipientName,
  formatDeliveryPhone,
  initialDeliveryForm,
} from '../../../utils/agreement-delivery';

interface AgreementDeliveryPromptProps {
  visible: boolean;
  leadId: string;
  customerDetails?: any;
  onCancel: () => void;
  onConfirmed: () => void;
  inline?: boolean;
}

const GREEN = '#4CBB17';
const INK = '#1C252E';
const MUTED = '#637381';
const FIELD_BORDER = '#919EAB33';
const ERROR = '#FF5630';

export function AgreementDeliveryPrompt({
  visible,
  leadId,
  customerDetails,
  onCancel,
  onConfirmed,
  inline = false,
}: AgreementDeliveryPromptProps) {
  const [form, setForm] = useState<DeliveryPreferenceForm>({ channel: 'email', phone: '', email: '' });
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (!visible) return;
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKbHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => {
      show.remove();
      hide.remove();
      setKbHeight(0);
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const fallback = {
      phone: customerDetails?.phone ?? customerDetails?.phoneNumber ?? customerDetails?.mobile,
      email: customerDetails?.email,
    };
    setServerError('');
    setTouched(false);
    setForm(initialDeliveryForm(null, fallback));
    setName(deliveryRecipientName(customerDetails?.firstName));
    if (!leadId) return;
    const queued = queuedDeliveryPreference(leadId);
    if (queued) setForm(initialDeliveryForm({ preference: queued }, fallback));
    // Offline: no GET to make. The form already holds the queued choice or the lead's own details.
    if (!isOnline()) return;
    setLoading(true);
    LeadService.getAgreementDeliveryPreference(leadId)
      .then((res) => {
        if (cancelled) return;
        const body = res?.data?.data ?? res?.data;
        setForm(initialDeliveryForm(body, fallback));
        setName(deliveryRecipientName(body?.prefill?.name, customerDetails?.firstName));
      })
      .catch(() => {
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, leadId]);

  const isText = form.channel === 'text';
  const error = deliveryFormError(form);
  const canSend = canSaveDelivery(form) && !saving && !loading;

  const setChannel = (channel: DeliveryChannel) => {
    setForm((f) => ({ ...f, channel }));
    setServerError('');
    setTouched(false);
  };

  const handleSend = async () => {
    if (!canSaveDelivery(form)) {
      setTouched(true);
      return;
    }
    const payload = buildDeliveryPayload(form);
    // This prompt gates Generate Agreement, so it must never hold the sale for a network call.
    if (!isOnline()) {
      queueDeliveryPreference(leadId, payload);
      onConfirmed();
      return;
    }
    setSaving(true);
    setServerError('');
    try {
      await LeadService.saveAgreementDeliveryPreference(leadId, payload);
      onConfirmed();
    } catch (e: any) {
      if (isNetworkError(e)) {
        queueDeliveryPreference(leadId, payload);
        onConfirmed();
        return;
      }
      setServerError(
        e?.message || "Couldn't save how to send the copy. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const card = (
    <View style={[styles.backdrop, { paddingBottom: kbHeight }]}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={2}>
            Send Signed Agreement
          </Text>
          <TouchableOpacity onPress={onCancel} style={styles.closeBtn} hitSlop={8}>
            <Icon name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" bounces={false} contentContainerStyle={styles.body}>
          <Text style={styles.question}>How would {name || 'the homeowner'} like a copy of the signed agreement?</Text>

          <View style={styles.channels}>
            <ChannelButton
              label="Email"
              icon="email-outline"
              active={!isText}
              onPress={() => setChannel('email')}
            />
            <ChannelButton
              label="Text"
              icon="message-outline"
              active={isText}
              onPress={() => setChannel('text')}
            />
          </View>

          <Text style={styles.fieldLabel}>{isText ? 'Phone Number' : 'Email Address'}</Text>
          <View style={[styles.field, (touched && !!error) || !!serverError ? styles.fieldError : null]}>
            {isText && <Text style={styles.prefix}>+1</Text>}
            <TextInput
              ref={inputRef}
              key={form.channel}
              style={styles.input}
              value={isText ? form.phone : form.email}
              onChangeText={(t) => {
                setServerError('');
                setForm((f) =>
                  isText ? { ...f, phone: formatDeliveryPhone(t) } : { ...f, email: t }
                );
              }}
              onBlur={() => setTouched(true)}
              placeholder={isText ? '(555) 123-4567' : 'homeowner@email.com'}
              placeholderTextColor="#919EAB"
              keyboardType={isText ? 'phone-pad' : 'email-address'}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={isText ? 14 : undefined}
            />
            <TouchableOpacity onPress={() => inputRef.current?.focus()} hitSlop={10}>
              <Icon name="pencil-outline" size={20} color={MUTED} />
            </TouchableOpacity>
          </View>
          {(touched && !!error) || !!serverError ? (
            <Text style={styles.errorText}>{serverError || error}</Text>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity onPress={onCancel} style={styles.backBtn} disabled={saving}>
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSend}
              disabled={!canSend}
              style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
            >
              {saving || loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.sendText, !canSend && { color: '#919EABCC' }]}>Send via {isText ? 'Text' : 'Email'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </View>
  );

  if (!visible) return null;
  if (inline) return <View style={StyleSheet.absoluteFill}>{card}</View>;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      {card}
    </Modal>
  );
}

function ChannelButton({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.channelBtn, active ? styles.channelActive : styles.channelIdle]}
    >
      <Icon name={icon} size={20} color={active ? '#fff' : INK} />
      <Text style={[styles.channelText, { color: active ? '#fff' : INK }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 24,
    overflow: 'hidden',
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: GREEN,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  title: { flex: 1, color: '#fff', fontSize: 18, fontWeight: '900' },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.28)',
    marginLeft: 12,
  },
  body: { padding: 20 },
  question: { fontSize: 15, fontWeight: '800', color: INK, lineHeight: 22 },
  channels: { flexDirection: 'row', gap: 12, marginTop: 18 },
  channelBtn: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  channelActive: { backgroundColor: GREEN },
  channelIdle: { backgroundColor: '#fff', borderWidth: 1, borderColor: FIELD_BORDER },
  channelText: { fontSize: 14, fontWeight: '900', letterSpacing: 0.3 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 20,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: FIELD_BORDER,
    backgroundColor: '#fff',
    paddingHorizontal: 14,
  },
  fieldError: { borderColor: ERROR },
  prefix: { fontSize: 14, fontWeight: '700', color: MUTED, marginRight: 6, includeFontPadding: false },
  input: { flex: 1, fontSize: 14, fontWeight: 'normal', color: INK, paddingVertical: 0 },
  errorText: { marginTop: 6, fontSize: 11, color: ERROR, fontWeight: '700' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 28 },
  backBtn: {
    height: 54,
    paddingHorizontal: 24,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: FIELD_BORDER,
  },
  backText: { fontSize: 14, fontWeight: '900', color: INK, letterSpacing: 0.3 },
  sendBtn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
  },
  sendBtnDisabled: { backgroundColor: '#919EAB33' },
  sendText: { fontSize: 14, fontWeight: '900', color: '#fff', letterSpacing: 0.3 },
});
