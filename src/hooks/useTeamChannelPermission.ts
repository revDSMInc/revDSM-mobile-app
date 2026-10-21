import { useEffect, useMemo, useState } from 'react';
import SocketManager from '../services/SocketManager';

export interface ChannelPermissions {
  canPost: boolean;
  canReply: boolean;
  canReact: boolean;
  canUpload: boolean;
  canEditOwn: boolean;
  isReadOnly: boolean;
  canManage?: boolean;
}

export interface ChannelData {
  _id?: string;
  id?: string;
  channelType?: string;
  permissions?: ChannelPermissions;
  settings?: Record<string, any>;
  [key: string]: any;
}

const sameId = (a: any, b: any) => !!a && !!b && String(a) === String(b);

/**
 * Permissions come from the server per viewer (channel.permissions). The
 * channel is looked up in the live `team-channels-response` list, so a manager
 * changing a setting updates an open conversation without a reload. Nothing
 * here looks at the channel type or name.
 */
export function useTeamChannelPermission(channel: ChannelData | null | undefined) {
  const channelId = channel?._id || channel?.id;
  const [live, setLive] = useState<ChannelData | null>(null);

  useEffect(() => {
    if (!channelId) return;
    const unsub = SocketManager.on('team-channels-response', (data: any) => {
      const found = (data?.channels || []).find((c: any) => sameId(c._id || c.id, channelId));
      // Gone from the list means archived or hidden for this user.
      setLive(found || { _id: channelId, removed: true });
    });
    SocketManager.emit('get-team-channels');
    return unsub;
  }, [channelId]);

  const source = live && !live.removed ? live : channel;
  const permissions = source?.permissions;
  const settings = source?.settings || {};

  return useMemo(() => {
    const hasAccess = !!channel && !live?.removed;
    // Older server without `permissions`: keep the previous behaviour.
    const legacyPost = !['announcements', 'files', 'commission-sheets'].includes(source?.channelType || '');
    const canPost = permissions ? permissions.canPost : legacyPost;
    return {
      hasTeamChannelAccess: hasAccess,
      removed: !!live?.removed,
      canPost,
      canReact: permissions ? permissions.canReact : canPost,
      canReply: permissions ? permissions.canReply : canPost,
      canUpload: permissions ? permissions.canUpload : canPost,
      canEditOwn: permissions ? permissions.canEditOwn : true,
      isReadOnly: permissions ? permissions.isReadOnly : !canPost,
      canManage: !!permissions?.canManage,
      requireAck: !!settings.requireAck,
      requireApproval: !!settings.requireApproval,
    };
  }, [channel, live, source, permissions, settings.requireAck, settings.requireApproval]);
}
