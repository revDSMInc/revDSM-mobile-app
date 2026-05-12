import { useState, useEffect, useMemo } from 'react';
import SocketManager from '../services/SocketManager';

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
      SocketManager.emit('get-all-lead-chats', { page: 1, limit: 100 });
      SocketManager.emit('get-team-channels');
    };

    // Initial load and connection sync
    if (SocketManager.isConnected()) refreshData();
    const unsubConnect = SocketManager.on('connect', refreshData);

    const unsubChats = SocketManager.on('all-lead-chats-response', (data: any) => {
      if (data) {
        setChats(data.chats || []);
        setTotalUnread(data.totalUnreadCount || 0);
        if (data.availableStatuses) setAvailableStatuses(data.availableStatuses);
      }
      setLoading(false);
    });

    const unsubChannels = SocketManager.on('team-channels-response', (data: any) => {
      setChannels(data.channels || []);
      setChannelsLoading(false);
    });

    // Refresh on new messages from others
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
    const unsubNewChanMsg = SocketManager.on('new-channel-message', handleNewMsg);

    // CRITICAL: Refresh list when messages are marked as read
    const unsubChanRead = SocketManager.on('channel-read', refreshData);
    const unsubMsgSeen = SocketManager.on('message-seen', refreshData);
    const unsubLeadRead = SocketManager.on('lead-chat-read', refreshData);
    const unsubAllRead = SocketManager.on('mark-as-read-response', refreshData);

    return () => {
      unsubConnect();
      unsubChats();
      unsubChannels();
      unsubNewMsg();
      unsubNewChanMsg();
      unsubChanRead();
      unsubMsgSeen();
      unsubLeadRead();
      unsubAllRead();
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
          c.leadDetails?.leadId?.toLowerCase().includes(query) ||
          c.leadDetails?.fullAddress?.toLowerCase().includes(query) ||
          (c.title || '').toLowerCase().includes(query)
      );
    }

    if (statusFilter === 'currentLeads') {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      result = result.filter((c) => new Date(c.leadDetails?.createdAt) >= today);
    } else if (statusFilter !== 'all') {
      result = result.filter((c) => c.leadDetails?.status === statusFilter);
    }

    if (filterUnread) result = result.filter((c) => c.unreadCount > 0);

    // Sort by latest activity (lastMessageAt or updatedAt)
    result.sort((a, b) => {
      const dateA = a.lastMessageAt || a.updatedAt || a.leadDetails?.createdAt || 0;
      const dateB = b.lastMessageAt || b.updatedAt || b.leadDetails?.createdAt || 0;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    return result;
  }, [chats, searchQuery, statusFilter, filterUnread]);

  const filteredChannels = useMemo(() => {
    let result = [...channels];
    const query = searchQuery.toLowerCase();
    
    if (query) {
      result = result.filter((c) => (c.title || c.name || '').toLowerCase().includes(query));
    }
    
    // Sort channels by activity (Newest first)
    return result.sort((a, b) => {
      const dateA = a.lastMessageAt || a.updatedAt || a.createdAt || 0;
      const dateB = b.lastMessageAt || b.updatedAt || b.createdAt || 0;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
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
