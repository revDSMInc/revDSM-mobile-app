import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import { FUND } from './funding-theme';
import { FlashMessage } from '../../../../config/message';
import { formatLocalUSPhone, toE164USPhone } from '../../../../utils/phone-util';
import type { FundingChannel } from '../../../../services/api/FundingService';
import type { FundingPayment } from '../../utils/funding';

/**
 * "Send application/payment link" — the sheet that gets the homeowner onto their
 * own phone to finish a card or a loan application.
 *
 * Three ways out, in the order a rep actually uses them at a kitchen table:
 * **scan the QR** (the homeowner is sitting right there), **text it**, **email it**.
 * All three point at the SAME hosted page: `POST …/link` is idempotent, so opening
 * the sheet, backing out and reopening never stacks links or leaves an earlier one
 * live (spec §5.4).
 *
 * ⚠️ **The server does the sending**, not the device. `link-sent` with a `text` or
 * `email` channel dispatches a real SMS/HTML email — the app only supplies the
 * destination. On a `502` nothing was sent and nothing was written, so the sheet
 * stays open on the same step rather than claiming success.
 *
 * ⚠️ Opening this sheet marks NOTHING. `Link Sent` only ticks once a send actually
 * completes (spec §5.4) — which for QR means the rep confirming the homeowner
 * scanned it.
 *
 * ⚠️ The url is a **bearer credential** scoped to one payment: anyone holding it
 * can complete that payment. It is never logged or persisted — it lives in the
 * parent's state for the life of this sheet and no longer.
 *
 * Rendered as an in-sheet overlay, not a nested `<Modal>`: this already lives
 * inside the Result Lead modal, and stacked native modals are unreliable on both
 * platforms.
 */

/**
 * `react-native-qrcode-svg` is pure JS over `react-native-svg`, but it is a fresh
 * dependency — a missed `yarn install` would otherwise white-screen the whole
 * Result Lead sheet on a step the rep can't skip. Degrade to text/email instead.
 */
let QRCode: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  QRCode = require('react-native-qrcode-svg').default;
} catch {
  QRCode = null;
}

type Stage = 'choose' | 'text' | 'email' | 'done';

interface Props {
  payment: FundingPayment;
  /** The hosted-page url from `POST …/link`. Empty while it is still being fetched. */
  link: string;
  isLoadingLink: boolean;
  /** A `link-sent` call is in flight. */
  isSending: boolean;
  /** Resolves true only when the server confirms the send — see the 502 note above. */
  onSend: (channel: FundingChannel, destination?: string) => Promise<boolean>;
  onClose: () => void;
}

function ModalButton({ label, onPress, alt, disabled, busy }: {
  label: string; onPress: () => void; alt?: boolean; disabled?: boolean; busy?: boolean;
}) {
  const off = !!disabled || !!busy;
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      disabled={off}
      style={{
        flex: 1,
        borderRadius: 11,
        paddingVertical: 13,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: off ? 0.5 : 1,
        backgroundColor: alt ? '#fff' : FUND.GREEN,
        borderWidth: alt ? 1.6 : 0,
        borderColor: FUND.BORDER,
      }}
    >
      {busy ? (
        <ActivityIndicator size="small" color={alt ? FUND.SUBTEXT : '#fff'} />
      ) : (
        <Text style={{ fontSize: 14, fontWeight: '700', color: alt ? '#3A4048' : '#fff' }}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

export function SendLinkModal({ payment, link, isLoadingLink, isSending, onSend, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('choose');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');

  const isBank = payment.type === 'bank';
  const title = isBank ? 'Send application link' : 'Send payment link';

  /** Only advance to the confirmation when the SERVER says the send happened. */
  const deliver = async (channel: FundingChannel, destination: string | undefined, who: string) => {
    const ok = await onSend(channel, destination);
    if (!ok) return; // the hook already surfaced why; stay put so the rep can retry
    setSentTo(who);
    setStage('done');
  };

  const sendText = () => {
    const e164 = toE164USPhone(phone);
    if (e164.length !== 12) {
      FlashMessage.warning('Phone number', 'Enter the homeowner’s 10-digit mobile number.');
      return;
    }
    deliver('text', e164, `Texted to ${formatLocalUSPhone(phone)}`);
  };

  const sendEmail = () => {
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      FlashMessage.warning('Email address', 'Enter a valid email address for the homeowner.');
      return;
    }
    deliver('email', to, `Emailed to ${to}`);
  };

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,20,24,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
      <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 22, maxHeight: '92%' }}>
        <ScrollView contentContainerStyle={{ padding: 22, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
          {stage === 'choose' && (
            <>
              <Text style={{ fontSize: 19, fontWeight: '700', color: FUND.TEXT, marginBottom: 4, textAlign: 'center' }}>{title}</Text>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: FUND.MUTED, marginBottom: 16, textAlign: 'center' }}>
                ${payment.amount.toLocaleString()} · {payment.method}
              </Text>

              {isLoadingLink ? (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <ActivityIndicator size="large" color={FUND.GREEN} />
                  <Text style={{ fontSize: 12, fontWeight: '600', color: FUND.MUTED, marginTop: 12 }}>Preparing the link…</Text>
                </View>
              ) : !link ? (
                /* The link call failed — the hook has already said why. Without a url
                   there is nothing to scan, text or email, so offer the way out
                   rather than three dead buttons. */
                <View style={{ alignSelf: 'stretch', backgroundColor: FUND.RED_BG, borderRadius: 11, padding: 12 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: FUND.RED_TEXT, lineHeight: 17 }}>
                    Couldn’t create the payment link. Close this and try again — nothing has been sent.
                  </Text>
                </View>
              ) : (
                <>
                  {QRCode ? (
                    <>
                      <View style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: FUND.BORDER, backgroundColor: '#fff' }}>
                        <QRCode value={link} size={170} backgroundColor="#fff" color={FUND.TEXT} />
                      </View>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: FUND.SUBTEXT, marginTop: 10, textAlign: 'center' }}>
                        Have them scan this with their phone
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                        {/* Sends nothing — it RECORDS that the homeowner scanned it. */}
                        <ModalButton
                          label="They scanned it"
                          alt
                          busy={isSending}
                          onPress={() => deliver('qr', undefined, 'QR scanned at the table')}
                        />
                      </View>
                    </>
                  ) : (
                    <View style={{ alignSelf: 'stretch', backgroundColor: FUND.AMBER_BG, borderRadius: 11, padding: 12, marginBottom: 4 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: FUND.AMBER_TEXT, lineHeight: 17 }}>
                        QR display is unavailable in this build. Send the link by text or email instead.
                      </Text>
                    </View>
                  )}

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 10, alignSelf: 'stretch' }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: FUND.BORDER }} />
                    <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: FUND.MUTED }}>or send it</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: FUND.BORDER }} />
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                    <ModalButton label="Text" alt onPress={() => setStage('text')} disabled={isSending} />
                    <ModalButton label="Email" onPress={() => setStage('email')} disabled={isSending} />
                  </View>

                  <TouchableOpacity
                    onPress={() => {
                      Clipboard.setString(link);
                      FlashMessage.success('Copied', 'Link copied to the clipboard.');
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 }}
                  >
                    <Ionicons name="copy-outline" size={14} color={FUND.SUBTEXT} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: FUND.SUBTEXT }}>Copy link</Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity onPress={onClose} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: FUND.MUTED }}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'text' && (
            <>
              <Text style={{ fontSize: 19, fontWeight: '700', color: FUND.TEXT, marginBottom: 4 }}>Text the link</Text>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: FUND.MUTED, marginBottom: 4, textAlign: 'center' }}>
                Goes straight to the homeowner’s phone
              </Text>
              <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 12, marginTop: 14 }}>
                <Text style={{ fontSize: 16, fontWeight: '700', color: FUND.SUBTEXT, marginRight: 6 }}>+1</Text>
                <TextInput
                  style={{ flex: 1, fontSize: 16, fontWeight: '600', color: FUND.TEXT, padding: 0 }}
                  value={phone}
                  onChangeText={(t) => setPhone(formatLocalUSPhone(t))}
                  placeholder="443-878-4937"
                  placeholderTextColor={FUND.MUTED}
                  keyboardType="phone-pad"
                  maxLength={12}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                <ModalButton label="Send text" onPress={sendText} busy={isSending} />
              </View>
              <TouchableOpacity onPress={() => setStage('choose')} disabled={isSending} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: FUND.MUTED }}>Back</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'email' && (
            <>
              <Text style={{ fontSize: 19, fontWeight: '700', color: FUND.TEXT, marginBottom: 4 }}>Email the link</Text>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: FUND.MUTED, marginBottom: 4, textAlign: 'center' }}>
                Goes straight to the homeowner’s inbox
              </Text>
              <TextInput
                style={{ alignSelf: 'stretch', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16, fontWeight: '600', color: FUND.TEXT, marginTop: 14, textAlign: 'center' }}
                value={email}
                onChangeText={setEmail}
                placeholder="homeowner@email.com"
                placeholderTextColor={FUND.MUTED}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                <ModalButton label="Send email" onPress={sendEmail} busy={isSending} />
              </View>
              <TouchableOpacity onPress={() => setStage('choose')} disabled={isSending} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: FUND.MUTED }}>Back</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'done' && (
            <>
              <Text style={{ fontSize: 34, marginBottom: 6 }}>✅</Text>
              <Text style={{ fontSize: 19, fontWeight: '700', color: FUND.TEXT, marginBottom: 4 }}>Link sent</Text>
              <Text style={{ fontSize: 12.5, fontWeight: '600', color: FUND.MUTED, marginBottom: 16, textAlign: 'center' }}>{sentTo}</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                <ModalButton label="Done" onPress={onClose} />
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
