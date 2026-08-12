import React, { memo } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import {
  AddendumAction,
  JobChangeMeta,
  formatChatTime,
  getJobChangeTitle,
} from '../../../utils/job-change-summary';

/**
 * The addendum lifecycle card in the lead chat (spec `SALES-APP-ADDENDUM-CHAT.md` §3).
 *
 * ⚠️ Rendered INSTEAD of a chat bubble, with no avatar, no sender name and no
 * me/them alignment. `senderId` on these messages is a populated user reference
 * (the schema requires one, so there is no `"system"` sentinel) and it is always
 * the REP who owns the addendum — including on the customer's own approve /
 * decline, which arrives on a public no-auth endpoint where there is no user at
 * all. Applying the normal `isMe` styling would therefore draw
 * "Customer has approved job changes" as an outgoing message the rep typed.
 *
 * Reactions, reply, forward, edit, pin, the long-press menu and the read-receipt
 * row are all suppressed by construction — none of them are rendered here.
 */

const ICON_BY_ACTION: Record<AddendumAction, { name: string; fg: string; bg: string }> = {
  PROPOSED: { name: 'file-document-outline', fg: '#16A34A', bg: '#DCFCE7' },
  ACCEPTED: { name: 'check-bold', fg: '#FFFFFF', bg: '#16A34A' },
  DECLINED: { name: 'close-thick', fg: '#FFFFFF', bg: '#EF4444' },
};

interface Props {
  message: any;
  meta: JobChangeMeta;
  /**
   * `cardId` is the MESSAGE id, not the draft id — one addendum posts up to three
   * cards (proposed → approved/declined) that all carry the SAME `draftId`, so the
   * caller needs the message to tell which card was tapped.
   */
  onView: (meta: JobChangeMeta, cardId: string) => void;
  /** True only while THIS card's View tap is resolving (PDF generation can take seconds). */
  isLoading?: boolean;
  colors: any;
  isDark: boolean;
}

export const JobChangeMessageCard = memo(function JobChangeMessageCard({
  message,
  meta,
  onView,
  isLoading = false,
  colors,
  isDark,
}: Props) {
  const icon = ICON_BY_ACTION[meta.action] || ICON_BY_ACTION.PROPOSED;
  const title = getJobChangeTitle(message);
  const time = formatChatTime(message?.createdAt);
  const cardId = String(message?._id || message?.id || meta.draftId);

  return (
    <View style={{ marginTop: 10, marginBottom: 2,paddingHorizontal:20 }}>
      {/* The timestamp sits ABOVE the card, centered — it reads as a chat time
          separator rather than card content, matching web. */}
      {!!time && (
        <Text
          style={{
            textAlign: 'center',
            fontSize: 12,
            fontWeight: '700',
            color: colors.textSecondary,
            marginBottom: 8,
          }}
        >
          {time}
        </Text>
      )}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingVertical: 14,
          paddingHorizontal: 14,
          borderRadius: 12,
          borderWidth: 1,
          backgroundColor: colors.card,
          borderColor: isDark ? colors.border : '#EEF2F6',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: isDark ? 0 : 0.05,
          shadowRadius: 3,
          elevation: isDark ? 0 : 1,
        }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: icon.bg,
          }}
        >
          <MCIcon name={icon.name} size={18} color={icon.fg} />
        </View>

        <Text style={{ flex: 1, fontSize: 12, fontWeight: '600', lineHeight: 19, color: colors.text }}>
          {title}
        </Text>

        <TouchableOpacity
          onPress={() => onView(meta, cardId)}
          disabled={isLoading}
          activeOpacity={0.7}
          accessibilityLabel="ViewJobChanges"
          style={{
            minWidth: 76,
            height: 36,
            paddingHorizontal: 16,
            borderRadius: 999,
            borderWidth: 1.5,
            borderColor: '#16A34A',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: isLoading ? 0.6 : 1,
          }}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#16A34A" />
          ) : (
            <Text style={{ fontSize: 13, fontWeight: '800', color: '#16A34A' }}>View</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
});
