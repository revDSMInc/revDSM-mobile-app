import { useState, useEffect, useRef, useMemo } from 'react';
import io, { Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ENV } from '../config/env';

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
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!user) return;

    let socket: Socket;
    const initSocket = async () => {
      try {
        const token = await AsyncStorage.getItem('accessToken');
        socket = io(ENV.API_URL, {
          auth: { token },
          transports: ['websocket'],
        });
        socketRef.current = socket;

        const refreshData = () => {
          socket.emit('get-all-lead-chats', { page: 1, limit: 100 });
          socket.emit('get-team-channels');
        };

        socket.on('connect', refreshData);
        socket.on('all-lead-chats-response', (data: any) => {
          if (data) {
            setChats(data.chats || []);
            setTotalUnread(data.totalUnreadCount || 0);
            if (data.availableStatuses) setAvailableStatuses(data.availableStatuses);
          }
          setLoading(false);
        });

        socket.on('team-channels-response', (data: any) => {
          setChannels(data.channels || []);
          setChannelsLoading(false);
        });

        // Only refresh chat list when someone else sends — not own message echo
        socket.on('new-message', (data: any) => {
          const senderId =
            data?.senderId ||
            data?.message?.senderId ||
            data?.message?.sender?._id ||
            data?.message?.user?._id;
          const currentId = user?._id || user?.id;
          if (!senderId || senderId !== currentId) refreshData();
        });
        socket.on('new-channel-message', (data: any) => {
          const senderId =
            data?.senderId ||
            data?.message?.senderId ||
            data?.message?.sender?._id;
          const currentId = user?._id || user?.id;
          if (!senderId || senderId !== currentId) refreshData();
        });
        socket.on('channel-read', refreshData);
      } catch (err) {
        setLoading(false);
      }
    };

    initSocket();
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
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
    return result;
  }, [chats, searchQuery, statusFilter, filterUnread]);

  const filteredChannels = useMemo(() => {
    if (!searchQuery) return channels;
    const query = searchQuery.toLowerCase();
    return channels.filter((c) => (c.title || c.name || '').toLowerCase().includes(query));
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
