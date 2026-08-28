import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { format, isValid } from 'date-fns';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { LeadService } from '../../../services/api/leads';
import { FlashMessage } from '../../../config/message';
import { isDraftApproved, isDraftCancelled } from '../../../utils/addendum-drafts';

/**
 * The deal's addendum list — a port of web `src/sections/deal/components/addendums-card.js`.
 *
 * Web renders it as `docsExtras` inside the Job Docs tab, between the contract card
 * and the `N/M slots • N photos` progress row; mobile sits in the same place inside
 * `JobDocsSection`. It renders **null** when the lead has no addendums, which is why
 * web mounts it on BOTH routes and mobile does too — it costs the Lead Center nothing.
 */

const CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  pending: { label: 'Pending', bg: '#FFAB00', fg: '#1C252E' },
  declined: { label: 'Declined', bg: '#FF5630', fg: '#FFFFFF' },
  // Same grey the unknown-status fallback was already painting — only the raw lowercase
  // label is corrected, so a cancelled row reads like its `Accepted` siblings.
  cancelled: { label: 'Cancelled', bg: '#919EAB29', fg: '#1C252E' },
  canceled: { label: 'Cancelled', bg: '#919EAB29', fg: '#1C252E' },
  signed: { label: 'Signed', bg: '#22C55E', fg: '#FFFFFF' },
  accepted: { label: 'Accepted', bg: '#22C55E', fg: '#FFFFFF' },
  approved: { label: 'Approved', bg: '#22C55E', fg: '#FFFFFF' },
};

/** The chip's label + colours for a draft status; unknown statuses show verbatim. */
export const statusChipConfig = (status: any) => {
  const s = String(status || '').toLowerCase();
  return CHIP[s] || { label: status || 'Draft', bg: '#919EAB29', fg: '#1C252E' };
};

export type AddendumTapAction = 'ignore' | 'cancelled' | 'not-approved' | 'open-pdf';

/**
 * What tapping an addendum row does. Pure so the guards can be tested — they are the
 * part with teeth:
 *  - `ignore` while another row's PDF is in flight. `/amendment-pdf` GENERATES the
 *    document on demand, so a second tap means a second Puppeteer run, a second S3
 *    upload and two 'amendment' documents for one addendum.
 *  - `cancelled` for an addendum cancelled on the portal. It is terminal, so it must be
 *    told apart from `not-approved` — "available once the customer approves it" invites
 *    the rep to wait for a signature that can never arrive.
 *  - `not-approved` for anything else unsigned: the API answers 409, so warn rather than
 *    open a blank viewer.
 */
export function resolveAddendumTap(draft: any, pdfLoadingDraftId: string | null): AddendumTapAction {
  const id = draft?._id || draft?.id;
  if (!id) return 'ignore';
  if (pdfLoadingDraftId) return 'ignore';
  // ⚠️ Still BELOW the in-flight guard, which outranks every status test for the reason
  // above; but ahead of the approval test, which would otherwise swallow this case.
  if (isDraftCancelled(draft)) return 'cancelled';
  if (!isDraftApproved(draft)) return 'not-approved';
  return 'open-pdf';
}

const StatusChip = ({ status }: { status: any }) => {
  const cfg = statusChipConfig(status);
  return (
    <View className="rounded-md px-2 py-0.5" style={{ backgroundColor: cfg.bg }}>
      <Text className="text-[11px] font-bold" style={{ color: cfg.fg }}>
        {cfg.label}
      </Text>
    </View>
  );
};

interface AddendumsCardProps {
  drafts?: any[];
  /** Opens a resolved PDF url in the app's viewer (LeadCenter `handleOpenPdf`). */
  onOpenPdf?: (url: string, title?: string) => void;
  isDark?: boolean;
  colors?: any;
}

export const AddendumsCard = ({ drafts = [], onOpenPdf, isDark, colors }: AddendumsCardProps) => {
  // Which addendum is resolving its PDF — that row shows a spinner, the rest dim.
  const [pdfLoadingDraftId, setPdfLoadingDraftId] = useState<string | null>(null);

  const handleDraftPress = useCallback(
    async (draft: any, index: number) => {
      // Same reasoning as the chat card's `addendumPdfPending` (see CLAUDE.md).
      const action = resolveAddendumTap(draft, pdfLoadingDraftId);
      if (action === 'ignore') return;
      if (action === 'cancelled') {
        FlashMessage.warning(
          'Addendum cancelled',
          'The Addendum PDF is unavailable because the Addendum was cancelled.'
        );
        return;
      }
      if (action === 'not-approved') {
        FlashMessage.warning(
          'Not available yet',
          'The addendum PDF is available once the customer approves it'
        );
        return;
      }

      const id = draft._id || draft.id;
      setPdfLoadingDraftId(id);
      try {
        const res = await LeadService.getDraftAmendmentPdf(id);
        const body = res?.data;
        const url = body?.data?.url || body?.url || null;
        if (!url) throw new Error('No PDF returned');
        onOpenPdf?.(url, `Addendum #${index + 1}`);
      } catch (err) {
        console.warn('[AddendumsCard] addendum PDF failed:', err);
        FlashMessage.error('Error', 'Failed to open the addendum PDF. Please try again.');
      } finally {
        setPdfLoadingDraftId(null);
      }
    },
    [pdfLoadingDraftId, onOpenPdf]
  );

  if (!drafts?.length) return null;

  return (
    <View
      className="bg-white rounded-2xl mb-3 shadow-sm border border-gray-100 p-4"
      style={{ backgroundColor: isDark ? colors?.card : '#FFFFFF' }}
    >
      <Text
        className="text-base font-black mb-3"
        style={{ color: isDark ? colors?.text : '#1C252E' }}
      >
        {`Addendum${drafts.length > 1 ? 's' : ''} (${drafts.length})`}
      </Text>

      <View className="gap-2">
        {drafts.map((draft, idx) => {
          const id = draft?._id || draft?.id;
          const isPreparing = pdfLoadingDraftId === id;
          // Building a PDF is one-at-a-time, so the other rows read as unavailable
          // rather than silently ignoring a tap.
          const isDimmed = Boolean(pdfLoadingDraftId) && !isPreparing;
          const created = draft?.createdAt ? new Date(draft.createdAt) : null;
          const dateLabel = created && isValid(created) ? format(created, 'MM/dd/yyyy') : '';

          return (
            <TouchableOpacity
              key={id || idx}
              activeOpacity={0.7}
              onPress={() => handleDraftPress(draft, idx)}
              className="flex-row items-center justify-between rounded-xl px-3 py-3"
              style={{
                backgroundColor: isDark ? colors?.surface : '#F9FAFB',
                borderWidth: 1.5,
                borderColor: isPreparing ? '#4CBB17' : '#E5E7EB',
                opacity: isDimmed ? 0.6 : 1,
              }}
            >
              <View className="flex-row items-center flex-1 mr-2">
                <StatusChip status={draft?.status} />
                <Text
                  className="text-[13px] font-bold ml-2"
                  style={{ color: isDark ? colors?.text : '#1C252E' }}
                >
                  {`Addendum #${idx + 1}`}
                </Text>
                {!!dateLabel && (
                  <Text className="text-[11px] ml-2" style={{ color: '#637381' }}>
                    {dateLabel}
                  </Text>
                )}
              </View>

              {isPreparing ? (
                <View className="flex-row items-center">
                  {/* The first open of an addendum approved before this feature
                      existed BUILDS the PDF, which takes a few seconds — say so
                      rather than just spin. */}
                  <Text className="text-[11px] mr-2" style={{ color: '#637381' }}>
                    Preparing PDF…
                  </Text>
                  <ActivityIndicator size="small" color="#4CBB17" />
                </View>
              ) : (
                <Icon
                  name={isDraftApproved(draft) ? 'file-pdf-box' : 'chevron-right'}
                  size={20}
                  color="#637381"
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

export default AddendumsCard;
