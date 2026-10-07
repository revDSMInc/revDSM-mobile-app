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
      
      const payload: any = { page: 1, limit: 300 };
      
      let serverStatus = '';
      if (statusFilter === 'unresultedleads') serverStatus = 'Unresulted Leads';
      else if (statusFilter === 'pendinginstall') serverStatus = 'Pending Install';
      else if (statusFilter === 'installingtoday') serverStatus = 'Installing Today';
      else if (statusFilter === 'alreadyinstalled') serverStatus = 'Already Installed';
      else if (statusFilter === 'nosales') serverStatus = 'No Sales';
      else if (statusFilter !== 'all') serverStatus = statusFilter; 

      if (serverStatus && serverStatus !== 'all') {
         payload.status = serverStatus;
      }

      SocketManager.emit('get-all-lead-chats', payload);
      SocketManager.emit('get-team-channels');
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

    const unsubChannels = SocketManager.on('team-channels-response', (data: any) => {
      console.log('[ChatSocket] team-channels-response:', JSON.stringify(data, null, 2));
      setChannels(data.channels || []);
      setChannelsLoading(false);
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
    const unsubNewChanMsg = SocketManager.on('new-channel-message', handleNewMsg);

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
  }, [user, statusFilter]);

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
    } else if (statusFilter === 'pendinginstall') {
      const now = new Date();
      result = result.filter((c) => 
        c.leadDetails?.status === 'sale' && 
        c.leadDetails?.installationDate && 
        new Date(c.leadDetails.installationDate) > now
      );
    } else if (statusFilter === 'installingtoday') {
      const todayStr = new Date().toISOString().split('T')[0];
      result = result.filter((c) => 
        c.leadDetails?.installationDate?.startsWith(todayStr)
      );
    } else if (statusFilter === 'alreadyinstalled') {
      const now = new Date();
      result = result.filter((c) => 
        c.leadDetails?.status === 'sale' && 
        c.leadDetails?.installationDate && 
        new Date(c.leadDetails.installationDate) < now
      );
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
      result = result.filter((c) => (c.title || c.name || '').toLowerCase().includes(query));
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
