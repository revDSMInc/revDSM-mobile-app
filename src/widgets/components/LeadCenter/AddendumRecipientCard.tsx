import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
  StyleSheet,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';
import { useLeadPendingAddendums } from '../../../hooks/useLeadPendingAddendums';
import {
  pendingRecipientRows,
  formatRecipientPhone,
  recipientEditError,
  resolveContactEditPatch,
  buildResendContact,
  describeResendResult,
  channelLabel,
  resolveResendAction,
  resolveCancelAction,
  resolveContactSaveAction,
  resolveCustomerId,
  NO_CUSTOMER_MESSAGE,
  type AddendumRecipientRow,
} from '../../../utils/addendum-recipients';

/**
 * "PENDING ADDENDUM" — the addendums awaiting the customer's signature, who they were
 * sent to, and the rep's controls for them. Rendered as its OWN card above
 * `ContractDetailsCard`, which keeps its green LEAD RESULTED header.
 *
 * Data comes from `useLeadPendingAddendums` (`GET lead/v1/{leadId}/pending-addendums`,
 * kept live by the `pending-addendum` socket event) — deliberately NOT the
 * `job-builder-drafts` list the Addendums card below reads, because only this endpoint
 * returns the draft ids and the customer contact a resend would use.
 *
 * ⚠️ Every rule lives in the pure `utils/addendum-recipients.ts`; this file is only
 * rendering and API calls. It pulls in React Native and is untestable under jest here,
 * which is the whole reason for the split.
 */

interface AddendumRecipientCardProps {
  lead: any;
  isDark?: boolean;
  colors?: any;
  /** Refresh sibling surfaces (the drafts list / the lead) after an action. */
  onRecipientChanged?: () => void;
}

export const AddendumRecipientCard = ({
  lead,
  isDark,
  colors,
  onRecipientChanged,
}: AddendumRecipientCardProps) => {
  const leadId = lead?._id || lead?.id;
  const { snapshot, refresh } = useLeadPendingAddendums(leadId);

  // Which draft has a call in flight. Doubles as the double-tap guard — see
  // `resolveResendAction`, where the in-flight check deliberately outranks validation.
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    draftId: string;
    field: 'phone' | 'email';
    value: string;
  } | null>(null);

  const rows = useMemo(() => pendingRecipientRows(snapshot), [snapshot]);
  const customerId = resolveCustomerId(lead);

  // ⚠️ Contact is LEAD-LEVEL — one customer record shared by every pending addendum,
  // which is why an edit here affects them all and why it is not carried per row.
  const contact = snapshot.customer;
  const phoneDisplay = formatRecipientPhone(contact.phone);

  const titleColor = isDark ? colors?.text : '#1C252E';
  const cardBg = isDark ? '#FFFFFF08' : '#F9FAFB';
  const cardBorder = isDark ? '#FFFFFF12' : '#EEF1F4';

  /** Re-read the banner AND let the parent refresh its own surfaces. */
  const refreshAll = useCallback(() => {
    refresh();
    onRecipientChanged?.();
  }, [refresh, onRecipientChanged]);

  // ── Resend: POST lead/v1/job-builder-draft/{id}/resend ──────────────────────
  // ONE call covers BOTH channels — SMS and email go out together, so whichever
  // address works gets through. The customer's current contact rides in the body.
  const handleResend = useCallback(
    async (row: AddendumRecipientRow) => {
      if (resolveResendAction(row, busyDraftId) !== 'send') return;
      setBusyDraftId(row.draftId);
      try {
        const res = await LeadService.resendJobBuilderDraft(
          row.draftId,
          buildResendContact(contact)
        );
        // ⚠️ A 2xx does NOT mean the customer was reached: the response reports each
        // channel separately and anything other than 'sent' is a partial failure.
        // Claiming success here would hide a bounced SMS.
        const result = describeResendResult(res);
        if (result.ok) {
          FlashMessage.success('Addendum resent', 'The customer has been notified to sign');
        } else {
          const failed = result.failed.map(channelLabel).join(' and ');
          const delivered = result.sent.map(channelLabel).join(' and ');
          FlashMessage.warning(
            `Sent, but ${failed} failed`,
            delivered
              ? `Delivered by ${delivered}. Check the ${failed} details and try again.`
              : 'Check the contact details and try again.'
          );
        }
        refreshAll();
      } catch (err: any) {
        console.warn('[AddendumRecipientCard] resend failed:', err);
        FlashMessage.error(
          'Could not resend',
          err?.response?.data?.message || 'The addendum could not be resent. Please try again.'
        );
      } finally {
        setBusyDraftId(null);
      }
    },
    [busyDraftId, contact, refreshAll]
  );

  // ── Edit: PATCH lead/v1/customer/{customerId} ───────────────────────────────
  // ⚠️ ONE field per request, and only when it actually CHANGED — an untouched editor
  // yields a null patch, which disables Save and sends nothing.
  //
  // ⚠️ Saving does NOT resend: these are separate endpoints, so the rep corrects the
  // contact and then taps Resend. The hint under the editor says so, because a silent
  // "saved" would read as the customer having been re-notified.
  const handleSaveContact = useCallback(async () => {
    if (!editing) return;
    const { draftId, field, value } = editing;
    const original = field === 'phone' ? contact.phone : contact.email;
    const action = resolveContactSaveAction(customerId, field, value, original, busyDraftId);

    if (action === 'ignore') {
      // No customer record → make NO request. A "saved" that never saved would let a
      // later resend report success against a number that was never stored.
      if (!customerId) FlashMessage.error('Cannot save', NO_CUSTOMER_MESSAGE);
      else setEditing(null); // unchanged — nothing to send
      return;
    }
    if (action === 'invalid') return;

    const patch = resolveContactEditPatch(field, value, original);
    if (!patch) return;

    setBusyDraftId(draftId);
    try {
      await LeadService.updateCustomer(customerId, patch);
      setEditing(null);
      FlashMessage.success(
        field === 'phone' ? 'Phone updated' : 'Email updated',
        'Tap Resend to send the addendum to the new contact'
      );
      // The banner re-reads the contact from the server, so no local override is
      // needed — this endpoint returns the customer alongside the addendums.
      refreshAll();
    } catch (err: any) {
      console.warn('[AddendumRecipientCard] customer update failed:', err);
      FlashMessage.error(
        'Could not update',
        err?.response?.data?.message || 'The contact could not be updated. Please try again.'
      );
    } finally {
      setBusyDraftId(null);
    }
  }, [editing, contact, customerId, busyDraftId, refreshAll]);

  const openEdit = useCallback(
    (row: AddendumRecipientRow, field: 'phone' | 'email') => {
      setEditing({
        draftId: row.draftId,
        field,
        // The phone editor holds the LOCAL part only — the static "+1" sits beside it.
        value: field === 'phone' ? formatRecipientPhone(contact.phone) : contact.email,
      });
    },
    [contact]
  );

  // ── Cancel: POST lead/v1/job-builder-draft/{id}/cancel ──────────────────────
  // Confirmed first — it voids an addendum the customer may be about to sign, their
  // review link stops working, and there is no undo.
  //
  // ⚠️ An in-app Modal, NOT `Alert.alert`. The native dialog is OS-chrome — it ignores
  // the app's theme entirely and looked foreign next to every other confirmation here.
  // This mirrors the "Cancel this job?" dialog in `DynamicDealEditScreen`, which is the
  // established pattern for a destructive confirm in this flow.
  const [confirmCancel, setConfirmCancel] = useState<AddendumRecipientRow | null>(null);

  const handleCancelRequest = useCallback(
    (row: AddendumRecipientRow) => {
      if (resolveCancelAction(row, busyDraftId) !== 'send') return;
      setConfirmCancel(row);
    },
    [busyDraftId]
  );

  const performCancel = useCallback(async () => {
    const row = confirmCancel;
    // Re-checked at commit time, not just at open: the row could have been actioned
    // from elsewhere while the dialog sat on screen.
    if (!row || resolveCancelAction(row, busyDraftId) !== 'send') return;
    setBusyDraftId(row.draftId);
    try {
      await LeadService.cancelJobBuilderDraft(row.draftId);
      setConfirmCancel(null);
      FlashMessage.success('Addendum cancelled', 'The signature request has been voided');
      // The refetch drops the row: it is no longer pending. If it was the last one this
      // whole section disappears and the contract card is the only status left.
      refreshAll();
    } catch (err: any) {
      console.warn('[AddendumRecipientCard] cancel failed:', err);
      FlashMessage.error(
        'Could not cancel',
        err?.response?.data?.message || 'The addendum could not be cancelled. Please try again.'
      );
    } finally {
      setBusyDraftId(null);
    }
  }, [confirmCancel, busyDraftId, refreshAll]);

  // Nothing pending → nothing to show. An empty list is a REAL state (the last
  // addendum was signed or cancelled), not a loading gap.
  if (!rows.length) return null;

  const count = snapshot.pendingCount;
  const plural = count > 1;

  return (
    <View style={[styles.card, { backgroundColor: isDark ? colors?.card : '#FFFFFF' }]}>
      <View style={styles.amberHeader}>
        <Text style={styles.amberTitle}>
          {`PENDING ADDENDUM${plural ? 'S' : ''} - AWAITING CUSTOMER SIGNATURE`}
        </Text>
        <Text style={styles.amberSub}>
          {`${count} addendum${plural ? 's' : ''} awaiting customer approval`}
        </Text>
      </View>

      <View style={styles.body}>
        {rows.map((row) => {
          const isEditingThis = editing?.draftId === row.draftId;
          const isBusy = busyDraftId === row.draftId;
          const editError = isEditingThis ? recipientEditError(editing.field, editing.value) : '';
          // Save is disabled when nothing changed — an untouched editor sends nothing.
          const editPatch = isEditingThis
            ? resolveContactEditPatch(
                editing.field,
                editing.value,
                editing.field === 'phone' ? contact.phone : contact.email
              )
            : null;

          return (
            <View
              key={row.draftId}
              style={[styles.signerCard, { backgroundColor: cardBg, borderColor: cardBorder }]}
            >
              <View style={styles.signerCardHead}>
                <View style={styles.headText}>
                  <Text style={[styles.signerName, { color: titleColor }]}>
                    {`Addendum #${row.number}`}
                  </Text>
                  <Text style={styles.signerRole}>Buyer · signs addendum</Text>
                </View>
                <View style={styles.statusChip}>
                  <Icon name="send-outline" size={13} color="#B45309" style={styles.chipIcon} />
                  <Text style={styles.statusChipText}>Sent</Text>
                </View>
              </View>

              <Text style={styles.recipientLine}>
                {phoneDisplay ? `📱 ${phoneDisplay}` : ''}
                {phoneDisplay && contact.email ? '   ' : ''}
                {contact.email ? `✉️ ${contact.email}` : ''}
                {!phoneDisplay && !contact.email ? 'No contact on file' : ''}
              </Text>

              {isEditingThis ? (
                <>
                  <View style={styles.editRow}>
                    <View
                      style={[
                        styles.inputRow,
                        {
                          borderColor: editError ? '#FF5630' : isDark ? '#FFFFFF20' : '#919EAB33',
                          backgroundColor: isDark ? '#FFFFFF05' : '#FFFFFF',
                        },
                      ]}
                    >
                      {editing.field === 'phone' && (
                        <Text style={[styles.prefix, { color: isDark ? '#FFFFFF80' : '#637381' }]}>
                          +1
                        </Text>
                      )}
                      <TextInput
                        value={editing.value}
                        onChangeText={(t) =>
                          setEditing((e) =>
                            e
                              ? { ...e, value: e.field === 'phone' ? formatRecipientPhone(t) : t }
                              : e
                          )
                        }
                        placeholder={
                          editing.field === 'phone' ? '(555) 123-4567' : 'customer@email.com'
                        }
                        placeholderTextColor="#919EAB"
                        keyboardType={editing.field === 'phone' ? 'phone-pad' : 'email-address'}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                        // 10 digits + the "(", ") " and "-" the formatter inserts.
                        maxLength={editing.field === 'phone' ? 14 : undefined}
                        style={[styles.inputText, { color: titleColor }]}
                        editable={!isBusy}
                      />
                    </View>
                    <TouchableOpacity
                      onPress={() => setEditing(null)}
                      disabled={isBusy}
                      style={styles.iconBtnGhost}
                    >
                      <Icon name="close" size={18} color="#637381" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleSaveContact}
                      disabled={isBusy || Boolean(editError) || !editPatch}
                      style={[
                        styles.iconBtnSolid,
                        { backgroundColor: editError || !editPatch ? '#919EAB33' : '#4CBB17' },
                      ]}
                    >
                      {isBusy ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <Icon name="check" size={18} color="white" />
                      )}
                    </TouchableOpacity>
                  </View>
                  {!!editError && <Text style={styles.editError}>{editError}</Text>}
                  {/* Save and resend are SEPARATE endpoints — say so, or "saved" reads
                      as "the customer has been re-notified". */}
                  <Text style={styles.editHint}>
                    Saving updates the customer’s contact. Tap Resend to notify them.
                  </Text>
                </>
              ) : (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    onPress={() => handleResend(row)}
                    disabled={isBusy}
                    style={styles.actionChip}
                  >
                    {isBusy ? (
                      <ActivityIndicator size="small" color="#4CBB17" />
                    ) : (
                      <>
                        <Icon name="refresh" size={14} color="#4CBB17" />
                        <Text style={styles.actionChipText}>Resend</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => openEdit(row, 'phone')}
                    disabled={isBusy}
                    style={styles.actionChip}
                  >
                    <Icon name="phone-outline" size={14} color="#637381" />
                    <Text style={[styles.actionChipText, styles.actionChipMuted]}>Edit Phone</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => openEdit(row, 'email')}
                    disabled={isBusy}
                    style={styles.actionChip}
                  >
                    <Icon name="email-outline" size={14} color="#637381" />
                    <Text style={[styles.actionChipText, styles.actionChipMuted]}>Edit Email</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Sits with the actions it belongs to, and is PER ADDENDUM — with more
                  than one pending, a single shared link could not say which it would
                  cancel. Outside the ternary so it does not disappear mid-edit. */}
              <TouchableOpacity
                onPress={() => handleCancelRequest(row)}
                disabled={isBusy}
                style={styles.cancelRequestBtn}
              >
                <Text style={styles.cancelRequestText}>Cancel Request</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>

      {/* Themed confirm — the app's own dialog, matching "Cancel this job?" in the
          deal-edit wizard. A Modal renders in its own layer, so nesting it inside the
          card is safe despite the card's `overflow: hidden`. */}
      <Modal
        visible={Boolean(confirmCancel)}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmCancel(null)}
      >
        <View style={styles.confirmScrim}>
          <View style={[styles.confirmCard, { backgroundColor: isDark ? colors?.card : '#FFFFFF' }]}>
            <Text style={[styles.confirmTitle, { color: titleColor }]}>
              {`Cancel Addendum #${confirmCancel?.number ?? ''}?`}
            </Text>
            <Text style={styles.confirmBody}>
              This voids the addendum awaiting the customer’s signature. Their review link
              will stop working.
            </Text>
            <View style={styles.confirmActions}>
              <TouchableOpacity
                onPress={() => setConfirmCancel(null)}
                disabled={Boolean(busyDraftId)}
                style={[styles.confirmBtn, styles.confirmKeep]}
              >
                <Text style={styles.confirmKeepText}>Keep It</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={performCancel}
                disabled={Boolean(busyDraftId)}
                style={[styles.confirmBtn, styles.confirmDestructive]}
              >
                {busyDraftId ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.confirmDestructiveText}>Cancel Addendum</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  // A card in its OWN right, a sibling of `ContractDetailsCard` rather than part of it —
  // the two statuses are separate sections on the screen.
  card: {
    borderRadius: 16,
    marginBottom: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },

  amberHeader: { backgroundColor: '#F4B400', paddingVertical: 14, paddingHorizontal: 16 },
  amberTitle: { color: '#1C252E', fontWeight: '900', fontSize: 13, letterSpacing: 0.2 },
  amberSub: {
    color: '#1C252E',
    fontWeight: '600',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },

  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 },

  signerCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 12 },
  signerCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headText: { flex: 1 },
  signerName: { fontSize: 15, fontWeight: '800' },
  signerRole: { fontSize: 11, color: '#637381', marginTop: 2, fontWeight: '600' },

  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FEF3C7',
  },
  chipIcon: { marginRight: 4 },
  statusChipText: { fontSize: 11, fontWeight: '800', color: '#B45309' },

  recipientLine: { fontSize: 12.5, color: '#637381', marginTop: 8, fontWeight: '600' },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  actionChipText: { fontWeight: '800', color: '#4CBB17', fontSize: 12 },
  actionChipMuted: { color: '#637381' },

  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
  },
  prefix: { fontWeight: '700', marginRight: 6, fontSize: 14, includeFontPadding: false },
  inputText: { flex: 1, fontSize: 14, fontWeight: '600' },
  editError: { fontSize: 11, color: '#FF5630', fontWeight: '700', marginTop: 8 },
  editHint: { fontSize: 11, color: '#919EAB', fontWeight: '600', marginTop: 6 },

  iconBtnGhost: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnSolid: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cancelRequestBtn: { alignItems: 'center', paddingVertical: 10, marginTop: 10 },
  cancelRequestText: { color: '#EF4444', fontWeight: '800', fontSize: 12 },

  confirmScrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: { borderRadius: 16, padding: 20, width: '100%', maxWidth: 340 },
  confirmTitle: { fontSize: 17, fontWeight: '900', textAlign: 'center' },
  confirmBody: { fontSize: 13, color: '#64748B', textAlign: 'center', marginTop: 8, lineHeight: 19 },
  confirmActions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  confirmBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  confirmKeep: { borderWidth: 1, borderColor: '#CBD5E1' },
  confirmKeepText: { fontWeight: '800', color: '#334155' },
  confirmDestructive: { backgroundColor: '#DC2626' },
  confirmDestructiveText: { fontWeight: '800', color: '#FFFFFF' },
});
