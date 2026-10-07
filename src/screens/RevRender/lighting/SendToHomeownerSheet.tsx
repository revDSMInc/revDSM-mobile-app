import React, { useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LeadService } from '../../../services/api/leads';

const GREEN = '#2EDE56';

export interface ShareableRender {
  runId: string;
  label: string;
  detail?: string;
}

export function SendToHomeownerSheet({
  visible,
  renders,
  leadId,
  defaultName,
  defaultPhone,
  defaultEmail,
  isDark,
  onClose,
  onSent,
}: {
  visible: boolean;
  renders: ShareableRender[];
  leadId?: string;
  defaultName?: string;
  defaultPhone?: string;
  defaultEmail?: string;
  isDark: boolean;
  onClose: () => void;
  onSent?: (result: { shareId: string; link: string; sent: boolean }) => void;
}) {
  const [channel, setChannel] = useState<'sms' | 'email'>('sms');
  const [name, setName] = useState(defaultName ?? '');
  const [phone, setPhone] = useState(defaultPhone ?? '');
  const [email, setEmail] = useState(defaultEmail ?? '');
  const [included, setIncluded] = useState<string[]>(renders.map((r) => r.runId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const sub = isDark ? '#919EAB' : '#637381';
  const label = isDark ? '#fff' : '#212B36';
  const field = { minHeight: 48, color: label, backgroundColor: isDark ? '#15191E' : '#F4F6F8' };

  React.useEffect(() => {
    if (visible) {
      setIncluded(renders.map((r) => r.runId));
      setError(null);
      setWarning(null);
    }
  }, [visible, renders]);

  const canSend =
    included.length > 0 &&
    !busy &&
    (channel === 'sms' ? phone.trim().length > 0 : email.trim().length > 0);

  const send = async () => {
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const { data } = await LeadService.shareRevRenders({
        leadId,
        runIds: included,
        channel,
        recipientName: name.trim() || undefined,
        ...(channel === 'sms' ? { recipientPhone: phone.trim() } : { recipientEmail: email.trim() }),
      });

      if (data?.sent === false) {
        setWarning(data?.deliveryError || 'Could not deliver — the link was created, try again.');
        onSent?.({ shareId: data.shareId, link: data.link, sent: false });
      } else {
        onSent?.({ shareId: data.shareId, link: data.link, sent: true });
        onClose();
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not send. Check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  const Toggle = ({ value, text }: { value: 'sms' | 'email'; text: string }) => (
    <TouchableOpacity
      onPress={() => setChannel(value)}
      accessibilityRole="tab"
      accessibilityState={{ selected: channel === value }}
      className="flex-1 items-center justify-center rounded-full"
      style={{ minHeight: 44, backgroundColor: channel === value ? GREEN : 'transparent' }}
    >
      <Text className="text-[14px] font-black" style={{ color: channel === value ? '#fff' : sub }}>{text}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
        <View className="rounded-t-[24px] px-5 pt-3 pb-8" style={{ backgroundColor: isDark ? '#1E1E1E' : '#fff', maxHeight: '90%' }}>
          <View className="items-center mb-3">
            <View className="rounded-full" style={{ width: 36, height: 4, backgroundColor: sub }} />
          </View>

          <Text className="text-[19px] font-black" style={{ color: label }}>Send to homeowner</Text>
          <Text className="text-[13px] mb-4" style={{ color: sub }}>They get a link to view their renders</Text>

          <View className="flex-row rounded-full p-1 mb-4" style={{ backgroundColor: isDark ? '#15191E' : '#F4F6F8' }}>
            <Toggle value="sms" text="Text" />
            <Toggle value="email" text="Email" />
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            <Text className="text-[11px] font-black tracking-widest mb-2 uppercase" style={{ color: sub }}>Name</Text>
            <TextInput
              value={name} onChangeText={setName}
              placeholder="Customer name" placeholderTextColor={sub}
              accessibilityLabel="Customer name"
              className="rounded-[14px] px-4 mb-4 text-[14px]" style={field}
            />

            {channel === 'sms' ? (
              <>
                <Text className="text-[11px] font-black tracking-widest mb-2 uppercase" style={{ color: sub }}>Mobile number</Text>
                <TextInput
                  value={phone} onChangeText={setPhone}
                  placeholder="(813) 555-0123" placeholderTextColor={sub}
                  keyboardType="phone-pad" accessibilityLabel="Mobile number"
                  className="rounded-[14px] px-4 mb-4 text-[14px]" style={field}
                />
              </>
            ) : (
              <>
                <Text className="text-[11px] font-black tracking-widest mb-2 uppercase" style={{ color: sub }}>Email</Text>
                <TextInput
                  value={email} onChangeText={setEmail}
                  placeholder="name@email.com" placeholderTextColor={sub}
                  keyboardType="email-address" autoCapitalize="none" accessibilityLabel="Email address"
                  className="rounded-[14px] px-4 mb-4 text-[14px]" style={field}
                />
              </>
            )}

            <Text className="text-[11px] font-black tracking-widest mb-2 uppercase" style={{ color: sub }}>
              Renders to include
            </Text>
            {renders.map((r, i) => {
              const on = included.includes(r.runId);
              return (
                <TouchableOpacity
                  key={r.runId}
                  onPress={() => setIncluded(on ? included.filter((id) => id !== r.runId) : [...included, r.runId])}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  className="flex-row items-center mb-3"
                  style={{ minHeight: 44 }}
                >
                  <View
                    className="items-center justify-center rounded-md mr-3"
                    style={{ width: 24, height: 24, backgroundColor: on ? GREEN : 'transparent', borderWidth: on ? 0 : 1.5, borderColor: sub }}
                  >
                    {on && <Icon name="check" size={16} color="#fff" />}
                  </View>
                  <View className="flex-1">
                    <Text className="text-[14px] font-bold" style={{ color: label }}>{i + 1} · {r.label}</Text>
                    {!!r.detail && <Text className="text-[12px]" style={{ color: sub }}>{r.detail}</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}

            {!!warning && (
              <View className="rounded-[14px] p-3 mb-2" style={{ backgroundColor: '#FFAB0022' }}>
                <Text className="text-[12px]" style={{ color: '#B76E00' }}>{warning}</Text>
              </View>
            )}
            {!!error && (
              <View className="rounded-[14px] p-3 mb-2" style={{ backgroundColor: '#FF563022' }}>
                <Text className="text-[12px]" style={{ color: '#B71D18' }}>{error}</Text>
              </View>
            )}
          </ScrollView>

          <View className="flex-row mt-3">
            <TouchableOpacity
              onPress={onClose} disabled={busy}
              className="flex-1 mr-2 rounded-full items-center justify-center"
              style={{ minHeight: 50, borderWidth: 1, borderColor: isDark ? '#2A2F36' : '#DFE3E8' }}
            >
              <Text className="text-[15px] font-black" style={{ color: label }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={send} disabled={!canSend}
              className="flex-1 ml-2 rounded-full items-center justify-center flex-row"
              style={{ minHeight: 50, backgroundColor: canSend ? GREEN : isDark ? '#2A2F36' : '#DFE3E8' }}
            >
              {busy && <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />}
              <Text className="text-[15px] font-black" style={{ color: canSend ? '#fff' : sub }}>
                {busy ? 'Sending…' : `Send ${included.length} render${included.length === 1 ? '' : 's'}`}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}
