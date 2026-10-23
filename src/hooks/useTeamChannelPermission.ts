import { useEffect, useMemo, useState } from 'react';
import SocketManager from '../services/SocketManager';
import ChatService from '../services/api/ChatService';

// REVDSM-1313: the server sends these flat and snake_case, per viewer.
export interface ChannelPermissions {
  can_post: boolean;
  can_reply: boolean;
  can_react: boolean;
  can_upload: boolean;
  can_edit_own: boolean;
  is_read_only: boolean;
  can_manage?: boolean;
}

export interface ChannelData {
  id?: string;
  permissions?: ChannelPermissions;
  require_ack?: boolean;
  require_approval?: boolean;
  [key: string]: any;
}

const sameId = (a: any, b: any) => !!a && !!b && String(a) === String(b);

/**
 * Permissions come from the server per viewer (channel.permissions). The channel is kept live
 * from `team-channel-created/updated/archived` (each carries the channel as THIS user sees it)
 * and refetched from `GET /api/v1/channels/` on socket reconnect, so a manager changing a setting
 * updates an open conversation without a reload. Nothing here looks at the channel type or name.
 */
export function useTeamChannelPermission(channel: ChannelData | null | undefined) {
  const channelId = channel?.id;
  const [live, setLive] = useState<ChannelData | null>(null);

  useEffect(() => {
    if (!channelId) return;
    setLive(null);
    const upsert = (data: any) => {
      const c = data?.channel;
      if (c && sameId(c.id, channelId)) setLive(c);
    };
    const unsubCreated = SocketManager.on('team-channel-created', upsert);
    const unsubUpdated = SocketManager.on('team-channel-updated', upsert);
    const unsubArchived = SocketManager.on('team-channel-archived', (data: any) => {
      if (sameId(data?.channelId, channelId)) setLive({ id: channelId, removed: true });
    });
    const refetch = () => {
      ChatService.loadChannels()
        .then((list: any[]) => {
          const found = list.find((c: any) => sameId(c.id, channelId));
          // Gone from the list means archived or hidden for this user.
          setLive(found || { id: channelId, removed: true });
        })
        .catch(() => {});
    };
    const unsubConnect = SocketManager.on('connect', refetch);
    return () => {
      unsubCreated();
      unsubUpdated();
      unsubArchived();
      unsubConnect();
    };
  }, [channelId]);

  const source = live && !live.removed ? live : channel;
  const permissions = source?.permissions;

  return useMemo(() => {
    const hasAccess = !!channel && !live?.removed;
    // No `permissions` (not loaded yet): fall back to the channel's own post_permission.
    const legacyPost = source?.post_permission !== 'managers';
    const canPost = permissions ? permissions.can_post : legacyPost;
    return {
      hasTeamChannelAccess: hasAccess,
      removed: !!live?.removed,
      canPost,
      canReact: permissions ? permissions.can_react : canPost,
      canReply: permissions ? permissions.can_reply : canPost,
      canUpload: permissions ? permissions.can_upload : canPost,
      canEditOwn: permissions ? permissions.can_edit_own : true,
      isReadOnly: permissions ? permissions.is_read_only : !canPost,
      canManage: !!permissions?.can_manage,
      requireAck: !!source?.require_ack,
      requireApproval: !!source?.require_approval,
    };
  }, [channel, live, source, permissions]);
}
