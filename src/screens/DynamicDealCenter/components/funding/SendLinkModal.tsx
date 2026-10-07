import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Keyboard } from 'react-native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import Clipboard from '@react-native-clipboard/clipboard';
import { FS, FUND, PS } from './funding-theme';
import { FlashMessage } from '../../../../config/message';
import { formatLocalUSPhone, toE164USPhone } from '../../../../utils/phone-util';
import type { FundingChannel } from '../../../../services/api/FundingService';
import {
  canResendLink,
  isReissue,
  lastSendNote,
  reissueWarning,
  resendSeed,
  type FundingPayment,
} from '../../utils/funding';

import QRCode from 'react-native-qrcode-svg';

type Stage = 'choose' | 'text' | 'email' | 'done';

interface Props {
  payment: FundingPayment;
  link: string;
  isLoadingLink: boolean;
  isSending: boolean;
  blockedReason?: string | null;
  onSend: (channel: FundingChannel, destination?: string) => Promise<boolean>;
  onCopyLink?: () => void;
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
        <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: alt ? '#3A4048' : '#fff' }}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

export function SendLinkModal({
  payment,
  link,
  isLoadingLink,
  isSending,
  blockedReason,
  onSend,
  onCopyLink,
  onClose,
}: Props) {
  const isResend = canResendLink(payment);
  const previously = lastSendNote(payment);

  const [stage, setStage] = useState<Stage>(() => (isResend ? resendSeed(payment).stage : 'choose'));
  const [phone, setPhone] = useState(() => (isResend ? resendSeed(payment).phone : ''));
  const [email, setEmail] = useState(() => (isResend ? resendSeed(payment).email : ''));
  const [sentTo, setSentTo] = useState('');
  const [cancelledOld, setCancelledOld] = useState<string | null>(null);

  const [confirm, setConfirm] = useState<{ warning: string; run: () => void } | null>(null);

  const isBank = payment.type === 'bank';
  const noun = isBank ? 'application' : 'payment';
  const title = `${isResend ? 'Resend' : 'Send'} ${noun} link`;

  const deliver = async (channel: FundingChannel, destination: string | undefined, who: string) => {
    const cancelled = isReissue(payment, channel, destination)
      ? String(payment.sentTo || '').trim()
      : null;
    const ok = await onSend(channel, destination);
    if (!ok) return; // the hook already surfaced why; stay put so the rep can retry
    setSentTo(who);
    setCancelledOld(cancelled);
    setStage('done');
  };

  const confirmThenDeliver = (channel: FundingChannel, destination: string, who: string) => {
    const warning = reissueWarning(payment, channel, destination);
    if (!warning) {
      deliver(channel, destination, who);
      return;
    }
    Keyboard.dismiss();
    setConfirm({ warning, run: () => deliver(channel, destination, who) });
  };

  const sendText = () => {
    const e164 = toE164USPhone(phone);
    if (e164.length !== 12) {
      FlashMessage.warning('Phone number', 'Enter the homeowner’s 10-digit mobile number.');
      return;
    }
    confirmThenDeliver('text', e164, `Texted to ${formatLocalUSPhone(phone)}`);
  };

  const sendEmail = () => {
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      FlashMessage.warning('Email address', 'Enter a valid email address for the homeowner.');
      return;
    }
    confirmThenDeliver('email', to, `Emailed to ${to}`);
  };

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,20,24,0.45)', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 60 }}>
      <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 22, maxHeight: '92%' }}>
        <ScrollView contentContainerStyle={{ padding: 22, alignItems: 'center' }} keyboardShouldPersistTaps="handled">
          {stage === 'choose' && (
            <>
              <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, marginBottom: 4, textAlign: 'center' }}>{title}</Text>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginBottom: isResend && previously ? 10 : 16, textAlign: 'center' }}>
                ${payment.amount.toLocaleString()} · {payment.method}
              </Text>

              {/* ⚠️ The destination, read back. A rep who mistyped a digit cannot see
                  it anywhere else — this is the whole point of the resend flow. */}
              {isResend && !!previously && (
                <View style={{ alignSelf: 'stretch', backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 }}>
                  <Text style={{ fontSize: FS.TINY, fontFamily: PS.extrabold, letterSpacing: 0.5, color: FUND.MUTED, marginBottom: 3 }}>LAST SENT</Text>
                  <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.SUBTEXT }}>{previously}</Text>
                </View>
              )}

              {isLoadingLink ? (
                <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                  <ActivityIndicator size="large" color={FUND.GREEN} />
                  <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginTop: 12 }}>Preparing the link…</Text>
                </View>
              ) : blockedReason ? (
                <View style={{ alignSelf: 'stretch', backgroundColor: FUND.RED_BG, borderRadius: 11, padding: 12 }}>
                  <Text style={{ fontSize: FS.BODY, fontFamily: PS.extrabold, color: FUND.RED_TEXT }}>
                    Payments are not set up for your company yet
                  </Text>
                  <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.RED_TEXT, lineHeight: 17, marginTop: 4 }}>
                    Contact your office — setup has to be finished in Stripe before card and loan links can be sent.
                    Nothing has been sent.
                  </Text>
                  {/* The server's wording names the exact requirement whoever is
                      called will have to clear. */}
                  <Text style={{ fontSize: FS.TINY, fontFamily: PS.semibold, color: FUND.RED_TEXT, lineHeight: 16, marginTop: 6, opacity: 0.85 }}>
                    {blockedReason}
                  </Text>
                </View>
              ) : !link ? (
                <View style={{ alignSelf: 'stretch', backgroundColor: FUND.RED_BG, borderRadius: 11, padding: 12 }}>
                  <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.RED_TEXT, lineHeight: 17 }}>
                    Couldn’t create the payment link. Close this and try again — nothing has been sent.
                  </Text>
                </View>
              ) : (
                <>
                  {/* ⚠️ Unconditional. There is no "QR unavailable" state any more — see
                      the import note at the top of the file. If `link` resolved, the
                      code renders. */}
                  <View style={{ padding: 10, borderRadius: 12, borderWidth: 1, borderColor: FUND.BORDER, backgroundColor: '#fff' }}>
                    <QRCode value={link} size={170} backgroundColor="#fff" color={FUND.TEXT} />
                  </View>
                  <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.SUBTEXT, marginTop: 10, textAlign: 'center' }}>
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

                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, marginBottom: 10, alignSelf: 'stretch' }}>
                    <View style={{ flex: 1, height: 1, backgroundColor: FUND.BORDER }} />
                    <Text style={{ fontSize: FS.TINY, fontFamily: PS.bold, letterSpacing: 0.6, textTransform: 'uppercase', color: FUND.MUTED }}>or send it</Text>
                    <View style={{ flex: 1, height: 1, backgroundColor: FUND.BORDER }} />
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                    <ModalButton label="Text" alt onPress={() => setStage('text')} disabled={isSending} />
                    <ModalButton label="Email" onPress={() => setStage('email')} disabled={isSending} />
                  </View>

                  <TouchableOpacity
                    onPress={() => {
                      Clipboard.setString(link);
                      onCopyLink?.();
                      FlashMessage.success('Copied', 'Link copied to the clipboard.');
                    }}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 }}
                  >
                    <Ionicons name="copy-outline" size={14} color={FUND.SUBTEXT} />
                    <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.SUBTEXT }}>Copy link</Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity onPress={onClose} style={{ marginTop: 12 }}>
                {/* "Cancel" implies aborting something in progress; when the gate
                    refused there is nothing in progress to abort. */}
                <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.MUTED }}>{blockedReason ? 'Close' : 'Cancel'}</Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'text' && (
            <>
              <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, marginBottom: 4 }}>
                {isResend ? 'Check the number' : 'Text the link'}
              </Text>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginBottom: 4, textAlign: 'center' }}>
                {isResend
                  ? 'Correct it if it is wrong, then send the same link again.'
                  : 'Goes straight to the homeowner’s phone'}
              </Text>
              <View style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 12, marginTop: 14 }}>
                <Text style={{ fontSize: FS.LEAD, fontFamily: PS.bold, color: FUND.SUBTEXT, marginRight: 6 }}>+1</Text>
                <TextInput
                  style={{ flex: 1, fontSize: FS.LEAD, fontFamily: PS.semibold, color: FUND.TEXT, padding: 0 }}
                  value={phone}
                  onChangeText={(t) => setPhone(formatLocalUSPhone(t))}
                  placeholder="443-878-4937"
                  placeholderTextColor={FUND.MUTED}
                  keyboardType="phone-pad"
                  maxLength={12}
                />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                <ModalButton label={isResend ? 'Resend text' : 'Send text'} onPress={sendText} busy={isSending} />
              </View>
              {/* Reaches the QR and the other channel even when a resend opened
                  straight onto this stage — nothing is taken away by the shortcut. */}
              <TouchableOpacity onPress={() => setStage('choose')} disabled={isSending} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.MUTED }}>
                  {isResend ? 'Other ways to send' : 'Back'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'email' && (
            <>
              <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, marginBottom: 4 }}>
                {isResend ? 'Check the address' : 'Email the link'}
              </Text>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginBottom: 4, textAlign: 'center' }}>
                {isResend
                  ? 'Correct it if it is wrong, then send the same link again.'
                  : 'Goes straight to the homeowner’s inbox'}
              </Text>
              <TextInput
                style={{ alignSelf: 'stretch', borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 13, fontSize: FS.LEAD, fontFamily: PS.semibold, color: FUND.TEXT, marginTop: 14, textAlign: 'center' }}
                value={email}
                onChangeText={setEmail}
                placeholder="homeowner@email.com"
                placeholderTextColor={FUND.MUTED}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignSelf: 'stretch' }}>
                <ModalButton label={isResend ? 'Resend email' : 'Send email'} onPress={sendEmail} busy={isSending} />
              </View>
              <TouchableOpacity onPress={() => setStage('choose')} disabled={isSending} style={{ marginTop: 12 }}>
                <Text style={{ fontSize: FS.BODY, fontFamily: PS.bold, color: FUND.MUTED }}>
                  {isResend ? 'Other ways to send' : 'Back'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {stage === 'done' && (
            <>
              <Text style={{ fontSize: FS.EMOJI, marginBottom: 6 }}>✅</Text>
              <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, marginBottom: 4 }}>
                {cancelledOld ? 'New link sent' : isResend ? 'Link sent again' : 'Link sent'}
              </Text>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.semibold, color: FUND.MUTED, marginBottom: cancelledOld ? 10 : 16, textAlign: 'center' }}>{sentTo}</Text>

              {/* ⚠️ Said explicitly, because the rep cannot see it anywhere else and it
                  is the fact that makes the mistake safe: the url the wrong person is
                  holding no longer works. It also warns them off a link they may have
                  copied to the clipboard a moment ago. */}
              {!!cancelledOld && (
                <View style={{ alignSelf: 'stretch', backgroundColor: FUND.PANEL, borderWidth: 1, borderColor: FUND.PANEL_LINE, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16 }}>
                  <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.SUBTEXT, lineHeight: 17 }}>
                    The earlier link to{' '}
                    {payment.sentChannel === 'email' ? cancelledOld : formatLocalUSPhone(cancelledOld) || cancelledOld}{' '}
                    has been cancelled and no longer works.
                  </Text>
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8, alignSelf: 'stretch' }}>
                <ModalButton label="Done" onPress={onClose} />
              </View>
            </>
          )}
        </ScrollView>
      </View>

      {/* ── "this cancels the old link" ──
          The LAST child of the sheet root, so it covers the card and its keyboard
          without a nested <Modal>. Same chrome as the app’s other destructive
          confirmations (Cancel Job, Reset Job Builder): white card, centred title,
          outlined "keep" beside a red "do it". */}
      {!!confirm && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(17,20,24,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 70 }}>
          <View style={{ width: '100%', maxWidth: 340, backgroundColor: '#fff', borderRadius: 18, padding: 20 }}>
            <View style={{ alignSelf: 'center', width: 42, height: 42, borderRadius: 21, backgroundColor: FUND.RED_BG, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Ionicons name="unlink-outline" size={20} color={FUND.RED_TEXT} />
            </View>
            <Text style={{ fontSize: FS.TITLE, fontFamily: PS.bold, color: FUND.TEXT, textAlign: 'center' }}>
              Cancel the old link?
            </Text>
            <Text style={{ fontSize: FS.BODY, fontFamily: PS.semibold, color: FUND.SUBTEXT, textAlign: 'center', lineHeight: 18, marginTop: 8 }}>
              {confirm.warning}
            </Text>

            {/* ⚠️ Said plainly, because it is the half a rep skims past: the homeowner
                may already have the old page open, and it stops working the moment
                this is confirmed. */}
            <View style={{ backgroundColor: FUND.RED_BG, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 10, marginTop: 14 }}>
              <Text style={{ fontSize: FS.SMALL, fontFamily: PS.bold, color: FUND.RED_TEXT, lineHeight: 16 }}>
                Anyone holding the old link — including whoever received it by mistake — will no
                longer be able to pay on it.
              </Text>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              <TouchableOpacity
                onPress={() => setConfirm(null)}
                disabled={isSending}
                style={{ flex: 1, minHeight: 44, borderWidth: 1.6, borderColor: FUND.BORDER, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: '#3A4048' }}>Keep it</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => {
                  const go = confirm.run;
                  setConfirm(null);
                  go();
                }}
                disabled={isSending}
                style={{ flex: 1.35, minHeight: 44, backgroundColor: FUND.RED, borderRadius: 11, alignItems: 'center', justifyContent: 'center', opacity: isSending ? 0.6 : 1 }}
              >
                <Text style={{ fontSize: FS.BODY_LG, fontFamily: PS.bold, color: '#fff' }}>{'Cancel & send new'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
