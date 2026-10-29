import React, { memo, useMemo } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import MCIcon from 'react-native-vector-icons/MaterialCommunityIcons';
import { PollView, pollPercent } from '../../../utils/channel-poll';
import { formatChatTime } from '../../../utils/job-change-summary';

interface Props {
  message: any;
  poll: PollView;
  isMine: boolean;
  /** Hidden while the channel is read-only for this viewer. */
  canVote: boolean;
  pendingOptionId?: string | null;
  onVote: (optionId: string) => void;
  onViewVotes: () => void;
  colors: any;
}

const senderName = (message: any): string => {
  const sender = message?.senderDetails || message?.user || {};
  return (
    sender.fullName ||
    sender.name ||
    `${sender.firstName || ''} ${sender.lastName || ''}`.trim() ||
    sender.userName ||
    'Someone'
  );
};

/**
 * REVUIUX-577: a poll in a team channel, WhatsApp-style - question, one row per
 * option with a fill bar and a count, and the viewer's own choices ticked.
 *
 * Drawn as a whole message row (like JobChangeMessageCard) rather than inside
 * ChatMessageBubble: the bubble is 1,800 lines serving every other message type
 * in both lead chats and channels, and a poll needs none of it.
 */
export const PollMessageCard = memo(function PollMessageCard({
  message,
  poll,
  isMine,
  canVote,
  pendingOptionId,
  onVote,
  onViewVotes,
  colors,
}: Props) {
  const time = formatChatTime(message?.createdAt);
  const chosen = useMemo(() => new Set(poll.myVotes), [poll.myVotes]);
  const votable = canVote && !poll.closed;

  return (
    <View style={{ paddingHorizontal: 12, marginTop: 8, marginBottom: 4 }}>
      <View
        style={{
          alignSelf: isMine ? 'flex-end' : 'flex-start',
          maxWidth: '92%',
          minWidth: '72%',
          backgroundColor: colors.card,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <MCIcon name="poll" size={16} color={colors.textSecondary} />
          <Text style={{ marginLeft: 6, fontSize: 12, fontWeight: '700', color: colors.textSecondary }}>
            {isMine ? 'You' : senderName(message)}
          </Text>
          <Text style={{ marginLeft: 8, fontSize: 11, color: colors.textSecondary }}>
            {poll.allowMultiple ? 'Select one or more' : 'Select one'}
          </Text>
        </View>

        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 12 }}>
          {poll.question}
        </Text>

        {poll.options.map((option) => {
          const picked = chosen.has(option.id);
          const percent = pollPercent(option.voteCount, poll.totalVoters);
          const busy = pendingOptionId === option.id;
          return (
            <TouchableOpacity
              key={option.id}
              disabled={!votable || !!pendingOptionId}
              onPress={() => onVote(option.id)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityState={{ checked: picked, disabled: !votable }}
              accessibilityLabel={`${option.text}, ${option.voteCount} votes`}
              style={{ marginBottom: 10 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={{
                    width: 22,
                    height: 22,
                    // A square marks a poll that takes several answers, a circle
                    // one that takes a single choice - the same hint a form gives.
                    borderRadius: poll.allowMultiple ? 5 : 11,
                    borderWidth: 2,
                    borderColor: picked ? '#30D158' : colors.border,
                    backgroundColor: picked ? '#30D158' : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginRight: 10,
                  }}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={picked ? '#FFFFFF' : colors.textSecondary} />
                  ) : (
                    picked && <MCIcon name="check" size={14} color="#FFFFFF" />
                  )}
                </View>

                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ flex: 1, fontSize: 15, color: colors.text }} numberOfLines={3}>
                      {option.text}
                    </Text>
                    <Text style={{ marginLeft: 8, fontSize: 13, fontWeight: '700', color: colors.textSecondary }}>
                      {option.voteCount}
                    </Text>
                  </View>
                  <View
                    style={{
                      height: 5,
                      borderRadius: 3,
                      backgroundColor: colors.border,
                      marginTop: 6,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        // A width of 0 still has to be a valid style, so the bar
                        // is always rendered and only its width moves.
                        width: `${percent}%`,
                        height: '100%',
                        backgroundColor: picked ? '#30D158' : colors.textSecondary,
                      }}
                    />
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingTop: 10,
            marginTop: 2,
          }}
        >
          <TouchableOpacity
            onPress={onViewVotes}
            disabled={poll.totalVoters === 0}
            accessibilityRole="button"
            accessibilityLabel="View votes"
          >
            <Text
              style={{
                fontSize: 13,
                fontWeight: '700',
                color: poll.totalVoters === 0 ? colors.textSecondary : '#30D158',
              }}
            >
              {poll.totalVoters === 0
                ? 'No votes yet'
                : `View votes (${poll.totalVoters})`}
            </Text>
          </TouchableOpacity>
          {!!time && <Text style={{ fontSize: 11, color: colors.textSecondary }}>{time}</Text>}
        </View>
      </View>
    </View>
  );
});
