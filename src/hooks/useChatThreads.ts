import { useState, useEffect, useMemo } from 'react';
import SocketManager from '../services/SocketManager';
import ChatService from '../services/api/ChatService';
import {
  isInstallingToday,
  isPendingInstall,
  isPendingRehash,
} from '../screens/ChatThreads/utils/deal-link';
import { channelInOffice } from '../utils/team-channel-offices';

export const useChatThreads = (
  user: any,
  mainTab: 'myleads' | 'channels',
  searchQuery: string,
  statusFilter: string,
  filterUnread: boolean
) => {
  const [chats, setChats] = useState<any[]>([]);
  const [totalUnread, setTotalUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [availableStatuses, setAvailableStatuses] = useState<string[]>([]);
  const [channels, setChannels] = useState<any[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);

  useEffect(() => {
    if (!user) return;

    const refreshData = () => {
      console.log('[Threads] Refreshing list data...');
      
      const payload: any = { page: 1, limit: 300 };
      
      let serverStatus = '';
      if (statusFilter === 'unresultedleads') serverStatus = 'Unresulted Leads';
      else if (statusFilter === 'pendingrehash') serverStatus = 'Pending Rehash';
      else if (statusFilter === 'pendinginstall') serverStatus = 'Pending Install';
      else if (statusFilter === 'installingtoday') serverStatus = 'Installing Today';
      else if (statusFilter === 'alreadyinstalled') serverStatus = 'Already Installed';
      else if (statusFilter === 'nosales') serverStatus = 'No Sales';
      else if (statusFilter !== 'all') serverStatus = statusFilter; 

      if (serverStatus && serverStatus !== 'all') {
         payload.status = serverStatus;
      }

      SocketManager.emit('get-all-lead-chats', payload);
    };

    if (SocketManager.isConnected()) refreshData();
    const unsubConnect = SocketManager.on('connect', refreshData);

    const unsubChats = SocketManager.on('all-lead-chats-response', (data: any) => {
      console.log('[ChatSocket] all-lead-chats-response:', JSON.stringify(data, null, 2));
      console.log('[ChatSocket] chats:', data?.chats?.length ?? 0, 'totalUnread:', data?.totalUnreadCount ?? 0);
      (data?.chats || []).forEach((c: any, i: number) => {
        const ld = c?.leadDetails || {};
        console.log(
          `[ChatSocket] #${i} lead ${ld.leadId || ld.selfGenLeadId || 'N/A'} (${ld._id || '-'}) ` +
            `previewImage=${ld.previewImage?.filePath || 'none'} ` +
            `previewImages.active=${ld.previewImages?.active || 'none'} ` +
            `streetView=${ld.previewImages?.streetView?.filePath || 'none'}`
        );
      });

      if (data) {
        setChats(data.chats || []);
        setTotalUnread(data.totalUnreadCount || 0);
        if (data.availableStatuses) setAvailableStatuses(data.availableStatuses);
      }
      setLoading(false);
    });

    const handleNewMsg = (data: any) => {
      const senderId =
        data?.senderId ||
        data?.message?.senderId ||
        data?.message?.sender?._id ||
        data?.message?.user?._id;
      const currentId = user?._id || user?.id;
      if (!senderId || String(senderId) !== String(currentId)) refreshData();
    };

    const unsubNewMsg = SocketManager.on('new-message', handleNewMsg);
    const unsubMsgSeen = SocketManager.on('message-seen', refreshData);
    const unsubLeadRead = SocketManager.on('lead-chat-read', refreshData);
    const unsubAllRead = SocketManager.on('mark-as-read-response', refreshData);

    return () => {
      unsubConnect();
      unsubChats();
      unsubNewMsg();
      unsubMsgSeen();
      unsubLeadRead();
      unsubAllRead();
    };
  }, [user, statusFilter]);

  // Team channels (REVDSM-1313): the stored list is read over HTTP, then kept live from socket events.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const sortChannels = (list: any[]) =>
      [...list].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const sameId = (a: any, b: any) => String(a) === String(b);

    const loadList = () => {
      setChannelsLoading(true);
      ChatService.loadChannels()
        .then((list) => {
          if (!cancelled) setChannels(sortChannels(list));
        })
        .catch((e) => console.warn('[Threads] channel list failed:', e))
        .finally(() => {
          if (!cancelled) setChannelsLoading(false);
        });
    };
    loadList();

    // Created / updated arrive as the channel as THIS user sees it, without counters: keep ours.
    const upsert = (data: any) => {
      const c = data?.channel;
      if (!c?.id) return;
      setChannels((prev) => {
        const old = prev.find((p) => sameId(p.id, c.id));
        const merged = {
          ...old,
          ...c,
          unread_count: old?.unread_count ?? 0,
          pending_count: old?.pending_count ?? 0,
        };
        return sortChannels(old ? prev.map((p) => (p === old ? merged : p)) : [...prev, merged]);
      });
    };
    const unsubCreated = SocketManager.on('team-channel-created', upsert);
    const unsubUpdated = SocketManager.on('team-channel-updated', upsert);
    const unsubArchived = SocketManager.on('team-channel-archived', (data: any) => {
      setChannels((prev) => prev.filter((c) => !sameId(c.id, data?.channelId)));
    });
    const unsubReordered = SocketManager.on('team-channels-reordered', (data: any) => {
      const ids: string[] = (data?.channelIds || []).map(String);
      setChannels((prev) =>
        sortChannels(
          prev.map((c) => {
            const idx = ids.indexOf(String(c.id));
            // A channel shared with that office moves too, so match on its whole
            // office set, not just the primary one it is ordered within.
            return idx !== -1 && (!data?.officeId || channelInOffice(c, data.officeId))
              ? { ...c, sort_order: idx }
              : c;
          })
        )
      );
    });
    const unsubActivity = SocketManager.on('team-channel-activity', (data: any) => {
      if (!data?.channelId || sameId(data.channelId, ChatService.openChannelId)) return;
      setChannels((prev) =>
        prev.map((c) =>
          sameId(c.id, data.channelId) ? { ...c, unread_count: (c.unread_count || 0) + 1 } : c
        )
      );
    });
    const unsubPending = SocketManager.on('channel-pending-updated', (data: any) => {
      setChannels((prev) =>
        prev.map((c) =>
          sameId(c.id, data?.channelId) ? { ...c, pending_count: data?.pendingCount ?? 0 } : c
        )
      );
    });
    // Anything missed while offline.
    const unsubConnect = SocketManager.on('connect', loadList);
    // Opening a channel reads it (the history call marks messages seen); closing it resyncs the counters.
    const unsubOpen = ChatService.onOpenChannelChange((id) => {
      if (id) {
        setChannels((prev) => prev.map((c) => (sameId(c.id, id) ? { ...c, unread_count: 0 } : c)));
      } else {
        loadList();
      }
    });

    return () => {
      cancelled = true;
      unsubCreated();
      unsubUpdated();
      unsubArchived();
      unsubReordered();
      unsubActivity();
      unsubPending();
      unsubConnect();
      unsubOpen();
    };
  }, [user]);

  const filteredChats = useMemo(() => {
    let result = [...chats];
    
    const query = searchQuery.toLowerCase();

    if (query) {
      result = result.filter(
        (c) =>
          c.leadDetails?.customerDetails?.firstName?.toLowerCase().includes(query) ||
          c.leadDetails?.customerDetails?.lastName?.toLowerCase().includes(query) ||
          String(c.leadDetails?.leadId ?? '').toLowerCase().includes(query) ||
          String(c.leadDetails?.fullAddress ?? '').toLowerCase().includes(query) ||
          (c.title || '').toLowerCase().includes(query)
      );
    }

    if (statusFilter === 'currentLeads') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      result = result.filter((c) => new Date(c.leadDetails?.createdAt) >= today);
    } else if (statusFilter === 'unresultedleads') {
      const nonResulted = ['lfLead', 'lf', 'selfGenerated', 'scheduled', 'issued', 'confirmed', 'confirmedIssued', 'preview'];
      result = result.filter((c) => nonResulted.includes(c.leadDetails?.status || ''));
    } else if (statusFilter === 'pendingrehash') {
      result = result.filter((c) => isPendingRehash(c.leadDetails));
    } else if (statusFilter === 'pendinginstall') {
      result = result.filter((c) => isPendingInstall(c.leadDetails));
    } else if (statusFilter === 'installingtoday') {
      result = result.filter((c) => isInstallingToday(c.leadDetails));
    } else if (statusFilter === 'alreadyinstalled') {
      result = result.filter((c) => c.leadDetails?.installBucket === 'Already Installed');
    } else if (statusFilter === 'nosales') {
      const noSaleStatuses = ['noSale', 'demoNoSale', 'noDemo', 'notHome', 'cancelled', 'notHit', 'reset', 'demo'];
      result = result.filter((c) => noSaleStatuses.includes(c.leadDetails?.status || ''));
    } else if (statusFilter !== 'all') {
      result = result.filter((c) => c.leadDetails?.status === statusFilter);
    }

    if (filterUnread) result = result.filter((c) => c.unreadCount > 0);

    result.sort((a, b) => {
      const timeA = new Date(a.lastMessageAt || a.updatedAt || a.createdAt || a.leadDetails?.createdAt || 0).getTime();
      const timeB = new Date(b.lastMessageAt || b.updatedAt || b.createdAt || b.leadDetails?.createdAt || 0).getTime();
      return timeB - timeA;
    });

    return result;
  }, [chats, searchQuery, statusFilter, filterUnread]);

  const filteredChannels = useMemo(() => {
    let result = [...channels];
    const query = searchQuery.toLowerCase();
    
    if (query) {
      result = result.filter((c) => (c.name || '').toLowerCase().includes(query));
    }
    
    return result;
  }, [channels, searchQuery]);

  return {
    filteredChats,
    filteredChannels,
    loading,
    totalUnread,
    availableStatuses,
    channels,
    chats,
  };
};
