import { useMemo } from 'react';

export interface ChannelData {
  _id?: string;
  id?: string;
  channelType?: string;
  [key: string]: any;
}

export function useTeamChannelPermission(channel: ChannelData | null | undefined) {
  const channelType = channel?.channelType;

  const canPost = useMemo(() => {
    if (!channel) return false;
    if (['announcements', 'files', 'commission-sheets'].includes(channelType || '')) {
      return false;
    }
    if (['sales-wins', 'general', 'questions'].includes(channelType || '')) {
      return true;
    }
    return true;
  }, [channel, channelType]);

  const canReact = canPost;
  const canReply = canPost;
  const hasTeamChannelAccess = !!channel;

  return {
    hasTeamChannelAccess,
    canPost,
    canReact,
    canReply,
  };
}
